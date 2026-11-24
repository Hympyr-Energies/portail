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
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>'
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

/* ---------- thème (vague circulaire depuis le coin, comme la charte) ---------- */
function syncTheme() { $('#themeBtn').setAttribute('aria-label', root.dataset.theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'); }
function setTheme(next) {
  const apply = () => { root.dataset.theme = next; store.set('hy-theme', next); syncTheme(); renderLogos(); };
  if (!document.startViewTransition || RM) { apply(); return; }
  const vt = document.startViewTransition(apply);
  vt.ready.then(() => {
    const r = Math.hypot(innerWidth, innerHeight);
    root.animate({ clipPath: ['circle(0px at 100% 0%)', `circle(${r}px at 100% 0%)`] }, { duration: 950, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
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
const S = { user: null, nom: '', outils: [], usage: {}, view: 'outils', pole: 'tous' };

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
}

/* Navigation : 2 onglets sur ordinateur ; sur mobile, barre de 5 icônes max (charte, Créations > Outils) :
   les outils les plus ouverts autour de l'accueil central mis en avant, puis Mon compte */
const TABS = [{ k: 'outils', l: 'Mes outils', i: 'grid' }, { k: 'compte', l: 'Mon compte', i: 'user' }];
function renderNav() {
  const tabs = $('#tabs');
  tabs.innerHTML = TABS.map(t => `<button type="button" data-tab="${t.k}" class="${t.k === S.view ? 'on' : ''}" aria-current="${t.k === S.view ? 'page' : 'false'}">${ic(t.i)}<span>${t.l}</span></button>`).join('');
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
  m.innerHTML = ticketFormHTML(); ov.hidden = false;
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
  const outil = S.outils.find(o => { try { const b = new URL(o.url); return u.origin === b.origin && u.pathname.startsWith(b.pathname); } catch (e) { return false; } });
  return { outil, url: u.href };
}
function nomOutilDeRetour() {
  const brut = new URLSearchParams(location.search).get('retour'); if (!brut) return '';
  const slug = new URLSearchParams(location.search).get('outil') || '';
  return { cockpit_appels: 'le cockpit appels', cockpit_granules: 'le cockpit granulés', renommage_tournees: 'le renommage des tournées', pilotage_communication: 'le pilotage communication', charte: 'la charte graphique' }[slug] || 'votre outil';
}
function showLogin() {
  const n = nomOutilDeRetour();
  if (n) $('#loginLead').textContent = `Connectez-vous pour ouvrir ${n}. Le même compte vaut pour tous les outils Hympyr.`;
  renderLogos();
  $('#app').hidden = true; $('#login').hidden = false;
  $('#loginCard').animate([{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 620, easing: EASE });
}
async function enterApp(session, { fresh = false } = {}) {
  S.user = session.user;
  try {
    [S.outils, S.nom, S.usage] = await Promise.all([loadOutils(), loadMoi(), loadUsage()]);
  } catch (e) {
    showLogin(); setMsg($('#loginMsg'), 'Chargement de vos outils impossible. Rechargez la page.'); return;
  }
  if (!S.outils.length) {
    await sb.auth.signOut(); showLogin();
    setMsg($('#loginMsg'), "Ce compte n'a encore accès à aucun outil Hympyr. Contactez l'administrateur."); return;
  }
  // Une ligne « connexion » par jour et par appareil suffit pour mesurer l'adoption
  const today = new Date().toISOString().slice(0, 10), k = 'hy-portail-cx-' + S.user.id;
  if (fresh || store.get(k, '') !== today) { store.set(k, today); journal('connexion'); }

  // Retour vers l'outil qui a renvoyé ici (?retour=…), seulement s'il fait partie des outils autorisés
  const cible = outilDeRetour();
  if (cible) {
    if (cible.outil) { await journal('ouverture_outil', cible.outil.slug); location.replace(cible.url); return; }
    toast("Vous n'avez pas accès à cet outil. Demandez un accès avec le bouton ticket.", 'x');
  }
  history.replaceState(null, '', location.pathname + location.hash);

  const l = $('#login');
  if (!l.hidden) { await $('#loginCard').animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px) scale(.98)' }], { duration: 240, fill: 'forwards' }).done; l.hidden = true; $('#loginCard').getAnimations().forEach(a => a.cancel()); }
  const start = location.hash === '#compte' ? 'compte' : 'outils';
  S.view = start; $$('.view').forEach(v => { v.hidden = v.dataset.view !== start; });
  $$('.scene').forEach(s => s.classList.toggle('on', s.dataset.scene === start));
  $('#app').hidden = false;
  renderLogos(); renderNav(); renderHero(); renderPoles(); renderTools(); renderAccount(); syncTheme();
  $('.topbar').animate([{ opacity: 0, transform: 'translate(-50%,-14px)' }, { opacity: 1, transform: 'translate(-50%,0)' }], { duration: 620, easing: EASE });
  $('#ticketBtn').animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 300, easing: EASE, fill: 'backwards' });
  stagger($(`#v-${start}`));
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
  if (p.value.length < 10) { setMsg(msg, 'Choisissez un mot de passe de 10 caractères minimum.'); return; }
  const { error } = await sb.auth.updateUser({ password: p.value });
  if (error) { setMsg(msg, 'Mise à jour impossible. Demandez un nouveau lien de réinitialisation.'); return; }
  p.value = ''; $('#resetForm').hidden = true; $('#loginForm').hidden = false; $('#forgotBtn').parentElement.hidden = false;
  const { data } = await sb.auth.getSession(); if (data.session) enterApp(data.session, { fresh: true });
});
$('#pwdForm').addEventListener('submit', async e => {
  e.preventDefault(); const p = $('#pwdNew'), msg = $('#pwdMsg');
  if (p.value.length < 10) { setMsg(msg, 'Choisissez un mot de passe de 10 caractères minimum.'); return; }
  $('#pwdBtn').disabled = true;
  const { error } = await sb.auth.updateUser({ password: p.value });
  $('#pwdBtn').disabled = false;
  if (error) { setMsg(msg, /weak|pwned|leaked/i.test(error.message) ? 'Ce mot de passe est trop faible ou figure dans une fuite connue. Choisissez-en un autre.' : 'Mise à jour impossible pour le moment.'); return; }
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
