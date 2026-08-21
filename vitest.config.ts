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
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
