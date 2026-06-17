import { loadEnvLocal } from './load-env'
import { getAdminClient } from './admin-client'
import { teardownTestCabinets } from './provision'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Global teardown E2E
// ════════════════════════════════════════════════════════════════
// Supprime UNIQUEMENT les cabinets fictifs B/C (+ users/vétos/données).
// Filtrage strict sur leurs cabinet_id et emails de test.
// Ne peut PAS toucher le cabinet pilote (assertNotPilote dans provision.ts).
// ════════════════════════════════════════════════════════════════

export default async function globalTeardown(): Promise<void> {
  loadEnvLocal()
  const admin = getAdminClient()

  console.log('[E2E] Teardown : suppression des cabinets fictifs B/C…')

  await teardownTestCabinets(admin)

  console.log('[E2E] Teardown terminé.')
}
