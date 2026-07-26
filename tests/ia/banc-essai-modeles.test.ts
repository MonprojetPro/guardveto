// ============================================================
// BANC D'ESSAI — le même moteur que l'écran /admin/banc-ia
// ============================================================
// NE TOURNE PAS avec `npm test` : garde `BANC_ESSAI_IA`, parce que chaque
// exécution fait de VRAIS appels facturés (~30 à 40 ¢).
//
// ⚠️ Nécessite une clé API en local. Sur ce projet, `ANTHROPIC_API_KEY` est
// marquée « sensible » sur Vercel : elle ne se lit qu'à l'exécution côté serveur
// et n'est récupérable ni par `vercel env pull` (qui renvoie une valeur vide) ni
// par le dashboard. Ce fichier ne sert donc QUE si tu disposes d'une clé par
// ailleurs. Sinon, la mesure se fait sur le déploiement, via /admin/banc-ia.
//
//   BANC_ESSAI_IA=1 npx dotenvx run -f <fichier-avec-la-cle> -- \
//     npx vitest run tests/ia/banc-essai-modeles.test.ts
//
// Le contexte cabinet est ici FIGÉ (pas de base de données en test) : les
// chiffres sont donc indicatifs. L'écran d'administration, lui, mesure avec le
// vrai contexte du cabinet — c'est lui qui fait foi.
// ============================================================

import { describe, it, expect } from 'vitest'
import { lancerBancEssai } from '../../src/lib/ia/bancEssai'
import type { ContexteIA } from '../../src/lib/ia/contexteCabinet'

/** Contexte proche du cabinet réel (7 vétos, 3 créneaux, 2 étiquettes). */
const CONTEXTE: ContexteIA = {
  vets: [
    { id: '1', prenom: 'Anne-Sophie' },
    { id: '2', prenom: 'Anne-Catherine' },
    { id: '3', prenom: 'Fanny' },
    { id: '4', prenom: 'Antoine' },
    { id: '5', prenom: 'Manon' },
    { id: '6', prenom: 'Jean' },
    { id: '7', prenom: 'Victor' },
  ],
  tagsEquipe: ['junior', 'senior'],
  typesCreneaux: [
    { code: 'semaine_soir', nom: 'Soir de semaine (lun-jeu)' },
    { code: 'vendredi_soir', nom: 'Soir du vendredi' },
    { code: 'weekend', nom: 'Week-end (sam+dim)' },
  ],
  rolesCabinet: ['premier', 'second'],
}

const centimes = (d: number) => `${(d * 100).toFixed(2)} ¢`

describe.skipIf(!process.env.BANC_ESSAI_IA)('Banc d’essai — coût et qualité de Filou', () => {
  it(
    'mesure le poids du prompt puis compare les paliers',
    async () => {
      const r = await lancerBancEssai(CONTEXTE)

      console.log(`\n=== POIDS DU PROMPT (${r.caracteresPrompt} caractères) ===`)
      for (const p of r.poids) {
        console.log(
          `${p.nomModele.padEnd(12)} ${String(p.tokens).padStart(6)} tokens  →  ` +
            `${centimes(p.dollarsEntree)} par demande, avant réponse`,
        )
      }

      console.log('\n=== VERDICT PAR PALIER ===')
      for (const m of r.resume) {
        console.log(
          `${m.nomModele.padEnd(12)} ${m.justes}/${m.total} justes  ·  ` +
            `${centimes(m.dollarsMoyen)} / demande  ·  ${(m.msMoyen / 1000).toFixed(1)} s` +
            (m.actuel ? '   ← actuel' : ''),
        )
        for (const l of r.lignes.filter((x) => x.modele === m.modele)) {
          console.log(
            `   ${l.juste ? '✓' : '✗'} ${l.quoi.padEnd(44)} → ${(l.brique ?? '(refusé)').padEnd(20)}` +
              centimes(l.dollars).padStart(8),
          )
        }
      }
      console.log(`\nCette mesure a coûté ${centimes(r.dollarsDepenses)}.\n`)

      // Le banc affiche, il ne tranche pas : on vérifie seulement qu'il a bien
      // interrogé chaque palier sur chaque phrase.
      expect(r.lignes).toHaveLength(r.resume.length * 4)
      expect(r.caracteresPrompt).toBeGreaterThan(1000)
    },
    600_000,
  )
})
