# Listes personnelles synchronisées

## Utilisation

Connectez-vous, choisissez un profil, puis utilisez Favoris, À voir, À reprendre et Marquer comme vu sur les fiches. Le profil retrouve ses listes, son historique déclaré et sa sélection de saison/épisode sur les appareils du même compte. Les visiteurs voient « sans synchronisation » et gardent leurs listes dans leur navigateur.

« Continuez l’aventure » donne la priorité aux titres en cours présents dans la sélection chargée, puis aux fiches récemment consultées sur cet appareil et aux suggestions. La rubrique En cours du profil retrouve aussi les titres hors de cette sélection initiale.

Une modification est d’abord conservée dans `hessflix-personal-v1:{uid}:{profileId}`. Un journal par champ est envoyé au serveur : on ne remplace jamais une liste entière par une copie ancienne. Les opérations des appareils sont fusionnées ; pour des choix contradictoires sur un même champ, la dernière opération reçue par le serveur l’emporte. Les séquences par appareil empêchent les doublons lors des renvois.

Les actions sont envoyées rapidement après le clic. Un contrôle a lieu toutes les 20 secondes lorsque la page est visible, au retour en ligne et au retour dans l’onglet. Le temps actif est regroupé pour limiter les écritures. Réglages → Relancer la synchronisation et le bandeau Réessayer permettent une relance manuelle. Une panne conserve le journal local et affiche un avertissement, sans fausse confirmation cloud.

Si le stockage du navigateur est bloqué/plein, les changements restent en mémoire avec un avertissement : garder l’onglet ouvert et rétablir stockage/réseau. Fermer cet onglet peut perdre ce qui n’a pu être écrit nulle part. Ne pas effacer les données du navigateur tant qu’une synchronisation est en attente. Le journal est limité à 2 000 opérations ; au-delà, les nouveaux ajouts sont refusés explicitement.

## Migration sans mélange

Seules les anciennes clés contenant exactement l’UID connecté et le profil vérifié sont importées automatiquement : `movix-favorites-v1:{uid}:{profileId}`, l’éventuelle watchlist, `hessflix-activity-v1:{uid}:{profileId}` et les choix d’épisodes portant ce même suffixe. Les sources restent intactes. Un marqueur empêche une réimportation à chaque chargement ; les suppressions récentes ont priorité sur un import ancien.

Les clés anonymes, sans UID/profil, celles d’autres comptes et les données malformées ne sont pas importées. Aucun favori visiteur n’est automatiquement transféré à un compte. Les caches de profils vérifiés sont séparés par UID. Les modifications d’un profil supprimé restent en attente pour ce profil, sans basculer vers le principal.

## Configuration locale

Le serveur utilise l’intégration Firebase Admin/ADC existante et le même projet Firestore que le catalogue. Aucun secret supplémentaire n’est nécessaire dans le navigateur. Firestore doit être activé et l’identité serveur doit avoir les permissions Firestore prévues par le projet. Aucun nouvel index n’est nécessaire.

`firestore.rules` refuse explicitement les accès directs à `viewerAccounts`. Le refus global déjà présent protégeait aussi ce nouvel espace. Les appels passent par le serveur qui vérifie les autorisations. Pour aligner fichier local et cloud lors d’un déploiement de règles approuvé : `firebase deploy --only firestore:rules --project demo-hessflix`. Ce travail ne publie pas le site et ne modifie pas automatiquement les paramètres cloud.

Les documents privés sont `viewerAccounts/{uid}` et `viewerAccounts/{uid}/personal/{profileId}`. Prévoir leur sauvegarde dans la politique Firestore, ainsi que les anciennes sources pour récupération. La suppression d’un profil retire son accès mais ne supprime pas physiquement les archives ; une politique d’effacement définitif reste à définir avant production.

## Tests reproductibles

1. Ouvrir deux sessions de navigateur indépendantes, connecter le même compte et choisir le même profil.
2. Ajouter un favori et un titre À voir, choisir un épisode et le marquer vu dans la première session. Après synchronisation, vérifier la seconde.
3. Choisir un autre profil : les listes sont distinctes. Revenir au premier : rien n’a disparu.
4. Simuler une panne de `/api/personal/` dans les outils développeur, modifier puis recharger. Le choix et le message d’attente restent. Rétablir le réseau et réessayer : l’autre session reçoit le changement sans doublon.
5. Se déconnecter : les données privées ne deviennent pas celles du visiteur. Un autre compte ne peut pas demander les profils du premier.

Les tests automatisés utilisent un double transactionnel Firestore et des comptes Firebase simulés. Ils vérifient les vraies routes HTTP et le JavaScript navigateur, sans modifier le vrai compte. Une validation finale avec deux appareils réels et les vrais comptes reste à effectuer. `localhost` sur un téléphone désigne le téléphone : il faudra un serveur partagé accessible en HTTPS pour ce test physique, sans exposer automatiquement le site aujourd’hui.

Commandes : `pnpm typecheck`, `pnpm test:server`, `pnpm test:browser`. Les tests de règles nécessitent Java 21 : `pnpm test:rules`. Avec Java 8 uniquement, ces tests restent non exécutés ; ne pas installer une autre version sans accord.

## Vérifications effectuées le 26 octobre 2026

- Vérification TypeScript des modules configurés : réussie, y compris dans la copie locale du Bureau.
- 72 tests serveur/modèles : réussis.
- 63 tests navigateur Edge : réussis. Des reprises ciblées ont aussi vérifié le suivi affiché sur l’accueil et les messages de synchronisation.
- Deux sessions indépendantes avec identité Firebase simulée : favoris, À voir, épisode sélectionné et épisodes vus retrouvés ; profils séparés ; journal conservé après panne et rechargement ; anciennes données anonymes non importées.
- Lecture réelle Firestore avec la configuration serveur existante : réussie, sans créer ni modifier de document pour ce diagnostic.
- Serveur réel redémarré sur localhost:4180 : modules accessibles, listes sans jeton refusées (401), dossier privé inaccessible (404).
- Tests de règles d’émulateurs : non exécutés, Java 21 absent. Test physique téléphone/ordinateur et vraie connexion Firebase : à effectuer par le propriétaire.

Une sauvegarde des anciens fichiers applicatifs a été créée dans `.local-backups/personal-sync-20261026-000710/` du projet du Bureau. Les fichiers `.env`, les clés et les anciennes données `.data` n’ont pas été remplacés. Aucun paramètre cloud ni déploiement public n’a été effectué.
