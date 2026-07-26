// ============================================================
// BANC D'ESSAI — combien coûte Filou, et quel modèle suffit ?
// ============================================================
// NE TOURNE PAS avec `npm test`. Chaque exécution fait de VRAIS appels
// facturés à l'API Anthropic. Pour le lancer :
//
//   npx dotenvx run -f .env.local -- npx vitest run tests/ia/banc-essai-modeles.test.ts
//     (avec BANC_ESSAI_IA=1 dans l'environnement)
//
// Ce qu'il répond, chiffres en main plutôt qu'en estimation :
//   1. combien de tokens pèse VRAIMENT le prompt de Filou (donc le coût plancher
//      de chaque demande, avant même sa réponse) ;
//   2. est-ce que Haiku ou Sonnet traduisent aussi bien qu'Opus — parce que le
//      prix varie d'un facteur 5 entre les deux bouts du catalogue.
//
// Il n'affirme rien qu'il n'ait mesuré : les coûts sortent de `usage`, pas d'une
// règle de trois sur un nombre de caractères.
// ============================================================

import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { construireSystemIA } from '../../src/lib/ia/proposerRegle'
import { PropositionRegleSchema } from '../../src/lib/ia/regleSchema'

/** Tarifs publics, en dollars par MILLION de tokens (relevés le 2026-07-26). */
const TARIFS: Record<string, { entree: number; sortie: number; nom: string }> = {
  'claude-opus-4-8': { entree: 5, sortie: 25, nom: 'Opus 4.8 (actuel)' },
  'claude-sonnet-5': { entree: 3, sortie: 15, nom: 'Sonnet 5' },
  'claude-haiku-4-5': { entree: 1, sortie: 5, nom: 'Haiku 4.5' },
}

/** Le contexte réel du cabinet, tel que l'action serveur le fournit. */
const VETOS = [
  { id: '1', prenom: 'Anne-Sophie' },
  { id: '2', prenom: 'Anne-Catherine' },
  { id: '3', prenom: 'Fanny' },
  { id: '4', prenom: 'Antoine' },
  { id: '5', prenom: 'Manon' },
  { id: '6', prenom: 'Jean' },
  { id: '7', prenom: 'Victor' },
]
const CRENEAUX = [
  { code: 'semaine_soir', nom: 'Soir de semaine (lun-jeu)' },
  { code: 'vendredi_soir', nom: 'Soir du vendredi' },
  { code: 'weekend', nom: 'Week-end (sam+dim)' },
]
const TAGS = ['junior', 'senior']
const ROLES = ['premier', 'second']

/** Les phrases que MiKL et le cabinet écriront réellement. La dernière est
 *  volontairement INFAISABLE : un petit modèle qui invente une règle plutôt que
 *  d'avouer son ignorance est disqualifié, quel que soit son prix. */
const PHRASES = [
  { texte: 'Manon ne fait jamais de garde le mercredi', attendu: 'interdire_creneau' },
  { texte: 'Au moins 3 jours entre deux gardes pour Antoine', attendu: 'espacement_min' },
  { texte: 'Un junior n’est jamais seul de garde', attendu: 'composition_equipe' },
  { texte: 'Il faudrait que le cabinet soit repeint en bleu', attendu: null },
]

function cout(modele: string, entree: number, sortie: number): number {
  const t = TARIFS[modele]
  return (entree * t.entree + sortie * t.sortie) / 1_000_000
}

const centimes = (dollars: number) => `${(dollars * 100).toFixed(2)} ¢`

describe.skipIf(!process.env.BANC_ESSAI_IA)('Banc d’essai — coût et qualité de Filou', () => {
  const client = new Anthropic()
  const system = construireSystemIA(VETOS, CRENEAUX, TAGS, ROLES)

  it('mesure le poids réel du prompt (le coût plancher de chaque demande)', async () => {
    const lignes: string[] = []
    for (const modele of Object.keys(TARIFS)) {
      const { input_tokens } = await client.messages.countTokens({
        model: modele,
        system,
        messages: [{ role: 'user', content: PHRASES[0].texte }],
      })
      lignes.push(
        `${TARIFS[modele].nom.padEnd(20)} ${String(input_tokens).padStart(6)} tokens` +
          `  →  ${centimes((input_tokens * TARIFS[modele].entree) / 1_000_000)} par demande, avant réponse`,
      )
      expect(input_tokens).toBeGreaterThan(0)
    }
    console.log('\n=== POIDS DU PROMPT DE FILOU ===\n' + lignes.join('\n') + '\n')
  })

  it('compare les trois paliers sur les mêmes phrases (coût ET qualité)', async () => {
    const resultats: Array<{
      modele: string
      phrase: string
      brique: string | null
      faisable: boolean
      juste: boolean
      dollars: number
      ms: number
    }> = []

    for (const modele of Object.keys(TARIFS)) {
      for (const p of PHRASES) {
        const t0 = Date.now()
        const reponse = await client.messages.parse({
          model: modele,
          max_tokens: 4000,
          thinking: { type: 'adaptive' },
          system,
          messages: [{ role: 'user', content: p.texte }],
          output_config: { format: zodOutputFormat(PropositionRegleSchema) },
        })
        const ms = Date.now() - t0
        const prop = reponse.parsed_output
        const u = reponse.usage
        // Le cache compte comme de l'entrée : sans ça on sous-estime la facture.
        const entree =
          u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

        const brique = prop?.faisable ? (prop.brique_id ?? null) : null
        resultats.push({
          modele,
          phrase: p.texte,
          brique,
          faisable: Boolean(prop?.faisable),
          // Juste = a trouvé la bonne brique, OU a correctement refusé l'infaisable.
          juste: p.attendu === null ? !prop?.faisable : brique === p.attendu,
          dollars: cout(modele, entree, u.output_tokens),
          ms,
        })
      }
    }

    console.log('\n=== COMPARAISON DES MODÈLES ===')
    for (const modele of Object.keys(TARIFS)) {
      const r = resultats.filter((x) => x.modele === modele)
      const justes = r.filter((x) => x.juste).length
      const total = r.reduce((s, x) => s + x.dollars, 0)
      const msMoyen = Math.round(r.reduce((s, x) => s + x.ms, 0) / r.length)
      console.log(
        `\n${TARIFS[modele].nom}  —  ${justes}/${r.length} justes  ·  ` +
          `${centimes(total / r.length)} par demande en moyenne  ·  ${msMoyen} ms`,
      )
      for (const x of r) {
        console.log(
          `   ${x.juste ? '✓' : '✗'} ${x.phrase.slice(0, 46).padEnd(48)} → ` +
            `${(x.brique ?? '(refusé)').padEnd(20)} ${centimes(x.dollars).padStart(8)}`,
        )
      }
    }
    console.log('')

    // Le banc ne juge pas à notre place : il exige seulement que TOUS les
    // modèles aient répondu quelque chose d'exploitable. La décision est à MiKL.
    expect(resultats).toHaveLength(Object.keys(TARIFS).length * PHRASES.length)
  }, 600_000)
})
