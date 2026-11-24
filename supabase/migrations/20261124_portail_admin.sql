-- =====================================================================
-- Portail Hympyr · écran d'administration des accès
-- À exécuter une fois dans Supabase > SQL Editor. Tout ou rien.
-- =====================================================================
begin;

-- Comptes Supabase Auth, lus par l'écran d'administration uniquement.
-- Sert à rattacher au portail un compte invité depuis Authentication > Users,
-- et à afficher la dernière connexion (mesure d'adoption).
create or replace function public.portail_admin_comptes()
returns table (user_id uuid, email text, cree_le timestamptz, derniere_connexion timestamptz, confirme boolean)
language sql stable security definer set search_path = public as $$
  select u.id, lower(u.email), u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null
  from auth.users u
  where public.portail_est_admin()
  order by lower(u.email);
$$;
revoke all on function public.portail_admin_comptes() from public, anon;
grant execute on function public.portail_admin_comptes() to authenticated;

-- Garde-fou : il reste toujours au moins un administrateur actif du portail
create or replace function public.portail_garder_un_admin()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.admin_portail and old.actif)
     or (tg_op = 'UPDATE' and old.admin_portail and old.actif and not (new.admin_portail and new.actif)) then
    if not exists (select 1 from portail_collaborateurs
                   where admin_portail and actif and user_id <> old.user_id) then
      raise exception 'Il doit rester au moins un administrateur actif du portail.' using errcode = '22023';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists portail_garder_un_admin on public.portail_collaborateurs;
create trigger portail_garder_un_admin before update or delete on public.portail_collaborateurs
  for each row execute function public.portail_garder_un_admin();

-- On désactive un collaborateur, on ne le supprime pas : la suppression en cascade
-- ne se propagerait pas aux tables de membres historiques.
revoke delete on public.portail_collaborateurs from authenticated;

commit;
