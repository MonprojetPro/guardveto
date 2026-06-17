import { test, expect } from '@playwright/test'
import { login, logout, expectOnLogin } from './fixtures/auth-helpers'
import { USERS } from './fixtures/test-data'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — E2E Authentification
// ════════════════════════════════════════════════════════════════
// • Login valide (admin B → /planning)
// • Login invalide → message d'erreur
// • Route protégée sans session → redirigé vers /login
// • Logout → retour /login
// ════════════════════════════════════════════════════════════════

test.describe('Authentification', () => {
  test('login valide → arrive sur le planning', async ({ page }) => {
    await login(page, USERS.adminB.email, USERS.adminB.password)
    await expect(page).toHaveURL(/\/planning/)
    // Le titre de la page planning confirme l'accès à l'app.
    await expect(
      page.getByRole('heading', { name: 'Planning', level: 1 })
    ).toBeVisible()
  })

  test('login invalide → message d\'erreur, reste sur /login', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(USERS.adminB.email)
    await page.locator('#password').fill('mauvais-mot-de-passe')
    await page.getByRole('button', { name: 'Se connecter' }).click()

    // Message d'erreur du formulaire (cf. login action).
    await expect(
      page.getByText('Email ou mot de passe incorrect.')
    ).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('route protégée sans session → redirige vers /login', async ({ page }) => {
    // Aucun login préalable : le contexte est vierge (pas de cookie de session).
    await page.goto('/planning')
    await expectOnLogin(page)
  })

  test('route admin sans session → redirige vers /login', async ({ page }) => {
    await page.goto('/admin/veterinaires')
    await expectOnLogin(page)
  })

  test('logout → retourne sur /login et la session est révoquée', async ({ page }) => {
    await login(page, USERS.adminB.email, USERS.adminB.password)
    await logout(page)
    await expectOnLogin(page)

    // Après logout, re-tenter une route protégée doit re-rediriger.
    await page.goto('/planning')
    await expectOnLogin(page)
  })
})
