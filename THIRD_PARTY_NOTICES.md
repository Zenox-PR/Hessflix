# Droits et composants tiers

La licence personnalisée de zenox-PR dans `LICENSE` concerne uniquement ses contributions originales et les droits qu'il détient. Elle ne remplace aucune licence tierce. Une permission commerciale accordée par zenox-PR ne peut pas lever les restrictions d'un autre auteur.

## Code et dépendances

L'[inventaire](licenses/dependencies.json) recense les 669 couples nom/version trouvés dans les paquets installés de cette copie le 28 octobre 2026. Il donne leurs déclarations de licence et la disponibilité d'un fichier de licence à la racine du paquet ; il ne contient ni chemins locaux ni identité du propriétaire de Hessflix.

| Composant direct | Version | Licence relevée |
| --- | --- | --- |
| firebase-admin | 14.5.0 | Apache-2.0 |
| firebase | 13.1.0 | Apache-2.0, déclarée dans les métadonnées du paquet |
| firebase-tools | 15.34.1 | MIT |
| @firebase/rules-unit-testing | 6.0.0 | Apache-2.0, déclarée dans les métadonnées du paquet |
| @playwright/test | 1.64.1 | Apache-2.0 |
| typescript | 7.0.2 | Apache-2.0 ; avis tiers additionnels présents |
| @types/node | 22.20.5 | MIT |

Les textes trouvés pour les dépendances directes et les licences ambiguës examinées sont conservés dans [licenses/dependencies/](licenses/dependencies/). Les déclarations `UNKNOWN` de `valid-url@1.0.9` et `BSD` de `url-template@2.0.8` ont été rapprochées de leurs fichiers LICENSE : respectivement texte MIT et BSD à trois clauses. L'inventaire conserve la déclaration d'origine et sépare cette lecture manuelle.

Les licences MIT, BSD, ISC ou Apache accordent leurs propres permissions, y compris commerciales sous leurs conditions : l'interdiction Hessflix ne s'étend pas à ces bibliothèques prises séparément. Les textes Python-2.0 d'argparse et la déclaration de domaine public de deep-freeze ont aussi été examinés. Aucun paquet de cet inventaire ne déclare une licence GPL/AGPL seule imposant d'emblée un conflit avec la licence Hessflix ; cette observation ne certifie pas l'absence d'éléments incorporés soumis à d'autres conditions.

`node_modules/` n'est pas distribué dans Git. Certaines archives installées n'ont pas de fichier LICENSE à leur racine malgré une déclaration de licence. Les composants optionnels non installés sur ce système, les binaires des navigateurs, les bibliothèques système, le contenu des services distants et chaque sous-composant embarqué ne sont pas couverts exhaustivement par ce relevé. Une redistribution de dépendances, de bundles ou de binaires doit conserver les textes et avis qui lui sont applicables, et nécessite une vérification adaptée à cette distribution.

La commande `pnpm licenses list --json` a échoué ici sur un index de cache manquant ; l'inventaire a donc été établi par lecture des manifests et fichiers de licence réellement installés, sans prétendre que la commande avait réussi. Les versions verrouillées restent dans `pnpm-lock.yaml`.

## MovixOpenSource

- Projet source : [movixstream/MovixOpenSource](https://github.com/movixstream/MovixOpenSource).
- Révision référencée pour la galerie d'avatars : `9a7e784c520caaa8cb6b57d20b203ae9849d807c`.
- Le fichier LICENSE de cette révision a été lu : **CC BY-NC 4.0**. Une copie non modifiée figure dans [licenses/MovixOpenSource-CC-BY-NC-4.0.txt](licenses/MovixOpenSource-CC-BY-NC-4.0.txt).
- [Texte officiel de CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode.fr).

Hessflix a utilisé ce projet comme référence de reconstruction, réutilise des avatars et référence d'autres visuels. La reconstruction, les nouveaux modules serveur, profils, catalogue et sécurité ont été adaptés ou développés pour Hessflix ; ce constat ne prouve pas que toutes les portions de l'interface sont des créations exclusives de zenox-PR. Les éléments repris ou adaptés de tiers conservent leurs obligations et ne sont pas présentés comme intégralement relicenciés sous `LICENSE`. Les modifications comprennent notamment la marque Hessflix, la structure HTML/CSS/JS de cette reconstruction et les nouveaux outils de catalogue, de profils et d'administration ; cette liste n'est pas un inventaire fichier par fichier des droits d'auteur.

CC BY-NC 4.0 demande notamment l'attribution, le lien vers la licence et l'indication des adaptations. Ses permissions ne peuvent pas être restreintes davantage par la licence Hessflix. Inversement, son interdiction commerciale ne disparaît pas si zenox-PR autorise séparément son propre code. L'auteur du dépôt source ne peut pas accorder les droits qu'il ne détient pas sur les personnages, films, marques ou médias référencés.

## Images, vidéos, marques et métadonnées

Les affiches, avatars de personnages, logos de plateformes et clips conservent les droits de leurs ayants droit. Leur présence dans un dépôt consultable, une attribution ou l'accès via une API ne constituent pas à eux seuls une autorisation de redistribution. Certains droits restent non établis : **les confirmer, obtenir une autorisation ou préparer une sélection de médias redistribuables avant toute publication**. Aucun média existant n'a été supprimé pour masquer cette limite.

Les sources déjà documentées sont conservées dans `assets/avatars/SOURCES.md`, `assets/platforms/SOURCES.md` et `assets/discovery/SOURCES.md`. Les captures ajoutées au README utilisent uniquement l'interface, le monogramme Hessflix, l'avatar neutre et des données fictives ; [leur provenance est documentée](docs/images/SOURCES.md).

TMDB conserve ses conditions d'API et ses exigences d'attribution. *This product uses the TMDB API but is not endorsed or certified by TMDB.* Les disponibilités sont fournies par JustWatch via TMDB ; les conditions de ces services s'ajoutent aux droits des œuvres et ne fournissent pas de vidéos. Vidmoly est un service tiers : seuls des liens autorisés peuvent être associés, sans transfert des droits sur les vidéos à Hessflix.

## Inspiration documentaire

Le README de [thierryvm/TerminalLearning](https://github.com/thierryvm/TerminalLearning) a servi de référence de présentation : introduction, fonctionnalités, technologies, installation et sécurité. Aucun de ses fichiers source, logo, capture, statistiques ou éléments d'identité n'a été incorporé. Le contenu du README Hessflix a été rédigé pour cette architecture.

## Portée de la revue

Ce relevé technique n'est pas une validation juridique de la titularité de tous les droits. L'originalité, les contrats de cession, les droits des contributeurs et l'articulation de portions adaptées nécessitent une vérification humaine. Ne pas publier sous l'étiquette « open source OSI » : la licence personnalisée interdit l'exploitation commerciale de ses contributions couvertes. Une relecture juridique du périmètre avant publication reste recommandée.
