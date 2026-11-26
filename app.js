/* =========================================================
   PORTAIL HYMPYR · V1
   - Connexion Supabase Auth (même session que la charte et le pilotage : même origine, même clé de stockage)
   - Liste des outils autorisés via la fonction SQL portail_mes_outils() (la sécurité reste dans chaque outil)
   - Journal d'usage (portail_journal) et tickets (portail_tickets)
   Aucune dépendance hors supabase-js. Code vanilla, comme les autres outils.
   ========================================================= */
'use strict';

const CFG = window.PORTAIL_CONFIG || {};
let sb = null;
try {
  sb = window.supabase.createClient(CFG.SB_URL, CFG.SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
} catch (e) { sb = null; }

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const EASE = 'cubic-bezier(.22,1,.36,1)';
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = matchMedia('(hover:hover) and (pointer:fine)').matches;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
// Animation.done : promesse qui se résout même si l'animation est annulée (repris de la charte)
Object.defineProperty(Animation.prototype, 'done', { get() {
  const t = this.effect && this.effect.getTiming ? this.effect.getTiming() : {};
  return Promise.race([this.finished.catch(() => {}), new Promise(r => setTimeout(r, (+t.duration || 300) + (+t.delay || 0) + 150))]);
} });

/* ---------- icônes (trait 24 px, même style que la charte) ---------- */
const I = {
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10.5" cy="7" r="1.1"/><circle cx="15" cy="7.5" r="1.1"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>'
};
const ic = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || I.tool}</svg>`;
// Icône par outil ; un outil ajouté au catalogue sans entrée ici prend l'icône générique
// Libellé court pour la barre mobile (11 px, une ligne)
const TOOL_SHORT = { cockpit_appels: 'Appels', cockpit_granules: 'Granulés', renommage_tournees: 'Tournées', pilotage_communication: 'Com', charte: 'Charte' };
const TOOL_ICON = { cockpit_appels: 'phone', cockpit_granules: 'calc', renommage_tournees: 'file', pilotage_communication: 'calendar', charte: 'palette' };
const ROLE_LABEL = { admin: 'Administrateur', manager: 'Manager', commercial: 'Commercial', direction: 'Direction', responsable: 'Responsable', editeur: 'Éditeur', lecteur: 'Lecteur', membre: 'Membre' };
const POLE_LABEL = { commercial: 'Commercial', logistique: 'Logistique', pilotage: 'Pilotage', communication: 'Communication', comptable: 'Comptabilité' };
const POLE_FILTER_FROM = 9; // décision du 24/11 : filtre par pôle seulement au-delà de 8 outils

/* ---------- aides d'animation et de contrôles (reprises de la charte) ---------- */
function stagger(scope) {
  $$('[data-st]', scope).filter(k => !k.hidden && k.offsetParent !== null).slice(0, 10)
    .forEach((k, i) => k.animate([{ opacity: 0, transform: `translateY(${RM ? 0 : 16}px)` }, { opacity: 1, transform: 'none' }],
      { duration: RM ? 200 : 560, delay: RM ? 0 : 60 + i * 55, easing: EASE, fill: 'backwards' }));
}
function place(pill, btn, instant) {
  if (!pill) return;
  if (!btn) { pill.style.opacity = 0; return; }
  if (instant) pill.classList.add('no-tr');
  pill.style.opacity = '';
  pill.style.width = btn.offsetWidth + 'px'; pill.style.height = btn.offsetHeight + 'px';
  pill.style.transform = `translate(${btn.offsetLeft}px,${btn.offsetTop}px)`;
  if (instant) { void pill.offsetWidth; pill.classList.remove('no-tr'); }
}
function setupGlide(box) {
  if (box._glide) return; box._glide = true;
  const g = document.createElement('span'); g.className = 'glider'; box.prepend(g);
  let shown = false;
  box.addEventListener('pointerover', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    if (b.classList.contains('on')) { g.style.opacity = 0; shown = false; return; }
    if (!FINE) return;
    place(g, b, !shown); g.style.opacity = 1; shown = true;
  });
  box.addEventListener('pointerleave', () => { g.style.opacity = 0; shown = false; });
}
function setupInd(box) {
  if (box._ind) return box._ind;
  const p = document.createElement('span'); p.className = 'ind'; box.prepend(p); box._ind = p; return p;
}
function seg(box, items, active, onPick) {
  box.innerHTML = items.map(([v, l]) => `<button type="button" data-v="${esc(v)}" role="tab" aria-selected="${v === active}" class="${v === active ? 'on' : ''}"><span>${esc(l)}</span></button>`).join('');
  box._ind = null; box._glide = false; setupInd(box); setupGlide(box);
  requestAnimationFrame(() => place(box._ind, $('button.on', box), true));
  box.onclick = e => {
    const b = e.target.closest('button[data-v]'); if (!b || b.classList.contains('on')) return;
    $$('button[data-v]', box).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    place(box._ind, b, false); onPick(b.dataset.v);
  };
}
addEventListener('resize', () => $$('.seg,.tabs').forEach(b => { if (b._ind) place(b._ind, $('button.on', b), true); }));

/* effet magnétique des boutons (charte : composants) */
let magEl = null;
if (FINE) {
  document.addEventListener('pointermove', e => {
    const el = e.target.closest('.btn,.icon-btn,.mag');
    if (el !== magEl) { if (magEl) magEl.style.transform = ''; magEl = el; }
    if (!el) return;
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px');
    if (el.classList.contains('mag') && !RM) el.style.transform = `translate(${((x - r.width / 2) / r.width * 8).toFixed(2)}px,${((y - r.height / 2) / r.height * 6).toFixed(2)}px)`;
  }, { passive: true });
}

let toastT;
function toast(msg, icon = 'check') {
  const t = $('#toast'); t.innerHTML = ic(icon) + `<span>${esc(msg)}</span>`; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function setMsg(el, txt, kind = 'err') {
  el.className = 'msg ' + kind; el.textContent = txt;
  if (txt) el.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE });
}

/* ---------- thème : fondu enchaîné court de toute la page ----------
   Les transitions CSS sont coupées pendant la bascule : sans ça, les couleurs glissaient une à une
   après le fondu, d'où l'effet « en deux temps » relevé le 24/11. */
function syncTheme() { $('#themeBtn').setAttribute('aria-label', root.dataset.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'); }
function setTheme(next) {
  const apply = () => { root.dataset.theme = next; store.set('hy-theme', next); syncTheme(); renderLogos(); };
  root.classList.add('theme-switch');
  const fin = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switch')));
  if (!document.startViewTransition || RM) { apply(); fin(); return; }
  root.classList.add('vt-fade');
  const vt = document.startViewTransition(apply);
  vt.finished.finally(() => { root.classList.remove('vt-fade'); fin(); });
}
$('#themeBtn').onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');

/* ---------- logo du groupe (fichiers officiels fond clair / fond sombre) ---------- */
function logoHTML() {
  const src = root.dataset.theme === 'dark' ? 'assets/groupe-dark.svg' : 'assets/groupe-light.svg';
  return `<img class="logo-img" src="${src}" alt="Hympyr">`;
}
function renderLogos() { $$('[data-logo]').forEach(l => { l.innerHTML = logoHTML(); }); }

/* =========================================================
   DONNÉES
   ========================================================= */
const S = { user: null, nom: '', outils: [], usage: {}, view: 'outils', pole: 'tous', admin: false };

async function loadOutils() {
  const { data, error } = await sb.rpc('portail_mes_outils');
  if (error) throw error;
  return data || [];
}
async function loadMoi() {
  const { data } = await sb.rpc('portail_moi');
  return (data && data[0] && data[0].nom) || '';
}
/* Ouvertures des 30 derniers jours : sert à classer les raccourcis mobiles et aux chiffres de l'accueil */
async function loadAdminFlag() {
  const { data } = await sb.rpc('portail_est_admin');
  return data === true;
}
async function loadUsage() {
  const depuis = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data, error } = await sb.from('portail_journal').select('outil_slug,le').eq('evenement', 'ouverture_outil').gte('le', depuis);
  if (error) return { parOutil: {}, semaine: 0 };
  const parOutil = {}; let semaine = 0; const limite = Date.now() - 7 * 864e5;
  data.forEach(r => { parOutil[r.outil_slug] = (parOutil[r.outil_slug] || 0) + 1; if (Date.parse(r.le) >= limite) semaine++; });
  return { parOutil, semaine };
}
/* Journal : best effort, ne bloque jamais l'utilisateur plus de 800 ms */
function journal(evenement, outil_slug = null) {
  if (!sb || !S.user) return Promise.resolve();
  const ins = sb.from('portail_journal').insert({ evenement, outil_slug }).then(() => {}, () => {});
  return Promise.race([ins, new Promise(r => setTimeout(r, 800))]);
}

/* =========================================================
   RENDU
   ========================================================= */
const prenom = () => (S.nom || (S.user?.email || '').split('@')[0].split(/[._-]/)[0] || '').replace(/^./, c => c.toUpperCase());
const dateFr = () => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function renderHero() {
  $('#heroDate').textContent = dateFr();
  $('#hello').textContent = `Bonjour ${prenom()}`;
  const n = S.outils.length;
  $('#heroLead').textContent = n
    ? `Vos ${n} outil${n > 1 ? 's' : ''} Hympyr sont à un clic. Une seule connexion vaut pour tous.`
    : 'Aucun outil ne vous est encore attribué.';
  $('#heroStats').innerHTML =
    `<div class="stat"><b>${n}</b><span>outil${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}</span></div>` +
    `<div class="stat"><b>${S.usage.semaine || 0}</b><span>ouverture${(S.usage.semaine || 0) > 1 ? 's' : ''} sur 7 jours</span></div>`;
}

function toolHTML(o) {
  const role = ROLE_LABEL[o.role] || o.role;
  return `<a class="tool tile glass mag" href="${esc(o.url)}" data-slug="${esc(o.slug)}" data-marque="${esc(o.marque)}" data-st>
    <span class="t-bar" aria-hidden="true"></span>
    <div class="t-top"><span class="t-mark">${ic(TOOL_ICON[o.slug])}</span><span class="t-role">${esc(role)}</span></div>
    <h3>${esc(o.nom)}</h3>
    <p>${esc(o.description)}</p>
    <div class="t-foot"><span>${esc(POLE_LABEL[o.pole] || o.pole || '')}</span><span class="t-go"><span>Ouvrir</span>${ic('arrow')}</span></div>
  </a>`;
}
function renderTools() {
  const list = S.pole === 'tous' ? S.outils : S.outils.filter(o => o.pole === S.pole);
  $('#tools').innerHTML = list.length ? list.map(toolHTML).join('')
    : `<div class="tools-empty glass" data-st><h3>Aucun outil pour l'instant</h3><p class="muted" style="margin-top:6px">Demandez un accès avec le bouton ci-dessous : l'administrateur l'ouvre depuis Supabase.</p></div>`;
  stagger($('#tools'));
}
function renderPoles() {
  const box = $('#poleSeg');
  const poles = [...new Set(S.outils.map(o => o.pole).filter(Boolean))];
  box.hidden = S.outils.length < POLE_FILTER_FROM || poles.length < 2;
  if (box.hidden) return;
  seg(box, [['tous', 'Tous'], ...poles.map(p => [p, POLE_LABEL[p] || p])], S.pole, v => { S.pole = v; renderTools(); });
}
function renderAccount() {
  $('#accName').textContent = S.nom || prenom();
  $('#accEmail').textContent = S.user.email;
  $('#accRoles').innerHTML = S.outils.map(o => `<span class="pill">${esc(o.nom)} · ${esc(ROLE_LABEL[o.role] || o.role)}</span>`).join('');
  $('#accAdmin').hidden = !S.admin;
}

/* Navigation : 2 onglets sur ordinateur ; sur mobile, barre de 5 icônes max (charte, Créations > Outils) :
   les outils les plus ouverts autour de l'accueil central mis en avant, puis Mon compte */
const TABS = [{ k: 'outils', l: 'Mes outils', i: 'grid' }, { k: 'compte', l: 'Mon compte', i: 'user' }];
const tabsVisibles = () => S.admin ? [...TABS, { k: 'admin', l: 'Administration', i: 'shield' }] : TABS;
function renderNav() {
  const tabs = $('#tabs');
  tabs.innerHTML = tabsVisibles().map(t => `<button type="button" data-tab="${t.k}" class="${t.k === S.view ? 'on' : ''}" aria-current="${t.k === S.view ? 'page' : 'false'}">${ic(t.i)}<span>${t.l}</span></button>`).join('');
  tabs._ind = null; tabs._glide = false; setupInd(tabs); setupGlide(tabs);
  requestAnimationFrame(() => place(tabs._ind, $('button.on', tabs), true));
  tabs.onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); };

  const top = [...S.outils].sort((a, b) => (S.usage.parOutil?.[b.slug] || 0) - (S.usage.parOutil?.[a.slug] || 0)).slice(0, 3);
  const short = o => `<a class="bb" href="${esc(o.url)}" data-slug="${esc(o.slug)}" aria-label="${esc(o.nom)}">${ic(TOOL_ICON[o.slug])}<span>${esc(TOOL_SHORT[o.slug] || o.nom.split(' ')[0])}</span></a>`;
  const items = [
    ...top.slice(0, 2).map(short),
    `<button type="button" class="bb main ${S.view === 'outils' ? 'on' : ''}" data-tab="outils" aria-label="Mes outils">${ic('grid')}<span>Outils</span></button>`,
    ...top.slice(2, 3).map(short),
    `<button type="button" class="bb ${S.view === 'compte' ? 'on' : ''}" data-tab="compte" aria-label="Mon compte">${ic('user')}<span>Compte</span></button>`
  ];
  $('#bottombar').innerHTML = items.join('');
  $('#bottombar').onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); };
}
async function go(view) {
  if (view === S.view) return;
  const from = $(`#v-${S.view}`), to = $(`#v-${view}`);
  S.view = view; history.replaceState(null, '', '#' + view);
  $$('#tabs button[data-tab]').forEach(b => { const on = b.dataset.tab === view; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  place($('#tabs')._ind, $('#tabs button.on'), false);
  $$('#bottombar button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === view));
  $$('.scene').forEach(s => s.classList.toggle('on', s.dataset.scene === view));
  await from.animate([{ opacity: 1 }, { opacity: 0, transform: `translateY(${RM ? 0 : -6}px)` }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).done;
  from.hidden = true; from.getAnimations().forEach(a => a.cancel());
  to.hidden = false; scrollTo({ top: 0, behavior: 'instant' }); stagger(to);
  if (view === 'admin') openAdmin();
}

/* Ouverture d'un outil : on journalise puis on navigue dans le même onglet (Ctrl/Cmd+clic : nouvel onglet) */
document.addEventListener('click', async e => {
  const a = e.target.closest('a[data-slug]'); if (!a) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) { journal('ouverture_outil', a.dataset.slug); return; }
  e.preventDefault(); a.classList.add('opening');
  await journal('ouverture_outil', a.dataset.slug);
  location.href = a.href;
});

/* =========================================================
   TICKETS
   ========================================================= */
let ticketType = 'question';
function ticketFormHTML() {
  const opts = S.outils.map(o => `<option value="${esc(o.slug)}">${esc(o.nom)}</option>`).join('');
  return `<div class="modal-head"><div><span class="label">Support</span><h2 id="ticketTitle" style="margin-top:6px">Envoyer un ticket</h2>
    <p>Une question, une erreur, une idée ou un accès à demander : réponse sous 48 h ouvrées.</p></div>
    <button class="icon-btn" data-close aria-label="Fermer">${ic('x')}</button></div>
    <form class="form" id="ticketForm" novalidate>
      <div class="field"><span>Type de demande</span><div class="seg glass glide scroll" id="ticketSeg" style="align-self:flex-start;background:var(--glass-2)"></div></div>
      <label class="field"><span>Outil concerné</span><select class="input" id="tOutil"><option value="">Le portail ou plusieurs outils</option>${opts}</select></label>
      <label class="field"><span>Sujet</span><input class="input" id="tSujet" maxlength="140" placeholder="Résumez votre demande en une phrase"></label>
      <label class="field"><span>Message</span><textarea class="input" id="tMsg" maxlength="4000" placeholder="Écran concerné, ce que vous attendiez, ce qui s'est passé."></textarea></label>
      <p class="msg" id="tErr" role="alert"></p>
      <button class="btn block mag" type="submit" id="tSend">${ic('send')}<span>Envoyer le ticket</span></button>
    </form>`;
}
function openTicket(type) {
  if (type) ticketType = type;
  const ov = $('#ticketOverlay'), m = $('#ticketModal');
  m.classList.remove('wide'); m.innerHTML = ticketFormHTML(); ov.hidden = false;
  seg($('#ticketSeg'), [['question', 'Question'], ['erreur', 'Erreur'], ['suggestion', 'Suggestion'], ['acces', 'Accès']], ticketType, v => { ticketType = v; });
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE });
  m.animate([{ opacity: 0, transform: 'translateY(18px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: EASE });
  setTimeout(() => $('#tSujet').focus({ preventScroll: true }), 200);
  $('#ticketForm').onsubmit = sendTicket;
}
async function closeTicket() {
  const ov = $('#ticketOverlay'); if (ov.hidden || ov._c) return; ov._c = 1;
  await ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).done;
  ov.hidden = true; ov._c = 0; ov.getAnimations().forEach(a => a.cancel());
}
async function sendTicket(e) {
  e.preventDefault();
  const s = $('#tSujet'), m = $('#tMsg'), err = $('#tErr');
  const sujet = s.value.trim(), message = m.value.trim();
  if (sujet.length < 3) { setMsg(err, 'Ajoutez un sujet de trois caractères minimum.'); s.focus(); return; }
  if (message.length < 5) { setMsg(err, 'Décrivez votre demande en quelques mots.'); m.focus(); return; }
  const btn = $('#tSend'); btn.disabled = true; btn.lastChild.textContent = 'Envoi en cours';
  const { error } = await sb.from('portail_tickets').insert({ type: ticketType, sujet, message, outil_slug: $('#tOutil').value || null });
  if (error) { btn.disabled = false; btn.lastChild.textContent = 'Envoyer le ticket'; setMsg(err, 'Envoi impossible pour le moment. Vérifiez votre connexion puis réessayez.'); return; }
  $('#ticketModal').innerHTML = `<div class="sent"><span class="ok-c"><svg class="i" viewBox="0 0 24 24">${I.check}</svg></span><h2>Ticket envoyé</h2>
    <p class="muted">Réponse sous 48 h ouvrées à l'adresse ${esc(S.user.email)}.</p><button class="btn mag" data-close style="margin-top:8px">Fermer</button></div>`;
}
$('#ticketBtn').onclick = () => openTicket();
document.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) closeTicket();
  const t = e.target.closest('[data-ticket]'); if (t) openTicket(t.dataset.ticket);
});
$('#ticketOverlay').addEventListener('click', e => { if (e.target.id === 'ticketOverlay') closeTicket(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeTicket(); });

/* =========================================================
   ADMINISTRATION (administrateurs du portail)
   La sécurité est en base : RLS sur portail_collaborateurs / portail_acces / portail_outils, fonction portail_admin_comptes().
   On désactive un collaborateur, on ne le supprime jamais (la suppression ne serait pas recopiée dans les outils).
   ========================================================= */
const TICKET_TYPE = { question: 'Question', erreur: 'Erreur', suggestion: 'Suggestion', acces: 'Accès' };
const TICKET_STATUT = [['ouvert', 'Ouvert'], ['en_cours', 'En cours'], ['resolu', 'Résolu']];
const A = { tab: 'acces', q: '', collab: [], acces: [], outils: [], comptes: [], tickets: [], comptesOk: true, loaded: false };
const dCourt = v => v ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)) : '';
const nomCollab = c => [c.prenom, c.nom].filter(Boolean).join(' ') || c.email.split('@')[0];

async function loadAdmin() {
  const [co, ac, ou, cp, tk] = await Promise.all([
    sb.from('portail_collaborateurs').select('*'),
    sb.from('portail_acces').select('*'),
    sb.from('portail_outils').select('slug,nom,description,roles_possibles,ordre,statut').order('ordre'),
    sb.rpc('portail_admin_comptes'),
    sb.from('portail_tickets').select('*').order('cree_le', { ascending: false }).limit(200)
  ]);
  if (co.error || ac.error || ou.error) throw (co.error || ac.error || ou.error);
  A.collab = co.data; A.acces = ac.data; A.outils = ou.data.filter(o => o.statut !== 'archive');
  A.comptesOk = !cp.error; A.comptes = cp.data || [];
  A.tickets = tk.data || []; A.loaded = true;
}
async function openAdmin() {
  const body = $('#admBody');
  if (!A.loaded) body.innerHTML = `<div class="adm-empty glass">Chargement…</div>`;
  try { await loadAdmin(); } catch (e) { body.innerHTML = `<div class="adm-empty glass">Chargement impossible. Rechargez la page.</div>`; return; }
  const ouverts = A.tickets.filter(t => t.statut !== 'resolu').length;
  seg($('#admSeg'), [['acces', 'Collaborateurs'], ['outils', 'Outils'], ['tickets', `Tickets${ouverts ? ' (' + ouverts + ')' : ''}`]], A.tab, v => { A.tab = v; renderAdmin(); });
  renderAdmin();
}
function renderAdmin() {
  const body = $('#admBody');
  body.innerHTML = A.tab === 'tickets' ? ticketsAdminHTML() : A.tab === 'outils' ? outilsAdminHTML() : accesAdminHTML();
  const q = $('#admQ'); if (q) { q.value = A.q; q.oninput = () => { A.q = q.value; $('#admList').innerHTML = collabRowsHTML(); }; }
  stagger(body);
}
function collabRowsHTML() {
  const q = A.q.trim().toLowerCase();
  const list = A.collab.filter(c => !q || (nomCollab(c) + ' ' + c.email + ' ' + (c.pole || '')).toLowerCase().includes(q))
    .sort((a, b) => (b.actif - a.actif) || nomCollab(a).localeCompare(nomCollab(b), 'fr'));
  if (!list.length) return `<div class="adm-empty glass">Aucun collaborateur ne correspond.</div>`;
  const vu = Object.fromEntries(A.comptes.map(c => [c.user_id, c.derniere_connexion]));
  return list.map(c => {
    const acc = A.outils.map(o => [o, A.acces.find(a => a.user_id === c.user_id && a.outil_slug === o.slug)]).filter(x => x[1]);
    const chips = acc.length ? acc.map(([o, a]) => `<span class="pill">${esc(o.nom)} · ${esc(ROLE_LABEL[a.role] || a.role)}${a.expire_le ? ' · jusqu\'au ' + esc(dCourt(a.expire_le)) : ''}</span>`).join('')
      : `<span class="pill none">Aucun outil</span>`;
    const meta = [POLE_LABEL[c.pole] || c.pole, c.admin_portail ? 'Administrateur du portail' : '', !c.actif ? 'Désactivé' : '',
      vu[c.user_id] ? 'Vu le ' + dCourt(vu[c.user_id]) : (A.comptesOk ? 'Jamais connecté' : '')].filter(Boolean).join(' · ');
    return `<div class="adm-row glass ${c.actif ? '' : 'off'}" data-st>
      <div class="adm-who"><b>${esc(nomCollab(c))}</b><span>${esc(c.email)}</span><span class="adm-meta">${esc(meta)}</span></div>
      <div class="adm-acc">${chips}</div>
      <button class="btn ghost sm mag" type="button" data-edit="${esc(c.user_id)}">Modifier</button>
    </div>`;
  }).join('');
}
function accesAdminHTML() {
  const rattaches = new Set(A.collab.map(c => c.user_id));
  const libres = A.comptes.filter(c => !rattaches.has(c.user_id));
  const libresHTML = !A.comptesOk
    ? `<div class="adm-empty glass">Liste des comptes indisponible : exécutez le fichier SQL « 5_ecran_administration.sql » dans Supabase.</div>`
    : libres.length ? `<div class="adm-list">${libres.map(c => `<div class="adm-row glass" data-st>
        <div class="adm-who"><b>${esc(c.email)}</b><span class="adm-meta">Compte créé le ${esc(dCourt(c.cree_le))}${c.confirme ? '' : ' · invitation non acceptée'}</span></div>
        <div class="adm-acc"><span class="pill none">Pas encore dans le portail</span></div>
        <button class="btn sm mag" type="button" data-add="${esc(c.user_id)}">Ajouter</button></div>`).join('')}</div>`
    : `<div class="adm-empty glass">Tous les comptes sont rattachés au portail.</div>`;
  return `<div class="adm-tools" data-st>
      <input class="input" id="admQ" type="search" placeholder="Rechercher un nom, une adresse, un pôle" aria-label="Rechercher un collaborateur">
      <div class="adm-tools-r"><span class="muted" style="font-size:13px">${A.collab.filter(c => c.actif).length} collaborateurs actifs</span>
        <button class="btn sm mag" type="button" data-new>${ic('plus')}<span>Nouveau collaborateur</span></button></div>
    </div>
    <div class="adm-list" id="admList">${collabRowsHTML()}</div>
    ${libres.length || !A.comptesOk ? `<div class="adm-sec">
      <h3 data-st>Comptes sans fiche portail</h3>
      <p data-st>Comptes de connexion existants qui n'apparaissent pas encore dans le portail. Cliquez sur « Ajouter » pour leur attribuer des outils.</p>
      ${libresHTML}
    </div>` : ''}`;
}
/* --- outils : nom et description affichés (l'identifiant et l'adresse ne changent pas, voir sql/9_renommer_outils.sql) --- */
function outilsAdminHTML() {
  return `<p class="muted adm-intro" data-st>Le nom et la description apparaissent sur les cartes « Mes outils », dans les fiches collaborateurs et les tickets.
      L'adresse de l'outil et les droits ne changent pas.</p>
    <div class="adm-list">${A.outils.map(o => `<form class="adm-row adm-outil glass" data-st data-outil-form="${esc(o.slug)}" novalidate>
      <label class="field"><span>Nom affiché</span><input class="input" name="nom" required minlength="2" maxlength="40" value="${esc(o.nom)}"></label>
      <label class="field"><span>Description</span><input class="input" name="description" maxlength="160" value="${esc(o.description || '')}"></label>
      <button class="btn ghost sm mag" type="submit">${ic('check')}<span>Enregistrer</span></button>
      <p class="msg" role="status" aria-live="polite"></p>
    </form>`).join('')}</div>`;
}
async function saveOutil(f) {
  const o = A.outils.find(x => x.slug === f.dataset.outilForm); if (!o) return;
  const nom = f.nom.value.trim(), description = f.description.value.trim(), msg = $('.msg', f), btn = $('button', f);
  if (nom.length < 2) { setMsg(msg, 'Le nom doit faire au moins 2 caractères.'); f.nom.focus(); return; }
  if (nom === o.nom && description === (o.description || '')) { setMsg(msg, 'Aucune modification.', 'ok'); return; }
  btn.disabled = true;
  // .select() : sans droit d'écriture, la RLS ne renvoie aucune ligne au lieu d'une erreur
  const { data, error } = await sb.from('portail_outils').update({ nom, description: description || null }).eq('slug', o.slug).select('slug,nom,description');
  btn.disabled = false;
  if (error || !data?.length) {
    setMsg(msg, error?.code === '23514' ? 'Nom de 2 à 40 caractères, description de 160 caractères au plus.'
      : !error || error.code === '42501' ? 'Modification refusée : exécutez le fichier SQL « 9_renommer_outils.sql » dans Supabase.'
      : 'Enregistrement impossible. Réessayez.');
    return;
  }
  Object.assign(o, data[0]);
  // la vue « Mes outils » et « Mon compte » prennent le nouveau nom sans recharger la page
  S.outils.forEach(x => { if (x.slug === o.slug) { x.nom = o.nom; x.description = o.description; } });
  renderTools(); renderAccount();
  setMsg(msg, '', 'ok'); toast(`Outil renommé : ${o.nom}`);
}
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-outil-form]'); if (!f) return;
  e.preventDefault(); saveOutil(f);
});

function ticketsAdminHTML() {
  if (!A.tickets.length) return `<div class="adm-empty glass" data-st>Aucun ticket pour l'instant.</div>`;
  const nomOutil = s => (A.outils.find(o => o.slug === s) || {}).nom || 'Portail';
  return `<div class="adm-list">${A.tickets.map(t => `<div class="tk-row glass" data-st>
      <div><div class="tk-meta"><span class="pill ${t.type === 'erreur' ? 'warn' : ''}">${esc(TICKET_TYPE[t.type] || t.type)}</span>
        <span>${esc(nomOutil(t.outil_slug))} · ${esc(t.auteur_email || '')} · ${esc(dCourt(t.cree_le))}</span></div>
        <h4>${esc(t.sujet)}</h4><p>${esc(t.message)}</p></div>
      <label class="field"><span>Statut</span><select class="input" data-ticket-statut="${t.id}">
        ${TICKET_STATUT.map(([v, l]) => `<option value="${v}" ${v === t.statut ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>`).join('')}</div>`;
}

/* --- fiche collaborateur (création ou modification) --- */
function editHTML(c, isNew) {
  const poles = Object.entries(POLE_LABEL).map(([v, l]) => `<option value="${v}" ${c.pole === v ? 'selected' : ''}>${l}</option>`).join('');
  const lignes = A.outils.map(o => {
    const a = A.acces.find(x => x.user_id === c.user_id && x.outil_slug === o.slug) || {};
    const opts = `<option value="">Aucun accès</option>` + o.roles_possibles.map(r => `<option value="${esc(r)}" ${a.role === r ? 'selected' : ''}>${esc(ROLE_LABEL[r] || r)}</option>`).join('');
    return `<div class="adm-acl-row"><b>${esc(o.nom)}</b>
      <select class="input" data-acl="${esc(o.slug)}" aria-label="Rôle pour ${esc(o.nom)}">${opts}</select>
      <input class="input" type="date" data-exp="${esc(o.slug)}" value="${a.expire_le ? a.expire_le.slice(0, 10) : ''}" ${a.role ? '' : 'disabled'} aria-label="Fin d'accès à ${esc(o.nom)} (facultatif)"></div>`;
  }).join('');
  const moi = c.user_id === S.user.id, creation = !!c.creation;
  const titre = creation ? 'Nouveau collaborateur' : isNew ? c.email : nomCollab(c);
  const compte = creation ? `<div class="adm-grid">
        <label class="field"><span>Adresse e-mail professionnelle</span><input class="input" id="aEmail" type="email" autocomplete="off" placeholder="prenom.nom@hympyr.fr"></label>
        <div class="field"><span>Mot de passe temporaire</span><div class="adm-pwd"><input class="input" id="aPwd" autocomplete="off" spellcheck="false" value="${esc(genMdp())}">
          <button class="icon-btn" type="button" data-regen aria-label="Générer un autre mot de passe" title="Générer un autre mot de passe">${ic('refresh')}</button></div></div>
      </div>
      <p class="muted" style="font-size:13px;margin-top:-6px">La personne devra choisir son propre mot de passe à sa première connexion.</p>` : '';
  const actions = creation || isNew ? '' : `<div class="adm-danger">
      <div class="adm-pwd-block"><b>Nouveau mot de passe</b><span>Saisissez-le ou générez-en un. ${moi ? 'Il remplace le vôtre immédiatement.' : 'La personne devra le changer à sa prochaine connexion.'}</span>
        <div class="adm-pwd"><input class="input" id="aPwdReset" autocomplete="off" spellcheck="false" value="${esc(genMdp())}" aria-label="Nouveau mot de passe">
          <button class="icon-btn" type="button" data-regen-reset aria-label="Générer un autre mot de passe" title="Générer un autre mot de passe">${ic('refresh')}</button></div>
        <span class="adm-hint">${MDP_REGLE}.</span></div>
      <button class="btn ghost sm mag" type="button" data-pwd-reset>${ic('key')}<span>Définir</span></button>
      ${moi ? '' : `<div><b>Supprimer le compte</b><span>Retire tous ses accès dans les outils puis supprime son compte de connexion. Définitif.</span></div>
      <button class="btn ghost sm mag danger" type="button" data-delete>${ic('trash')}<span>Supprimer</span></button>`}
      <p class="msg" id="aActMsg" role="status" aria-live="polite"></p>
    </div>`;
  return `<div class="modal-head"><div><span class="label">${creation ? 'Administration' : isNew ? 'Nouveau collaborateur' : 'Collaborateur'}</span>
      <h2 id="ticketTitle" style="margin-top:6px">${esc(titre)}</h2>${creation ? '' : `<p>${esc(c.email)}</p>`}</div>
      <button class="icon-btn" data-close aria-label="Fermer">${ic('x')}</button></div>
    <form class="form" id="admForm" novalidate>
      ${compte}
      <div class="adm-grid">
        <label class="field"><span>Prénom</span><input class="input" id="aPrenom" maxlength="60" value="${esc(c.prenom || '')}"></label>
        <label class="field"><span>Nom</span><input class="input" id="aNom" maxlength="60" value="${esc(c.nom || '')}"></label>
        <label class="field"><span>Pôle</span><select class="input" id="aPole"><option value="">Non renseigné</option>${poles}</select></label>
      </div>
      <div class="adm-checks">
        <label ${creation ? 'hidden' : ''}><input type="checkbox" id="aActif" ${c.actif !== false ? 'checked' : ''} ${moi ? 'disabled' : ''}> Compte actif</label>
        <label><input type="checkbox" id="aAdmin" ${c.admin_portail ? 'checked' : ''} ${moi ? 'disabled' : ''}> Administrateur du portail</label>
      </div>
      ${moi ? '<p class="muted" style="font-size:13px">Vous ne pouvez pas retirer vos propres droits d\'administrateur.</p>' : ''}
      <div class="field"><span>Outils et rôles</span>
        <div class="adm-acl-head"><span>Outil</span><span>Rôle</span><span>Fin d'accès (facultatif)</span></div>
        <div class="adm-acl">${lignes}</div></div>
      <p class="msg" id="aErr" role="alert"></p>
      <button class="btn block mag" type="submit" id="aSave">${ic('check')}<span>${creation ? 'Créer le compte' : 'Enregistrer'}</span></button>
    </form>
    ${actions}`;
}
function openEdit(c, isNew) {
  const ov = $('#ticketOverlay'), m = $('#ticketModal');
  m.classList.add('wide'); m.innerHTML = editHTML(c, isNew); ov.hidden = false;
  ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE });
  m.animate([{ opacity: 0, transform: 'translateY(18px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: EASE });
  $('#admForm').onsubmit = e => { e.preventDefault(); c.creation ? createUser() : saveEdit(c, isNew); };
  $$('[data-acl]').forEach(sel => sel.onchange = () => { const d = $(`[data-exp="${sel.dataset.acl}"]`); d.disabled = !sel.value; if (!sel.value) d.value = ''; });
  const rg = $('[data-regen]'); if (rg) rg.onclick = () => { $('#aPwd').value = genMdp(); };
  const pr = $('[data-pwd-reset]'); if (pr) pr.onclick = () => resetPwd(c, pr);
  const rr = $('[data-regen-reset]'); if (rr) rr.onclick = () => { $('#aPwdReset').value = genMdp(); if (pr) { pr.dataset.armed = ''; pr.lastChild.textContent = 'Définir'; } };
  const dl = $('[data-delete]'); if (dl) dl.onclick = () => deleteUser(c, dl);
  setTimeout(() => ($('#aEmail') || $('#aPrenom')).focus({ preventScroll: true }), 200);
}

/* --- actions sur les comptes de connexion : fonction serveur « portail-admin » (clé serveur côté Supabase uniquement) --- */
/* Politique Supabase du projet : au moins une minuscule, une majuscule, un chiffre et un symbole.
   Caractères ambigus exclus (0/O, 1/l/I) et symboles faciles à dicter. */
const MDP_CLASSES = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!#%+=?@'];
const MDP_REGLE = '10 caractères minimum, avec une minuscule, une majuscule, un chiffre et un symbole';
function mdpValide(m) { return m.length >= 10 && /[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m) && /[^A-Za-z0-9]/.test(m); }
function genMdp(n = 14) {
  const tire = k => k[crypto.getRandomValues(new Uint32Array(1))[0] % k.length];
  const tous = MDP_CLASSES.join('');
  const c = [...MDP_CLASSES.map(tire), ...Array.from({ length: n - MDP_CLASSES.length }, () => tire(tous))];
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}
/* Messages d'erreur Supabase sur les mots de passe, en français */
function mdpErreur(m) {
  m = String(m || '');
  if (/at least one character|should contain/i.test(m)) return `Mot de passe refusé : ${MDP_REGLE}.`;
  if (/different|same/i.test(m)) return 'Choisissez un mot de passe différent de l\'actuel.';
  if (/weak|pwned|leaked|characters/i.test(m)) return `Mot de passe trop faible : ${MDP_REGLE}.`;
  return '';
}
async function adminCall(action, corps) {
  const { data, error } = await sb.functions.invoke('portail-admin', { body: { action, ...corps } });
  if (!error) return data;
  let msg = 'Action impossible pour le moment. Réessayez.';
  try { const j = await error.context.json(); if (j && j.message) msg = mdpErreur(j.message) || j.message; } catch (e) {}
  if (/Failed to send|fetch/i.test(error.message || '') && msg.startsWith('Action')) msg = 'Service d\'administration injoignable. Vérifiez votre connexion.';
  throw new Error(msg);
}
const aclChoisis = () => A.outils.map(o => {
  const role = $(`[data-acl="${o.slug}"]`).value, d = $(`[data-exp="${o.slug}"]`).value;
  return role ? { outil_slug: o.slug, role, expire_le: d ? new Date(d + 'T23:59:59').toISOString() : null } : null;
}).filter(Boolean);
function mdpHTML(titre, email, mdp, note) {
  return `<div class="sent"><span class="ok-c"><svg class="i" viewBox="0 0 24 24">${I.check}</svg></span><h2>${esc(titre)}</h2>
    <p class="muted">${esc(note)}</p>
    <div class="adm-cred"><span>Identifiant</span><b>${esc(email)}</b><span>Mot de passe temporaire</span><b class="mono">${esc(mdp)}</b></div>
    <div class="btn-row" style="justify-content:center"><button class="btn ghost mag" type="button" data-copy>${ic('copy')}<span>Copier</span></button>
    <button class="btn mag" data-close>Fermer</button></div>
    <p class="muted" style="font-size:12.5px">Ce mot de passe ne sera plus affiché. Transmettez-le de vive voix ou par un canal séparé de l'adresse e-mail.</p></div>`;
}
function bindCopy(email, mdp) {
  const b = $('[data-copy]'); if (!b) return;
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(`Portail Hympyr : ${location.origin}${location.pathname}\nIdentifiant : ${email}\nMot de passe temporaire : ${mdp}`); b.lastChild.textContent = 'Copié'; }
    catch (e) { b.lastChild.textContent = 'Copie impossible'; }
  };
}
async function createUser() {
  const err = $('#aErr'), btn = $('#aSave'), email = $('#aEmail').value.trim().toLowerCase(), mdp = $('#aPwd').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg(err, 'Saisissez une adresse e-mail valide.'); $('#aEmail').focus(); return; }
  if (A.collab.some(c => c.email === email)) { setMsg(err, 'Cette adresse a déjà une fiche dans le portail.'); return; }
  if (!mdpValide(mdp)) { setMsg(err, `Mot de passe temporaire : ${MDP_REGLE}. Cliquez sur le bouton à côté pour en générer un.`); return; }
  const acces = aclChoisis();
  if (!acces.length) { setMsg(err, 'Attribuez au moins un outil.'); return; }
  btn.disabled = true; btn.lastChild.textContent = 'Création en cours';
  try {
    await adminCall('creer', { email, password: mdp, prenom: $('#aPrenom').value.trim(), nom: $('#aNom').value.trim(),
      pole: $('#aPole').value, admin_portail: $('#aAdmin').checked, acces });
  } catch (e) { btn.disabled = false; btn.lastChild.textContent = 'Créer le compte'; setMsg(err, e.message); return; }
  $('#ticketModal').innerHTML = mdpHTML('Compte créé', email, mdp, 'Le compte est actif et ses outils sont ouverts.');
  bindCopy(email, mdp); A.loaded = false; openAdmin();
}
async function resetPwd(c, btn) {
  const mdp = $('#aPwdReset').value.trim();
  if (!mdpValide(mdp)) { btn.dataset.armed = ''; btn.lastChild.textContent = 'Définir'; setMsg($('#aActMsg'), `Mot de passe refusé : ${MDP_REGLE}.`); $('#aPwdReset').focus(); return; }
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.lastChild.textContent = 'Confirmer'; setMsg($('#aActMsg'), 'Son mot de passe actuel cessera de fonctionner. Cliquez sur « Confirmer ».', 'ok'); return; }
  btn.disabled = true;
  try { await adminCall('mot_de_passe', { user_id: c.user_id, password: mdp }); }
  catch (e) { btn.disabled = false; setMsg($('#aActMsg'), e.message); return; }
  const moi = c.user_id === S.user.id;
  $('#ticketModal').innerHTML = mdpHTML('Mot de passe modifié', c.email, mdp, moi ? 'Votre nouveau mot de passe est actif pour tous les outils.' : `${nomCollab(c)} devra choisir son propre mot de passe à la prochaine connexion.`);
  bindCopy(c.email, mdp);
}
async function deleteUser(c, btn) {
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.lastChild.textContent = 'Confirmer la suppression'; setMsg($('#aActMsg'), `Supprimer définitivement le compte de ${nomCollab(c)} ? Cliquez de nouveau pour confirmer.`); return; }
  btn.disabled = true;
  try { await adminCall('supprimer', { user_id: c.user_id }); }
  catch (e) { btn.disabled = false; setMsg($('#aActMsg'), e.message); return; }
  await closeTicket(); $('#ticketModal').classList.remove('wide');
  toast(`Compte de ${nomCollab(c)} supprimé`); openAdmin();
}
async function saveEdit(c, isNew) {
  const err = $('#aErr'), btn = $('#aSave');
  const fiche = {
    prenom: $('#aPrenom').value.trim() || null, nom: $('#aNom').value.trim() || null, pole: $('#aPole').value || null,
    actif: $('#aActif').checked, admin_portail: $('#aAdmin').checked
  };
  btn.disabled = true; btn.lastChild.textContent = 'Enregistrement';
  const fail = (e) => { btn.disabled = false; btn.lastChild.textContent = 'Enregistrer';
    setMsg(err, /administrateur actif/.test(e?.message || '') ? 'Il doit rester au moins un administrateur actif du portail.'
      : /inconnu/.test(e?.message || '') ? e.message : 'Enregistrement impossible. Vérifiez votre connexion puis réessayez.'); };
  // 1. la fiche
  const r1 = isNew
    ? await sb.from('portail_collaborateurs').insert({ user_id: c.user_id, email: c.email, ...fiche })
    : await sb.from('portail_collaborateurs').update(fiche).eq('user_id', c.user_id);
  if (r1.error) return fail(r1.error);
  // 2. les droits, outil par outil (chaque ligne est recopiée dans l'outil par la base)
  for (const o of A.outils) {
    const role = $(`[data-acl="${o.slug}"]`).value, d = $(`[data-exp="${o.slug}"]`).value;
    const expire_le = d ? new Date(d + 'T23:59:59').toISOString() : null;
    const avant = A.acces.find(x => x.user_id === c.user_id && x.outil_slug === o.slug);
    let r = { error: null };
    if (!role && avant) r = await sb.from('portail_acces').delete().eq('user_id', c.user_id).eq('outil_slug', o.slug);
    else if (role && !avant) r = await sb.from('portail_acces').insert({ user_id: c.user_id, outil_slug: o.slug, role, expire_le });
    else if (role && avant && (avant.role !== role || (avant.expire_le || '').slice(0, 10) !== d))
      r = await sb.from('portail_acces').update({ role, expire_le }).eq('user_id', c.user_id).eq('outil_slug', o.slug);
    if (r.error) return fail(r.error);
  }
  await closeTicket(); $('#ticketModal').classList.remove('wide');
  toast(isNew ? 'Collaborateur ajouté au portail' : 'Modifications enregistrées');
  openAdmin();
}
document.addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) { const c = A.collab.find(x => x.user_id === ed.dataset.edit); if (c) openEdit(c, false); return; }
  if (e.target.closest('[data-new]')) { openEdit({ user_id: null, email: '', actif: true, creation: true }, true); return; }
  const ad = e.target.closest('[data-add]');
  if (ad) { const c = A.comptes.find(x => x.user_id === ad.dataset.add); if (c) openEdit({ user_id: c.user_id, email: c.email, actif: true }, true); return; }
  const tg = e.target.closest('[data-tab-go]'); if (tg) go(tg.dataset.tabGo);
});
document.addEventListener('change', async e => {
  const s = e.target.closest('[data-ticket-statut]'); if (!s) return;
  const { error } = await sb.from('portail_tickets').update({ statut: s.value }).eq('id', +s.dataset.ticketStatut);
  if (error) { toast('Statut non enregistré. Réessayez.', 'x'); return; }
  const t = A.tickets.find(x => x.id === +s.dataset.ticketStatut); if (t) t.statut = s.value;
  toast('Statut du ticket mis à jour');
});

/* =========================================================
   CONNEXION
   ========================================================= */
/* Paramètre ?retour= : posé par un outil qui renvoie vers le portail faute de session.
   Garde-fou contre la redirection ouverte : on n'y retourne que si l'URL commence par celle d'un outil
   autorisé pour cette personne (même origine et même chemin de base). */
function outilDeRetour() {
  const brut = new URLSearchParams(location.search).get('retour');
  if (!brut) return null;
  let u; try { u = new URL(brut, location.href); } catch (e) { return { outil: null }; }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') return { outil: null };
  // Chemin comparé sans la casse : GitHub Pages sert /HYM_FICLI_001/ comme /hym_ficli_001/
  const outil = S.outils.find(o => { try { const b = new URL(o.url); return u.origin === b.origin && u.pathname.toLowerCase().startsWith(b.pathname.toLowerCase()); } catch (e) { return false; } });
  return { outil, url: u.href };
}
function nomOutilDeRetour() {
  const q = new URLSearchParams(location.search);
  const brut = q.get('retour') || q.get('refus'); if (!brut) return '';
  if (NOM_OUTIL_BASE) return `« ${NOM_OUTIL_BASE} »`;
  const slug = new URLSearchParams(location.search).get('outil') || '';
  return { cockpit_appels: 'le cockpit appels', cockpit_granules: 'le cockpit granulés', renommage_tournees: 'le renommage des tournées', pilotage_communication: 'le pilotage communication', charte: 'la charte graphique' }[slug] || 'votre outil';
}
/* Nom choisi dans Administration > Outils (fonction publique portail_nom_outil, lisible avant connexion) */
let NOM_OUTIL_BASE = null;
(async () => {
  const slug = new URLSearchParams(location.search).get('outil'); if (!slug) return;
  try {
    const { data } = await sb.rpc('portail_nom_outil', { p_slug: slug });
    if (typeof data !== 'string' || !data.trim()) return;
    NOM_OUTIL_BASE = data.trim();
    const n = nomOutilDeRetour();
    if (n && $('#loginLead').textContent.startsWith('Connectez-vous pour ouvrir')) $('#loginLead').textContent = `Connectez-vous pour ouvrir ${n}. Le même compte vaut pour tous les outils Hympyr.`;
  } catch (e) { /* script SQL 10 pas encore exécuté : libellés par défaut */ }
})();
function showLogin() {
  const n = nomOutilDeRetour();
  if (n) $('#loginLead').textContent = `Connectez-vous pour ouvrir ${n}. Le même compte vaut pour tous les outils Hympyr.`;
  renderLogos();
  $('#app').hidden = true; $('#login').hidden = false;
  $('#loginCard').animate([{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 620, easing: EASE });
}
function showForcePwd() {
  showLogin();
  $('#loginForm').hidden = true; $('#resetForm').hidden = false; $('#forgotBtn').parentElement.hidden = true;
  $('#loginTitle').textContent = 'Choisissez votre mot de passe';
  $('#loginLead').textContent = "Vous vous êtes connecté avec un mot de passe temporaire. Choisissez le vôtre : il vaudra pour tous les outils Hympyr.";
  setTimeout(() => $('#newPassword').focus({ preventScroll: true }), 300);
}
async function enterApp(session, { fresh = false } = {}) {
  S.user = session.user;
  try {
    [S.outils, S.nom, S.usage, S.admin] = await Promise.all([loadOutils(), loadMoi(), loadUsage(), loadAdminFlag()]);
  } catch (e) {
    showLogin(); setMsg($('#loginMsg'), 'Chargement de vos outils impossible. Rechargez la page.'); return;
  }
  // Mot de passe temporaire donné par un administrateur : on impose le choix d'un mot de passe personnel
  const { data: aChanger } = await sb.rpc('portail_mdp_a_changer');
  if (aChanger === true) { S.forceMdp = true; showForcePwd(); return; }
  if (!S.outils.length && !S.admin) {
    await sb.auth.signOut(); showLogin();
    setMsg($('#loginMsg'), "Ce compte n'a encore accès à aucun outil Hympyr. Contactez l'administrateur."); return;
  }
  // Une ligne « connexion » par jour et par appareil suffit pour mesurer l'adoption
  const today = new Date().toISOString().slice(0, 10), k = 'hy-portail-cx-' + S.user.id;
  if (fresh || store.get(k, '') !== today) { store.set(k, today); journal('connexion'); }

  // Un outil a refusé ce compte (?refus=1) : on l'explique ici, sans repartir vers l'outil (pas de boucle)
  if (new URLSearchParams(location.search).get('refus')) {
    const nom = nomOutilDeRetour();
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => toast(`Votre compte n'a pas accès à ${nom === 'votre outil' ? 'cet outil' : nom}. Demandez un accès avec le bouton ticket.`, 'x'), 700);
  }
  // Retour vers l'outil qui a renvoyé ici (?retour=…), seulement s'il fait partie des outils autorisés
  const cible = outilDeRetour();
  if (cible) {
    if (cible.outil) { await journal('ouverture_outil', cible.outil.slug); location.replace(cible.url); return; }
    toast("Vous n'avez pas accès à cet outil. Demandez un accès avec le bouton ticket.", 'x');
  }
  history.replaceState(null, '', location.pathname + location.hash);

  const l = $('#login');
  if (!l.hidden) { await $('#loginCard').animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px) scale(.98)' }], { duration: 240, fill: 'forwards' }).done; l.hidden = true; $('#loginCard').getAnimations().forEach(a => a.cancel()); }
  const start = location.hash === '#compte' ? 'compte' : (location.hash === '#admin' && S.admin) ? 'admin' : 'outils';
  S.view = start; $$('.view').forEach(v => { v.hidden = v.dataset.view !== start; });
  $$('.scene').forEach(s => s.classList.toggle('on', s.dataset.scene === start));
  $('#app').hidden = false;
  renderLogos(); renderNav(); renderHero(); renderPoles(); renderTools(); renderAccount(); syncTheme();
  $('.topbar').animate([{ opacity: 0, transform: 'translate(-50%,-14px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 620, easing: EASE });
  $('#ticketBtn').animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 300, easing: EASE, fill: 'backwards' });
  stagger($(`#v-${start}`));
  if (start === 'admin') openAdmin();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const em = $('#email'), pw = $('#password'), msg = $('#loginMsg'), btn = $('#loginBtn');
  if (!sb) { setMsg(msg, 'Service de connexion indisponible. Vérifiez votre connexion internet puis rechargez la page.'); return; }
  if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) { setMsg(msg, 'Saisissez une adresse e-mail valide.'); em.focus(); return; }
  if (!pw.value) { setMsg(msg, 'Saisissez votre mot de passe.'); pw.focus(); return; }
  btn.disabled = true; btn.textContent = 'Connexion en cours';
  const { data, error } = await sb.auth.signInWithPassword({ email: em.value.trim().toLowerCase(), password: pw.value });
  btn.disabled = false; btn.textContent = 'Se connecter';
  if (error) { setMsg(msg, /confirm/i.test(error.message) ? 'Adresse e-mail non confirmée. Consultez votre boîte de réception.' : 'Identifiant ou mot de passe incorrect.'); return; }
  pw.value = ''; setMsg(msg, '');
  enterApp(data.session, { fresh: true });
});
$('#forgotBtn').onclick = async () => {
  const em = $('#email'), msg = $('#loginMsg');
  if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) { setMsg(msg, 'Saisissez d\'abord votre adresse e-mail, puis cliquez à nouveau sur « Mot de passe oublié ? ».'); em.focus(); return; }
  const { error } = await sb.auth.resetPasswordForEmail(em.value.trim().toLowerCase(), { redirectTo: location.origin + location.pathname });
  setMsg(msg, error ? 'Envoi impossible pour le moment. Réessayez dans quelques minutes.' : `Un lien de réinitialisation a été envoyé à ${em.value.trim()}.`, error ? 'err' : 'ok');
};
// Lien « mot de passe oublié » : on arrive directement sur la saisie du nouveau mot de passe (charte)
$('#resetForm').addEventListener('submit', async e => {
  e.preventDefault(); const p = $('#newPassword'), msg = $('#resetMsg');
  if (!mdpValide(p.value)) { setMsg(msg, `Choisissez un mot de passe de ${MDP_REGLE}.`); return; }
  const { error } = await sb.auth.updateUser({ password: p.value });
  if (error) { setMsg(msg, mdpErreur(error.message) || (S.forceMdp ? 'Mise à jour impossible pour le moment. Réessayez.' : 'Mise à jour impossible. Demandez un nouveau lien de réinitialisation.')); return; }
  if (S.forceMdp) { await sb.rpc('portail_mdp_change'); S.forceMdp = false; $('#loginTitle').textContent = 'Portail Hympyr'; }
  p.value = ''; $('#resetForm').hidden = true; $('#loginForm').hidden = false; $('#forgotBtn').parentElement.hidden = false;
  const { data } = await sb.auth.getSession(); if (data.session) enterApp(data.session, { fresh: true });
});
$('#pwdForm').addEventListener('submit', async e => {
  e.preventDefault(); const p = $('#pwdNew'), msg = $('#pwdMsg');
  if (!mdpValide(p.value)) { setMsg(msg, `Choisissez un mot de passe de ${MDP_REGLE}.`); return; }
  $('#pwdBtn').disabled = true;
  const { error } = await sb.auth.updateUser({ password: p.value });
  $('#pwdBtn').disabled = false;
  if (error) { setMsg(msg, mdpErreur(error.message) || 'Mise à jour impossible pour le moment.'); return; }
  sb.rpc('portail_mdp_change').then(() => {}, () => {});
  p.value = ''; setMsg(msg, 'Mot de passe enregistré pour tous vos outils.', 'ok');
});
async function logout() {
  await $('#app').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).done;
  await sb.auth.signOut();
  S.user = null; S.outils = []; $('#app').getAnimations().forEach(a => a.cancel());
  history.replaceState(null, '', location.pathname); showLogin();
}
$('#logoutBtn').onclick = logout; $('#logoutBtn2').onclick = logout;

/* démarrage : une session ouverte dans la charte ou le pilotage est reprise sans nouvelle connexion */
(async function boot() {
  syncTheme();
  if (!sb) { showLogin(); setMsg($('#loginMsg'), 'Service de connexion indisponible. Vérifiez votre connexion internet puis rechargez la page.'); return; }
  sb.auth.onAuthStateChange(ev => {
    if (ev === 'PASSWORD_RECOVERY') {
      $('#app').hidden = true; $('#login').hidden = false; $('#loginForm').hidden = true; $('#resetForm').hidden = false; $('#forgotBtn').parentElement.hidden = true;
      $('#loginTitle').textContent = 'Nouveau mot de passe'; $('#loginLead').textContent = 'Choisissez votre nouveau mot de passe, valable pour tous les outils Hympyr.';
    }
    if (ev === 'SIGNED_OUT' && S.user) { S.user = null; showLogin(); } // déconnexion depuis un autre outil ou un autre onglet
  });
  const { data } = await sb.auth.getSession();
  if (data.session) enterApp(data.session); else showLogin();
})();
