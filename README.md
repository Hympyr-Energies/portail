# Portail Hympyr (V1)

Page d'accueil unique des outils internes Hympyr : une connexion, la liste des outils auxquels chaque collaborateur a droit, un bouton ticket. Les outils restent des applications autonomes, ouvertes par lien direct.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Écrans : connexion, Mes outils, Mon compte, ticket |
| `styles.css` | Feuille de style de la charte graphique, copiée telle quelle depuis `hympyr_charte_graphique` |
| `portail.css` | Ajouts propres au portail (tuiles, couleurs de marque) |
| `app.js` | Logique : session Supabase, outils, journal, tickets, administration |
| `historique.js` | Administration > Historique des actions (lecture et export CSV du journal) |
| `coffre.js` | Administration > Mots de passe du Groupe (coffre chiffré de bout en bout) |
| `vendor/` | supabase-js 2.45.4 servi par le portail (copie exacte du paquet npm, licence MIT) |
| `config.js` | URL du projet Supabase et clé publique (publishable). Jamais de clé secrète ici. |
| `assets/` | Logos officiels Groupe, fond clair et fond sombre |

Aucun build, aucune dépendance hors supabase-js 2.45.4 (même version que la charte et le pilotage), servie depuis `vendor/` : aucun script tiers dans la page. Une politique de sécurité du contenu (CSP, `index.html`) n'autorise que les scripts du portail et les échanges avec Supabase ; modifier le petit script de thème dans `index.html` impose d'en recalculer l'empreinte sha256.

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

## Historique des actions (Administration > Historique des actions)

Prérequis : `supabase/migrations/20261127_historique_admin.sql` (fichier 15 du SQL Editor).
- `portail_admin_journal` est en ajout seul : triggers qui refusent UPDATE, DELETE et TRUNCATE, droits retirés à tous les rôles, y compris la clé serveur.
- Les traces sont écrites par la base (triggers sur `portail_collaborateurs`, `portail_acces`, `portail_outils`, fonctions du coffre et des tickets), jamais par le navigateur. Heure et auteur posés par le serveur.
- Actions tracées : création, suppression et désactivation de compte, profil (nom, prénom, pôle), administration accordée ou retirée, accès à un outil ouvert, modifié ou retiré, renommage d'outil, statut de ticket, mot de passe de connexion redéfini, et toutes les actions du coffre. Valeurs avant et après, jamais de secret.
- La fonction Edge `portail-admin` transmet l'administrateur vérifié dans l'en-tête `x-hym-acteur` pour signer ses traces (crue par la base seulement avec la clé serveur).
- Limite : le propriétaire de la base (SQL Editor) peut toujours retirer un trigger. Témoin : l'export CSV régulier.

## Mots de passe du Groupe (Administration > Mots de passe du Groupe)

Prérequis : `supabase/migrations/20261127_coffre_mots_de_passe.sql` (fichier 16).
- Chiffrement de bout en bout dans le navigateur (WebCrypto) : clé AES-GCM 256 bits dérivée de la phrase secrète par PBKDF2-SHA256, 600 000 itérations, sel aléatoire. La phrase n'est ni envoyée ni stockée ; la base ne reçoit que du chiffré.
- Tables sans aucun droit direct ; tout passe par les fonctions `portail_coffre_*`, réservées aux administrateurs actifs, qui tracent chaque lecture, ajout, modification, suppression et changement de phrase. Affichage et copie d'un mot de passe tracés aussi (affichage refusé si la trace échoue).
- Verrouillage : 5 min sans activité, 1 min onglet en arrière-plan, sortie de l'administration, déconnexion. Presse-papiers vidé 30 s après une copie.
- Colonnes : Usage, Identifiant, Mot de passe, URL de connexion, classées par entité (Hympyr Energies, Granulés, Transport). Usage et entité sont chiffrés avec la ligne (champs `n` et `e`) ; une ligne sans entité apparaît dans « Non classé ». Pour tracer leur modification : fichier 17 (`20261127_coffre_usage_entite.sql`).
- Changer la phrase secrète : nouveau sel, nouvelle clé, toutes les lignes rechiffrées en une seule transaction.
- **Phrase perdue = coffre perdu.** Aucune récupération possible, par conception. La conserver hors ligne.
