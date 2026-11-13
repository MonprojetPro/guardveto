// ============================================================
// GUARDVETO — Le rattrapage s'affiche AVANT la publication (B-211)
// ============================================================
// MiKL, 13/11 : « je ne peux pas faire le calcul tant qu'une période
// n'est pas publiée, on est d'accord ? c'est dommage que ça n'apparaisse
// pas quand même nan ? »
//
// Le bilan d'une période a besoin que la période soit remplie. Le
// rattrapage, non : il vient des périodes closes d'avant.
//
// ⚠️ CE QUE CES TESTS NE PEUVENT PAS FAIRE, ET QUI A COÛTÉ UNE LIVRAISON.
// La première version est partie avec ces tests au vert, et MiKL l'a
// renvoyée en capture : « c'est quoi ce truc dégueulasse ?! ». Les textes
// étaient justes, la mise en page illisible — des phrases entières dans
// des cellules faites pour des chiffres. Un test de rendu valide ce qui
// est ÉCRIT, jamais ce qui est VU. La vérification visuelle se fait au
// banc (vraies feuilles, 1280 px et 375 px) ; ce fichier ne la remplace
// pas.
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
  { id: 'jean', prenom: 'Jean', nom: 'De Thoisy', couleur: '#555555', statut: 'associe' },
]

/** Les chiffres réels du Val d'Allier, 3 périodes closes (lus en base le 13/11). */
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
  // DONNÉ, jamais déduit : seul le dernier recours y figure.
  horsRotation: ['anne-cat'],
  chantierOuvert: true,
}

const rendre = (livre: GrandLivreAffiche) =>
  renderToStaticMarkup(<RattrapageCard grandLivre={livre} vetsInfo={VETS} />)

describe('Rattrapage en préparation — ce que l’admin voit avant de générer', () => {
  it('la carte existe et dit ce qu’elle montre', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Ce que le moteur va rattraper')
    expect(html).toContain('ce que chacun traîne des périodes closes')
  })

  it('UNE COLONNE PAR DIMENSION, comme le bilan — pas des phrases en cellule', () => {
    // 🔴 La première version mettait une PHRASE dans chaque cellule d'un
    // tableau dont le CSS attend un chiffre (`.count-table td` : centré,
    // gras 0.9rem) : le texte s'empilait sur six lignes, et la colonne
    // « écart réel » réutilisait `.bm-part`, en `white-space: nowrap`,
    // donc elle débordait hors de la carte.
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('<th>Week-ends</th>')
    expect(html).toContain('<th>Nuits de semaine</th>')
    expect(html).toContain('<th>Jours fériés</th>')
    expect(html).not.toContain('1 week-end en moins')
    expect(html).not.toContain('Avant cette période, sur')
  })

  it('Victor voit qu’on lui retire un week-end, et qu’il en reste 3 au total', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Victor')
    expect(html).toContain('−1') // la pastille de cette période
    expect(html).toContain('−3 au total') // ce qui ne se devine pas
  })

  it('Antoine : 5 nuits de retard, 2 rattrapées — le total est DIT', () => {
    expect(rendre(VAL_D_ALLIER)).toContain('−5 au total')
  })

  it('« au total » ne répète PAS la pastille quand tout se rattrape d’un coup', () => {
    // Vu au banc visuel du 13/11 : afficher « −1 » puis « −1 au total »
    // juste dessous, c'était du bruit sur cinq lignes sur sept, et ça
    // noyait les deux cas qui comptaient (Antoine et Victor).
    const html = rendre({
      ...VAL_D_ALLIER,
      cumul: { jean: { we: 1, semaine: 0, feries: 0 } },
      report: { jean: { we: -1, semaine: 0, feries: 0 } },
      horsRotation: [],
    })
    expect(html).toContain('Jean')
    // ⚠️ On vise la MENTION sous la pastille (`bm-part`), pas les mots
    // « au total » tout court : le pied de carte les emploie pour les
    // expliquer. Deuxième fois aujourd'hui qu'une assertion trop large
    // échoue sur la phrase qui décrit ce qu'elle teste.
    expect(html).not.toContain('class="bm-part"')
  })

  it('le dernier recours est NOMMÉ, pas escamoté, et sans fausse promesse', () => {
    // Il a 12 gardes de semaine de retard que personne ne lui rendra. Le
    // taire le ferait disparaître d'un tableau qui prétend montrer
    // l'équité ; lui promettre un rattrapage serait un mensonge.
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Anne-Catherine')
    // Mention discrète sous le nom — une version intermédiaire en faisait
    // un ovale orange de trois lignes, via `.ecart none`.
    expect(html).toContain('hors rotation')
    expect(html).toContain('pas candidat aux gardes')
    // Ses cases portent le tiret de `Ecart`, pas un chiffre inventé.
    expect(html).toContain('Dernier recours : hors répartition')
  })

  it('celui qui est à sa juste part n’apparaît pas — on ne liste pas pour lister', () => {
    const html = rendre(VAL_D_ALLIER)
    // ⚠️ ANCRE OBLIGATOIRE. Un `not.toContain` seul passe sur une chaîne
    // VIDE : le 13/11, pendant une écriture concurrente, ce test était le
    // SEUL vert d'un fichier où la carte ne rendait plus rien du tout.
    expect(html).toContain('Victor')
    expect(html).not.toContain('Fanny')
  })

  it('la carte dit d’où viennent les chiffres et ce que les signes veulent dire', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('périodes déjà closes')
    expect(html).toContain('une garde <b>en moins</b>')
  })
})

describe('Rattrapage en préparation — les cas vides ne se taisent pas', () => {
  const vide = (p: Partial<GrandLivreAffiche>) =>
    rendre({
      cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 0,
      horsRotation: [], chantierOuvert: true, ...p,
    })

  it('aucune période close : il le DIT, au lieu de rester muet', () => {
    expect(vide({})).toContain('Aucune période close avant celle-ci')
  })

  it('tout le monde à sa juste part : il le dit AUTREMENT', () => {
    const html = vide({ nbPeriodes: 3, nbPeriodesCloses: 3 })
    expect(html).toContain('à sa juste part sur les 3 périodes closes')
    expect(html).not.toContain('Aucune période close')
  })

  it('des périodes closes SANS bilan ne se lisent pas « rien à rattraper »', () => {
    // Un bilan n'existe que si quelqu'un a cliqué « Calculer le bilan » ou
    // que le cron a verrouillé. Le cas courant — période précédente
    // publiée, bilan jamais calculé — affichait « Aucune période close » :
    // une bonne nouvelle fausse, qui masquait le clic qui débloque tout.
    const html = vide({ nbPeriodesCloses: 2 })
    expect(html).toContain('2 périodes closes avant celle-ci')
    expect(html).toContain('aucune n’a de bilan calculé')
    expect(html).toContain('Calculer le bilan')
    expect(html).not.toContain('Aucune période close')
  })

  it('UNE PANNE DE LECTURE SE DIT — elle ne se lit pas « rien à rattraper »', () => {
    const html = vide({ erreur: 'timeout' })
    expect(html).toContain('n’a pas pu être lu')
    expect(html).toContain('ce n’est pas qu’il n’y a rien à rattraper')
    // Le détail technique ne remonte pas à l'admin.
    expect(html).not.toContain('timeout')
  })
})

describe('Rattrapage en préparation — la porte de chantier', () => {
  it('PORTE FERMÉE : la carte s’affiche quand même, et dit sa portée réelle', () => {
    // Le Val d'Allier n'est pas bac à sable (vérifié en base le 13/11).
    // Une version intermédiaire rendait `null` : la demande de MiKL
    // restait non satisfaite exactement là où il l'avait faite, en
    // silence, avec un div vide de 26 px à la place.
    const html = rendre({ ...VAL_D_ALLIER, chantierOuvert: false })
    expect(html).toContain('Ce que le moteur va rattraper')
    expect(html).toContain('ne rattrape que les week-ends')
    expect(html).toContain('période précédente')
    // Il ne promet PAS le mécanisme que ce cabinet n'a pas...
    expect(html).not.toContain('Le rattrapage est étalé')
    // ...et n'affiche pas les colonnes que son moteur n'honore pas.
    expect(html).not.toContain('<th>Nuits de semaine</th>')
    expect(html).not.toContain('<th>Jours fériés</th>')
  })

  it('porte OUVERTE : elle annonce le rattrapage étalé, et ses trois colonnes', () => {
    const html = rendre(VAL_D_ALLIER)
    expect(html).toContain('Le rattrapage est étalé')
    expect(html).toContain('<th>Nuits de semaine</th>')
    expect(html).not.toContain('ne rattrape que les week-ends')
  })

  it('porte fermée, l’infobulle du bilan ne promet plus de plafond', () => {
    // `phraseCumul` sert encore les infobulles de `BonusMalusCard`.
    const avec = phraseCumul({ we: 3, semaine: 0, feries: 0 }, 3, false, true)
    const sans = phraseCumul({ we: 3, semaine: 0, feries: 0 }, 3, false, false)
    expect(avec).toContain('volontairement étalé')
    expect(sans).not.toContain('volontairement étalé')
    expect(sans).toContain('3 week-ends de plus')
  })
})

describe('Rattrapage en préparation — un piège que la revue a trouvé', () => {
  it('un TITULAIRE dont les écarts s’annulent n’est pas déclaré hors rotation', () => {
    // +1 week-end une période, −1 la suivante : cumul nul, donc aucun
    // report enregistré (`construireReport` ne stocke pas un report de
    // zéros). La version qui DÉDUISAIT le hors-rotation d'un report
    // absent affirmait alors qu'une titulaire « n'est pas candidate aux
    // gardes », dans l'écran dont le métier est l'équité.
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
    expect(html).not.toContain('Fanny')
    // Ancre : la carte a bien rendu quelque chose.
    expect(html).toContain('Ce que le moteur va rattraper')
  })
})
