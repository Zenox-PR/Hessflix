# Administration sécurisée de Movix

Projet Firebase : `demo-hessflix`.

Seul UID autorisé : **`example-admin-uid`**.

Le rôle est le Custom Claim **`admin: true`**, booléen. Un champ `admin` ou `role` dans un profil, un cookie fabriqué, une variable JavaScript ou le stockage du navigateur ne donne aucun privilège.

## État de l'installation

Le code, le SDK Admin, `/admin`, la protection serveur et les fichiers de règles sont préparés. Les tests serveur et les émulateurs utilisent des comptes fictifs. L'audit précédent rapporte une attribution du rôle confirmée par une capture ; son état actuel n'a pas été revérifié pendant les corrections P1. Ne pas réattribuer le rôle sans nécessité. Les règles publiées et les services ont fait l'objet d'un diagnostic distinct : voir `RAPPORT_P1.md`.

## 1. Attribuer le rôle une seule fois

Utiliser un terminal de confiance sur votre ordinateur ou un environnement Cloud Shell privé. Le projet doit disposer de Node.js 22 ou plus récent. Les dépendances de production sont déjà installées dans la copie locale ; pour une nouvelle installation :

```powershell
Set-Location 'C:\Users\VOTRE_UTILISATEUR\Desktop\_\Movix_Reconstruction'
pnpm install --prod --frozen-lockfile --ignore-scripts
```

### Méthode recommandée : Application Default Credentials (ADC)

Sur une machine de confiance équipée du CLI Google Cloud, se connecter manuellement avec l'identité propriétaire ou une identité autorisée à modifier les utilisateurs Firebase :

```powershell
gcloud auth application-default login
node scripts/grant-admin.cjs --check
node scripts/grant-admin.cjs --apply
```

Sur cette machine, si `node` n'est pas dans le PATH, l'exécutable déjà disponible est :

```powershell
$movixNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $movixNode scripts/grant-admin.cjs --check
& $movixNode scripts/grant-admin.cjs --apply
```

`--check` ne modifie rien. `--apply` attribue le claim uniquement à l'UID figé dans le script, conserve les autres claims puis relit le compte pour vérifier le résultat. Aucun argument ne permet de fournir un autre UID. Si `admin` est déjà `true`, le script ne réécrit rien : il est idempotent. Ne pas exécuter ce script dans une page, une route HTTP ou une fonction publique.

### Si un fichier de compte de service est indispensable

Le conserver **hors du projet et de tout dépôt Git**, par exemple dans un dossier privé `C:\Firebase-secrets`. Ne jamais l'envoyer dans une conversation, le coller dans un fichier JS, l'ajouter au dossier `_` ou le publier. Fournir uniquement son chemin au processus :

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\Firebase-secrets\demo-hessflix-admin.json'
node scripts/grant-admin.cjs --check
node scripts/grant-admin.cjs --apply
Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS
```

Aucune clé n'est incluse dans ces instructions. Le script refuse un fichier de credentials situé dans le projet ou son dépôt Git et refuse un `project_id` différent. Les motifs de clés usuels, `.env`, les dépendances et les dossiers de secrets sont exclus de Git. Ces exclusions ne rendent pas acceptable une clé stockée dans le projet.

Après le bootstrap, révoquer les identifiants temporaires selon votre méthode d'accès. Si une clé temporaire a été créée, révoquer cette clé dans IAM ; supprimer uniquement sa copie locale ne révoque pas la clé. Utiliser une identité distincte pour l'exécution du site.

## 2. Configurer le serveur de vérification

Le serveur Node a besoin de ses propres ADC pour vérifier les utilisateurs et créer les sessions. En hébergement Google, privilégier une identité de service attachée à l'environnement. Lui donner les permissions de consultation des utilisateurs et de création de sessions nécessaires, **pas la permission de modifier les utilisateurs/claims**. L'identité qui effectue le bootstrap ne doit pas être celle du serveur courant.

Depuis les corrections P1, le mode HTTPS ou `NODE_ENV=production` impose aussi `MOVIX_SERVER_SERVICE_ACCOUNT` et vérifie l'identité des ADC et un ensemble de permissions IAM avant d'initialiser l'administration. Utiliser le modèle `deploy/runtime-role.json` et suivre `deploy/README.md`. La création du compte et l'attribution réelle du rôle restent à effectuer sur l'hébergement choisi.

Lancer `node server.cjs`, ou `Ouvrir Movix.cmd`, puis ouvrir `http://localhost:4180/admin`. Le catalogue et la connexion restent disponibles même si les ADC administrateur ne sont pas encore configurés ; l'administration échoue fermée.

En production, exposer ce serveur derrière HTTPS et un proxy de confiance, et configurer l'origine exacte (sans slash final) :

```powershell
$env:MOVIX_PUBLIC_ORIGIN = 'https://votre-domaine.fr'
node server.cjs
```

Le serveur écoute sur l'interface locale. Le proxy doit router `/admin` et `/api/admin/*` vers Node. Ne pas remplacer ce serveur par un hébergement statique du dossier complet : `server/`, `scripts/`, `admin-private/`, `node_modules/` et les règles ne doivent jamais être exposés comme fichiers publics. La configuration fournie ne publie aucun dossier Firebase Hosting.

## 3. Actualiser les droits et ouvrir /admin

1. Se connecter à Movix avec le compte correspondant à l'UID autorisé.
2. Ouvrir `/admin` et cliquer **Actualiser mes droits et entrer**. Le navigateur appelle `getIdToken(true)` ; les claims fraîchement signés sont inclus dans le nouveau jeton.
3. Le serveur vérifie le jeton (signature, projet, expiration et révocation), `admin === true`, l'UID exact, puis relit les claims actuels et l'état désactivé du compte dans Firebase.
4. Pour créer une session privilégiée, la connexion doit dater de moins de cinq minutes. Si demandé, se reconnecter. Un simple rafraîchissement de jeton ne renouvelle pas la date de connexion initiale.
5. Une session Firebase d'une heure est placée dans un cookie `HttpOnly`, `SameSite=Strict`, et `Secure` en HTTPS (préfixe `__Host-`). En développement localhost HTTP, le cookie n'a pas `Secure`.

Le document privé de `/admin` n'est servi qu'après cette vérification. Sans session valide, la réponse est 401/403 avec une page publique de demande d'accès, pas le tableau privé. Chaque API admin contrôle la session et les claims actuels. Les requêtes de création/suppression de session exigent l'origine exacte et un jeton anti-CSRF signé.

La déconnexion tente de supprimer le cookie serveur, puis ferme Firebase même si cette première opération échoue. Dans ce cas, un avertissement explicite permet de réessayer et son état persiste dans `sessionStorage` quand ce stockage est disponible. Tant que la suppression n'est pas confirmée, le cookie administrateur peut rester utilisable jusqu'à son expiration ; fermer le navigateur ne suffit pas à le révoquer. Le SDK n'est pas autorisé à utiliser un émulateur Auth pour le serveur réel. Aucun endpoint ne modifie de claims ; ni les visiteurs ni les utilisateurs classiques n'ont de chemin d'auto-attribution.

## 4. Installer les règles Firebase

Les fichiers `firestore.rules`, `storage.rules` et `database.rules.json` protègent les chemins `/admin/**` avec le même UID et le claim booléen. Les profils modifiables côté client ont un schéma limité et n'acceptent pas `admin`, `role` ou `customClaims`. Tout autre chemin est refusé par défaut.

Les règles de profils exigent un `displayName` chaîne de 1 à 60 caractères. `photoURL` est facultatif ; s'il est présent, il doit être une chaîne vide ou une URL HTTPS de 2048 caractères au maximum, avec hôte simple et caractères URI ASCII autorisés. Encoder les caractères non ASCII et les espaces dans les URL. Les règles et le validateur JavaScript partagent ces contraintes. Firestore refuse `null` ; dans Realtime Database, `null` supprime un champ facultatif et un objet entièrement null supprime le profil, conformément aux suppressions autorisées au propriétaire.

**Avant déploiement : relire les règles actuellement utilisées dans votre console et fusionner les règles si d'autres applications du projet possèdent déjà des chemins de données.** Le site présent n'utilise pas encore de base de favoris ; ne pas écraser à l'aveugle les règles d'une autre application. Les autorisations Firebase sont additives : aucune autre règle plus large ne doit autoriser ces chemins protégés.

Depuis un terminal Firebase CLI authentifié, après cette revue :

```powershell
firebase deploy --project demo-hessflix --only firestore:rules
firebase deploy --project demo-hessflix --only storage
firebase deploy --project demo-hessflix --only database
```

Ne lancer que les commandes des services déjà activés et effectivement utilisés. Ne pas créer de base ou activer une offre payante uniquement pour ces exemples. Les règles clients ne s'appliquent pas aux appels du SDK Admin : les contrôles serveur sont donc indépendants et obligatoires.

## 5. Tests reproductibles

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec playwright install chromium
pnpm test
pnpm run test:rules
```

Les tests de règles demandent Java 21 ou plus récent et lancent uniquement les émulateurs avec le projet fictif `demo-movix-admin`. Ils ne déploient rien. Un runtime Java temporaire a été utilisé dans `.test-runtime/` du dossier de préparation (`Documents\ChatGPT\pe fr site\Movix_Reconstruction`), sans changer les réglages système ; ce runtime n'est pas inclus dans la copie du Bureau. Pour rejouer ces tests, fournir un `JAVA_HOME` pointant vers Java 21 et ajouter son dossier `bin` au PATH du terminal.

Cas vérifiés : visiteur, compte classique, bon UID sans claim, claim chaîne au lieu de booléen, autre UID avec claim, JWT non signé rejeté par le vrai SDK Admin, cookie falsifié/révoqué, retrait du rôle actif, compte désactivé, CSRF/origine forgée, document privé et fichiers serveur inaccessibles par HTTP, cookie HTTPS, écriture illégale de rôles dans les trois moteurs de règles. L'attribution du script est testée avec un service simulé. Les tests de connexion et de limitation des requêtes sont également intégrés ; résultats détaillés dans `RAPPORT_P1.md`.

En cas de retrait ultérieur d'un rôle, le serveur relit le rôle actif et bloque les accès immédiatement. Les règles Firebase évaluent les claims du jeton présenté : un ancien jeton déjà émis peut rester valable jusqu'à son renouvellement ou son expiration. Prévoir la révocation/expiration des sessions et le renouvellement des jetons pour une politique complète de retrait des accès aux bases.

Références officielles : [Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims), [vérification des jetons](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [sessions serveur](https://firebase.google.com/docs/auth/admin/manage-cookies), [ADC et Admin SDK](https://firebase.google.com/docs/admin/setup).
