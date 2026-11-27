/* =========================================================
   ADMINISTRATION > HISTORIQUE DES ACTIONS
   Lecture seule de portail_admin_journal (sql/15) : la base écrit chaque trace elle-même, par trigger,
   et refuse toute modification ou suppression. Cette page ne fait que lire et exporter.
   Dépend de app.js (sb, A, $, esc, ic, I, ROLE_LABEL, POLE_LABEL, nomCollab, stagger, toast) et de coffre.js (V).
   ========================================================= */
'use strict';

Object.assign(I, {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'
});

const H = { lignes: [], fin: false, charge: false, q: '', cat: 'tout', erreur: '' };
const H_PAGE = 200;

const H_ACTION = {
  creer: 'Compte créé',
  supprimer: 'Compte supprimé',
  mot_de_passe: 'Mot de passe de connexion redéfini',
  collaborateur_ajoute: 'Collaborateur ajouté au portail',
  collaborateur_supprime: 'Fiche collaborateur supprimée',
  profil_modifie: 'Profil modifié',
  compte_desactive: 'Compte désactivé',
  compte_reactive: 'Compte réactivé',
  admin_accorde: 'Administration du portail accordée',
  admin_retire: 'Administration du portail retirée',
  acces_ajoute: 'Accès à un outil ouvert',
  acces_modifie: 'Accès à un outil modifié',
  acces_retire: 'Accès à un outil retiré',
  renommer_outil: 'Outil renommé',
  ticket_statut: 'Statut d\'un ticket modifié',
  rappels_reprogrammes: 'Rappels d\'un autre compte reprogrammés',
  coffre_cree: 'Coffre des mots de passe créé',
  coffre_lecture: 'Coffre chiffré téléchargé',
  coffre_deverrouille: 'Coffre déverrouillé',
  coffre_echec_phrase: 'Phrase secrète du coffre erronée',
  coffre_verrouille: 'Coffre verrouillé',
  coffre_entree_ajoutee: 'Mot de passe du Groupe ajouté',
  coffre_entree_modifiee: 'Ligne du coffre modifiée',
  coffre_mot_de_passe_modifie: 'Mot de passe du Groupe modifié',
  coffre_entree_supprimee: 'Mot de passe du Groupe supprimé',
  coffre_phrase_changee: 'Phrase secrète du coffre changée',
  coffre_mot_de_passe_affiche: 'Mot de passe du Groupe affiché',
  coffre_mot_de_passe_copie: 'Mot de passe du Groupe copié',
  coffre_identifiant_copie: 'Identifiant du coffre copié'
};
// Actions mises en évidence : mots de passe et pouvoirs d'administration
const H_SENSIBLE = new Set(['mot_de_passe', 'supprimer', 'admin_accorde', 'admin_retire', 'coffre_cree',
  'coffre_mot_de_passe_modifie', 'coffre_entree_supprimee', 'coffre_phrase_changee', 'coffre_echec_phrase']);
const H_CAT = [['tout', 'Tout'], ['mdp', 'Mots de passe'], ['droits', 'Droits et administration'], ['comptes', 'Comptes et profils'], ['outils', 'Outils et tickets']];
function hCat(a) {
  if (a === 'mot_de_passe' || a.startsWith('coffre_')) return 'mdp';
  if (a.startsWith('acces_') || a.startsWith('admin_')) return 'droits';
  if (a === 'renommer_outil' || a === 'ticket_statut' || a === 'rappels_reprogrammes') return 'outils';
  return 'comptes';
}
const H_ORIGINE = { outil: 'depuis l\'écran d\'un outil', serveur: 'via la gestion des comptes', sql: 'automatique ou SQL' };
const H_CHAMP = { prenom: 'Prénom', nom: 'Nom', pole: 'Pôle', email: 'E-mail', role: 'Rôle', expire_le: 'Fin d\'accès', description: 'Description',
  actif: 'Compte actif', admin_portail: 'Administrateur', version: 'Version de la clé', rappel_date: 'Date de rappel' };
const H_COFFRE_CHAMP = { entite: 'entité', usage: 'usage', identifiant: 'identifiant', mot_de_passe: 'mot de passe', url: 'URL' };

const hDate = v => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(v));
const hOutil = s => (A.outils.find(o => o.slug === s) || {}).nom || s;
function hValeur(k, v) {
  if (v === null || v === undefined || v === '') return 'vide';
  if (k === 'role') return ROLE_LABEL[v] || v;
  if (k === 'pole') return POLE_LABEL[v] || v;
  if (k === 'expire_le') return dCourt(v);
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  return String(v);
}
function hAuteur(l) {
  if (!l.par_email) return l.origine === 'sql' ? 'Automatique' : 'Inconnu';
  const c = A.collab.find(x => x.email === l.par_email);
  return c ? nomCollab(c) : l.par_email;
}
function hCible(l) {
  if (l.cible_email) { const c = A.collab.find(x => x.email === l.cible_email); return c ? `${nomCollab(c)} (${l.cible_email})` : l.cible_email; }
  const d = l.detail || {};
  if (d.outil || d.slug) return hOutil(d.outil || d.slug);
  if (d.entree) {
    // Coffre déverrouillé : on montre localement de quelle ligne il s'agit, rien n'est lu en base
    const x = typeof V !== 'undefined' && V.cle ? V.lignes.find(e => e.id === d.entree) : null;
    return x ? coffreLibelle(x.clair) : 'Ligne ' + String(d.entree).slice(0, 8);
  }
  if (l.action === 'ticket_statut') return `Ticket ${hOutil(d.source) === 'portail' ? 'du portail' : hOutil(d.source)} n° ${d.id}`;
  return '';
}
/* détail lisible : « Rôle : Lecteur → Administrateur » ; jamais de secret ici, la base n'en écrit pas */
function hDetails(l) {
  const out = [], d = l.detail || {}, av = l.avant || {}, ap = l.apres || {};
  if (l.cible_email && (d.outil)) out.push('Outil : ' + hOutil(d.outil));
  // ancien format du renommage (sql/9), avant la colonne avant/après
  if (d.nom_avant !== undefined) out.push(`Nom : ${hValeur('nom', d.nom_avant)} → ${hValeur('nom', d.nom_apres)}`);
  if (d.description_avant !== undefined && d.description_avant !== d.description_apres) out.push(`Description : ${hValeur('d', d.description_avant)} → ${hValeur('d', d.description_apres)}`);
  const cles = [...new Set([...Object.keys(av), ...Object.keys(ap)])];
  for (const k of cles) {
    const a = av[k], b = ap[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const lib = H_CHAMP[k] || k;
    if (l.action === 'acces_ajoute' || l.action === 'collaborateur_ajoute') out.push(`${lib} : ${hValeur(k, b)}`);
    else if (l.action === 'acces_retire' || l.action === 'collaborateur_supprime') out.push(`${lib} : ${hValeur(k, a)}`);
    else out.push(`${lib} : ${hValeur(k, a)} → ${hValeur(k, b)}`);
  }
  if (Array.isArray(d.champs) && d.champs.length) out.push('Champs modifiés : ' + d.champs.map(c => H_COFFRE_CHAMP[c] || c).join(', '));
  if (d.entrees_rechiffrees !== undefined) out.push(`${d.entrees_rechiffrees} ligne${d.entrees_rechiffrees > 1 ? 's' : ''} rechiffrée${d.entrees_rechiffrees > 1 ? 's' : ''}`);
  if (l.action === 'coffre_lecture' && d.entrees !== undefined) out.push(`${d.entrees} ligne${d.entrees > 1 ? 's' : ''} chiffrée${d.entrees > 1 ? 's' : ''}`);
  if (l.action === 'rappels_reprogrammes' && d.nombre) out.push(`${d.nombre} rappel${d.nombre > 1 ? 's' : ''} déplacé${d.nombre > 1 ? 's' : ''}` + (!l.cible_email && d.compte ? ` (compte ${d.compte})` : ''));
  if (l.action === 'ticket_statut' && d.statut) out.push('Nouveau statut : ' + ((TICKET_STATUT.find(s => s[0] === d.statut) || [])[1] || d.statut));
  if (l.action === 'creer' && Array.isArray(d.acces) && d.acces.length) out.push('Outils : ' + d.acces.map(a => `${hOutil(a.outil_slug)} (${ROLE_LABEL[a.role] || a.role})`).join(', '));
  return out;
}

async function hCharger(suite) {
  if (H.charge) return; H.charge = true;
  let req = sb.from('portail_admin_journal').select('id,le,par_email,origine,action,cible_email,detail,avant,apres')
    .order('id', { ascending: false }).limit(H_PAGE);
  if (suite && H.lignes.length) req = req.lt('id', H.lignes[H.lignes.length - 1].id);
  const { data, error } = await req;
  H.charge = false;
  if (error) { H.erreur = /origine|avant|apres|column/i.test(error.message || '') ? 'sql' : 'reseau'; return; }
  H.erreur = '';
  H.lignes = suite ? [...H.lignes, ...data] : data;
  H.fin = data.length < H_PAGE;
}
function hFiltrees() {
  const q = H.q.trim().toLowerCase();
  return H.lignes.filter(l => (H.cat === 'tout' || hCat(l.action) === H.cat) &&
    (!q || [H_ACTION[l.action] || l.action, hAuteur(l), l.par_email, hCible(l), ...hDetails(l)].join(' ').toLowerCase().includes(q)));
}
function hLignesHTML() {
  const list = hFiltrees();
  if (!list.length) return `<div class="adm-empty glass">${H.lignes.length ? 'Aucune action ne correspond.' : 'Aucune action enregistrée pour l\'instant.'}</div>`;
  return list.map(l => {
    const det = hDetails(l), cible = hCible(l);
    return `<div class="hist-row glass ${H_SENSIBLE.has(l.action) ? 'sens' : ''}">
      <time datetime="${esc(l.le)}">${esc(hDate(l.le))}</time>
      <div class="hist-main"><b>${esc(H_ACTION[l.action] || l.action)}</b>${cible ? `<span class="hist-cible">${esc(cible)}</span>` : ''}
        ${det.length ? `<ul>${det.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
      <div class="hist-par"><span>Par</span><b>${esc(hAuteur(l))}</b>${H_ORIGINE[l.origine] ? `<span class="adm-meta">${esc(H_ORIGINE[l.origine])}</span>` : ''}</div>
    </div>`;
  }).join('');
}
function historiqueHTML() {
  if (H.erreur === 'sql') return `<div class="adm-empty glass" data-st>Historique incomplet : exécutez le fichier SQL « 15_historique_actions.sql » dans Supabase.</div>`;
  if (H.erreur) return `<div class="adm-empty glass" data-st>Chargement de l'historique impossible. Vérifiez votre connexion puis rechargez la page.</div>`;
  return `<p class="muted adm-intro" data-st>Chaque action d'administration est enregistrée par la base elle-même, à l'heure du serveur (heure de Paris).
      Les traces ne peuvent être ni modifiées ni supprimées, y compris par un administrateur. Aucun mot de passe n'y figure.</p>
    <div class="adm-tools" data-st>
      <input class="input" id="histQ" type="search" placeholder="Rechercher une personne, une action, un outil" aria-label="Rechercher dans l'historique">
      <div class="adm-tools-r"><div class="seg glass glide scroll" id="histSeg" role="tablist" aria-label="Type d'action"></div>
        <button class="btn ghost sm mag" type="button" data-hist-csv>${ic('download')}<span>Exporter (CSV)</span></button></div>
    </div>
    <div class="adm-list" id="histList">${hLignesHTML()}</div>
    <div class="hist-foot" id="histFoot">${H.fin ? `<span class="muted">${H.lignes.length} action${H.lignes.length > 1 ? 's' : ''} au total</span>`
      : `<button class="btn ghost sm mag" type="button" data-hist-plus>Afficher les actions plus anciennes</button>`}</div>`;
}
async function openHistorique(body) {
  if (!H.lignes.length && !H.erreur) body.innerHTML = `<div class="adm-empty glass">Chargement…</div>`;
  await hCharger(false);
  if (A.tab !== 'historique') return;
  body.innerHTML = historiqueHTML();
  const q = $('#histQ');
  if (q) {
    q.value = H.q; q.oninput = () => { H.q = q.value; $('#histList').innerHTML = hLignesHTML(); };
    seg($('#histSeg'), H_CAT, H.cat, v => { H.cat = v; $('#histList').innerHTML = hLignesHTML(); });
  }
  stagger(body);
}
async function hExporter(btn) {
  btn.disabled = true; btn.lastChild.textContent = 'Préparation';
  // on charge tout l'historique avant l'export (une archive partielle n'a pas de valeur de preuve)
  while (!H.fin && !H.erreur) await hCharger(true);
  btn.disabled = false; btn.lastChild.textContent = 'Exporter (CSV)';
  if (H.erreur) { toast('Export impossible. Réessayez.', 'x'); return; }
  const cel = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lignes = [['n°', 'date (UTC)', 'auteur', 'origine', 'action', 'cible', 'détail', 'avant', 'après'].map(cel).join(';'),
    ...H.lignes.map(l => [l.id, l.le, l.par_email, l.origine, H_ACTION[l.action] || l.action, l.cible_email || hCible(l), hDetails(l).join(' | '),
      l.avant ? JSON.stringify(l.avant) : '', l.apres ? JSON.stringify(l.apres) : ''].map(cel).join(';'))];
  const url = URL.createObjectURL(new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `historique-administration-portail-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${H.lignes.length} actions exportées`);
}
document.addEventListener('click', async e => {
  if (e.target.closest('[data-hist-csv]')) { hExporter(e.target.closest('[data-hist-csv]')); return; }
  const plus = e.target.closest('[data-hist-plus]'); if (!plus) return;
  plus.disabled = true; await hCharger(true);
  $('#histList').innerHTML = hLignesHTML();
  $('#histFoot').innerHTML = H.fin ? `<span class="muted">${H.lignes.length} actions au total</span>`
    : `<button class="btn ghost sm mag" type="button" data-hist-plus>Afficher les actions plus anciennes</button>`;
});
