# Firebase Authentication — Movix

Projet : `demo-hessflix`. La configuration Web publique fournie est intégrée dans `firebase-auth.js`. Aucun fichier administrateur n'est requis.

## Lancer le site

Double-cliquer sur `Ouvrir Movix.cmd` et conserver la fenêtre du serveur ouverte. Le site est disponible sur **http://localhost:4180**. Si le port est déjà utilisé par ce serveur, ouvrir simplement cette adresse. Dans VS Code, on peut aussi exécuter `node server.cjs`.

## Vérifier la console Firebase

1. Ouvrir [Authentication, projet demo-hessflix](https://console.firebase.google.com/project/demo-hessflix/authentication/providers).
2. Dans les méthodes de connexion, activer **Google** (en choisissant l'e-mail d'assistance demandé) et **E-mail/Mot de passe** si ce n'est pas déjà fait.
3. Dans **Paramètres > Domaines autorisés**, vérifier le domaine utilisé. Le contrôle public effectué le 22 octobre 2026 confirme que `localhost`, `demo-hessflix.firebaseapp.com` et `demo-hessflix.web.app` sont déjà autorisés. Ajouter le futur domaine du site lors de son hébergement. Un nom d'hôte est attendu, sans protocole ni port.

Documentation : [Google](https://firebase.google.com/docs/auth/web/google-signin), [E-mail/Mot de passe](https://firebase.google.com/docs/auth/web/password-auth), [persistance de session](https://firebase.google.com/docs/auth/web/auth-state-persistence).

## Parcours disponibles

- Connexion Google dans une fenêtre de choix du compte.
- Connexion avec un compte e-mail existant.
- Création d'un compte e-mail avec nom de profil et confirmation du mot de passe.
- Demande d'e-mail de réinitialisation du mot de passe.
- Mise à jour du menu depuis l'observateur Firebase et déconnexion réelle.

Les anciens aperçus simulés ne donnent plus d'état connecté. Les mots de passe ne sont jamais enregistrés par le code de l'application. L'authentification ne crée pas automatiquement de favoris, d'abonnement VIP ou de base Firestore. Ces rubriques restent à développer et devront utiliser des règles serveur liées à l'identifiant Firebase.

## Validation réalisée

Le SDK officiel charge bien la configuration et initialise Authentication sur localhost. Le point d'accès public du projet répond et confirme les domaines autorisés. Les parcours de formulaire, erreurs, retour au catalogue, persistance et déconnexion sont vérifiés avec un SDK simulé dans un navigateur ; aucun utilisateur réel n'a été créé et aucun e-mail de test envoyé. La connexion Google avec un vrai compte et les méthodes activées dans la console restent à valider par le propriétaire.

Analytics n'est pas initialisé par le module d'authentification. Aucun déploiement public et aucune modification de règles Firebase en production n'ont été effectués. Les règles préparées et l'espace administrateur sont détaillés dans `ADMIN_SECURITE.md`. Le serveur Node est nécessaire, notamment pour fermer la session administrateur lors de la déconnexion.

Depuis les corrections P2/P3, `pnpm run test:firebase-smoke` vérifie le chargement du vrai SDK sous la CSP locale sans connexion ni création de compte. Le 23 octobre 2026, ce contrôle a réussi sans erreur de page ni violation CSP. La connexion Google complète avec un compte réel et le domaine de production restent à tester. La déconnexion locale continue si le serveur est en panne, avec avertissement explicite et possibilité de retenter la fermeture du cookie serveur.
