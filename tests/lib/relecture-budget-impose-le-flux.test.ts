// ============================================================
// B-089 — le budget de sortie et le MODE D'APPEL vont ensemble
// ============================================================
// MiKL, le 31/08, devant quatre échecs d'affilée : « on perd notre temps et
// mon argent avec ces conneries de tests qui ne marchent pas ».
//
// Il avait raison sur le fait, pas sur la cause. Les quatre configurations du
// banc ont échoué en **0,0 s** avec :
//
//   « Streaming is required for operations that may take longer than 10 minutes »
//
// ── CE QUI S'ÉTAIT PASSÉ ────────────────────────────────────────────────────
//
// `MAX_TOKENS_RELECTURE` avait été relevé de 16 000 à 24 000 pour cesser de
// couper Sonnet 5 — sans passer l'appel en flux. Or le SDK REFUSE un appel non
// diffusé dès que `max_tokens` dépasse **21 333** : il estime la durée par
// `3600 × max_tokens / 128000` et lève au-delà de 10 minutes
// (`client.js:_calculateNonstreamingTimeout`).
//
// Le refus est LOCAL et IMMÉDIAT : aucun appel ne part, rien n'est facturé.
// C'est la seule bonne nouvelle de l'affaire — les quatre échecs ont coûté 0 €.
//
// ── POURQUOI ÇA MÉRITE UN TEST ET PAS UN COMMENTAIRE ────────────────────────
//
// Le message d'erreur ne parle QUE de streaming. Il ne nomme jamais
// `max_tokens`, qui en est pourtant la seule cause. Quelqu'un qui relèverait le
// budget six mois plus tard relirait le commentaire posé au-dessus de la
// constante — s'il pense à l'ouvrir — et découvrirait la contrainte en
// production, sur un écran qui dit « Filou n'a pas pu relire ».
//
// Ce test lie les deux dans le seul endroit qui ne s'oublie pas : la suite.
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/** Le seuil exact du SDK : 600 s × 128 000 / 3 600. Au-delà, non diffusé = refus. */
const SEUIL_SANS_FLUX = Math.floor((600 * 128_000) / 3_600) // 21 333

const SOURCE = readFileSync('src/lib/ia/relecturePlanning.ts', 'utf8')

function budgetDeclare(): number {
  const m = SOURCE.match(/const MAX_TOKENS_RELECTURE = (\d+)/)
  if (!m) throw new Error('MAX_TOKENS_RELECTURE introuvable — la constante a été renommée ?')
  return Number(m[1])
}

describe('B-089 — un budget au-dessus du seuil OBLIGE le flux', () => {
  it('appelle en flux dès que le budget dépasse ce qu’un appel direct supporte', () => {
    const budget = budgetDeclare()
    if (budget <= SEUIL_SANS_FLUX) return // en dessous, les deux modes conviennent

    expect(
      SOURCE.includes('client.messages.stream('),
      `MAX_TOKENS_RELECTURE vaut ${budget}, au-dessus du seuil de ${SEUIL_SANS_FLUX} : ` +
        'l’appel DOIT passer par client.messages.stream(). Sinon le SDK refuse avant ' +
        'd’émettre la requête, avec un message qui ne parle que de streaming et jamais ' +
        'de max_tokens (échec du banc, 31/08).',
    ).toBe(true)

    expect(
      SOURCE.includes('client.messages.parse('),
      'L’appel non diffusé subsiste alors que le budget l’interdit.',
    ).toBe(false)
  })

  it('garde une marge de sécurité sous le plafond du modèle', () => {
    // 128 000 est le maximum de sortie des modèles employés. Le budget doit
    // rester en dessous, sinon l'API refuse la requête elle-même.
    expect(budgetDeclare()).toBeLessThan(128_000)
    expect(budgetDeclare()).toBeGreaterThanOrEqual(16_000)
  })

  it('le seuil calculé correspond bien à la formule du SDK', () => {
    // Si le SDK change sa formule, cette valeur doit être revue à la main.
    // Le test le rappelle au lieu de laisser une constante magique.
    expect(SEUIL_SANS_FLUX).toBe(21_333)
  })
})
