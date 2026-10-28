# Démonstration interactive sur GitHub Pages

La démo présente l'interface Hessflix gratuitement, sans serveur et sans compte réel.
Elle utilise les métadonnées et médias d'exemple déjà versionnés dans le dépôt : il ne
s'agit pas d'un export de Firestore. Les dates, notes et disponibilités sont un instantané
historique ; elles ne sont pas actualisées en direct. Les crédits des sources sont conservés.

## Ce que le visiteur peut essayer

- Catalogue, recherche, filtres films/séries/animes et univers de plateformes.
- Fiches, saisons et épisodes disponibles dans le jeu d'exemple.
- Deux profils fictifs, renommage, avatars et création de profils supplémentaires.
- Favoris, À voir, En cours, historique déclaré et sélection des épisodes par profil.
- Persistance sur le même navigateur et réinitialisation des essais.

« Essayer la démo » remplace l'inscription et la connexion. Aucun mot de passe, e-mail,
jeton Firebase ou formulaire Google n'est demandé. Aucun lecteur vidéo tiers n'est chargé.
Le bouton de lecture explique cette limitation. Effacer le stockage du navigateur efface
les essais. Il n'y a pas de synchronisation entre appareils ni d'administration publique.

## Construction et isolation

```sh
pnpm build:demo
pnpm test:demo
```

`scripts/build-demo.cjs` construit uniquement `output/github-pages/`, répertoire ignoré
par Git. Il sélectionne dix pages, leurs ressources frontend et les médias publics suivis.
Il n'initialise aucun SDK cloud et ne lit pas `.env`, les utilisateurs, ni le catalogue Firebase.
Les adaptateurs de `demo/` remplacent l'authentification et la persistance uniquement dans
le résultat construit. Les fichiers applicatifs originaux du dépôt restent inchangés.

Les requêtes des composants de catalogue et de profils sont dirigées vers un adaptateur
local sans repli réseau. La CSP de la démo interdit les connexions réseau JavaScript,
les formulaires et les iframes. Les liens de documentation ou de services officiels restent
ouvrables volontairement. Les chemins fonctionnent sous `/Hessflix/` comme à la racine.

Les écritures utilisent le préfixe `hessflix-demo:v1:` ; les composants de sélection utilisent
l'identité fictive `hessflix-demo-visitor`. Aucune ancienne donnée de compte ou d'invité n'est
importée. Si le stockage est refusé ou saturé, un avertissement indique la conservation
temporaire en mémoire. Les profils locaux d'une démo ne constituent pas une frontière de
sécurité : toute personne utilisant le même navigateur peut consulter ces essais.

## Publication

Dans les paramètres Pages du dépôt, la source doit être **GitHub Actions**. Le workflow
`Hessflix verification` ne publie la démo que depuis `main`, après les contrôles de publication,
les tests serveur/navigateur et les tests de règles avec les émulateurs. Le job de déploiement
a uniquement les permissions Pages/OIDC nécessaires ; les tests conservent leur jeton en lecture seule.
Seul le dossier construit est envoyé à Pages, jamais la racine du dépôt.

Pour le véritable site avec Firebase, utiliser le serveur Node et sa configuration privée,
comme décrit dans le README. La démonstration ne configure ni ne remplace ce déploiement.
