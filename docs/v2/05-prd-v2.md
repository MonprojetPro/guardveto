# PRD V2 — GuardVeto

> **Auteurs :** OTTO (Product Manager MPP) — avec contributions REX, ARCH, PIXEL, CERBÈRE, NOVA
> **Date :** 2026-06-16
> **Statut :** VALIDÉ — décisions actées par MiKL le 2026-06-15
> **Document source (architecture détaillée) :** `docs/v2/02-rapport-strategie-consolide.md`
> **Catalogue de règles complet :** `docs/v2/03-catalogue-regles-blinde.md`
> **Compteurs produit :** `docs/v2/04-compteurs-produit.md`
> **Branche de développement :** `feat/ruflo-v4-migration` → `master`

---

## 1. Résumé exécutif

GuardVeto V1 est une application web qui génère automatiquement des plannings de gardes vétérinaires pour un cabinet. Elle fonctionne — le cabinet pilote l'utilise. Mais ses règles sont **codées en dur** dans le code TypeScript : changer une règle = appeler un développeur. Et elle ne gère qu'**un seul cabinet** à la fois.

La V2 est une refonte structurelle complète avec trois ambitions :

1. **Règles configurables** — les vétos et l'admin paramètrent eux-mêmes leurs contraintes via une interface visuelle, sans toucher au code.
2. **IA assistante** — une surcouche IA traduit les demandes en langage naturel ("je ne veux pas de garde le vendredi soir en période d'alternance") en règles structurées, et explique les résultats.
3. **SaaS multi-cabinet** — isolation stricte entre cabinets, self-service d'onboarding, modèle 79 €/cabinet/mois.

La V2 est livrée **d'un seul tenant**, quand elle est complète et solide. Pas de livraison étalée par palier. Les 2 bugs de production V1 (parité semaine ISO et cumul pénalités) sont corrigés en chantier séparé **avant** la bascule V2.

---

## 2. Contexte : de la V1 à la V2 (pourquoi refondre)

### Ce que fait la V1

La V1 génère automatiquement des plannings de gardes pour le cabinet pilote (7 vétos, règles fixes, mono-cabinet). Elle gère les congés, les indisponibilités, un moteur de backtracking TypeScript, l'export PDF et la synchronisation Google Agenda.

### Pourquoi la V1 ne suffit plus

**Limite n°1 — Règles soudées dans le code.** Chaque modification de règle (changer le seuil d'alternance d'Anne-So, ajouter une exception pour Pâques, désactiver une règle l'été) nécessite une intervention technique. Les vétos n'ont aucune autonomie.

**Limite n°2 — Mono-cabinet.** La V1 est construite autour du cabinet pilote. Le schéma de données, les créneaux (sem1, sem2, WE1, WE2, vendredi), les valeurs d'équité — tout est en dur pour ce contexte unique. Commercialiser à d'autres cabinets imposerait de tout réécrire.

**Limite n°3 — Moteur incomplet.** L'audit technique (ARCH, juin 2026) a révélé que le solver retourne la *première* solution faisable, sans chercher la meilleure. L'équité est calculée mais jamais intégrée à la recherche. Résultat : l'échelle de force des règles (dur / souple / idéal) n'a aucun effet garanti sur le résultat.

**Limite n°4 — Données en double.** Vacances scolaires et jours fériés existent en base Supabase mais le moteur les ignore et lit des listes hardcodées. La logique de scoring est dupliquée entre `scorer.ts` et `solver.ts` avec des formules divergentes.

**Limite n°5 — Vérité du planning incomplète.** L'attribution du vendredi soir n'est pas stockée : elle est recalculée indépendamment par la vue SQL, l'export PDF et la sync Agenda. C'est la cause racine du bug R8 (inversion vendredi↔WE), réparé couche par couche mais jamais à la source.

### Ce que la V2 résout de façon structurelle

Plutôt que de patcher les demandes du cabinet une par une, la V2 construit le **système sous-jacent** qui rend tout réglable. Les besoins du bilan cabinet (compteurs par type de garde, calcul auto des jours de repos, effectif configurable, règles d'alternance ajustables) sont exactement ce que la V2 résout nativement.

---

## 3. Problèmes que la V2 résout

| Problème V1 | Solution V2 |
|---|---|
| Règles en dur dans le code | Catalogue de briques configurables via interface (Palier 1) |
| Solver retourne la 1re solution faisable | Solver réécrit avec vraie optimisation lexicographique (F6) |
| Scoring dupliqué (`scorer.ts` ↔ `solver.ts`) | Source unique de scoring, unifiée en Fondations (F2) |
| Vérité du vendredi jetée à l'enregistrement | Persistance complète de tous les attributs du planning (F1) |
| Données en dur (vacances, fériés) | Lecture depuis les tables Supabase (F3) |
| 2 formats de contraintes concurrents | Normalisation du schéma de config (F4) |
| Mono-cabinet uniquement | Multi-cabinet avec isolation stricte par tenant (F5) |
| Compteurs divergents (3 définitions parallèles) | Registre unique (ledger) avec descripteurs déclaratifs |
| Pas de diagnostic d'impasse fiable | Diagnostic intelligent (Palier 2) |
| Langage naturel impossible | IA traductrice (Palier 3) |
| 2 bugs prod (parité ISO + cumul pénalités) | Corrigés en V1, intégrés correctement dans l'archi V2 (F7) |

---

## 4. Vision et ambition

> **La vision en une phrase :** un logiciel de planning de gardes où les vétérinaires *parlent* à l'application, elle traduit, le moteur calcule juste et de façon garantie, et elle explique.

**Le positionnement différenciant sur le marché FR :**
- Les concurrents proposent soit de l'IA boîte noire (RosterLab, Biosked, Momentum), soit de la conformité GTA lourde (Octime, Kelio, Chronos). Aucun ne propose un moteur de contraintes transparent et auditable, avec équité explicite et chiffres vérifiables.
- Le vrai avantage concurrentiel de GuardVeto n'est pas l'IA — c'est la **profondeur réglementaire FR** + la **réparation à perturbation minimale** (le planning ne se régénère pas de zéro à la moindre absence).

**Ambition commerciale :**
- Cabinet pilote : bêta gratuit sur V2.
- Cibles suivantes : cabinets vétérinaires FR (niche non adressée par les grands éditeurs).
- Tarif : 79 €/cabinet/mois, vétos illimités.
- Horizon de commercialisation : après livraison V2 complète.

---

## 5. Utilisateurs et rôles

### 5.1 Rôles au sein d'un cabinet

| Rôle | Droits et responsabilités |
|---|---|
| **Admin** | Configure les règles, les périodes, les effectifs. Arbitre les conflits. Valide les échanges de crise. Voit tout. Peut créer autant d'admins que voulu (droits identiques entre admins). |
| **Véto** | Consulte son planning. Saisit ses indisponibilités, souhaits, congés. Propose des règles personnelles (admin décide). Répond aux appels aux volontaires (crise). |

**Principe de gouvernance des règles :**
- Le véto **PROPOSE** (indispos, règles perso, suggestion de dureté).
- L'admin **ARBITRE et ANCRE** (tranche toujours, peut créer ses propres règles).
- L'IA **explique** les incohérences ou conflits, ne décide jamais.

### 5.2 Rôle super-admin MPP

| Rôle | Droits |
|---|---|
| **Super-admin MPP** (MiKL) | Console distincte. Voit tous les cabinets. Peut créer, suspendre ou réactiver un cabinet. Accès back-office pour onboarding manuel. Pas d'accès aux données métier des cabinets. |

### 5.3 Multi-cabinet — isolation stricte

Chaque cabinet est un **tenant** totalement isolé. Aucune donnée (règles, noms des vétos, carnet de remplaçants, plannings, compteurs) n'est partagée entre cabinets. Seul le **code des briques** est mutualisé.

---

## 6. Architecture V2 : Fondations + 3 Paliers

### 6.1 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────┐
│  PALIER 3 — Surcouche IA                                          │
│  • Traduire le langage naturel en règle structurée               │
│  • Enquêteur : préciser les règles floues                        │
│  • Chatbot support (questions d'usage de l'app)                  │
│  • Aiguilleur : détecter les cas hors-grammaire → escalade MPP   │
├──────────────────────────────────────────────────────────────────┤
│  PALIER 2 — Diagnostic intelligent                                │
│  • "Pas de planning possible parce que règle X ↔ règle Y"       │
│  • Suggestions d'assouplissement                                 │
│  • Visualisation des conflits de règles                          │
├──────────────────────────────────────────────────────────────────┤
│  PALIER 1 — Règles configurables + écran visuel                   │
│  • Catalogue de briques via interface (toggle, curseurs, QUI)    │
│  • Référentiel de créneaux par cabinet                           │
│  • Compteurs et équité configurables                             │
│  • Système de crise (absences imprévues)                         │
│  • Repos et congés comme contrainte active du moteur             │
├══════════════════════════════════════════════════════════════════┤
│  FONDATIONS — Non négociable, en premier (F1 à F8)               │
│  F1 : Persister la vérité complète du moteur                     │
│  F2 : Unifier le scoring (solver ↔ scorer)                       │
│  F3 : Lire les données depuis la base (vacances, fériés)         │
│  F4 : Normaliser le format des contraintes par véto              │
│  F5 : Multi-cabinet (isolation tenant + colonne groupement)      │
│  F6 : Réécrire le solver (vraie optimisation lexicographique)    │
│  F7 : Intégrer les corrections des 2 bugs prod V1               │
│  F8 : Schéma versionné + trace par planning                      │
└──────────────────────────────────────────────────────────────────┘
```

**Règle d'or : on monte dans l'ordre.** Pas de Palier 1 sans Fondations. Pas d'IA (Palier 3) sans règles devenues des données propres (Paliers 1-2).

### 6.2 Fondations (F1–F8) — Non négociable, en premier

#### F1 — Persister la vérité complète du moteur

**Problème actuel :** l'attribution du vendredi soir (rôle premier / second) est calculée par le moteur mais jetée à l'enregistrement. Trois couches la recalculent indépendamment (vue SQL, PDF, Agenda) → source du bug R8.

**Solution :** un seul enregistrement persisté contient TOUS les attributs d'un créneau attribué : type de créneau, rôle (1er/2nd), véto assigné, date réelle (début + fin), type de présence (sur place / astreinte), références aux règles qui l'ont produit.

#### F2 — Unifier le scoring

**Problème actuel :** la logique d'équité est dupliquée entre `scorer.ts` et `solver.ts` avec des formules différentes. De plus, `scoreEquite` n'est jamais appelé par le solver.

**Solution :** une source unique de scoring, utilisée à la fois par le solver (pendant la recherche) et par les compteurs (pour l'affichage). Le solver intègre réellement le score d'équité dans sa recherche.

#### F3 — Lire les données depuis la base

**Problème actuel :** vacances scolaires et jours fériés existent en tables Supabase, mais le moteur lit des listes en dur dans le code TypeScript (à mettre à jour manuellement chaque année).

**Solution :** le moteur lit toutes ses données depuis la base. Vacances scolaires (par zone), jours fériés (par région), créneaux par cabinet — tout en base, tout configurable.

#### F4 — Normaliser le schéma de config des contraintes

**Problème actuel :** les contraintes individuelles par véto acceptent deux formats concurrents dans le schéma.

**Solution :** format unique, normalisé, aligné sur la grammaire v2 (tuple à 6 axes).

#### F5 — Multi-cabinet (isolation stricte)

**Problème actuel :** le schéma de données est mono-tenant. Aucune isolation entre cabinets.

**Solution :**
- Colonne `cabinet_id` (tenant_id) sur toutes les tables de données métier.
- RLS (Row Level Security) Supabase configurée pour que chaque utilisateur ne voie que les données de son cabinet.
- Colonne `groupement_id` ajoutée mais vide (porte ouverte pour la mutualisation inter-cabinets en V3, sans la coder maintenant).
- Champ `type_presence` (sur place / astreinte) sur chaque créneau — valeur par défaut : sur place.

#### F6 — Réécrire le solver

**Problème actuel :** le solver retourne la première solution faisable, sans optimiser. L'équité n'est jamais minimisée.

**Solution :** solver réécrit avec vraie optimisation par **score lexicographique** (voir §7.1). Même entrée = même résultat (tie-break déterministe). Signal visuel ⚠️ sur le planning brouillon si conflit non résolu.

**Corriger aussi :** le diagnostic d'impasse actuel est défectueux (il évalue contre un planning vide au lieu du contexte réel). Le diagnostic doit évaluer la faisabilité dans le contexte réel du planning en construction.

#### F7 — Intégrer les corrections des 2 bugs prod V1

Les 2 bugs sont corrigés en V1 avant la bascule V2. L'architecture V2 doit les intégrer nativement :
- **Parité ISO semaine 53 :** remplacer la parité pair/impair par une "ancre mobile" (1 semaine sur 2 depuis une date de référence, recalée à chaque vacances scolaires).
- **Cumul de pénalités :** le score lexicographique (F6) remplace l'additif, ce qui élimine structurellement la possibilité que deux règles "moyennes" franchissent le seuil d'une règle "forte".

#### F8 — Schéma versionné + trace par planning

**Besoin :** chaque planning publié doit conserver la photo exacte des règles qui l'ont produit (règles actives, leurs paramètres, leur version). Si une règle change le lendemain, les plannings passés restent rejouables et compréhensibles.

**Solution :** snapshot des règles actives au moment de la génération, lié au planning. Version incrémentale sur chaque règle. Les règles ne sont pas rétro-appliquées : elles ont une date d'effet.

---

### 6.3 Palier 1 — Règles configurables + écran visuel

Les règles ne sont plus du code : elles sont des données en base. L'admin configure son cabinet via une interface visuelle. Le moteur lit ces données à chaque génération.

**Ce que le Palier 1 livre :**
- Catalogue de briques (voir §7.2) via interface : toggle dur/mou, sélecteurs QUI/QUAND/QUOI, curseurs de force.
- Référentiel de créneaux par cabinet (plus de créneaux figés en code).
- Compteurs et équité configurables par cabinet (plus de valeurs pilote en dur).
- Système de crise complet (§7.4).
- Repos et congés comme contrainte active du moteur (§7.5).
- Configurations de période entièrement personnalisables (§7.7).

---

### 6.4 Palier 2 — Diagnostic intelligent

Quand le moteur ne trouve pas de planning faisable, il explique **pourquoi** : quelles règles se contredisent, quel créneau est bloquant. L'admin peut ajuster ses règles depuis le diagnostic.

**Ce que le Palier 2 livre :**
- Rapport d'impasse : "Impossible de couvrir le créneau WE2 du 14 mars car : contrainte A interdit Manon, contrainte B interdit Antoine, pas d'autre véto dispo."
- Suggestions d'assouplissement : "Si vous passez la règle R7 de 🟠 Sauf crise à 🟡 Évitée au max, le planning devient faisable."
- Visualisation des conflits entre règles de même portée (signal ⚠️).

---

### 6.5 Palier 3 — IA assistante

L'IA intervient au moment de **définir** et **expliquer** — jamais au moment de générer. Le moteur reste seul juge. Voir §7.8 pour le détail des 4 casquettes.

---

## 7. Fonctionnalités détaillées

### 7.1 Moteur de génération (refonte)

#### Score lexicographique

Le score additif actuel a un défaut fondamental : deux règles "moyennes" peuvent ensemble franchir le seuil d'une règle "forte" et la dominer. Ce n'est pas le comportement voulu.

Le score **lexicographique** fonctionne par **étages** (comme une priorité de tri multi-critères) :

```
Étage 1 (le plus fort) : règles 🔴 JAMAIS — une violation ici = rejet immédiat
Étage 2 : règles 🟠 SAUF CRISE — violations comptées séparément
Étage 3 : règles 🟡 ÉVITÉE AU MAX — minimisées en troisième
Étage 4 : règles ⚪ SI POSSIBLE — optimisées en dernier
Étage 5 : équité (variance des charges) — tie-breaker final
```

Le solver compare deux solutions en commençant par l'étage 1. Si les deux ont le même nombre de violations au niveau 1, on regarde le niveau 2, et ainsi de suite. Deux règles "moyennes" ne peuvent jamais écraser une règle "forte" — les étages sont hermétiques.

**Tie-break déterministe :** à score lexicographique identique, le solver choisit selon un ordre stable et reproductible. Même entrée = même résultat.

#### 4 niveaux de force (3 exposés, 1 interne)

| Niveau | Symbole | Nom | Comportement |
|---|---|---|---|
| 1 | 🔴 | JAMAIS | Rejet immédiat. Aucune exception possible (sauf MODE MANUEL admin). |
| 2 | 🟠 | SAUF CRISE | Respecté normalement. Mode AUTO crise peut assouplir. |
| 3 | 🟡 | ÉVITÉE AU MAX | Le moteur cherche à éviter, sans garantie absolue. |
| 4 | ⚪ | SI POSSIBLE | Souhaitable, ignoré si nécessaire. |

Par défaut, l'interface expose 3 niveaux (🔴 / 🟡 / ⚪). Le 🟠 est disponible pour les règles qui le nécessitent.

**Marqueur "dernier recours" :** ce n'est pas un 5e niveau de force. C'est un **marqueur lexicographique** qui dit au moteur "utiliser cette personne uniquement si aucune autre solution n'existe". Une accumulation de petites pénalités ne peut pas désigner quelqu'un portant ce marqueur si une autre solution existe — les étages l'empêchent.

#### Règles CCN et réglementaires

Une famille de règles "réglementaires" est livrée pré-assemblée (repos de sécurité 11h entre services, plafonds CCN). Ces règles sont **dures par défaut** et **désactivées par défaut** (ON/OFF). L'admin peut les activer ; une alerte s'affiche si il les assouplit.

**Honnêteté sur les limites :** les règles "11h de repos entre services" et "48h/semaine" nécessitent le planning de *jour* que GuardVeto V2 ne gère pas (il gère des créneaux de garde, pas les heures de consultation). Ces règles sont déclarées hors-périmètre et l'interface l'indique clairement.

---

### 7.2 Système de règles (catalogue de briques)

#### La grammaire v2 — tuple à 6 axes

Chaque règle est une phrase à trous :

```
[QUI] doit/ne doit pas [QUOI créneau + rôle] [QUAND]
avec l'opérateur [OPÉRATEUR] à la force [FORCE]
valable [VALIDITÉ]
```

| Axe | Options |
|---|---|
| **QUI** | Individu / paire-duo / rôle (véto/ASV/interne) / compétence (canine/équine) / marqueur "externe planifiable" |
| **QUAND** | Créneau, type de semaine, période, saison, condition calendaire. Composable avec **SAUF** et **OU**. |
| **QUOI** | Référentiel de créneaux du cabinet (configurable) + rôle (1er/2nd/couverture) |
| **OPÉRATEUR** | Voir tableau ci-dessous |
| **FORCE** | 🔴 / 🟠 / 🟡 / ⚪ |
| **VALIDITÉ** | Permanente / par saison / par période N / à partir d'une date d'effet. Non rétro-ajoutable. |

#### Familles d'opérateurs

| Famille | Opérateur | Ce qu'il exprime | Exemple |
|---|---|---|---|
| **Interdire** | JAMAIS | Absence absolue | "Manon ne fait jamais le vendredi" |
| **Forcer** | IMPOSER | Attribution obligatoire | "Antoine et Fanny ensemble le 25 décembre" |
| **Forcer (groupe)** | ENSEMBLE-REQUIS | Les membres du QUI ensemble ou aucun | "Junior + Senior : toujours ensemble ou aucun des deux" |
| **Forcer (quota bas)** | AU-MOINS-N | Plancher de présence | "Au moins 1 senior par garde de WE" |
| **Forcer (couverture)** | COUVERTURE | Profil requis sur le créneau | "Au moins 1 véto interne ET habilité équine" |
| **Limiter** | AU-PLUS-N + FENÊTRE | Plafond sur une fenêtre | "Max 2 nuits par semaine civile" (FENÊTRE obligatoire) |
| **Équilibrer** | ÉQUILIBRER | Équité entre membres du QUI | Famille à part, chaque dimension avec sa propre force + quotes-parts |

**Composition :**
- `SAUF` : négation d'une condition QUAND ("mercredi SAUF vacances")
- `OU` : union dans le QUAND ("vendredi OU samedi")
- Pas de SI…ALORS générique (crée des cycles de dépendance). À la place : motifs pré-câblés fermés ("si garde le WE cette semaine" est un fait atomique pré-calculé), récursion bornée à 1 niveau.

#### 3 statuts de règles structurelles

**① Invariants figés (non configurables)**
Ces règles ne sont pas exposées dans l'interface. Elles sont toujours actives.
- "Un véto en congé ne peut pas être de garde"
- "Le 1er de garde ≠ le 2nd de garde"

**② Référentiel par cabinet VERSIONNÉ par période**
Configurable, mais pas figé à l'onboarding — peut évoluer période par période.
- Effectifs (nb de vétos actifs, leur quota-part)
- Dates de saison (début/fin été, hiver)
- Longueur des périodes de rotation
- Catalogue de créneaux du cabinet (quels créneaux, horaires, effectif par créneau)
- Zone scolaire et région des jours fériés
- Liste des vétos actifs sur la période

**③ Conventions locales (on/off avec exceptions possibles)**
Activées/désactivées par l'admin. Peuvent avoir des exceptions via `SAUF`.
- Liaison vendredi soir ↔ week-end (le véto de garde vendredi soir fait aussi le WE)
- Inversion 1er/2nd entre vendredi et WE
- Exception possible : "SAUF la semaine de Pâques"

#### Couverture de la grammaire

| Test | Résultat |
|---|---|
| Golden test : 11 règles réelles du cabinet pilote | **11/11** exprimables |
| Test adversarial : 24 demandes réalistes de vétos | **83 % traitable** (14 exact + 6 via brique catalogue) |
| 4 cas hors-périmètre déclarés honnêtement | Nécessitent le planning de jour (non couvert en V2) |

---

### 7.3 Interface de configuration des règles

#### Écran "Règles du cabinet"

L'admin gère les règles depuis un écran dédié :

```
┌─────────────────────────────────────────────────────────────┐
│  Règles du cabinet                          [+ Nouvelle règle] │
├─────────────────────────────────────────────────────────────┤
│  ACTIVES                                                     │
│  ├── 🔴 Fanny — Pas de garde vendredi SAUF vacances         │
│  ├── 🟡 Antoine — Max 2 week-ends par période               │
│  ├── 🔴 Anne-So — Alternance WE pairs (ancre : 15/09/2025)  │
│  └── ⚪ Manon — Préfère les samedis matin                   │
│                                                             │
│  RÉGLEMENTAIRES (pré-assemblées)                            │
│  ├── 🔴 Repos de sécurité CCN [OFF — Activer]               │
│  └── 🟡 Plafond 48h/semaine [OFF — Non disponible*]         │
│      * Nécessite le planning de jour                        │
└─────────────────────────────────────────────────────────────┘
```

#### Formulaire guidé de création de règle

Formulaire pas-à-pas avec sélecteurs pour chaque axe :

1. **QUI ?** — Sélecteur véto / groupe / rôle / compétence
2. **QUOI ?** — Sélecteur de créneau depuis le référentiel du cabinet
3. **QUAND ?** — Sélecteur de période/condition + composition SAUF/OU
4. **OPÉRATEUR** — Sélecteur illustré avec exemple
5. **FORCE** — Curseur 🔴 / 🟡 / ⚪ avec explication de ce que ça veut dire
6. **VALIDITÉ** — Permanente / à partir de / pour la période N

L'IA (Palier 3) peut pré-remplir ce formulaire depuis une saisie en langage naturel.

#### Gestion des conflits

Quand deux règles de même niveau se contredisent :
- Signal ⚠️ visible sur les règles concernées
- L'IA (Palier 3) explique la nature du conflit
- L'admin peut ajuster manuellement la force d'une des deux

Le tie-break interne reste déterministe (ordre stable) même sans intervention de l'admin.

---

### 7.4 Gestion de crise (absences imprévues)

#### Principe général

Le système de crise gère les situations où un véto devient indisponible **après que le planning est publié**. L'objectif est de **perturber le moins possible** le planning existant (pas de régénération complète) et de trouver une solution en un minimum d'étapes.

#### 4 types d'absences

| Type | Durée typique | Déclencheur |
|---|---|---|
| **Courte** | 1 journée | Maladie soudaine, empêchement ponctuel |
| **Longue** | Plusieurs semaines | Arrêt de travail, accident |
| **Immédiate** | Ce soir / dans les heures | Besoin de couverture en urgence |
| **Anticipée** | Dans 15 jours et plus | Opération programmée, congé tardif |

#### 3 voies de résolution

```
Absence signalée
      │
      ▼
[Mode AUTO] ──────────────── Réparation à perturbation minimale
      │                       Respecte les 🔴 JAMAIS
      │                       Peut assouplir 🟠 / 🟡 / ⚪
      │                       Produit un rapport des règles pliées
      ▼
[Appel aux volontaires] ──── Notification aux vétos disponibles
      │                       Délai de réponse défini par l'admin
      │                       Historique du volontariat journalisé
      │                       (qui a répondu, quand, pour quoi)
      ▼
[Remplaçant externe] ──────── Depuis le carnet de remplaçants
                              Marqué comme "externe" dans le planning
                              Suivi en compteurs INFO (non intégré à l'équité)
                              Ignoré par le moteur d'équilibrage interne
```

**Si aucune voie ne fonctionne :** trou affiché en rouge dans le planning. L'honnêteté prime sur l'affectation forcée fausse.

#### Mode AUTO

Le Mode AUTO respecte impérativement les règles 🔴 JAMAIS. Il peut assouplir les niveaux inférieurs (🟠 / 🟡 / ⚪) pour trouver une solution. À la fin, il produit un rapport : "J'ai plié les règles suivantes : [liste]. L'admin peut valider ou choisir une autre option."

#### Mode MANUEL admin

L'admin a tous les droits en mode manuel. Il peut forcer n'importe quelle attribution, y compris en violant des règles 🔴. Mais :
- Une alerte s'affiche pour chaque règle violée et son niveau.
- Chaque override est journalisé (qui/quand/pourquoi).

#### Compensation entre vétos

Quand un véto prend la garde d'un autre :
- Le remplaçant acquiert une **créance** (il a donné une garde).
- Le remplacé acquiert une **dette** (il en doit une).
- Ces créances/dettes sont stockées dans le **registre unique** (ledger).
- Le remplaçant propose sa compensation : moins de gardes prochainement / règlement en argent / annulation de dette / arrangement custom / recours à un remplaçant externe.
- L'admin valide. Des allers-retours sont possibles jusqu'à accord.
- Une fois validé, c'est officiel et tracé.

**Gardes manquées par maladie :** neutres dans les compteurs. Pas de pénalité.

**Retour anticipé d'un véto absent :** ne défait PAS les réparations publiées. Ce qui est publié est un contrat.

#### Carnet de remplaçants

Chaque cabinet gère son propre carnet de remplaçants externes. Ces remplaçants :
- Sont marqués distinctement dans le planning et les exports
- Leurs gardes sont comptées en statistique INFO (transparence pour l'admin)
- Ne sont jamais intégrés dans les calculs d'équité interne
- Ne sont pas gérés par le moteur d'équilibrage

---

### 7.5 Repos et congés

#### Principe

Le repos et les congés sont intégrés au moteur V2 comme une **contrainte active**, pas une note en marge. Un véto en repos ne peut pas être affecté à une garde — le moteur le sait et l'intègre dans la recherche.

#### Congés payés

- Cycle configurable par cabinet (exemple pilote : 1er octobre → 30 septembre)
- Dotation configurable par véto (associés vs salariés peuvent avoir des dotations différentes)
- Unité de décompte configurable : jours, semaines, demi-journées
- Mode de comptage configurable : ouvré / ouvrable / calendaire
- Solde visible en temps réel dans les compteurs
- Les congés posés sont intégrés dans les contraintes du moteur (pas d'affectation de garde pendant les congés)

#### Repos

Le moteur gère les repos comme une contrainte d'indisponibilité. Voir aussi les règles de séquence (§7.2) pour les repos conditionnels (ex. "repos le lendemain d'une garde de nuit").

#### Compteur négatif

Le compteur peut passer en négatif (dette) si un véto a posé plus de congés que sa dotation. Ce cas est déclaré et affiché explicitement.

---

### 7.6 Compteurs et équité

#### Principe : un registre unique (ledger)

Toute la vérité des compteurs vient d'une seule source : le **registre (ledger)**. Pas de triple calcul divergent comme en V1.

Un compteur est une **définition déclarative** appliquée au ledger, pas un chiffre stocké. Changer la définition d'un compteur recalcule automatiquement tous les chiffres depuis la source.

#### Anatomie d'un compteur (9 propriétés)

| Propriété | Ce qu'elle définit |
|---|---|
| **Source** | planning (dérivé) / ledger (persisté) / import (amorçage) / référentiel (config) |
| **Filtre** | quel événement compter (ex: `type == weekend && rôle == premier`) |
| **Unité + sens** | garde / jour / WE / heure / euro ; et "plus = mieux / pire / neutre / cible" |
| **Dimension(s)** | par véto / par véto × type de créneau / par cabinet |
| **Fenêtre** | période / saison / année-cycle (ancre) / glissante N jours / permanente |
| **Agrégation** | somme / moyenne / variance / écart max-min / comptage |
| **Cible + pondération** | quote-part égale / quota fixe / pondéré par temps de travail (mi-temps 60 %) |
| **Seuils d'alerte** | ok / attention / critique |
| **Report inter-période** | aucun (charge) / solde cumulé (dette qui voyage) / remise à zéro |

#### Types de compteurs prédéfinis

| Type | Exemple | Clé de config |
|---|---|---|
| CHARGE | Nb de week-ends | Filtre + agrégation somme |
| CHARGE croisée | Nb de gardes par type | Dimension [véto × type] |
| ÉQUITÉ | Déséquilibre des WE | Agrégation variance, `est_dimension_optimisation = true` |
| SOLDE/DETTE | Bonus-malus, créance de crise | Source ledger, report solde_cumulé |
| DROITS | Solde congés payés | Source ledger + référentiel, fenêtre année-cycle |
| FINANCIER | Nb de fois 1er le WE (R11b) | Filtre `rôle==premier && type==weekend` |
| CONFORMITÉ | Repos de sécurité respecté | Unité booléen, agrégation comptage(violations) |

**Note sur CHARGE et ÉQUITÉ :** ce ne sont pas deux objets distincts. L'équité *pointe vers* la charge (`base = we_total, agrégation = variance`). Une seule définition de "ce qu'est un week-end de garde", deux lectures.

#### Équité et compteurs liés à la période

- Les compteurs sont liés à la période, pas globaux.
- Un véto absent d'une période n'a pas de "dette" sur cette période.
- Option "Reprendre dernier compteur" (case à cocher par véto ajouté en cours de période).
- Le registre d'équité et les dettes/créances de crise utilisent la même source unifiée (ledger) dès les Fondations.

#### Compteurs : catalogue + visibilité (flux strictement descendant)

Le modèle est **descendant** — l'admin maîtrise tout, le véto consulte seulement (décision MiKL 2026-06-16). On ne se calque pas sur les seuls besoins du cabinet pilote : les autres cabinets voudront d'autres colonnes.

1. **Catalogue large de colonnes.** Une liste étendue d'indicateurs possibles existe (charge par type, charge vs moyenne, dettes/crédits, rang/équité, historique Noël/fêtes, etc.). Chaque cabinet y pioche.
2. **L'admin compose SON tableau.** Il sélectionne, dans le catalogue, les colonnes qu'il veut voir dans son propre compteur admin.
3. **L'admin ouvre aux vétos.** Case par case, il décide quelles colonnes chaque véto voit dans son espace.
4. **Le véto consulte seulement.** Il ne choisit pas ses colonnes et n'en réclame aucune. **Aucun flux remontant.**

| Exemple de colonne | Dans le catalogue | Choix admin (son tableau) | Ouverture véto |
|---|:--:|:--:|:--:|
| Charge (nb gardes par type) | ✅ | au choix | au choix |
| Charge vs moyenne cabinet | ✅ | au choix | au choix |
| Dettes / crédits | ✅ | au choix | au choix |
| Rang / équité | ✅ | au choix | au choix |
| Historique (Noël, fêtes…) | ✅ | au choix | au choix |

---

### 7.7 Multi-cabinet (isolation + onboarding)

#### Isolation des données

```
Cabinet A                    Cabinet B
┌──────────────────┐         ┌──────────────────┐
│ Vétérinaires     │         │ Vétérinaires     │
│ Règles           │  ╳ Pas  │ Règles           │
│ Plannings        │ de lien │ Plannings        │
│ Carnet rempla.   │         │ Carnet rempla.   │
│ Compteurs        │         │ Compteurs        │
└──────────────────┘         └──────────────────┘
         │                            │
         └────────────┬───────────────┘
                      │
              Code des briques
              (partagé entre cabinets)
```

Techniquement : `cabinet_id` sur toutes les tables + RLS Supabase. Un utilisateur ne voit physiquement pas les données d'un autre cabinet.

#### Configurations de période par cabinet

Entièrement personnalisables par l'admin :

| Paramètre | Ce que le cabinet configure |
|---|---|
| Vétos actifs | Liste à cocher par période |
| Effectif par garde | Nb de postes par type de créneau (variable dans une même période) |
| Durée de rotation | Toutes les N semaines |
| Quote-parts | Par véto (mi-temps = 50 %, associé = 100 %, etc.) |
| Option reprise compteur | Case par véto ajouté à une période |

#### Référentiel de créneaux par cabinet

Chaque cabinet définit son propre catalogue de créneaux (plus de créneaux figés dans le code) :
- Nom du créneau (ex: "Samedi nuit", "Week-end principal")
- Horaires (début → fin réels, avec chevauchement sur le lendemain)
- Type de présence (sur place / astreinte)
- Effectif par créneau (combien de postes à pourvoir)

**Chaque créneau expose son intervalle réel.** Un "week-end" daté samedi couvre samedi 8h→lundi 8h. Indispensable pour les règles "la veille de" / "le lendemain de" et pour détecter les chevauchements avec les congés.

#### Deux portes d'onboarding

| Porte | Qui l'utilise | Disponibilité |
|---|---|---|
| **Back-office MPP** | MiKL enrôle un cabinet manuellement | Actif dès le lancement V2 |
| **Self-service** | Cabinet s'inscrit lui-même | Interrupteur ON/OFF (peut rester OFF au lancement) |

**Au lancement V2 :** self-service peut rester fermé, back-office MPP actif. L'interrupteur s'active quand MiKL décide d'ouvrir l'onboarding autonome.

**Amorçage des compteurs d'un nouveau cabinet :** pas d'import de fichier en V2. L'admin **saisit manuellement** les compteurs de départ dans un écran dédié, dans **les colonnes de son choix** (puisées dans le catalogue), avec une **date pivot** (à partir de quand l'historique compte). Sert à amorcer les compteurs / l'équité, pas à extraire des règles. *(Un import CSV agrégé pourra être ajouté plus tard pour les gros cabinets — hors V2.)*

#### Console super-admin MPP

Interface distincte, accessible uniquement à MiKL :
- Liste de tous les cabinets (nom, nb de vétos, date d'onboarding, statut)
- Créer / suspendre / réactiver un cabinet
- Voir les métriques globales (nb de plannings générés, taux d'erreur, etc.)
- Pas d'accès aux données métier des cabinets (isolation stricte)

---

### 7.8 IA assistante (4 casquettes)

**Principe fondamental :** l'IA intervient au moment de **définir** et d'**expliquer/assister**. Elle ne calcule jamais le planning. Le moteur déterministe reste seul juge.

Le formulaire guidé (§7.3) est le **socle**. L'IA est une **surcouche**. Si l'IA est indisponible, le formulaire continue de fonctionner seul.

#### Casquette 1 — Traducteur de règles

L'utilisateur saisit une demande en langage naturel. L'IA la fait correspondre à des briques existantes et pré-remplit le formulaire guidé.

**Exemple :**
> "Je ne veux pas de garde le vendredi si j'ai un week-end la semaine d'avant"

L'IA reconnaît le motif pré-câblé "garde WE semaine précédente" + l'opérateur AU-PLUS-N sur une fenêtre glissante, et propose un formulaire pré-rempli que l'admin valide.

**Modèle utilisé :** petit modèle (Haiku). Cache de prompt natif pour les traductions répétitives. La validation d'une règle traduite est déterministe (vérification de la syntaxe de la brique), jamais par l'IA elle-même.

#### Casquette 2 — Enquêteur de règles floues

Quand une demande est imprécise, l'IA pose des questions de dégrossissage selon un escalier à 4 marches :

```
① Y a-t-il des briques existantes qui correspondent exactement ?
   → Si oui, proposer directement
   ↓ Si non :
② Reformuler + poser la bonne question pour préciser
   → "Vous voulez dire : jamais le vendredi, ou préférablement pas ?"
   ↓ Si toujours flou :
③ Proposer la saisie manuelle + les briques les plus proches
   → "Je ne suis pas certain — voici les 3 options qui s'en approchent"
   ↓ Si vraiment hors-périmètre :
④ Vraie exception → escalade structurée vers Hub MPP
   → "Cette règle n'existe pas encore — je la note pour une future mise à jour"
```

L'escalade vers le Hub MPP (④) est tracée et journalisée.

#### Casquette 3 — Aiguilleur

L'IA détecte si une demande est **hors-briques** (impossible à exprimer avec la grammaire actuelle) et déclenche une escalade structurée vers le Hub MPP.

Ce n'est pas un échec — c'est un signal produit. Les demandes hors-briques récurrentes alimentent le backlog des nouvelles briques à développer.

#### Casquette 4 — Assistant support (chatbot)

L'IA répond aux questions d'usage de l'application :
- "Comment est-ce que je configure une règle d'alternance ?"
- "Où je vois les congés restants de Manon ?"
- "Pourquoi est-ce qu'Antoine a 3 week-ends ce mois-ci ?"

**Technique :** recherche ciblée dans la documentation de l'app. Petit modèle (Haiku).

#### Ce que l'IA ne fait JAMAIS

- ❌ Calculer ou optimiser un planning
- ❌ Choisir quelle règle est "meilleure" qu'une autre
- ❌ Modifier des règles sans validation humaine
- ❌ Valider une règle traduite (la validation est déterministe, côté code)
- ❌ Écrire du code exécuté en base (toute nouvelle brique = PR Git + review)

---

### 7.9 Exports et synchronisation

| Export | V1 | V2 |
|---|---|---|
| PDF | ✅ | ✅ (maintenu) |
| CSV | ❌ | ✅ (nouveau) |
| Google Agenda (cabinet) | ✅ | ✅ (maintenu, fiabilisé avec F1) |
| iCal personnel (par véto) | ❌ | Backlog |

**Note sur la sync Agenda :** avec F1 (vérité complète du moteur persistée), la sync Agenda lira directement les données en base au lieu de les recalculer. Le bug de désynchronisation R8 (inversion vendredi↔WE) sera éliminé structurellement.

---

### 7.10 Notifications

| Notification | V2 |
|---|---|
| Mail de changement de planning (aux vétos concernés) | ✅ |
| Mail d'appel aux volontaires (système de crise) | ✅ |
| Rappel de génération (avant date limite) | ✅ (repris de V1) |
| Rappels avant garde (J-1, J-7) | Reportés (hors V2) |

---

## 8. Hors périmètre V2

Les éléments suivants sont **explicitement exclus** de la V2. Certains sont prévus pour la V3, d'autres pour le backlog.

| Fonctionnalité | Statut | Note |
|---|---|---|
| Garde mutualisée inter-cabinets / groupement | V3 | Colonne `groupement_id` vide en schéma (porte ouverte) |
| Astreinte téléphonique fonctionnelle | V3 | Champ `type_presence` en schéma (porte ouverte) |
| Repos de sécurité CCN comme contrainte active | V2 (OFF par défaut) | Brique livrée désactivée ; les règles 11h/48h nécessitent le planning de jour |
| Planning de consultation / planning de jour | V3+ | Nécessaire pour les règles de conformité horaires complètes |
| Agent autonome de développement de nouvelles briques | V3 | L'IA suggère, un dev valide via PR Git |
| Scénarios multiples / multi-planning candidats | Backlog | |
| App mobile native | V3+ | V2 = responsive navigateur |
| Gestion de la paie / heures supplémentaires | Hors périmètre | Nécessite intégration RH |
| Rappels avant garde (J-1, J-7) | Backlog | |
| Headroom (compression contexte IA) | V3 | Réévaluer à la volumétrie réelle |
| Scénarios "et si…" (simulation multi-planning) | Backlog | |
| Attribut géographique / multi-site | V3 | |
| Shifts multiples / grille continue 24-7 | V3 | Centres d'urgences CHV |

---

## 9. Architecture technique (orientation)

> Pour le détail de l'architecture technique, se référer au rapport de stratégie consolidé `docs/v2/02-rapport-strategie-consolide.md`.

### Stack maintenue

| Couche | Technologie |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript strict |
| Style | Tailwind CSS 4 + shadcn/ui |
| Base de données | Supabase (PostgreSQL + Auth + RLS) |
| Déploiement | Vercel |
| Tests | Playwright (via ruflo) |

### Orientations techniques V2

**Moteur (`src/engine/`) :**
- Réécriture du solver avec score lexicographique
- Unification de `scorer.ts` et `solver.ts`
- Interface d'entrée unifiée : le moteur reçoit des descripteurs de règles, pas des règles codées en dur

**Schéma Supabase :**
- Colonne `cabinet_id` sur toutes les tables de données métier
- Tables nouvelles : `briques_regles`, `regles_cabinet`, `compteurs_config`, `ledger`, `versions_regles`, `snapshots_planning`
- RLS : isolation stricte par `cabinet_id`
- Publication Realtime : à reconfigurer pour les nouvelles tables

**IA :**
- Modèle Haiku pour la traduction de règles (coût minimal, cache de prompt natif)
- Pas d'IA générative dans le chemin de génération du planning
- Recherche RAG ciblée dans la doc pour le chatbot support

**Sécurité (gate CERBÈRE) :**
- RLS vérifiée à chaque migration (audit CERBÈRE)
- Aucun secret en clair dans le code ou la base
- Les nouvelles briques développées par l'IA passent par PR Git + review humaine avant exécution en base

---

## 10. Modèle de données (grandes lignes)

### Tables nouvelles V2

```
cabinets
├── id, nom, statut (actif/suspendu), created_at
├── groupement_id (NULL — V3)
└── config_onboarding (JSON)

veterinaires_cabinet
├── id, cabinet_id, user_id (auth.users)
├── nom, role (admin/veto), quota_part
└── marqueur_externe, marqueur_dernier_recours

periodes
├── id, cabinet_id, nom, saison
├── date_debut, date_fin, longueur_rotation
└── config_json (effectifs, options)

creneaux_catalogue
├── id, cabinet_id, nom, type_presence
├── date_debut_reel, date_fin_reel (intervalle réel)
└── effectif_poste

briques_regles
├── id, famille, operateur
└── schema_json (ce que la brique accepte comme paramètres)

regles_cabinet
├── id, cabinet_id, periode_id (NULL = permanente)
├── brique_id, params_json (QUI / QUAND / QUOI / FORCE)
├── force (jamais / sauf_crise / evitee / si_possible)
├── validite_json (type, date_effet, version)
└── created_by, created_at

snapshots_regles
├── id, planning_id, created_at
└── regles_json (photo complète des règles actives à la génération)

plannings
├── id, cabinet_id, periode_id, statut (brouillon/publié)
├── snapshot_regles_id (lien vers la photo des règles)
└── score_lexicographique_json

attributions
├── id, planning_id, creneau_id, veterinaire_id
├── role (premier/second/couverture)
├── type_presence (sur_place/astreinte)
└── source (moteur/manuel)

ledger_events                  ← nom canonique (cf. archi §5.1)
├── id, cabinet_id, veterinaire_id
├── type_evt (charge / equite / conges / crise_depannage / compensation / ajustement_import / correction)
├── delta, unite, date_reference
├── attribution_id (optionnel), compensation_id (optionnel), corrige_event_id (optionnel)
└── created_at
   (Noms canoniques : table `ledger_events`, colonnes `type_evt` / `delta`. Voir archi §5.1.
    APPEND-ONLY : une correction = un nouvel événement type_evt='correction', jamais un UPDATE.)

compteurs_config
├── id, cabinet_id, nom, description
├── source, filtre_json, unite, sens
├── dimension_json, fenetre_json, agregation
├── cible_json, seuils_json, report
└── est_dimension_optimisation, visible_veto (bool — l'admin ouvre la colonne aux vétos)

crise_absences
├── id, cabinet_id, veterinaire_id, planning_id
├── type (courte/longue/immediate/anticipee)
├── date_debut, date_fin, motif
└── statut (ouverte/en_cours/resolue)

compensations
├── id, crise_absence_id, remplacant_id, remplace_id
├── proposition_json, statut (proposition/accord/officiel)
└── validated_by, validated_at

carnet_remplacants
├── id, cabinet_id, nom, contact
└── specialites, notes
```

### Règle d'isolation (RLS)

Chaque table de données métier est isolée par `cabinet_id`. Le schéma ci-dessous est **simplifié** ; la policy réelle ne lit PAS le claim à la racine du JWT (forgeable). 

> ⚠️ **Policy réelle : voir architecture §6.1.** Le `cabinet_id` se lit dans `app_metadata` (jamais `user_metadata`), via une fonction `auth_cabinet_id()` (chemin `auth.jwt() -> 'app_metadata' ->> 'cabinet_id'`), couplée à `auth_cabinet_actif()` (couvre la suspension d'un cabinet malgré un JWT périmé). Ne pas implémenter le snippet ci-dessous tel quel.

```sql
-- ILLUSTRATIF SEULEMENT — la vraie policy est en archi §6.1 :
USING (cabinet_id = auth_cabinet_id() AND auth_cabinet_actif())
```

La console super-admin MPP utilise un rôle service_role séparé, avec accès limité aux métadonnées des cabinets (jamais aux données métier). L'identité super-admin est prouvée par la table `super_admins` dans l'Edge Function, le `service_role` n'étant pas une preuve d'identité (cf. archi §6.6).

---

## 11. Parcours utilisateurs clés

### 11.1 Onboarding d'un nouveau cabinet (back-office MPP)

```
MiKL (back-office)
  ↓ Crée le cabinet (nom, email admin, config initiale)
  ↓ Envoie l'invitation à l'admin
Admin reçoit l'invitation
  ↓ Définit son mot de passe
  ↓ Arrive sur l'écran de setup guidé
  ↓ Configure le référentiel : liste des créneaux, zones scolaires, région fériés
  ↓ Ajoute les vétos (invite par email)
  ↓ Configure les périodes (durée, saison été/hiver)
  ↓ Active les règles structurelles (conventions locales : liaison vendredi/WE, etc.)
  ↓ Importe le planning existant (optionnel — amorçage des compteurs)
  ↓ Génère le premier planning brouillon
  ↓ Valide et publie
Cabinet opérationnel
```

### 11.2 Configuration d'une règle (Palier 1)

```
Admin — Écran "Règles du cabinet"
  ↓ Clique "+ Nouvelle règle"
  → Option A : saisit la règle en langage naturel (IA Traducteur — Palier 3)
     L'IA pré-remplit le formulaire
  → Option B : remplit le formulaire guidé pas-à-pas (toujours disponible)
  ↓ Sélectionne QUI / QUOI / QUAND / OPÉRATEUR / FORCE / VALIDITÉ
  ↓ Voit un aperçu en langage naturel de la règle créée
  ↓ Valide
  ↓ Règle active pour la prochaine génération
```

### 11.3 Génération d'un planning

```
Admin
  ↓ Sélectionne la période
  ↓ Vérifie la liste des vétos actifs + effectifs
  ↓ Lance la génération
Moteur
  ↓ Lit le référentiel (créneaux, vacances, fériés) depuis la base
  ↓ Lit les règles actives de la période
  ↓ Cherche la solution optimale (score lexicographique)
  → Si solution trouvée :
       ↓ Produit le planning brouillon
       ↓ Affiche les règles pliées (🟡/⚪ non respectées) avec ⚠️
  → Si aucune solution :
       ↓ Diagnostic d'impasse (Palier 2) : règles conflictuelles identifiées
       ↓ Suggestions d'assouplissement
Admin
  ↓ Consulte le brouillon
  ↓ Ajuste manuellement si nécessaire (tout override = tracé)
  ↓ Publie → snapshot des règles créé → notifications aux vétos
```

### 11.4 Gestion d'une absence imprévue

```
Véto ou Admin signale l'absence
  ↓ Sélectionne le type (courte / longue / immédiate / anticipée)
  ↓ Indique les créneaux concernés
Moteur — Mode AUTO
  ↓ Calcule la réparation à perturbation minimale
  ↓ Respecte les 🔴 JAMAIS
  ↓ Propose la solution + rapport des règles assouplies
Admin
  → Valide le Mode AUTO → planning réparé, notifications aux vétos impactés
  → Choisit "Appel aux volontaires" → mail envoyé + délai de réponse
  → Choisit "Remplaçant externe" → sélection dans le carnet
  → Déclare un trou (honnête > affectation fausse)
Si accord de compensation
  ↓ Remplaçant propose sa compensation
  ↓ Admin valide
  ↓ Officiel, tracé dans le ledger
```

### 11.5 Vue véto (tableau de bord personnel)

```
Véto connecté
  ├── Mon planning (semaine / mois)
  ├── Mes compteurs (visibles selon config admin)
  │   ├── Ma charge (nb gardes par type)
  │   ├── Mes CP restants
  │   └── Mes dettes/crédits
  ├── Mes indisponibilités (saisie / modification)
  ├── Mes souhaits (règles personnelles → proposées à l'admin)
  └── Mes congés (pose / consultation du solde)
```

---

## 12. Modèle économique

### Tarification

| Formule | Prix | Conditions |
|---|---|---|
| Mensuel | 79 €/mois/cabinet | Sans engagement |
| Annuel | ~790 €/an/cabinet (~66 €/mois) | Réduction annuelle |

- Vétos illimités dans un cabinet (pas de tarif par siège).
- Pas de freemium permanent.
- Essai gratuit (durée à définir lors du lancement commercial).
- Cabinet pilote : bêta gratuit sur V2.

**Paliers de fonctionnalités envisagés (non arbitrés) :**

| Palier | Contenu envisagé |
|---|---|
| Base | Génération planning + règles configurables (Palier 1) |
| Pro | Diagnostic intelligent (Palier 2) + IA assistante (Palier 3) |

### Part reversée à une cause

- Un pourcentage (ou montant fixe) par abonnement est reversé à une cause choisie par le cabinet.
- Transparence totale : le montant reversé est indiqué dans le dashboard cabinet.
- Bilan annuel public des montants reversés (engagement de MiKL — manifeste éthique).

### Canaux d'onboarding

1. **Back-office MPP :** MiKL enrôle manuellement. Contrôle total, adapté au lancement.
2. **Self-service :** cabinet s'inscrit seul. Interrupteur ON/OFF. Peut rester OFF au lancement.

---

## 13. Métriques de succès

### Métriques produit

| Métrique | Cible V2 (à 3 mois post-lancement) |
|---|---|
| Planning généré sans intervention manuelle | ≥ 80 % des générations |
| Taux de satisfaction des règles actives (🔴 jamais violée) | 100 % |
| Temps de configuration d'une nouvelle règle | < 2 minutes |
| Diagnostic d'impasse compris par l'admin | ≥ 80 % sans appel support |
| Crise résolue en Mode AUTO sans intervention admin | ≥ 60 % des cas courts |

### Métriques commerciales

| Métrique | Cible |
|---|---|
| Cabinets actifs payants à 6 mois post-lancement | 5 |
| Taux de churn mensuel | < 5 % |
| NPS cabinet | ≥ 50 |
| Délai d'onboarding (de l'invitation au premier planning publié) | < 1 semaine |

### Métriques techniques

| Métrique | Cible |
|---|---|
| Temps de génération d'un planning (7 vétos, 12 semaines) | < 30 secondes |
| Disponibilité | ≥ 99,5 % |
| Aucun bug de type "consumer désynchronisé" | 0 régression Realtime |
| Couverture de tests E2E (chemin critique moteur) | ≥ 80 % |

---

## 14. Risques

| Risque | Probabilité | Impact | Parade |
|---|---|---|---|
| Construire la config sur des fondations non purgées → bug en boucle | Haute (déjà vécu) | Critique | Fondations D'ABORD, non négociable |
| Trop de règles 🔴 → aucun planning possible | Moyenne | Élevé | Palier 2 (diagnostic) avant de donner les manettes |
| L'IA "invente" un planning ou une règle | Faible (architecture) | Critique | L'IA ne calcule JAMAIS — moteur seul juge |
| Solver réécrit qui régresse sur les cas V1 | Moyenne | Élevé | Golden test 11/11 obligatoire + tests E2E sur les règles pilote |
| Mélanger les chantiers V1 (livraison) et V2 (refonte) | Haute | Moyen | 2 chantiers séparés explicitement |
| Explosion de la complexité du catalogue de règles | Moyenne | Moyen | Grammaire à 6 axes fermée + escalier de dégrossissage IA |
| Fuite de données entre cabinets | Faible (RLS) | Critique | RLS vérifiée à chaque migration + gate CERBÈRE |
| Coût IA incontrôlé (Palier 3) | Moyenne | Moyen | Modèle Haiku pour traduction + cache de prompt natif |
| Onboarding multi-cabinet trop long → churn | Moyenne | Moyen | Back-office MPP d'abord, self-service quand le flow est rodé |
| Couverture de la grammaire insuffisante pour des cabinets atypiques | Moyenne | Moyen | 83 % déclaré honnêtement + escalade MPP pour les 17 % restants |

---

*PRD V2 — GuardVeto — Rédigé par OTTO (Product Manager MPP), 2026-06-16*
*Validé par MiKL — décisions actées le 2026-06-15*
*Document source architecture : `docs/v2/02-rapport-strategie-consolide.md`*
*Prochaine étape : ARCH rédige le document d'architecture technique détaillé (`docs/v2/06-architecture-v2.md`) à partir de ce PRD.*
