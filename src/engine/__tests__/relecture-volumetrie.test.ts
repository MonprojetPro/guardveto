// ============================================================
// B-096 — COMBIEN DE MOUVEMENTS SUR UNE VRAIE PÉRIODE ?
// ============================================================
// Le calcul est combinatoire, et chaque mouvement est ensuite SCORÉ sur le
// planning entier. Deux choses peuvent casser en production, et aucune ne se
// voit sur les petits plannings des autres tests :
//
//   • le temps de calcul de la relecture ;
//   • la taille du dossier envoyé au modèle — au-delà d'un certain volume, le
//     signal se noie et le budget de jetons explose.
//
// Ce projet a déjà payé une bombe de ce type : la synchronisation d'agenda
// calibrée sur une période à moitié vide, qui frôlait les 60 s de budget sur
// une période pleine (B-083). On mesure donc sur la forme RÉELLE d'une période
// d'hiver : 12 semaines, 4 soirs + 1 week-end + 1 vendredi par semaine, 6
// vétérinaires, 2 places par créneau.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  mouvementsPossibles, prioriserMouvements, PLAFOND_MOUVEMENTS,
} from '../relecture/mouvements'
import { effetsDesMouvements } from '../relecture/effet'
import { personnesAuxExtremes } from '../relecture/cibles'
import { normaliserContraintesVets } from '../normaliserContraintes'
import type { PlanningPartiel, VetEngine } from '../types'

const EQUIPE: VetEngine[] = ['Antoine', 'Fanny', 'Jean', 'Manon', 'Victor', 'AnneSo'].map(
  (prenom, i) => ({
    id: `v${i}`, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
  }),
)

const DEBUT = '2026-10-19' // un lundi
const SEMAINES = 12

function plusJours(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Une période d'hiver de forme réaliste, remplie en rotation. */
function periodeComplete(): PlanningPartiel {
  const attributions: PlanningPartiel['attributions'] = []
  let n = 0
  const duo = () => {
    const a = EQUIPE[n % EQUIPE.length].id
    const b = EQUIPE[(n + 2) % EQUIPE.length].id
    n += 1
    return [a, b] as const
  }

  for (let s = 0; s < SEMAINES; s++) {
    const lundi = plusJours(DEBUT, s * 7)
    for (let j = 0; j < 4; j++) {
      const [a, b] = duo()
      attributions.push({
        date: plusJours(lundi, j), type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: a }, { role: 'second', vetId: b }],
      })
    }
    // Le vendredi et le samedi portent le MÊME binôme, rôles inversés.
    const [a, b] = duo()
    attributions.push({
      date: plusJours(lundi, 4), type: 'vendredi_soir',
      placements: [{ role: 'premier', vetId: a }, { role: 'second', vetId: b }],
    })
    attributions.push({
      date: plusJours(lundi, 5), type: 'weekend',
      placements: [{ role: 'premier', vetId: b }, { role: 'second', vetId: a }],
    })
  }
  return { attributions }
}

describe('volumétrie sur une période d’hiver complète', () => {
  it('reste dans un volume que le dossier peut porter', () => {
    const planning = periodeComplete()
    const cibles = personnesAuxExtremes(planning, { vets: EQUIPE })

    const mouvements = mouvementsPossibles(planning, {
      vets: EQUIPE,
      dateDebut: DEBUT,
      dateFin: plusJours(DEBUT, SEMAINES * 7),
      saison: 'hiver',
      nbVetosSemaineSoir: 2,
      vetsCibles: cibles,
    })

    // Repère mesuré, pas une cible : si ce nombre explose un jour, le dossier
    // noiera le signal et il faudra borner EXPLICITEMENT (jamais en silence).
    // Le seuil est large exprès — il n'est là que pour attraper un emballement.
    expect(mouvements.length).toBeGreaterThan(0)

    // MESURE du 02/09 sur cette forme : 3012 mouvements bruts, dont 2736
    // échanges simples — ceux-là existaient déjà depuis B-093. Le dossier
    // envoyé à Filou le matin même en contenait donc des milliers, et il
    // choisissait dans une liste illisible. C'est ce que `prioriserMouvements`
    // corrige ; ce test-ci garde la mesure BRUTE pour que la comparaison reste
    // possible, et pour attraper un emballement d'un autre ordre.
    expect(mouvements.length).toBeLessThan(6000)
  })

  it('la liste PRIORISÉE tient dans un dossier lisible', () => {
    const planning = periodeComplete()
    const bruts = mouvementsPossibles(planning, {
      vets: EQUIPE,
      dateDebut: DEBUT,
      dateFin: plusJours(DEBUT, SEMAINES * 7),
      saison: 'hiver',
      nbVetosSemaineSoir: 2,
      vetsCibles: personnesAuxExtremes(planning, { vets: EQUIPE }),
    })

    const { retenus, ecartes } = prioriserMouvements(bruts)

    expect(retenus.length).toBeLessThanOrEqual(PLAFOND_MOUVEMENTS)
    expect(retenus.length + ecartes).toBe(bruts.length)
    expect(ecartes).toBeGreaterThan(0) // sur cette forme, ça coupe vraiment

    // Les leviers RARES passent tous : ce sont les seuls qui allègent
    // quelqu'un ou font tourner un rôle. Les noyer dans les échanges simples
    // reviendrait à ne pas les avoir livrés.
    const rares = bruts.filter((m) => m.genre !== 'echange_simple')
    const raresRetenus = retenus.filter((m) => m.genre !== 'echange_simple')
    expect(raresRetenus.length).toBe(rares.length)
  })

  it('le scoring de tous les mouvements tient en quelques secondes', () => {
    const planning = periodeComplete()
    const cibles = personnesAuxExtremes(planning, { vets: EQUIPE })
    const mouvements = mouvementsPossibles(planning, {
      vets: EQUIPE,
      dateDebut: DEBUT,
      dateFin: plusJours(DEBUT, SEMAINES * 7),
      saison: 'hiver',
      nbVetosSemaineSoir: 2,
      vetsCibles: cibles,
    })

    // `scorerPlanning` parcourt toutes les attributions et toutes les règles,
    // une fois par mouvement. C'est le coût qu'il faut surveiller : la relecture
    // tourne DANS le parcours de génération, l'admin attend devant l'écran.
    const debut = performance.now()
    const { retenus } = prioriserMouvements(mouvements)
    const effets = effetsDesMouvements(planning, retenus, {
      vets: normaliserContraintesVets(EQUIPE),
      saison: 'hiver',
    })
    const duree = performance.now() - debut

    expect(effets).toHaveLength(retenus.length)
    expect(duree).toBeLessThan(20_000)
  })
})
