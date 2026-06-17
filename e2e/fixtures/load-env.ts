import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Chargement minimal de .env.local pour le process E2E
// ════════════════════════════════════════════════════════════════
// Le process Playwright (global setup/teardown) n'hérite PAS du
// chargement .env de Next. On lit donc .env.local nous-mêmes pour
// peupler process.env avec les MÊMES variables que l'app utilise :
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY /
//   SUPABASE_SERVICE_ROLE_KEY
//
// Parseur volontairement simple (KEY=VALUE, # commentaires, guillemets
// optionnels). Aucune clé n'est jamais affichée ni écrite ailleurs.
// On NE remplace PAS une variable déjà présente dans l'environnement
// (un override CI/shell reste prioritaire).
// ════════════════════════════════════════════════════════════════

export function loadEnvLocal(): void {
  const candidates = ['.env.local', '.env']
  for (const file of candidates) {
    try {
      const path = resolve(process.cwd(), file)
      const content = readFileSync(path, 'utf8')
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        // Retire des guillemets entourants éventuels.
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        // Ne pas écraser une variable déjà définie (priorité au shell/CI).
        if (process.env[key] === undefined) {
          process.env[key] = value
        }
      }
    } catch {
      // Fichier absent → on ignore et on laissera échouer plus tard
      // avec un message clair si une clé requise manque.
    }
  }
}
