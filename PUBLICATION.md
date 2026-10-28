# Copie autonome préparée pour revue GitHub

**Mise à jour — démonstration GitHub Pages :** la publication du portfolio construit désormais
une version statique isolée via `pnpm build:demo`. Seul `output/github-pages/` est déployé,
après les tests. Elle n'utilise aucun compte Firebase ni secret et n'expose pas les routes
administrateur. Voir [docs/DEMO.md](docs/DEMO.md). Les paragraphes décrivant la préparation
initiale ci-dessous sont historiques ; le serveur complet reste distinct de la démo.

Cette copie contient uniquement Hessflix. Lors de la préparation initiale, aucun dépôt distant, aucune publication et aucun push n'avaient été créés. L'ancien dépôt et ses sauvegardes restent sur le poste du propriétaire. L'historique ancien n'est pas importé. Les réserves documentées sur les droits des médias tiers restent applicables ; une décision de publier ne vaut pas confirmation de ces droits.

Les paramètres Firebase sont des exemples : cette copie n'est pas reliée au compte du propriétaire. Pour votre propre instance, remplacer les valeurs de firebase-auth.js par la configuration Web de votre projet, puis PROJECT_ID et ADMIN_UID dans server/policy.cjs. Remplacer le même UID exemple dans firestore.rules, storage.rules et database.rules.json. Ces fichiers sont du code de configuration, pas des données d'utilisateurs. Ne jamais remplacer ces valeurs par une clé privée.

Configurer également le domaine Firebase de votre projet dans server/security-headers.cjs : la CSP doit autoriser le domaine d'authentification utilisé. Les paramètres demo-hessflix et example-admin-uid sont uniquement des exemples, jamais des comptes réels fournis avec le code.

Copier .env.example vers .env localement et renseigner TMDB_API_KEY côté serveur. Vidmoly utilise des URL d'intégration validées et ne lit aucune clé API dans cette version. Utiliser ADC hors du dépôt pour Firebase Admin ; ne pas configurer les identifiants cloud du propriétaire. Les fonctions cloud exigent un projet Firebase personnel configuré ; la consultation du code et les tests simulés n'exigent pas de production.

Node >=22, pnpm 11.25.0 : pnpm install --frozen-lockfile --ignore-scripts ; pnpm exec playwright install chromium ; pnpm test ; pnpm test:publication. Les tests de règles exigent Java 21 et pnpm test:rules, uniquement avec les émulateurs demo-movix-admin. Aucun déploiement automatique n'est prévu.

Avant une publication autorisée, exécuter pnpm security:publication, contrôler PUBLICATION_MANIFEST.json et le contenu de git diff --cached. Refaire pnpm audit et pnpm audit --prod. Le contrôle est heuristique, pas une certification. Les fichiers binaires nécessitent une revue humaine ; les droits des visuels restent documentés dans assets/**/SOURCES.md.

Risque restant à la préparation : une alerte modérée @opentelemetry/core, transitive de firebase-tools, reste dans les dépendances de développement. Les deux alertes élevées body-parser ont été corrigées ; l'audit production ne remonte aucune alerte à la date du contrôle. Ne pas remplacer automatiquement une dépendance 1.x par 2.x sans validation de compatibilité.

La CI utilise des actions épinglées par SHA, un jeton en lecture seule, aucun secret cloud et aucune étape de déploiement. Elle n'a pas été exécutée sur GitHub pendant la préparation.
