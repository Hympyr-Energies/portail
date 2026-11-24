-- =====================================================================
-- Portail Hympyr · rattachement automatique d'un compte au portail
-- Cas réel du 24/11 : un compte supprimé puis recréé dans Authentication perd ses droits
-- (la suppression efface ses lignes du portail ; les tables de membres des outils, elles, restent).
-- Ce script : 1) rattache tout compte orphelin à partir des tables de membres des outils,
--             2) le fait désormais automatiquement à la création d'un compte.
-- À exécuter une fois dans Supabase > SQL Editor. Tout ou rien.
-- =====================================================================
begin;

create or replace function public.portail_rattacher(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is null then return; end if;
  if not exists (
    select 1 from charte_membres where lower(email) = v_email union all
    select 1 from comm_membres where lower(email) = v_email union all
    select 1 from fificli_membres where lower(email) = v_email union all
    select 1 from granules_membres where lower(email) = v_email) then
    return;  -- inconnu des outils : l'administrateur l'ajoute depuis l'écran d'administration
  end if;

  insert into portail_collaborateurs (user_id, email, prenom, admin_portail)
  values (p_user, v_email,
    coalesce((select nom from fificli_membres where lower(email) = v_email limit 1),
             (select nom from comm_membres where lower(email) = v_email limit 1),
             (select nom from granules_membres where lower(email) = v_email limit 1),
             (select nom from charte_membres where lower(email) = v_email limit 1)),
    exists (select 1 from fificli_membres where lower(email) = v_email and role = 'admin' and actif)
    or exists (select 1 from comm_membres where lower(email) = v_email and role = 'admin' and actif)
    or exists (select 1 from charte_membres where lower(email) = v_email and role = 'admin' and actif))
  on conflict do nothing;  -- conflit sur user_id ou sur l'adresse e-mail : on ne touche à rien

  if not exists (select 1 from portail_collaborateurs where user_id = p_user) then return; end if;

  -- pg_trigger_depth() > 1 ici quand on est appelé par trigger : la recopie vers les outils est sautée,
  -- ce qui est voulu (les droits viennent justement des tables des outils)
  insert into portail_acces (user_id, outil_slug, role, accorde_par)
  select p_user, x.slug, x.role, null from (
    select 'charte'::text slug, role from charte_membres where lower(email) = v_email and actif
    union all select 'pilotage_communication', role from comm_membres where lower(email) = v_email and actif
    union all select 'cockpit_appels', role from fificli_membres where lower(email) = v_email and actif
    union all select 'cockpit_granules', 'membre' from granules_membres where lower(email) = v_email and actif
    union all select 'renommage_tournees', 'membre') x
  on conflict (user_id, outil_slug) do nothing;
end $$;
revoke all on function public.portail_rattacher(uuid) from public, anon, authenticated;

create or replace function public.portail_compte_cree()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.portail_rattacher(new.id);
  return null;
exception when others then
  return null;  -- ne jamais bloquer la création d'un compte
end $$;
revoke all on function public.portail_compte_cree() from public, anon, authenticated;

drop trigger if exists portail_compte_cree on auth.users;
create trigger portail_compte_cree after insert on auth.users
  for each row execute function public.portail_compte_cree();

-- rattrapage des comptes orphelins existants
select public.portail_rattacher(u.id) from auth.users u
where not exists (select 1 from public.portail_collaborateurs c where c.user_id = u.id);

commit;
