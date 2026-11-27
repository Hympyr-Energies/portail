/* =========================================================
   ADMINISTRATION > MOTS DE PASSE DU GROUPE (coffre chiffré de bout en bout, sql/16)

   - La phrase secrète du coffre ne quitte jamais ce navigateur : ni envoyée, ni stockée, ni mise en cache.
   - Clé AES-GCM 256 bits dérivée de la phrase (PBKDF2-SHA256, 600 000 itérations, sel aléatoire),
     non exportable, gardée en mémoire seulement le temps de l'ouverture.
   - Chaque ligne (identifiant, mot de passe, URL) est chiffrée ici ; la base ne voit que du chiffré.
     La donnée authentifiée (AAD) lie chaque chiffré à sa ligne et à la version de la clé : un chiffré
     déplacé ou rejoué sur une autre ligne est refusé au déchiffrement.
   - Verrouillage : 5 min sans activité, 1 min onglet masqué, sortie de l'administration, déconnexion.
   - Traces : la base trace elle-même chaque lecture, ajout, modification, suppression et changement de phrase ;
     ce fichier trace en plus l'affichage et la copie d'un mot de passe (événements que seul le navigateur voit).
   Dépend de app.js (sb, A, S, $, $$, esc, ic, I, toast, setMsg, genMdp, closeTicket, EASE, stagger).
   ========================================================= */
'use strict';

Object.assign(I, {
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
});

const COFFRE = { ITER: 600000, INACTIVITE_MS: 5 * 60e3, MASQUE_MS: 60e3, AFFICHAGE_MS: 15e3, PRESSE_PAPIERS_MS: 30e3, PHRASE_MIN: 14 };
// cle : CryptoKey non exportable · lignes : [{ id, cree_le, maj_le, clair: { i, p, u } }]
const V = { entite: 'tout', cle: null, version: 0, etat: null, nb: 0, maj_le: null, lignes: [], q: '', echecs: 0, inact: 0, masque: 0, vus: new Map(), pp: 0 };
const TXT = new TextEncoder(), DTXT = new TextDecoder();
const b64 = u => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const deb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const aadLigne = (id, v) => TXT.encode(`hympyr-coffre|ligne|${id}|${v}`);
const aadVerif = v => TXT.encode(`hympyr-coffre|verif|${v}`);
const VERIF = 'hympyr-coffre-v1';
// Entité du Groupe : chiffrée avec le reste de la ligne (champ « e »), la base ne la voit pas
const COFFRE_ENTITES = [['energies', 'Hympyr Energies'], ['granules', 'Granulés'], ['transport', 'Transport']];
const entiteNom = e => (COFFRE_ENTITES.find(x => x[0] === e) || [])[1] || 'Non classé';
// Libellé d'une ligne pour l'historique (affiché seulement quand le coffre est ouvert, rien n'est écrit en base)
const coffreLibelle = c => [c.n || c.i || 'Ligne sans nom', c.e ? entiteNom(c.e) : ''].filter(Boolean).join(' · ');

/* ---------- cryptographie (WebCrypto, aucune dépendance) ---------- */
async function coffreDeriver(phrase, sel, iterations) {
  const base = await crypto.subtle.importKey('raw', TXT.encode(phrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function coffreChiffrer(cle, obj, aad) {
  // longueur arrondie à 64 octets : le chiffré ne trahit pas la longueur exacte d'un mot de passe
  const brut = TXT.encode(JSON.stringify(obj));
  const clair = new Uint8Array(Math.ceil((brut.length + 1) / 64) * 64).fill(32); clair.set(brut);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, cle, clair);
  brut.fill(0); clair.fill(0);
  return { iv: b64(iv), chiffre: b64(new Uint8Array(c)) };
}
async function coffreDechiffrer(cle, iv, chiffre, aad) {
  const c = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deb64(iv), additionalData: aad }, cle, deb64(chiffre));
  return JSON.parse(DTXT.decode(c));
}

/* ---------- appels base ---------- */
function coffreErreur(error) {
  const m = String(error?.message || ''), c = error?.code;
  if (c === 'PGRST202' || c === '42883' || /could not find the function/i.test(m)) return 'Coffre non installé : exécutez le fichier SQL « 16_coffre_mots_de_passe.sql » dans Supabase.';
  if (c === '42501') return 'Réservé aux administrateurs du portail.';
  if (c === '40001' || c === 'P0002' || c === '23505') return m;
  return 'Action impossible pour le moment. Vérifiez votre connexion puis réessayez.';
}
async function coffreRpc(nom, args) {
  const { data, error } = await sb.rpc(nom, args);
  if (error) throw new Error(coffreErreur(error));
  return data;
}
const coffreTracer = (action, entree = null) => coffreRpc('portail_coffre_tracer', { p_action: action, p_entree: entree });

/* ---------- verrouillage ---------- */
function coffreVerrouiller(raison) {
  const etaitOuvert = !!V.cle;
  V.cle = null; V.lignes.forEach(l => { l.clair = null; }); V.lignes = []; V.vus.forEach(t => clearTimeout(t)); V.vus.clear();
  clearTimeout(V.inact); clearTimeout(V.masque);
  if (!etaitOuvert) return;
  coffrePurgerModal(true);
  if (S.view === 'admin' && A.tab === 'coffre') renderCoffre($('#admBody'));
  if (raison) toast(raison, 'lock');
}
function coffreActivite() {
  if (!V.cle) return;
  clearTimeout(V.inact);
  V.inact = setTimeout(() => coffreVerrouiller('Coffre verrouillé après 5 minutes sans activité'), COFFRE.INACTIVITE_MS);
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, coffreActivite, { passive: true, capture: true }));
document.addEventListener('visibilitychange', () => {
  if (!V.cle) return;
  clearTimeout(V.masque);
  if (document.hidden) V.masque = setTimeout(() => coffreVerrouiller('Coffre verrouillé : la page est restée en arrière-plan'), COFFRE.MASQUE_MS);
});
addEventListener('pagehide', () => coffreVerrouiller());

/* ---------- affichage ---------- */
function coffreHote(u) { try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? x.pathname : ''); } catch (e) { return u; } }
function coffreLienSur(u) { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch (e) { return ''; } }

async function renderCoffre(body) {
  if (V.cle) { body.innerHTML = coffreTableHTML(); bindCoffreTable(); stagger(body); return; }
  body.innerHTML = `<div class="adm-empty glass">Chargement…</div>`;
  try {
    const e = await coffreRpc('portail_coffre_etat');
    V.etat = e.initialise ? 'verrouille' : 'creation'; V.nb = e.entrees; V.maj_le = e.maj_le;
  } catch (err) {
    if (A.tab === 'coffre') body.innerHTML = `<div class="adm-empty glass" data-st>${esc(err.message)}</div>`; return;
  }
  if (A.tab !== 'coffre' || S.view !== 'admin') return;
  body.innerHTML = V.etat === 'creation' ? coffreCreationHTML() : coffreVerrouHTML();
  const f = $('#cfForm'); f.onsubmit = ev => { ev.preventDefault(); V.etat === 'creation' ? coffreCreer(f) : coffreOuvrir(f); };
  stagger(body);
  setTimeout(() => $('#cfPhrase')?.focus({ preventScroll: true }), 250);
}
const PHRASE_ATTR = 'type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"';
function coffreVerrouHTML() {
  return `<div class="cf-lock glass" data-st>
      <span class="cf-ico">${ic('lock')}</span>
      <h2>Mots de passe du Groupe</h2>
      <p class="muted">Coffre chiffré de bout en bout · ${V.nb} ligne${V.nb > 1 ? 's' : ''}${V.maj_le ? ' · phrase secrète définie le ' + esc(dCourt(V.maj_le)) : ''}.
        Même connecté en administrateur, il faut la phrase secrète du coffre pour l'ouvrir.</p>
      <form class="form" id="cfForm" novalidate>
        <label class="field"><span>Phrase secrète du coffre</span><input class="input" id="cfPhrase" ${PHRASE_ATTR}></label>
        <p class="msg" id="cfMsg" role="alert"></p>
        <button class="btn block mag" type="submit" id="cfBtn">${ic('lock')}<span>Déverrouiller</span></button>
      </form>
      <p class="cf-note">Chaque ouverture, chaque mot de passe affiché ou copié et chaque modification sont enregistrés dans l'historique des actions.</p>
    </div>`;
}
function coffreCreationHTML() {
  return `<div class="cf-lock glass" data-st>
      <span class="cf-ico">${ic('lock')}</span>
      <h2>Créer le coffre des mots de passe du Groupe</h2>
      <p class="muted">Choisissez la phrase secrète que seuls les administrateurs connaîtront. Elle chiffre le coffre dans votre navigateur :
        elle n'est jamais envoyée ni enregistrée, et Hympyr comme Supabase n'en ont aucune copie.</p>
      <form class="form" id="cfForm" novalidate>
        <label class="field"><span>Phrase secrète (${COFFRE.PHRASE_MIN} caractères minimum, idéalement 4 mots ou plus)</span><input class="input" id="cfPhrase" ${PHRASE_ATTR}></label>
        <label class="field"><span>Confirmation</span><input class="input" id="cfPhrase2" ${PHRASE_ATTR}></label>
        <label class="cf-check"><input type="checkbox" id="cfCompris"> J'ai compris : si cette phrase est perdue, personne ne pourra récupérer les mots de passe du coffre.
          Je la transmets aux autres administrateurs de vive voix et la conserve hors ligne (enveloppe scellée au coffre-fort, par exemple).</label>
        <p class="msg" id="cfMsg" role="alert"></p>
        <button class="btn block mag" type="submit" id="cfBtn">${ic('check')}<span>Créer le coffre</span></button>
      </form>
    </div>`;
}
function phraseValide(p) { return p.length >= COFFRE.PHRASE_MIN && new Set(p).size >= 8; }

async function coffreCreer(f) {
  const p = $('#cfPhrase').value, p2 = $('#cfPhrase2').value, msg = $('#cfMsg'), btn = $('#cfBtn');
  if (!phraseValide(p)) { setMsg(msg, `Phrase secrète trop courte : ${COFFRE.PHRASE_MIN} caractères minimum, variés.`); return; }
  if (p !== p2) { setMsg(msg, 'Les deux saisies ne correspondent pas.'); return; }
  if (!$('#cfCompris').checked) { setMsg(msg, 'Cochez la case pour confirmer que vous avez compris.'); return; }
  btn.disabled = true; btn.lastChild.textContent = 'Création en cours';
  try {
    const sel = crypto.getRandomValues(new Uint8Array(16));
    const cle = await coffreDeriver(p, sel, COFFRE.ITER);
    const v = await coffreChiffrer(cle, { t: VERIF }, aadVerif(1));
    await coffreRpc('portail_coffre_initialiser', { p_iterations: COFFRE.ITER, p_sel: b64(sel), p_verif_iv: v.iv, p_verif: v.chiffre });
    f.reset();
    V.cle = cle; V.version = 1; V.lignes = []; coffreActivite();
    toast('Coffre créé et déverrouillé');
    renderCoffre($('#admBody'));
  } catch (e) { btn.disabled = false; btn.lastChild.textContent = 'Créer le coffre'; setMsg(msg, e.message || 'Création impossible.'); }
}

async function coffreOuvrir(f) {
  const champ = $('#cfPhrase'), msg = $('#cfMsg'), btn = $('#cfBtn'), p = champ.value;
  if (!p) { setMsg(msg, 'Saisissez la phrase secrète du coffre.'); champ.focus(); return; }
  btn.disabled = true; btn.lastChild.textContent = 'Déverrouillage';
  const rendre = t => { btn.disabled = false; btn.lastChild.textContent = 'Déverrouiller'; setMsg(msg, t); };
  let data;
  try { data = await coffreRpc('portail_coffre_lire'); } catch (e) { rendre(e.message); return; }
  if (!data?.cle) { renderCoffre($('#admBody')); return; }
  const k = data.cle;
  let cle;
  try {
    cle = await coffreDeriver(p, deb64(k.sel), k.iterations);
    const t = await coffreDechiffrer(cle, k.verif_iv, k.verif, aadVerif(k.version));
    if (t?.t !== VERIF) throw new Error('verif');
  } catch (e) {
    V.echecs++;
    coffreTracer('coffre_echec_phrase').catch(() => {});
    champ.value = '';
    // ralentissement progressif dans l'interface (la vraie protection reste le coût de la dérivation)
    const attente = Math.min(V.echecs * 2, 30);
    btn.lastChild.textContent = `Patientez ${attente} s`;
    setMsg(msg, 'Phrase secrète incorrecte. La tentative est enregistrée dans l\'historique.');
    setTimeout(() => { btn.disabled = false; btn.lastChild.textContent = 'Déverrouiller'; }, attente * 1000);
    return;
  }
  const lignes = [], illisibles = [];
  for (const e of data.entrees) {
    try { lignes.push({ id: e.id, cree_le: e.cree_le, maj_le: e.maj_le, clair: await coffreDechiffrer(cle, e.iv, e.chiffre, aadLigne(e.id, e.version)) }); }
    catch (err) { illisibles.push(e.id); }
  }
  f.reset(); V.echecs = 0;
  V.cle = cle; V.version = k.version; V.lignes = lignes; coffreActivite();
  coffreTracer('coffre_deverrouille').catch(() => {});
  if (illisibles.length) toast(`${illisibles.length} ligne(s) illisible(s) : contactez un autre administrateur`, 'x');
  renderCoffre($('#admBody'));
}

/* ---------- tableau ---------- */
function coffreLigneHTML(l) {
  const lien = coffreLienSur(l.clair.u || ''), vu = V.vus.has(l.id);
  return `<div class="cf-row glass" data-ligne="${esc(l.id)}">
      <div class="cf-cell cf-usage" data-lab="Usage">${l.clair.n ? `<span class="cf-val">${esc(l.clair.n)}</span>` : '<span class="cf-val muted">À compléter</span>'}</div>
      <div class="cf-cell" data-lab="Identifiant"><span class="cf-val">${esc(l.clair.i || '')}</span>
        ${l.clair.i ? `<button class="icon-btn sm" type="button" data-cf-copier-id aria-label="Copier l'identifiant" title="Copier l'identifiant">${ic('copy')}</button>` : ''}</div>
      <div class="cf-cell" data-lab="Mot de passe"><span class="cf-val mono ${vu ? 'vu' : ''}">${vu ? esc(l.clair.p || '') : '••••••••••••'}</span>
        <button class="icon-btn sm" type="button" data-cf-voir aria-label="${vu ? 'Masquer' : 'Afficher'} le mot de passe" title="${vu ? 'Masquer' : 'Afficher 15 s'}">${ic('eye')}</button>
        <button class="icon-btn sm" type="button" data-cf-copier aria-label="Copier le mot de passe" title="Copier le mot de passe">${ic('copy')}</button></div>
      <div class="cf-cell" data-lab="URL de connexion">${lien ? `<a class="cf-val cf-url" href="${esc(lien)}" target="_blank" rel="noopener noreferrer">${esc(coffreHote(lien))}</a>` : `<span class="cf-val muted">${esc(l.clair.u || '')}</span>`}</div>
      <button class="icon-btn sm" type="button" data-cf-modifier aria-label="Modifier cette ligne" title="Modifier">${ic('edit')}</button>
    </div>`;
}
/* Une section par entité (Hympyr Energies, Granulés, Transport, puis « Non classé » pour les lignes d'avant le classement) */
function coffreLignesHTML() {
  const q = V.q.trim().toLowerCase();
  const list = V.lignes.filter(l => (V.entite === 'tout' || (l.clair.e || '') === V.entite) &&
      (!q || `${l.clair.n} ${l.clair.i} ${l.clair.u}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.clair.n || a.clair.i || '').localeCompare(b.clair.n || b.clair.i || '', 'fr', { sensitivity: 'base' }));
  if (!list.length) return `<div class="adm-empty glass">${V.lignes.length ? 'Aucune ligne ne correspond.' : 'Le coffre est vide. Ajoutez le premier mot de passe du Groupe.'}</div>`;
  const groupes = [...COFFRE_ENTITES, ['', 'Non classé']].map(([k, nom]) => [nom, list.filter(l => (l.clair.e || '') === k)]).filter(g => g[1].length);
  return groupes.map(([nom, ls]) => `<section class="cf-groupe">
      <h3 class="cf-titre">${esc(nom)} <span>${ls.length}</span></h3>
      <div class="cf-head" aria-hidden="true"><span>Usage</span><span>Identifiant</span><span>Mot de passe</span><span>URL de connexion</span><span></span></div>
      <div class="adm-list">${ls.map(coffreLigneHTML).join('')}</div></section>`).join('');
}
function coffreSegItems() {
  const n = k => V.lignes.filter(l => (l.clair.e || '') === k).length;
  const items = [['tout', `Tout (${V.lignes.length})`], ...COFFRE_ENTITES.map(([k, nom]) => [k, `${nom} (${n(k)})`])];
  if (n('')) items.push(['', `Non classé (${n('')})`]);
  return items;
}
function coffreTableHTML() {
  return `<div class="cf-bar glass" data-st>
      <span class="cf-ok">${ic('lock')}<span>Coffre ouvert · se verrouille après 5 min sans activité</span></span>
      <div class="adm-tools-r">
        <button class="btn ghost sm mag" type="button" data-cf-phrase>${ic('key')}<span>Changer la phrase secrète</span></button>
        <button class="btn sm mag" type="button" data-cf-verrouiller>${ic('lock')}<span>Verrouiller</span></button></div>
    </div>
    <div class="adm-tools" data-st>
      <input class="input" id="cfQ" type="search" placeholder="Rechercher un usage, un identifiant, une adresse" aria-label="Rechercher dans le coffre" autocomplete="off">
      <div class="adm-tools-r"><span class="muted" style="font-size:13px">${V.lignes.length} mot${V.lignes.length > 1 ? 's' : ''} de passe</span>
        <button class="btn sm mag" type="button" data-cf-ajouter>${ic('plus')}<span>Ajouter</span></button></div>
    </div>
    <div class="seg glass glide scroll cf-seg" id="cfSeg" role="tablist" aria-label="Entité du Groupe" data-st></div>
    <div id="cfList">${coffreLignesHTML()}</div>
    <p class="cf-note" data-st>Le presse-papiers est vidé 30 s après une copie. Affichages, copies et modifications sont enregistrés dans l'historique des actions.</p>`;
}
function bindCoffreTable() {
  const q = $('#cfQ'); if (q) { q.value = V.q; q.oninput = () => { V.q = q.value; $('#cfList').innerHTML = coffreLignesHTML(); }; }
  const sg = $('#cfSeg'); if (sg) seg(sg, coffreSegItems(), V.entite, v => { V.entite = v; rafraichirListe(); });
}
const ligneDe = el => V.lignes.find(l => l.id === el.closest('[data-ligne]')?.dataset.ligne);
function rafraichirListe() { const l = $('#cfList'); if (l) l.innerHTML = coffreLignesHTML(); }
// après un ajout ou un changement d'entité : compteurs du filtre et de la barre
function rafraichirTout() {
  if (!coffreSegItems().some(([k]) => k === V.entite)) V.entite = 'tout';
  const sg = $('#cfSeg'); if (sg) seg(sg, coffreSegItems(), V.entite, v => { V.entite = v; rafraichirListe(); });
  const compte = $('.cf-bar + .adm-tools .muted'); if (compte) compte.textContent = `${V.lignes.length} mot${V.lignes.length > 1 ? 's' : ''} de passe`;
  rafraichirListe();
}

async function coffreCopier(texte, action, id) {
  try { await navigator.clipboard.writeText(texte); } catch (e) { toast('Copie impossible dans ce navigateur', 'x'); return; }
  try { await coffreTracer(action, id); }
  catch (e) { navigator.clipboard.writeText('').catch(() => {}); toast('Copie annulée : la trace n\'a pas pu être enregistrée', 'x'); return; }
  toast(action === 'coffre_mot_de_passe_copie' ? 'Mot de passe copié (vidé dans 30 s)' : 'Identifiant copié (vidé dans 30 s)', 'copy');
  clearTimeout(V.pp);
  V.pp = setTimeout(function vider() {
    // writeText échoue si la page n'a pas le focus : on réessaie au retour sur la page
    navigator.clipboard.writeText('').catch(() => addEventListener('focus', vider, { once: true }));
  }, COFFRE.PRESSE_PAPIERS_MS);
}
document.addEventListener('click', async e => {
  if (!V.cle) return;
  const t = e.target.closest('[data-cf-voir],[data-cf-copier],[data-cf-copier-id],[data-cf-modifier],[data-cf-ajouter],[data-cf-verrouiller],[data-cf-phrase]');
  if (!t) return;
  if (t.matches('[data-cf-verrouiller]')) { coffreVerrouiller(); coffreTracer('coffre_verrouille').catch(() => {}); return; }
  if (t.matches('[data-cf-ajouter]')) { coffreEditer(null); return; }
  if (t.matches('[data-cf-phrase]')) { coffrePhrase(); return; }
  const l = ligneDe(t); if (!l) return;
  if (t.matches('[data-cf-modifier]')) { coffreEditer(l); return; }
  if (t.matches('[data-cf-copier-id]')) { coffreCopier(l.clair.i || '', 'coffre_identifiant_copie', l.id); return; }
  if (t.matches('[data-cf-copier]')) { coffreCopier(l.clair.p || '', 'coffre_mot_de_passe_copie', l.id); return; }
  if (t.matches('[data-cf-voir]')) {
    if (V.vus.has(l.id)) { clearTimeout(V.vus.get(l.id)); V.vus.delete(l.id); rafraichirListe(); return; }
    t.disabled = true;
    // la trace est enregistrée AVANT l'affichage : pas de trace, pas d'affichage
    try { await coffreTracer('coffre_mot_de_passe_affiche', l.id); }
    catch (err) { t.disabled = false; toast(err.message, 'x'); return; }
    V.vus.set(l.id, setTimeout(() => { V.vus.delete(l.id); rafraichirListe(); }, COFFRE.AFFICHAGE_MS));
    rafraichirListe();
  }
});

/* ---------- ajout, modification, suppression ---------- */
// Une fenêtre fermée garde son contenu dans la page : on l'efface pour qu'aucun clair n'y reste
function coffrePurgerModal(fermer) {
  const m = $('#ticketModal'); if (!m.querySelector('[data-coffre-modal]')) return;
  if (fermer) closeTicket();
  m.querySelectorAll('input').forEach(i => { i.value = ''; });
  m.innerHTML = '';
}
async function coffreFermer() { await closeTicket(); coffrePurgerModal(false); }
document.addEventListener('click', e => {
  if ((e.target.closest('[data-close]') || e.target.id === 'ticketOverlay') && $('#ticketModal [data-coffre-modal]')) setTimeout(() => coffrePurgerModal(false), 300);
});
addEventListener('keydown', e => { if (e.key === 'Escape' && $('#ticketModal [data-coffre-modal]')) setTimeout(() => coffrePurgerModal(false), 300); });
function coffreModal(html) {
  const ov = $('#ticketOverlay'), m = $('#ticketModal');
  m.classList.remove('wide'); m.innerHTML = `<div data-coffre-modal>${html}</div>`; ov.hidden = false;
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE });
  m.animate([{ opacity: 0, transform: 'translateY(18px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: EASE });
}
function coffreEditer(l) {
  // nouvelle ligne : l'entité affichée par le filtre est proposée par défaut
  const c = l ? l.clair : { n: '', e: COFFRE_ENTITES.some(x => x[0] === V.entite) ? V.entite : '', i: '', p: genMdp(20), u: '' };
  const entites = `<option value="">Choisir…</option>` + COFFRE_ENTITES.map(([k, nom]) => `<option value="${k}" ${c.e === k ? 'selected' : ''}>${esc(nom)}</option>`).join('');
  coffreModal(`<div class="modal-head"><div><span class="label">Mots de passe du Groupe</span>
      <h2 id="ticketTitle" style="margin-top:6px">${l ? 'Modifier la ligne' : 'Ajouter un mot de passe'}</h2>
      <p>Chiffré dans votre navigateur avant l'envoi.</p></div>
      <button class="icon-btn" data-close aria-label="Fermer">${ic('x')}</button></div>
    <form class="form" id="cfEdit" novalidate>
      <div class="adm-grid">
        <label class="field"><span>Entité</span><select class="input" id="cfE">${entites}</select></label>
        <label class="field"><span>Usage</span><input class="input" id="cfN" maxlength="80" autocomplete="off" value="${esc(c.n || '')}" placeholder="Pennylane, base Supabase, licence Office…"></label>
      </div>
      <label class="field"><span>Identifiant</span><input class="input" id="cfI" maxlength="300" autocomplete="off" spellcheck="false" value="${esc(c.i)}" placeholder="compta@hympyr.fr, numéro de licence…"></label>
      <div class="field"><span>Mot de passe</span><div class="adm-pwd">
        <input class="input" id="cfP" maxlength="1000" autocomplete="off" spellcheck="false" type="password" value="${esc(c.p)}" data-1p-ignore data-lpignore="true">
        <button class="icon-btn" type="button" data-cf-montrer aria-label="Afficher le mot de passe" title="Afficher">${ic('eye')}</button>
        <button class="icon-btn" type="button" data-cf-generer aria-label="Générer un mot de passe" title="Générer un mot de passe robuste">${ic('refresh')}</button></div></div>
      <label class="field"><span>URL de connexion</span><input class="input" id="cfU" maxlength="500" autocomplete="off" spellcheck="false" inputmode="url" value="${esc(c.u)}" placeholder="https://…"></label>
      <p class="msg" id="cfErr" role="alert"></p>
      <button class="btn block mag" type="submit" id="cfSave">${ic('check')}<span>Enregistrer</span></button>
    </form>
    ${l ? `<div class="adm-danger"><div><b>Supprimer la ligne</b><span>Définitif. La suppression est enregistrée dans l'historique.</span></div>
      <button class="btn ghost sm mag danger" type="button" data-cf-supprimer>${ic('trash')}<span>Supprimer</span></button>
      <p class="msg" id="cfDelMsg" role="status"></p></div>` : ''}`);
  const champP = $('#cfP');
  $('[data-cf-montrer]').onclick = () => { champP.type = champP.type === 'password' ? 'text' : 'password'; };
  $('[data-cf-generer]').onclick = () => { champP.value = genMdp(20); champP.type = 'text'; };
  $('#cfEdit').onsubmit = ev => { ev.preventDefault(); coffreEnregistrer(l); };
  const del = $('[data-cf-supprimer]'); if (del) del.onclick = () => coffreSupprimer(l, del);
  setTimeout(() => $(c.e ? '#cfN' : '#cfE').focus({ preventScroll: true }), 200);
}
async function coffreEnregistrer(l) {
  const err = $('#cfErr'), btn = $('#cfSave');
  let u = $('#cfU').value.trim();
  if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  const n = { e: $('#cfE').value, n: $('#cfN').value.trim(), i: $('#cfI').value.trim(), p: $('#cfP').value, u };
  if (!n.e) { setMsg(err, 'Choisissez l\'entité : Hympyr Energies, Granulés ou Transport.'); $('#cfE').focus(); return; }
  if (!n.n) { setMsg(err, 'Indiquez l\'usage : à quoi sert cet identifiant ?'); $('#cfN').focus(); return; }
  if (!n.p) { setMsg(err, 'Le mot de passe est vide.'); return; }
  const champs = l ? [['e', 'entite'], ['n', 'usage'], ['i', 'identifiant'], ['p', 'mot_de_passe'], ['u', 'url']].filter(([k]) => (l.clair[k] || '') !== n[k]).map(x => x[1]) : [];
  if (l && !champs.length) { await coffreFermer(); return; }
  const id = l ? l.id : crypto.randomUUID();
  btn.disabled = true; btn.lastChild.textContent = 'Chiffrement et envoi';
  try {
    const c = await coffreChiffrer(V.cle, n, aadLigne(id, V.version));
    await coffreRpc('portail_coffre_enregistrer', { p_id: id, p_version: V.version, p_iv: c.iv, p_chiffre: c.chiffre, p_champs: champs });
  } catch (e) { btn.disabled = false; btn.lastChild.textContent = 'Enregistrer'; setMsg(err, e.message); return; }
  if (l) l.clair = n; else V.lignes.push({ id, cree_le: new Date().toISOString(), clair: n });
  await coffreFermer(); rafraichirTout();
  toast(!l ? 'Mot de passe ajouté' : champs.includes('mot_de_passe') ? 'Mot de passe modifié et tracé' : 'Ligne modifiée');
}
async function coffreSupprimer(l, btn) {
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.lastChild.textContent = 'Confirmer la suppression'; setMsg($('#cfDelMsg'), 'Cliquez de nouveau pour supprimer définitivement cette ligne.'); return; }
  btn.disabled = true;
  try { await coffreRpc('portail_coffre_supprimer', { p_id: l.id }); }
  catch (e) { btn.disabled = false; setMsg($('#cfDelMsg'), e.message); return; }
  V.lignes = V.lignes.filter(x => x !== l);
  await coffreFermer(); renderCoffre($('#admBody')); toast('Ligne supprimée');
}

/* ---------- changement de la phrase secrète : nouveau sel, nouvelle clé, tout est rechiffré ---------- */
function coffrePhrase() {
  coffreModal(`<div class="modal-head"><div><span class="label">Mots de passe du Groupe</span>
      <h2 id="ticketTitle" style="margin-top:6px">Changer la phrase secrète</h2>
      <p>Les ${V.lignes.length} lignes sont rechiffrées avec une nouvelle clé. L'ancienne phrase ne pourra plus rien ouvrir.
        Prévenez les autres administrateurs : ils devront utiliser la nouvelle.</p></div>
      <button class="icon-btn" data-close aria-label="Fermer">${ic('x')}</button></div>
    <form class="form" id="cfPh" novalidate>
      <label class="field"><span>Phrase secrète actuelle</span><input class="input" id="cfA" ${PHRASE_ATTR}></label>
      <label class="field"><span>Nouvelle phrase secrète (${COFFRE.PHRASE_MIN} caractères minimum)</span><input class="input" id="cfN" ${PHRASE_ATTR}></label>
      <label class="field"><span>Confirmation</span><input class="input" id="cfN2" ${PHRASE_ATTR}></label>
      <p class="msg" id="cfPhErr" role="alert"></p>
      <button class="btn block mag" type="submit" id="cfPhBtn">${ic('key')}<span>Changer et rechiffrer</span></button>
    </form>`);
  $('#cfPh').onsubmit = ev => { ev.preventDefault(); coffreChangerPhrase(); };
  setTimeout(() => $('#cfA').focus({ preventScroll: true }), 200);
}
async function coffreChangerPhrase() {
  const a = $('#cfA').value, n = $('#cfN').value, n2 = $('#cfN2').value, err = $('#cfPhErr'), btn = $('#cfPhBtn');
  if (!phraseValide(n)) { setMsg(err, `Nouvelle phrase trop courte : ${COFFRE.PHRASE_MIN} caractères minimum, variés.`); return; }
  if (n !== n2) { setMsg(err, 'Les deux saisies de la nouvelle phrase ne correspondent pas.'); return; }
  if (n === a) { setMsg(err, 'Choisissez une phrase différente de l\'actuelle.'); return; }
  btn.disabled = true; btn.lastChild.textContent = 'Vérification';
  const fin = t => { btn.disabled = false; btn.lastChild.textContent = 'Changer et rechiffrer'; setMsg(err, t); };
  try {
    // 1. l'ancienne phrase est revérifiée : une session laissée ouverte ne suffit pas à changer la phrase
    const k = (await coffreRpc('portail_coffre_lire')).cle;
    if (k.version !== V.version) { fin('La phrase a déjà été changée par un autre administrateur : verrouillez puis rouvrez le coffre.'); return; }
    const ancienne = await coffreDeriver(a, deb64(k.sel), k.iterations);
    try { await coffreDechiffrer(ancienne, k.verif_iv, k.verif, aadVerif(k.version)); }
    catch (e) { coffreTracer('coffre_echec_phrase').catch(() => {}); fin('Phrase secrète actuelle incorrecte.'); return; }
    // 2. nouvelle clé et rechiffrement complet
    btn.lastChild.textContent = `Rechiffrement de ${V.lignes.length} ligne${V.lignes.length > 1 ? 's' : ''}`;
    const sel = crypto.getRandomValues(new Uint8Array(16)), v2 = V.version + 1;
    const cle = await coffreDeriver(n, sel, COFFRE.ITER);
    const verif = await coffreChiffrer(cle, { t: VERIF }, aadVerif(v2));
    const entrees = [];
    for (const l of V.lignes) entrees.push({ id: l.id, ...(await coffreChiffrer(cle, l.clair, aadLigne(l.id, v2))) });
    await coffreRpc('portail_coffre_changer_phrase', { p_version: V.version, p_iterations: COFFRE.ITER, p_sel: b64(sel),
      p_verif_iv: verif.iv, p_verif: verif.chiffre, p_entrees: entrees });
    V.cle = cle; V.version = v2;
  } catch (e) { fin(e.message || 'Changement impossible.'); return; }
  $('#cfPh').reset();
  await coffreFermer(); toast('Phrase secrète changée, coffre rechiffré');
}
