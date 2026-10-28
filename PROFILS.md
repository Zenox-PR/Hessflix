# Profils de spectateurs

« Changer de profil » ouvre « Qui regarde ? ». Un compte connecté possède un profil principal et peut ajouter quatre profils supplémentaires. Nom, avatar, listes et activité appartiennent au profil sélectionné. Connexion, e-mail et permissions Firebase restent communs au compte. Il ne s’agit pas de comptes Firebase distincts ni d’un contrôle parental.

## Stockage et migration

- Firebase Authentication conserve l’identité, les droits et le nom/avatar du profil principal.
- Firestore conserve les profils supplémentaires dans `viewerAccounts/{uid}`. Les listes sont dans `viewerAccounts/{uid}/personal/{profileId}` ; `primary` désigne le profil principal.
- À la première lecture authentifiée, les anciens profils serveur `.data/viewer-profiles/` sont importés transactionnellement si le registre cloud n’existe pas. Leurs identifiants restent inchangés. Les fichiers originaux restent conservés, exclus de Git et inaccessibles par HTTP. `MOVIX_PROFILES_DIRECTORY` désigne leur emplacement éventuel.
- Le profil actif reste propre à chaque appareil. Un cache de profils déjà vérifiés permet de retrouver la sélection hors ligne.
- Supprimer un profil le retire du registre et bloque l’accès à ses listes. Les archives ne sont pas détruites silencieusement ni réimportées lors d’une lecture suivante.

## Sécurité

Chaque requête `/api/profiles` et `/api/personal/{profileId}` exige un ID token Firebase vérifié côté serveur, avec contrôle de révocation. L’UID vient du jeton, jamais du corps envoyé par le navigateur. Un profil secondaire doit appartenir au compte ; les transactions revérifient cette appartenance. Un autre compte, même administrateur, n’accède pas à ces listes par cette API.

Les mutations exigent l’origine exacte, un schéma fermé, des tailles bornées et une limitation de fréquence. Le navigateur ne lit/écrit pas directement les documents privés Firestore : les règles refusent tout accès client à `viewerAccounts`, même au propriétaire. Le serveur Admin SDK est responsable des autorisations.

Les tests des anciens fichiers locaux restent utiles pour valider la migration. Ce stockage local n’est plus le stockage normal des nouveaux profils ; il n’est activé directement que par injection explicite dans les tests.

Voir [SYNCHRONISATION.md](SYNCHRONISATION.md) pour les listes, le journal hors ligne, les essais et la configuration.
