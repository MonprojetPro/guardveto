import { defineConfig, devices } from '@playwright/test'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Configuration Playwright (E2E auth + isolation RLS)
// ════════════════════════════════════════════════════════════════
// • testDir   : e2e/
// • webServer : lance `next dev` sur un port DÉDIÉ (3100) pour ne pas
//               entrer en conflit avec un serveur de dev déjà ouvert
//               sur 3000. Playwright attend que le serveur réponde
//               avant de lancer les specs.
// • Toutes les clés Supabase sont lues depuis l'environnement
//   (.env.local du projet) — JAMAIS en dur ici.
//
// ⚠️ Le webServer force DEV_BYPASS_AUTH=false : les tests d'auth
//    exigent une VRAIE session (login réel via Supabase Auth).
//    Si le bypass était actif, l'app sauterait l'authentification et
//    les tests d'isolation perdraient tout leur sens.
// ════════════════════════════════════════════════════════════════

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Le global setup provisionne les cabinets fictifs B/C ;
  // le teardown les supprime (UNIQUEMENT eux).
  globalSetup: './e2e/fixtures/global-setup.ts',
  globalTeardown: './e2e/fixtures/global-teardown.ts',

  fullyParallel: false, // l'isolation RLS partage des données seedées → séquentiel plus sûr
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // On force le bypass auth à OFF : les tests valident la VRAIE auth.
    env: {
      DEV_BYPASS_AUTH: 'false',
    },
  },
})
