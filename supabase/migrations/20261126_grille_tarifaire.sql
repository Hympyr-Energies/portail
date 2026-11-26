-- =====================================================================
-- Portail Hympyr · nouvel outil « Grille tarifaire » (fioul et GNR)
--
-- À coller dans Supabase > SQL Editor, puis Run. Tout ou rien : en cas d'erreur, rien n'est appliqué.
-- Rejouable : relancer le script ne supprime ni les grilles ni l'historique.
--
-- Ce que fait le script :
--   1. Déclare l'outil dans le portail (tuile, renommage, tickets) avec deux rôles : lecteur, admin.
--   2. Donne l'accès administrateur à quentin.d@hympyr.fr, seul utilisateur autorisé pour l'instant.
--   3. Crée les tables de l'outil :
--        gt_parametres  mode de calcul en vigueur (une seule ligne) ;
--        gt_grilles     chaque grille enregistrée, archivée telle quelle (jamais modifiée ni supprimée) ;
--        gt_journal     historique horodaté de chaque action (grille, mode de calcul, accès, e-mail).
--   4. Le calcul est fait par la base (gt_calculer) : le navigateur n'envoie que les deux prix de référence,
--      le montant TICPE et la période. Personne ne peut enregistrer un prix « à la main ».
--   5. Droits : lecture pour les rôles lecteur et admin ; écriture uniquement par les fonctions
--      gt_enregistrer_grille et gt_enregistrer_formules, réservées au rôle admin de l'outil.
--   6. Envoi automatique du PDF par e-mail : reporté (décision du 26/11/2026). Les colonnes envoi_* et
--      l'action « envoi_email » sont prêtes pour la fonction Edge gt-envoi, qui n'est pas déployée.
-- =====================================================================
begin;

-- ---------- 1. l'outil dans le portail ----------
insert into public.portail_outils (slug, nom, description, url, marque, pole, roles_possibles, statut, ordre)
values ('grille_tarifaire', 'Grille tarifaire',
        'Calcul, diffusion et archivage de la grille tarifaire fioul et GNR.',
        'https://hympyr-energies.github.io/hym_grille_tarifaire/', 'energies', 'commercial',
        '{lecteur,admin}', 'actif', 60)
on conflict (slug) do update set url = excluded.url, roles_possibles = excluded.roles_possibles;
-- (le nom et la description ne sont pas écrasés : ils se changent dans Administration > Outils)

-- ---------- 2. tables ----------
create table if not exists public.gt_parametres (
  id int primary key default 1 check (id = 1),
  formules jsonb not null,
  tva numeric(5,2) not null default 20 check (tva >= 0 and tva < 100),
  maj_le timestamptz not null default now(),
  maj_par_email text
);
comment on table public.gt_parametres is 'Grille tarifaire : mode de calcul en vigueur (une seule ligne). Modifié par gt_enregistrer_formules().';

create table if not exists public.gt_grilles (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  cree_par uuid,
  cree_par_email text not null,
  prfod_ttc numeric(10,2) not null check (prfod_ttc > 0),
  prgnr_ttc numeric(10,2) not null check (prgnr_ttc > 0),
  ticpe_gnr numeric(10,2) not null check (ticpe_gnr >= 0),   -- montant TTC en € / m³ (396 TTC = 330 HT)
  ticpe_annee int not null check (ticpe_annee between 2020 and 2100),
  tva numeric(5,2) not null,
  debut date not null,
  fin date not null,
  formules jsonb not null,
  lignes jsonb not null,
  envoi_statut text not null default 'en_attente' check (envoi_statut in ('en_attente', 'envoye', 'echec')),
  envoi_le timestamptz,
  envoi_detail text,
  check (fin >= debut)
);
comment on table public.gt_grilles is 'Grille tarifaire : archive. Une ligne par enregistrement, avec le mode de calcul et les prix calculés de ce jour-là.';
create index if not exists gt_grilles_cree_le on public.gt_grilles (cree_le desc);

create table if not exists public.gt_journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  par uuid,
  par_email text,
  action text not null check (action in ('grille_enregistree', 'formules_modifiees', 'acces_ajoute', 'acces_modifie', 'acces_retire', 'envoi_email')),
  detail jsonb not null default '{}'::jsonb
);
comment on table public.gt_journal is 'Grille tarifaire : historique horodaté de chaque action. Écrit uniquement par la base (fonctions et triggers).';
create index if not exists gt_journal_le on public.gt_journal (le desc);

-- Mode de calcul d'origine (cahier des charges du 26/11/2026). Ne remplace pas un mode déjà modifié.
insert into public.gt_parametres (id, formules, tva, maj_par_email)
values (1, '[
  {"id": "FOD1", "produit": "FOD_O", "palier": 0, "mode": "calc", "base": "PRFOD", "ajout": 50, "ticpe": false},
  {"id": "PRFOD", "produit": "FOD_O", "palier": 1, "mode": "ref", "base": null, "ajout": 0, "ticpe": false},
  {"id": "FOD2", "produit": "FOD_O", "palier": 2, "mode": "calc", "base": "PRFOD", "ajout": -20, "ticpe": false},
  {"id": "FOD3", "produit": "FOD_O", "palier": 3, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "FOD4", "produit": "FOD_O", "palier": 4, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "FOD5", "produit": "FOD_A", "palier": 0, "mode": "calc", "base": "FOD1", "ajout": 20, "ticpe": false},
  {"id": "FOD6", "produit": "FOD_A", "palier": 1, "mode": "calc", "base": "PRFOD", "ajout": 20, "ticpe": false},
  {"id": "FOD7", "produit": "FOD_A", "palier": 2, "mode": "calc", "base": "FOD2", "ajout": 20, "ticpe": false},
  {"id": "FOD8", "produit": "FOD_A", "palier": 3, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "FOD9", "produit": "FOD_A", "palier": 4, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR1", "produit": "GNR_O", "palier": 0, "mode": "calc", "base": "GNR11", "ajout": 0, "ticpe": true},
  {"id": "GNR2", "produit": "GNR_O", "palier": 1, "mode": "calc", "base": "PRGNR", "ajout": 0, "ticpe": true},
  {"id": "GNR3", "produit": "GNR_O", "palier": 2, "mode": "calc", "base": "GNR12", "ajout": 0, "ticpe": true},
  {"id": "GNR4", "produit": "GNR_O", "palier": 3, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR5", "produit": "GNR_O", "palier": 4, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR6", "produit": "GNR_A", "palier": 0, "mode": "calc", "base": "GNR15", "ajout": 0, "ticpe": true},
  {"id": "GNR7", "produit": "GNR_A", "palier": 1, "mode": "calc", "base": "GNR16", "ajout": 0, "ticpe": true},
  {"id": "GNR8", "produit": "GNR_A", "palier": 2, "mode": "calc", "base": "GNR17", "ajout": 0, "ticpe": true},
  {"id": "GNR9", "produit": "GNR_A", "palier": 3, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR10", "produit": "GNR_A", "palier": 4, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR11", "produit": "GNR_AGRI_O", "palier": 0, "mode": "calc", "base": "PRGNR", "ajout": 40, "ticpe": false},
  {"id": "PRGNR", "produit": "GNR_AGRI_O", "palier": 1, "mode": "ref", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR12", "produit": "GNR_AGRI_O", "palier": 2, "mode": "calc", "base": "PRGNR", "ajout": -20, "ticpe": false},
  {"id": "GNR13", "produit": "GNR_AGRI_O", "palier": 3, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR14", "produit": "GNR_AGRI_O", "palier": 4, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR15", "produit": "GNR_AGRI_A", "palier": 0, "mode": "calc", "base": "GNR11", "ajout": 20, "ticpe": false},
  {"id": "GNR16", "produit": "GNR_AGRI_A", "palier": 1, "mode": "calc", "base": "PRGNR", "ajout": 20, "ticpe": false},
  {"id": "GNR17", "produit": "GNR_AGRI_A", "palier": 2, "mode": "calc", "base": "GNR12", "ajout": 20, "ticpe": false},
  {"id": "GNR18", "produit": "GNR_AGRI_A", "palier": 3, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false},
  {"id": "GNR19", "produit": "GNR_AGRI_A", "palier": 4, "mode": "decideur", "base": null, "ajout": 0, "ticpe": false}
]'::jsonb, 20, 'installation')
on conflict (id) do nothing;

-- ---------- 3. droits dans l'outil ----------
create or replace function public.gt_role()
returns text language sql stable security definer set search_path = public as $$
  select public.portail_role('grille_tarifaire');
$$;
create or replace function public.gt_peut_lire()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.gt_role() in ('lecteur', 'admin'), false);
$$;
create or replace function public.gt_est_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.gt_role() = 'admin', false);
$$;
revoke all on function public.gt_role(), public.gt_peut_lire(), public.gt_est_admin() from public, anon;
grant execute on function public.gt_role(), public.gt_peut_lire(), public.gt_est_admin() to authenticated;

-- ---------- 4. calcul ----------
-- Même règle que js/calcul.js : ref = prix saisi ; calc = TTC de la base + ajout (+ TICPE si coché) ;
-- decideur = pas de prix. HT = TTC / (1 + TVA). Arrondi au centime.
create or replace function public.gt_calculer(p_formules jsonb, p_prfod numeric, p_prgnr numeric, p_ticpe numeric, p_tva numeric)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_ttc jsonb := '{}'::jsonb;   -- id -> prix TTC (null pour décideur)
  v_reste int; v_avant int; f jsonb; v numeric; v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_formules) <> 'array' or jsonb_array_length(p_formules) = 0 then
    raise exception 'Mode de calcul vide.' using errcode = '22023';
  end if;
  loop
    v_avant := (select count(*) from jsonb_object_keys(v_ttc));
    for f in select value from jsonb_array_elements(p_formules) loop
      continue when v_ttc ? (f ->> 'id');
      if f ->> 'mode' = 'ref' then
        v := case f ->> 'id' when 'PRFOD' then p_prfod when 'PRGNR' then p_prgnr end;
        if v is null then raise exception 'Prix de référence inconnu : %', f ->> 'id' using errcode = '22023'; end if;
        v_ttc := v_ttc || jsonb_build_object(f ->> 'id', round(v, 2));
      elsif f ->> 'mode' = 'decideur' then
        v_ttc := v_ttc || jsonb_build_object(f ->> 'id', null);
      elsif f ->> 'mode' = 'calc' then
        if v_ttc ? (f ->> 'base') then
          if jsonb_typeof(v_ttc -> (f ->> 'base')) = 'null' then
            raise exception '% : la base % est sur demande au décideur.', f ->> 'id', f ->> 'base' using errcode = '22023';
          end if;
          v := (v_ttc ->> (f ->> 'base'))::numeric + coalesce((f ->> 'ajout')::numeric, 0)
               + case when coalesce((f ->> 'ticpe')::boolean, false) then p_ticpe else 0 end;
          v_ttc := v_ttc || jsonb_build_object(f ->> 'id', round(v, 2));
        end if;
      else
        raise exception '% : mode inconnu.', f ->> 'id' using errcode = '22023';
      end if;
    end loop;
    v_reste := jsonb_array_length(p_formules) - (select count(*) from jsonb_object_keys(v_ttc));
    exit when v_reste = 0;
    if (select count(*) from jsonb_object_keys(v_ttc)) = v_avant then
      raise exception 'Mode de calcul incohérent : base inexistante ou calcul en boucle.' using errcode = '22023';
    end if;
  end loop;
  for f in select value from jsonb_array_elements(p_formules) loop
    v := (v_ttc ->> (f ->> 'id'))::numeric;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', f ->> 'id', 'produit', f ->> 'produit', 'palier', (f ->> 'palier')::int, 'mode', f ->> 'mode',
      'ttc', v, 'ht', case when v is null then null else round(v / (1 + p_tva / 100), 2) end));
  end loop;
  return v_out;
end $$;
revoke all on function public.gt_calculer(jsonb, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.gt_calculer(jsonb, numeric, numeric, numeric, numeric) to authenticated;

-- ---------- 5. enregistrer une grille ----------
create or replace function public.gt_enregistrer_grille(
  p_prfod numeric, p_prgnr numeric, p_ticpe numeric, p_annee int, p_debut date, p_fin date)
returns public.gt_grilles language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  p gt_parametres; g gt_grilles; prec gt_grilles;
begin
  if not public.gt_est_admin() then
    raise exception 'Seuls les administrateurs de la grille tarifaire peuvent l''enregistrer.' using errcode = '42501';
  end if;
  if p_prfod is null or p_prfod <= 0 or p_prgnr is null or p_prgnr <= 0 then
    raise exception 'Les deux prix de référence doivent être supérieurs à zéro.' using errcode = '22023';
  end if;
  if p_prfod <> round(p_prfod, 2) or p_prgnr <> round(p_prgnr, 2) or coalesce(p_ticpe, -1) <> round(p_ticpe, 2) then
    raise exception 'Deux décimales au maximum (euros et centimes).' using errcode = '22023';
  end if;
  if p_ticpe is null or p_ticpe < 0 then
    raise exception 'Le montant TICPE doit être positif ou nul.' using errcode = '22023';
  end if;
  if p_debut is null or p_fin is null or p_fin < p_debut then
    raise exception 'La période d''effectivité doit finir après son début.' using errcode = '22023';
  end if;
  select * into p from gt_parametres where id = 1;
  select * into prec from gt_grilles order by cree_le desc, id desc limit 1;

  insert into gt_grilles (cree_par, cree_par_email, prfod_ttc, prgnr_ttc, ticpe_gnr, ticpe_annee, tva, debut, fin, formules, lignes)
  values (auth.uid(), v_email, p_prfod, p_prgnr, p_ticpe, p_annee, p.tva, p_debut, p_fin, p.formules,
          public.gt_calculer(p.formules, p_prfod, p_prgnr, p_ticpe, p.tva))
  returning * into g;

  insert into gt_journal (par, par_email, action, detail)
  values (auth.uid(), v_email, 'grille_enregistree', jsonb_build_object(
    'grille_id', g.id, 'debut', g.debut, 'fin', g.fin,
    'prfod_ttc', g.prfod_ttc, 'prgnr_ttc', g.prgnr_ttc, 'ticpe_gnr', g.ticpe_gnr, 'ticpe_annee', g.ticpe_annee,
    'precedent', case when prec.id is null then null else jsonb_build_object(
      'grille_id', prec.id, 'prfod_ttc', prec.prfod_ttc, 'prgnr_ttc', prec.prgnr_ttc, 'ticpe_gnr', prec.ticpe_gnr,
      'debut', prec.debut, 'fin', prec.fin) end));
  return g;
end $$;
revoke all on function public.gt_enregistrer_grille(numeric, numeric, numeric, int, date, date) from public, anon;
grant execute on function public.gt_enregistrer_grille(numeric, numeric, numeric, int, date, date) to authenticated;

-- ---------- 6. modifier le mode de calcul ----------
-- Les lignes (identifiants, produits, paliers) sont fixes : seuls le mode, la base, l'ajout et la case TICPE changent.
create or replace function public.gt_enregistrer_formules(p_formules jsonb, p_tva numeric)
returns public.gt_parametres language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  p gt_parametres; v_tva_avant numeric; v_norm jsonb; v_chg jsonb;
begin
  if not public.gt_est_admin() then
    raise exception 'Seuls les administrateurs de la grille tarifaire peuvent modifier le mode de calcul.' using errcode = '42501';
  end if;
  if p_tva is null or p_tva < 0 or p_tva >= 100 or p_tva <> round(p_tva, 2) then
    raise exception 'Taux de TVA invalide.' using errcode = '22023';
  end if;
  select * into p from gt_parametres where id = 1 for update;
  v_tva_avant := p.tva;
  -- mêmes lignes, même ordre, mêmes produits et paliers ; PRFOD et PRGNR restent les prix de référence
  if jsonb_typeof(p_formules) <> 'array' or jsonb_array_length(p_formules) <> jsonb_array_length(p.formules)
     or exists (select 1 from jsonb_array_elements(p_formules) with ordinality n(f, i)
                join jsonb_array_elements(p.formules) with ordinality a(f, i) using (i)
                where n.f ->> 'id' is distinct from a.f ->> 'id'
                   or n.f ->> 'produit' is distinct from a.f ->> 'produit'
                   or n.f ->> 'palier' is distinct from a.f ->> 'palier'
                   or (n.f ->> 'mode' = 'ref') is distinct from (a.f ->> 'mode' = 'ref')) then
    raise exception 'Les lignes de la grille ne peuvent pas être ajoutées, supprimées ou déplacées.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_formules) f
             where f ->> 'mode' = 'calc' and (jsonb_typeof(f -> 'ajout') is distinct from 'number'
                   or (f ->> 'ajout')::numeric <> round((f ->> 'ajout')::numeric, 2)
                   or jsonb_typeof(f -> 'base') is distinct from 'string')) then
    raise exception 'Chaque ligne calculée a une base et un ajout en euros, deux décimales au maximum.' using errcode = '22023';
  end if;
  -- forme normalisée : base, ajout et TICPE n'existent que pour les lignes calculées
  select jsonb_agg(jsonb_build_object(
           'id', f ->> 'id', 'produit', f ->> 'produit', 'palier', (f ->> 'palier')::int, 'mode', f ->> 'mode',
           'base', case when f ->> 'mode' = 'calc' then f ->> 'base' end,
           'ajout', case when f ->> 'mode' = 'calc' then (f ->> 'ajout')::numeric else 0 end,
           'ticpe', case when f ->> 'mode' = 'calc' then coalesce((f ->> 'ticpe')::boolean, false) else false end) order by i)
    into v_norm
    from jsonb_array_elements(p_formules) with ordinality x(f, i);
  perform public.gt_calculer(v_norm, 1000, 1000, 0, p_tva);   -- refuse mode inconnu, base inexistante, base « décideur », boucle

  -- détail des changements, ligne par ligne, pour l'historique
  select coalesce(jsonb_agg(jsonb_build_object('id', n.f ->> 'id',
           'avant', a.f - 'id' - 'produit' - 'palier', 'apres', n.f - 'id' - 'produit' - 'palier') order by i), '[]'::jsonb)
    into v_chg
    from jsonb_array_elements(v_norm) with ordinality n(f, i)
    join jsonb_array_elements(p.formules) with ordinality a(f, i) using (i)
   where (n.f - 'id' - 'produit' - 'palier') <> (a.f - 'id' - 'produit' - 'palier');
  if jsonb_array_length(v_chg) = 0 and p_tva = v_tva_avant then
    return p;   -- rien n'a changé : pas de ligne d'historique
  end if;

  update gt_parametres set formules = v_norm, tva = p_tva, maj_le = now(), maj_par_email = v_email
   where id = 1
  returning * into p;

  insert into gt_journal (par, par_email, action, detail)
  values (auth.uid(), v_email, 'formules_modifiees', jsonb_strip_nulls(jsonb_build_object(
    'lignes', v_chg,
    'tva_avant', case when p_tva <> v_tva_avant then v_tva_avant end,
    'tva', case when p_tva <> v_tva_avant then p_tva end)));
  return p;
end $$;
revoke all on function public.gt_enregistrer_formules(jsonb, numeric) from public, anon;
grant execute on function public.gt_enregistrer_formules(jsonb, numeric) to authenticated;

-- ---------- 7. historique des accès (ajout d'un admin temporaire compris) ----------
create or replace function public.gt_journal_acces()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record := case when tg_op = 'DELETE' then old else new end;
  v_cible text := (select email from portail_collaborateurs where user_id = r.user_id);
  v_par text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if r.outil_slug <> 'grille_tarifaire' then return null; end if;
  if tg_op = 'UPDATE' and old.role is not distinct from new.role and old.expire_le is not distinct from new.expire_le then
    return null;
  end if;
  insert into gt_journal (par, par_email, action, detail)
  values (auth.uid(), nullif(v_par, ''),
          case tg_op when 'INSERT' then 'acces_ajoute' when 'UPDATE' then 'acces_modifie' else 'acces_retire' end,
          jsonb_strip_nulls(jsonb_build_object(
            'email', v_cible,
            'role', case when tg_op = 'DELETE' then null else new.role end,
            'role_avant', case when tg_op = 'INSERT' then null else old.role end,
            'expire_le', case when tg_op = 'DELETE' then null else new.expire_le end,
            'expire_le_avant', case when tg_op = 'INSERT' then null else old.expire_le end,
            'temporaire', case when tg_op <> 'DELETE' and new.expire_le is not null then true end)));
  return null;
end $$;
revoke all on function public.gt_journal_acces() from public, anon, authenticated;
drop trigger if exists gt_journal_acces on public.portail_acces;
create trigger gt_journal_acces after insert or update or delete on public.portail_acces
  for each row execute function public.gt_journal_acces();

-- ---------- 8. RLS ----------
alter table public.gt_parametres enable row level security;
alter table public.gt_grilles enable row level security;
alter table public.gt_journal enable row level security;
revoke all on public.gt_parametres, public.gt_grilles, public.gt_journal from anon, authenticated;
grant select on public.gt_parametres, public.gt_grilles, public.gt_journal to authenticated;

drop policy if exists gt_parametres_lecture on public.gt_parametres;
create policy gt_parametres_lecture on public.gt_parametres for select to authenticated using (public.gt_peut_lire());
drop policy if exists gt_grilles_lecture on public.gt_grilles;
create policy gt_grilles_lecture on public.gt_grilles for select to authenticated using (public.gt_peut_lire());
drop policy if exists gt_journal_lecture on public.gt_journal;
create policy gt_journal_lecture on public.gt_journal for select to authenticated using (public.gt_peut_lire());
-- Aucune politique d'écriture : insert, update et delete passent uniquement par les fonctions ci-dessus.
-- La fonction Edge gt-envoi (clé serveur) écrit le résultat de l'envoi : droits explicites pour service_role.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, update (envoi_statut, envoi_le, envoi_detail) on public.gt_grilles to service_role;
    grant select, insert on public.gt_journal to service_role;
  end if;
end $$;

-- ---------- 9. accès de quentin.d@hympyr.fr ----------
insert into public.portail_acces (user_id, outil_slug, role, accorde_par)
select c.user_id, 'grille_tarifaire', 'admin', c.user_id
  from public.portail_collaborateurs c
 where c.email = 'quentin.d@hympyr.fr'
on conflict (user_id, outil_slug) do update set role = 'admin', expire_le = null;

commit;

-- Vérification (lecture seule) : une ligne « admin » pour quentin.d@hympyr.fr, 30 lignes de calcul, 0 grille.
select c.email, a.role, a.expire_le,
       (select jsonb_array_length(formules) from public.gt_parametres) as lignes_de_calcul,
       (select count(*) from public.gt_grilles) as grilles
  from public.portail_acces a join public.portail_collaborateurs c using (user_id)
 where a.outil_slug = 'grille_tarifaire';
