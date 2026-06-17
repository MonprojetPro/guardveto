import type { FullConfig } from '@playwright/test'
import { loadEnvLocal } from './load-env'
import { getAdminClient } from './admin-client'
import { provisionTestCabinets } from './provision'
import { CABINET_B, CABINET_C } from './test-data'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Global setup E2E
// ════════════════════════════════════════════════════════════════
// Provisionne les cabinets fictifs B et C (+ users, vétos, données)
// via service_role AVANT que les specs ne tournent.
// N'écrit JAMAIS dans le cabinet pilote.
// ════════════════════════════════════════════════════════════════

export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadEnvLocal()
  const admin = getAdminClient()

  console.log(
    `[E2E] Provisioning cabinets fictifs : ${CABINET_B.slug} (${CABINET_B.id}), `
    + `${CABINET_C.slug} (${CABINET_C.id})`
  )

  await provisionTestCabinets(admin)

  console.log('[E2E] Provisioning terminé.')
}
