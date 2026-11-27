-- =====================================================================
-- Portail Hympyr · Administration > Mots de passe du Groupe (coffre chiffré de bout en bout)
-- Fichier 16_coffre_mots_de_passe.sql. Prérequis : 15_historique_actions.sql.
-- À exécuter une fois dans Supabase > SQL Editor. Tout ou rien.
--
-- Principe (chiffrement de bout en bout) :
--   - La phrase secrète du coffre ne quitte jamais le navigateur : elle n'est ni envoyée, ni stockée.
--   - Le navigateur en dérive une clé AES-GCM 256 bits (PBKDF2-SHA256, 600 000 itérations minimum,
--     sel aléatoire) et chiffre chaque ligne (identifiant, mot de passe, URL) avant l'envoi.
--   - La base ne reçoit et ne rend que du chiffré illisible, et seulement à un administrateur actif.
--   - Les tables n'ont aucun droit direct : tout passe par les fonctions ci-dessous, qui écrivent
--     chacune une trace dans l'historique des actions (sans aucun secret).
-- Conséquence assumée : phrase secrète perdue = coffre illisible, personne ne peut la récupérer.
-- =====================================================================
begin;

-- ---------- tables ----------
create table if not exists public.portail_coffre_cle (
  id smallint primary key default 1 check (id = 1),         -- une seule ligne
  version int not null default 1,                            -- +1 à chaque changement de phrase secrète
  kdf text not null default 'PBKDF2-SHA256' check (kdf = 'PBKDF2-SHA256'),
  iterations int not null check (iterations between 600000 and 10000000),
  sel text not null check (char_length(sel) between 16 and 64),          -- base64
  verif_iv text not null check (char_length(verif_iv) between 12 and 32), -- témoin chiffré : vérifie la phrase
  verif text not null check (char_length(verif) between 16 and 256),
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  maj_par uuid
);
comment on table public.portail_coffre_cle is 'Paramètres publics de dérivation de la clé du coffre. Ne contient ni la phrase secrète ni la clé.';

create table if not exists public.portail_coffre_entrees (
  id uuid primary key,                       -- tiré par le navigateur : il sert aussi de donnée authentifiée (AAD)
  version int not null,                      -- version de clé utilisée
  iv text not null check (char_length(iv) between 12 and 32),
  chiffre text not null check (char_length(chiffre) between 16 and 20000),
  cree_le timestamptz not null default now(),
  cree_par uuid,
  maj_le timestamptz not null default now(),
  maj_par uuid
);
comment on table public.portail_coffre_entrees is 'Mots de passe du Groupe : chaque ligne est chiffrée dans le navigateur (AES-GCM). La base ne voit que du chiffré.';

alter table public.portail_coffre_cle enable row level security;
alter table public.portail_coffre_entrees enable row level security;
-- aucun accès direct, ni lecture ni écriture : uniquement via les fonctions ci-dessous
revoke all on public.portail_coffre_cle, public.portail_coffre_entrees from public, anon, authenticated;

-- ---------- garde commune ----------
create or replace function public.portail_coffre_garde()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.portail_est_admin() then
    raise exception 'Réservé aux administrateurs du portail.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.portail_coffre_garde() from public, anon, authenticated;

-- ---------- état (sans trace : sert à afficher « créer » ou « déverrouiller ») ----------
create or replace function public.portail_coffre_etat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform portail_coffre_garde();
  return jsonb_build_object(
    'initialise', exists (select 1 from portail_coffre_cle),
    'entrees', (select count(*) from portail_coffre_entrees),
    'maj_le', (select maj_le from portail_coffre_cle));
end $$;
revoke all on function public.portail_coffre_etat() from public, anon;
grant execute on function public.portail_coffre_etat() to authenticated;

-- ---------- création du coffre (une seule fois) ----------
create or replace function public.portail_coffre_initialiser(p_iterations int, p_sel text, p_verif_iv text, p_verif text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform portail_coffre_garde();
  lock table portail_coffre_cle in exclusive mode;
  if exists (select 1 from portail_coffre_cle) then
    raise exception 'Le coffre existe déjà.' using errcode = '23505';
  end if;
  insert into portail_coffre_cle (iterations, sel, verif_iv, verif, maj_par)
  values (p_iterations, p_sel, p_verif_iv, p_verif, auth.uid());
  perform portail_tracer('coffre_cree', null, jsonb_build_object('iterations', p_iterations));
end $$;
revoke all on function public.portail_coffre_initialiser(int, text, text, text) from public, anon;
grant execute on function public.portail_coffre_initialiser(int, text, text, text) to authenticated;

-- ---------- lecture du coffre chiffré (tracée côté serveur, à chaque fois) ----------
create or replace function public.portail_coffre_lire()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform portail_coffre_garde();
  select jsonb_build_object(
    'cle', (select jsonb_build_object('version', version, 'kdf', kdf, 'iterations', iterations,
                                      'sel', sel, 'verif_iv', verif_iv, 'verif', verif) from portail_coffre_cle),
    'entrees', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'version', version, 'iv', iv, 'chiffre', chiffre,
                                                             'cree_le', cree_le, 'maj_le', maj_le) order by cree_le, id)
                         from portail_coffre_entrees), '[]'::jsonb))
  into v;
  if v -> 'cle' is not null and v -> 'cle' <> 'null'::jsonb then
    perform portail_tracer('coffre_lecture', null, jsonb_build_object('entrees', jsonb_array_length(v -> 'entrees')));
  end if;
  return v;
end $$;
revoke all on function public.portail_coffre_lire() from public, anon;
grant execute on function public.portail_coffre_lire() to authenticated;

-- ---------- ajout ou modification d'une ligne ----------
-- p_champs : noms des champs modifiés (identifiant, mot_de_passe, url), déclarés par le navigateur
-- qui seul voit le clair. Sert uniquement à rendre l'historique lisible ; aucune valeur n'y figure.
create or replace function public.portail_coffre_enregistrer(p_id uuid, p_version int, p_iv text, p_chiffre text, p_champs text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_champs text[] := (select coalesce(array_agg(distinct c order by c), '{}') from unnest(p_champs) c
                      where c in ('identifiant', 'mot_de_passe', 'url'));
  v_existe boolean;
begin
  perform portail_coffre_garde();
  select version into v_version from portail_coffre_cle for share;
  if v_version is null then raise exception 'Le coffre n''est pas encore créé.' using errcode = 'P0002'; end if;
  -- une clé périmée (phrase changée entre-temps par un autre administrateur) rendrait la ligne illisible
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

-- ---------- suppression d'une ligne ----------
create or replace function public.portail_coffre_supprimer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform portail_coffre_garde();
  delete from portail_coffre_entrees where id = p_id;
  if not found then raise exception 'Ligne introuvable.' using errcode = 'P0002'; end if;
  perform portail_tracer('coffre_entree_supprimee', null, jsonb_build_object('entree', p_id));
end $$;
revoke all on function public.portail_coffre_supprimer(uuid) from public, anon;
grant execute on function public.portail_coffre_supprimer(uuid) to authenticated;

-- ---------- changement de la phrase secrète : nouveau sel, nouvelle clé, tout est rechiffré ----------
-- p_entrees : [{ "id": uuid, "iv": text, "chiffre": text }, …] — exactement les lignes actuelles, toutes rechiffrées.
create or replace function public.portail_coffre_changer_phrase(p_version int, p_iterations int, p_sel text,
                                                               p_verif_iv text, p_verif text, p_entrees jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_version int; v_n int; v_ok int;
begin
  perform portail_coffre_garde();
  select version into v_version from portail_coffre_cle for update;   -- bloque les écritures concurrentes
  if v_version is null then raise exception 'Le coffre n''est pas encore créé.' using errcode = 'P0002'; end if;
  if p_version is distinct from v_version then
    raise exception 'La phrase secrète a déjà été changée par un autre administrateur.' using errcode = '40001';
  end if;
  lock table portail_coffre_entrees in exclusive mode;
  select count(*) into v_n from portail_coffre_entrees;
  -- toutes les lignes, ni plus ni moins : sinon une ligne resterait chiffrée avec l'ancienne clé
  select count(*) into v_ok
  from jsonb_to_recordset(p_entrees) x(id uuid, iv text, chiffre text)
  join portail_coffre_entrees e on e.id = x.id;
  if v_ok <> v_n or jsonb_array_length(p_entrees) <> v_n then
    raise exception 'Rechiffrement incomplet : rechargez le coffre puis recommencez.' using errcode = '40001';
  end if;
  update portail_coffre_entrees e set version = v_version + 1, iv = x.iv, chiffre = x.chiffre, maj_le = now(), maj_par = auth.uid()
  from jsonb_to_recordset(p_entrees) x(id uuid, iv text, chiffre text) where e.id = x.id;
  update portail_coffre_cle set version = v_version + 1, iterations = p_iterations, sel = p_sel,
         verif_iv = p_verif_iv, verif = p_verif, maj_le = now(), maj_par = auth.uid();
  perform portail_tracer('coffre_phrase_changee', null,
    jsonb_build_object('entrees_rechiffrees', v_n, 'iterations', p_iterations),
    jsonb_build_object('version', v_version), jsonb_build_object('version', v_version + 1));
  return v_version + 1;
end $$;
revoke all on function public.portail_coffre_changer_phrase(int, int, text, text, text, jsonb) from public, anon;
grant execute on function public.portail_coffre_changer_phrase(int, int, text, text, text, jsonb) to authenticated;

-- ---------- événements vus seulement par le navigateur (déverrouillage, affichage, copie) ----------
create or replace function public.portail_coffre_tracer(p_action text, p_entree uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform portail_coffre_garde();
  if p_action not in ('coffre_deverrouille', 'coffre_echec_phrase', 'coffre_verrouille',
                      'coffre_mot_de_passe_affiche', 'coffre_mot_de_passe_copie', 'coffre_identifiant_copie') then
    raise exception 'Action inconnue.' using errcode = '22023';
  end if;
  if p_entree is not null and not exists (select 1 from portail_coffre_entrees where id = p_entree) then
    raise exception 'Ligne introuvable.' using errcode = 'P0002';
  end if;
  perform portail_tracer(p_action, null, jsonb_build_object('entree', p_entree));
end $$;
revoke all on function public.portail_coffre_tracer(text, uuid) from public, anon;
grant execute on function public.portail_coffre_tracer(text, uuid) to authenticated;

commit;

-- Vérification (lecture seule) : 7 fonctions
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'portail_coffre_%' order by 1;
