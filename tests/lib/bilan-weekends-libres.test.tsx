// B-200 — « le bilan de la période […] il manque des colonnes ? ». L'écart des
// week-ends libres des salariés était calculé et enregistré
// (`bonus_malus.ecart_grands_we`) mais jamais affiché. Ce test rend le vrai
// composant et vérifie la colonne.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BonusMalusCard } from '@/components/compteurs/BonusMalusCard'

const bilan = (id: string, grands: number) => ({
  id: `bm-${id}`, veterinaire_id: id, periode_id: 'p', ecart_we: 0, ecart_semaine: 0,
  ecart_feries: 0, ecart_grands_we: grands, created_at: '', cabinet_id: 'c',
})

function rendre(vets: { id: string; statut: string }[], grands: Record<string, number>) {
  return renderToStaticMarkup(
    <BonusMalusCard
      periodeId="p"
      periodeStatut="publie"
      existingBilan={vets.map((v) => bilan(v.id, grands[v.id] ?? 0)) as never}
      heritage={[]}
      vetsInfo={vets.map((v) => ({ id: v.id, prenom: v.id, nom: '', couleur: '#888888', statut: v.statut }))}
    />,
  )
}

describe('Bilan de la période — week-ends libres des salariés', () => {
  it('la colonne apparaît dès qu’il y a un salarié ; un associé y voit « — »', () => {
    const html = rendre([{ id: 'antoine', statut: 'salarie' }, { id: 'fanny', statut: 'associe' }], { antoine: -2 })
    expect(html).toContain('Week-ends libres (salariés)')
    expect(html).toContain('2 week-ends libres de moins que la moyenne des salariés')
    expect(html).toContain('Associé : non concerné')
  })

  it('sans salarié, pas de colonne vide', () => {
    const html = rendre([{ id: 'fanny', statut: 'associe' }], {})
    expect(html).not.toContain('Week-ends libres')
  })

  it('les colonnes de gardes disent qu’il s’agit de gardes', () => {
    const html = rendre([{ id: 'fanny', statut: 'associe' }], {})
    expect(html).toContain('Week-ends de garde')
    expect(html).toContain('Nuits de semaine de garde')
    expect(html).toContain('Jours fériés de garde')
  })
})
