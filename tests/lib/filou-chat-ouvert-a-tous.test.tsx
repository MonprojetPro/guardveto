/**
 * B-032 — Filou se consulte depuis tous les comptes, pas seulement l'admin.
 *
 * Jusqu'au 03/11, un vétérinaire voyait la tablette de Filou avec, à la place
 * du champ, « Filou répond aux questions de l'administratrice ». La décision
 * de MiKL (26/07 : un seul Filou pour tous, périmètre selon les droits) n'avait
 * jamais été appliquée à l'écran. Ce test rend le chat comme le reçoit un
 * vétérinaire et vérifie qu'il peut écrire.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// L'action serveur n'est pas appelée au rendu ; on évite seulement de charger
// toute la chaîne Supabase/IA.
vi.mock('@/app/(protected)/filou/actions', () => ({ parlerAFilou: vi.fn() }))

const { FilouChat } = await import('@/components/v2/FilouChat')

function rendre(estAdmin: boolean): string {
  return renderToStaticMarkup(
    <FilouChat
      enTete={<p>Bonjour</p>}
      estAdmin={estAdmin}
      idPersonne="test"
      onResultat={() => {}}
      onRemiseAZero={() => {}}
    />,
  )
}

describe('B-032 — le chat de Filou est ouvert à tous', () => {
  it('un vétérinaire a un champ pour écrire et un bouton d’envoi', () => {
    const html = rendre(false)
    expect(html).toContain('<textarea')
    expect(html).toContain('aria-label="Envoyer à Filou"')
    expect(html).toContain('Quand est ma prochaine garde ?')
    expect(html).not.toContain('répond aux questions de l’administratrice')
  })

  it('l’administratrice garde son invitation à décrire une règle', () => {
    const html = rendre(true)
    expect(html).toContain('<textarea')
    expect(html).toContain('Manon jamais de garde le mercredi')
  })
})
