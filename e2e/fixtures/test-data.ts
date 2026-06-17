// ════════════════════════════════════════════════════════════════
// GUARDVETO — Données de test E2E (cabinets fictifs B et C)
// ════════════════════════════════════════════════════════════════
// Source UNIQUE des identifiants des tenants fictifs utilisés par les
// tests. Le setup les provisionne, le teardown les supprime — TOUJOURS
// filtré strictement sur ces cabinet_id / ces emails.
//
// 🛡️ GARDE-FOU ABSOLU
//   • Le cabinet pilote `00000000-0000-0000-0000-000000000001`
//     (vetovaldallie — 7 vrais vétos + 10 règles) n'apparaît JAMAIS
//     dans ce fichier en tant que cible d'écriture/suppression.
//   • On l'expose ici UNIQUEMENT comme constante de référence, pour
//     que les tests d'isolation puissent VÉRIFIER qu'on ne le voit pas.
//   • Les UUID des cabinets de test commencent par `e2e0...` : ils ne
//     peuvent structurellement pas correspondre à `00000000-...0001`.
// ════════════════════════════════════════════════════════════════

/** UUID du cabinet pilote — RÉFÉRENCE SEULE. Jamais écrit ni supprimé par les tests. */
export const CABINET_PILOTE_ID = '00000000-0000-0000-0000-000000000001' as const

/**
 * Cabinets fictifs dédiés aux tests E2E.
 * UUID préfixés `e2e0` → visuellement et structurellement non-pilote.
 */
export const CABINET_B = {
  id: 'e2e0b000-0000-4000-8000-0000000000b1',
  nom: 'E2E Cabinet B',
  slug: 'e2e-cabinet-b',
  zone_scolaire: 'B' as const,
} as const

export const CABINET_C = {
  id: 'e2e0c000-0000-4000-8000-0000000000c1',
  nom: 'E2E Cabinet C',
  slug: 'e2e-cabinet-c',
  zone_scolaire: 'C' as const,
} as const

/** Tous les cabinets fictifs — utilisé par le teardown pour scoper les suppressions. */
export const TEST_CABINET_IDS = [CABINET_B.id, CABINET_C.id] as const

/** Slugs fictifs — utilisés par le teardown pour cibler la table cabinets. */
export const TEST_CABINET_SLUGS = [CABINET_B.slug, CABINET_C.slug] as const

// ── Mot de passe partagé par tous les comptes de test ──────────────
// Connu, non sensible (comptes jetables d'un environnement de test).
export const TEST_PASSWORD = 'E2e-Test-Password-2026!'

// ── Comptes (auth users + lignes veterinaires) ─────────────────────
// Tous les emails de test portent le sous-domaine `@e2e.guardveto.test`
// → le teardown peut filtrer dessus sans risque de toucher de vrais users.
export const TEST_EMAIL_DOMAIN = 'e2e.guardveto.test'

export const USERS = {
  /** Admin du cabinet B */
  adminB: {
    email: `admin-b@${TEST_EMAIL_DOMAIN}`,
    password: TEST_PASSWORD,
    cabinetId: CABINET_B.id,
    role_app: 'admin' as const,
    veterinaireId: 'e2e0b000-0000-4000-8000-00000000ad01',
    nom: 'AdminB',
    prenom: 'Alice',
    statut: 'associe' as const,
    couleur: '#2563EB',
  },
  /** Véto (non-admin) du cabinet B */
  vetoB: {
    email: `veto-b@${TEST_EMAIL_DOMAIN}`,
    password: TEST_PASSWORD,
    cabinetId: CABINET_B.id,
    role_app: 'veto' as const,
    veterinaireId: 'e2e0b000-0000-4000-8000-00000000be01',
    nom: 'VetoB',
    prenom: 'Bruno',
    statut: 'salarie' as const,
    couleur: '#16A34A',
  },
  /** Admin du cabinet C */
  adminC: {
    email: `admin-c@${TEST_EMAIL_DOMAIN}`,
    password: TEST_PASSWORD,
    cabinetId: CABINET_C.id,
    role_app: 'admin' as const,
    veterinaireId: 'e2e0c000-0000-4000-8000-00000000ad01',
    nom: 'AdminC',
    prenom: 'Carla',
    statut: 'associe' as const,
    couleur: '#DB2777',
  },
} as const

/** Tous les emails de test — utilisé par le teardown pour supprimer les auth users. */
export const TEST_EMAILS = Object.values(USERS).map((u) => u.email)

// ── Données métier seedées par cabinet (pour les tests d'isolation) ─
// Noms uniques et reconnaissables : un test vérifie qu'un user du
// cabinet B voit "Bruno VetoB" mais JAMAIS "Carla AdminC".
export const PERIODE_B_ID = 'e2e0b000-0000-4000-8000-0000000000e1'
export const PERIODE_C_ID = 'e2e0c000-0000-4000-8000-0000000000e1'

// Dates : un lundi → dimanche (contrainte SQL debut_lundi sur periodes).
// 2026-01-05 est un LUNDI, 2026-03-29 est un DIMANCHE.
export const PERIODE_DATES = {
  date_debut: '2026-01-05',
  date_fin: '2026-03-29',
} as const

export const GARDE_B_ID = 'e2e0b000-0000-4000-8000-0000000000a1'
export const GARDE_C_ID = 'e2e0c000-0000-4000-8000-0000000000a1'

export const CONTRAINTE_B_ID = 'e2e0b000-0000-4000-8000-0000000000c1'
export const CONTRAINTE_C_ID = 'e2e0c000-0000-4000-8000-0000000000c1'
