-- =====================================================================
-- Portail Hympyr · Phase 2 : une seule source de vérité des droits
-- Appliquée sur cmvkijtlkzfwnzipgstc le 24/11/2026 via le SQL Editor (hors historique des migrations Supabase).
--
-- Principe :
--   portail_collaborateurs (qui) + portail_acces (quel outil, quel rôle) = source de vérité.
--   Les 4 tables de membres historiques (charte_membres, comm_membres, fificli_membres,
--   granules_membres) restent des tables réelles, tenues à jour automatiquement par trigger :
--   aucun outil n'est modifié et rien ne casse.
--   Synchronisation dans les deux sens : une modification faite dans un ancien écran
--   (ex. administration des membres du pilotage) remonte dans portail_acces.
--   Garde anti-boucle : pg_trigger_depth().
-- Retour arrière : supprimer les triggers *_vers_portail et portail_acces_sync ;
--   les 4 tables historiques sont intactes et redeviennent seules maîtres.
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.portail_collaborateurs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  prenom text,
  nom text,
  pole text,
  admin_portail boolean not null default false,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);
comment on table public.portail_collaborateurs is 'Collaborateurs Hympyr ayant accès au portail. actif = false coupe tous les outils.';

create table if not exists public.portail_acces (
  user_id uuid not null references public.portail_collaborateurs(user_id) on delete cascade,
  outil_slug text not null references public.portail_outils(slug) on update cascade,
  role text not null,
  accorde_par uuid default auth.uid(),
  accorde_le timestamptz not null default now(),
  expire_le timestamptz,
  primary key (user_id, outil_slug)
);
comment on table public.portail_acces is 'Droits : un collaborateur, un outil, un rôle propre à l''outil. Source de vérité, recopiée dans les tables de membres historiques.';

-- Le pilotage communication connaît aussi le rôle « responsable »
update public.portail_outils set roles_possibles = '{responsable,direction,admin}' where slug = 'pilotage_communication';

-- ---------- contrôle du rôle ----------
create or replace function public.portail_acces_valider()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from portail_outils o where o.slug = new.outil_slug and new.role = any(o.roles_possibles)) then
    raise exception 'Rôle « % » inconnu pour l''outil « % »', new.role, new.outil_slug using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists portail_acces_valider on public.portail_acces;
create trigger portail_acces_valider before insert or update on public.portail_acces
  for each row execute function public.portail_acces_valider();

-- ---------- reprise de l'existant ----------
insert into public.portail_collaborateurs (user_id, email, prenom, admin_portail)
select u.id, lower(u.email),
  coalesce(
    (select f.nom from fificli_membres f where lower(f.email) = lower(u.email)),
    (select c.nom from comm_membres c where lower(c.email) = lower(u.email)),
    (select g.nom from granules_membres g where lower(g.email) = lower(u.email)),
    (select h.nom from charte_membres h where lower(h.email) = lower(u.email))),
  exists (select 1 from fificli_membres f where lower(f.email) = lower(u.email) and f.role = 'admin' and f.actif)
  or exists (select 1 from comm_membres c where lower(c.email) = lower(u.email) and c.role = 'admin' and c.actif)
  or exists (select 1 from charte_membres h where lower(h.email) = lower(u.email) and h.role = 'admin' and h.actif)
from auth.users u
where lower(u.email) in (
  select lower(email) from charte_membres union select lower(email) from comm_membres
  union select lower(email) from fificli_membres union select lower(email) from granules_membres)
on conflict (user_id) do nothing;

insert into public.portail_acces (user_id, outil_slug, role, accorde_par)
select c.user_id, x.slug, x.role, null
from public.portail_collaborateurs c
join (
  select lower(email) e, 'charte'::text slug, role from charte_membres where actif
  union all select lower(email), 'pilotage_communication', role from comm_membres where actif
  union all select lower(email), 'cockpit_appels', role from fificli_membres where actif
  union all select lower(email), 'cockpit_granules', 'membre' from granules_membres where actif
  -- outil local sans table historique : ouvert à chaque collaborateur repris
  union all select email, 'renommage_tournees', 'membre' from public.portail_collaborateurs
) x on x.e = c.email
on conflict (user_id, outil_slug) do nothing;

-- ---------- portail -> tables historiques ----------
create or replace function public.portail_sync_vers_ancien(p_user uuid, p_slug text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c record; a record; v_actif boolean; v_nom text;
begin
  select * into c from portail_collaborateurs where user_id = p_user;
  if not found then return; end if;
  select * into a from portail_acces where user_id = p_user and outil_slug = p_slug;
  v_actif := found and c.actif and (a.expire_le is null or a.expire_le > now());
  v_nom := coalesce(nullif(btrim(c.prenom), ''), nullif(btrim(c.nom), ''), split_part(c.email, '@', 1));

  if p_slug = 'charte' then
    if a.role is not null then
      insert into charte_membres (email, nom, role, actif) values (c.email, v_nom, a.role, v_actif)
      on conflict (email) do update set role = excluded.role, actif = excluded.actif;
    else update charte_membres set actif = false where lower(email) = c.email; end if;
  elsif p_slug = 'pilotage_communication' then
    if a.role is not null then
      insert into comm_membres (email, nom, role, actif) values (c.email, v_nom, a.role, v_actif)
      on conflict (email) do update set role = excluded.role, actif = excluded.actif;
    else update comm_membres set actif = false where lower(email) = c.email; end if;
  elsif p_slug = 'cockpit_appels' then
    -- nom = valeur « traité par » des fiches : jamais écrasé une fois créé
    if a.role is not null then
      insert into fificli_membres (email, nom, role, actif) values (c.email, v_nom, a.role, v_actif)
      on conflict (email) do update set role = excluded.role, actif = excluded.actif;
    else update fificli_membres set actif = false where lower(email) = c.email; end if;
  elsif p_slug = 'cockpit_granules' then
    if a.role is not null then
      insert into granules_membres (email, nom, actif) values (c.email, v_nom, v_actif)
      on conflict (email) do update set actif = excluded.actif;
    else update granules_membres set actif = false where lower(email) = c.email; end if;
  end if;
end $$;
revoke all on function public.portail_sync_vers_ancien(uuid, text) from public, anon, authenticated;

create or replace function public.portail_acces_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- modification venue d'une table historique
  if tg_op in ('UPDATE', 'DELETE') then perform portail_sync_vers_ancien(old.user_id, old.outil_slug); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform portail_sync_vers_ancien(new.user_id, new.outil_slug); end if;
  return null;
end $$;
drop trigger if exists portail_acces_sync on public.portail_acces;
create trigger portail_acces_sync after insert or update or delete on public.portail_acces
  for each row execute function public.portail_acces_sync();

create or replace function public.portail_collab_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for s in select outil_slug from portail_acces where user_id = new.user_id loop
    perform portail_sync_vers_ancien(new.user_id, s);
  end loop;
  return null;
end $$;
drop trigger if exists portail_collab_sync on public.portail_collaborateurs;
create trigger portail_collab_sync after update of actif on public.portail_collaborateurs
  for each row execute function public.portail_collab_sync();

-- ---------- tables historiques -> portail ----------
create or replace function public.portail_depuis_ancien()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_slug text := tg_argv[0];
  v_email text := lower(coalesce(case when tg_op = 'DELETE' then old.email else new.email end, ''));
  v_uid uuid; v_role text; v_actif boolean;
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- modification venue du portail
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then return null; end if;           -- pas encore de compte : repris à sa création
  if tg_op = 'DELETE' then
    delete from portail_acces where user_id = v_uid and outil_slug = v_slug; return null;
  end if;
  v_actif := new.actif;
  v_role := case when v_slug = 'cockpit_granules' then 'membre' else to_jsonb(new) ->> 'role' end;
  insert into portail_collaborateurs (user_id, email, prenom) values (v_uid, v_email, new.nom)
  on conflict (user_id) do nothing;
  if v_actif then
    insert into portail_acces (user_id, outil_slug, role, accorde_par) values (v_uid, v_slug, v_role, auth.uid())
    on conflict (user_id, outil_slug) do update set role = excluded.role;
  else
    delete from portail_acces where user_id = v_uid and outil_slug = v_slug;
  end if;
  return null;
end $$;
drop trigger if exists charte_vers_portail on public.charte_membres;
create trigger charte_vers_portail after insert or update or delete on public.charte_membres
  for each row execute function public.portail_depuis_ancien('charte');
drop trigger if exists comm_vers_portail on public.comm_membres;
create trigger comm_vers_portail after insert or update or delete on public.comm_membres
  for each row execute function public.portail_depuis_ancien('pilotage_communication');
drop trigger if exists fificli_vers_portail on public.fificli_membres;
create trigger fificli_vers_portail after insert or update or delete on public.fificli_membres
  for each row execute function public.portail_depuis_ancien('cockpit_appels');
drop trigger if exists granules_vers_portail on public.granules_membres;
create trigger granules_vers_portail after insert or update or delete on public.granules_membres
  for each row execute function public.portail_depuis_ancien('cockpit_granules');

-- ---------- expiration des accès temporaires (chaque nuit) ----------
create or replace function public.portail_appliquer_expirations()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select user_id, outil_slug from portail_acces where expire_le is not null and expire_le <= now() loop
    perform portail_sync_vers_ancien(r.user_id, r.outil_slug); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.portail_appliquer_expirations() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('portail-expirations', '15 2 * * *', 'select public.portail_appliquer_expirations()');
  end if;
end $$;

-- ---------- fonctions lues par le portail et, à terme, par les outils ----------
create or replace function public.portail_est_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from portail_collaborateurs where user_id = auth.uid() and admin_portail and actif);
$$;
revoke all on function public.portail_est_admin() from public, anon;
grant execute on function public.portail_est_admin() to authenticated;

create or replace function public.portail_role(p_outil text)
returns text language sql stable security definer set search_path = public as $$
  select a.role from portail_acces a
  join portail_collaborateurs c on c.user_id = a.user_id and c.actif
  where a.user_id = auth.uid() and a.outil_slug = p_outil and (a.expire_le is null or a.expire_le > now());
$$;
revoke all on function public.portail_role(text) from public, anon;
grant execute on function public.portail_role(text) to authenticated;

create or replace function public.portail_mes_outils()
returns table (slug text, nom text, description text, url text, marque text, pole text, role text)
language sql stable security definer set search_path = public as $$
  select o.slug, o.nom, o.description, o.url, o.marque, o.pole, a.role
  from portail_acces a
  join portail_collaborateurs c on c.user_id = a.user_id and c.actif
  join portail_outils o on o.slug = a.outil_slug and o.statut <> 'archive'
  where a.user_id = auth.uid() and (a.expire_le is null or a.expire_le > now())
  order by o.ordre;
$$;

create or replace function public.portail_moi()
returns table (email text, nom text)
language sql stable security definer set search_path = public as $$
  select c.email, coalesce(c.prenom, c.nom) from portail_collaborateurs c where c.user_id = auth.uid();
$$;

-- ---------- droits (RLS) ----------
alter table public.portail_collaborateurs enable row level security;
alter table public.portail_acces enable row level security;
revoke all on public.portail_collaborateurs, public.portail_acces from anon;
grant select, insert, update, delete on public.portail_collaborateurs, public.portail_acces to authenticated;

create policy collab_lecture on public.portail_collaborateurs for select to authenticated
  using (user_id = auth.uid() or public.portail_est_admin());
create policy collab_admin on public.portail_collaborateurs for all to authenticated
  using (public.portail_est_admin()) with check (public.portail_est_admin());
create policy acces_lecture on public.portail_acces for select to authenticated
  using (user_id = auth.uid() or public.portail_est_admin());
create policy acces_admin on public.portail_acces for all to authenticated
  using (public.portail_est_admin()) with check (public.portail_est_admin());

-- l'administrateur lit tout le journal (mesure d'adoption) et traite les tickets
create policy portail_journal_admin on public.portail_journal for select to authenticated using (public.portail_est_admin());
create policy portail_tickets_admin_lecture on public.portail_tickets for select to authenticated using (public.portail_est_admin());
grant update (statut) on public.portail_tickets to authenticated;
create policy portail_tickets_admin_statut on public.portail_tickets for update to authenticated
  using (public.portail_est_admin()) with check (public.portail_est_admin());
