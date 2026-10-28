# Versionnement local et copie du Bureau

Le dépôt de travail se trouve dans `Documents/ChatGPT/pe fr site`. Le projet livré est son sous-dossier `Movix_Reconstruction`, et le workflow partagé est `.github/workflows/movix-tests.yml` à la racine du dépôt. Les archives, sources d'origine et captures externes au projet ne doivent pas être ajoutées par un `git add .` global.

Le contrôle ciblé avant versionnement recherche les clés privées et champs d'identification sensibles. `.gitignore` exclut les identifiants usuels, dépendances installées, journaux, runtimes temporaires et résultats de tests. Cette recherche ciblée ne certifie pas toutes les formes possibles de secrets et ne remplace pas leur revue avant publication. La configuration Web Firebase est publique et n'est pas une clé privée administrateur.

Pour retrouver l'instantané local et inspecter les changements :

```powershell
git log --oneline -- Movix_Reconstruction .github/workflows/movix-tests.yml
git status --short
git diff -- Movix_Reconstruction .github/workflows/movix-tests.yml
```

La copie de livraison se trouve dans `Desktop/_/Movix_Reconstruction`. Le dossier `.git` du dépôt de travail n'y est pas copié, car il gère aussi le dossier parent. Les fichiers de livraison et le workflow y sont copiés ; le workflow détecte automatiquement si le projet est à la racine du dépôt ou dans `Movix_Reconstruction`.

Avant tout futur envoi sur GitHub, vérifier le dépôt distant, les fichiers à publier et les secrets. L'instantané local ne publie pas le site et n'envoie aucun fichier sur Internet. Pour une installation propre, utiliser `pnpm install --frozen-lockfile --ignore-scripts`, puis `pnpm test` et `pnpm run test:rules` avec Java 21.
