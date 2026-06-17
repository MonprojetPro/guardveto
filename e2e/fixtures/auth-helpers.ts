import { expect, type Page } from '@playwright/test'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Helpers d'authentification pour les specs E2E
// ════════════════════════════════════════════════════════════════
// Login réel via le formulaire `/login` (Server Action signInWithPassword).
//
// Comportement réel observé dans le code (src/app/login/*) :
//   • Formulaire : <input id="email"> + <input id="password"> + bouton
//     « Se connecter » (devient « Connexion en cours… » pendant la
//     transition — on capture donc le bouton AVANT le clic).
//   • Server Action `login()` : sur succès → redirect('/planning')
//     (inconditionnel ; invite_pending ne dévie PAS vers /set-password).
//     Sur échec d'identifiants → reste sur /login avec un message inline.
//     Sur compte inactif → reste sur /login (message « pas encore activé »).
//
// On attend donc la sortie de /login (et l'arrivée sur une page
// authentifiée), avec un diagnostic clair si on retombe sur /login ou
// sur /set-password.
// ════════════════════════════════════════════════════════════════

/**
 * Effectue un login réel et attend l'arrivée sur une page authentifiée
 * (/planning par défaut, cf. login action). Lève une erreur explicite si
 * la connexion échoue (on reste sur /login) ou redirige vers /set-password.
 */
export async function login(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)

  // Capturer le bouton avant le clic (son libellé change pendant la transition).
  await page.getByRole('button', { name: 'Se connecter' }).click()

  // La Server Action redirige côté client. On attend de QUITTER /login.
  // On accepte /planning (cible nominale) ; on échoue avec diagnostic si on
  // retombe sur /login (identifiants/compte) ou sur /set-password.
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login'),
    { timeout: 15_000 }
  ).catch(() => {
    // waitForURL a expiré → on est probablement resté sur /login.
  })

  const currentPath = new URL(page.url()).pathname

  if (currentPath.startsWith('/login')) {
    // Récupère le message d'erreur inline si présent, pour un diagnostic clair.
    const errorText = await page
      .locator('.text-destructive')
      .first()
      .textContent()
      .catch(() => null)
    throw new Error(
      `[E2E] Login échoué pour ${email} — resté sur /login. `
      + `Message: ${errorText?.trim() ?? '(aucun)'}`
    )
  }

  if (currentPath.startsWith('/set-password')) {
    throw new Error(
      `[E2E] Login a redirigé ${email} vers /set-password (invite_pending ?). `
      + `Les comptes de test doivent avoir un mot de passe défini.`
    )
  }

  // À ce stade on est sur une page authentifiée (nominalement /planning).
  await page.waitForURL('**/planning', { timeout: 5_000 }).catch(() => {
    // Tolérant : si la cible évolue (ex. '/'), on ne casse pas tant qu'on
    // a bien quitté /login. Les specs vérifient l'URL/le contenu attendu.
  })
}

/** Déconnecte l'utilisateur via le bouton de déconnexion du Header. */
export async function logout(page: Page): Promise<void> {
  // Le bouton de déconnexion est un bouton-icône dans un <form action={logout}>.
  // Son nom accessible provient de l'attribut title="Se déconnecter".
  // On cible via title pour être robuste (icône sans texte visible).
  const logoutButton = page.locator('button[title="Se déconnecter"]')
  await expect(logoutButton).toBeVisible()
  await logoutButton.click()
  await page.waitForURL('**/login', { timeout: 15_000 })
}

/** Vérifie qu'on est bien sur la page de login (route protégée refusée). */
export async function expectOnLogin(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
}
