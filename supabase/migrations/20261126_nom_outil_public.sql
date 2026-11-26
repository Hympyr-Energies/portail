-- =====================================================================
-- Portail Hympyr · chaque outil affiche le nom choisi dans l'administration
-- Fonction en lecture seule, appelable sans connexion (écran de connexion, renommage tournées) :
-- elle ne renvoie QUE le nom affiché d'un outil actif, rien d'autre (ni adresse, ni droits).
-- À exécuter une fois dans Supabase > SQL Editor, après 9_renommer_outils.sql.
-- =====================================================================
begin;

create or replace function public.portail_nom_outil(p_slug text)
returns text language sql stable security definer set search_path = public as $$
  select nom from portail_outils where slug = p_slug and statut <> 'archive';
$$;
revoke all on function public.portail_nom_outil(text) from public;
grant execute on function public.portail_nom_outil(text) to anon, authenticated;

commit;

-- Vérification : doit renvoyer le nom actuel du cockpit appels
select public.portail_nom_outil('cockpit_appels');
