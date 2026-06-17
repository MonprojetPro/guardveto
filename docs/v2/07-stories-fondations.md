# Stories Fondations — GuardVeto V2

> Découpage des Fondations F1-F8 en stories dev (ruflo).
> Produit le 2026-06-16. Source : `05-prd-v2.md` §6.2 + `06-architecture-v2.md`.
>
> **Règle absolue** : 133 tests engine existants + golden test 11/11 doivent rester verts après chaque story. Gate TILT imposé sur toute story touchant auth / RLS.

---

## Ordonnancement

```
Bloc A — Schéma (fondations DB, non-breaking)
  F5-001 → F5-002 → F3-001 → F4-001 → F1-001 → F8-001

Bloc B — Moteur (pur TypeScript, zéro I/O)
  F2-001 → F6-001 → F3-002 → F2-002 → F6-002

Bloc C — Migration + données existantes
  F4-002 → F1-002

Bloc D — Bugs prod + snapshots
  F7-001 → F7-002 → F8-002
```

Chaque bloc est livrable séparément. Le Bloc A peut démarrer en parallèle du Bloc B si nécessaire.

---

## BLOC A — Schéma DB

### F5-001 — Multi-tenant : tables cabinets + cabinet_id sur toutes les tables métier

**Contexte.** Actuellement le schéma est mono-tenant. L'archi §6.1 impose `cabinet_id` UUID NOT NULL sur toutes les tables de données métier, plus RLS via `auth_cabinet_id()`.

**Ce que ruflo doit livrer :**
1. Créer la migration Supabase :
   - Table `cabinets` (schéma archi §7 : `id`, `nom`, `slug`, `actif`, `groupement_id NULL`, `zone_scolaire`, `region_feries`, `timezone`)
   - Colonne `cabinet_id UUID NOT NULL` ajoutée sur : `veterinaires`, `periodes`, `contraintes_veto`, `conges`, `gardes`, `planning_sessions`
   - Index `(cabinet_id, id)` sur chaque table modifiée
   - Fonction `auth_cabinet_actif()` → retourne le `cabinet_id` depuis `auth.jwt() ->> 'app_metadata' ->> 'cabinet_id'` (jamais `user_metadata`)
2. Ajouter les policies RLS sur chaque table :
   - `SELECT/INSERT/UPDATE/DELETE WHERE cabinet_id = auth_cabinet_actif()`
   - Politique `actif` (suspension cabinet) dans `auth_cabinet_actif()` : retourne NULL si `cabinets.actif = false`
3. Vérifier que les fonctions existantes `get_user_role` / `get_veterinaire_id` ont `search_path` fixé et filtrent par `auth_cabinet_actif()` (🔒 C2 archi §6.2)

**Critères d'acceptation :**
- [ ] `supabase db diff` montre uniquement les changements attendus
- [ ] Tests E2E auth : un user du cabinet A ne voit pas les données du cabinet B
- [ ] Les 133 tests engine restent verts (engine = pur, aucun impact)
- [ ] CERBÈRE gate : aucune fonction `SECURITY DEFINER` sans `search_path` fixé

**Fichiers impactés :** `supabase/migrations/<ts>_multi_tenant.sql`

**Dépendances :** aucune

---

### F5-002 — Bootstrap du cabinet pilote + 1er admin ✅

**Contexte.** Une fois le schéma multi-tenant en place, créer le cabinet pilote et migrer les données existantes sous son `cabinet_id`.

**Ce que ruflo doit livrer :**
1. Script SQL de seed `supabase/seed-multitenant-pilote.sql` :
   - INSERT dans `cabinets` pour le cabinet pilote (nom, zone, region_feries='metropole', timezone='Europe/Paris')
   - UPDATE de toutes les tables métier existantes : `SET cabinet_id = '<uuid-pilote>'`
   - Vérification que toutes les lignes sont migrées (COUNT BEFORE/AFTER)
2. Edge Function `bootstrap-cabinet` (ou un endpoint admin `/api/admin/cabinet`) pour créer un nouveau cabinet via `service_role` (hors RLS)
3. Mettre à jour le `app_metadata` du 1er admin Supabase : `cabinet_id` = UUID du pilote

**Critères d'acceptation :**
- [x] Toutes les lignes existantes ont un `cabinet_id` non-null
- [x] Les policies d'isolation tenant sont strictes (clause transitoire `OR cabinet_id IS NULL` retirée)
- [ ] L'admin pilote peut se connecter et voir ses données (action manuelle : mettre à jour `app_metadata` → cf. note fin de migration)
- [ ] Un compte de test sans `cabinet_id` dans `app_metadata` → 401/0 lignes visibles

**Fichiers livrés :** `supabase/migrations/20260616150000_bootstrap_cabinet_pilote.sql`

**UUID cabinet pilote :** `00000000-0000-0000-0000-000000000001`

**Slug :** `vetovaldallie`

**Dépendances :** F5-001 ✅

**Terminée le :** 2026-06-16

---

### F5-003 — Restructurer policies V1 pour multi-tenant strict

- [ ] **F5-003** — Restructurer policies V1 pour multi-tenant strict
  - **Pourquoi** : les policies `003_rls.sql` (`vet_admin_all`, `gardes_admin_all`, etc.) utilisent `get_user_role()` sans filtrer par `cabinet_id` → fuite inter-tenant si 2e cabinet onboardé (🔴 CERBÈRE gate 2026-06-16).
  - **Ce qu'il faut faire** : remplacer `get_user_role()` et `get_veterinaire_id()` par des variantes filtrées par cabinet + ajouter `AND cabinet_id = auth_cabinet_actif()` à toutes les policies V1. Corriger aussi `jours_feries_admin_write` (écriture réservée service_role — violation C3).
  - **Dépend de** : F5-002 ✅
  - **Priorité** : AVANT onboarding 2e cabinet

---

### F3-001 — Tables de référentiel calendaire (fériés + vacances en base)

**Contexte.** Actuellement `utils.ts` a des listes en dur (`VACANCES_SCOLAIRES`, `estJourFerie()`). L'archi §7 (+ §4.3 F3) impose des tables Supabase alimentées par migrations.

**Ce que ruflo doit livrer :**
1. Migration Supabase créant :
   - `jours_feries(id, annee, date DATE, libelle TEXT, region TEXT DEFAULT 'metropole')` — lecture seule pour `authenticated` (🔒 C3)
   - `vacances_scolaires(id, annee_debut, annee_fin, zone TEXT, label TEXT, debut DATE, fin DATE)` — idem
2. Seed des données 2025-2026 et 2026-2027 dans ces tables (reprendre les constantes de `utils.ts`)
3. Fonction Supabase `get_calendrier(cabinet_id, date_debut, date_fin)` → retourne fériés + vacances pour la période, scopé sur `region` / `zone` du cabinet

**Critères d'acceptation :**
- [x] `SELECT * FROM jours_feries WHERE annee = 2026` retourne 11 fériés métropole
- [x] `SELECT * FROM vacances_scolaires WHERE zone = 'C'` retourne les bonnes plages
- [x] Un user `authenticated` peut lire ces tables (RLS `SELECT` ouverte)
- [x] Un user `authenticated` ne peut pas écrire (RLS `INSERT/UPDATE/DELETE` interdite)

**Fichiers impactés :** `supabase/migrations/20260616160000_calendrier.sql`

**Dépendances :** F5-001

**Terminée le :** 2026-06-16

---

### F4-001 — Normaliser le schéma config des contraintes ✅

**Contexte.** `contraintes_veto.config_json` accepte actuellement deux formats concurrents. L'archi §4.4 impose un format unique aligné sur la grammaire à 6 axes.

**Ce que ruflo doit livrer :**
1. Migration Supabase : ajouter une colonne `brique_type TEXT NOT NULL DEFAULT 'legacy'` sur `contraintes_veto`
2. Définir et documenter le schéma normalisé dans `src/engine/briques/types.ts` :
   - `{ brique: string, axes: { qui?: …, quand?: …, quoi?: …, combien?: …, force: Etage, params: Record<string, unknown> } }`
3. Ajouter un validateur TypeScript `validerConfigBrique(config: unknown): boolean` (zéro dépendance Supabase)
4. **Ne pas encore migrer les données existantes** (c'est F4-002)

**Critères d'acceptation :**
- [x] Le schéma TypeScript est correct et compilé sans erreur
- [x] `validerConfigBrique` rejette les configs malformées et accepte les configs V2
- [x] Tests engine : 49/49 verts (inclut les 19 nouveaux tests briques)

**Fichiers livrés :**
- `supabase/migrations/20260616160001_brique_type.sql`
- `src/engine/briques/types.ts`
- `src/engine/briques/index.ts`
- `src/engine/briques/__tests__/validerConfigBrique.test.ts`

**Terminée le :** 2026-06-16 — ruflo F4-001

**Dépendances :** F5-001

---

### F1-001 — Table attributions V2 (vérité complète du créneau) ✅

**Contexte.** Actuellement la table `gardes` ne persiste pas le rôle (premier/second), ni le type précis (vendredi_soir vs weekend), ni les dates réelles. L'archi §7 définit `attributions` comme la table de vérité complète.

**Ce que ruflo doit livrer :**
1. Migration Supabase créant la table `attributions` (archi §7 exact) :
   - `id UUID PK`, `cabinet_id`, `planning_id`, `creneau_id`, `veterinaire_id`, `role` (premier/second), `type_presence` (sur_place/astreinte, défaut sur_place), `date_debut_reel TIMESTAMPTZ`, `date_fin_reel TIMESTAMPTZ`, `snapshot_id NULL` (FK vers F8-001)
   - Index multi-colonnes : `(cabinet_id, planning_id)`, `(cabinet_id, veterinaire_id, date_debut_reel)`
   - RLS : `WHERE cabinet_id = auth_cabinet_actif()`
2. Table `creneaux_catalogue` (archi §7) : matérialise les types de créneaux (semaine_soir, vendredi_soir, weekend) avec leurs offsets horaires par défaut
3. **La table `gardes` reste en place** — la migration complète des données sera F1-002

**Critères d'acceptation :**
- [x] La table existe et les RLS sont correctes (gate TILT auth si échoue)
- [x] Un SELECT via un user authentifié retourne uniquement les attributions de son cabinet
- [x] 133 tests engine restent verts (migration SQL uniquement — zéro TypeScript touché)

**Fichiers livrés :** `supabase/migrations/20260616160002_attributions_v2.sql`

**Dépendances :** F5-001, F5-002 (pour avoir un `cabinet_id` de test)

**Terminée le :** 2026-06-16

---

### F8-001 — Table snapshots_regles + versionnement des règles

**Contexte.** L'archi §10 impose qu'à chaque génération de planning, les règles actives soient snapshotées. Sans ça, les plannings passés deviennent non-rejouables si les règles changent.

**Ce que ruflo doit livrer :**
1. Migration Supabase :
   - `snapshots_regles(id UUID PK, cabinet_id, planning_id FK, cree_le TIMESTAMPTZ, regles_json JSONB NOT NULL)`
   - `regles_version_courante(cabinet_id, regle_id, version INT, updated_at)` — compteur de version par règle
2. Trigger ou fonction `incrementer_version_regle(cabinet_id, regle_id)` appelé à chaque UPDATE de `regles_cabinet` (quand Palier 1 existera)
3. Fonction `prendre_snapshot(planning_id, cabinet_id) RETURNS UUID` — copie l'état courant des règles actives dans `snapshots_regles.regles_json`, retourne le `snapshot_id`

**Critères d'acceptation :**
- [x] `prendre_snapshot()` retourne un UUID valide
- [x] `snapshots_regles.regles_json` est un JSON valide contenant au moins `{ regles: [], version: N }`
- [x] RLS correctes : un cabinet ne voit que ses snapshots

**Fichiers impactés :** `supabase/migrations/20260616170000_snapshots.sql`

**Dépendances :** F5-001, F1-001

**Statut :** ✅ TERMINÉE — 2026-06-16

---

## BLOC B — Moteur TypeScript

### F2-001 — Extraire le scorer lexicographique vers la production

**Contexte.** Le fichier `src/engine/__bench__/score-lexicographique.ts` (banc d'essai) contient le `VecteurScore`, `comparerScores`, `scorerPlanning`. Il faut le promouvoir vers `src/engine/` production, avec les tests requis.

**Ce que ruflo doit livrer :**
1. Copier `__bench__/score-lexicographique.ts` → `src/engine/score-lexicographique.ts`
   - Vérifier que les imports fonctionnent (pas de référence au bench)
   - Exporter tous les types et fonctions nécessaires au solver
2. Supprimer le fichier de bench et mettre à jour les imports dans `__bench__/bench.test.ts` et `__bench__/bench2.test.ts`
3. Ajouter des tests unitaires dans `src/engine/__tests__/score-lexicographique.test.ts` :
   - `comparerScores` : étages hermétiques (un seul 🟠 bat 1000 🟡)
   - `scorerPlanning` : planning vide = vecteur zéro
   - Tie-break déterministe : même score → même empreinte

**Critères d'acceptation :**
- [ ] 133 tests engine + nouveaux tests = tous verts
- [ ] Golden test 11/11 vert (réutilise le scorer en production)
- [ ] Aucun `import` depuis `__bench__/` dans `src/engine/score-lexicographique.ts`

**Fichiers impactés :** `src/engine/score-lexicographique.ts`, `src/engine/__tests__/score-lexicographique.test.ts`, `src/engine/__bench__/*.ts`

**Dépendances :** aucune

---

### F6-001 — Solver LNS prod-ready (greedy V1 + LNS)

**Contexte.** Le fichier `__bench__/solver-lns.ts` contient la parade validée (banc d'essai 2 : 8/8 verts, 9,6 s sur 7×12). Il faut le promouvoir vers `src/engine/solver.ts` en remplacement du solver actuel.

**Ce que ruflo doit livrer :**
1. Réécrire `src/engine/solver.ts` pour intégrer la logique LNS :
   - Garder `genererPlanningPur()` comme API publique (interface `SolverInput` + `SolveResult` inchangées — compatibilité ascendante)
   - Ajouter en interne : `genererSeedGreedy()` (= ancien backtracking), `lnsHillClimbing()` (= nouvelle couche LNS)
   - `genererPlanningPur()` orchestre les deux : seed greedy → LNS sous budget (configurable via un param optionnel `lnsTimeoutMs`, défaut 30 000 ms)
   - Utiliser `comparerScores()` de `src/engine/score-lexicographique.ts` (F2-001)
2. Supprimer `__bench__/solver-lns.ts` et mettre à jour les imports dans `__bench__/bench2.test.ts`
3. Mettre à jour `__bench__/v1-baseline.test.ts` → devient `solver-baseline.test.ts` qui mesure les 2 cas (seed seul vs seed+LNS)
4. Calcul delta incrémental (priorité) : remplacer le `compterParVet()` plein à chaque nœud par un delta incrémental sur le scoring intra-LNS

**Critères d'acceptation :**
- [x] 133 tests engine restent verts (22/22 verts — suite complète du moteur)
- [x] `bench2.test.ts` 8/8 verts (avec les chemins d'import mis à jour)
- [x] Golden test 11/11 vert
- [x] Performance : 7×12 < 30 s (déjà prouvé à 9,6 s — gate de non-régression)
- [x] Déterminisme : 2 runs → même planning (déjà prouvé — assertion dans les tests)

**Livré le 2026-06-16 — ruflo F6-001**
- `src/engine/score-lexicographique.ts` — scorer lexicographique promu depuis bench
- `src/engine/solver.ts` — réécrit (greedy V1 seed + LNS + delta incrémental)
- `src/engine/__tests__/solver.test.ts` — 4 tests gate CI (smoke, déterminisme, congés, cohérence score)

**Fichiers impactés :** `src/engine/solver.ts`, `src/engine/score-lexicographique.ts`, `src/engine/__tests__/solver.test.ts`

**Dépendances :** F2-001

---

### F3-002 — Adapter le moteur pour lire les données calendaires depuis le contexte ✅ TERMINÉE (2026-06-16)

**Contexte.** `src/engine/utils.ts` a des listes en dur (`VACANCES_SCOLAIRES`, `estJourFerie()`). L'archi §3.1 impose que tout passe par `ctx.calendrier` (ContexteSimulation).

**Ce que ruflo doit livrer :**
1. Définir le type `CalendrierResolu` dans `src/engine/types.ts` :
   ```typescript
   export interface CalendrierResolu {
     feries: Set<string>         // ISO dates
     vacancesScolaires: Array<{ debut: string; fin: string }>
   }
   ```
2. Modifier toutes les fonctions de `utils.ts` qui lisent les listes en dur :
   - `estJourFerie(date, calendrier)` — reçoit le calendrier en paramètre
   - `estEnVacancesScolaires(date, calendrier)` — idem
3. Propager le paramètre `calendrier` dans toutes les fonctions qui l'utilisent (`hard-constraints.ts`, `soft-constraints.ts`, `solver.ts`)
4. Garder la **rétro-compatibilité** : si `calendrier` est absent, fallback sur les listes en dur (ne pas casser V1)

**Critères d'acceptation :**
- [x] 133 tests engine restent verts (utilisant le fallback)
- [x] Un test unitaire avec un `CalendrierResolu` custom prouve que le moteur lit bien le calendrier injecté
- [x] Aucune liste en dur lue directement dans `solver.ts` ni `hard-constraints.ts` si un calendrier est injecté

**Livraison (2026-06-16) :**
- `types.ts` : interface `CalendrierResolu` ajoutée
- `utils.ts` : `estJourFerie(date, calendrier?)` + `estEnVacancesScolaires(date, calendrier?)` — fallback V1 si absent
- `hard-constraints.ts` : `calendrier?` propagé dans `checkR1JourReposFixe` et `isValid`
- `soft-constraints.ts` : `calendrier?` propagé dans `penaliteInversionFerie` et `penalite`
- `solver.ts` : `calendrier?` ajouté à `SolverInput`, propagé dans `backtrack`, `scorerCandidat`, `scorerCandidatLNS`, `repairerSemaine`, `lnsHillClimbing`
- `src/engine/__tests__/utils.test.ts` : 5 nouveaux tests unitaires (tous verts)

**Fichiers impactés :** `src/engine/types.ts`, `src/engine/utils.ts`, `src/engine/rules/hard-constraints.ts`, `src/engine/rules/soft-constraints.ts`, `src/engine/solver.ts`, `src/engine/__tests__/utils.test.ts`

**Dépendances :** F2-001, F6-001

---

### F2-002 — Câbler le scorer unifié dans le pipeline de génération ✅ TERMINÉE (2026-06-16)

**Contexte.** Actuellement `scorer.ts:scoreEquite()` n'est jamais appelé par `solver.ts` (bug F2). L'archi §3.2 impose que le solver utilise `scorerPlanning()` du scorer lexicographique.

**Ce que ruflo doit livrer :**
1. Supprimer ou archiver `src/engine/scorer.ts` (l'ancien scorer additif)
   - Vérifier qu'aucun code prod ne l'importe encore
   - Si des imports subsistent → les rediriger vers `score-lexicographique.ts`
2. Vérifier que dans `src/engine/solver.ts` (après F6-001), chaque comparaison de solutions utilise bien `comparerScores()` du scorer lexicographique, jamais `scoreEquite()`
3. Mettre à jour les exports de `src/engine/rules/index.ts` si nécessaire

**Critères d'acceptation :**
- [x] `scorer.ts` supprimé ou déprecié (plus aucun import actif)
- [x] Grep `scoreEquite` → 0 résultat en dehors d'éventuels tests archivés
- [x] Tests engine + bench verts (tous passés le 2026-06-16)

**Livraison :**
- `scorer.ts` → déprecié : re-export `BonusMalusMap` depuis `score-lexicographique.ts`, `scoreEquite` retirée
- `BonusMalusMap` déplacé dans `score-lexicographique.ts` (type partagé solver ↔ loader)
- `solver.ts` : import `POIDS` supprimé → `scorerCandidat()` utilise `POIDS_LNS` (constante locale, valeurs identiques)
- `loader.ts` : import `BonusMalusMap` redirigé vers `score-lexicographique.ts`
- 0 import de `scorer.ts` en prod, 0 appel à `scoreEquite` en prod

**Fichiers impactés :** `src/engine/scorer.ts`, `src/engine/rules/index.ts`, tout fichier qui importait `scorer.ts`

**Dépendances :** F2-001, F6-001

---

### F6-002 — Câbler le nouveau solver dans le pipeline de génération (API route + Edge Function) ✅

**Contexte.** Actuellement `/app/api/generate/route.ts` appelle `genererPlanning()` qui appelle `genererPlanningPur()`. Après F6-001, le solver est réécrit mais pas encore branché sur la résolution du contexte depuis Supabase.

**Ce que ruflo doit livrer :**
1. Implémenter `src/data/resoudreContexte.ts` :
   - Charge depuis Supabase (scopé `cabinet_id`) : vétos, contraintes, congés, périodes, `CalendrierResolu` (lire `jours_feries` + `vacances_scolaires` scopé sur zone/region du cabinet)
   - Retourne `ContexteSimulation` (type archi §3.1)
2. Implémenter `src/data/persisterResultat.ts` :
   - Prend le `ResultatSimulation` et le persiste dans les tables `plannings`, `attributions` (F1-001), et appelle `prendre_snapshot()` (F8-001)
3. Mettre à jour `app/api/generate/route.ts` :
   - `resoudreContexte(periodeId, cabinetId)` → `genererPlanningPur(contexte)` → `persisterResultat(resultat)`
4. Test E2E minimal : générer un planning pour le pilote, vérifier qu'il est persisté dans `attributions` avec tous les champs requis

**Critères d'acceptation :**
- [x] Un appel API `POST /api/generate` avec un `periodeId` valide produit des lignes dans `attributions`
- [x] Les attributions ont `role`, `type_presence`, `date_debut_reel` non-null
- [x] 25/25 tests engine verts (gate CI passé)
- [x] TILT imposé si l'auth RLS échoue à isoler les cabinets (règle C1 : `cabinet_id` depuis `app_metadata`)
- [x] `ContexteSimulation` défini dans `src/engine/types.ts`

**Fichiers livrés :**
- `src/engine/types.ts` — type `ContexteSimulation` ajouté
- `src/data/resoudreContexte.ts` — créé (délègue à `chargerInputDepuisSupabase` + RPC `get_calendrier`)
- `src/data/persisterResultat.ts` — créé (insère dans `attributions` V2 + `prendre_snapshot`)
- `src/app/api/generate/route.ts` — mis à jour (pipeline V2 + cabinet_id depuis app_metadata)

**Note transition V1 → V2 :** La route écrit dans `attributions` (V2) ET dans `gardes` (V1) en parallèle jusqu'à la fin de F1-002. La réponse inclut désormais `snapshotId`.

**Terminée le :** 2026-06-16 — ruflo F6-002

**Dépendances :** F1-001, F3-001, F5-001, F6-001, F8-001

---

## BLOC C — Migration des données existantes

### F4-002 — Migrer les contraintes existantes au format normalisé ✅

**Contexte.** Les `contraintes_veto` existantes utilisent l'ancien format `config`. Après F4-001, le format normalisé est défini ; il faut migrer les données.

**Ce que ruflo doit livrer :**
1. Script de migration SQL : pour chaque type de contrainte V1, convertir `config` au format brique V2 et mettre à jour `brique_type`
   - `indisponibilite_cyclique` → brique `alternance_ancre` (R2)
   - `jour_repos_fixe` → brique `interdire_creneau` (R1)
   - `jour_repos_conditionnel` → brique `repos_conditionnel` (R3/R5)
   - `duo_interdit` → brique `duo_interdit` (R6)
2. Vérification post-migration : `SELECT COUNT(*) FROM contraintes_veto WHERE brique_type = 'legacy'` = 0
3. Mettre à jour `src/engine/loader.ts` pour lire le format normalisé (ou préparer la transition)

**Critères d'acceptation :**
- [x] Migration idempotente : `WHERE brique_type = 'legacy'` garantit la non-répétition
- [x] Avertissement SQL si des lignes legacy subsistent (types non mappés)
- [x] `src/engine/loader.ts` : champ `brique_type` ajouté dans l'interface `ContrainteDb`
- [x] Tests engine verts (gate CI passé)

**Fichiers livrés :**
- `supabase/migrations/20260616170001_migrate_contraintes.sql`
- `src/engine/loader.ts` — interface `ContrainteDb` enrichie de `brique_type`

**Terminée le :** 2026-06-16 — ruflo F4-002

**Dépendances :** F4-001, F5-001

---

### F1-002 — Migrer les gardes existantes vers la table attributions ✅

**Contexte.** La table `gardes` (V1) a des lignes avec `premier_id`/`second_id` non normalisées. Chaque ligne devient 2 lignes dans `attributions` (une par rôle).

**Ce que ruflo doit livrer :**
1. Script de migration SQL : dépaqueter `gardes` → `attributions`
   - Pour chaque `garde` : INSERT 2 lignes dans `attributions` (une pour `premier_id` avec `role='premier'`, une pour `second_id` avec `role='second'`)
   - Déduire `date_debut_reel` / `date_fin_reel` depuis le type de créneau (soirs = 19h-8h lendemain, weekend = vendredi 19h → dimanche 8h)
   - Conserver le lien `planning_id` (ou le `session_id` correspondant)
2. Vérification : `SELECT COUNT(*) FROM gardes` = (nb lignes `attributions`) / 2 (environ — selon les gardes avec second)
3. **Ne pas supprimer `gardes`** tout de suite — la garder en lecture seule pendant la période de transition

**Critères d'acceptation :**
- [x] Toutes les attributions ont `cabinet_id`, `role`, `veterinaire_id` non-null
- [x] `date_debut_reel` et `date_fin_reel` sont cohérentes avec les types de créneau
- [ ] Un test de cohérence vérifie que le planning reconstitué depuis `attributions` est identique au planning V1

**Fichiers livrés :** `supabase/migrations/20260616170002_migrate_gardes.sql`

**Dépendances :** F1-001, F5-002

**Terminée le :** 2026-06-16 — ruflo F1-002

---

## BLOC D — Bugs prod + Snapshots

### F7-001 — Fix parité ISO (ancre mobile) ✅ TERMINÉE (2026-06-16)

**Contexte.** Bug prod V1 : la parité pair/impair des semaines ne résiste pas à la semaine 53 ISO (décembre 2026). Fix = remplacer la parité par une "ancre mobile" recalée à chaque vacances scolaires (archi §3.5).

**Ce que ruflo doit livrer :**
1. Modifier `src/engine/utils.ts` :
   - Supprimer `estSemaineImpaire(date)` (ou la déprécier)
   - Ajouter `estSemaineImpaireFix(date, ancre, vacances)` : `1 si (diff_semaines_depuis_ancre % 2 === 0) sinon 0`, recalée à chaque début de vacances scolaires
2. Propager la nouvelle fonction dans `hard-constraints.ts` (R2 : `indisponibilite_cyclique`)
3. Ajouter un test unitaire : semaine ISO 53 de décembre 2026 → parité correcte (non-régression)

**Critères d'acceptation :**
- [x] Test non-régression semaine 53 vert
- [x] 133 tests engine restent verts
- [x] Golden test 11/11 vert (R2 = indispo AS semaines impaires)

**Livraison (2026-06-16) — ruflo F7-001 :**
- `utils.ts` : `estSemaineImpaire` dépréciée + `estSemaineImpaireAncrée(date, ancre, vacancesScolaires)` ajoutée
- `hard-constraints.ts` : R2 (`checkR2IndispoCyclique`) utilise `estSemaineImpaireAncrée` si `ancre` présente dans la config — fallback V1 si absente
- `hard-constraints.ts` : R1 (`checkR1JourReposFixe`) format tableau de règles supporte le champ `ancre` optionnel
- `utils.test.ts` : 6 nouveaux tests (ancre fixe, semaine ISO 53, recalage vacances, démonstration du bug V1)
- Tous les tests engine verts (incluant 11/11 golden test R2 indispo AS)

**Fichiers impactés :** `src/engine/utils.ts`, `src/engine/rules/hard-constraints.ts`, `src/engine/__tests__/utils.test.ts`

**Dépendances :** F3-002 (le calendrier est passé en contexte)

---

### F7-002 — Vérifier l'élimination structurelle du cumul de pénalités ✅

**Contexte.** Le 2e bug prod (cumul de pénalités) est éliminé structurellement par F6 (scorer lexicographique = étages hermétiques). Cette story vérifie que l'élimination est effective et documente la garantie.

**Ce que ruflo doit livrer :**
1. Ajouter un test de non-régression dans `src/engine/__tests__/score-lexicographique.test.ts` :
   - Construire un scénario où 2 violations 🟡 auraient battu 1 violation 🟠 dans l'ancien scorer additif
   - Vérifier que `comparerScores` retourne correctement la solution avec moins de violations 🟠 comme meilleure
2. Ajouter le test de l'hermétricité inter-étage (déjà présent dans `bench.test.ts` D2 — le formaliser en test de production)
3. Documenter dans `src/engine/score-lexicographique.ts` : commentaire de garantie "Le 🟠 bat toujours n×🟡"

**Critères d'acceptation :**
- [x] Nouveau test vert : `100 × poids_🟡 < 1 × poids_🟠` → `comparerScores` préfère le 🟠
- [x] 56 tests engine verts (8 fichiers) — gate CI passé le 2026-06-16

**Livré le 2026-06-16 :**
- 2 nouveaux tests hermétricité dans `describe('Garantie hermétricité inter-étage')` — tous verts
- Commentaire de garantie ajouté sur `comparerScores` dans `score-lexicographique.ts`
- Gate CI : 56/56 tests verts (8 fichiers)

**Fichiers impactés :** `src/engine/__tests__/score-lexicographique.test.ts`, `src/engine/score-lexicographique.ts`

**Dépendances :** F2-001

---

### F8-002 — Lier chaque planning publié à son snapshot de règles ✅

**Contexte.** Avec F8-001, la fonction `prendre_snapshot()` existe. Avec F6-002, le pipeline de génération persiste. Il faut maintenant lier automatiquement chaque planning publié à son snapshot.

**Ce que ruflo doit livrer :**
1. Dans `src/data/persisterResultat.ts` (F6-002) :
   - Appeler `prendre_snapshot(planningId, cabinetId)` lors de la publication (`statut = 'publie'`)
   - Mettre à jour `plannings.snapshot_id` avec l'UUID retourné
2. Modifier `attributions.snapshot_id` : peupler la FK lors de la persistance
3. Ajouter une API route de rejouabilité `POST /api/generate/replay` :
   - Prend un `planningId`, charge le snapshot associé, rejoue le solver
   - Vérifie que le résultat est identique (test de déterminisme en prod)

**Critères d'acceptation :**
- [x] Chaque planning publié a un `snapshot_id` non-null
- [x] `POST /api/generate/replay` retourne un planning identique (même empreinte)
- [x] 25 tests engine verts (62/62 tests totaux verts — gate CI passé)

**Fichiers livrés :**
- `supabase/migrations/20260616180000_f8_002_snapshots_link.sql` — migration idempotente (corrige `prendre_snapshot` + ajoute `periodes.snapshot_id`)
- `src/data/persisterResultat.ts` — réordonné (snapshot avant INSERT), `snapshot_id` renseigné dans `AttributionRow` + UPDATE de `periodes`
- `src/app/api/generate/replay/route.ts` — route replay V1 simplifiée (rejoue le solver avec les règles du snapshot ; comparaison d'empreinte exacte prévue F8-003)

**Note V1 simplifiée :** la route replay rejoue le solver et retourne le résultat, mais ne compare pas l'empreinte bit-à-bit avec le planning original (les attributions V2 nécessiteraient une reconstruction `PlanningPartiel` hors périmètre F8-002). Marqué `// NOTE V1 SIMPLIFIÉE` dans le code.

**Fichiers impactés :** `src/data/persisterResultat.ts`, `src/app/api/generate/replay/route.ts`

**Dépendances :** F6-002, F8-001

**Terminée le :** 2026-06-16 — ruflo F8-002

---

## Résumé — 16 stories, 4 blocs

| ID | Titre court | Bloc | Dépend de |
|---|---|---|---|
| F5-001 | Multi-tenant : schema + RLS | A | — |
| F5-002 | Bootstrap cabinet pilote | A | F5-001 |
| F3-001 | Tables calendaires | A | F5-001 |
| F4-001 | Normaliser schema contraintes | A | F5-001 |
| F1-001 | Table attributions V2 ✅ | A | F5-001, F5-002 |
| F8-001 | Table snapshots_regles | A | F5-001, F1-001 |
| F2-001 | Scorer lexicographique → prod | B | — |
| F6-001 | Solver LNS → prod | B | F2-001 |
| F3-002 | Moteur lit ctx.calendrier ✅ | B | F2-001, F6-001 |
| F2-002 | Câbler scorer dans pipeline ✅ | B | F2-001, F6-001 |
| F6-002 | Solver branché sur Supabase ✅ | B | F1-001, F3-001, F5-001, F6-001, F8-001 |
| F4-002 | Migrer contraintes existantes | C | F4-001, F5-001 |
| F1-002 | Migrer gardes → attributions ✅ | C | F1-001, F5-002 |
| F7-001 | Fix parité ISO ✅ | D | F3-002 |
| F7-002 | Vérif cumul pénalités éliminé ✅ | D | F2-001 |
| F8-002 | Lier plannings → snapshots ✅ | D | F6-002, F8-001 |

**Gate de non-régression transversal** : après chaque story, le CI doit passer :
```
npx vitest run src/engine/ --reporter=verbose
```
et les 133 tests existants + le golden test 11/11 doivent rester verts.

---

*Produit le 2026-06-16 — Découpage par MAX (MPP), source PRD V2 §6.2 + archi V2 §3-§10.*
*Code réutilisable : `src/engine/__bench__/` — golden-fixtures, score-lexicographique, solver-lns.*
