# Sécurité

Ne publier aucun secret, export utilisateur, cookie, journal ou sauvegarde dans une issue ou une pull request. Décrire un problème sans données privées et contacter le propriétaire par un canal privé convenu avant de partager une preuve sensible. Aucun contact de sécurité public n'est configuré pour le moment.

Les fichiers `.env`, identités Firebase Admin et états de navigateur doivent rester hors de Git. Le modèle `.env.example` contient uniquement des paramètres de démonstration. Exécuter `pnpm security:publication` à la racine du dépôt autonome avant de proposer une modification. Ce contrôle analyse aussi l'historique local ; il complète une revue humaine et ne garantit pas l'absence de tout secret.

Le SDK Firebase Admin contourne les règles Firestore : les contrôles de session, révocation, UID et rôle côté serveur ainsi que les permissions IAM sont indispensables. Ne jamais remplacer ces contrôles par un simple masquage des boutons. Les règles incluses sont des sources à configurer et tester, pas une preuve de leur déploiement.

Les tests locaux utilisent des comptes, jetons et bases simulés. Les tests des règles utilisent uniquement le projet d'émulation `demo-movix-admin`. Les scripts d'import ou de diagnostic cloud doivent être exécutés explicitement avec l'identité du propriétaire ; la CI n'utilise aucune identité cloud et ne déploie rien.
