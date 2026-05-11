# Product

## Register

product

## Users

Équipe de 7 vétérinaires d'un cabinet privé + 1 secrétaire.
Profil type : professionnels de santé animale, non-techniciens, peu à l'aise avec les interfaces complexes.
Anne-So est l'administratrice (la seule à générer et publier les plannings).
Les autres utilisateurs consultent leur planning et soumettent leurs souhaits de congés.
Contexte d'usage : rapide, souvent sur téléphone entre deux consultations. 80% de la consultation se fait sur mobile.
Objectif par session : voir ses gardes du mois ou soumettre/valider un congé — 2 actions max.

## Product Purpose

GuardVeto automatise la génération du planning des gardes vétérinaires sur des périodes de 12 à 17 semaines.
Il remplace un tableau Excel manuel source d'erreurs et de tensions.
Succès : Anne-So génère un planning équitable en 30 secondes, le publie, et chaque véto sait exactement quand il est de garde sans avoir à appeler.

## Brand Personality

Chaleureuse, fiable, universel.

Chaleureuse : l'app s'adresse à une équipe qui se connaît. Elle reconnaît les gens (couleurs personnalisées par véto, prénom partout, pas de matricule). Elle ne stresse pas.
Fiable : les règles sont respectées, les données sont justes, les gardes affichées sont celles qui comptent. Pas de surprise.
Universel : aussi lisible pour Anne-So à son bureau que pour Victor qui ouvre l'app sur son téléphone entre deux urgences. Pas de jargon, pas d'apprentissage.

## Anti-references

**A — Pas de look médical ou clinique.**
Pas de blanc aseptisé, pas de croix rouge, pas d'iconographie hospitalière. GuardVeto est un outil d'organisation d'équipe, pas un logiciel de santé. La chaleur prime sur la stérilité.

**D — Pas de look logiciel d'entreprise vieillissant.**
Pas de style SAP, vieux ERP, tableaux gris imbriqués, menus à 4 niveaux, typographie Arial sur fond beige. L'interface doit sembler contemporaine et légère, pas sortie d'un intranet des années 2010.

## Design Principles

1. **Clarté avant tout.** Le planning doit se comprendre en 2 secondes. Si quelqu'un doit chercher où il est de garde, c'est raté.
2. **Mobile d'abord, desktop ensuite.** Toute décision de layout ou de hiérarchie est prise en pensant à un écran de 375px d'abord.
3. **L'équipe est visible.** Chaque véto a une couleur. Les prénoms sont partout. L'app reconnaît les gens, elle ne les anonymise pas.
4. **Zéro apprentissage.** Si ça ressemble à quelque chose que l'utilisateur a déjà vu (agenda, liste, tableau), il sait s'en servir. Pas d'UX inventée pour le plaisir.
5. **Le feedback est immédiat.** Toute action (génération, publication, validation de congé) donne un retour visible en moins de 2 secondes. Pas de doute sur ce qui vient de se passer.

## Accessibility & Inclusion

- WCAG AA — contrastes texte/fond ≥ 4.5:1
- Cibles tactiles minimum 44×44px sur mobile
- `prefers-reduced-motion` respecté (pas d'animations forcées)
- Mode clair uniquement en V1 (l'usage est diurne, en cabinet éclairé)
- Labels associés à tous les champs de formulaire
- Focus visible sur tous les éléments interactifs
