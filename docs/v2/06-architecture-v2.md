# Architecture V2 — GuardVeto

> **Auteur :** ARCH (Architecte technique MPP)
> **Date :** 2026-06-16
> **Statut :** PROPOSÉ — à valider par MiKL. Référence technique pour le découpage en stories de dev (ruflo).
> **Documents sources :**
> - `docs/v2/05-prd-v2.md` (PRD V2 validé — source principale)
> - `docs/v2/02-rapport-strategie-consolide.md` (grammaire, solver, bombes prod, décisions rouges D-R1→D-R4)
> - `docs/v2/03-catalogue-regles-blinde.md` (catalogue de briques, champs non-rétro-ajoutables)
> - `docs/v2/04-compteurs-produit.md` (anatomie des compteurs, ledger)
> - `docs/02-architecture.md` (architecture V1, l'existant à faire évoluer)
> - Code réel : `src/engine/solver.ts`, `scorer.ts`, `rules/optimization.ts`, `rules/hard-constraints.ts`, `loader.ts` ; migrations `supabase/migrations/*.sql`

---

## 1. Principes directeurs

Cinq principes gouvernent toute l'architecture V2. Chaque décision technique du document découle de l'un d'eux.

### P1 — La cuisine de restaurant : une seule vérité, persistée, lue par tous

**Analogie.** En cuisine, le chef envoie *un* plat. Le serveur ne re-cuisine pas en salle, il porte l'assiette telle quelle. Aujourd'hui en V1, trois "serveurs" (la vue SQL `compteurs_gardes`, l'export PDF, la sync Agenda) re-cuisinent chacun leur version du planning — d'où le bug R8 (l'inversion vendredi↔WE recalculée différemment partout). C'est aussi le cas des compteurs : `compterParVet()` (TS), la vue SQL et le hook `useCompteurs` donnent **trois chiffres divergents** pour la même réalité.

**Règle V2.** Le moteur produit **une** vérité canonique, persistée intégralement. Tout consommateur (écran, PDF, Agenda, IA, crise) **lit** cette vérité, ne la **recalcule jamais**. C'est la généralisation de la règle CONSUMERS du CLAUDE.md : *quand une donnée est produite, on identifie tous ses lecteurs et on s'assure qu'ils lisent la même source.*

### P2 — Déterminisme total

Même entrée = même sortie, à chaque exécution. Le solver V1 retourne la *première* solution faisable (ordre de tri SQL des vétos), donc non rejouable. La V2 garantit que deux générations sur les mêmes données produisent le **même** planning, octet pour octet — condition de la promesse "preuve en cas de litige entre associés" (F8). Cela impose un **tie-break explicite et stable** partout où un choix arbitraire existe.

### P3 — Source unique de définition (DRY métier)

Une notion = une définition, partagée par tous ceux qui en ont besoin. "Ce qu'est un week-end de garde" est défini **une fois** et lu par : le solver, les compteurs, l'équité, la crise, l'IA. Le catalogue de briques (le code des évaluateurs) est **mutualisé** entre cabinets ; seules les *valeurs* (quelles règles, quels paramètres) sont par cabinet. L'IA et le moteur partagent **physiquement** le même catalogue de briques et le même catalogue de compteurs.

### P4 — Multi-tenant par conception

`cabinet_id` n'est pas un ajout : c'est une colonne de **chaque** table métier, dans **chaque** index unique et **chaque** politique RLS, dès la première migration V2. Greffer l'isolation après coup = tout réécrire (consensus C6). L'isolation est prouvée par la base (RLS Postgres), pas seulement par le code applicatif.

### P5 — L'IA propose, le moteur dispose

L'IA traduit et explique au moment de **définir** une règle. Elle n'entre **jamais** dans le chemin de génération du planning. La validation d'une règle traduite est **déterministe** (vérification de syntaxe côté code), jamais déléguée au LLM. Une hallucination ne peut donc pas produire un planning faux en silence — elle peut au pire mal pré-remplir un formulaire que l'admin relit.

---

## 2. Vue d'ensemble en couches

```
┌──────────────────────────────────────────────────────────────────────────┐
│  COUCHE IA (surcouche, jamais dans le chemin de génération)                │
│  Traducteur · Enquêteur · Aiguilleur · Chatbot support                     │
│  Lit le catalogue de briques/compteurs · pré-remplit des formulaires       │
│  Sortie = brouillon de règle → VALIDATION DÉTERMINISTE (code) → base       │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ (écrit des données de config, jamais du planning)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  RÉFÉRENTIEL (données de config par cabinet, en base)                      │
│  regles_cabinet · creneaux_catalogue · periodes · compteurs_config         │
│  veterinaires_cabinet · vacances_scolaires · jours_feries · carnet_rempl.  │
│  → résolus en "briques actives + paramètres" pour une période donnée       │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ assemble le ContexteSimulation
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  MOTEUR — la fonction pure  simuler(contexte) → Resultat                   │
│  Solver lexicographique (greedy V1 seed + LNS hill-climbing)               │
│  Évaluateurs de briques (un par type) · projection du ledger (équité)      │
│  Produit : { planning, trace, scores, diagnostic }                         │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ persiste la vérité complète (F1)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  VÉRITÉ CANONIQUE (persistée, immuable une fois publiée)                   │
│  plannings · attributions (TOUS les attributs) · snapshots_regles          │
│  ledger_events (faits datés) · scores_lexicographiques                     │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ TOUS lisent, AUCUN ne recalcule (P1)
        ┌───────────────┬───────┴───────┬───────────────┬──────────────┐
        ▼               ▼               ▼               ▼              ▼
   Écran planning   PDF / CSV     Sync Agenda      Compteurs       Système
   (vue véto/admin)                                (projections)    de crise
```

**Lecture clé :** la flèche descendante "production" passe **une seule fois** par le moteur. Toutes les flèches du bas sont des **lectures**. Le système de crise lui-même ré-emprunte `simuler()` (avec un contexte restreint), il ne réinvente pas de logique de réparation.

---

## 3. Architecture du moteur

Le moteur vit dans `src/engine/`. La V2 le réécrit autour d'une fonction centrale unique.

> 🧪 **Banc d'essai moteur AVANT le gros dev (décision MiKL, 2026-06-16).** Le solver est le composant le plus risqué de la V2 (réécriture complète, perf, exactitude). Un **PoC isolé du solver** — `simuler()` + le solver lexicographique hybride, branché sur les **11 règles réelles du cabinet pilote** (golden test) — est construit et validé **avant** le découpage en stories de dev. Objectif : prouver perf (< 30 s) ET exactitude (11/11 règles exprimées correctement, équité crédible) sur des données réelles. Tant que ce banc d'essai n'est pas concluant, le reste de la V2 (config, IA, multi-tenant) n'est pas lancé. Voir aussi §11 (plan de migration).

### 3.1 La fonction pure `simuler()` — signature, contrat, déterminisme

**Le cœur de l'architecture.** Une fonction pure qui, à partir d'un contexte complet (règles résolues + référentiel + état initial), produit un résultat complet (planning + trace + scores + diagnostic). Elle sert **quatre usages** sans duplication de logique :

1. **Génération normale** d'un planning de période.
2. **Aperçu de configuration** ("si j'active cette règle, voici l'effet") — le même `simuler()` lancé sur un contexte modifié.
3. **Diagnostic d'impasse** — quand `simuler()` échoue, il renvoie *pourquoi* dans la même structure.
4. **Système de crise** — `simuler()` lancé avec les attributions publiées gelées + une absence, mode "réparation à perturbation minimale".

> **Analogie.** C'est le four de la cuisine. Qu'on prépare le plat du jour, un essai de nouvelle recette, ou qu'on réchauffe un plat en remplaçant un ingrédient absent — c'est le même four, avec des réglages différents. On ne construit pas trois fours.

```typescript
// src/engine/simuler.ts — la fonction pure centrale

/** Tout ce dont le moteur a besoin, déjà résolu depuis la base. Aucune lecture I/O ici. */
export interface ContexteSimulation {
  cabinetId: string
  periodeId: string
  dateDebut: string            // ISO, toujours un lundi (invariant)
  dateFin: string              // inclusif
  /** Catalogue de créneaux du cabinet pour la période (remplace les types figés V1). */
  creneaux: CreneauResolu[]
  /** Vétos actifs sur CETTE période, avec quote-part et marqueurs. */
  vets: VetResolu[]
  /** Règles actives résolues : chaque règle = { brique, params, force, validite }. */
  regles: RegleResolue[]
  /** Données calendaires lues depuis la base (F3) : fériés, vacances par zone. */
  calendrier: CalendrierResolu
  /** Projection du ledger AVANT cette période (soldes d'équité + dettes de crise). */
  soldesInitiaux: SoldeLedger[]
  /** Lookback inter-périodes (~10 j) pour les règles de consécutivité (bug §2-8 du catalogue). */
  contexteAnterieur: AttributionGelee[]
  /** Attributions verrouillées (mode crise/régénération partielle). Vide = génération from scratch. */
  attributionsGelees: AttributionGelee[]
  /** Mode d'exécution. */
  mode: 'generation' | 'apercu' | 'crise_auto' | 'diagnostic'
  /** Fuseau de référence des calculs calendaires (cabinets.timezone). Donnée d'entrée, jamais lue de l'env (E4). */
  timezone: string             // ex. 'Europe/Paris'
  /** Graine de tie-break — fixe et documentée (P2). Par défaut: ordre stable d'ID véto. */
  tieBreak: TieBreakConfig
}

export interface ResultatSimulation {
  statut: 'complet' | 'partiel' | 'impasse'
  /** La vérité canonique : toutes les attributions avec TOUS leurs attributs (F1). */
  attributions: AttributionComplete[]
  /** Le vecteur de score lexicographique de la solution retenue (§3.2). */
  score: VecteurScore
  /** Le "pourquoi" : règles enfreintes, coût par étage, contrainte bloquante (§3.3). */
  trace: TraceSimulation
  /** Présent si statut != 'complet' : diagnostic d'impasse exploitable (§3.4). */
  diagnostic?: DiagnosticImpasse
  /** Métadonnées de rejouabilité. */
  dureeMs: number
  hashEntree: string           // empreinte du ContexteSimulation trié — outil de non-régression (G3), pas preuve juridique
}

export function simuler(ctx: ContexteSimulation): ResultatSimulation
```

**Contrat de pureté (non négociable) :**
- `simuler()` ne fait **aucune** I/O (pas de Supabase, pas de `Date.now()` dans la logique de décision, pas d'aléatoire). Toute donnée entre par `ContexteSimulation`. `dureeMs` est mesuré à l'extérieur de la logique décisionnelle.
- **`resoudreContexte()` TRIE tout (E3 — condition de rejouabilité).** Le wrapper I/O (`loader.ts` → renommé `resoudreContexte.ts`) lit Supabase et **assemble** le `ContexteSimulation`. C'est la seule couche qui touche la base. **Il DOIT trier toutes ses collections par clé stable avant de bâtir le contexte** : `vets` par `id`, `regles` par `(etage, brique_id, id)`, `creneaux` par `(date_debut_reel, id)`, `soldesInitiaux` par `(veterinaire_id, metric_def_id)`. Si l'ordre vient de l'ordre SQL (non garanti), le `hashEntree` change d'une exécution à l'autre et la rejouabilité saute — c'est exactement le bug de non-déterminisme V1 (tie-break dépendant de l'ordre SQL). Aujourd'hui `src/engine/loader.ts` fait déjà le rôle de chargement, mais sans tri stable : on le généralise **et** on grave le tri.
- **Déterminisme prouvable (test étendu) :** le test de rejouabilité est `simuler(resoudreContexte(P)) === simuler(resoudreContexte(P))` — c.-à-d. on rejoue **depuis la base**, pas seulement `simuler(ctx) === simuler(ctx)` (qui ne couvre pas le tri). `hashEntree` est calculé sur le contexte trié ; deux résolutions de la même période doivent produire le même hash. Test sur les 11 règles du golden test.
- **Fuseaux horaires (E4) — règle de référence déterministe.** Le moteur mélange deux granularités : les bornes réelles de créneau sont des `TIMESTAMPTZ` (`attributions.date_debut_reel/fin_reel`, ex. WE = sam 8h → lun 8h) ; les jours civils (fériés, vacances, "le mardi") sont des `DATE`. Règle gravée : **tous les calculs calendaires de `simuler()` ("la veille de" / "le lendemain de" / appartenance à un jour civil) se font dans le fuseau du cabinet** (`cabinets.timezone`, défaut `Europe/Paris`), **passé dans `ContexteSimulation` et non lu d'un environnement**. Concrètement, `resoudreContexte()` convertit chaque `TIMESTAMPTZ` en date civile locale du cabinet **une fois**, et `simuler()` ne raisonne plus qu'en dates civiles locales + bornes déjà résolues. Aucun appel à `new Date()` "local machine" dans le moteur : le fuseau est une donnée d'entrée, pas une dépendance d'environnement. Cela garantit qu'une génération produit le même planning quel que soit le serveur Vercel qui l'exécute.

**`hashEntree` — outil de non-régression, pas preuve juridique (G3).** `hashEntree` est l'empreinte du `ContexteSimulation` trié. Son rôle : **test de non-régression et de rejouabilité technique** (rejouer une génération et vérifier qu'elle reproduit le même résultat). Ce n'est **pas** une "preuve juridique en cas de litige" — la traçabilité métier en cas de désaccord entre associés est portée par le **snapshot des règles** (§10, `snapshots_regles`), lisible et humain, pas par un hash opaque.

**Ce que ça corrige par rapport à V1 :** aujourd'hui `genererPlanningPur()` (solver.ts:279) est presque pur mais lit `estJourFerie`/`estEnVacancesScolaires`/`estEnEte` depuis des **listes en dur** dans `utils.ts` (bug F3). Désormais tout le calendaire passe par `ctx.calendrier`. Plus aucune lecture cachée.

### 3.2 Le solver lexicographique

**Le problème V1 (prouvé dans le code).** Deux défauts cumulés :
1. `solver.ts:261` boucle sur les candidats triés et retourne **la première solution faisable** (`if (result !== null) return result`). Il ne compare jamais deux solutions complètes. `scorer.ts:scoreEquite()` existe mais **n'est jamais appelé** par le backtracking.
2. Le score est **additif** : `scorerCandidat()` (solver.ts:170) fait `weEffectif * POIDS.WE_GARDE + malusRole + pen`, avec des poids (`POIDS.WE_GARDE=100`, `FERIES=60`...). Deux pénalités "moyennes" peuvent franchir le seuil d'une règle "forte" (la bombe prod #2).

**La solution V2 : comparaison par étages (lexicographique), avec somme pondérée À L'INTÉRIEUR de chaque étage.**

> ✅ **DÉCISION ACTÉE (MiKL, 2026-06-16) — Lexicographique HYBRIDE.** On compare étage par étage (les étages restent **hermétiques** : le 🔴 est un mur, garantie "🔴 Jamais = jamais"), **mais à l'intérieur de chaque étage on additionne des violations pondérées** (somme fine intra-étage, qui récupère la fairness fine). C'est l'approche standard en recherche opérationnelle.
>
> **Traçabilité — raffinement de D-R1, pas contradiction.** La décision rouge **D-R1** du rapport stratégie (`03-catalogue-regles-blinde.md` §5) actait "lexicographique pur". L'hybride **préserve intégralement** les deux garanties de D-R1 : (1) la **hermétricité inter-étages** (deux 🟡 ne franchiront jamais le seuil d'un 🟠 — fix de la bombe prod #2) ; (2) la **rejouabilité / déterminisme** (tie-break stable, §3.2 tie-break). L'hybride **ajoute uniquement** la finesse de comparaison *à l'intérieur* d'un même étage — là où le pur, lui, départageait deux violations de même niveau de façon trop grossière ("tyrannie de l'étage supérieur" : sacrifier 5 inconforts 🟡 pour 1 cran 🟠). Confirmé indépendamment par le benchmark R5. C'est donc un **raffinement** de D-R1 (plus de finesse au même endroit), pas un revirement.

> ⏳ **Spec solver précise à finaliser APRÈS le banc d'essai (PoC).** La *forme* de la décision est gravée (hybride, étages, variance, tie-break). Mais les paramètres fins du solver — **timeout** de recherche, **borne d'élagage** du branch-and-bound, stratégie exacte de **désarmement intra-étage** (comment on combine les pénalités pondérées dans un étage), poids relatifs — seront **calibrés sur le banc d'essai** (§3 nota) avec les données réelles du pilote. On ne fige pas ces nombres dans l'archi : ils sortent de la mesure, pas du raisonnement. Les §3.2 "Algorithme" et "Calcul incrémental" ci-dessous décrivent la *structure*, pas les constantes.

Le score d'une solution est un **vecteur** :

```typescript
// src/engine/score-lexicographique.ts

export interface VecteurScore {
  /** Un nombre par étage, dans l'ordre de priorité décroissante. */
  etages: number[]
  /** Détail par étage : quelles règles ont contribué (pour la trace). */
  contributions: ContributionEtage[]
}

/** Les étages, du plus fort au plus faible. L'index = la priorité. */
export enum Etage {
  INVARIANT_SYSTEME = 0,   // jamais violable (D-R4 a) — un seul > 0 = solution rejetée
  REGLEMENTAIRE     = 1,   // CCN/légal (D-R4 b) — GRAVÉ VIDE & DÉSACTIVÉ en V2 (G1) : emplacement réservé, zéro règle
  JAMAIS_USER       = 2,   // 🔴 règle d'or utilisateur (D-R4 c) — violable en crise-manuel seulement
  SAUF_CRISE        = 3,   // 🟠 — assouplissable par crise_auto
  EVITEE_AU_MAX     = 4,   // 🟡
  SI_POSSIBLE       = 5,   // ⚪
  EQUITE            = 6,   // variance des charges (dimension d'optimisation, §3.2 fairness)
}

/**
 * Comparaison lexicographique : on parcourt les étages du plus fort au plus faible.
 * Le premier étage où les deux vecteurs diffèrent décide. Déterministe.
 * @returns < 0 si a est meilleur, > 0 si b est meilleur, 0 si strictement égaux.
 */
export function comparerScores(a: VecteurScore, b: VecteurScore): number {
  for (let i = 0; i < a.etages.length; i++) {
    if (a.etages[i] !== b.etages[i]) return a.etages[i] - b.etages[i]
  }
  return 0 // égalité parfaite → départagé par le tie-break déterministe (§3.2 tie-break)
}
```

**Étages hermétiques.** Une violation à l'étage 0 (invariant) ou 1 (réglementaire) rend la solution invalide d'office en mode `generation`. Deux règles 🟡 (étage 4) ne peuvent jamais peser sur l'étage 3 (🟠) : les étages ne communiquent pas. C'est exactement ce que demandent le PRD §7.1 et le fix de la bombe prod #2 (F7).

**✅ Trois sous-niveaux dans le rouge (D-R4) — ACTÉ (MiKL, 2026-06-16).** Le PRD parle de "🔴 JAMAIS". Le catalogue (D-R4) raffine : tous les 🔴 ne se valent pas en cas de conflit frontal. On grave **3 étages** distincts (0 = invariant système / 1 = réglementaire / 2 = 🔴 règle d'or utilisateur) plutôt qu'un seul. Coût = trois entiers dans le vecteur au lieu d'un. Bénéfice : l'admin "tout-puissant" en crise peut outrepasser une règle d'or *utilisateur* (étage 2) mais **jamais** un invariant système (étage 0) ni une règle réglementaire (étage 1). Sans ces sous-niveaux, on ne peut pas exprimer "outrepassable en crise OUI/NON".

> 🪶 **Dé-goldplating (G1) — ce qu'on NE construit PAS maintenant.** L'**enum à 3 sous-étages est gravé** (décision MiKL), mais :
> - **L'étage 1 RÉGLEMENTAIRE est gravé VIDE et désactivé.** Emplacement réservé dans le vecteur, **zéro règle réglementaire** livrée et **zéro machinerie** d'application légale (décision MiKL : les règles légales en dur sont hors V2, cf. rapport stratégie D-R4). Le jour où un cabinet en veut, l'étage existe déjà.
> - **La matrice de préséance `force × validité × mode` n'est PAS implémentée** tant qu'aucun cabinet réel n'a deux 🔴 contradictoires. On ne code pas un arbitre de conflits hypothétique. Le comportement par défaut suffit (voir ci-dessous "Conflit entre deux 🔴 user").

**✅ Conflit entre deux règles 🔴 user de même étage (D-R4) — ACTÉ (MiKL, 2026-06-16).** Quand deux 🔴 *utilisateur* (étage 2) se contredisent frontalement, **le moteur ne tranche PAS en silence** : il produit la meilleure solution déterministe possible (tie-break stable), **signale le conflit (⚠️)** sur le planning brouillon, l'IA explique aux admins la nature de la contradiction, et **les admins s'organisent entre eux** pour ajuster l'une des deux règles. Pas de co-validation imposée, pas d'admin principal, pas de blocage de la génération — cohérent avec la gouvernance simple "autant d'admins, mêmes droits" (PRD §5). Ce comportement est l'alternative légère à la matrice de préséance non implémentée ci-dessus.

**✅ Fonction de fairness (étage ÉQUITÉ) — ACTÉ (MiKL, 2026-06-16) : VARIANCE par défaut.** À l'intérieur de l'étage ÉQUITÉ (le dernier étage, n°6), la minimisation se fait sur la **variance** des charges (déjà implémentée dans `variance()` de `rules/optimization.ts`). C'est le sens par défaut du mot "équité" dans tout le moteur. Le `min-max` (écart max-min, aussi présent dans le code) reste disponible comme **option de référentiel** par cabinet, mais n'est pas le défaut. Ce choix lève l'ambiguïté qui rendrait sinon le ressenti des vétos aléatoire.

**Le marqueur "dernier recours"** (Anne-Cat en V1) n'est pas un étage de force. C'est un **drapeau sur le véto** (`marqueur_dernier_recours`) qui agit comme un terme de pénalité **dominant à l'intérieur de son étage** : tant qu'une autre solution existe sans ce véto, elle gagne. Concrètement, en V1 c'est codé brutalement (`scorerCandidat` retourne `1_000_000` si `vet.dernier_recours`, solver.ts:130). En V2, ça devient une contribution propre, bornée, traçable.

**Tie-break déterministe (D-R2).** Quand `comparerScores() === 0` (deux solutions strictement équivalentes), on départage par un ordre **stable et documenté** : ordre d'ID véto, puis ordre chronologique des créneaux. Gravé comme invariant. C'est ce qui manque cruellement en V1 (dépend de l'ordre SQL → non rejouable).

**Algorithme — décision finale gravée (bancs d'essai 2026-06-16, mesures réelles).**

> ⚠️ **NO-GO confirmé sur le "backtracking vers la meilleure feuille"** : timeout 30 s systématique sur 7×12 et 6×6. L'équité-variance (étage 6) est **non-monotone → non-élagable** par branch-and-bound. Le paradoxe mesuré : le greedy V1 actuel produit déjà une équité quasi-parfaite en ~1,6 s.

**Approche retenue : Greedy V1 (seed) + LNS (Local Neighborhood Search — hill-climbing systématique).**

```
1. Seed greedy V1 — appel de genererPlanningPur() (backtracking, retourne la 1re solution valide).
   Déjà quasi-équitable et sub-seconde. Sert de point de départ.

2. LNS hill-climbing sous budget temps :
   - Détruire  : supprimer toutes les attributions d'une semaine (neighborhood = 1 semaine)
   - Réparer   : réassigner la semaine par greedy pur (même scorerCandidat que V1,
                 en contexte du planning partiel — l'équité globale guide la réparation)
   - Accepter  : conserver si comparerScores(nouveau, actuel) < 0 (amélioration stricte)
   - Itérer    : passes successives sur toutes les semaines jusqu'à convergence (N passes
                 sans amélioration) ou fin du budget temps

3. Retourner la meilleure solution trouvée.
```

**Résultats mesurés (banc d'essai 2, congés + fériés réels) :**
- 7 vétos × 12 semaines : seed 1,2 s + LNS 8,4 s → total **9,6 s** ; équité améliorée (764 490 → 738 776) ✅
- 6 vétos × 6 semaines : seed 0,2 s + LNS 1,5 s → total **1,7 s** ; équité améliorée (30 000 → 10 000) ✅
- 0 violation hard constraint dans tous les scénarios ✅
- 0 violation congés/fériés ✅
- Déterminisme : 2 runs → même empreinte ✅
- Étages hauts (0-5) jamais dégradés par le LNS ✅

**Calcul incrémental (indispensable, pas optionnel).** Recalculer `compterParVet()` sur tout le planning à chaque nœud est coûteux. En V2, le vecteur de score est mis à jour **en delta** à chaque attribution/retrait (le doc compteurs §4 le demande explicitement). Une attribution touche peu de compteurs : on ajuste, on ne recompte pas. Sans delta incrémental, le LNS sera trop lent pour être utile sur les périodes longues.

**Garde-fou anti-cumul intra-étage.** Mesuré : dans un même étage, deux violations légères (poids 30+30=60) dépassent une violation importante (poids 45). **Règle gravée : ne jamais mélanger dans un même étage des règles dont les poids diffèrent d'un ordre de grandeur.** Fusionner ou séparer en étages distincts si le rapport max/min > 5×.

### 3.3 La trace (le "pourquoi")

Chaque résultat porte une **trace** : la justification auditable de la solution. Elle alimente l'affichage des "règles pliées ⚠️", le diagnostic, l'IA explicative, et la preuve en litige.

```typescript
export interface TraceSimulation {
  /** Par étage : quelles règles ont été enfreintes et à quel coût. */
  reglesEnfreintes: {
    regleId: string
    libelle: string          // langage naturel ("Manon — pas de garde vendredi")
    etage: Etage
    creneaux: string[]       // où exactement la règle a plié
    cout: number             // contribution au vecteur de score
  }[]
  /** Décisions clés : pour les créneaux "serrés", pourquoi ce véto et pas un autre. */
  decisions: {
    creneauId: string
    vetChoisi: string
    alternativesRejetees: { vetId: string; raison: string }[]
  }[]
  /** Marqueurs dernier recours réellement utilisés. */
  derniersRecoursUtilises: { vetId: string; creneauId: string }[]
}
```

La trace est **persistée** avec le planning (`plannings.trace_json`). Elle n'est jamais recalculée : c'est la photo du raisonnement au moment de la génération.

### 3.4 Le diagnostic d'impasse (corrigé)

**Bug V1 (risque R4, prouvé).** `solver.ts:304-312` construit le rapport d'impasse en testant `isValid(slot, v, role, vets, { attributions: [] })` — c'est-à-dire contre un **planning VIDE**, pas contre le contexte réel au point de blocage. Il "ment" : il signale comme bloquantes des contraintes qui ne le sont qu'à vide.

**Fix V2.** Le diagnostic évalue la faisabilité **dans le contexte réel** du planning en construction au point d'impasse (les attributions déjà posées). Il produit :

```typescript
export interface DiagnosticImpasse {
  creneauBloquant: string                  // "WE2 du 14 mars"
  /** Pour chaque véto, la raison réelle de son exclusion DANS LE CONTEXTE courant. */
  exclusions: { vetId: string; regleId: string; raison: string }[]
  /** Suggestions d'assouplissement classées par impact (bornées, voir ci-dessous). */
  suggestions: {
    regleId: string
    actionProposee: string                 // "passer R7 de 🟠 à 🟡"
    faisableApres: boolean                  // re-simulation confirme que ça débloque
  }[]
}
```

**Comment on identifie LE créneau bloquant (F4).** On réutilise la mécanique V1 du `deepest` (solver.ts:240-246) — l'index de profondeur **maximale atteinte** par le backtracking — mais **corrigée** : le créneau bloquant est le `step` à cette profondeur, et ses `exclusions` sont évaluées **contre le planning partiel réel à ce point** (les attributions déjà posées), pas contre un planning vide comme en V1. C'est l'approche "profondeur max atteinte", déterministe et peu coûteuse — **pas** une analyse de conflit min-UNSAT (coûteuse, repoussée hors V2). Si plusieurs branches atteignent la même profondeur, le tie-break stable (§3.2) désigne le créneau rapporté.

**Coût borné des suggestions `faisableApres` (F4).** Chaque suggestion teste un assouplissement en **relançant `simuler()`** → c'est cher. On **borne** : au plus **N suggestions** testées (N = 3 par défaut, à confirmer au banc d'essai), choisies parmi les règles qui apparaissent dans les `exclusions` du créneau bloquant (pas toutes les règles du cabinet), et triées par impact estimé (force la plus haute d'abord). Au-delà de N, on liste les règles candidates **sans** lancer la re-simulation (`faisableApres` = `null`/"non testé"). Évite l'explosion combinatoire d'un diagnostic qui relancerait le solver des dizaines de fois.

**Pré-vol de cohérence (correctif R6 🟠) — DIFFÉRÉ (G4).** L'idée : avant le backtracking, un passage léger détecte les contradictions **arithmétiques** entre règles 🔴 (ex. : "au moins 2 seniors par WE" + "Manon jamais le WE" + il ne reste qu'un senior → impossible *a priori*). **Décision de cadrage : on le DIFFÈRE.** C'est une optimisation de confort qui **dédoublerait la logique de faisabilité** (une fois dans le pré-vol, une fois dans le solver). On l'active **seulement si** le diagnostic post-solver s'avère trop lent en pratique (mesure au banc d'essai). Par défaut V2 : le diagnostic post-impasse (ci-dessus) suffit.

### 3.5 Fix des 2 bombes prod (F7)

Les deux bombes sont corrigées **sur la V1** (chantier séparé urgent) et l'archi V2 les intègre nativement :

| Bombe | Cause V1 | Fix V2 (natif) |
|---|---|---|
| **Parité ISO semaine 53** | `estSemaineImpaire()` (utils.ts) repose sur le n° de semaine ISO. 2026 a 53 semaines → 2 impaires consécutives en décembre → l'alternance d'Anne-So se désynchronise. | **Ancre mobile** (voir règle de recalage détaillée ci-dessous). Le n° de semaine ISO est **banni** de tout calcul d'équité/quota (règle de gestion §4-3 du catalogue). Champ `regle.params.date_ancre` + variante `offset_decale` (att. 9). |

**Règle de recalage de l'ancre mobile (E5) — déterministe.** L'alternance "1 semaine sur 2" se calcule depuis une **date d'ancre** propre à la règle, **et non depuis le lundi de la période** : `phase = floor((jourCivilLocal(d) - date_ancre) / 7) mod 2`. Deux précisions gravées :
- **Recalage à chaque vacances scolaires (bug parité ISO).** La `date_ancre` n'est pas fixée une fois pour toutes : elle est **re-fixée au début de chaque période de vacances scolaires** (lue depuis `vacances_scolaires`, par zone). Cela neutralise la dérive des semaines ISO (53e semaine) puisque l'alternance ne dépend plus du numéro de semaine mais d'un compteur de jours depuis une ancre régulièrement recalée — exactement le besoin métier d'Anne-So (garde alternée d'enfant recalée aux vacances).
- **Jour d'ancre découplé du lundi-de-période (att. 9 "offset décalé").** L'ancre peut tomber n'importe quel jour de semaine, et la fenêtre de la contrainte peut **traverser la frontière de semaine** : la vraie contrainte d'Anne-So va du **jeudi soir (semaine impaire) au jeudi matin (semaine paire)**. Le calcul de phase se fait donc sur le **jour réel de la contrainte** (avec son `offset_decale` en jours depuis l'ancre), jamais en supposant que la semaine commence le lundi. C'est porté par `ConditionQuand.type_semaine` qui transporte son propre `ancre` (§4.4).
| **Cumul de pénalités** | Score additif (`scorer.ts`) : 45 + 20 > 50 → deux 🟡 écrasent un 🟠. | **Étages hermétiques** (§3.2) : structurellement impossible. Les poids additifs `POIDS.*` sont supprimés ; ne subsiste qu'une somme pondérée *intra-étage*. |

---

## 4. Le système de briques et de règles

### 4.1 Le contrat d'une brique

Une **brique** = du **code** : un évaluateur typé + un schéma de paramètres + un widget de saisie. Une **règle** = de la **donnée** : "telle brique, avec tels paramètres, à telle force, valable telle période". Le code des briques est mutualisé entre tous les cabinets (P3) ; la base dit quelles règles chaque cabinet active.

> **Analogie.** Une brique est un *moule à gâteau* (la forme est fixe, c'est du matériel). Une règle est le *gâteau* (mêmes moules, ingrédients différents selon le cabinet). On fabrique les moules une fois (en code, via PR Git) ; chaque cabinet remplit ses moules (en base, via l'interface).

```typescript
// src/engine/briques/types.ts

/** Le contrat que TOUTE brique implémente. Une brique = une instance de ceci. */
export interface Brique<P = unknown> {
  /** Identifiant stable, référencé par regles_cabinet.brique_id. */
  id: string                              // ex. "interdire_creneau", "alternance_ancre"
  famille: FamilleBrique                  // 'interdire' | 'forcer' | 'limiter' | 'equilibrer' | 'couverture' | 'sequence'
  operateur: string                       // 'JAMAIS' | 'IMPOSER' | 'AU_PLUS_N' | ...
  /** Schéma JSON des paramètres acceptés (validé à la saisie, déterministe). */
  schemaParams: JSONSchema
  /** Le widget de saisie (référence vers un composant React). */
  widget: string                          // ex. "SelecteurCreneauRole"
  /** Le libellé en langage naturel (pour l'aperçu + l'IA + la trace). */
  rendreLangageNaturel: (params: P, ctx: ContexteLangage) => string

  /**
   * Phase à laquelle l'évaluateur s'applique (F2) :
   *  - 'candidat'  : élagage par-candidat pendant le backtracking (comme isValid V1)
   *  - 'solution'  : scoring sur planning complet (ÉQUILIBRER, COUVERTURE globale, AU-PLUS-N+FENÊTRE)
   *  - 'les_deux'  : participe aux deux (rare)
   */
  phase: 'candidat' | 'solution' | 'les_deux'

  /**
   * L'ÉVALUATEUR — le cœur. Reçoit le ContexteEvaluation (ci-dessous),
   * dit si la règle est respectée, et sinon le coût (pour la somme intra-étage).
   * PURE : pas d'I/O, déterministe.
   */
  evaluer: (params: P, contexte: ContexteEvaluation) => ResultatEvaluation
}

/**
 * ContexteEvaluation (F1) — le type PIVOT : ce que reçoit TOUT évaluateur de brique.
 * Construit par le solver à chaque appel, en lecture seule. Pas d'I/O.
 */
export interface ContexteEvaluation {
  /** Le créneau en cours d'évaluation (résolu : bornes réelles, type, date civile locale). */
  creneau: CreneauResolu
  /** Phase d'appel — l'évaluateur sait s'il voit un candidat ou une solution complète. */
  phase: 'candidat' | 'solution'
  /** Phase 'candidat' : le véto candidat + le rôle visé. Absent en phase 'solution'. */
  candidat?: { vet: VetResolu; role: 'premier' | 'second' | 'couverture' }
  /** L'état du planning : partiel (phase candidat) ou complet (phase solution). */
  attributions: AttributionPartielle[]
  /** Lookback inter-périodes (~10 j) pour les règles de consécutivité (jonction de périodes). */
  contexteAnterieur: AttributionGelee[]
  /** Compteurs courants par véto (mis à jour en delta — §3.2 calcul incrémental). */
  compteurs: CompteursCourants
  /** Tous les vétos (pour les briques relationnelles : duo, couverture, ratio). */
  tousVets: VetResolu[]
  /** Fuseau de référence (E4) — pour tout calcul calendaire de la brique. */
  timezone: string
}

export interface ResultatEvaluation {
  respectee: boolean
  /** Coût de violation (≥ 0). Combiné dans l'étage de la FORCE de la règle. */
  cout: number
  /** Si bloquante (étages 0/1) : la raison, pour la trace et le diagnostic. */
  raison?: string
}
```

**Deux phases d'évaluation (F2) — quand le solver appelle quoi.** Toutes les briques ne s'évaluent pas au même moment :
- **(a) Phase `candidat` — élagage par-candidat**, pendant le backtracking, à chaque tentative d'attribution. C'est l'équivalent V2 de `isValid()` V1 (`hard-constraints.ts`). Concernées : `interdire_creneau`, `repos_conditionnel`, `duo_interdit`, `liaison_creneaux`, `inversion_role`, invariants. Elles regardent **un véto candidat + l'état partiel** et disent oui/non (+ coût) **immédiatement**, ce qui élague l'arbre tôt.
- **(b) Phase `solution` — scoring de solution complète**, une fois un planning complet construit. Concernées : `equilibrer` (variance sur tout le planning), `couverture` globale, `au_plus_n` + FENÊTRE (besoin de voir toute la fenêtre), `espacement_min`, `ratio_par_categorie`. Elles ne peuvent pas se juger sur un état partiel — il faut la solution entière.
- Le solver appelle **(a) à chaque nœud** (élagage), puis **(b) sur chaque solution complète** pour calculer son `VecteurScore` et la comparer à la meilleure courante (§3.2). Une brique déclare sa `phase` ; le solver l'aiguille. *Spec fine de l'ordonnancement (a)/(b) à confirmer au banc d'essai (§3).*

**Bibliothèque d'évaluateurs typés.** Chaque famille d'opérateur (PRD §7.2) a son évaluateur. Les contraintes dures V1 (`hard-constraints.ts` : R1, R2, R3, R6, R8, R9, R16-R21) deviennent des **instances de briques** paramétrées, plus du code en dur. La colonne **Échéance** dit quand l'évaluateur est livré : `Fond.` (Fondations) ou `Pal.1` (Palier 1).

> 🧱 **Règle de cadrage non-rétro-ajoutable (C).** Pour TOUTE brique du catalogue, même si son **évaluateur** n'arrive qu'en Palier 1, les **champs de schéma qu'elle exige** (colonnes/clés JSON non-rétro-ajoutables : tags de profil sur le véto, `borne_reelle` des créneaux, dimension de cohorte d'équité, etc.) sont **gravés dès les Fondations**. Raison : ajouter une colonne structurante après coup = migration douloureuse sur des données déjà en prod (catalogue §3). On grave le schéma tôt, on branche l'évaluateur quand son tour vient.

| Brique V2 | Remplace / source | Phase | Échéance | Paramètres clés |
|---|---|---|---|---|
| `interdire_creneau` | R1, R2 | candidat | Fond. | QUI, créneau/jour, condition QUAND (SAUF vacances) |
| `repos_conditionnel` | R3/R5 | candidat | Fond. | si_garde_we → jour A, sinon jour B |
| `duo_interdit` / `pas_ensemble` | R6 | candidat | Fond. | véto A, véto B (+ n-aire en V2) |
| `liaison_creneaux` | R9 (ven↔WE) | candidat | Fond. | créneau source, créneau lié |
| `inversion_role` | R8 | candidat | Fond. | créneau A, créneau B, inversion 1er/2nd |
| `alternance_ancre` | remplace parité ISO | candidat | Fond. | date_ancre, période, offset_decale (E5) |
| `equilibrer` | R11-R15 | solution | Fond. | dimension, force propre, quote-part |
| `au_plus_n` | nouveau, FENÊTRE obligatoire | solution | Fond. | N, fenêtre (semaine civile/glissante) |
| `espacement_min` | 🔴 catalogue §1.1 | solution | Fond. | écart minimal entre 2 gardes |
| `motif_grand_weekend` | 🔴 catalogue §1.2 | candidat | **Fond.** | fait atomique pré-câblé "garde le WE cette semaine" (corrige récursion 2 niveaux) |
| `couverture_composition_conditionnelle` | 🔴 catalogue §1.3 | solution | **Pal.1** | "si junior de garde → senior interne requis" |
| `ratio_par_categorie` / `au_plus_n_par_categorie` | 🔴 catalogue §1.3 | solution | **Pal.1** | "≤1 junior par garde", "ratio senior:junior ≥ 1:1" |
| `couverture_multi_attributs` | 🔴 catalogue §1.3 | solution | **Pal.1** | "≥1 véto interne ET senior ET habilité équine" |
| `groupe_cohorte_equite` | 🔴 catalogue §1.4 | solution | **Pal.1** | équilibrer par filière/rôle/statut (≠ total unique) |
| `multi_filieres` | 🔴 catalogue §1.4 | solution | **Pal.1** | lignes de garde parallèles (canine ‖ rurale ‖ équine) |

**Schéma gravé dès les Fondations pour ces briques Palier 1 :** `veterinaires_cabinet.tags[]` (junior/senior/interne/compétences — déjà §7), `creneaux_catalogue` (effectif/filière), et la **dimension de cohorte d'équité** sur `compteurs_config.descripteur_json` + `metric_quotas` (§7). Les évaluateurs `couverture_*`, `ratio_*`, `groupe_cohorte_equite`, `multi_filieres` arrivent en Palier 1, mais ne nécessiteront **aucune** migration de schéma à ce moment-là.

**Invariants figés (non briques).** "En congé = pas de garde" (R16) et "1er ≠ 2nd" (R21) ne sont **pas** des briques configurables : ce sont des invariants systèmes (étage 0), codés en dur, jamais exposés. C'est le statut ① du PRD §7.2.

**Ordonnancement des créneaux liés (F3) — contrat d'ordre.** En V1, R8 (inversion), R9 (liaison ven↔WE) et R21 (rôles distincts) sont **enchevêtrés** : le solver génère les steps WE *avant* la semaine (solver.ts:78-108) et la cohérence ven↔WE dépend de cet ordre implicite. Pour que le découpage en briques **reproduise** V1, on grave un **contrat d'ordre explicite** :
- Une brique `liaison_creneaux` / `inversion_role` déclare un couple **(créneau-source, créneau-lié)**. Le solver **planifie toujours le créneau-source avant le créneau-lié** (ex. vendredi soir = source, week-end = lié). L'ordre n'est plus implicite dans la génération des steps, il est **dérivé des dépendances déclarées par les briques** (tri topologique des créneaux liés).
- **Ordre stable de génération des steps depuis `creneaux_catalogue`** : tri par `(date_debut_reel, priorité_contrainte, id)` où `priorité_contrainte` place les créneaux les plus contraints (WE, fériés) d'abord — comme l'heuristique V1, mais **explicite et déterministe** (plus de dépendance à l'ordre SQL). C'est ce tri qui alimente le `resoudreContexte` trié (E3).

### 4.2 Catalogue partagé IA ↔ moteur (source unique)

Le **catalogue de briques** est une structure unique, en code, exportée à la fois vers :
- le **moteur** (qui appelle `brique.evaluer()`),
- l'**IA** (qui lit `brique.schemaParams` + `brique.rendreLangageNaturel` pour traduire/expliquer),
- l'**interface** (qui rend `brique.widget`).

```typescript
// src/engine/briques/catalogue.ts
export const CATALOGUE_BRIQUES: Record<string, Brique> = {
  interdire_creneau: { /* ... */ },
  alternance_ancre:  { /* ... */ },
  // ...
}
```

> **Pourquoi une source unique est non négociable :** si l'IA connaissait un catalogue et le moteur un autre, l'IA pourrait traduire une demande vers une brique que le moteur n'évalue pas (planning faux ou crash). En partageant **le même objet**, une brique qui existe pour l'IA existe forcément pour le moteur. Cohérent P3 et avec l'interdiction "l'IA n'invente jamais une brique" (PRD §7.8). Une brique nouvelle = une PR Git qui ajoute une entrée au catalogue (C8) — jamais du code injecté depuis la base.

### 4.3 Branchement règle-en-base → évaluateur-en-code

Le pont entre la donnée (table `regles_cabinet`) et le code (catalogue) :

```
regles_cabinet (ligne en base)
  ├── brique_id = "alternance_ancre"     ──► CATALOGUE_BRIQUES["alternance_ancre"]
  ├── params_json = { date_ancre, jour } ──► validés contre brique.schemaParams (déterministe)
  ├── force = "jamais"                    ──► mappé sur Etage.JAMAIS_USER
  └── validite_json = { date_effet, ... } ──► filtre temporel (la règle s'applique-t-elle ?)
```

La résolution (`resoudreContexte.ts`) : lit `regles_cabinet` pour le cabinet + la période, filtre par validité (date d'effet, période), **valide** chaque `params_json` contre le schéma de sa brique (rejette les règles corrompues plutôt que de crasher le solver), et produit la liste `RegleResolue[]` du `ContexteSimulation`.

```typescript
export interface RegleResolue {
  regleId: string
  brique: Brique
  params: unknown          // déjà validé contre brique.schemaParams
  etage: Etage             // dérivé de la force
  marqueurs: string[]      // ex. ["dernier_recours"]
}
```

### 4.4 La grammaire à 6 axes en structure de données

La grammaire du PRD §7.2 (`[QUI] [QUOI] [QUAND] [OPÉRATEUR] [FORCE] [VALIDITÉ]`) se matérialise dans `regles_cabinet.params_json` :

```typescript
export interface ParamsRegle {
  qui: {
    type: 'individu' | 'duo' | 'role' | 'competence' | 'marqueur'
    refs: string[]                  // ids vétos, ou code rôle/compétence
  }
  quoi: { creneaux: string[]; roles?: ('premier' | 'second' | 'couverture')[] }
  quand: ConditionQuand            // arbre composable: SAUF, OU, conditions calendaires
  // l'opérateur est porté par brique_id (chaque brique = un opérateur)
  // la force est la colonne `force` (mappée sur Etage)
  validite: {
    type: 'permanente' | 'saison' | 'periode' | 'date_effet'
    dateEffet?: string             // non rétro-applicable
    periodeId?: string
    version: number
  }
}
```

**`ConditionQuand` est un petit arbre fermé** (pas de SI…ALORS générique — PRD §7.2 : "crée des cycles de dépendance") :

```typescript
type ConditionQuand =
  | { op: 'creneau'; ref: string }
  | { op: 'type_semaine'; valeur: 'paire' | 'impaire'; ancre: string }   // ancre, pas ISO
  | { op: 'calendaire'; predicat: 'vacances' | 'ferie' | 'saison'; valeur?: string }
  | { op: 'motif'; ref: string }       // motif pré-câblé fermé (ex. "garde_we_cette_semaine")
  | { op: 'SAUF'; cond: ConditionQuand }
  | { op: 'OU'; conds: ConditionQuand[] }
```

Les **motifs pré-câblés** (PRD : "si garde le WE cette semaine" = fait atomique) sont des prédicats calculés **une fois** par le moteur et exposés comme faits de niveau 0 — ils évitent la récursion à 2 niveaux et le hack de `hard-constraints.ts:169` (le `gardeWe = slot.type === 'vendredi_soir' ? true : ...`).

### 4.5 Les 3 statuts de règles structurelles

Repris du PRD §7.2, traduits en architecture :

| Statut | Stockage | Configurable ? |
|---|---|---|
| ① **Invariants figés** | Code (étage 0), pas de ligne en base | Non, jamais exposés |
| ② **Référentiel versionné par période** | `periodes.config_json` + `creneaux_catalogue` + `veterinaires_cabinet` (liés à une période) | Oui, mais un changement ne s'applique qu'à la **prochaine** période (les compteurs passés restent figés — règle §4-7 du catalogue) |
| ③ **Conventions locales on/off** | `regles_cabinet` (briques `liaison_creneaux`, `inversion_role`) avec exceptions via `ConditionQuand.SAUF` | Oui, activables/désactivables, exceptions nommées (ex. "SAUF Pâques") |

---

## 5. Le ledger et les compteurs

### 5.1 Structure du ledger (mouvements datés)

**Le principe (doc compteurs §4).** Un compteur n'est pas un chiffre stocké, c'est une **projection** d'un registre d'événements. Une seule source pour l'équité, les soldes de fin de période, les dettes/créances de crise et les droits à congés. C'est la résolution structurelle du risque R2 ("le registre d'équité et les dettes de crise risquent de diverger") : *s'il n'y a qu'un ledger, ils ne peuvent pas diverger*.

> **Event-sourcing léger.** On ne stocke pas seulement "Manon a 4 WE". On stocke chaque **fait daté** : "le 10/01, Manon, +1 garde WE en 1er, période P, génération G". Le chiffre "4 WE" est une **somme** recalculée à la lecture, jamais matérialisée intra-période. Avantage : traçable, rejouable, et aucune désync possible.
>
> 🏷️ **Nommage canonique (D).** Le PRD §10 emploie `ledger` / `type_mouvement` / `valeur` ; l'archi est la **référence** et fige : table **`ledger_events`**, colonne **`type_evt`**, colonne **`delta`**. De même, le descripteur de compteur est la table **`compteurs_config`** (nom canonique) — *`metric_definitions` du doc compteurs §4 en est un alias informel, à ne pas créer comme seconde table.* Les noms de l'archi priment partout dans le code.

> ✅ **DÉCISION ACTÉE (MiKL, 2026-06-16) — Event-sourcing HYBRIDE.** Faits datés (`ledger_events`, immuables) **+ projections matérialisées `metric_balances` figées en fin de période** pour le report inter-période. Les soldes de fin de période sont figés et matérialisés (ils "voyagent" d'une période à l'autre et doivent être stables) ; tout le reste (compteurs intra-période) est dérivé à la volée, jamais matérialisé. C'est exactement la ligne de partage "Calculé vs persisté" du doc compteurs §4. On ne va PAS vers l'event-sourcing strict (tout-événement) : plus lourd sans bénéfice ici, le report figé suffit à la traçabilité et à la rejouabilité.

```sql
CREATE TABLE ledger_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    UUID NOT NULL REFERENCES cabinets(id),
  veterinaire_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  metric_def_id UUID REFERENCES compteurs_config(id),  -- à quelle métrique ce fait contribue
  periode_id    UUID REFERENCES periodes(id),
  type_evt      TEXT NOT NULL CHECK (type_evt IN (
                  'charge', 'equite', 'conges', 'crise_depannage',
                  'ajustement_import', 'compensation', 'correction')),
  delta         NUMERIC NOT NULL,           -- non arrondi (biais mi-temps sinon)
  unite         TEXT NOT NULL,              -- 'garde' | 'jour' | 'we' | 'euro' | 'booleen'
  attribution_id UUID REFERENCES attributions(id),  -- lien vers le fait source
  compensation_id UUID REFERENCES compensations(id),
  corrige_event_id UUID REFERENCES ledger_events(id),  -- pour type_evt='correction' : l'event corrigé
  generation_id UUID,                       -- quelle génération a produit ce fait
  date_reference DATE NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ledger_cab_vet_metric ON ledger_events (cabinet_id, veterinaire_id, metric_def_id);
-- 🔒 ledger_events est APPEND-ONLY : aucun UPDATE/DELETE (voir protocole de correction E1).
```

**Pièges multi-tenant (doc compteurs §4).** `cabinet_id` dans chaque index unique (collision de clés sinon) ; pas de vue cross-cabinet (la vue V1 `compteurs_gardes` fait un `CROSS JOIN` sans filtre tenant = **fuite en multi**, à supprimer) ; l'import entre comme `type_evt = ajustement_import` (jamais une 2ᵉ source) ; `delta` en `numeric` non arrondi.

**🔒 Correction d'un fait passé (E1) — append-only, jamais UPDATE/DELETE.** Un `ledger_event` est **immuable**. On ne corrige JAMAIS un fait en le modifiant ou le supprimant (ça réécrirait l'histoire et casserait la rejouabilité). Pour corriger une erreur : on **ajoute un événement compensatoire** `type_evt = 'correction'` (avec `corrige_event_id` pointant le fait erroné, et un `delta` qui annule ou ajuste). Garanti côté base : RLS sans policy UPDATE/DELETE pour `authenticated` sur `ledger_events` (écriture = INSERT seul). Protocole de re-figeage :
- **Cascade interdite.** Si la correction touche une période **déjà clôturée** (dont les `metric_balances` sont figés), on **NE recalcule PAS** rétroactivement les soldes figés des périodes passées (sinon effet domino sur toutes les périodes suivantes). La correction **part en N+1** : son `delta` est intégré au solde d'**ouverture** de la prochaine période non figée. Les balances figées restent la photo de ce qui a été décidé à l'époque (cohérent §10 : pas de rétroactivité silencieuse).
- **Période courante (non figée) :** la correction est simplement un événement de plus, repris dans la projection à la volée.

**Requête canonique de projection (E1) — bornes exactes, anti-double-comptage.** La projection "solde net par (véto, métrique)" sur une fenêtre se calcule avec des **bornes de période demi-ouvertes** `[date_debut, date_fin_exclusive)` pour ne jamais compter deux fois un fait à la jonction de deux périodes (piège de la dette de crise qui chevauche) :

```sql
-- Solde net d'une métrique pour les vétos d'un cabinet, sur une fenêtre [debut, fin) :
SELECT veterinaire_id, SUM(delta) AS solde_net
FROM ledger_events
WHERE cabinet_id = $cabinet_id
  AND metric_def_id = $metric_def_id
  AND date_reference >= $debut          -- borne basse INCLUSIVE
  AND date_reference <  $fin            -- borne haute EXCLUSIVE (jamais <=)
GROUP BY veterinaire_id;
-- Les corrections (type_evt='correction') sont incluses dans le SUM comme tout autre delta.
-- Le solde d'OUVERTURE d'une période = metric_balances figé de la période précédente
-- (PAS un re-SUM de tout l'historique : ça intègre déjà les corrections cascadées en N+1).
```

### 5.2 Compteurs = projections déclaratives (les 9 propriétés)

Un compteur est un **descripteur** (doc compteurs §1, les 9 propriétés) stocké dans `compteurs_config`. Le "moteur de métriques" évalue n'importe quel descripteur sur le ledger + le planning :

```typescript
export interface DescripteurCompteur {
  source: 'planning' | 'ledger' | 'import' | 'referentiel'   // 1
  filtre: FiltreEvenement                                     // 2 (enums fermés, partagés avec briques)
  unite: string; sens: 'mieux' | 'pire' | 'neutre' | 'cible' // 3
  dimensions: ('vet' | 'type_creneau' | 'cabinet')[]         // 4
  fenetre: 'periode' | 'saison' | 'annee_cycle' | 'glissante' | 'permanente' // 5 — V2: 'periode'+'annee_cycle' réelles ; 'saison'/'glissante'/'permanente' = not implemented (G2)
  agregation: 'somme' | 'moyenne' | 'variance' | 'ecart_max_min' | 'comptage' // 6 — les 5 sont réelles en V2 (G2)
  cible: CibleCompteur                                        // 7 (quote-part, quota, pondération mi-temps)
  seuils: { ok: number; attention: number; critique: number } // 8
  report: 'aucun' | 'solde_cumule' | 'raz'                    // 9
  // + 3 attributs produit
  estDimensionOptimisation: boolean    // ce compteur entre-t-il dans le score solver ?
  visibleVeto: boolean                 // l'admin ouvre (ou non) ce compteur aux vétos — flux DESCENDANT (le véto ne demande jamais)
  statut: 'actif' | 'inactif'          // l'admin l'a-t-il ajouté à SON tableau de bord (compteur actif du cabinet) ?
}
```

**CHARGE et ÉQUITÉ ne sont pas deux objets** (doc compteurs §1) : l'équité *pointe vers* la charge (`base = we_total, agrégation = variance`). Une seule définition de "ce qu'est un week-end de garde", deux lectures. Concrètement, les 7 fonctions `desequilibre*` de `rules/optimization.ts` (qui sont chacune `variance(...)` sur un compteur) deviennent **une** fonction `agreger(descripteur, ledger)` paramétrée.

**Frontière affiché / optimisé (`est_dimension_optimisation`).** Tout compteur est *affichable* sans risque. Seuls ceux marqués `estDimensionOptimisation = true` entrent dans `VecteurScore` (l'étage ÉQUITÉ) — et exigent alors une **force**, une **quote-part** et une validation déterministe. Garde-fou contre le retour du bug additif (trop de dimensions d'optim = moteur paralysé). Promouvoir une métrique en dimension d'optim est un **acte délibéré** de l'admin.

> 🪶 **Dé-goldplating du moteur de métriques (G2).** Le descripteur *décrit* 9 propriétés, mais la V2 n'**implémente** que ce qui sert vraiment : **5 agrégations réelles** (somme, variance, comptage, écart-max-min, moyenne) et **2 fenêtres réelles** (`periode`, `annee_cycle` — cette dernière pour le cycle de congés 1er oct→30 sept). Les fenêtres `saison`, `glissante`, `permanente` et les axes de dimension niche sont déclarés **"not implemented"** explicitement (le descripteur accepte la valeur, le moteur renvoie une erreur claire "non supporté en V2"). On grave la *forme* généraliste sans coder des agrégations dont aucun cabinet n'a besoin aujourd'hui.

**Visibilité = flux strictement DESCENDANT (décision MiKL 2026-06-16).** Le cabinet pioche dans un **catalogue large** de descripteurs (jamais figé sur le pilote — chaque cabinet veut autre chose). (1) L'admin **compose son propre tableau** en activant les compteurs voulus (`statut = actif`). (2) Il **ouvre case par case** ceux que les vétos voient (`visibleVeto`). (3) Le véto **consulte seulement** — il ne choisit ni ne réclame jamais une colonne. **Aucun flux remontant.** Le catalogue de descripteurs doit donc être fourni dès le départ : c'est lui qui rend chaque cabinet autonome.

### 5.3 Équité et dettes de crise : une seule source

```
                    ┌──────────────────┐
                    │  ledger_events   │  ◄── LA source unique
                    └────────┬─────────┘
        ┌──────────┬─────────┼──────────┬───────────────┐
        ▼          ▼         ▼          ▼               ▼
   Compteurs   Équité     Soldes     Dettes/        Droits CP
   affichés   (solver)   fin période  créances      (cycle 1er oct)
   (somme)    (variance)  (figés)     crise          (source ledger
                                      (type_evt:      + référentiel)
                                      crise_depannage)
```

Quand un véto dépanne (crise) : `+1 créance` pour le remplaçant, `+1 dette` pour le remplacé — **deux `ledger_events` de type `compensation`**. Le solver de la période suivante lit la projection nette ; aucune table séparée. C'est ce qui désarme R2 par construction.

---

## 6. Multi-tenant et sécurité

### 6.1 Modèle d'isolation (cabinet_id + RLS)

**Évolution depuis V1.** La RLS V1 (`003_rls.sql`) repose sur `get_user_role()` et `get_veterinaire_id()` (fonctions SECURITY DEFINER qui lisent `veterinaires.user_id = auth.uid()`), **sans aucun `cabinet_id`**. Elle est mono-tenant. En V2, on ajoute la dimension cabinet à chaque policy.

**Stratégie retenue : `cabinet_id` via claim JWT.** Le `cabinet_id` du user est injecté dans le JWT Supabase (custom claim, posé à la connexion). La policy lit le claim — pas de sous-requête vers `veterinaires_cabinet` à chaque ligne (performant, et le claim est signé donc non falsifiable). **Mais la non-falsifiabilité repose entièrement sur la chaîne de confiance ci-dessous : un claim mal posé = isolation forgeable.**

**🔒 C1 — Chaîne de confiance du claim (gravée, non négociable).** Le claim `cabinet_id` ne vaut que s'il est **impossible à forger par le user**. Quatre règles :

1. **`cabinet_id` + `role` vivent dans `app_metadata`, JAMAIS dans `user_metadata`.** `user_metadata` est modifiable par le user lui-même (`supabase.auth.updateUser({ data })`) → s'isoler dessus rendrait l'isolation forgeable. `app_metadata` n'est écrit **que** par le `service_role`, au bootstrap/onboarding (§6.4). Le user ne peut pas le modifier.
2. **Si Custom Access Token Hook**, le hook **lit la table serveur** `veterinaires_cabinet` (source de vérité) pour déterminer le `cabinet_id` à injecter — **jamais** une valeur fournie par le client ni recopiée depuis `user_metadata`.
3. **`auth_cabinet_id()` lit le chemin explicite** `auth.jwt() -> 'app_metadata' ->> 'cabinet_id'`, pas la racine du JWT (la racine pourrait être polluée par des claims client).
4. **Suspension d'un cabinet :** MiKL peut suspendre un cabinet (`cabinets.statut = 'suspendu'`), mais le JWT déjà émis garde un état périmé jusqu'à son expiration (~1h). La policy ne se contente donc PAS du claim : elle vérifie aussi `cabinet.statut = 'actif'` côté serveur (fonction `STABLE`), sinon il faut révoquer la session. Pas seulement au login.

```sql
-- Fonction utilitaire : cabinet du user connecté.
-- Lit le chemin app_metadata explicite (jamais la racine du JWT, jamais user_metadata).
-- STABLE et SQL pur : elle lit le JWT, pas la base → PAS de SECURITY DEFINER nécessaire (C2).
CREATE OR REPLACE FUNCTION auth_cabinet_id() RETURNS UUID
  LANGUAGE sql STABLE
  SET search_path = ''                       -- search_path figé (C2)
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'cabinet_id', '')::uuid;
$$;

-- Cabinet actif ? (couvre la suspension malgré un JWT périmé — C1 point 4)
CREATE OR REPLACE FUNCTION auth_cabinet_actif() RETURNS BOOLEAN
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cabinets
    WHERE id = auth_cabinet_id() AND statut = 'actif'
  );
$$;

-- Policy type, appliquée à CHAQUE table métier :
CREATE POLICY "tenant_isolation" ON regles_cabinet
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_id() AND auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_id() AND auth_cabinet_actif());
```

**Défense en profondeur.** En complément du claim JWT, un trigger `BEFORE INSERT` force `cabinet_id = auth_cabinet_id()` (un user ne peut pas écrire dans un autre cabinet même en trichant sur le payload). `cabinet_id` est `NOT NULL` partout.

**🧪 Test E2E adversarial obligatoire (gate, à chaque migration).** Un user authentifié du cabinet A appelle `supabase.auth.updateUser({ data: { cabinet_id: <cabinet_B> } })` (tentative d'écraser son propre claim via `user_metadata`), puis tente de lire `regles_cabinet` / `attributions` du cabinet B → **doit retourner 0 ligne**. Ce test prouve que l'isolation ne dépend pas d'une valeur que le user contrôle. Tant qu'il n'est pas vert, aucune migration multi-tenant ne passe le gate CERBÈRE.

> ✅ **DÉCISION ACTÉE (MiKL, 2026-06-16) — claim JWT** (plutôt que la sous-requête `cabinet_id IN (SELECT ... WHERE user_id = auth.uid())`). Un véto appartient à un seul cabinet et le claim est posé une fois à la connexion — la jointure par ligne de la sous-requête n'apporterait rien ici. Le coût (hook d'auth + re-login si changement de cabinet, rare) est accepté. **Gate CERBÈRE obligatoire** : audit RLS à chaque migration, test E2E "le cabinet A ne lit jamais une ligne du cabinet B".

### 6.2 Règle d'architecture — fonctions `SECURITY DEFINER` (🔒 C2)

**Le piège hérité de V1.** Les fonctions V1 `get_user_role()` et `get_veterinaire_id()` (`003_rls.sql`) sont `SECURITY DEFINER` et lisent `veterinaires` **sans aucun filtre cabinet**. Inoffensif en mono-tenant ; en V2 multi-tenant, une fonction DEFINER qui ignore le cabinet contourne la RLS (elle s'exécute avec les droits du *propriétaire*, pas de l'appelant) → **fuite cross-tenant**.

**Règle gravée pour toute la V2 :**

1. **Toute fonction `SECURITY DEFINER` filtre explicitement par `auth_cabinet_id()` dans son corps.** Une fonction DEFINER ne doit jamais retourner de donnée d'un autre cabinet que celui du JWT de l'appelant. Si elle n'a pas besoin de privilèges élevés (cas de `auth_cabinet_id()` qui ne lit que le JWT), elle est **`SECURITY INVOKER`** (le défaut) — on ne met DEFINER que quand c'est strictement nécessaire.
2. **`search_path` figé** (`SET search_path = ''` ou schéma explicite) sur **chaque** fonction DEFINER — comme la migration V1 `011_functions_search_path.sql`. Sans ça, un schéma malveillant dans le `search_path` peut détourner un appel de fonction.
3. **Minimiser les DEFINER.** Chaque DEFINER est une porte qui contourne la RLS : moins il y en a, plus la surface est petite.
4. **Inventaire obligatoire en revue (gate à chaque migration).** Lister **chaque** fonction `SECURITY DEFINER` de la base + prouver, ligne à ligne, qu'elle filtre par `auth_cabinet_id()` (ou qu'elle ne touche aucune donnée tenant). CERBÈRE bloque toute migration qui introduit une DEFINER non justifiée ou non filtrée.

> En V2, `get_user_role()` / `get_veterinaire_id()` sont **réécrites** : soit en `INVOKER` lisant le claim JWT, soit en DEFINER filtrées par `auth_cabinet_id()` + `search_path` figé. La version V1 (DEFINER sans filtre cabinet) est **interdite**.

### 6.3 Console super-admin MPP (service_role)

La console MiKL (PRD §7.7) utilise un **rôle séparé**, jamais le rôle `authenticated` d'un cabinet :
- Accès **métadonnées seulement** : `cabinets` (nom, statut, nb vétos, date onboarding), métriques globales agrégées (nb plannings, taux d'erreur).
- **Aucun accès** aux données métier (règles, noms vétos, plannings, carnet). Garanti par : les requêtes de la console ne touchent **que** la table `cabinets` et des vues d'agrégat *anonymisées* ; le `service_role` n'est utilisé que dans des Edge Functions back-office, jamais exposé au navigateur.
- Secret du `service_role` : variable d'environnement Vercel uniquement, **jamais** en clair, **jamais** côté client (règle sécurité MPP). Branchement Supabase MCP par projet (jamais global).

### 6.4 Bootstrap d'un cabinet + 1er admin

Le problème classique de l'œuf et la poule : RLS exige un `cabinet_id`, mais le 1er admin n'existe pas encore. Flux (PRD §11.1, back-office) :

```
1. MiKL (console MPP, service_role) crée la ligne `cabinets` → cabinet_id généré.
2. MiKL invite l'admin par email (Supabase Auth invite). Le service_role écrit
   cabinet_id + role='admin' dans app_metadata (JAMAIS user_metadata — C1).
3. À la première connexion, le claim app_metadata.cabinet_id est présent dans le JWT.
   (Si Custom Access Token Hook : il LIT veterinaires_cabinet, pas la valeur d'invitation.)
4. Un trigger crée la ligne `veterinaires_cabinet` (user_id = auth.uid(), role=admin)
   reliée au cabinet_id.
5. L'admin arrive sur le setup guidé → il peut désormais tout écrire dans SON cabinet (RLS OK).
```

C'est l'évolution propre du bootstrap V1 (cf. mémoire `bootstrap-premier-admin.md` : 1er admin relié à la main). En V2, l'opération est outillée par la console, plus manuelle.

### 6.5 Tables de référence partagées — écriture verrouillée (🔒 C3)

Trois tables sont **partagées entre tous les cabinets** (pas de `cabinet_id`) : `briques_regles` (catalogue de code), `jours_feries`, `vacances_scolaires`. Elles sont **lues par tous** → si leur écriture est trop large, un admin/véto d'un cabinet **corrompt la donnée vue par tous les autres cabinets**. C'est une fuite d'intégrité inter-tenant, pas de confidentialité, mais tout aussi grave (un admin du cabinet A qui modifie les fériés casse les plannings de B). Règle gravée :

- **`briques_regles`** : RLS **activée**. Policy `SELECT` pour `authenticated`. **Aucune** policy `INSERT`/`UPDATE`/`DELETE` pour `authenticated` → l'écriture est réservée aux migrations et au `service_role`. Cohérent avec le principe « une nouvelle brique = une PR Git, jamais du code injecté depuis la base » (§4.2).
- **`jours_feries` / `vacances_scolaires`** : on **retire le `admin_write` hérité de V1** (`003_rls.sql` autorisait `get_user_role() = 'admin'` en écriture — acceptable en mono-cabinet, dangereux en multi). RLS activée, `SELECT` pour `authenticated`, écriture réservée au **back-office** (migrations / `service_role` qui rechargent fériés et vacances chaque été par zone/région).

Le DDL et les policies correspondantes sont en §7.

### 6.6 Points 🟠 moyens à traiter au dev (ruflo)

Deux garanties que CERBÈRE n'élève pas au 🔴 critique mais qui doivent être implémentées au dev (à ne pas oublier dans les stories) :

- **(a) Identité super-admin prouvée DANS l'Edge Function.** Le `service_role` donne tous les droits mais **n'est pas une preuve d'identité** : c'est une clé serveur, pas « MiKL est connecté ». Toute Edge Function de la console MPP (§6.3) doit d'abord **vérifier que l'appelant est bien super-admin** — via une table `super_admins(user_id)` ou un claim dédié `app_metadata.is_super_admin` — **avant** d'utiliser le `service_role`. Sinon, n'importe quel appel authentifié atteignant l'Edge Function hériterait des super-pouvoirs.
- **(b) Validation déterministe de la sortie IA scopée tenant.** La barrière anti-hallucination (§8) doit valider non seulement la *syntaxe* mais aussi l'*appartenance tenant* : un `veterinaire_id` ou un `creneau_id` halluciné qui appartiendrait à un **autre** cabinet doit **échouer** la validation (vérif que chaque réf appartient à `auth_cabinet_id()`). Et le LLM ne reçoit **jamais** en contexte les règles, noms ou créneaux d'autres tenants — le prompt est construit côté serveur, strictement scopé au cabinet de l'appelant (§8).

### 6.7 Portes ouvertes V3 (groupement_id, type_presence)

Deux colonnes **gravées vides** dès les Fondations (non-rétro-ajoutables — catalogue §3) :
- `cabinets.groupement_id UUID NULL` — mutualisation inter-cabinets V3. Zéro code de mutualisation en V2 ; la colonne existe pour ne pas migrer plus tard.
- `creneaux_catalogue.type_presence TEXT DEFAULT 'sur_place'` — astreinte téléphonique V3. Le vocabulaire entre, la feature suit.

---

## 7. Schéma de données complet

> Tables **structurantes** (pas le DDL exhaustif). Toute table métier a `cabinet_id NOT NULL` + RLS `tenant_isolation`. Index uniques incluent toujours `cabinet_id`.

```sql
-- ── CABINETS (tenant racine) ──────────────────────────────
CREATE TABLE cabinets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom           TEXT NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu')),
  groupement_id UUID NULL,                          -- V3 (vide)
  zone_scolaire TEXT,                               -- F3 : vacances par zone
  region_feries TEXT,                               -- F3 : fériés par région
  timezone      TEXT NOT NULL DEFAULT 'Europe/Paris',
  config_onboarding JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- RLS : service_role (console MPP) en lecture métadonnées ; pas d'accès cabinet croisé.

-- ── VÉTÉRINAIRES (par cabinet) ────────────────────────────
CREATE TABLE veterinaires_cabinet (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    UUID NOT NULL REFERENCES cabinets(id),
  user_id       UUID REFERENCES auth.users(id),    -- NULL tant que pas connecté
  nom           TEXT NOT NULL,
  prenom        TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'veto' CHECK (role IN ('admin','veto')),
  quote_part    NUMERIC NOT NULL DEFAULT 1.0,       -- mi-temps = 0.5, etc.
  date_entree   DATE,                               -- proratisation (catalogue §3)
  date_sortie   DATE,                               -- départ daté, jamais actif=false brut
  tags          TEXT[] DEFAULT '{}',                -- ['junior','equine',...]
  marqueur_externe          BOOLEAN DEFAULT false,  -- remplaçant planifiable
  marqueur_dernier_recours  BOOLEAN DEFAULT false,  -- ex-Anne-Cat
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX uq_vet_user_cab ON veterinaires_cabinet (cabinet_id, user_id);

-- ── PÉRIODES (référentiel versionné) ──────────────────────
CREATE TABLE periodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    UUID NOT NULL REFERENCES cabinets(id),
  nom           TEXT,
  saison        TEXT CHECK (saison IN ('ete','hiver')),
  date_debut    DATE NOT NULL,                      -- toujours un lundi (invariant)
  date_fin      DATE NOT NULL,
  longueur_rotation INTEGER,                         -- N semaines
  config_json   JSONB DEFAULT '{}',                 -- effectifs par créneau, vétos actifs, options
  statut        TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','publie','verrouille')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT debut_lundi CHECK (EXTRACT(DOW FROM date_debut) = 1)
);

-- ── CATALOGUE DE CRÉNEAUX (par cabinet) ───────────────────
CREATE TABLE creneaux_catalogue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID NOT NULL REFERENCES cabinets(id),
  nom             TEXT NOT NULL,                     -- "Week-end principal", "Samedi nuit"
  type_presence   TEXT NOT NULL DEFAULT 'sur_place' CHECK (type_presence IN ('sur_place','astreinte')),
  borne_debut_offset INTERVAL,                       -- intervalle réel (WE = sam 8h → lun 8h)
  borne_fin_offset   INTERVAL,
  effectif_poste  INTEGER NOT NULL DEFAULT 1,        -- nb de postes à pourvoir
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── BRIQUES (catalogue de code, MUTUALISÉ — pas de cabinet_id) ──
CREATE TABLE briques_regles (
  id          TEXT PRIMARY KEY,                      -- ex. "alternance_ancre"
  famille     TEXT NOT NULL,
  operateur   TEXT NOT NULL,
  schema_json JSONB NOT NULL,                        -- miroir lecture de brique.schemaParams
  version     INTEGER NOT NULL DEFAULT 1
);
-- Table de RÉFÉRENCE PARTAGÉE (pas de cabinet_id). L'évaluateur reste en code.
-- 🔒 C3 : RLS activée, lecture seule pour authenticated, ÉCRITURE INTERDITE côté app.
ALTER TABLE briques_regles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "briques_read_all" ON briques_regles
  FOR SELECT TO authenticated USING (true);
-- AUCUNE policy INSERT/UPDATE/DELETE pour authenticated :
-- l'écriture passe exclusivement par migrations / service_role (= PR Git, jamais depuis la base).

-- ── RÈGLES DU CABINET (la donnée) ─────────────────────────
CREATE TABLE regles_cabinet (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    UUID NOT NULL REFERENCES cabinets(id),
  periode_id    UUID REFERENCES periodes(id),        -- NULL = permanente
  brique_id     TEXT NOT NULL REFERENCES briques_regles(id),
  params_json   JSONB NOT NULL,                      -- QUI/QUOI/QUAND (ParamsRegle)
  force         TEXT NOT NULL CHECK (force IN
                  ('invariant','reglementaire','jamais','sauf_crise','evitee','si_possible')),
  validite_json JSONB NOT NULL,                      -- {type, date_effet, version}
  version       INTEGER NOT NULL DEFAULT 1,          -- incrémentale, jamais rétro-appliquée
  actif         BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES veterinaires_cabinet(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE POLICY "tenant_isolation" ON regles_cabinet FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id());

-- ── PLANNINGS (vérité canonique) ──────────────────────────
CREATE TABLE plannings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id           UUID NOT NULL REFERENCES cabinets(id),
  periode_id           UUID NOT NULL REFERENCES periodes(id),
  statut               TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','publie')),
  snapshot_regles_id   UUID REFERENCES snapshots_regles(id),
  score_lexico_json    JSONB,                        -- VecteurScore de la solution retenue
  trace_json           JSONB,                        -- TraceSimulation (le "pourquoi")
  hash_entree          TEXT,                         -- preuve de rejouabilité
  generation_id        UUID,
  created_at           TIMESTAMPTZ DEFAULT now(),
  publie_at            TIMESTAMPTZ
);

-- ── ATTRIBUTIONS (vérité complète d'un créneau — F1) ──────
CREATE TABLE attributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID NOT NULL REFERENCES cabinets(id),
  planning_id     UUID NOT NULL REFERENCES plannings(id),
  creneau_id      UUID NOT NULL REFERENCES creneaux_catalogue(id),
  date_debut_reel TIMESTAMPTZ NOT NULL,              -- intervalle RÉEL persisté (F1)
  date_fin_reel   TIMESTAMPTZ NOT NULL,
  veterinaire_id  UUID REFERENCES veterinaires_cabinet(id),  -- NULL = trou (honnête)
  role            TEXT NOT NULL CHECK (role IN ('premier','second','couverture')),
  type_presence   TEXT NOT NULL DEFAULT 'sur_place',
  est_externe     BOOLEAN DEFAULT false,             -- remplaçant carnet
  source          TEXT NOT NULL DEFAULT 'moteur' CHECK (source IN ('moteur','manuel','crise')),
  regles_appliquees UUID[],                          -- refs des règles qui l'ont produit
  created_at      TIMESTAMPTZ DEFAULT now()
);
-- ⚠️ TOUS les attributs sont ici. Plus jamais "le vendredi recalculé par 3 couches" (bug R8).

-- ── SNAPSHOTS DE RÈGLES (rejouabilité — F8) ───────────────
CREATE TABLE snapshots_regles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id  UUID NOT NULL REFERENCES cabinets(id),
  planning_id UUID REFERENCES plannings(id),
  regles_json JSONB NOT NULL,         -- photo complète des règles actives + leurs params + versions
  metriques_json JSONB,               -- photo des définitions de compteurs (idem)
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── LEDGER (cf. §5) ───────────────────────────────────────
-- DDL de ledger_events : voir §5.1. metric_balances + compteurs_config + metric_quotas ci-dessous.
-- 🔒 ledger_events / metric_balances : RLS tenant + ledger_events APPEND-ONLY (pas d'UPDATE/DELETE).
ALTER TABLE ledger_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_select"  ON ledger_events  FOR SELECT TO authenticated USING (cabinet_id = auth_cabinet_id() AND auth_cabinet_actif());
CREATE POLICY "ledger_insert"  ON ledger_events  FOR INSERT TO authenticated WITH CHECK (cabinet_id = auth_cabinet_id() AND auth_cabinet_actif());
-- PAS de policy UPDATE/DELETE sur ledger_events → correction = nouvel event type_evt='correction' (E1).
CREATE POLICY "balances_tenant" ON metric_balances FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id());

CREATE TABLE compteurs_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id  UUID NOT NULL REFERENCES cabinets(id),
  nom         TEXT NOT NULL,
  descripteur_json JSONB NOT NULL,                   -- les 9 propriétés (DescripteurCompteur)
  est_dimension_optimisation BOOLEAN DEFAULT false,
  force       TEXT,                                  -- requis SSI est_dimension_optimisation
  visible_veto BOOLEAN DEFAULT false,                -- l'admin ouvre ce compteur aux vétos (flux descendant ; le véto ne demande jamais)
  version     INTEGER DEFAULT 1,
  effet_debut DATE, effet_fin DATE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE metric_balances (                       -- projection figée pour le report
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  veterinaire_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  metric_def_id UUID NOT NULL REFERENCES compteurs_config(id),
  periode_id UUID NOT NULL REFERENCES periodes(id),
  solde_net  NUMERIC NOT NULL,                       -- en FRACTION de quote-part (D-R3)
  fige_le    TIMESTAMPTZ,
  UNIQUE (cabinet_id, veterinaire_id, metric_def_id, periode_id)
);

-- metric_quotas (A4) — quote-part d'un véto pour une métrique d'optimisation, par période.
-- Proratisation mi-temps + dettes en FRACTION de quote-part (D-R3 : jamais en nombre absolu).
CREATE TABLE metric_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  veterinaire_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  metric_def_id UUID NOT NULL REFERENCES compteurs_config(id),
  periode_id UUID REFERENCES periodes(id),           -- NULL = quote-part par défaut du véto
  quote_part NUMERIC NOT NULL DEFAULT 1.0,           -- mi-temps = 0.5, jeune "veut plus" > 1.0
  effet_debut DATE, effet_fin DATE,
  UNIQUE (cabinet_id, veterinaire_id, metric_def_id, periode_id)
);
ALTER TABLE metric_quotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotas_tenant" ON metric_quotas FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id());

-- ── CONGÉS & MOTEUR DE SOLDES PARAMÉTRABLE (B — besoin n°1 cabinet) ──
-- regimes_conges : un cabinet peut avoir PLUSIEURS régimes cohabitants en parallèle
-- (ex. associés 10 sem / salariés 6 sem). 3 axes NON-RÉTRO-AJOUTABLES : cycle, unité, régime.
CREATE TABLE regimes_conges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  nom TEXT NOT NULL,                                 -- "Associés", "Salariés"
  -- AXE NON-RÉTRO 1 : cycle (fenêtre annuelle de droits)
  cycle_debut_mois SMALLINT NOT NULL DEFAULT 10,     -- 10 = 1er octobre (pilote)
  cycle_debut_jour SMALLINT NOT NULL DEFAULT 1,
  -- AXE NON-RÉTRO 2 : unité de décompte
  unite TEXT NOT NULL DEFAULT 'jour' CHECK (unite IN ('jour','semaine','demi_journee')),
  -- config souple (rétro-ajoutable)
  mode_comptage TEXT NOT NULL DEFAULT 'ouvre' CHECK (mode_comptage IN ('ouvre','ouvrable','calendaire')),
  dotation_defaut NUMERIC NOT NULL,                  -- ex. 70 (j) associés, 42 (j) salariés
  report_cycle TEXT DEFAULT 'perdu' CHECK (report_cycle IN ('perdu','reporte','plafonne')),
  autorise_negatif BOOLEAN DEFAULT true,             -- solde de congés peut passer en dette (affiché)
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Rattachement véto → régime (AXE NON-RÉTRO 3 : régimes cohabitants en parallèle).
-- dotation_perso surcharge dotation_defaut du régime si non NULL (un véto peut avoir sa propre dotation).
CREATE TABLE veterinaire_regime_conges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  veterinaire_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  regime_id UUID NOT NULL REFERENCES regimes_conges(id),
  dotation_perso NUMERIC,                            -- NULL = hérite dotation_defaut du régime
  effet_debut DATE, effet_fin DATE,
  UNIQUE (cabinet_id, veterinaire_id, regime_id)
);
-- Le SOLDE de congés n'est PAS stocké : c'est une projection (dotation - congés posés sur le cycle),
-- lue depuis ledger_events (type_evt='conges') + le régime (source 'ledger'+'referentiel', §5.2).
-- Solde négatif = dette de congés, affichée explicitement (PRD §7.5).
ALTER TABLE regimes_conges ENABLE ROW LEVEL SECURITY;
ALTER TABLE veterinaire_regime_conges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regimes_tenant" ON regimes_conges FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id());
CREATE POLICY "vet_regime_tenant" ON veterinaire_regime_conges FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id());

-- conges (A3) — congés/indispos posés (la pose ; le solde se dérive du ledger ci-dessus).
CREATE TABLE conges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  veterinaire_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  date_debut DATE NOT NULL, date_fin DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('vacances','formation','sante','autre','indisponibilite')),
  statut TEXT NOT NULL DEFAULT 'souhait' CHECK (statut IN ('souhait','valide','refuse')),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE conges ENABLE ROW LEVEL SECURITY;
-- Admin : tout sur son cabinet. Véto : lecture des siens + pose de ses souhaits (repris du modèle V1 003_rls).
CREATE POLICY "conges_admin" ON conges FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id() AND get_user_role() = 'admin')
  WITH CHECK (cabinet_id = auth_cabinet_id() AND get_user_role() = 'admin');
CREATE POLICY "conges_veto_own" ON conges FOR SELECT TO authenticated
  USING (cabinet_id = auth_cabinet_id() AND veterinaire_id = get_veterinaire_id());
CREATE POLICY "conges_veto_pose" ON conges FOR INSERT TO authenticated
  WITH CHECK (cabinet_id = auth_cabinet_id() AND veterinaire_id = get_veterinaire_id() AND statut = 'souhait');

-- ── CRISE ─────────────────────────────────────────────────
CREATE TABLE crise_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  veterinaire_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  planning_id UUID REFERENCES plannings(id),
  type TEXT CHECK (type IN ('courte','longue','immediate','anticipee')),
  date_debut DATE, date_fin DATE, motif TEXT,
  statut TEXT DEFAULT 'ouverte' CHECK (statut IN ('ouverte','en_cours','resolue')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE compensations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  crise_absence_id UUID REFERENCES crise_absences(id),
  remplacant_id UUID REFERENCES veterinaires_cabinet(id),
  remplace_id   UUID REFERENCES veterinaires_cabinet(id),
  proposition_json JSONB,
  statut TEXT DEFAULT 'proposition' CHECK (statut IN ('proposition','accord','officiel')),
  validated_by UUID, validated_at TIMESTAMPTZ
);

CREATE TABLE carnet_remplacants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  nom TEXT NOT NULL, contact TEXT,
  specialites TEXT[], notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE carnet_remplacants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carnet_tenant" ON carnet_remplacants FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id());
-- RLS tenant pareil sur crise_absences et compensations (omis ci-dessus pour la concision) :
--   USING (cabinet_id = auth_cabinet_id()) WITH CHECK (cabinet_id = auth_cabinet_id()).

-- ── NOTIFICATIONS (A2 — le KIT notif : table + Realtime + RLS) ──
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id UUID NOT NULL REFERENCES cabinets(id),
  destinataire_veto_id UUID NOT NULL REFERENCES veterinaires_cabinet(id),
  type TEXT NOT NULL,                       -- 'planning_change' | 'appel_volontaires' | 'rappel_generation' | ...
  payload_json JSONB DEFAULT '{}',          -- contexte (planning_id, créneau, etc.)
  lu BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_notif_dest ON notifications (cabinet_id, destinataire_veto_id, lu);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- Le véto lit/màj (lu) SES notifs ; l'admin voit celles de son cabinet. Tenant-scopé.
CREATE POLICY "notif_dest_read" ON notifications FOR SELECT TO authenticated
  USING (cabinet_id = auth_cabinet_id()
         AND (destinataire_veto_id = get_veterinaire_id() OR get_user_role() = 'admin'));
CREATE POLICY "notif_dest_update" ON notifications FOR UPDATE TO authenticated
  USING (cabinet_id = auth_cabinet_id() AND destinataire_veto_id = get_veterinaire_id());
-- INSERT : par le serveur (Edge Function / service_role) à la publication/crise.

-- ── SUPER-ADMINS MPP (A5 — preuve d'identité ≠ service_role, cf. §6.6a) ──
-- Le service_role est une CLÉ serveur, pas une preuve "MiKL est connecté". Les Edge Functions
-- de la console MPP vérifient l'appartenance à cette table AVANT d'employer le service_role.
CREATE TABLE super_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id),
  ajoute_le  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
-- Aucune policy pour authenticated : table lue uniquement côté serveur (service_role).

-- ── RÉFÉRENTIEL CALENDAIRE (F3 — lu par le moteur, plus de listes en dur) ──
CREATE TABLE jours_feries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region TEXT NOT NULL, annee INTEGER NOT NULL,
  date DATE NOT NULL, nom TEXT NOT NULL,
  UNIQUE (region, date)
);
CREATE TABLE vacances_scolaires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone TEXT NOT NULL, annee INTEGER NOT NULL,
  date_debut DATE NOT NULL, date_fin DATE NOT NULL, nom TEXT NOT NULL
);
-- Tables de référence PARTAGÉES (par zone/région), pas de cabinet_id ; rechargées chaque été.
-- 🔒 C3 : RLS activée, lecture seule pour authenticated. ON RETIRE le admin_write hérité de V1
-- (un admin du cabinet A ne doit PAS modifier les fériés/vacances vus par B).
-- Écriture réservée au back-office (migrations / service_role).
ALTER TABLE jours_feries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacances_scolaires ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feries_read_all"   ON jours_feries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "vacances_read_all" ON vacances_scolaires
  FOR SELECT TO authenticated USING (true);
-- AUCUNE policy d'écriture pour authenticated (ni admin) : back-office / service_role uniquement.
```

**Publication Realtime (E2 — tenant-scopé, gate CERBÈRE).** Les tables `plannings`, `attributions`, `crise_absences`, `compensations`, `notifications` rejoignent `supabase_realtime` (règle CONSUMERS). Tout widget qui lit un compteur ou un planning écoute sa table — pas de SSR figé, pas de polling. **Mais Realtime respecte la RLS du destinataire : pour CHAQUE table publiée, une policy `SELECT` tenant-scopée est obligatoire** (sinon un abonné reçoit des events d'autres cabinets — fuite par le canal Realtime, pas seulement par la lecture). **Test E2E adversarial ajouté au gate** (au même titre que le test de lecture cross-tenant de §6.1) : *un abonné Realtime du cabinet A ne reçoit JAMAIS un event d'une ligne du cabinet B*. Tant qu'il n'est pas vert, aucune table n'entre dans `supabase_realtime`.

---

## 8. Architecture de la couche IA

**Principe (P5).** L'IA est une **surcouche** par-dessus le formulaire guidé (le socle). Si l'IA tombe, l'admin configure tout à la main. L'IA n'est **jamais** dans le chemin de génération.

**4 casquettes (PRD §7.8)**, toutes sur **modèle Haiku** (coût minimal, routage MPP Haiku) :

| Casquette | Entrée | Sortie | Garde-fou |
|---|---|---|---|
| **Traducteur** | langage naturel | brouillon de `ParamsRegle` pré-rempli | validation **déterministe** contre `schemaParams` ; jamais d'invention de N |
| **Enquêteur** | demande floue | questions de dégrossissage (escalier 4 marches) | propose toujours la saisie manuelle en repli |
| **Aiguilleur** | demande hors-grammaire | escalade tracée vers Hub MPP | journalisée, alimente le backlog briques |
| **Chatbot support** | question d'usage **OU question sur les chiffres** | réponse (doc RAG + données du cabinet courant) | données récupérées par le SERVEUR (scopé tenant), pas par le LLM |

**Chatbot — incohérence PRD↔archi tranchée (E5, décision MiKL 2026-06-16).** Le PRD §7.8 donne l'exemple "pourquoi Antoine a 3 WE ce mois-ci ?" (= **données métier**), alors que l'archi disait initialement "RAG sur la doc, pas d'accès aux données métier". **Décision : le chatbot PEUT répondre sur les chiffres**, mais selon un protocole strict :
- **Le serveur va chercher la donnée, jamais le LLM.** Une couche côté serveur exécute des requêtes **scopées tenant** (compteurs/planning du **cabinet et du véto courant uniquement**, via les projections du ledger §5) et **injecte le résultat déjà calculé** dans le contexte du LLM. Le LLM **reformule** ("Antoine a 3 WE car il a repris une garde de Manon le 12"), il ne calcule rien et n'a aucun accès direct à la base.
- **Jamais les données d'un autre tenant** dans le contexte : ni règles, ni noms, ni créneaux d'un autre cabinet (P4). Idem aux exemples du PRD restreints au cabinet courant.
- **Frontière respectée :** l'IA n'optimise toujours pas, ne décide rien — elle **explique** des chiffres que le moteur/les projections ont produits (P5).

**Architecture technique :**
- **Cache de prompt natif** Anthropic pour les traductions répétitives (le catalogue de briques en préfixe stable mis en cache).
- **Deux sources pour le chatbot :** RAG ciblé dans la doc de l'app (embeddings de la doc Élio) pour les questions d'usage **+** données métier pré-calculées côté serveur (scopées tenant) pour les questions sur les chiffres (E5 ci-dessus).
- **Validation déterministe SCOPÉE TENANT (§6.6b) :** la sortie LLM (traduction de règle) est un JSON validé contre `brique.schemaParams` **en code** ; **et** chaque référence d'entité qu'elle contient (`veterinaire_id`, `creneau_id`) doit **appartenir à `auth_cabinet_id()`** — une réf hallucinée pointant un autre cabinet **échoue** la validation. Échec → on n'enregistre rien, on demande à l'admin. Une hallucination ne peut pas franchir cette barrière.
- **Isolation des données :** l'IA reçoit le catalogue (code mutualisé) + la demande de l'admin + les données du **seul** cabinet courant. Elle ne reçoit **jamais** les données d'un autre cabinet (P4). Le prompt est construit côté serveur, scopé au cabinet du user.
- **Coût mesuré** (risque R6) : un compteur de tokens par cabinet, surveillé dès le prototype.

```typescript
// Le flux d'une traduction — l'IA ne touche jamais le planning
saisieNaturelle
  → LLM Haiku (catalogue en cache) → JSON brouillon
  → validerContreSchema(brouillon, CATALOGUE_BRIQUES)   // DÉTERMINISTE, code
  → si OK : pré-remplit le formulaire (l'admin relit et valide)
  → si KO : casquette Enquêteur (question) ou Aiguilleur (escalade)
```

---

## 9. Le système de crise (architecture)

**Réutilise `simuler()`** (§3.1) — pas de moteur de réparation séparé. C'est l'illustration la plus pure de P1 : la crise est juste `simuler()` avec un contexte particulier.

```
Absence signalée (crise_absences)
   │
   ▼
ContexteSimulation {
   attributionsGelees: <toutes les attributions publiées SAUF celles du véto absent>,
   mode: 'crise_auto',
   soldesInitiaux: <projection ledger à jour, dettes de crise incluses>
}
   │
   ▼
simuler(ctx) → réparation à PERTURBATION MINIMALE
   (les attributions gelées = contraintes ; le solver ne replanifie QUE les trous)
   │
   ├── respecte impérativement étages 0/1/2 (invariant/réglementaire/🔴 user)
   ├── peut assouplir étages 3/4/5 (🟠/🟡/⚪) → trace les règles pliées
   ▼
3 voies (PRD §7.4) :
   • Mode AUTO    → applique la réparation + rapport des règles pliées
   • Volontaires  → notification + délai ; le choix devient une attribution source='crise'
   • Externe      → carnet ; est_externe=true ; compté INFO, hors équité
   • Trou assumé  → attribution.veterinaire_id = NULL (honnête > faux)
```

**Mode auto vs manuel.**
- **AUTO** : le solver respecte les étages 0/1/2, assouplit le reste, produit un rapport. L'admin valide.
- **MANUEL** : l'admin force n'importe quelle attribution. Le système **alerte** pour chaque règle violée et son étage, mais l'admin tranche. **Exception dure (D-R4) :** même en manuel, les étages 0 (invariant) et 1 (réglementaire) restent **non outrepassables**. Chaque override est journalisé (qui/quand/pourquoi).

**Compensations → ledger.** Le dépannage crée 2 `ledger_events` type `compensation` (créance/dette), §5.3. Le carnet de compensation (proposition → accord → officiel) vit dans `compensations`. Gardes manquées par maladie = neutres (pas d'événement de dette). Retour anticipé d'un absent = ne défait pas les réparations publiées (ce qui est publié est un contrat → attributions immuables une fois `statut='publie'`).

**Borne de sécurité multi-tenant (risque R1).** L'admin "tout-puissant" en crise est borné à `auth_cabinet_id()` par la RLS : sa toute-puissance s'arrête à la frontière de son cabinet, prouvée par la base, pas seulement par le code.

---

## 10. Versionnement et snapshots

**F8 + décision C9.** Trois mécanismes complémentaires :

1. **Version par règle.** `regles_cabinet.version` incrémente à chaque modification. Une règle a une **date d'effet** (`validite_json.date_effet`) ; elle s'applique aux jours `≥ date_effet` **non encore publiés**. Jamais de rétroactivité silencieuse (règle §4-5 du catalogue). Un diff est affiché avant régénération.

2. **Snapshot par planning.** À chaque génération, on fige dans `snapshots_regles` la **photo complète** : toutes les règles actives, leurs params, leurs versions, + les définitions de compteurs. Le planning pointe vers son snapshot (`plannings.snapshot_regles_id`). Si une règle change le lendemain, le planning passé reste **rejouable et compréhensible** (preuve en cas de litige entre associés).

3. **Hash d'entrée.** `plannings.hash_entree` = empreinte du `ContexteSimulation`. Rejouer `simuler()` sur le contexte reconstruit depuis le snapshot doit reproduire **exactement** les attributions. C'est la garantie de P2 transformée en test.

**Interdit (correctif R6) :** une règle ne peut pas **expirer en milieu de période** (sinon la photo des règles est incohérente). Les changements ne s'appliquent qu'à la prochaine période.

---

## 11. Stratégie de migration V1 → V2

Le cabinet pilote tourne en prod (`guardveto.vercel.app`). Migration **sans perte**, en tenant compte de la **dérive de schéma pré-prod connue** (mémoire `derive-schema-preprod.md` : colonnes ajoutées à la main hors migrations — `invite_pending`, `creneau`...).

> 🧪 **Étape −1 — Banc d'essai moteur AVANT le gros dev (décision MiKL, 2026-06-16).** Avant même de lancer la migration et le découpage en stories, on construit le **PoC isolé du solver** (cf. §3 nota) : `simuler()` + solver hybride sur les **11 règles réelles du pilote** (extraites de `contraintes_veto`). Il prouve **perf** (< 30 s sur 7-8 vétos × 84-119 j) **et exactitude** (11/11 + équité crédible) sur données réelles, et **calibre** les paramètres fins laissés ouverts en §3.2 (timeout, borne d'élagage, désarmement intra-étage). PoC concluant = feu vert pour le reste de la V2.

**Étape 0 — Diff de schéma (préalable obligatoire).** Avant tout export, comparer le schéma réel de la prod au schéma des migrations (`supabase/migrations/`). Recenser les colonnes "fantômes" ajoutées à la main. *Ne jamais présumer que la prod = les migrations.* (Mémoire `derive-schema-preprod.md`.)

**Étape 1 — Création du cabinet pilote en V2.** Une ligne `cabinets` (le pilote), `cabinet_id` généré. Tout l'import qui suit est scopé à ce `cabinet_id`.

**Étape 2 — Migration des entités stables.**
| V1 | → V2 | Transformation |
|---|---|---|
| `veterinaires` | `veterinaires_cabinet` | + `cabinet_id`, `quote_part` (défaut 1.0), `tags` depuis `statut`/`dernier_recours`, `date_sortie` pour Anne-Cat |
| `periodes` | `periodes` | + `cabinet_id`, `config_json` (effectifs) |
| créneaux figés (code) | `creneaux_catalogue` | matérialise sem_soir/ven_soir/weekend en lignes, avec `borne_*_offset` réelles |
| `contraintes_veto` | `regles_cabinet` | **mapping par type** → brique (R1→`interdire_creneau`, R2→cyclique→`alternance_ancre`, R3→`repos_conditionnel`, R6→`duo_interdit`) |
| `conges` | `conges` (+ cabinet_id) | inchangé sur le fond ; rattacher chaque véto à un `regimes_conges` (associés/salariés, §7-B) |
| (dotations CP en dur) | `regimes_conges` + `veterinaire_regime_conges` | pilote = 2 régimes (associés 70 j / salariés 42 j), cycle 1er oct, unité jour |
| `gardes` (historique) | `attributions` | **dépaquète** premier_id/second_id en lignes rôle ; déduit `date_*_reel` depuis le type |

**Étape 3 — Amorçage du ledger.** L'historique de compteurs V1 (`bonus_malus` + la vue `compteurs_gardes`) entre comme `ledger_events type='ajustement_import'`, **jamais comme une 2ᵉ source**. Les écarts V1 (`ecart_we`, etc.) sont convertis en **fraction de quote-part** (D-R3 : ne pas migrer des nombres absolus de garde, sinon sur-correction au passage 7→6 vétos).

**Étape 4 — Diff de migration obligatoire (D-R3).** Avant la 1re génération V2, lister les règles pointant vers une entité disparue (Anne-Cat sort → règles qui la nomment). Forcer l'admin à trancher (réassigner ou désactiver). Pas de référence morte silencieuse.

**Étape 5 — Bascule (critère corrigé — H).** ⚠️ Le critère naïf "le planning V2 == planning V1 vécu" est **faux par construction** : la V2 *optimise* réellement (le solver V1 ne le faisait pas, il prenait la 1re solution venue), donc elle produit légitimement des plannings **différents** — souvent meilleurs. Exiger l'égalité reviendrait à demander à la V2 de reproduire les défauts de la V1. Le vrai critère de bascule est double :
- **(1) Non-régression de l'EXPRESSION des règles** — le **golden test 11/11** vérifie que les 11 règles réelles sont correctement *exprimées et respectées* en V2 (aucune règle 🔴 violée, "sauf vacances" de Fanny appliqué, etc.). C'est ça que teste le golden test : la fidélité des règles, **pas** l'égalité des plannings.
- **(2) V2 ≥ V1 sur les métriques d'équité** — sur les mêmes données d'entrée, le planning V2 doit être **au moins aussi bon** que le V1 vécu sur les compteurs d'équité (variance des charges, fairness 1er WE), idéalement meilleur. Un planning V2 différent **mais plus équitable** est un **succès**, pas une régression.

Tant que ces deux critères ne sont pas verts, V1 reste en service (les 2 bugs prod sont corrigés sur V1 en parallèle).

> **Contrainte mémoire MCP** (`mcp-supabase-bascule-client.md`) : le MCP Supabase est pointé temporairement sur l'org du client pendant la livraison — à remettre sur MonprojetPro après. La migration respecte le branchement par projet (jamais global). **Pas de branches Supabase** (mémoire `pas-de-branches-supabase.md`) : tester par application directe réversible.

---

## 12. Découpage en modules / organisation du code

```
src/
├── engine/                          # MOTEUR — 100% pur, zéro I/O
│   ├── simuler.ts                   # la fonction pure centrale (§3.1)
│   ├── solver.ts                    # backtracking + branch-and-bound (réécrit)
│   ├── score-lexicographique.ts     # VecteurScore + comparerScores (§3.2)
│   ├── trace.ts                     # construction de TraceSimulation (§3.3)
│   ├── diagnostic.ts                # diagnostic d'impasse corrigé (§3.4)
│   ├── prevol-coherence.ts          # détection contradictions 🔴 avant solver — DIFFÉRÉ (G4), activé si besoin
│   ├── briques/
│   │   ├── types.ts                 # contrat Brique (§4.1)
│   │   ├── catalogue.ts             # CATALOGUE_BRIQUES — source unique (§4.2)
│   │   ├── interdire.ts             # évaluateurs famille INTERDIRE
│   │   ├── forcer.ts                # IMPOSER, ENSEMBLE-REQUIS, AU-MOINS-N
│   │   ├── limiter.ts               # AU-PLUS-N + FENÊTRE, espacement
│   │   ├── equilibrer.ts            # ÉQUILIBRER (dimensions d'optim)
│   │   ├── couverture.ts            # COUVERTURE (bloquante/qualifiante)
│   │   └── sequence.ts              # successions, stretch, motifs pré-câblés
│   ├── compteurs/
│   │   ├── descripteur.ts           # DescripteurCompteur + agreger() (§5.2)
│   │   └── projection-ledger.ts     # projections du ledger
│   └── types.ts                     # types partagés du moteur
│
├── data/                            # COUCHE I/O — seule à toucher Supabase
│   ├── resoudreContexte.ts          # base → ContexteSimulation (ex-loader.ts)
│   ├── persisterResultat.ts         # ResultatSimulation → plannings/attributions/ledger/snapshot
│   ├── ledger.ts                    # écriture d'événements, lecture de projections
│   └── repositories/                # accès typés par table (RLS-aware)
│
├── ai/                              # COUCHE IA — surcouche, scopée cabinet
│   ├── traducteur.ts · enqueteur.ts · aiguilleur.ts · chatbot.ts
│   └── valider-deterministe.ts      # JSON LLM → schemaParams (barrière anti-hallucination)
│
├── app/                             # Next.js App Router (écrans + API routes)
│   ├── (cabinet)/regles/            # écran Règles du cabinet
│   ├── (cabinet)/compteurs/         # compteurs configurables
│   ├── (cabinet)/crise/             # gestion de crise
│   ├── (mpp)/console/               # console super-admin (service_role)
│   └── api/                         # generate, publish, crise, calendar-sync, export
│
├── components/ · hooks/ · lib/      # UI, hooks Realtime, clients Supabase
```

**Règle d'or de découpage :** `engine/` ne `import` **jamais** `data/`, `ai/`, ni `@/lib/supabase`. La dépendance va toujours `app → data → engine`, jamais l'inverse. C'est ce qui garantit la pureté de `simuler()` (testable sans base, déterministe). Un lint de frontière (`eslint-plugin-boundaries` ou équivalent) interdit l'import croisé.

---

## 13. Risques techniques et parades

| Risque | Impact | Parade |
|---|---|---|
| **Réécriture solver régresse sur les cas V1** | Critique | Golden test 11/11 **obligatoire** + `hashEntree` rejouable + comparaison à un planning V1 vécu avant bascule |
| **Lexicographique pur trop rigide** (D-R1) | Élevé | Archi conçue pour l'**hybride** (somme intra-étage) ; dégrade vers le pur si MiKL tranche ainsi |
| **Fuite de données entre cabinets** | Critique | `cabinet_id` dans chaque index/policy + claim JWT + trigger défense en profondeur + gate CERBÈRE à chaque migration + test E2E cross-tenant |
| **Le ledger devient un goulet** (event-sourcing) | Moyen | Projections matérialisées `metric_balances` figées en fin de période ; compteurs intra-période dérivés à la volée (jamais matérialisés) |
| **Explosion combinatoire du solver** (briques riches) | Moyen | Branch-and-bound + élagage par étage + pré-vol de cohérence ; le problème reste petit (7-8 vétos) |
| **IA hallucine une règle fausse** | Critique | Validation déterministe contre `schemaParams` ; l'IA pré-remplit, l'admin valide ; jamais d'invention de N |
| **Dérive de schéma pré-prod à la migration** | Élevé | Diff de schéma **avant** export (étape 0) ; pas de présomption migrations = prod |
| **Migration 7→6 vétos fausse l'équité** (D-R3) | Élevé | Dettes en fraction de quote-part + diff de migration obligatoire (références mortes) |
| **Coût IA incontrôlé** | Moyen | Haiku + cache de prompt + compteur de tokens par cabinet dès le prototype |

---

## ⚠️ Points "À TRANCHER" (à remonter à MiKL)

> **Décisions du moteur tranchées par MiKL le 2026-06-16** (ne sont plus ouvertes) : score **lexicographique hybride** (§3.2), fairness = **variance** par défaut (§3.2), **3 sous-étages dans le rouge** (§3.2, D-R4), ledger **event-sourcing hybride** (§5.1), isolation RLS par **claim JWT** (§6.1). Voir chaque section pour le détail acté.

**Amorçage des compteurs — TRANCHÉ par MiKL le 2026-06-16 :** pour un nouveau cabinet, **pas de fichier à importer**. À la place, un **écran de saisie manuelle** où l'admin remplit les compteurs de départ dans **les colonnes de son choix** (puisées dans le catalogue de descripteurs), avec une **date pivot** (à partir de quand l'historique compte). Entre dans le ledger comme `type_evt = 'ajustement_import'`. *(La migration du cabinet pilote depuis sa propre base V1 reste programmatique, cf. §11.)* Un import CSV agrégé pourra être ajouté plus tard si un gros cabinet le réclame — **hors V2**.

**Aucun autre point ouvert.**

---

*Architecture V2 — GuardVeto — Rédigée par ARCH (MonProjetPro), 2026-06-16.*
*Source principale : `docs/v2/05-prd-v2.md`. À valider par MiKL avant découpage en stories de dev (ruflo).*
*Gate sécurité CERBÈRE : revue de conception sécu (auth, RLS multi-tenant, secrets, surface d'attaque) à effectuer sur ce document avant la première migration.*
