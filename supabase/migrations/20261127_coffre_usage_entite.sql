-- =====================================================================
-- Portail Hympyr · coffre « Mots de passe du Groupe » : colonnes Usage et Entité
-- Fichier 17_coffre_usage_entite.sql. Prérequis : 16_coffre_mots_de_passe.sql. Tout ou rien.
--
-- L'usage et l'entité (Hympyr Energies, Granulés, Transport) sont chiffrés avec le reste de la ligne :
-- la base ne les voit pas. Ce script permet seulement à l'historique d'indiquer qu'ils ont changé
-- (« Champs modifiés : usage, entité »), sans jamais en écrire la valeur.
-- =====================================================================
begin;

create or replace function public.portail_coffre_enregistrer(p_id uuid, p_version int, p_iv text, p_chiffre text, p_champs text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_champs text[] := (select coalesce(array_agg(distinct c order by c), '{}') from unnest(p_champs) c
                      where c in ('entite', 'usage', 'identifiant', 'mot_de_passe', 'url'));
  v_existe boolean;
begin
  perform portail_coffre_garde();
  select version into v_version from portail_coffre_cle for share;
  if v_version is null then raise exception 'Le coffre n''est pas encore créé.' using errcode = 'P0002'; end if;
  if p_version is distinct from v_version then
    raise exception 'La phrase secrète du coffre a changé : verrouillez puis déverrouillez le coffre.' using errcode = '40001';
  end if;
  select true into v_existe from portail_coffre_entrees where id = p_id for update;
  if coalesce(v_existe, false) then
    update portail_coffre_entrees set version = p_version, iv = p_iv, chiffre = p_chiffre, maj_le = now(), maj_par = auth.uid()
    where id = p_id;
    perform portail_tracer(
      case when 'mot_de_passe' = any(v_champs) then 'coffre_mot_de_passe_modifie' else 'coffre_entree_modifiee' end,
      null, jsonb_build_object('entree', p_id, 'champs', to_jsonb(v_champs)));
  else
    insert into portail_coffre_entrees (id, version, iv, chiffre, cree_par, maj_par)
    values (p_id, p_version, p_iv, p_chiffre, auth.uid(), auth.uid());
    perform portail_tracer('coffre_entree_ajoutee', null, jsonb_build_object('entree', p_id));
  end if;
end $$;
revoke all on function public.portail_coffre_enregistrer(uuid, int, text, text, text[]) from public, anon;
grant execute on function public.portail_coffre_enregistrer(uuid, int, text, text, text[]) to authenticated;

commit;
