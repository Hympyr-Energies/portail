-- Fonctions de trigger : jamais appelées directement via l'API.
revoke execute on function public.portail_acces_sync(), public.portail_collab_sync(),
  public.portail_depuis_ancien() from public, anon, authenticated;
