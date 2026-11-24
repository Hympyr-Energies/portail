# Portail Hympyr (V1)

Page d'accueil unique des outils internes Hympyr : une connexion, la liste des outils auxquels chaque collaborateur a droit, un bouton ticket. Les outils restent des applications autonomes, ouvertes par lien direct.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Écrans : connexion, Mes outils, Mon compte, ticket |
| `styles.css` | Feuille de style de la charte graphique, copiée telle quelle depuis `hympyr_charte_graphique` |
| `portail.css` | Ajouts propres au portail (tuiles, couleurs de marque) |
| `app.js` | Logique : session Supabase, outils, journal, tickets |
| `config.js` | URL du projet Supabase et clé publique (publishable). Jamais de clé secrète ici. |
| `assets/` | Logos officiels Groupe, fond clair et fond sombre |

Aucun build, aucune dépendance hors supabase-js 2.45.4 (même version que la charte et le pilotage).

## Comment marchent les droits

- Le portail appelle `portail_mes_outils()`, qui lit les 4 tables de membres existantes (`charte_membres`, `comm_membres`, `fificli_membres`, `granules_membres`). Le renommage des tournées, outil 100 % local, est ouvert à tout membre actif d'au moins un outil.
- **Masquer une tuile n'est pas une protection.** Chaque outil garde son propre contrôle (RLS ou fonction Edge). Le portail n'ouvre aucun droit.
- Donner un accès : ajouter la personne dans la table de membres de l'outil concerné, comme aujourd'hui. Phase 2 : une seule table `portail_acces`.

## Ajouter un outil

Insérer une ligne dans `portail_outils` (slug, nom, description en une phrase orientée tâche, url, marque, pôle, ordre), puis ajouter la lecture de sa table de membres dans `portail_mes_outils()`. Optionnel : une icône dans `TOOL_ICON` et un libellé court dans `TOOL_SHORT` (`app.js`).

## Connexion unique

Le portail est la seule page de connexion. Tous les outils sont servis depuis la même origine (`hympyr-energies.github.io`) et lisent la même session supabase-js : une connexion au portail ouvre la charte, le pilotage et les deux cockpits ; une déconnexion, où qu'elle soit faite, les ferme tous.

- Un outil ouvert sans session renvoie ici avec `?retour=<adresse de l'outil>&outil=<slug>`. Après connexion, le portail y retourne seulement si l'adresse appartient à un outil autorisé pour la personne (pas de redirection ouverte).
- Un outil qui refuse le compte (pas membre) renvoie ici avec `?outil=<slug>&refus=1` : le portail l'explique sans repartir vers l'outil, et la session reste ouverte pour les autres outils.
- Garde-fou : un outil qui revient du portail sans session en moins de 20 s affiche un message au lieu de rediriger (pas de boucle).
- Les anciens liens « mot de passe oublié » arrivés sur un outil sont transmis au portail, où se choisit le nouveau mot de passe.
- Les cockpits gardent leur fonction Edge (`fificli-api`, `granules-state`) pour les données : elle valide le jeton de la session commune et l'appartenance à la table de membres.

## Mesure d'adoption

`portail_journal` reçoit une ligne `connexion` par jour et par appareil, et une ligne `ouverture_outil` à chaque clic sur une tuile. Chaque collaborateur ne lit que ses propres lignes ; l'analyse globale se fait côté administrateur. Les collaborateurs doivent être informés de ce suivi (RGPD).

## Réglages Supabase à faire

Authentication > URL Configuration : ajouter l'adresse du portail aux « Redirect URLs » pour que le lien « Mot de passe oublié » y ramène.

## Administration (administrateurs du portail)

Onglet « Administration », visible seulement si `portail_est_admin()` est vrai (la base refuse le reste via RLS).
- Collaborateurs : outils et rôle par outil, date de fin d'accès facultative, pôle, compte actif, administrateur du portail.
  Chaque changement est recopié par trigger dans la table de membres de l'outil concerné.
- Comptes : création (mot de passe temporaire à changer à la 1re connexion), mot de passe temporaire, suppression,
  via la fonction Edge `portail-admin` (`supabase/functions/portail-admin`, clé serveur côté Supabase uniquement,
  appelant vérifié administrateur actif à chaque appel, actions tracées dans `portail_admin_journal`).
- Tickets : changement de statut (ouvert, en cours, résolu).
- Garde-fous : on désactive, on ne supprime pas ; il reste toujours au moins un administrateur actif.
Prérequis SQL : `supabase/migrations/20261124_portail_admin.sql` puis `20261124_portail_admin_comptes.sql`.
