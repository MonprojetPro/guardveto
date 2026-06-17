import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth-helpers'
import { loadEnvLocal } from './fixtures/load-env'
import { signInTenantClient } from './fixtures/tenant-client'
import {
  CABINET_B,
  CABINET_C,
  CABINET_PILOTE_ID,
  USERS,
} from './fixtures/test-data'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — E2E Isolation multi-tenant (RLS) — LE test clé
// ════════════════════════════════════════════════════════════════
// Vérifie qu'un utilisateur d'un cabinet ne voit QUE les données de
// SON cabinet : jamais celles d'un autre cabinet de test (B ↔ C), et
// JAMAIS celles du cabinet pilote (…0001).
//
// Deux niveaux de vérification :
//   1. Couche données (RLS pure) : requêtes Supabase avec un JWT réel
//      du user → la RLS doit filtrer côté serveur.
//   2. Couche UI : la page admin/veterinaires n'affiche que les vétos
//      du cabinet de l'admin connecté.
// ════════════════════════════════════════════════════════════════

// Le worker de spec n'hérite pas du chargement .env de Next.
loadEnvLocal()

test.describe('Isolation multi-tenant (RLS)', () => {
  test('admin B ne voit (en base) QUE les vétos du cabinet B', async () => {
    const client = await signInTenantClient(USERS.adminB.email, USERS.adminB.password)

    const { data: vets, error } = await client.from('veterinaires').select('id, cabinet_id, email')
    expect(error).toBeNull()
    expect(vets, 'admin B doit voir au moins ses propres vétos').not.toBeNull()

    const cabinetIds = new Set((vets ?? []).map((v) => v.cabinet_id))
    // Ne contient QUE le cabinet B.
    expect([...cabinetIds]).toEqual([CABINET_B.id])
    // Jamais le cabinet C ni le pilote.
    expect(cabinetIds.has(CABINET_C.id)).toBe(false)
    expect(cabinetIds.has(CABINET_PILOTE_ID)).toBe(false)

    // Et les emails de C ne fuitent pas.
    const emails = (vets ?? []).map((v) => v.email)
    expect(emails).toContain(USERS.adminB.email)
    expect(emails).toContain(USERS.vetoB.email)
    expect(emails).not.toContain(USERS.adminC.email)

    await client.auth.signOut()
  })

  test('admin C ne voit (en base) QUE les vétos du cabinet C', async () => {
    const client = await signInTenantClient(USERS.adminC.email, USERS.adminC.password)

    const { data: vets, error } = await client.from('veterinaires').select('id, cabinet_id, email')
    expect(error).toBeNull()

    const cabinetIds = new Set((vets ?? []).map((v) => v.cabinet_id))
    expect([...cabinetIds]).toEqual([CABINET_C.id])
    expect(cabinetIds.has(CABINET_B.id)).toBe(false)
    expect(cabinetIds.has(CABINET_PILOTE_ID)).toBe(false)

    const emails = (vets ?? []).map((v) => v.email)
    expect(emails).toContain(USERS.adminC.email)
    expect(emails).not.toContain(USERS.adminB.email)
    expect(emails).not.toContain(USERS.vetoB.email)

    await client.auth.signOut()
  })

  test('les périodes et gardes sont aussi isolées par cabinet', async () => {
    const clientB = await signInTenantClient(USERS.adminB.email, USERS.adminB.password)

    const { data: periodes } = await clientB.from('periodes').select('cabinet_id')
    const periodeCabs = new Set((periodes ?? []).map((p) => p.cabinet_id))
    expect([...periodeCabs]).toEqual([CABINET_B.id])

    const { data: gardes } = await clientB.from('gardes').select('cabinet_id')
    const gardeCabs = new Set((gardes ?? []).map((g) => g.cabinet_id))
    expect([...gardeCabs]).toEqual([CABINET_B.id])

    await clientB.auth.signOut()
  })

  test('un write cross-tenant est refusé par la RLS (WITH CHECK)', async () => {
    const clientB = await signInTenantClient(USERS.adminB.email, USERS.adminB.password)

    // Tentative d'insérer une période rattachée au cabinet C depuis un
    // user du cabinet B → doit échouer (WITH CHECK cabinet_id = auth_cabinet_actif()).
    const { error } = await clientB.from('periodes').insert({
      cabinet_id: CABINET_C.id,
      saison: 'hiver',
      numero: 9,
      date_debut: '2026-01-05', // lundi
      date_fin: '2026-03-29', // dimanche
      statut: 'brouillon',
    })
    expect(error, 'le write cross-tenant doit être rejeté par la RLS').not.toBeNull()

    await clientB.auth.signOut()
  })

  test('UI : admin B ne voit que ses vétos sur /admin/veterinaires', async ({ page }) => {
    await login(page, USERS.adminB.email, USERS.adminB.password)
    await page.goto('/admin/veterinaires')

    await expect(
      page.getByRole('heading', { name: 'Gestion des vétérinaires' })
    ).toBeVisible()

    // Les vétos du cabinet B sont listés…
    await expect(page.getByText(USERS.adminB.nom, { exact: false })).toBeVisible()
    await expect(page.getByText(USERS.vetoB.nom, { exact: false })).toBeVisible()

    // …et AUCUN véto du cabinet C n'apparaît.
    await expect(page.getByText(USERS.adminC.nom, { exact: false })).toHaveCount(0)
  })
})
