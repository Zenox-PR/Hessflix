# Sélections Netflix, Prime Video, Paramount+, Disney+ et Marvel

## Fonctionnement actuel avec le catalogue administré

Les pages publiques affichent uniquement les publications Firestore. À l'ajout dans `/admin`, la fenêtre de choix permet de cocher un ou plusieurs des cinq univers ; les mêmes cases figurent dans l'éditeur des fiches existantes. Le choix est enregistré avec le brouillon, devient visible après publication et résiste à l'actualisation TMDB. Aucun choix signifie « catalogue général uniquement ». Les anciennes fiches sans choix explicite conservent leur classement précédent. Les compteurs de l'accueil suivent les affectations publiées.

Le classement manuel est éditorial. Il ne certifie pas une disponibilité sur un service et ne crée ni source vidéo ni offre d'abonnement. Les liens officiels vérifiés sont conservés séparément. Les sections ci-dessous décrivent le relevé historique et les fichiers sources conservés ; leurs effectifs ne sont pas ceux du catalogue public actuel. Voir `CATALOGUE_ADMIN.md` pour le parcours actif.

## Ce qui a été livré

Les cinq pages reprennent les cartes, le survol (note, année, résumé et étoile), les Top 10, les carrousels, les genres et les sagas de l’accueil. Leurs identités visuelles sont conservées. Le même module `catalogue-ui.js` gère les cartes, fiches et favoris sur toutes les pages ; `discovery.js` gère les mêmes carrousels, sans duplication de leur comportement.

Relevé France du 23 octobre 2026 : 131 titres distincts dans ces sélections. Un titre peut appartenir à plusieurs services.

| Univers | Films | Séries | Total de la sélection |
| --- | ---: | ---: | ---: |
| Netflix | 16 | 16 | 32 |
| Prime Video | 14 | 14 | 28 |
| Paramount+ | 14 | 14 | 28 |
| Disney+ | 24 | 20 | 44 |
| Marvel | 12 | 11 | 23 |

Marvel est un univers éditorial et non un abonnement. Sa sélection est un sous-ensemble des titres Marvel retenus avec une offre Disney+ France vérifiée. Cela ne signifie pas que tous les titres Marvel existants sont proposés sur Disney+.

Les anciennes sélections fictives de six titres sur les pages de plateformes ont été remplacées par les titres réels vérifiés. Les dix créations de démonstration de l’accueil, les comptes, les profils, les avatars, l’administration, les logos et les animations de fond restent présents. Le catalogue complet de l’accueil réunit maintenant 162 titres réels distincts et les dix créations fictives ; ses rangées éditoriales initiales restent inchangées.

## Méthode de vérification

1. Lire les pages publiques JustWatch du service en France, catégories Films et Séries.
2. Retenir des titres sélectionnés éditorialement et des fiches complémentaires, avec contrôle du titre et de l’année pour éviter les homonymes.
3. Vérifier une offre de pays `FR`, de type `FLATRATE`, du fournisseur exact : `netflix`, `amazonprimevideo`, `paramountplus` ou `disneyplus`.
4. Exclure achats, locations, offres étrangères et chaînes additionnelles accessibles depuis Prime. Un abonnement Paramount+ vendu par Amazon n’est pas confondu avec l’abonnement Prime Video.
5. Conserver par titre la fiche JustWatch, le lien officiel du service et la date de consultation, ainsi que la date de mise à jour source lorsqu’elle est fournie.

Le parseur ne fait que lire du JSON public ; il n’exécute aucun script des pages consultées. Les descriptions françaises sont rédigées pour cette interface. La provenance des données et affiches est dans `assets/discovery/PLATFORMS.md`. Les liens officiels sont vérifiés avant affichage : HTTPS et domaine du service attendu. Aucune clé API ni connexion à un compte de streaming n’est nécessaire.

## Logique de placement

- Tendances : une sélection de cet univers, présentée par année ; ce n’est pas un relevé d’audience du service.
- Films et Séries populaires : deux Top 10 séparés, triés par note IMDb, puis nombre de votes et titre en cas d’égalité. Les positions sont distinctes des notes sur 10.
- Sagas : les ensembles dont au moins deux titres sont présents dans cette sélection ; une sélection n’est pas une promesse de saga intégrale.
- Genres : catégories provenant des métadonnées sources, avec la taxonomie locale. Les sections vides sont masquées.
- Recherche : reste limitée à l’univers affiché et se combine au type, genre ou saga choisi.
- Favoris : même stockage local par utilisateur et profil que sur l’accueil. Les titres supplémentaires sont aussi présents dans le catalogue complet de l’accueil pour y retrouver ces favoris. Pas de synchronisation cloud des favoris.

## Actualisation et limites

`node scripts/sync-platform-catalogue.cjs` renouvelle explicitement le relevé et les affiches locales. Les sélections et résumés éditoriaux sont dans `scripts/platform-selections.cjs`, le lecteur de la source dans `scripts/lib/platform-source.cjs`, le relevé public dans `platform-catalogue-data.js`. Une source indisponible, un genre introuvable ou moins de dix films/séries par univers empêche le remplacement du manifeste. Les fichiers d’images déjà présents peuvent être remplacés par cette actualisation ; le navigateur n’exécute jamais ce script.

Les catalogues évoluent : le relevé n’est ni exhaustif ni actualisé automatiquement à chaque visite. La date et la source sont visibles sur chaque page. Les saisons, formules et disponibilités exactes sont à confirmer sur le service officiel. Aucun abonnement n’est souscrit et aucune vidéo n’est hébergée ou diffusée par ce projet.

## Vérification locale

`pnpm test` inclut types stricts, tests Node et tests navigateur. Les tests vérifient les cinq univers, deux Top 10 chacun, cohérence des offres et des fichiers, pays/type/fournisseur, liens malveillants, rendu sans HTML injecté, survol, largeur mobile et favoris entre plateformes et accueil. Les tests Firebase restent simulés pour ne pas modifier les vrais comptes.
