// ============================================================
// B-172c — Des journées portées par un AUTRE planning
// ============================================================
// MiKL, 23/10 : le planning « Journées — 9 au 16 novembre » s'affichait
// « vide » alors que « Remplir » disait « tout est déjà en place ». Mesuré en
// base : les 25 présences de ces jours sont rattachées à Hiver P2. Ces tests
// rendent la bande sur ce cas exact et vérifient qu'elle le DIT, au lieu de
// « vide », et qu'elle ne propose pas de publier un planning qui ne porte rien.
// ============================================================

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BandePlanning } from '@/components/chantier/BandePlanning'
import { phraseAilleurs } from '@/components/chantier/DialogPublicationChantier'
import type { Periode } from '@/types'

const journees = {
  id: 'j', cabinet_id: 'c', saison: 'hiver', numero: null, libelle: 'Journées — novembre',
  date_debut: '2026-11-09', date_fin: '2026-11-16', statut: 'brouillon', publie_at: null,
  created_at: '2026-10-19', usage: 'journees',
} as unknown as Periode

const rien = () => {}
function rendre(periode: Periode, contenu: Parameters<typeof BandePlanning>[0]['contenu']) {
  return renderToStaticMarkup(
    <BandePlanning
      periode={periode} selecteur={null} profil="Hiver" contenu={contenu}
      aGardes aJournee pointsAVerifier={0}
      onGenerer={rien} onRemplirJournees={rien} onPublier={rien} onNouveau={rien}
    />,
  )
}

describe('phraseAilleurs', () => {
  it('nomme le planning qui porte les présences, au pluriel juste', () => {
    expect(phraseAilleurs({ gardes: 0, presences: 0, ailleurs: [{ libelle: 'Hiver P2', nb: 25 }] }))
      .toBe('25 présences portées par Hiver P2')
    expect(phraseAilleurs({ gardes: 0, presences: 0, ailleurs: [{ libelle: 'Hiver P2', nb: 1 }] }))
      .toBe('1 présence portée par Hiver P2')
  })
  it('se tait quand rien n’est porté ailleurs, ou quand la lecture a échoué', () => {
    expect(phraseAilleurs({ gardes: 0, presences: 0, ailleurs: [] })).toBeNull()
    expect(phraseAilleurs({ gardes: 0, presences: 0, ailleurs: null })).toBeNull()
  })
})

describe('BandePlanning — journées portées par un autre planning (B-172c)', () => {
  it('le cas du 9 novembre : plus de « vide », le planning porteur est nommé', () => {
    const html = rendre(journees, { gardes: 0, presences: 0, ailleurs: [{ libelle: 'Hiver P2', nb: 25 }] })
    expect(html).toContain('25 présences portées par Hiver P2')
    expect(html).not.toContain('>vide<')
    expect(html).toContain('Rien à publier ici')
    // Ni « Remplir » en accent (rien à poser), ni « Publier à l’équipe ».
    expect(html).not.toContain('Publier à l’équipe')
    expect(html).toContain('>Compléter<')
  })

  it('un planning vide sans rien ailleurs reste « vide », avec « Remplir » en accent', () => {
    const html = rendre(journees, { gardes: 0, presences: 0, ailleurs: [] })
    expect(html).toContain('>vide<')
    expect(html).toContain('bpl-btn cta')
    expect(html).toContain('>Remplir<')
  })

  it('un planning qui a ses propres journées les compte, et signale celles d’à côté', () => {
    const html = rendre(journees, { gardes: 0, presences: 12, ailleurs: [{ libelle: 'Hiver P2', nb: 3 }] })
    expect(html).toContain('12 présences')
    expect(html).toContain('+ 3 présences portées par Hiver P2')
    expect(html).toContain('Publier à l’équipe')
  })
})
