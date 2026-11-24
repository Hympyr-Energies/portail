/* Configuration publique du portail.
   La clé « publishable » est publique par conception (même clé que la charte et le pilotage) :
   la sécurité repose sur la RLS et les fonctions SQL côté Supabase, jamais sur ce fichier.
   Ne jamais mettre ici une clé secrète (sb_secret_… ou service_role). */
window.PORTAIL_CONFIG = {
  SB_URL: 'https://cmvkijtlkzfwnzipgstc.supabase.co',
  SB_KEY: 'sb_publishable_Q8HVlAGCLlpF5P3Gqsa_9g_fKDDD0bZ'
};
