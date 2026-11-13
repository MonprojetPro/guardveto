import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // `e2e/` appartient à Playwright, pas à Vitest. Sans cette exclusion,
    // Vitest ramassait les trois fichiers `*.spec.ts` du dossier, échouait à
    // charger `test.describe()` et affichait « 3 failed » à CHAQUE exécution.
    // Trois lignes rouges permanentes dans lesquelles un vrai échec serait
    // passé inaperçu — un détecteur de fumée posé au-dessus de la plaque.
    // ⚠️ `.claude/worktrees/**` — AJOUTÉ LE 13/11 (B-210), ET CE N'ÉTAIT PAS
    //    COSMÉTIQUE. Les sessions voisines travaillent dans des copies du dépôt
    //    sous `.claude/worktrees/`. Vitest y ramassait leurs fichiers de test,
    //    MAIS les exécutait contre le `src/` d'ICI : l'alias `@` ci-dessous
    //    pointe sur `__dirname`, pas sur le dossier du test. On lisait donc des
    //    échecs appartenant à un autre chantier, et un vrai échec se serait
    //    perdu dedans — exactement ce que l'exclusion de `e2e/` évitait déjà.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'e2e/**',
      '.claude/worktrees/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
