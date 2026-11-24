// Fonction Edge « portail-admin » : actions d'administration des comptes depuis la console du portail.
//
// Pourquoi une fonction serveur : créer, supprimer un compte ou changer le mot de passe d'un autre utilisateur
// exige la clé serveur Supabase (service_role), qui ne doit jamais se trouver dans une page web.
// La fonction vérifie à chaque appel que l'appelant est un administrateur actif du portail.
//
// Contrat (POST JSON, en-tête Authorization: Bearer <jeton de l'administrateur connecté>) :
//   { action: "creer", email, password, prenom?, nom?, pole?, admin_portail?, acces: [{ outil_slug, role, expire_le? }] }
//        -> 200 { user_id }   | 409 { code: "existe" }
//   { action: "mot_de_passe", user_id, password }  -> 200 { ok: true }   (mot de passe temporaire, à changer à la connexion)
//   { action: "supprimer", user_id }               -> 200 { ok: true }   (retire d'abord les accès : recopié dans les outils)
//   erreurs : 401 (non connecté), 403 (pas administrateur), 400 (requête), 422 (refus métier), 502 (base).

const ORIGINES = (Deno.env.get("PORTAIL_ALLOWED_ORIGINS") ?? "https://hympyr-energies.github.io")
  .split(",").map((o) => o.trim()).filter(Boolean);
const ENV = {
  url: (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, ""),
  anon: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  serveur: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
};
const MDP_MIN = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entetes(req: Request, extra: Record<string, string> = {}) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINES.includes(o) ? o : ORIGINES[0],
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin", "Cache-Control": "no-store", ...extra,
  };
}
const serveur = (base: "auth/v1" | "rest/v1", chemin: string, init: RequestInit = {}) =>
  fetch(`${ENV.url}/${base}${chemin}`, {
    ...init, redirect: "manual",
    headers: { apikey: ENV.serveur, Authorization: "Bearer " + ENV.serveur, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

class Refus extends Error { constructor(public statut: number, public code: string, message: string) { super(message); } }

/** Vérifie le jeton et le statut d'administrateur actif. */
async function administrateur(req: Request): Promise<{ id: string; email: string }> {
  const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jeton) throw new Refus(401, "auth", "Connexion requise.");
  const r = await fetch(`${ENV.url}/auth/v1/user`, { headers: { apikey: ENV.anon, Authorization: "Bearer " + jeton } });
  if (!r.ok) throw new Refus(401, "auth", "Session expirée : reconnectez-vous.");
  const u = await r.json();
  const a = await serveur("rest/v1", `/portail_collaborateurs?user_id=eq.${u.id}&admin_portail=eq.true&actif=eq.true&select=user_id`);
  if (!a.ok) throw new Refus(502, "base", "Vérification des droits impossible.");
  if ((await a.json()).length !== 1) throw new Refus(403, "admin", "Réservé aux administrateurs du portail.");
  return { id: u.id, email: (u.email ?? "").toLowerCase() };
}

async function tracer(par: { id: string; email: string }, action: string, cible_email: string, detail: unknown = null) {
  await serveur("rest/v1", "/portail_admin_journal", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ par: par.id, par_email: par.email, action, cible_email, detail }),
  }).catch(() => {});
}
async function emailDe(user_id: string): Promise<string> {
  const r = await serveur("auth/v1", `/admin/users/${user_id}`);
  if (r.status === 404) throw new Refus(422, "introuvable", "Compte introuvable.");
  if (!r.ok) throw new Refus(502, "auth", "Lecture du compte impossible.");
  return ((await r.json()).email ?? "").toLowerCase();
}
async function erreurBase(r: Response, defaut: string): Promise<never> {
  const e = await r.json().catch(() => ({}));
  const m = String(e?.message ?? e?.msg ?? "");
  if (/administrateur actif|inconnu pour l'outil/.test(m)) throw new Refus(422, "regle", m);
  throw new Refus(502, "base", defaut);
}

async function creer(par: { id: string; email: string }, c: any) {
  const email = String(c.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Refus(400, "requete", "Adresse e-mail invalide.");
  if (typeof c.password !== "string" || c.password.length < MDP_MIN) throw new Refus(400, "requete", `Mot de passe de ${MDP_MIN} caractères minimum.`);
  const acces = Array.isArray(c.acces) ? c.acces : [];

  const r = await serveur("auth/v1", "/admin/users", { method: "POST", body: JSON.stringify({ email, password: c.password, email_confirm: true }) });
  if (r.status === 422 || r.status === 409) throw new Refus(409, "existe", "Un compte existe déjà avec cette adresse.");
  if (!r.ok) throw new Refus(502, "auth", "Création du compte refusée par Supabase.");
  const user_id = (await r.json()).id as string;

  // Fiche : « merge » car un trigger peut l'avoir déjà créée si la personne figurait dans un outil
  const f = await serveur("rest/v1", "/portail_collaborateurs?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id, email, prenom: c.prenom || null, nom: c.nom || null, pole: c.pole || null,
      admin_portail: !!c.admin_portail, actif: true, mdp_a_changer: true }),
  });
  if (!f.ok) { await serveur("auth/v1", `/admin/users/${user_id}`, { method: "DELETE" }); await erreurBase(f, "Fiche collaborateur non créée."); }

  if (acces.length) {
    const lignes = acces.map((a: any) => ({ user_id, outil_slug: String(a.outil_slug), role: String(a.role), expire_le: a.expire_le || null }));
    const p = await serveur("rest/v1", "/portail_acces?on_conflict=user_id,outil_slug", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(lignes),
    });
    if (!p.ok) await erreurBase(p, "Compte créé, mais les accès n'ont pas été enregistrés.");
  }
  await tracer(par, "creer", email, { acces });
  return { user_id };
}

async function motDePasse(par: { id: string; email: string }, c: any) {
  if (!UUID.test(String(c.user_id))) throw new Refus(400, "requete", "Compte invalide.");
  if (typeof c.password !== "string" || c.password.length < MDP_MIN) throw new Refus(400, "requete", `Mot de passe de ${MDP_MIN} caractères minimum.`);
  const email = await emailDe(c.user_id);
  const r = await serveur("auth/v1", `/admin/users/${c.user_id}`, { method: "PUT", body: JSON.stringify({ password: c.password }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Refus(422, "mdp", e?.msg ?? e?.message ?? "Mot de passe refusé par Supabase."); }
  // l'administrateur qui change son propre mot de passe n'a pas à le changer de nouveau
  if (c.user_id !== par.id) {
    await serveur("rest/v1", `/portail_collaborateurs?user_id=eq.${c.user_id}`, { method: "PATCH", body: JSON.stringify({ mdp_a_changer: true }) });
  }
  await tracer(par, "mot_de_passe", email);
  return { ok: true };
}

async function supprimer(par: { id: string; email: string }, c: any) {
  if (!UUID.test(String(c.user_id))) throw new Refus(400, "requete", "Compte invalide.");
  if (c.user_id === par.id) throw new Refus(422, "soi", "Vous ne pouvez pas supprimer votre propre compte.");
  const email = await emailDe(c.user_id);
  // 1. retirer les accès un par un : les triggers désactivent la personne dans chaque outil
  //    (une suppression en cascade ne serait pas recopiée dans les tables des outils)
  const a = await serveur("rest/v1", `/portail_acces?user_id=eq.${c.user_id}`, { method: "DELETE" });
  if (!a.ok) await erreurBase(a, "Retrait des accès impossible.");
  // 2. supprimer la fiche (le garde-fou refuse s'il s'agit du dernier administrateur actif)
  const f = await serveur("rest/v1", `/portail_collaborateurs?user_id=eq.${c.user_id}`, { method: "DELETE" });
  if (!f.ok) await erreurBase(f, "Suppression de la fiche impossible.");
  // 3. supprimer le compte de connexion
  const r = await serveur("auth/v1", `/admin/users/${c.user_id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Refus(502, "auth", "Accès retirés, mais le compte de connexion n'a pas pu être supprimé.");
  await tracer(par, "supprimer", email);
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: entetes(req) });
  const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: entetes(req, { "Content-Type": "application/json" }) });
  if (req.method !== "POST") return json({ code: "methode", message: "POST uniquement." }, 405);
  if (!ENV.url.startsWith("https://") || !ENV.anon || !ENV.serveur) return json({ code: "config", message: "Configuration serveur incomplète." }, 500);
  try {
    const c = await req.json().catch(() => { throw new Refus(400, "requete", "JSON invalide."); });
    const par = await administrateur(req);
    if (c.action === "creer") return json(await creer(par, c));
    if (c.action === "mot_de_passe") return json(await motDePasse(par, c));
    if (c.action === "supprimer") return json(await supprimer(par, c));
    return json({ code: "requete", message: "Action inconnue." }, 400);
  } catch (e) {
    if (e instanceof Refus) return json({ code: e.code, message: e.message }, e.statut);
    return json({ code: "base", message: "Service injoignable." }, 502);
  }
});
