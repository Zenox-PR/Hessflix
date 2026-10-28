# Découverte du catalogue

Les rangées initiales ci-dessous sont aussi disponibles sur les cinq pages d’univers avec leurs propres sélections vérifiées. Voir [PLATEFORMES.md](PLATEFORMES.md) pour le relevé France, le filtrage par service, les compteurs réels de la sélection et les modules partagés. L’accueil n’affiche plus une grille « Tout le catalogue » permanente : la recherche et les filtres affichent les résultats quand on en a besoin.

## Disponible

- 51 titres réels dans la sélection initiale (37 films, 14 séries), complétés par les sélections des plateformes, avec affiches locales, résumés courts en français et notes publiques relevées le 23 octobre 2026. « Continuez l’aventure » affiche des titres réels ouverts récemment sur cet appareil ou des suggestions initiales.
- Tendances éditoriales, Films populaires Top 10, Séries populaires Top 10, huit sagas, Thrillers, Science-fiction, Action & aventure, Animation et Drames.
- Top 10 : tri numérique décroissant par note dans chaque type, puis nombre de votes disponible, puis titre en cas d’égalité. Les positions 1 à 10 ne sont pas des notes. Ce classement concerne cette sélection, pas la popularité mondiale en temps réel.
- Survol et focus clavier : titre, note, année, résumé et étoile. Sur appareil tactile, les informations restent visibles. Un clic sur l’affiche ouvre une page de fiche ; l’étoile est un bouton séparé.
- Flèches, glissement souris, balayage tactile et touches gauche/droite lorsque le rail a le focus. Avance automatique toutes les neuf secondes uniquement si le rail est visible et sans interaction. Survol, focus, interaction récente, onglet masqué ou réduction des animations suspendent l’avance. Aucun bouton de pause ajouté.
- Sagas et « Tout voir » ouvrent la sélection filtrée. Recherche insensible aux accents, type, genre et saga se combinent. « Pour vous » réinitialise les filtres. « Surprends-moi » ouvre une fiche aléatoire différente de la précédente.
- Favoris locaux séparés par UID et profil de spectateur, ou par visiteur anonyme. Ils persistent après rechargement si le navigateur autorise le stockage. Ils ne suivent pas l’utilisateur sur un autre appareil et ne sont pas une protection de confidentialité sur un appareil partagé. En cas d’échec de stockage, un message précise que le choix est seulement conservé pendant la visite.

## Organisation et sources

`discovery-data.js` contient le relevé généré. `discovery.js` construit les sections et carrousels ; `discovery.css` gère leur présentation. `app.js` réutilise les mêmes cartes pour les sections et la recherche. Le classement et les filtres sont dans `catalogue-model.js`.

Les fiches renvoient à IMDb ou TVMaze. La provenance est conservée dans `assets/discovery/SOURCES.md` et dans `sourceURL` / `imageSource`. Les résumés français sont rédigés pour cette interface ; les affiches restent la propriété de leurs titulaires. Les données IMDb choisies proviennent de leur offre non commerciale : vérifier les autorisations et conditions des sources avant un usage public ou commercial.

Actualisation manuelle avec accès réseau : `node scripts/sync-discovery.cjs`. Aucun secret ni clé administrateur n’est nécessaire. Cette opération met à jour les fichiers locaux ; aucune actualisation automatique distante n’est activée.

## Limites

Il s’agit d’un catalogue de découverte : aucun flux vidéo ni lecteur intégré. Les métadonnées d’épisodes TVMaze sont accessibles sur les nouvelles pages `titre.html`, mais elles ne garantissent pas la disponibilité de chaque épisode sur un service. Le classement est basé sur les notes de deux sources distinctes, pas sur des statistiques privées de visionnage. Les listes « À voir », « Déjà vu » et la synchronisation cloud des favoris ne sont pas implémentées par ce changement.

## Vérifications

`pnpm test` exécute le contrôle de types strict, les tests Node et les tests navigateur. Les nouveaux tests couvrent classement, filtres, rendu des données en texte, affiches, survol, favoris, sagas, fiche aléatoire, flèches, glissement, largeur mobile et respect de la réduction des animations. L’authentification des tests navigateur est simulée ; cela ne valide pas une nouvelle connexion au vrai projet Firebase et n’en modifie pas les comptes.
