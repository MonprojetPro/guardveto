import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth-helpers'
import { loadEnvLocal } from './fixtures/load-env'
import { signInTenantClient } from './fixtures/tenant-client'
import { TEST_EMAIL_DOMAIN, USERS } from './fixtures/test-data'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — E2E Rôles (admin vs veto)
// ════════════════════════════════════════════════════════════════
// Un user rôle `veto` :
//   • est redirigé vers /planning quand il tente une page admin
//     (admin/veterinaires, admin/periodes, admin/demandes) ;
//   • ne voit pas les entrées de nav admin dans la sidebar ;
//   • peut accéder aux pages communes (planning, congés, compteurs).
// Un admin, lui, accède bien aux pages admin.
// ════════════════════════════════════════════════════════════════

loadEnvLocal()

// Pages réservées aux admins (cf. (protected)/admin/*/page.tsx : redirect veto → /planning)
const ADMIN_ONLY_ROUTES = [
  '/admin/veterinaires',
  '/admin/periodes',
  '/admin/demandes',
]

test.describe('Contrôle des rôles', () => {
  test('un véto est redirigé vers /planning sur chaque page admin', async ({ page }) => {
    await login(page, USERS.vetoB.email, USERS.vetoB.password)

    for (const route of ADMIN_ONLY_ROUTES) {
      await page.goto(route)
      // Les pages admin redirigent les vétos vers /planning.
      await expect(page, `route ${route} doit rediriger un véto`).toHaveURL(/\/planning/)
    }
  })

  test('un véto ne voit pas les entrées de navigation admin', async ({ page }) => {
    await login(page, USERS.vetoB.email, USERS.vetoB.password)
    await page.goto('/planning')

    // Entrées communes visibles dans la sidebar.
    const nav = page.locator('aside nav')
    await expect(nav.getByRole('link', { name: 'Planning' })).toBeVisible()

    // Entrées admin absentes pour un véto.
    await expect(nav.getByRole('link', { name: 'Vétérinaires' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Périodes' })).toHaveCount(0)
  })

  test('un véto accède bien aux pages communes', async ({ page }) => {
    await login(page, USERS.vetoB.email, USERS.vetoB.password)

    await page.goto('/conges')
    await expect(page).toHaveURL(/\/conges/)

    await page.goto('/compteurs')
    await expect(page).toHaveURL(/\/compteurs/)
  })

  test('un admin accède bien à la page admin/veterinaires', async ({ page }) => {
    await login(page, USERS.adminB.email, USERS.adminB.password)
    await page.goto('/admin/veterinaires')

    await expect(page).toHaveURL(/\/admin\/veterinaires/)
    await expect(
      page.getByRole('heading', { name: 'Gestion des vétérinaires' })
    ).toBeVisible()
  })

  test('un véto ne peut pas muter les données via la RLS (insert refusé)', async () => {
    // Le rôle `veto` n'a pas de policy d'écriture admin sur veterinaires :
    // une tentative d'insert d'un nouveau véto doit être refusée par la RLS.
    //
    // ⚠️ Ce test GATE le correctif RLS :
    //    supabase/migrations/20260617153000_fix_rls_isolation_restrictive.sql
    //    Tant que ce correctif n'est PAS appliqué, l'insert est ACCEPTÉ
    //    (escalade de privilèges : la policy d'isolation permissive FOR ALL
    //    accorde l'écriture à tout authentifié du cabinet). Le test échoue
    //    donc volontairement jusqu'à l'application de la migration.
    const clientVeto = await signInTenantClient(USERS.vetoB.email, USERS.vetoB.password)

    const { error } = await clientVeto.from('veterinaires').insert({
      cabinet_id: USERS.vetoB.cabinetId,
      nom: 'Intrus',
      prenom: 'Mallory',
      email: `intrus@${TEST_EMAIL_DOMAIN}`,
      statut: 'salarie',
      role_app: 'veto',
      actif: true,
      couleur: '#000000',
    })

    expect(error, 'un véto ne doit pas pouvoir créer un vétérinaire').not.toBeNull()

    await clientVeto.auth.signOut()
  })
})
