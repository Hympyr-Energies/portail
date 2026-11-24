-- =====================================================================
-- Portail Hympyr · gestion complète des comptes depuis la console d'administration
-- (création, suppression, mot de passe temporaire). Les actions sensibles passent
-- par la fonction Edge « portail-admin » ; ce script prépare la base.
-- À exécuter une fois dans Supabase > SQL Editor. Tout ou rien.
-- =====================================================================
begin;

-- Mot de passe temporaire posé par un administrateur : à changer à la prochaine connexion
alter table public.portail_collaborateurs add column if not exists mdp_a_changer boolean not null default false;

create or replace function public.portail_mdp_a_changer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select mdp_a_changer from portail_collaborateurs where user_id = auth.uid()), false);
$$;
revoke all on function public.portail_mdp_a_changer() from public, anon;
grant execute on function public.portail_mdp_a_changer() to authenticated;

-- appelée par le portail juste après que la personne a choisi son propre mot de passe
create or replace function public.portail_mdp_change()
returns void language sql security definer set search_path = public as $$
  update portail_collaborateurs set mdp_a_changer = false where user_id = auth.uid();
$$;
revoke all on function public.portail_mdp_change() from public, anon;
grant execute on function public.portail_mdp_change() to authenticated;

-- Traçabilité des actions d'administration (qui a créé, supprimé, changé quel mot de passe)
create table if not exists public.portail_admin_journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  par uuid,
  par_email text,
  action text not null check (action in ('creer', 'supprimer', 'mot_de_passe')),
  cible_email text,
  detail jsonb
);
alter table public.portail_admin_journal enable row level security;
revoke all on public.portail_admin_journal from anon, authenticated;
grant select on public.portail_admin_journal to authenticated;
drop policy if exists admin_journal_lecture on public.portail_admin_journal;
create policy admin_journal_lecture on public.portail_admin_journal for select to authenticated
  using (public.portail_est_admin());
-- écriture : uniquement par la fonction Edge (clé serveur)

commit;
