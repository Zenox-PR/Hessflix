# TMDB — intégration privée du catalogue

La configuration et le mode d'emploi à jour figurent dans [CATALOGUE_ADMIN.md](CATALOGUE_ADMIN.md).

## Configuration locale

Copier le modèle vide `.env.example` vers `.env`, sans écraser un fichier existant, et remplir `TMDB_API_KEY=` avec la clé **TMDB API v3** (32 caractères hexadécimaux). Ne jamais partager cette valeur, la placer sous assets ou la committer. Le serveur charge ce fichier uniquement au lancement, sans écraser les variables de processus. Redémarrer Node après modification.

`node scripts/check-tmdb.cjs` vérifie réellement films, séries, anime, saison et recherche **Resident Evil (2002), TMDB 1576**, sans écrire dans Firestore. Une clé au bon format n'est pas une preuve d'accès. En l'absence de clé, aucun test réel TMDB ne peut être déclaré réussi.

## Séparation administration / public

- `/api/admin/tmdb/search`, `detail`, `resolve`, etc. exigent la session administrateur vérifiée. Les anciennes routes `/api/tmdb/*` sont également privées : elles ne permettent pas de contourner la publication.
- Le panneau `/admin` importe les résultats en brouillon Firestore. Un résultat TMDB ne devient jamais public automatiquement.
- Le navigateur public utilise seulement `/api/catalogue/*` et `/catalogue-data.js`, alimentés par les projections publiées. Aucun ancien cache localStorage ou fichier historique n'est utilisé comme repli en cas de panne.
- Les affiches utilisent le CDN public TMDB, sans clé, avec tailles limitées et chargement différé. Le logo et l'attribution restent présents dans `credits.html`.

## Robustesse et identité

`server/tmdb-client.cjs` appelle uniquement le domaine officiel, avec délais, quatre requêtes actives, file/cache bornés, regroupement des appels simultanés et respect de Retry-After. Les URLs authentifiées et les réponses d'erreur amont ne sont pas exposées au client. Une réponse en cache périmée peut aider une consultation admin, mais un ajout ou une actualisation refuse les métadonnées signalées périmées. L'actualisation explicite invalide le cache de la fiche/saison demandée.

Les titres privilégient fr-FR, puis les informations originales/anglais si nécessaire. Une langue de synopsis n'est pas une piste audio VF/VOSTFR. Anime est une classification initiale heuristique, corrigeable par l'administrateur. Les choix éditoriaux sont stockés séparément des métadonnées et ne sont pas remplacés lors d'un rafraîchissement. Les champs vides ne détruisent pas les anciennes métadonnées non vides.

La paire `(movie|tv, tmdbId)` est unique. IMDb, JustWatch et TVMaze ne sont jamais traités comme des IDs TMDB. L'import de l'ancienne sélection exige une correspondance fiable et une confirmation ; les guides TVMaze ne sont pas recopiés aveuglément. Les anciens identifiants reconnus restent des alias de la fiche publiée. Les nouveaux épisodes ne sont jamais validés automatiquement ; les renumérotations incompatibles sont bloquées.

La disponibilité en abonnement sur une plateforme n'est pas déduite d'une recherche TMDB. Les anciens liens officiels France vérifiés sont conservés pour les fiches correspondantes, avec leurs dates de relevé, sans prétendre à une vérification en temps réel. Une fiche sans offre vérifiée ne remplit pas arbitrairement Netflix/Disney/etc.

## Tests et limites

Les tests serveur et navigateur utilisent un stockage isolé et des réponses TMDB simulées : ils ne prouvent pas que la clé réelle ou Firestore cloud sont prêts. Le guide distingue ces résultats du contrôle réel et des tests de règles Firebase nécessitant Java 21.

Le site reste local. Un futur hébergement nécessitera Node, HTTPS, une identité serveur dédiée, des secrets côté serveur et un examen des permissions IAM ; un simple hébergement statique ne suffit pas. Aucun droit de diffusion vidéo n'est fourni par TMDB et aucune fausse source vidéo n'est créée.

Documentation officielle : [API TMDB](https://developer.themoviedb.org/), [attribution](https://www.themoviedb.org/about/logos-attribution).
