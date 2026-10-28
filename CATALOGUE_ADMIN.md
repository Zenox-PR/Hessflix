# Hessflix — administration réelle du catalogue, en local

## Ce qui est implémenté

L'adresse est `http://localhost:4180/admin`. Le serveur vérifie le cookie de session Firebase signé, sa révocation, le compte actif, le claim **booléen** `admin: true` et l'UID propriétaire autorisé avant chaque opération. L'affichage du bouton n'est jamais la preuve d'une permission.

Le panneau recherche sur TMDB, ajoute en **brouillon**, modifie, publie, masque, actualise, met à la corbeille et restaure. La suppression définitive exige la corbeille et la saisie de l'identifiant. Aucun import ni aucune publication des données réelles n'a été effectué automatiquement.

À l'ajout, une fenêtre propose **Netflix, Prime Video, Paramount+, Disney+ et Marvel**. Cocher plusieurs cases classe le même contenu dans plusieurs univers, sans le dupliquer. Sans sélection, il reste dans le catalogue général. Les mêmes choix sont modifiables dans la fiche : enregistrer les modifications avant de fermer. Un brouillon n'apparaît dans aucun univers public ; la publication est toujours une étape distincte.

Les choix sont stockés dans `editor.platforms` et validés côté serveur parmi les cinq identifiants autorisés. Les règles Firestore continuent de refuser les écritures directes depuis le navigateur. L'actualisation TMDB ne modifie pas ces choix. Les anciennes fiches dépourvues de ce champ conservent leur classement issu des offres vérifiées ; un tableau vide enregistré explicitement les retire de tous les univers sans retirer leur publication générale. Aucun script de migration n'est nécessaire.

Les saisons sont importées séparément. Chaque nouvel épisode est non publié par défaut. Il faut enregistrer les épisodes validés, valider leur saison puis publier la fiche. Masquer une saison ne supprime pas ses épisodes. Les titres et synopsis des épisodes sont modifiables individuellement. « Actualiser TMDB » recharge la fiche ; réimporter la saison actualise ses épisodes, sans écraser leurs corrections ni validations. Une renumérotation incompatible est bloquée, pas corrigée automatiquement.

Les listes et actions passent par de vrais appels HTTP et le SDK Admin Firestore. **Le serveur normal ne possède aucun stockage de remplacement en mémoire**. Une panne ne donne jamais un faux succès. Les bases en mémoire sont exclusivement des doubles dans `tests/fixtures/`, non accessibles par HTTP.

## 1. Renseigner la clé TMDB localement

Au contrôle local, aucun fichier `.env` et aucune variable `TMDB_API_KEY` valide n'ont été trouvés dans les deux copies du projet. Je n'ai donc pas pu vérifier une vraie recherche TMDB avec ta clé.

Dans VS Code, depuis le dossier `Movix_Reconstruction` :

1. Copier `.env.example` vers `.env` (ne pas écraser un `.env` existant).
2. Remplir `TMDB_API_KEY=` avec **ta clé API TMDB v3**, 32 caractères hexadécimaux, depuis les paramètres API de ton compte TMDB. Ce n'est ni un jeton Firebase ni une clé privée Firebase.
3. Garder `MOVIX_PUBLIC_ORIGIN=http://localhost:4180` et ouvrir exactement cette adresse. Ne pas mélanger `localhost` et `127.0.0.1` pour les actions protégées.
4. Redémarrer le serveur local. Les variables de processus ont priorité sur `.env`.
5. Exécuter `node scripts/check-tmdb.cjs`. Ce contrôle cherche notamment **Resident Evil (2002), TMDB 1576** sans rien enregistrer dans Firestore. Il doit réellement réussir avant de considérer TMDB opérationnel.

Ne colle pas ta clé dans le chat. `.env` est ignoré par Git et refusé par le serveur HTTP ; `.env.example` est vide. Les appels TMDB authentifiés sont exclusivement côté serveur. Le navigateur ne reçoit que les métadonnées et les URLs publiques d'affiches.

## 2. Activer Firestore toi-même, sans publier le site

L'erreur `SERVICE_DISABLED` observée signifie que le service ne répond pas encore pour ce projet ; elle ne prouve pas à elle seule qu'une base existe déjà. **Aucun paramètre cloud n'a été changé par cette implémentation.**

1. Ouvrir [Firebase Console](https://console.firebase.google.com/project/demo-hessflix/firestore) et vérifier que le projet sélectionné est `demo-hessflix`.
2. Aller dans **Firestore Database** (suivant l'interface : Build ou Databases & Storage → Firestore).
3. Si aucune base n'existe : **Créer une base de données**, édition **Standard**, base **`(default)`**, puis choisir sa région en connaissance de cause. Le code utilise `(default)` ; ne pas créer une autre base pour contourner une base existante. Le choix de région a des conséquences de localisation/coût et doit être le tien.
4. Choisir **mode production**, jamais une règle temporaire autorisant tout le monde. Examiner l'offre et les quotas/frais annoncés avant de confirmer. Firebase indique que la création active également l'API Firestore.
5. Si la base existe mais l'API est désactivée : vérifier dans Google Cloud → API et services → **Cloud Firestore API**, pour le même projet, puis l'activer seulement si tu le décides. Ne recréer ni effacer la base.
6. Vérifier les règles existantes avant de les remplacer : intégrer `firestore.rules` en préservant les autres usages légitimes. Les nouvelles branches `catalogueEntries` sont privées ; seules les projections `publicCatalogue` publiées sont lisibles, et **aucun navigateur, même administrateur, ne peut écrire dans le catalogue**.
7. Tester les règles avec Java 21 (section suivante), puis appliquer les règles et index après validation. Depuis le dossier du projet, la commande ci-dessous modifie le cloud mais **n'héberge pas le site** ; elle n'a pas été exécutée ici :

```powershell
node node_modules/firebase-tools/lib/bin/firebase.js deploy --only firestore:rules,firestore:indexes --project demo-hessflix
```

Les index sont définis dans `firestore.indexes.json` et référencés par `firebase.json`. Attendre leur état prêt dans Console → Firestore → Index avant les recherches. Une création d'index en cours peut encore faire échouer une recherche.

8. Garder les ADC déjà configurés hors du projet. Si nécessaire, renouveler avec `gcloud auth application-default login`, avec un compte autorisé pour ce projet. Ne pas télécharger de clé privée dans le dépôt. Redémarrer le serveur et vérifier l'état des services dans `/admin`.

Le SDK Admin contourne les règles Firestore : la sécurité dépend donc aussi des contrôles serveur et de l'identité IAM. En local, les ADC utilisateur restent limités à ce poste ; ne pas les copier dans un hébergement. Pour un futur compte serveur dédié, le rôle Auth existant ne suffit pas à Firestore. `deploy/catalogue-role.json` prépare les permissions documentaires et transactionnelles nécessaires, sans gestion de base, d'index, de règles, de rôles ou de claims. Ne pas attribuer Owner/Editor/Firebase Admin au serveur. Une liaison IAM exige une validation distincte ; aucune n'a été appliquée ici. Un rôle documentaire peut accéder aux documents de la base concernée : préférer une base/projet isolé pour limiter le périmètre.

## 3. Java 21 : uniquement pour les tests de règles

Java 8 est actuellement détecté. Il n'empêche pas le site Node de fonctionner, mais ne suffit pas aux émulateurs Firebase actuels. Aucun JDK ni réglage système n'a été installé ou changé.

Si tu choisis de l'installer, télécharger le **JDK 21 LTS Windows** depuis [Adoptium](https://adoptium.net/temurin/releases/?version=21&os=windows), ou exécuter toi-même :

```powershell
winget install --id EclipseAdoptium.Temurin.21.JDK --exact
```

Fermer puis rouvrir le terminal et vérifier `java -version` : la version utilisée doit être 21. Si Java 8 est toujours prioritaire, ajuster `JAVA_HOME`/`Path` vers le vrai JDK installé, selon la [documentation Microsoft](https://learn.microsoft.com/en-us/windows/dev-environment/java), sans supprimer les autres versions nécessaires à d'autres logiciels.

Puis lancer les tests sur le projet de démonstration isolé, sans données cloud :

```powershell
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-movix-admin --only firestore,storage,database --config firebase.test.json "node --test tests/rules.test.cjs"
```

Les tests de règles couvrent les brouillons, les sous-collections d'épisodes, les écritures directes refusées même au propriétaire admin et les lectures limitées aux publications. Leur préparation n'est pas une preuve qu'ils ont réussi : Java 21 manque encore sur ce poste.

## 4. Premier ajout : Resident Evil (2002)

1. Se connecter avec le compte Firebase propriétaire. Sur `/admin`, actualiser les droits si nécessaire : cela renouvelle le jeton et la session, **cela n'attribue pas de rôle**.
2. Rechercher `Resident Evil`, catégorie Films, année `2002`. Vérifier le titre, l'affiche, la date et l'identifiant avant l'ajout (ne pas choisir une autre adaptation).
3. Cliquer **Ajouter en brouillon**, choisir éventuellement une ou plusieurs plateformes, puis **Confirmer l'ajout en brouillon**. L'ajout doit être confirmé par Firestore. Il n'est pas encore public. Annuler cette fenêtre ne crée aucune fiche.
4. Facultativement saisir un titre/synopsis personnalisé, une saga, un rang ou une mise en avant ; **enregistrer d'abord les corrections**, puis publier. Le rang éditorial n'altère pas la note TMDB.
5. Cliquer **Publier** et confirmer. Vérifier l'accueil et la fiche publique, puis tester **Masquer** : après rechargement, la fiche publique doit être inaccessible.

Les recherches TMDB ne fournissent ni fichiers vidéo ni droit de diffusion. Aucun faux lecteur, serveur vidéo, épisode ou lien de lecture n'est ajouté. Les liens officiels historiques vérifiés restent associés aux anciennes fiches reconnues. Le choix manuel d'un univers organise le catalogue : il ne crée aucune offre d'abonnement ni aucun lien de lecture. Les pages de plateformes affichent les contenus publiés qui leur sont affectés ; les liens de disponibilité restent contrôlés séparément.

## Données existantes et modèle

```text
catalogueEntries/tmdb-{movie|tv}-{id}     privé, métadonnées + choix + version
  /seasons/{numéro}                      validation de saison
    /episodes/{numéro}                   métadonnées + corrections + validation
publicCatalogue/tmdb-{movie|tv}-{id}     projection publique assainie, publication uniquement
```

Identité unique par paire type TMDB/identifiant, indépendamment de la catégorie Anime : deux clics simultanés ne créent pas deux fiches. Les changements utilisent des transactions et une version : un onglet ancien reçoit un conflit, sans écraser le plus récent. Les imports de saisons sont fractionnés, verrouillés et reprenables ; les nouveaux épisodes restent non publiés. Un import abandonné se reprend en réimportant la saison ; « Annuler un import bloqué » retire le verrou, sans effacer de données. En cas de délai réseau dépassé, l'opération peut avoir abouti côté serveur : recharger la fiche et vérifier sa version avant de réessayer.

Les fichiers historiques `discovery-data.js`, `platform-catalogue-data.js` et `episode-data.js` sont conservés sur disque mais ne sont plus servis publiquement. L'onglet **Importer l'ancienne sélection** propose une correspondance TMDB à confirmer, puis crée un brouillon en conservant les anciens liens lorsque la correspondance est fiable. Rien n'est automatiquement validé. Les profils/favoris ne sont pas effacés ; une ancienne URL ne redevient visible qu'après import et publication de son équivalent. Les guides TVMaze historiques ne sont pas convertis aveuglément en numérotation TMDB.

**Le catalogue public peut donc être vide avant tes premières publications, ou indisponible tant que Firestore n'est pas prêt. C'est un filtrage volontaire, pas une suppression de tes fichiers.** Les anciennes données stockées en localStorage ne sont pas utilisées pour contourner le contrôle de publication.

## Limites connues et exploitation

- Le panneau filtre son inventaire privé par pages de 30 : continuer avec « Charger la suite » même si une page filtrée est vide. La recherche publique utilise des préfixes de titres/mots normalisés, pas une recherche plein texte floue.
- Les sections éditoriales initiales utilisent les 200 publications les plus récemment modifiées, avec rang éditorial dans cette fenêtre. Au-delà, le bouton de continuation et la recherche publique paginée chargent la suite. Les filtres de saga/genre et favoris portent sur les données chargées dans la session ; pour une très grosse bibliothèque, prévoir des requêtes dédiées. Les univers de plateformes utilisent la même fenêtre initiale, pas une synchronisation automatique des droits de diffusion.
- Le masquage retire immédiatement la projection du serveur ; il ne peut pas retirer des métadonnées déjà téléchargées dans un onglet ouvert. Recharger pour vérifier l'état à jour.
- Les limiteurs peuvent renvoyer 429 : attendre le délai `Retry-After`. Les sessions administrateur expirent après une heure. Une révocation détectée redemande une connexion ; ne pas désactiver les contrôles pour débloquer l'interface.
- La corbeille est récupérable. La suppression définitive explicitement confirmée supprime aussi saisons et épisodes et n'est pas une sauvegarde ; prévoir des sauvegardes Firestore avant usage réel. Si elle échoue partiellement, l'état « Suppression à terminer » permet de réessayer, sans rendre la fiche publique.
- Aucun déploiement du site, aucune activation Firestore et aucune installation système n'ont été effectués.

## Vérifications reproductibles

```powershell
node node_modules/typescript/bin/tsc --project tsconfig.json
node --test tests/server.test.cjs tests/security.test.cjs tests/reliability.test.cjs tests/profiles.test.cjs tests/tmdb.test.cjs tests/catalogue.test.cjs
$env:MOVIX_TEST_BROWSER_CHANNEL='msedge'
node node_modules/@playwright/test/cli.js test
node scripts/check-tmdb.cjs
```

Les tests Node/navigateur sont isolés, avec réponses TMDB simulées ; ils n'utilisent pas tes données Firebase. Les tests de règles nécessitent Java 21. Les tests réels TMDB/Firestore restent nécessaires après configuration et ne doivent pas être assimilés aux résultats simulés.

Références officielles : [création Firestore](https://firebase.google.com/docs/firestore/quickstart), [IAM et transactions](https://firebase.google.com/docs/firestore/security/iam), [SDK serveur et règles](https://firebase.google.com/docs/firestore/security/rules-conditions), [API TMDB](https://developer.themoviedb.org/).
