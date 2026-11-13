// ============================================================
// GUARDVETO — Le rattrapage s'affiche AVANT la publication (B-211)
// ============================================================
// MiKL, 13/11 : « je ne peux pas faire le calcul tant qu'une période
// n'est pas publiée, on est d'accord ? c'est dommage que ça n'apparaisse
// pas quand même nan ? ».
//
// Le bilan d'une période a besoin que la période soit remplie. Le
// rattrapage, non : il vient des périodes closes d'avant. Ces tests
// rendent le VRAI composant — un grep prouverait qu'il est écrit, jamais
// qu'il s'affiche.
// ============================================================

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RattrapageCard } from '@/components/compteurs/RattrapageCard'
import { phraseCumul, type GrandLivreAffiche } from '@/lib/equite/phrases'

const VETS = [
  { id: 'victor', prenom: 'Victor', nom: 'Coelho', couleur: '#888888', statut: 'salarie' },
  { id: 'antoine', prenom: 'Antoine', nom: 'Lafarge', couleur: '#777777', statut: 'salarie' },
  { id: 'anne-cat', prenom: 'Anne-Catherine', nom: 'Bernard', couleur: '#999999', statut: 'associe' },
  { id: 'fanny', prenom: 'Fanny', nom: 'Altieri', couleur: '#666666', statut: 'associe' },
]

/** Les chiffres réels du Val d'Allier, 3 périodes closes. */
const VAL_D_ALLIER: GrandLivreAffiche = {
  cumul: {
    victor: { we: 3, semaine: 2, feries: 1 },
    antoine: { we: -1, semaine: 5, feries: 0 },
    // Dernier recours : un écart réel, et aucun rattrapage possible.
    'anne-cat': { we: -4, semaine: -12, feries: 0 },
  },
  report: {
    victor: { we: -1, semaine: -2, feries: -1 },
    antoine: { we: 1, semaine: -2, feries: 0 },
  },
  nbPeriodes: 3,
  nbPeriodesCloses: 3,
  // DONNE, jamais deduit : seul le dernier recours y figure.
  horsRotation: ['anne-cat'],
  chantierOuvert: true,
}

const rendre = (livre: GrandLivreAffiche) =>
  renderToStaticMarkup(<RattrapageCard grandLivre={livre} vetsInfo={VETS} />)

describe('Rattrapage en préparation — ce que l’admin voit avant de générer', () => {
  it('la carte existe et dit ce qu’elle montre', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Ce que le moteur va rattraper')
    expect(html).toContain('Sur cette période')
  })

  it('Victor, qui a trop donné, voit ce qu’on va lui retirer', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Victor')
    expect(html).toContain('1 week-end en moins')
    expect(html).toContain('2 nuits de semaine en moins')
  })

  it('Antoine, à qui on doit un week-end, voit qu’il en aura un de plus', () => {
    expect(rendre(VAL_D_ALLIER)).toContain('1 week-end en plus')
  })

  it('l’écart réel est dans l’infobulle, pas seulement le rattrapage plafonné', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Avant cette période, sur 3 périodes closes')
    expect(html).toContain('3 week-ends de plus')
  })

  it('le dernier recours est NOMMÉ, pas escamoté, et sans fausse promesse', () => {
    // Il a 12 gardes de semaine de retard que personne ne lui rendra. Le
    // taire le ferait disparaître d'un tableau qui prétend montrer l'équité ;
    // lui promettre un rattrapage serait un mensonge.
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Anne-Catherine')
    expect(html).toContain('rien — hors rotation')
    expect(html).toContain('Hors rotation (dernier recours)')
    expect(html).toContain('il ne sera pas rattrapé')
  })

  it('celui qui est à sa juste part n’apparaît pas — on ne liste pas pour lister', () => {
    const html = rendre(VAL_D_ALLIER)
    // ⚠️ ANCRE OBLIGATOIRE. Un `not.toContain` seul passe sur une chaîne
    // VIDE : le 13/11, pendant une écriture concurrente, ce test était le
    // SEUL vert d'un fichier où la carte ne rendait plus rien du tout.
    expect(html).toContain('Victor')
    expect(html).not.toContain('Fanny')
  })

  it('la carte dit que le BILAN, lui, attend la clôture', () => {
    // C'est la réponse à la question de MiKL : l'écran doit distinguer les
    // deux, sinon l'absence de bilan se lit comme une absence d'équité.
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('en préparation')
    expect(html).toContain('déjà closes')
  })
})

describe('Rattrapage en préparation — les cas vides ne se taisent pas', () => {
  it('aucune période close : il le DIT, au lieu de rester muet', () => {
    const html = rendre({ cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 0, chantierOuvert: true })
    expect(html).toContain('Aucune période close avant celle-ci')
  })

  it('tout le monde à sa juste part : il le dit AUTREMENT', () => {
    // Deux situations rassurantes, mais pas la même — l'admin doit savoir
    // laquelle il lit.
    const html = rendre({ cumul: {}, report: {}, nbPeriodes: 3, nbPeriodesCloses: 3, chantierOuvert: true })
    expect(html).toContain('à sa juste part sur les 3 périodes closes')
    expect(html).not.toContain('Aucune période close')
  })

  it('UNE PANNE DE LECTURE SE DIT — elle ne se lit pas « rien à rattraper »', () => {
    const html = rendre({ cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 0, chantierOuvert: true, erreur: 'timeout' })
    expect(html).toContain('n’a pas pu être lu')
    expect(html).toContain('ce n’est pas qu’il n’y a rien à rattraper')
    // Le détail technique ne remonte pas à l'admin.
    expect(html).not.toContain('timeout')
  })
})

describe('Rattrapage en préparation — la porte de chantier', () => {
  it('PORTE FERMEE : la carte s’affiche QUAND MEME, et dit sa portée réelle', () => {
    // Le Val d'Allier n'est pas bac à sable (vérifié en base le 13/11).
    // Première version : la carte rendait `null` — donc la demande de MiKL
    // restait non satisfaite exactement là où il l'avait faite, en silence.
    const html = rendre({ ...VAL_D_ALLIER, chantierOuvert: false })
    expect(html).toContain('Ce que le moteur va rattraper')
    expect(html).toContain('ne rattrape que les WEEK-ENDS')
    expect(html).toContain('période précédente')
    // Et elle ne promet PAS le mécanisme que ce cabinet n'a pas.
    expect(html).not.toContain('volontairement étalé')
  })

  it('porte OUVERTE : elle annonce le rattrapage étalé', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('volontairement étalé')
    expect(html).not.toContain('ne rattrape que les WEEK-ENDS')
  })

  it('porte fermée, l’infobulle du bilan ne promet plus de plafond', () => {
    // La carte Bilan, elle, continue de s'afficher : c'est sa colonne de
    // rattrapage qui doit cesser de décrire un mécanisme absent.
    const avecPorte = phraseCumul({ we: 3, semaine: 0, feries: 0 }, 3, false, true)
    const sansPorte = phraseCumul({ we: 3, semaine: 0, feries: 0 }, 3, false, false)
    expect(avecPorte).toContain('volontairement étalé')
    expect(sansPorte).not.toContain('volontairement étalé')
    expect(sansPorte).toContain('3 week-ends de plus')
  })
})

describe('Rattrapage en préparation — deux pièges que la revue a trouvés', () => {
  it('des périodes closes SANS bilan ne se lisent pas « rien à rattraper »', () => {
    // Un bilan n'existe que si quelqu'un a cliqué « Calculer le bilan » ou
    // que le cron a verrouillé. Le cas courant — période précédente publiée,
    // bilan jamais calculé — affichait « Aucune période close avant
    // celle-ci » : une bonne nouvelle fausse, qui masquait en plus le clic
    // qui débloque tout.
    const html = rendre({
      cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 2, chantierOuvert: true,
    })
    expect(html).toContain('2 périodes closes avant celle-ci')
    expect(html).toContain('aucune n’a de bilan calculé')
    expect(html).toContain('Calculer le bilan')
    expect(html).not.toContain('Aucune période close')
  })

  it('un TITULAIRE dont les écarts s’annulent n’est pas déclaré hors rotation', () => {
    // +1 week-end une période, -1 la suivante : cumul nul, donc aucun report
    // enregistré (`construireReport` ne stocke pas un report de zéros). La
    // version qui DEDUISAIT le hors-rotation d'un report absent affirmait
    // alors qu'un titulaire « n'est pas candidat aux gardes ».
    const html = rendre({
      cumul: { fanny: { we: 0, semaine: 0, feries: 0 } },
      report: {},
      nbPeriodes: 2,
      nbPeriodesCloses: 2,
      horsRotation: [], // Fanny n'y est pas : elle EST dans la rotation.
      chantierOuvert: true,
    })
    expect(html).not.toContain('hors rotation')
    expect(html).not.toContain('pas candidat aux gardes')
    // Et elle n'encombre pas le tableau pour autant.
    expect(html).not.toContain('Fanny')
  })
})
