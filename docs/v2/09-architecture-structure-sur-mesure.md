# Architecture — Structure des gardes 100 % sur-mesure

> Statut : **conception** (2026-07-01). À valider par MiKL avant tout code moteur.
> Vision MiKL : personnalisation maximale + autonomie, assistée par l'IA. Un cabinet
> compose SES types de garde (n'importe quels jours, fenêtres horaires libres — y
> compris plusieurs gardes/jour matin+après-midi —, nb de vétos/rôles variables,
> relations entre types configurables). Aucune structure en dur.

---

## 0. Principe directeur (MiKL) — moteur universel + IA traductrice

L'IA est **toujours le garde-fou entre l'utilisateur et le moteur**. Le moteur possède
ses **configurations universelles** (ses fondamentaux) : un vocabulaire stable qu'il
comprend nativement. L'IA **adapte le langage** du cabinet pour que le moteur y
retrouve ses fondamentaux — **exactement le pattern déjà en place** pour les règles
(NL → brique du catalogue). On ne change donc PAS la nature du moteur : on **enrichit
l'expressivité de ses fondamentaux** pour couvrir la personnalisation de la structure,
et l'IA fait le pont. Le moteur ne « connaît » jamais un cabinet en particulier — il
consomme des primitives universelles ; le sur-mesure vit en donnée + traduction IA.

## 1. Le modèle cible

Un cabinet possède un **modèle de garde** = un **catalogue de types de garde** qu'il
compose lui-même. Chaque **type de garde** est une donnée :

```
TypeGardePerso {
  id            uuid
  cabinet_id
  nom           « Garde du matin », « Astreinte week-end »…
  jours         quels jours il s'applique (lun…dim, ou motif)
  heure_debut   fenêtre horaire — libre (matin 08→14, aprèm 14→20, nuit 20→08+1)
  heure_fin
  offset_jours_fin   0 = même jour, 1 = lendemain, 2 = surlendemain…
  places        [ { role, obligatoire } ]   ← N places, plus « 1er + 2nd » figé
  actif, ordre
}
```

Plus, pour remplacer R8/R9 (aujourd'hui en dur) :

```
RelationType {
  cabinet_id
  type_source_id → type_cible_id
  genre   'meme_binome' (ex R9) | 'inversion_role' (ex R8) | 'repos_apres' | …
}
```

**L'IA au centre** : le cabinet décrit son besoin en français → l'IA construit le
catalogue, **vérifie la cohérence** (jours qui se chevauchent, places impossibles…) et
**signale les trous**. C'est le « conseiller planning ».

**Principe de sécurité** (le filet) : chaque cabinet démarre avec un **catalogue par
défaut = les 4 types actuels** (semaine_soir lun-jeu, vendredi_soir, weekend sam-dim,
ferie). Tant que ce défaut est en place, le moteur produit **exactement** le planning
d'aujourd'hui → la suite de tests existante (84 plannings, 0 violation) reste le juge
de non-régression à CHAQUE étape.

---

## 2. Les 8 verrous et comment on les lève

| # | Verrou (aujourd'hui) | Résolution cible |
|---|---|---|
| 1 | Clé `(date, type)` unique + 2 rôles fusionnés (`AttributionGarde`, `gardes.UNIQUE`, `role IN (premier,second)`) | Un **slot** = `(date, type_id, place_index)`. N places par type. Le modèle interne devient une **liste de placements**, plus un objet à 2 rôles. Débloque plusieurs gardes/jour + N vétos. |
| 2 | Mapping jour→type unique `typeGardePourJour`, triplé (moteur, validateur, PDF) | Génération des slots **pilotée par la donnée** : pour une date, on liste les `TypeGardePerso` dont `jours` couvre ce jour. Le validateur garde sa **propre** dérivation depuis la même DONNÉE (indépendance des deux gardiens préservée). |
| 3 | Week-end atomique (samedi couvre ven+sam+dim ; `vendredi_soir` jamais persisté) | Le week-end devient un **type comme un autre** (offset configurable). Fin de la dérivation magique ven/dim. La vue SQL, le PDF et l'agenda deviennent **génériques** (une grille par type actif). |
| 4 | R8/R9 câblés sur 2 types nommés (5 couches) | Deviennent des **RelationType** entre `type_id`. Le moteur applique les relations génériquement ; `StructureConfig` figé disparaît. |
| 5 | Équité = 6 dimensions nommées en dur (struct + SQL + bonus_malus) | Équité **par type dynamique** : compteurs indexés par `type_id` (× place). Poids/importance par type, définis par le cabinet. |
| 6 | Effectif figé (WE=2, semaine 1-2, férié via semaine) | Chaque type porte **son propre nombre de places** → plus d'effectif en dur. |
| 7 | Réduction 4→3→2 types selon la couche (moteur/gardes V1/crise) | On **arrête d'écrire la table V1 `gardes`** ; tout passe par `attributions` V2 + le catalogue. Un seul modèle, plus de perte d'info. |
| 8 | Vocabulaire de config figé (`CODES_VALIDES`, `periodes:['soir_semaine','weekend']`) | Les formulaires de règles + le schéma IA référencent les **types du cabinet** (par id), chargés dynamiquement. |

---

## 3. Plan par phases (fondations d'abord, filet à chaque étape)

Invariant de sécurité à CHAQUE phase : **catalogue par défaut = comportement d'aujourd'hui**, prouvé par les tests existants.

- **P1 — Catalogue (donnée, sans effet moteur).** Table `types_garde` (+ `places`, `relations_type`) par cabinet. Seed de chaque cabinet avec les 4 types actuels. Les couches de config (structure-creneaux, chargers, écran A3) lisent le catalogue au lieu de l'enum — mais sémantique identique. *Zéro changement fonctionnel.*
- **P2 — Génération data-driven.** `typeGardePourJour`/`stepsForDay` (moteur) et `slotsAttendus` (validateur) dérivent les slots du catalogue. Défaut → slots identiques → tests verts.
- **P3 — N places / plusieurs gardes par jour.** Généraliser le modèle interne (liste de placements) + `attributions` (rôle → place) + persistance. Débloque matin/après-midi et N vétos.
- **P4 — Relations + équité génériques.** R8/R9 → `RelationType` ; compteurs d'équité par type_id. Le plus délicat (scoring). Sous TILT.
- **P5 — UI structure builder + IA assistante.** Écran de composition du catalogue ; l'IA compose/valide en langage naturel.
- **P6 — Généraliser l'aval.** Vue `planning_semaine`, PDF, agenda, libellés : pilotés par le catalogue. Retrait de la table V1 `gardes`.

**Ce qui est déjà fait s'y intègre** : les **horaires** (A1/A3) deviennent des champs de `TypeGardePerso` ; le **roulement** (fondation B) s'attache à chaque place de chaque type. Rien de jeté.

---

## 4. Ampleur — dit franchement

C'est une **re-architecture du cœur du domaine**, en plusieurs passes (plusieurs sessions).
Le risque est réel (fiabilité du moteur prouvée à préserver), d'où : fondations d'abord,
défaut = aujourd'hui, tests de non-régression à chaque phase, TILT sur le scoring (P4).

*Rédigé le 2026-07-01. Carte de couplage source : exploration « blast radius » (8 verrous).*
