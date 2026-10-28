# Profil et activité personnelle

Le profil propose Accueil, À voir, Déjà vu, En cours, Favoris, Temps et Réglages. Les compteurs et les raccourcis Films/Séries/Animes sont conservés. Les listes et l’activité sont synchronisées par compte **et** profil ; les visiteurs restent en stockage local. Voir [SYNCHRONISATION.md](SYNCHRONISATION.md).

## Ce qui alimente les listes

- Sur une fiche publiée, **À voir** ajoute ou retire une envie indépendante des autres listes.
- **À reprendre** ajoute le film ou l’épisode sélectionné dans En cours.
- **Marquer comme vu** ajoute le film ou l’épisode à l’historique. La même entrée n’est pas comptée deux fois. Un film terminé quitte En cours ; une série reste en cours tant que ses épisodes publiés ne sont pas tous déclarés vus. Cela ne garantit pas que l’œuvre entière soit terminée si elle est encore en diffusion.
- Les étoiles et la rubrique Favoris utilisent exactement la même liste synchronisée.
- Le choix de saison/épisode est sauvegardé pour le profil. Consulter une fiche ou choisir un épisode ne crée pas de faux visionnage.
- Seules les métadonnées publiées sont affichées ; un titre masqué/supprimé devient « Contenu indisponible » sans effacer le suivi personnel.

Le site ne connaît pas automatiquement la minute atteinte dans un lecteur externe. Aucun pourcentage ni durée de vidéo n’est inventé : le suivi livré est la sélection d’épisode et les états déclarés par l’utilisateur.

## Temps passé

Le compteur avance par intervalles de cinq secondes lorsque le compte est connecté, le profil chargé, l’onglet visible et une interaction effectuée depuis moins de 90 secondes. Il s’arrête en arrière-plan et ignore les longues interruptions. Les intervalles simultanés récents sont fusionnés côté serveur pour éviter le double compte entre onglets/appareils. Les jours suivent le fuseau local du navigateur ; les sept derniers jours alimentent le graphique.

Ce compteur mesure le temps actif sur le site, pas la durée des vidéos externes. La page de crédits autonome n’est pas comptée. C’est une statistique de confort : les horloges des appareils, les changements de fuseau et les fermetures brutales peuvent affecter sa précision.

## Limites et confidentialité

Les listes conservent au maximum 500 titres chacune, l’historique 1 000 entrées et le détail quotidien 366 jours. Les limites sont refusées explicitement, sans remplacement silencieux des anciennes données. Cache et changements non envoyés restent dans ce navigateur ; les données confirmées sont dans Firestore. Déconnecter un compte ne réattribue pas son cache à un autre.

Les tests `activity.test.cjs` vérifient le modèle local historique. Les tests `personal.test.cjs` et les parcours navigateur vérifient le modèle synchronisé, les permissions, les épisodes, les migrations, le mode visiteur et les erreurs réseau. Ils utilisent des identités simulées, pas les vrais comptes Firebase.
