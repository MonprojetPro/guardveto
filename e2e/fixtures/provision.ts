import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CABINET_B,
  CABINET_C,
  CABINET_PILOTE_ID,
  CONTRAINTE_B_ID,
  CONTRAINTE_C_ID,
  GARDE_B_ID,
  GARDE_C_ID,
  PERIODE_B_ID,
  PERIODE_C_ID,
  PERIODE_DATES,
  TEST_CABINET_IDS,
  TEST_CABINET_SLUGS,
  TEST_EMAILS,
  USERS,
} from './test-data'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Provisioning / teardown des cabinets fictifs E2E
// ════════════════════════════════════════════════════════════════
// Utilise un client service_role (RLS bypass + API admin Auth).
//
// 🛡️ INVARIANT DE SÛRETÉ — vérifié par assertNotPilote() ci-dessous :
//    aucune opération d'écriture/suppression de ce module ne peut
//    viser le cabinet pilote `…0001`. Toute tentative lève une erreur
//    AVANT d'atteindre la base.
// ════════════════════════════════════════════════════════════════

/**
 * Garde-fou : refuse toute liste de cabinet_id qui contiendrait le
 * cabinet pilote. Appelé avant CHAQUE suppression scopée.
 */
function assertNotPilote(cabinetIds: readonly string[]): void {
  if (cabinetIds.includes(CABINET_PILOTE_ID)) {
    throw new Error(
      `[E2E][SÉCURITÉ] Tentative d'opération sur le cabinet pilote `
      + `${CABINET_PILOTE_ID} bloquée. Le teardown ne doit JAMAIS le viser.`
    )
  }
  if (cabinetIds.length === 0) {
    throw new Error('[E2E][SÉCURITÉ] Liste de cabinet_id vide — suppression non scopée refusée.')
  }
}

const ALL_CABINETS = [CABINET_B, CABINET_C] as const

// Mappe un cabinet fictif → son admin + (optionnel) son véto.
const CABINET_USERS = {
  [CABINET_B.id]: [USERS.adminB, USERS.vetoB],
  [CABINET_C.id]: [USERS.adminC],
} as const

// ── Helpers Auth admin ─────────────────────────────────────────────

/**
 * Crée (ou recrée) un auth user de test avec app_metadata.cabinet_id.
 * Idempotent : si l'email existe déjà (run précédent interrompu), on le
 * supprime d'abord puis on le recrée pour repartir d'un état propre.
 * Retourne l'UUID auth.users de l'utilisateur.
 */
async function upsertAuthUser(
  admin: SupabaseClient,
  user: { email: string; password: string; cabinetId: string }
): Promise<string> {
  // Garde-fou : on ne crée jamais un user rattaché au pilote.
  assertNotPilote([user.cabinetId])

  // Nettoyage préalable d'un éventuel résidu portant le même email.
  await deleteAuthUserByEmail(admin, user.email)

  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    app_metadata: { cabinet_id: user.cabinetId },
  })

  if (error || !data?.user) {
    throw new Error(`[E2E] Échec création auth user ${user.email}: ${error?.message}`)
  }
  return data.user.id
}

/** Supprime un auth user de test par email (no-op s'il n'existe pas). */
async function deleteAuthUserByEmail(admin: SupabaseClient, email: string): Promise<void> {
  // L'API admin ne fournit pas de get-by-email direct ; on pagine la liste.
  // Les volumes de test sont faibles ; une page suffit largement.
  let page = 1
  const perPage = 200
  // On limite à quelques pages par prudence.
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      throw new Error(`[E2E] listUsers a échoué: ${error.message}`)
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (match) {
      const { error: delErr } = await admin.auth.admin.deleteUser(match.id)
      if (delErr) {
        throw new Error(`[E2E] Échec suppression auth user ${email}: ${delErr.message}`)
      }
      return
    }
    if (data.users.length < perPage) break // dernière page atteinte
    page += 1
  }
}

// ── Provisioning ───────────────────────────────────────────────────

/**
 * Provisionne les deux cabinets fictifs B et C avec, pour chacun :
 *   • 1 ligne `cabinets`
 *   • les auth users (admin [+ véto pour B]) avec app_metadata.cabinet_id
 *   • les lignes `veterinaires` correspondantes (cabinet_id + user_id liés)
 *   • 1 `periodes`, 1 `gardes`, 1 `contraintes_veto` scopées au cabinet
 *
 * Idempotent : on teardown d'abord, puis on recrée tout de zéro.
 */
export async function provisionTestCabinets(admin: SupabaseClient): Promise<void> {
  // Repartir d'un état propre (sans jamais toucher le pilote).
  await teardownTestCabinets(admin)

  // 1. Cabinets ----------------------------------------------------
  for (const cab of ALL_CABINETS) {
    assertNotPilote([cab.id])
    const { error } = await admin.from('cabinets').insert({
      id: cab.id,
      nom: cab.nom,
      slug: cab.slug,
      actif: true,
      zone_scolaire: cab.zone_scolaire,
      region_feries: 'metropole',
      timezone: 'Europe/Paris',
    })
    if (error) throw new Error(`[E2E] Insert cabinet ${cab.slug}: ${error.message}`)
  }

  // 2. Auth users + veterinaires -----------------------------------
  for (const cab of ALL_CABINETS) {
    const users = CABINET_USERS[cab.id]
    for (const u of users) {
      const authUserId = await upsertAuthUser(admin, {
        email: u.email,
        password: u.password,
        cabinetId: u.cabinetId,
      })

      const { error } = await admin.from('veterinaires').insert({
        id: u.veterinaireId,
        user_id: authUserId,
        cabinet_id: u.cabinetId,
        nom: u.nom,
        prenom: u.prenom,
        email: u.email,
        statut: u.statut,
        role_app: u.role_app,
        actif: true,
        couleur: u.couleur,
      })
      if (error) throw new Error(`[E2E] Insert veterinaire ${u.email}: ${error.message}`)
    }
  }

  // 3. Données métier scopées --------------------------------------
  // Cabinet B
  await insertPeriode(admin, PERIODE_B_ID, CABINET_B.id)
  await insertGarde(admin, GARDE_B_ID, PERIODE_B_ID, CABINET_B.id, USERS.adminB.veterinaireId)
  await insertContrainte(admin, CONTRAINTE_B_ID, CABINET_B.id, USERS.vetoB.veterinaireId)

  // Cabinet C
  await insertPeriode(admin, PERIODE_C_ID, CABINET_C.id)
  await insertGarde(admin, GARDE_C_ID, PERIODE_C_ID, CABINET_C.id, USERS.adminC.veterinaireId)
  await insertContrainte(admin, CONTRAINTE_C_ID, CABINET_C.id, USERS.adminC.veterinaireId)
}

async function insertPeriode(admin: SupabaseClient, id: string, cabinetId: string) {
  assertNotPilote([cabinetId])
  const { error } = await admin.from('periodes').insert({
    id,
    cabinet_id: cabinetId,
    saison: 'hiver',
    numero: 1,
    date_debut: PERIODE_DATES.date_debut,
    date_fin: PERIODE_DATES.date_fin,
    statut: 'publie',
    publie_at: new Date().toISOString(),
  })
  if (error) throw new Error(`[E2E] Insert periode ${id}: ${error.message}`)
}

async function insertGarde(
  admin: SupabaseClient,
  id: string,
  periodeId: string,
  cabinetId: string,
  premierId: string
) {
  assertNotPilote([cabinetId])
  const { error } = await admin.from('gardes').insert({
    id,
    cabinet_id: cabinetId,
    periode_id: periodeId,
    date: PERIODE_DATES.date_debut, // un lundi de la période → garde de semaine
    type: 'semaine',
    premier_id: premierId,
  })
  if (error) throw new Error(`[E2E] Insert garde ${id}: ${error.message}`)
}

async function insertContrainte(
  admin: SupabaseClient,
  id: string,
  cabinetId: string,
  veterinaireId: string
) {
  assertNotPilote([cabinetId])
  const { error } = await admin.from('contraintes_veto').insert({
    id,
    cabinet_id: cabinetId,
    veterinaire_id: veterinaireId,
    type: 'jour_repos_fixe',
    config: { jour: 'mercredi', exception_vacances_scolaires: true },
    actif: true,
  })
  if (error) throw new Error(`[E2E] Insert contrainte ${id}: ${error.message}`)
}

// ── Teardown ───────────────────────────────────────────────────────

/**
 * Supprime UNIQUEMENT les cabinets fictifs B/C et tout ce qui leur est
 * rattaché. Filtrage strict sur TEST_CABINET_IDS + emails de test.
 * Ne peut PAS toucher le cabinet pilote (assertNotPilote en tête).
 */
export async function teardownTestCabinets(admin: SupabaseClient): Promise<void> {
  // 🛡️ Vérifie l'invariant AVANT toute opération.
  assertNotPilote(TEST_CABINET_IDS)

  const ids = [...TEST_CABINET_IDS]

  // Ordre : tables enfants d'abord (FK), puis veterinaires, puis cabinets.
  // Toutes les suppressions sont filtrées par cabinet_id IN (B, C).
  // bonus_malus → FK vers veterinaires/periodes (cascade DELETE), mais on
  // supprime explicitement par cabinet_id pour rester déterministe.
  const childTables = ['bonus_malus', 'gardes', 'conges', 'contraintes_veto', 'periodes'] as const
  for (const table of childTables) {
    const { error } = await admin.from(table).delete().in('cabinet_id', ids)
    if (error) throw new Error(`[E2E] Teardown ${table}: ${error.message}`)
  }

  // veterinaires (après leurs dépendances)
  {
    const { error } = await admin.from('veterinaires').delete().in('cabinet_id', ids)
    if (error) throw new Error(`[E2E] Teardown veterinaires: ${error.message}`)
  }

  // Auth users de test (par email de test uniquement)
  for (const email of TEST_EMAILS) {
    await deleteAuthUserByEmail(admin, email)
  }

  // cabinets (en dernier — filtré sur les slugs/ids fictifs)
  {
    const { error } = await admin.from('cabinets').delete().in('id', ids)
    if (error) throw new Error(`[E2E] Teardown cabinets (by id): ${error.message}`)
  }
  // Filet de sécurité supplémentaire : par slug fictif (au cas où un id
  // aurait divergé d'un run antérieur). Slugs strictement de test.
  {
    const { error } = await admin
      .from('cabinets')
      .delete()
      .in('slug', [...TEST_CABINET_SLUGS])
    if (error) throw new Error(`[E2E] Teardown cabinets (by slug): ${error.message}`)
  }
}
