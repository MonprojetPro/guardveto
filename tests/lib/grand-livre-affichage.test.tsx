// ============================================================
// GUARDVETO — L'écran dit ce que le moteur fait (B-196, lot 0)
// ============================================================
// La colonne du bilan annonçait « Report du tour d'avant » et montrait
// l'écart de week-ends de la SEULE période précédente. Le moteur cumule
// maintenant toutes les périodes de gardes closes, sur trois dimensions,
// et plafonne le rattrapage. Si l'écran restait sur l'ancien chiffre, il
// afficherait un tiers de la vérité sans dire que c'en est un tiers.
//
// Ces tests rendent le VRAI composant — un `grep` prouverait seulement
// que le code est écrit, jamais qu'il s'affiche.
// ============================================================

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BonusMalusCard, type GrandLivreAffiche } from '@/components/compteurs/BonusMalusCard'

const VETS = [
  { id: 'victor', prenom: 'Victor', nom: 'Coelho', couleur: '#888888', statut: 'salarie' },
  { id: 'fanny', prenom: 'Fanny', nom: 'Altieri', couleur: '#999999', statut: 'associe' },
]

const bilan = (id: string) => ({
  id: `bm-${id}`, veterinaire_id: id, periode_id: 'p', ecart_we: 0, ecart_semaine: 0,
  ecart_feries: 0, ecart_grands_we: 0, created_at: '', cabinet_id: 'c',
})

function rendre(grandLivre: GrandLivreAffiche) {
  return renderToStaticMarkup(
    <BonusMalusCard
      periodeId="p"
      periodeStatut="publie"
      existingBilan={VETS.map((v) => bilan(v.id)) as never}
      grandLivre={grandLivre}
      vetsInfo={VETS}
    />,
  )
}

/** Le cas réel : Victor, +3 week-ends cumulés sur 3 périodes closes. */
const VICTOR_EN_DETTE: GrandLivreAffiche = {
  cumul: { victor: { we: 3, semaine: 2, feries: 1 } },
  report: { victor: { we: -1, semaine: -2, feries: -1 } },
  nbPeriodes: 3,
  nbPeriodesCloses: 3,
  chantierOuvert: true,
}

describe('Bilan de la période — ce que le moteur rattrape', () => {
  it('PLUS DE 6e COLONNE — le rattrapage vit sous la pastille de sa dimension', () => {
    // 🔴 B-211a. La colonne « Rattrapage sur cette période » portait une
    // PHRASE dans une cellule de `.count-table` : sur téléphone, le
    // tableau sortait de sa carte (317 px pour 306), l'en-tête s'affichait
    // « RATTR APAGE SUR CETTE PÉRIOD E » et le texte était tronqué.
    // Mesuré au banc le 14/11. Le rattrapage est maintenant sous la
    // pastille de chaque dimension : rien ne s'élargit.
    const html = rendre(VICTOR_EN_DETTE)
    expect(html).not.toContain('Rattrapage sur cette période')
    expect(html).not.toContain('Report du tour d')
    expect(html).not.toContain('1 week-end en moins')
  })

  it('chaque dimension porte SON rattrapage, collé à son chiffre', () => {
    const html = rendre(VICTOR_EN_DETTE)
    expect(html).toContain('rattrape −1') // week-ends, et fériés
    expect(html).toContain('rattrape −2') // nuits de semaine
  })

  it('l’infobulle dit toujours la dette RÉELLE — c’est ce qui remplace la phrase', () => {
    // ⚠️ Ce test a ÉTÉ ROUGE une minute le 14/11 : en retirant la colonne,
    // j'avais retiré l'infobulle avec. Le tableau montre 1 week-end
    // rattrapé ; sans elle, rien ne dit qu'il y en a 3 de retard. C'est
    // exactement la « phrase rassurante » que tout ce chantier combat.
    const html = rendre(VICTOR_EN_DETTE)
    expect(html).toContain('Avant cette période, sur 3 périodes closes')
    expect(html).toContain('3 week-ends de plus')
    expect(html).toContain('rattrapage est volontairement étalé')
  })

  it('celui qui n’a rien à rattraper ne reçoit pas de chiffre inventé', () => {
    const html = rendre(VICTOR_EN_DETTE)
    // Fanny n'a ni cumul ni report : aucune mention sous ses pastilles.
    expect(html).toContain('ecart none')
  })

  it('sans aucun historique, aucune mention de rattrapage', () => {
    const html = rendre({ cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 0, chantierOuvert: true })
    expect(html).not.toContain('rattrape ')
    // Mais la carte, elle, s'affiche : le bilan reste son métier.
    expect(html).toContain('Bilan de la période')
  })

  it('UNE PANNE DE LECTURE SE DIT — elle ne se lit pas « rien à rattraper »', () => {
    // Sans ce message, un historique illisible rend exactement le même
    // écran qu'un historique vide : la colonne disparaît et l'admin lit
    // une équipe à jour. Personne ne va vérifier une bonne nouvelle.
    const html = rendre({ cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 0, chantierOuvert: true, erreur: 'timeout' })
    expect(html).toContain('n’a pas pu être lu')
    expect(html).toContain('ce n’est pas qu’il n’y a rien à rattraper')
    // Et le message de panne ne révèle pas le détail technique à l'admin.
    expect(html).not.toContain('timeout')
  })

  it('un cumul sans rattrapage possible reste visible pour les autres', () => {
    // Report plafonné à 0 sur une dimension : la phrase ne la mentionne pas,
    // mais les dimensions qui restent s'affichent.
    const html = rendre({
      cumul: { victor: { we: 3, semaine: 0, feries: 0 } },
      report: { victor: { we: -1, semaine: 0, feries: 0 } },
      nbPeriodes: 3,
      nbPeriodesCloses: 3,
      chantierOuvert: true,
    })
    // Le week-end porte son rattrapage, les deux autres dimensions non.
    expect(html).toContain('rattrape −1')
    expect(html).not.toContain('rattrape −2')
    expect(html).not.toContain('rattrape +')
  })
})

describe('Bilan de la période — le dernier recours ne reçoit pas de promesse', () => {
  it('un cumul SANS report se dit « hors rotation », sous le nom', () => {
    // Anne-Catherine traîne -12 gardes de semaine au Val d'Allier. Le grand
    // livre la cumule (l'écran peut vouloir le montrer) mais ne lui donne
    // aucun report : elle est retirée de l'effectif avant d'être candidate.
    const html = renderToStaticMarkup(
      <BonusMalusCard
        periodeId="p"
        periodeStatut="publie"
        existingBilan={VETS.map((v) => bilan(v.id)) as never}
        grandLivre={{
          cumul: {
            victor: { we: 3, semaine: 0, feries: 0 },
            fanny: { we: 0, semaine: -12, feries: 0 },
          },
          report: { victor: { we: -1, semaine: 0, feries: 0 } },
          nbPeriodes: 3,
          nbPeriodesCloses: 3,
          horsRotation: ['fanny'],
          chantierOuvert: true,
        }}
        vetsInfo={VETS}
      />,
    )
    expect(html).toContain('Hors rotation (dernier recours)')
    expect(html).toContain('il ne sera pas rattrapé')
  })
})
