# Revue du README et de la licence

Date : 28 octobre 2026. Périmètre : uniquement la copie `Hessflix_GitHub_PREPARE`. Aucun push, commit, dépôt distant, déploiement ou changement de données Firebase. Le site d'origine n'a pas été modifié.

## Documents finalisés

- `README.md` : présentation propre à Hessflix, structure inspirée de TerminalLearning sans reprise de son code, identité ou statistiques ; architecture et versions rapprochées des fichiers du projet.
- `LICENSE` : adaptation de la licence fournie dans l'archive par le propriétaire, avec le pseudonyme **zenox-PR** explicitement choisi. Interdiction d'exploitation commerciale sans autorisation écrite conservée, périmètre limité aux droits effectivement détenus, conditions tiers exclues.
- `THIRD_PARTY_NOTICES.md` : provenance, droits distincts, dépendances et limites de compatibilité.
- `licenses/dependencies.json` : inventaire de 669 couples paquet/version installés ; aucune dépendance modifiée pour cette tâche.
- `licenses/dependencies/` : 16 fichiers de licence/avis conservés pour les dépendances directes et cas ambigus examinés.
- `licenses/MovixOpenSource-CC-BY-NC-4.0.txt` : licence non modifiée à la révision source utilisée pour les avatars.
- `docs/images/` : deux captures du véritable profil, sans données ou médias de tiers, avec méthode de reproduction.
- `scripts/capture-readme.cjs` : prise de vues avec SDK simulé et Firestore en mémoire, sans credentials cloud et avec images externes bloquées.

Les exemples de l'archive ont été traités comme des documents à adapter, pas comme des commandes à exécuter. Aucun fichier du ZIP n'a été extrait en dehors de ce dépôt. L'ancien README et le manifeste précédent sont conservés sous `.local-backups/`, exclu de Git.

## Fonctionnalités et technologies vérifiées

La description repose sur les pages, `server.cjs`, les modules `server/`, le modèle et les routes de catalogue, les profils et la synchronisation, la validation Vidmoly, `package.json`, `tsconfig.json` et les tests existants. Le frontend est en HTML/CSS/JS natifs ; le backend utilise le serveur HTTP Node natif et Firebase Admin. Aucune dépendance React, Next.js, Vue, Vite, Express pour le serveur principal ou Tailwind n'est annoncée. Des dépendances transitives des outils peuvent utiliser d'autres technologies sans constituer l'architecture de Hessflix.

Le README distingue le compteur d'activité sur le site d'un temps vidéo réel, le suivi déclaratif de la progression d'un lecteur tiers, les métadonnées TMDB des droits de diffusion et le mode strict ciblé d'une couverture de types de tout le serveur. La configuration Firebase fictive et la nécessité d'un projet personnel sont explicites. Aucune URL de dépôt GitHub, CI réussie, statistique d'audience ou disponibilité publique n'a été inventée.

## Résultats réellement exécutés pour cette modification

| Vérification | Résultat |
| --- | --- |
| Lecture de l'archive README/LICENCE fournie | Réalisée sans exécution de son contenu |
| Consultation du README de TerminalLearning | Réalisée, inspiration documentaire uniquement |
| TypeScript sur le périmètre configuré | Réussi |
| Tests serveur existants, dont sécurité et permissions | **127/127 réussis** |
| Tests de publication et plateformes | **6/6 réussis** |
| Génération et inspection visuelle des captures | Deux captures réelles, profil fictif, zéro erreur JavaScript, pas de débordement mobile détecté |
| Badges Shields.io | **5/5** réponses HTTP 200 contenant du SVG, sans badge d'erreur détecté |
| Audit des dépendances de production | Aucune vulnérabilité signalée au moment du contrôle |
| Audit complet des dépendances | Une alerte modérée transitive dans les outils de développement ; aucune élevée ou critique signalée |
| Inventaire des licences | 669 manifests installés ; textes des dépendances directes disponibles et des cas ambigus examinés |
| Liens locaux du README | 27 références vérifiées, aucune cible manquante |
| Garde de publication et index | Aucune alerte détectée ; aucun fichier ignoré suivi ; aucun historique ancien importé |
| Manifeste | 3 496 fichiers préparés, dont le manifeste ; 3 495 empreintes dans le manifeste |
| Tests des moteurs de règles Firebase | Non exécutés ici : Java 21 requis, Java 8 disponible |
| CI GitHub | Non exécutée ; aucun dépôt distant configuré |

Les 102 tests navigateur de la préparation précédente ne sont pas présentés comme une nouvelle exécution pour cette tâche documentaire. Le contrôle navigateur nouveau porte sur la génération des deux captures, l'affichage du profil fictif et sa largeur mobile. Les preuves brutes du contrôle courant restent sous `.local-backups/readme-license-20261028/`, exclu de la publication.

Le contrôle de sécurité a été relancé après mise à jour du manifeste et de l'index : `pnpm security:publication`. Ses résultats détaillés, les liens locaux du README et la cohérence du manifeste sont consignés dans les preuves privées. Le fichier `.gitattributes` conserve les notices tierces à l'identique, sans normalisation de leurs fins de ligne ou espaces d'origine. Un résultat sans alerte reste un contrôle heuristique du texte et des chemins, pas une garantie absolue.

## Licences : constats et limites

1. **Titularité.** La licence Hessflix ne peut porter que sur les droits effectivement détenus par zenox-PR. La provenance de chaque portion adaptée et les droits des contributeurs ne sont pas certifiés par une analyse de fichiers. Les exclusions sont explicites ; aucune déclaration de propriété globale sur les fichiers n'est faite.
2. **Code source MovixOpenSource.** Le fichier LICENSE à la révision `9a7e784c520caaa8cb6b57d20b203ae9849d807c` indique CC BY-NC 4.0. Les éléments concernés conservent cette licence ; les clauses Hessflix ne peuvent ni la remplacer, ni restreindre ses permissions. Une autorisation commerciale de zenox-PR ne suffit pas pour exploiter commercialement des éléments appartenant à ce tiers.
3. **Dépendances.** Les déclarations relevées sont principalement MIT, Apache-2.0, ISC et BSD. Les ambiguïtés valid-url/UNKNOWN et url-template/BSD ont été éclaircies par lecture de leurs LICENSE (MIT et BSD-3-Clause). Aucun paquet installé ne déclare une GPL/AGPL seule dans cet inventaire ; cela ne certifie pas la compatibilité de chaque sous-composant embarqué.
4. **Couverture.** 75 paquets n'ont pas de fichier de licence à leur racine dans l'installation analysée. Leurs déclarations ne remplacent pas les textes exigés en cas de redistribution de ces paquets. Les modules optionnels d'autres systèmes, les binaires, bibliothèques système, services distants et sous-composants ne sont pas tous inventoriés. `node_modules/` reste exclu du dépôt.
5. **Outil de licences.** `pnpm licenses list --json` a échoué sur un fichier d'index de cache manquant. Aucun succès de cette commande n'est revendiqué ; le relevé utilise les manifests et textes effectivement installés.
6. **Médias.** Les droits de certains avatars, affiches, logos et clips historiques ne sont pas établis par les crédits du dépôt source. Ils ne sont pas placés sous la licence Hessflix. Avant publication, confirmer leurs autorisations ou préparer une sélection redistribuable. Les captures ajoutées n'affichent pas ces médias.
7. **Contact.** Le pseudonyme du titulaire est fixé, mais aucun canal de contact commercial public n'a été fourni. La licence n'invente pas d'adresse ; définir un moyen de contact avant publication facilitera les demandes d'autorisation.
8. **Qualification.** La licence reste personnalisée et non commerciale, sans remplacement par MIT/GPL/Apache. La restriction commerciale empêche de la présenter comme une licence open source OSI. Une relecture juridique du périmètre et des droits avant publication reste recommandée ; cette revue technique n'est pas une validation juridique.

## Sources consultées

- [TerminalLearning, présentation de référence](https://github.com/thierryvm/TerminalLearning).
- [Licence du dépôt source à la révision documentée](https://raw.githubusercontent.com/movixstream/MovixOpenSource/9a7e784c520caaa8cb6b57d20b203ae9849d807c/LICENSE).
- [Résumé et texte de CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.fr).
- [Open Source Definition](https://opensource.org/osd), notamment l'absence de restriction par domaine d'activité.
- [Code de la propriété intellectuelle, droits d'exploitation du logiciel](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069414/LEGISCTA000006146349/2026-06-03/).
- [Droits sur les contenus et nécessité d'autorisations](https://www.economie.gouv.fr/apie/les-contenus-concernes-par-le-droit-dauteur).
- Documentation pnpm et Playwright via Context7 pour les commandes de licences et la capture d'écran.
