-- =====================================================================
-- Portail Hympyr · Administration > Historique des actions
-- Fichier 15_historique_actions.sql. À exécuter une fois dans Supabase > SQL Editor. Tout ou rien.
--
-- Principe :
--   - portail_admin_journal devient un journal en ajout seul : aucune modification, aucune suppression,
--     aucun vidage (TRUNCATE) possible, ni pour un administrateur, ni pour la clé serveur.
--   - Les lignes sont écrites par la base elle-même (triggers sur les tables de droits), jamais par le
--     navigateur : un administrateur ne peut ni oublier ni maquiller une trace.
--   - L'heure et l'auteur sont posés par le serveur (now(), auth.uid()), jamais repris de la requête.
--   - Aucun secret dans le journal : ni mot de passe, ni contenu du coffre.
-- Limite connue : le propriétaire de la base (mot de passe postgres, accès SQL Editor) peut toujours
--   retirer ces triggers. C'est inhérent à Postgres ; l'export CSV régulier de l'historique sert de témoin.
-- =====================================================================
begin;

-- ---------- 1. structure ----------
alter table public.portail_admin_journal
  add column if not exists origine text,   -- portail · outil (écran d'un outil) · serveur (fonction portail-admin) · sql
  add column if not exists avant jsonb,    -- valeurs avant (jamais de secret)
  add column if not exists apres jsonb;    -- valeurs après (jamais de secret)
alter table public.portail_admin_journal alter column le set default now();

-- la liste fermée d'actions bloquait toute nouvelle trace : on garde seulement un format propre
alter table public.portail_admin_journal drop constraint if exists portail_admin_journal_action_check;
alter table public.portail_admin_journal add constraint portail_admin_journal_action_check
  check (action ~ '^[a-z_]{3,40}$');

create index if not exists portail_admin_journal_le on public.portail_admin_journal (le desc, id desc);

-- ---------- 2. horodatage et auteur posés par le serveur ----------
create or replace function public.portail_admin_journal_estampiller()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_acteur text;
begin
  new.le := now();
  if auth.uid() is not null then
    -- appel depuis le navigateur ou depuis l'écran d'un outil : l'auteur est la session, point
    new.par := auth.uid();
    new.origine := coalesce(new.origine, 'portail');
  elsif auth.role() = 'service_role' then
    -- fonction Edge portail-admin : elle transmet l'administrateur vérifié dans l'en-tête x-hym-acteur
    begin
      v_acteur := nullif(current_setting('request.headers', true), '')::json ->> 'x-hym-acteur';
    exception when others then v_acteur := null; end;
    if new.par is null and v_acteur ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      new.par := v_acteur::uuid;
    end if;
    new.origine := 'serveur';
  else
    new.origine := 'sql';  -- SQL Editor ou tâche interne
  end if;
  if new.par is not null then
    new.par_email := coalesce((select lower(email) from auth.users where id = new.par), new.par_email);
  end if;
  return new;
end $$;
revoke all on function public.portail_admin_journal_estampiller() from public, anon, authenticated;
drop trigger if exists portail_admin_journal_estampiller on public.portail_admin_journal;
create trigger portail_admin_journal_estampiller before insert on public.portail_admin_journal
  for each row execute function public.portail_admin_journal_estampiller();

-- ---------- 3. ajout seul : ni modification, ni suppression, ni vidage ----------
create or replace function public.portail_admin_journal_immuable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Historique des actions : les traces ne peuvent être ni modifiées ni supprimées.'
    using errcode = '42501';
end $$;
revoke all on function public.portail_admin_journal_immuable() from public, anon, authenticated;
drop trigger if exists portail_admin_journal_immuable on public.portail_admin_journal;
create trigger portail_admin_journal_immuable before update or delete on public.portail_admin_journal
  for each row execute function public.portail_admin_journal_immuable();
drop trigger if exists portail_admin_journal_immuable_truncate on public.portail_admin_journal;
create trigger portail_admin_journal_immuable_truncate before truncate on public.portail_admin_journal
  for each statement execute function public.portail_admin_journal_immuable();

-- droits : lecture pour les administrateurs (RLS déjà en place), écriture serveur uniquement
revoke all on public.portail_admin_journal from public, anon, authenticated;
grant select on public.portail_admin_journal to authenticated;
revoke update, delete, truncate, references, trigger on public.portail_admin_journal from service_role;
grant select, insert on public.portail_admin_journal to service_role;

-- ---------- 4. écriture commune (fonction interne, jamais appelable depuis le navigateur) ----------
create or replace function public.portail_tracer(p_action text, p_cible_email text, p_detail jsonb,
                                                p_avant jsonb default null, p_apres jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into portail_admin_journal (action, cible_email, detail, avant, apres, origine)
  values (p_action, p_cible_email, nullif(jsonb_strip_nulls(coalesce(p_detail, '{}'::jsonb)), '{}'::jsonb),
          p_avant, p_apres,
          -- trigger déclenché par la synchronisation d'une table de membres d'outil
          case when pg_trigger_depth() > 1 and auth.uid() is not null then 'outil' end);
end $$;
revoke all on function public.portail_tracer(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ne garder que les champs qui ont changé
create or replace function public.portail_diff(a jsonb, b jsonb, champs text[])
returns jsonb[] language sql immutable as $$
  select array[
    coalesce((select jsonb_object_agg(k, a -> k) from unnest(champs) k where a -> k is distinct from b -> k), '{}'::jsonb),
    coalesce((select jsonb_object_agg(k, b -> k) from unnest(champs) k where a -> k is distinct from b -> k), '{}'::jsonb)];
$$;

-- ---------- 5. collaborateurs : ajout, profil, actif, administrateur, suppression ----------
create or replace function public.portail_collab_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'mdp_a_changer' end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'mdp_a_changer' end;
  d jsonb[];
begin
  if tg_op = 'INSERT' then
    perform portail_tracer('collaborateur_ajoute', new.email, null, null,
      jsonb_strip_nulls(jsonb_build_object('prenom', new.prenom, 'nom', new.nom, 'pole', new.pole,
                                           'actif', new.actif, 'admin_portail', new.admin_portail)));
    if new.admin_portail then perform portail_tracer('admin_accorde', new.email, null); end if;
  elsif tg_op = 'DELETE' then
    perform portail_tracer('collaborateur_supprime', old.email, null,
      jsonb_strip_nulls(jsonb_build_object('prenom', old.prenom, 'nom', old.nom, 'pole', old.pole,
                                           'admin_portail', old.admin_portail)), null);
  else
    d := portail_diff(o, n, array['prenom', 'nom', 'pole', 'email']);
    if d[1] <> '{}'::jsonb then perform portail_tracer('profil_modifie', new.email, null, d[1], d[2]); end if;
    if old.admin_portail is distinct from new.admin_portail then
      perform portail_tracer(case when new.admin_portail then 'admin_accorde' else 'admin_retire' end, new.email, null);
    end if;
    if old.actif is distinct from new.actif then
      perform portail_tracer(case when new.actif then 'compte_reactive' else 'compte_desactive' end, new.email, null);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.portail_collab_journal() from public, anon, authenticated;
drop trigger if exists portail_collab_journal on public.portail_collaborateurs;
create trigger portail_collab_journal after insert or update or delete on public.portail_collaborateurs
  for each row execute function public.portail_collab_journal();

-- ---------- 6. droits d'accès aux outils ----------
create or replace function public.portail_acces_journal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record := case when tg_op = 'DELETE' then old else new end;
  v_email text := (select email from portail_collaborateurs where user_id = r.user_id);
begin
  if tg_op = 'INSERT' then
    perform portail_tracer('acces_ajoute', v_email, jsonb_build_object('outil', new.outil_slug), null,
      jsonb_strip_nulls(jsonb_build_object('role', new.role, 'expire_le', new.expire_le)));
  elsif tg_op = 'DELETE' then
    perform portail_tracer('acces_retire', v_email, jsonb_build_object('outil', old.outil_slug),
      jsonb_strip_nulls(jsonb_build_object('role', old.role, 'expire_le', old.expire_le)), null);
  elsif old.role is distinct from new.role or old.expire_le is distinct from new.expire_le then
    perform portail_tracer('acces_modifie', v_email, jsonb_build_object('outil', new.outil_slug),
      jsonb_build_object('role', old.role, 'expire_le', old.expire_le),
      jsonb_build_object('role', new.role, 'expire_le', new.expire_le));
  end if;
  return null;
end $$;
revoke all on function public.portail_acces_journal() from public, anon, authenticated;
drop trigger if exists portail_acces_journal on public.portail_acces;
create trigger portail_acces_journal after insert or update or delete on public.portail_acces
  for each row execute function public.portail_acces_journal();

-- ---------- 7. renommage d'un outil : mêmes colonnes avant / après que le reste ----------
create or replace function public.portail_outils_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nom := btrim(new.nom);
  new.description := nullif(btrim(new.description), '');
  if new.nom is distinct from old.nom or new.description is distinct from old.description then
    perform portail_tracer('renommer_outil', null, jsonb_build_object('outil', old.slug),
      jsonb_build_object('nom', old.nom, 'description', old.description),
      jsonb_build_object('nom', new.nom, 'description', new.description));
  end if;
  return new;
end $$;
revoke all on function public.portail_outils_journal() from public, anon, authenticated;

commit;

-- Vérification (lecture seule) : 3 triggers sur le journal, 1 sur collaborateurs, 1 sur accès
select tgrelid::regclass as table_, tgname from pg_trigger
where not tgisinternal and tgname in ('portail_admin_journal_estampiller', 'portail_admin_journal_immuable',
  'portail_admin_journal_immuable_truncate', 'portail_collab_journal', 'portail_acces_journal')
order by 1, 2;
