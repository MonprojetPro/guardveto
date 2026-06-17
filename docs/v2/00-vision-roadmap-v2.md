# GuardVeto V2 — Vision & Roadmap

> Document de cadrage. Orchestré par MAX (MPP). Créé le 2026-06-10.
> Fondé sur : l'audit technique du moteur (ARCH, 2026-06-10) + les retours bilan du cabinet (Anne-Catherine + Anne-Sophie, archivés dans `docs/retours-cabinet/`).
> **Statut : EN ATTENTE DE VALIDATION MiKL** (gate Phase 1).

---

## 1. L'ambition V2 (en une phrase)

> Faire passer GuardVeto d'un outil **où les règles sont soudées dans le code** à un outil **où les vétérinaires définissent et règlent elles-mêmes leurs contraintes**, visuellement, le moteur s'adaptant automatiquement — avec une surcouche IA qui traduit le langage naturel en règles et explique les résultats.

**Le pitch qui déchire :** un logiciel de planning de gardes où on *parle* à l'application (« je veux ça, pas ça »), elle traduit, le moteur calcule juste et garanti, et elle explique. Aucun tableur ni concurrent classique ne fait ça.

---

## 2. La distinction à garder en tête : V1 (livraison) vs V2 (chantier)

Le cabinet attend une **livraison imminente** (les retours du bilan). Il ne faut pas noyer ces urgences dans le grand chantier V2.

| | **Voie A — Finir la V1 (livraison)** | **Voie B — Construire la V2** |
|---|---|---|
| Nature | Corrections + ajustements de règles déjà demandés | Refonte structurelle : règles configurables + IA |
| Horizon | Court (le cabinet attend) | Moyen/long (vrai produit) |
| Moteur | 🟦 ruflo (patchs ciblés) | 🟦 ruflo (gros dev) + 🟧 MPP (cadrage/UX/IA) |
| Exemples | Bug navigation planning, effectif été cassé, divergence règle 10, agenda cabinet | Écran de config des règles, surcouche IA, diagnostic intelligent |

**Insight clé :** beaucoup de demandes du cabinet (compteurs par type de garde, calcul auto des jours de repos, effectif configurable) **sont exactement ce que la V2 résout nativement**. La V2 n'est pas déconnectée des retours — elle en est la **réponse structurelle**. Au lieu de patcher chaque règle à la main, on construit le système qui rend tout réglable.

➡️ **Décision à prendre (MiKL) :** quelles demandes du cabinet on traite en V1 (patch rapide) vs on absorbe dans la V2 ? (voir tableau §5)

---

## 3. Ce que l'audit nous apprend (les faits qui pilotent tout)

Le moteur est **bien architecturé et à moitié prêt** (isolé dans `src/engine/`, bien testé). Mais l'audit révèle **2 dettes bloquantes** à purger AVANT de poser une interface de configuration :

### 🔴 Dette n°1 — La « fissure dans les fondations » (couplage aval R8)
La vérité du moteur **n'est pas stockée en entier** : l'attribution du vendredi soir est *jetée* à l'enregistrement. Résultat, la règle d'inversion 1er/2nd vendredi↔week-end est **recalculée 3 fois indépendamment** (vue calendrier SQL, export PDF, sync Agenda). C'est exactement le bug de juin 2026 — réparé couche par couche, mais **la cause racine est toujours là**.

**Conséquence pour la V2 :** si on ajoute des règles configurables SANS réparer ça, chaque nouvelle couche (mobile, iCal, notifications…) devra re-coder la règle une 4ᵉ, 5ᵉ fois → le bug reviendra en boucle.

**Analogie :** rendre les règles configurables, c'est construire un étage de plus. On ne construit pas un étage sur une fondation fissurée. **On répare la fissure d'abord.**

### 🟠 Dette n°2 — Le scoring en double
La logique qui équilibre les gardes (l'équité) est écrite à **deux endroits** (`scorer.ts` et `solver.ts`) avec des formules légèrement différentes. Si on rend les « poids » réglables sans unifier ça, un curseur déplacé par une véto ne s'appliquerait qu'à moitié → comportement incompréhensible.

### Autres dettes (moyennes)
- **Données dupliquées code↔base** : vacances scolaires et jours fériés existent en table Supabase **mais le moteur les ignore** et lit des listes écrites en dur (à mettre à jour à la main chaque année).
- **Schéma de config hétérogène** : les contraintes par véto acceptent déjà 2 formats concurrents → à normaliser.

### La bonne nouvelle
- Les **contraintes individuelles** (jours de repos, indispos paire/impaire, duos interdits, dernier recours) sont **déjà en base avec une interface CRUD fonctionnelle** → externaliser de nouvelles règles individuelles = **FACILE**.
- Les **poids/pénalités sont déjà centralisés** (2 constantes) → les sortir en base = **FACILE/MOYEN**.
- Un **diagnostic d'infeasibilité existe déjà** partiellement (le moteur dit quel créneau bloque) → à **enrichir**, pas à créer.

---

## 4. L'architecture V2 : Fondations + 3 Paliers

```
┌──────────────────────────────────────────────────────────┐
│  PALIER 3 — Surcouche IA (le "waouh")                     │
│  • Traduire le langage naturel en règle structurée        │
│  • Assistant "et si...", explication des résultats        │
├──────────────────────────────────────────────────────────┤
│  PALIER 2 — Diagnostic intelligent (le confort)           │
│  • "Pas de planning possible parce que X + Y se           │
│     contredisent → voulez-vous assouplir ?"               │
├──────────────────────────────────────────────────────────┤
│  PALIER 1 — Règles configurables + écran visuel (la base) │
│  • Poids/pénalités en base (table parametres_moteur)      │
│  • Écran "Règles" : toggle dur/mou + curseurs + qui/quand │
│  • Nouveaux types de règles (veille, soir préféré...)     │
├══════════════════════════════════════════════════════════┤
│  FONDATIONS — Purge de dette (NON négociable, en premier) │
│  • F1 : persister la vérité complète du moteur (vendredi) │
│  • F2 : unifier le scoring (solver ↔ scorer)              │
│  • F3 : source unique de données (lire les tables)        │
│  • F4 : normaliser le schéma de config des contraintes    │
└──────────────────────────────────────────────────────────┘
```

**Règle d'or :** on monte les paliers dans l'ordre. Pas de Palier 1 sans Fondations. Pas d'IA (Palier 3) tant que les règles ne sont pas devenues des données propres (Paliers 1-2).

### Pourquoi cet ordre est intelligent
- Les **Fondations** rendent le reste possible ET corrigent des bugs latents → valeur immédiate même sans la suite.
- Le **Palier 1** livrable seul = déjà un énorme bond (les vétos règlent leurs règles). On peut **s'arrêter là** et avoir une vraie V2 vendable.
- Les **Paliers 2 et 3** sont des couches de confort/différenciation, ajoutables ensuite **sans tout refaire**.

---

## 5. Croisement : besoins du cabinet × où on les traite

| Besoin exprimé (AC/AS) | V1 (patch) | V2 Fondation | V2 Palier 1 | V2 Palier 2/3 |
|---|:--:|:--:|:--:|:--:|
| Bug navigation (revenir où on était) | ✅ | | | |
| Effectif été (1 véto) forçable manuellement | ✅ (urgence) | | ✅ (proprement) | |
| Divergence règle 10 (duo Manon+Antoine dur/mou) | ✅ (arbitrage) | | ✅ (réglable) | |
| Pas de notif à chaque garde | ✅ | | | |
| Agenda : tout le planning dans l'agenda cabinet | ✅ | F1 aide | | |
| Rotations 6 sem / 6 vétos (AC part) | ✅ | | ✅ (config saison) | |
| Forçage manuel d'un binôme (25 déc) | | | ✅ | |
| Compteurs par type de garde (1/2/WE1/WE2) | | F2 aide | ✅ | |
| Suivi congés payés (42j/70j, 1er oct→30 sept) | | | ✅ | |
| Calcul auto des jours de repos | | | ✅ | |
| « De préférence pas de garde le [jour] » | | | ✅ | |
| « Pas de garde la veille » (congé/vacances) | | | ✅ | |
| Parler à l'outil / règles en langage naturel | | | | ✅ (IA) |
| « Pourquoi pas de planning ? » expliqué | | | | ✅ (P2) |

---

## 5 bis. Décisions ACTÉES par MiKL (2026-06-10)

1. **Ambition** : les **3 paliers d'emblée** (config + diagnostic + IA).
2. **Multi-cabinet** : **construit d'emblée** (commercialisation visée — la niche véto FR est vide, le benchmark le confirme). → modèle de données multi-tenant dès les fondations.
3. **Échange/remplacement** : l'ajustement manuel **existe déjà en V1**. Le vrai besoin = un **système de gestion de crise** pour les absences LONGUES (arrêt de travail multi-semaines), à **réparation minimale** (ne pas régénérer tout le planning de tout le monde). « Il faut qu'on pense bien ce système là » — design prioritaire.

## 6. Décisions attendues de MiKL (les gates)

1. **Périmètre V1 vs V2** : valide-t-on la séparation des 2 voies ci-dessus ?
2. **Ambition V2** : on vise les 3 paliers, ou on cadre d'abord Fondations + Palier 1 (V2 « cœur ») et on décide des paliers 2-3 ensuite ?
3. **Le « non négociable »** : valide-t-on que les Fondations passent AVANT toute fonctionnalité visible (purge de dette d'abord) ?
4. **Moteur configurable jusqu'où ?** : les règles structurelles (effectif, inversion, vendredi lié au WE) — on les laisse fixes, ou réglables aussi ? (recommandation ARCH : fixes ou simple on/off, pas plus).

---

## 7. Risques identifiés

| Risque | Parade |
|---|---|
| Construire la config sur la dette R8 → bug en boucle | Fondations d'abord (non négociable) |
| Trop de règles « dures » → aucun planning possible | Palier 2 (diagnostic) obligatoire avant de donner les manettes aux vétos |
| L'IA « invente » un planning | L'IA ne calcule JAMAIS le planning — elle traduit/explique seulement. Le moteur reste seul juge. |
| Périmètre qui gonfle | Paliers livrables indépendamment ; on peut s'arrêter après le Palier 1 |
| Mélanger livraison cabinet et chantier V2 | 2 voies séparées (§2) |

---

## 8. Prochaine étape

Validation de ce cadrage par MiKL → puis Phase 1 détaillée (PRD V2 par REX+OTTO) sur le périmètre retenu.
