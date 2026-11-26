-- =====================================================================
-- Portail Hympyr · renommer les outils depuis l'écran d'administration
-- Un administrateur du portail peut modifier le NOM et la DESCRIPTION affichés.
-- L'identifiant (slug), l'adresse, les rôles et l'ordre restent intouchables depuis le navigateur.
-- À exécuter une fois dans Supabase > SQL Editor. Tout ou rien.
-- =====================================================================
begin;

-- 1. Garde-fous sur les libellés (vide interdit, longueur raisonnable pour les cartes)
alter table public.portail_outils drop constraint if exists portail_outils_nom_longueur;
alter table public.portail_outils add constraint portail_outils_nom_longueur
  check (char_length(btrim(nom)) between 2 and 40) not valid;
alter table public.portail_outils validate constraint portail_outils_nom_longueur;
alter table public.portail_outils drop constraint if exists portail_outils_description_longueur;
alter table public.portail_outils add constraint portail_outils_description_longueur
  check (description is null or char_length(description) <= 160) not valid;
alter table public.portail_outils validate constraint portail_outils_description_longueur;

-- 2. Droits : lecture pour tous les connectés (inchangé), écriture limitée à deux colonnes
revoke insert, update, delete, truncate on public.portail_outils from anon, authenticated;
grant update (nom, description) on public.portail_outils to authenticated;

-- ... et uniquement pour un administrateur actif du portail (RLS)
drop policy if exists portail_outils_renommer on public.portail_outils;
create policy portail_outils_renommer on public.portail_outils for update to authenticated
  using (public.portail_est_admin()) with check (public.portail_est_admin());

-- 3. Traçabilité : chaque renommage est écrit dans le journal d'administration
alter table public.portail_admin_journal drop constraint if exists portail_admin_journal_action_check;
alter table public.portail_admin_journal add constraint portail_admin_journal_action_check
  check (action in ('creer', 'supprimer', 'mot_de_passe', 'renommer_outil'));

create or replace function public.portail_outils_journal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nom := btrim(new.nom);
  new.description := nullif(btrim(new.description), '');
  if new.nom is distinct from old.nom or new.description is distinct from old.description then
    insert into portail_admin_journal (par, par_email, action, cible_email, detail)
    values (auth.uid(), (select lower(email) from auth.users where id = auth.uid()), 'renommer_outil', null,
            jsonb_build_object('slug', old.slug,
                               'nom_avant', old.nom, 'nom_apres', new.nom,
                               'description_avant', old.description, 'description_apres', new.description));
  end if;
  return new;
end $$;
revoke all on function public.portail_outils_journal() from public, anon, authenticated;
drop trigger if exists portail_outils_journal on public.portail_outils;
create trigger portail_outils_journal before update on public.portail_outils
  for each row execute function public.portail_outils_journal();

commit;

-- Vérification (lecture seule) : les deux lignes doivent apparaître
select policyname, cmd from pg_policies where tablename = 'portail_outils' order by policyname;
