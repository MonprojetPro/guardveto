// ============================================================
// Un repos « plusieurs jours + une semaine sur deux » tient-il sur une
// GÉNÉRATION COMPLÈTE ?
// ============================================================
// LA QUESTION — MiKL, le 2026-08-26 : « t'es sûr que ça fonctionne bien au
// niveau du moteur, cette nouvelle règle ? Vérifie. »
//
// Question légitime. Les épreuves de `tests/lib/repos-fixe-semaine-sur-deux`
// interrogent le gardien créneau par créneau : « ce jeudi-là, acceptes-tu ? ».
// C'est nécessaire et ce n'est pas suffisant. Une règle peut être respectée à
// chaque interrogation isolée et sauter au moment où le solver, coincé,
// réattribue en cascade — ou n'être jamais interrogée du tout sur certains
// chemins d'attribution.
//
// Ce test-ci fait donc tourner la GÉNÉRATION ENTIÈRE — quatre semaines, sept
// vétérinaires, tous les créneaux — puis regarde le planning produit et compte.
// Ce n'est plus « le gardien dit non », c'est « le planning livré ne contient
// pas la garde interdite ».
//
// Trois faits sont vérifiés, et le troisième est le discriminant :
//   ① la génération aboutit malgré la règle (elle ne casse pas le planning) ;
//   ② ZÉRO garde les jours visés, en semaine paire ;
//   ③ il en a bien, LES MÊMES JOURS, en semaine impaire.
//
// Sans ③, un moteur qui interdirait bêtement le lundi et le mercredi de TOUTE
// la période passerait ①②. La parité ne serait pas lue, et rien ne le dirait.
//
// Le validateur indépendant est interrogé en dernier : les deux gardiens ont
// déjà divergé sur ce projet, et c'est ce genre de test qui l'avait révélé.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { estAttribue } from '@/engine/attribution'
import { construireParams } from '@/lib/regles/paramsRegle'
import { jourDeLaSemaine, estSemaineImpaire } from '@/engine/utils'
import type { VetEngine, ContrainteEngine } from '@/engine/types'

import hiverStandard from './scenarios/hiver-standard.json'

const CIBLE = 'h-v1'
const JOURS_INTERDITS = ['lundi', 'mercredi']

// La règle est construite par le MÊME code que le formulaire. Écrire ici un
// objet à la main testerait une forme que l'écran ne produit peut-être pas —
// c'est précisément le raccord dont MiKL doute.
const sortie = construireParams(
  {
    brique_id: 'interdire_creneau',
    owner_id: CIBLE,
    force: 'jamais',
    jours: JOURS_INTERDITS,
    semaine: 'paire',
    exception_vacances_scolaires: false,
  },
  new Set(['semaine_soir', 'vendredi_soir', 'weekend']),
)
if ('error' in sortie) throw new Error(`Le formulaire refuse la règle : ${sortie.error}`)

const regle: ContrainteEngine = {
  id: 'gen-b041',
  type: 'jour_repos_fixe',
  actif: true,
  // `force: 2` = interdiction ferme, l'étage posé par le formulaire pour
  // « jamais ». Les params sont ceux de l'écran, à l'identique.
  config: {
    brique: 'interdire_creneau',
    force: 2,
    params: sortie.params,
    ...sortie.params,
  },
} as unknown as ContrainteEngine

const vets = (hiverStandard.vets as unknown as VetEngine[]).map((v) =>
  v.id === CIBLE ? { ...v, contraintes: [regle] } : v,
)

const input: SolverInput = {
  dateDebut: hiverStandard.periode.dateDebut,
  dateFin: hiverStandard.periode.dateFin,
  saison: hiverStandard.periode.saison as 'hiver',
  vets,
  bonusMalus: {},
}

const result = genererPlanningPur(input)

describe('Repos multi-jours + parité — sur une génération complète (B-041)', () => {
  it('① la génération aboutit : la règle ne casse pas le planning', () => {
    expect(
      result.success,
      'La période devient insoluble avec cette règle — ce serait un refus à ' +
        'annoncer à l’admin, pas un planning silencieusement bancal.',
    ).toBe(true)
  })

  it('② ZÉRO garde les jours visés en semaine PAIRE', () => {
    if (!result.success) return
    const fautes = result.planning.attributions
      .filter((a) => estAttribue(a, CIBLE))
      .filter((a) => JOURS_INTERDITS.includes(jourDeLaSemaine(a.date)))
      .filter((a) => !estSemaineImpaire(a.date))

    expect(
      fautes.map((a) => `${a.date} (${jourDeLaSemaine(a.date)})`),
      'Le planning livré contient des gardes que la règle interdit.',
    ).toEqual([])
  })

  it('③ il EN A les mêmes jours en semaine impaire — sinon la parité est ignorée', () => {
    if (!result.success) return
    const enImpaire = result.planning.attributions
      .filter((a) => estAttribue(a, CIBLE))
      .filter((a) => JOURS_INTERDITS.includes(jourDeLaSemaine(a.date)))
      .filter((a) => estSemaineImpaire(a.date))

    // LE discriminant. Un moteur qui bloquerait le lundi et le mercredi de
    // toute la période passerait ① et ② sans lire la parité une seule fois.
    expect(
      enImpaire.length,
      'Aucune garde les jours visés en semaine impaire : la règle se comporte ' +
        'comme un repos de TOUTES les semaines, la parité n’est pas lue.',
    ).toBeGreaterThan(0)
  })

  it('④ le validateur indépendant ne signale aucune violation R1', () => {
    if (!result.success) return
    const violations = validerPlanning(result.planning, input)
    expect(
      violations.filter((v) => v.regle === 'R1' && v.vetId === CIBLE),
      'Le second gardien voit une violation que le moteur n’a pas vue : les ' +
        'deux ne lisent pas la règle de la même façon.',
    ).toEqual([])
  })

  it('⑤ les DEUX jours sont réellement couverts, pas seulement le premier', () => {
    if (!result.success) return
    // Un bug qui ne garderait que la première entrée de `regles` laisserait
    // passer le mercredi. On vérifie chaque jour séparément, sinon un total à
    // zéro sur l'un masquerait l'autre.
    for (const jour of JOURS_INTERDITS) {
      const fautes = result.planning.attributions
        .filter((a) => estAttribue(a, CIBLE))
        .filter((a) => jourDeLaSemaine(a.date) === jour && !estSemaineImpaire(a.date))
      expect(fautes.length, `Gardes en semaine paire un ${jour} : la règle ne couvre pas ce jour.`).toBe(0)
    }
  })
})
