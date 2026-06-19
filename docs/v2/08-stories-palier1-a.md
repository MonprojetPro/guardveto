# Stories Palier 1 — Lot A : Règles configurables

> Découpage du sous-lot **P1-A** (le cœur du Palier 1 : les règles passent du code vers la base + une interface).
> Produit le 2026-06-19 par MAX (MPP). Sources : `05-prd-v2.md` §6.3/§7.2/§7.3 + `06-architecture-v2.md` §4 & §7.
>
> **Décisions actées par MiKL (2026-06-19) :**
> - **Option B** : on crée la table neuve `regles_cabinet` (fidèle archi §7) + on migre `contraintes_veto` dedans (pas d'évolution en place).
> - **On démarre par P1-A**, puis on réévalue avant d'ouvrir P1-B (compteurs/ledger), P1-C (congés), P1-D (crise), P1-E (référentiel UI).
>
> **Règle absolue (gate non-régression)** : les tests engine existants (64/64 au dernier point) + le golden test 11/11 doivent rester verts après chaque story. **Gate TILT** imposé sur toute story touchant auth/RLS. **Gate CERBÈRE** sur chaque migration (RLS RESTRICTIVE + write admin-only, leçon F5-003).

---

## Périmètre de P1-A

**Inclus :**
- Les règles deviennent des **données** : tables `briques_regles` (catalogue de code mutualisé) + `regles_cabinet` (la donnée par cabinet).
- Migration des `contraintes_veto` existantes (déjà normalisées `brique_type` en F4) → `regles_cabinet`.
- La résolution `regles_cabinet` → `RegleResolue[]` lue par le moteur (le moteur lit ses règles depuis la base, plus depuis le code en dur).
- L'**écran "Règles du cabinet"** (liste + aperçu langage naturel) + le **formulaire guidé** de création/édition (QUI/QUOI/QUAND/OPÉRATEUR/FORCE/VALIDITÉ).

**Reporté (dé-goldplating G1, décision archi) :**
- Les briques **composition d'équipe** (`couverture_composition_conditionnelle`, `ratio_par_categorie`, `couverture_multi_attributs`, `groupe_cohorte_equite`, `multi_filieres`) : le pilote `vetovaldallie` n'en a **pas besoin** (pas de filière junior/senior/équine à gérer). On **grave leur schéma** (déjà prévu : `veterinaires.tags[]`, `creneaux_catalogue.effectif_poste`) mais on **branche leurs évaluateurs plus tard**, quand un cabinet réel le demande. P1-A se concentre sur les briques du **golden test pilote** (déjà livrées en Fondations).
- L'**IA Traducteur** (Palier 3) qui pré-remplit le formulaire : le formulaire guidé fonctionne **seul** (socle). L'IA est une surcouche ajoutée plus tard.

---

## Ordonnancement P1-A

```
P1A-001 (briques_regles + seed)
   └── P1A-002 (regles_cabinet + RLS strict)   ← gate TILT + CERBÈRE
          └── P1A-003 (migration contraintes_veto → regles_cabinet)
                 └── P1A-004 (resoudreContexte lit regles_cabinet)   ← gate golden test 11/11
   P1A-005 (catalogue briques en code consolidé)   ← parallélisable avec 001-004
          └── P1A-006 (écran "Règles du cabinet" — liste)
                 └── P1A-007 (formulaire guidé création/édition)
```

---

## P1A-001 — Table `briques_regles` (catalogue mutualisé) + seed ✅ TERMINÉE (2026-06-19)

**Livré :** `supabase/migrations/20260619120000_p1a_briques_regles.sql` (appliquée sur la base MPP `mpvrokmtwqlmhvxaaxdn` via dashboard) + gate E2E `e2e/roles.spec.ts` (2 tests : lecture ≥10 briques OK / écriture refusée — **2/2 verts**). CERBÈRE 🟢.

**Contexte.** Archi §7 : le catalogue de briques est une table de **référence partagée** (pas de `cabinet_id`), miroir lecture du catalogue de code. L'évaluateur reste en code ; la base ne fait qu'exposer `schema_json` (pour la validation + l'IA + l'interface).

**Ce que ruflo doit livrer :**
1. Migration créant `briques_regles` (archi §7 exact) : `id TEXT PK`, `famille`, `operateur`, `schema_json JSONB`, `version INT DEFAULT 1`.
2. RLS (🔒 C3) : `ENABLE ROW LEVEL SECURITY` + policy `SELECT` pour `authenticated` (`USING true`). **AUCUNE** policy INSERT/UPDATE/DELETE pour `authenticated` (écriture = migrations/`service_role` uniquement).
3. Seed des briques **déjà implémentées en code** (celles du golden test pilote) : `interdire_creneau`, `repos_conditionnel`, `duo_interdit`, `liaison_creneaux`, `inversion_role`, `alternance_ancre`, `equilibrer`, `au_plus_n`, `espacement_min`, `motif_grand_weekend`. Le `schema_json` de chaque ligne = miroir de `brique.schemaParams` (source : `src/engine/briques/`).

**Critères d'acceptation :**
- [ ] La table existe ; `SELECT` ouvert à `authenticated`, écriture interdite côté app (test : un `authenticated` ne peut pas INSERT).
- [ ] Le seed contient une ligne par brique du golden test ; chaque `schema_json` correspond au `schemaParams` de la brique en code.
- [ ] CERBÈRE : aucune policy d'écriture ouverte ; pas de `cabinet_id` (table de référence).

**Fichiers :** `supabase/migrations/<ts>_p1a_briques_regles.sql`

**Dépendances :** Fondations (briques en code livrées).

---

## P1A-002 — Table `regles_cabinet` (la donnée) + RLS strict ✅ TERMINÉE (2026-06-19)

**Livré :** `supabase/migrations/20260619130000_p1a_regles_cabinet.sql` (appliquée sur base MPP `mpvrokmtwqlmhvxaaxdn` via dashboard) — isolation RESTRICTIVE + écriture admin-only + lecture authentifiée (modèle F5-003, **pas** l'exemple PERMISSIVE de l'archi). Gate E2E `e2e/roles.spec.ts` : véto refusé / admin OK — **2/2 verts**. CERBÈRE 🟢.

**Contexte.** Archi §7 : la table qui porte les règles configurées par cabinet. ⚠️ **L'exemple de policy de l'archi (§7 ligne ~840) est PERMISSIVE `FOR ALL`** — c'est exactement le pattern qui a causé l'escalade véto corrigée par F5-003. **On NE le reprend PAS tel quel.**

**Ce que ruflo doit livrer :**
1. Migration créant `regles_cabinet` (archi §7 exact) : `id UUID PK`, `cabinet_id NOT NULL`, `periode_id NULL`, `brique_id TEXT REFERENCES briques_regles(id)`, `params_json JSONB`, `force TEXT CHECK(...)`, `validite_json JSONB`, `version INT`, `actif BOOL`, `created_by`, `created_at`. Index unique incluant `cabinet_id`.
2. RLS **selon le modèle F5-003** (pas l'exemple archi) :
   - Isolation tenant **RESTRICTIVE** : `cabinet_id = auth_cabinet_id() AND auth_cabinet_actif()`.
   - **Lecture** : tout `authenticated` du cabinet.
   - **Écriture (INSERT/UPDATE/DELETE)** : **admin uniquement** (`get_user_role() = 'admin'`). Un véto **propose** mais n'écrit pas directement la règle active (gouvernance PRD §5 : le véto propose, l'admin ancre).
3. Gate **TILT** : test E2E auth — un véto **ne peut pas** écrire `regles_cabinet`, un admin **peut**, un cabinet B ne voit pas les règles du cabinet A.

**Critères d'acceptation :**
- [ ] Isolation RESTRICTIVE prouvée par test E2E inter-cabinets.
- [ ] Véto = lecture seule ; admin = écriture. Test E2E gate (modèle `e2e/roles.spec.ts` de F5-003).
- [ ] CERBÈRE 🟢 (pas de policy permissive d'écriture).

**Fichiers :** `supabase/migrations/<ts>_p1a_regles_cabinet.sql`, `e2e/roles.spec.ts` (étendu).

**Dépendances :** P1A-001.

---

## P1A-003 — Migration `contraintes_veto` → `regles_cabinet` ✅ TERMINÉE (2026-06-19)

**Livré :** `supabase/migrations/20260619140000_p1a_migrate_contraintes_to_regles.sql` (appliquée base MPP via dashboard). Stratégie transition douce (consumers inchangés). Vérification : **10 contraintes v2 → 10 `regles_cabinet`**, 0 non reprise (duo_interdit×2 `jamais`, interdire_creneau×3 `evitee`, repos_conditionnel×4 `sauf_crise`, alternance_ancre×1 `sauf_crise`). Idempotente (réutilise l'`id` source). Tableau consumers présenté avant exécution.

**Contexte.** F4 a normalisé `contraintes_veto.brique_type`. On déplace maintenant ces contraintes vers `regles_cabinet` (Option B).

**Ce que ruflo doit livrer :**
1. Script SQL idempotent : pour chaque `contraintes_veto` du pilote, INSERT une ligne `regles_cabinet` en mappant `brique_type` → `brique_id`, `config` → `params_json` (format `ParamsRegle` archi §4.4), et en déduisant `force` + `validite_json` (permanente par défaut).
2. **Inspection consumers** (protocole CLAUDE.md) : recenser tout ce qui lit `contraintes_veto` (`loader.ts`, CRUD UI véto, etc.) avant de basculer — présenter le tableau consumers avant de coder.
3. Vérification post-migration : nombre de règles migrées = nombre de contraintes sources ; `WHERE brique_type` non mappé = 0 (avertissement sinon).
4. `contraintes_veto` **reste en lecture seule** pendant la transition (pas de DROP).

**Critères d'acceptation :**
- [ ] Toutes les contraintes pilote ont leur équivalent `regles_cabinet` (`cabinet_id`, `brique_id`, `force` non-null).
- [ ] Migration idempotente.
- [ ] Tableau consumers présenté + validé avant exécution.

**Fichiers :** `supabase/migrations/<ts>_p1a_migrate_contraintes_to_regles.sql`

**Dépendances :** P1A-002.

---

## P1A-003b — Filet de sécurité : golden test pilote ✅ TERMINÉE (2026-06-19)

**Pourquoi (inséré à la demande de MiKL)** : le « golden test 11/11 » cité dans le découpage **n'existait plus** (supprimé avec les bancs d'essai en F2/F6). Brancher le moteur sur `regles_cabinet` (P1A-004) sans filet = avancer à l'aveugle sur le cœur du produit. On recrée donc le filet **avant** la bascule.

**Livré :**
- `src/engine/__tests__/fixtures-pilote.ts` — snapshot fidèle des 7 vétos + 10 règles réelles du pilote (lues depuis la base MPP), réutilisable par le test d'équivalence de P1A-004.
- `src/engine/__tests__/golden-pilote.test.ts` — 3 tests : planning complet, **0 violation dure** (validateur indépendant), **déterminisme** du seed greedy. **45/45 tests moteur verts.**

**⚠️ 2 dettes découvertes en construisant le filet (hors périmètre P1-A, à traiter plus tard) :**
1. **`genererPlanningPur` mute son input** (entorse à la pureté archi P1) → contourné en clonant l'input dans chaque test.
2. **Le LNS tourne sous budget de TEMPS → non déterministe entre deux runs** (entorse à archi P2 « même entrée = même sortie »). Le filet est donc figé sur le seed greedy (`lnsTimeoutMs: 0`), déterministe. À corriger : critère de convergence par nombre de passes plutôt que par temps.

---

## P1A-004 — `resoudreContexte` lit `regles_cabinet` ✅ TERMINÉE (2026-06-19)

**Décision d'archi (validée MiKL) — Approche A « bascule de source, forme conservée ».**
Le code réel diffère de l'énoncé : la lecture des contraintes était dans `loader.ts`
(join `contraintes_veto`), **attachée par-véto**, et consommée telle quelle par le
solver (`hard-constraints.ts` ×4, `validerPlanning.ts`). On a donc changé **uniquement
la source** (lecture `regles_cabinet`) en **reconstruisant la forme `ContrainteEngine`
identique** que le moteur consommait déjà → planning inchangé (golden vert). La forme
cible archi §4.3 (liste plate `RegleResolue[]` consommée par le moteur) est un **rewire
du cœur moteur** reporté à une **story dédiée** (risque isolé, banc d'essai propre).

**Livré :**
- `src/data/mapReglesCabinet.ts` — mapper PUR `regles_cabinet` → `ContrainteEngine`
  par-véto : validation défensive (brique au catalogue, force résoluble, qui/refs,
  type V1, params objet → sinon écartée + tracée), tri stable E3 `(étage, brique, id)`.
- `src/engine/loader.ts` — lit `regles_cabinet` (scopé cabinet + `periode_id` NULL/période),
  valide via catalogue `briques_regles`, logue les rejets ; join `contraintes_veto` retiré.
- `src/data/__tests__/mapReglesCabinet.test.ts` — équivalence round-trip vs snapshot
  pilote (8 tests) : reproduit les 10 contraintes des 7 vétos, duo rangé chez son
  propriétaire, tri E3, et 4 cas de corruption écartés sans crash.
- **Golden 3/3 + mapper 8/8 + loader-zone 3/3 verts.** Isolation tenant garantie par la
  RLS restrictive F5-003 (double verrou : `.eq(cabinet_id)` + `auth_cabinet_actif()`).

**Contexte.** Archi §4.3 : le pont règle-en-base → évaluateur-en-code. `resoudreContexte()` lit `regles_cabinet` (scopé cabinet + période), filtre par validité, **valide** chaque `params_json` contre `brique.schemaParams` (rejette les règles corrompues au lieu de crasher), et produit `RegleResolue[]`.

**Ce que ruflo doit livrer :**
1. Dans `src/data/resoudreContexte.ts` : remplacer la lecture `contraintes_veto` par `regles_cabinet` → `RegleResolue[]` (archi §4.3 : `{ regleId, brique, params, etage, marqueurs }`).
2. Mapper `force` → `Etage` (invariant=0, reglementaire=1, jamais=2, sauf_crise=3, evitee=4, si_possible=5).
3. Validation déterministe : `params_json` validé contre `briques_regles.schema_json` ; règle invalide = écartée + loggée (jamais de crash solver).
4. Tri stable (E3) : `regles` triées par `(etage, brique_id, id)`.

**Critères d'acceptation :**
- [ ] **Golden test 11/11 vert** : les 11 règles pilote, lues depuis `regles_cabinet`, produisent le même planning qu'avant (non-régression).
- [ ] 64/64 tests engine verts.
- [ ] Une règle au `params_json` corrompu est écartée sans crasher la génération.

**Fichiers :** `src/data/resoudreContexte.ts`, tests associés.

**Dépendances :** P1A-003.

---

## P1A-005 — Catalogue de briques en code consolidé ✅ TERMINÉE (2026-06-19)

**Livré (net-new : le catalogue n'existait pas — seuls type+validateur de F4-001) :**
- `src/engine/briques/catalogue.ts` — `CATALOGUE_BRIQUES` (10 briques) : chacune
  expose `famille`, `axes`, `schemaParams` (le **code devient la source de vérité** ;
  le `schema_json` du seed était un miroir provisoire), `widget` (réf composant, placeholder
  P1A-006/007) et `rendreLangageNaturel(params, ctx)` → phrase française lisible. Plus
  `rendreRegle()` (point d'entrée robuste : fallback si brique inconnue, jamais d'exception).
- `src/engine/briques/__tests__/catalogue.test.ts` — **cohérence réelle** : le test PARSE
  la migration SQL P1A-001 et exige que ids + famille + axes n'aient pas divergé (couplage
  code ↔ base, pas une copie figée) ; + rendu langage naturel des 4 briques pilote + non-vacuité
  des 10. **11/11 verts (30/30 sur le dossier briques), tsc clean, zéro impact moteur.**

**Contexte.** Archi §4.2 : le catalogue (`src/engine/briques/catalogue.ts`) est la **source unique** lue par le moteur, l'IA et l'interface. Chaque brique expose `rendreLangageNaturel()` (aperçu + trace) et `widget` (réf composant React).

**Ce que ruflo doit livrer :**
1. Vérifier/compléter `CATALOGUE_BRIQUES` : chaque brique du golden test a un `rendreLangageNaturel()` correct (français lisible) et une référence `widget`.
2. Vérifier la cohérence `schemaParams` (code) ↔ `schema_json` (seed P1A-001) — un test garantit qu'ils ne divergent pas.
3. Pas de nouvel évaluateur ici (les briques composition sont reportées) — uniquement consolidation/exposition.

**Critères d'acceptation :**
- [ ] Chaque brique du catalogue rend une phrase française correcte pour un jeu de params type.
- [ ] Test de cohérence catalogue-code ↔ seed-base vert.

**Fichiers :** `src/engine/briques/catalogue.ts`, tests.

**Dépendances :** P1A-001 (pour la cohérence seed).

---

## P1A-006 — Écran "Règles du cabinet" (liste + aperçu)

**Contexte.** PRD §7.3 : l'admin gère ses règles depuis un écran dédié. Liste groupée par statut (Actives / Réglementaires OFF), chaque règle affichée en **langage naturel** avec son symbole de force (🔴/🟠/🟡/⚪).

**Ce que ruflo doit livrer :**
1. Page admin `/regles` (Next.js App Router) : liste des `regles_cabinet` actives, rendues via `rendreLangageNaturel()`, groupées et triées par force.
2. Section "Réglementaires (pré-assemblées)" affichée **OFF/désactivée** (emplacement réservé, étage 1 vide — archi G1).
3. **Inspection consumers + Realtime** (protocole CLAUDE.md) : l'écran se rafraîchit en Realtime quand une règle est ajoutée/modifiée/désactivée (TanStack Query + subscription sur `regles_cabinet`).
4. Actions par règle : activer/désactiver (toggle `actif`), éditer (→ P1A-007), supprimer (admin only).

**Critères d'acceptation :**
- [ ] L'admin voit toutes ses règles en langage naturel, groupées par force.
- [ ] Realtime : une règle ajoutée apparaît sans rechargement de page.
- [ ] Un véto accède en lecture seule (pas de boutons d'écriture).

**Fichiers :** `src/app/regles/...`, hooks Realtime.

**Dépendances :** P1A-004 (résolution), P1A-005 (langage naturel).

---

## P1A-007 — Formulaire guidé de création/édition de règle

**Contexte.** PRD §7.3 : formulaire pas-à-pas avec un sélecteur par axe. C'est le **socle** (l'IA viendra le pré-remplir en Palier 3, mais il fonctionne seul).

**Ce que ruflo doit livrer :**
1. Formulaire guidé (modal ou page) avec 6 étapes : **QUI** (sélecteur véto/groupe/rôle) → **QUOI** (créneau depuis `creneaux_catalogue` + rôle) → **QUAND** (condition calendaire + composition SAUF/OU) → **OPÉRATEUR** (= choix de brique, illustré) → **FORCE** (🔴/🟡/⚪, le 🟠 dispo) → **VALIDITÉ** (permanente / date d'effet / période N).
2. **Aperçu live en langage naturel** de la règle en cours de construction (via `rendreLangageNaturel()`).
3. Écriture : construit le `params_json` (format `ParamsRegle`), valide contre `schema_json`, INSERT/UPDATE `regles_cabinet` (admin only, RLS).
4. Édition d'une règle existante = même formulaire pré-rempli ; toute modif **incrémente `version`** et respecte la non-rétroactivité (date d'effet, jamais rétro-appliquée).

**Critères d'acceptation :**
- [ ] L'admin crée une règle de bout en bout en < 2 min (métrique PRD §13), elle apparaît dans la liste (Realtime) et est prise en compte à la prochaine génération.
- [ ] L'aperçu langage naturel reflète fidèlement les choix.
- [ ] `params_json` invalide rejeté à la saisie (validation déterministe), message clair.
- [ ] Édition incrémente `version` ; pas de rétroactivité.

**Fichiers :** `src/app/regles/...` (formulaire), composants widgets de briques.

**Dépendances :** P1A-006.

---

## Résumé — 7 stories

| ID | Titre court | Couche | Dépend de | Gate |
|---|---|---|---|---|
| P1A-001 | Table `briques_regles` + seed | DB | Fondations | CERBÈRE (write verrouillé) |
| P1A-002 | Table `regles_cabinet` + RLS strict | DB | P1A-001 | **TILT + CERBÈRE** |
| P1A-003 | Migration `contraintes_veto` → `regles_cabinet` | Migration | P1A-002 | consumers |
| P1A-004 | `resoudreContexte` lit `regles_cabinet` | Moteur/data | P1A-003 | **golden 11/11** |
| P1A-005 | Catalogue briques consolidé | Moteur | P1A-001 | cohérence |
| P1A-006 | Écran "Règles du cabinet" (liste) | UI | P1A-004, P1A-005 | Realtime |
| P1A-007 | Formulaire guidé création/édition | UI | P1A-006 | < 2 min |

**Gate de non-régression transversal** : après chaque story, `npx vitest run src/engine/` vert (64/64 + golden 11/11) ; tests E2E auth verts sur les stories DB.

---

*Produit le 2026-06-19 — Découpage P1-A par MAX (MPP). Source : PRD V2 §6.3/§7.2/§7.3 + archi V2 §4 & §7. À valider par MiKL avant dev ruflo.*
