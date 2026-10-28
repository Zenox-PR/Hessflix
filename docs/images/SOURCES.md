# Captures du README

`profile-desktop.png` et `profile-mobile.png` sont des captures de la véritable page `compte.html` de cette copie de Hessflix, produites avec `scripts/capture-readme.cjs` le 28 octobre 2026.

- Identité fictive : `Profil de démonstration`, `demo@example.test`.
- Catalogue vide et base Firestore en mémoire, via le double de test existant.
- SDK d'authentification simulé ; aucune identité, donnée, clé ou connexion Firebase réelle.
- Seuls le monogramme Hessflix et l'avatar neutre locaux sont autorisés comme images. Les autres images et accès externes, hors modules SDK simulés, sont bloqués.
- Les styles, textes, structure et comportement sont ceux de l'application. Aucun habillage fictif ni aucune affiche commerciale n'a été ajouté.
- Le temps affiché représente la courte session fictive, pas une statistique d'utilisation réelle.

Reproduction : `node scripts/capture-readme.cjs`. Le script utilise Microsoft Edge par défaut s'il est installé ; `MOVIX_TEST_BROWSER_CHANNEL` peut sélectionner un autre canal Playwright installé. Aucun navigateur n'est installé automatiquement.

Les captures documentent l'interface avec l'autorisation de son propriétaire, dans les limites des droits qu'il détient. Elles ne donnent aucun droit supplémentaire sur d'éventuelles contributions tierces à l'interface. Voir `LICENSE` et `THIRD_PARTY_NOTICES.md`.
