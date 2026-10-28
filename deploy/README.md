# Préparation de production

Ces fichiers sont des configurations à appliquer sur l'hébergement choisi. Aucune ressource cloud ni permission IAM n'a été modifiée pendant la correction locale.

## Identité serveur

Le catalogue utilise désormais Firestore. Le rôle Auth `runtime-role.json` reste inchangé et ne suffit pas aux opérations documentaires : `catalogue-role.json` prépare les permissions supplémentaires de lecture/écriture et transactions, sans gestion des bases, index, règles ou claims. Aucune liaison IAM n'a été effectuée. Voir [CATALOGUE_ADMIN.md](../CATALOGUE_ADMIN.md) pour l'activation volontaire de Firestore, la vérification des règles existantes et les index ; ne pas lancer un déploiement de site pour activer le catalogue local.

Créer un compte de service dédié au runtime dans `demo-hessflix`, puis lui attribuer un rôle personnalisé construit à partir de `runtime-role.json`. Ne pas lui attribuer Owner, Editor, Firebase Admin ni Firebase Authentication Admin. Examiner également les permissions héritées et les possibilités d'usurpation d'autres identités.

Conserver l'identité qui attribue les claims dans un environnement d'administration séparé. Ne pas transmettre ses ADC au serveur. Le script terminal d'attribution utilise une instance SDK distincte ; aucune route HTTP ne l'appelle.

Configurer dans l'environnement de production :

```text
NODE_ENV=production
MOVIX_PUBLIC_ORIGIN=https://votre-domaine.fr
MOVIX_SERVER_SERVICE_ACCOUNT=movix-runtime@demo-hessflix.iam.gserviceaccount.com
```

Remplacer le nom du compte et le domaine par ceux effectivement créés. Préférer un compte attaché à l'hébergement. Si un fichier de compte de service est nécessaire, le placer hors du projet et fournir son chemin via `GOOGLE_APPLICATION_CREDENTIALS`.

Au premier accès Firebase Admin, le serveur vérifie l'identité des ADC réellement utilisés et interroge `testIamPermissions`. Il exige la consultation des utilisateurs et la création des sessions ; il refuse notamment modification/création/suppression d'utilisateurs, changement de politique IAM et permissions d'usurpation testées. Si cette vérification échoue, l'accès administrateur est refusé. Ce contrôle n'est pas un audit exhaustif de l'organisation IAM ni des rôles conditionnels et de tous les services cloud. Il utilise `getServiceAccountEmail()` de l'implémentation ADC du SDK Admin épinglé à 14.5.0 ; revérifier cette interface lors d'une mise à jour du SDK.

## Proxy et anti-abus

Le serveur écoute sur loopback ; le proxy HTTPS doit router `/admin` et `/api/admin/*` vers Node. Chaque processus limite la création de session à 10 tentatives/minute par adresse TCP et 100 globalement. Les API ont aussi un plafond de 120/minute/adresse et 600 globalement ; la vérification des sessions a un plafond de 60/minute/adresse et 300 globalement. Une réponse 429 inclut `Retry-After`.

Les compteurs expirent après 60 secondes et leur nombre est borné. `X-Forwarded-For` est volontairement ignoré : derrière un proxy, les visiteurs partagent le quota de son adresse. Compléter avec des quotas par IP réelle au proxy, configuré pour remplacer les en-têtes entrants. En présence de plusieurs processus ou machines, ajouter un quota partagé au proxy ou dans un stockage commun. Les compteurs locaux sont remis à zéro au redémarrage. Configurer la surveillance des réponses 429 et des refus administrateur au niveau de l'hébergeur.

## Règles et services Firebase

Exécuter `pnpm run security:cloud` avec un compte autorisé à lire la configuration. Le script inventorie les ressources et compare les règles publiées aux fichiers locaux sans déployer ni lire les données métier. Une différence de texte n'est pas nécessairement une faille ; une égalité n'est pas un audit de sécurité complet. Un code de sortie 2 signifie qu'une vérification reste incomplète ou qu'une différence a été détectée.

Le 23 octobre 2026, les API Firestore et Realtime Database ont répondu `SERVICE_DISABLED`, la liste des buckets était vide et aucune release de règles n'a été renvoyée. Ne pas activer de services uniquement pour faire disparaître ces résultats. Avant d'utiliser une base, activer le service nécessaire, examiner les règles existantes, fusionner si nécessaire et déployer les règles testées. Refaire ensuite la vérification avec les permissions nécessaires.

## Dépendances de production

Installer avec `pnpm install --prod --frozen-lockfile --ignore-scripts`. Les outils Firebase, Playwright et SDK clients de test ne sont pas nécessaires sur le serveur. Le déploiement d'un simple répertoire statique ne convient pas à l'administration protégée.
