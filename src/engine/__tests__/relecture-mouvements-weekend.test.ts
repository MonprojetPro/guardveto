// ============================================================
// B-096 — LES WEEK-ENDS ÉTAIENT HORS DE PORTÉE DE FILOU
// ============================================================
// MiKL, le 2026-09-02, après la relecture réelle de Hiver P2 : huit constats,
// huit fois « il ne voit pas de correction automatique ». Filou nomme lui-même
// la cause dans son rapport :
//
//     « Aucun échange de rôle week-end n'est proposé par le moteur dans la
//       liste fournie, donc je ne peux pas corriger ce point moi-même sans
//       casser l'inversion vendredi/week-end. »
//
// ── LE DÉFAUT, PLUS LARGE QUE CE QU'IL DÉCRIT ───────────────────────────────
//
// Le week-end est lié à son vendredi par DEUX relations dures : `meme_binome`
// (les mêmes deux personnes) et `inversion_role` (le 1er du vendredi est le 2nd
// du week-end). `echangesPossibles` ne bouge que DEUX places. Toucher une place
// de week-end sans toucher le vendredi apparié casse donc le binôme, et
// `isValid` refuse — quel que soit l'échange, quelles que soient les personnes.
//
// Ce n'est donc pas « les échanges de RÔLE de week-end » qui manquent :
// AUCUNE place de week-end ni de vendredi n'est atteignable. Or c'est là que
// vivent les deux déséquilibres que MiKL a vus (l'avantage financier du 1er de
// week-end, et Antoine à 5 week-ends contre 3 à Fanny).
//
// Les deux premiers tests REPRODUISENT ce défaut : ils passent avant le
// correctif, et doivent continuer à passer après — `echangesPossibles` n'est
// pas modifiée, elle reste juste dans son périmètre (deux places). Le correctif
// est un ÉLARGISSEMENT, pas une correction de cette fonction-là.
// ============================================================

import { describe, it, expect } from 'vitest'
import { echangesPossibles } from '../relecture/echanges'
import { mouvementsPossibles, type MouvementPossible } from '../relecture/mouvements'
import type { PlanningPartiel, VetEngine } from '../types'

// 2025-11-07 = vendredi · 08 = samedi · 14 = vendredi · 15 = samedi
const VEN1 = '2025-11-07', SAM1 = '2025-11-08'
const VEN2 = '2025-11-14', SAM2 = '2025-11-15'
const LUN = '2025-11-10', MER = '2025-11-12'

function vet(id: string, prenom: string, extra: Partial<VetEngine> = {}): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
    ...extra,
  }
}

const EQUIPE = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'), vet('v4', 'David')]

function options(vets: VetEngine[] = EQUIPE, cibles?: string[]) {
  return {
    vets,
    dateDebut: VEN1,
    dateFin: SAM2,
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
    vetsCibles: cibles,
  }
}

/**
 * Deux week-ends complets, chacun avec son vendredi, RÔLES INVERSÉS comme le
 * moteur les produit : le 1er du vendredi est le 2nd du week-end.
 *
 *   week-end 1 : Alice / Bob      week-end 2 : Carol / David
 */
function planningDeuxWeekends(): PlanningPartiel {
  return {
    attributions: [
      {
        date: VEN1, type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' }],
      },
      {
        date: SAM1, type: 'weekend',
        placements: [{ role: 'premier', vetId: 'v2' }, { role: 'second', vetId: 'v1' }],
      },
      {
        date: VEN2, type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: 'v3' }, { role: 'second', vetId: 'v4' }],
      },
      {
        date: SAM2, type: 'weekend',
        placements: [{ role: 'premier', vetId: 'v4' }, { role: 'second', vetId: 'v3' }],
      },
    ],
  }
}

/** Les mêmes deux week-ends, plus deux soirs de semaine ordinaires. */
function planningComplet(): PlanningPartiel {
  return {
    attributions: [
      ...planningDeuxWeekends().attributions,
      {
        date: LUN, type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v3' }],
      },
      {
        date: MER, type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v2' }, { role: 'second', vetId: 'v4' }],
      },
    ],
  }
}

/** Les personnes affectées à chaque place, après application du mouvement. */
function apres(m: MouvementPossible): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of m.affectations) out[`${a.date}|${a.type}|${a.role}`] = a.vetId
  return out
}

// ── ① LE DÉFAUT REPRODUIT ───────────────────────────────────────────────────

describe('le défaut : les week-ends sont hors de portée des échanges à deux places', () => {
  it('aucun échange proposé ne touche une place de week-end ou de vendredi', () => {
    const e = echangesPossibles(planningComplet(), options())
    const touchePasWE = e.every(
      (x) => x.a.type === 'semaine_soir' && x.b.type === 'semaine_soir',
    )
    expect(touchePasWE).toBe(true)
  })

  it('sur un planning qui ne contient QUE des week-ends, la liste est vide', () => {
    // La démonstration nue : quatre places occupées par quatre personnes
    // différentes, aucune contrainte individuelle, et pourtant rien.
    expect(echangesPossibles(planningDeuxWeekends(), options())).toEqual([])
  })
})

// ── ② CE QUE LE CORRECTIF DOIT RENDRE POSSIBLE ──────────────────────────────

describe('mouvementsPossibles — inversion des rôles au sein d’un week-end', () => {
  it('propose d’inverser Alice et Bob sur leur week-end, vendredi compris', () => {
    const m = mouvementsPossibles(planningDeuxWeekends(), options())
    const inversions = m.filter((x) => x.genre === 'inversion_roles_weekend')

    const surSam1 = inversions.find((x) =>
      x.affectations.some((a) => a.date === SAM1),
    )
    expect(surSam1).toBeDefined()

    // QUATRE places, pas deux : le vendredi suit obligatoirement.
    expect(surSam1!.affectations).toHaveLength(4)
    expect(apres(surSam1!)).toEqual({
      [`${SAM1}|weekend|premier`]: 'v1', // Alice devient 1re du week-end
      [`${SAM1}|weekend|second`]: 'v2',
      [`${VEN1}|vendredi_soir|premier`]: 'v2', // et l’inversion tient au vendredi
      [`${VEN1}|vendredi_soir|second`]: 'v1',
    })
  })

  it('l’inversion garde le MÊME binôme — elle ne fait tourner que les rôles', () => {
    const m = mouvementsPossibles(planningDeuxWeekends(), options())
    for (const x of m.filter((y) => y.genre === 'inversion_roles_weekend')) {
      const dates = new Set(x.affectations.map((a) => a.date))
      for (const d of dates) {
        const avant = planningDeuxWeekends().attributions.find((a) => a.date === d)!
        const gensAvant = new Set(avant.placements.map((p) => p.vetId))
        const gensApres = new Set(
          x.affectations.filter((a) => a.date === d).map((a) => a.vetId),
        )
        expect([...gensApres].sort()).toEqual([...gensAvant].sort())
      }
    }
  })
})

describe('mouvementsPossibles — échange de personnes entre deux week-ends', () => {
  it('propose d’échanger Alice et Carol d’un week-end à l’autre, vendredis compris', () => {
    const m = mouvementsPossibles(planningDeuxWeekends(), options())
    const echanges = m.filter((x) => x.genre === 'echange_weekend')
    expect(echanges.length).toBeGreaterThan(0)

    // Chacun de ces mouvements porte QUATRE affectations : deux week-ends et
    // leurs deux vendredis. Un mouvement à trois places serait un binôme cassé.
    for (const x of echanges) expect(x.affectations).toHaveLength(4)

    const alicePartAuSecondWeekend = echanges.some((x) => {
      const a = apres(x)
      return a[`${SAM2}|weekend|second`] === 'v1' || a[`${SAM2}|weekend|premier`] === 'v1'
    })
    expect(alicePartAuSecondWeekend).toBe(true)
  })

  it('après l’échange, chaque personne présente le samedi l’est aussi le vendredi', () => {
    // C'est la règle `meme_binome`, celle qui faisait tout refuser. Si un
    // mouvement la cassait, `isValid` le rejetterait — mais on le vérifie
    // AUSSI ici, parce qu'un mouvement mal formé serait rejeté SILENCIEUSEMENT
    // et on retomberait sur « aucun échange possible » sans savoir pourquoi.
    const m = mouvementsPossibles(planningDeuxWeekends(), options())
    for (const x of m.filter((y) => y.genre === 'echange_weekend')) {
      const a = apres(x)
      for (const [sam, ven] of [[SAM1, VEN1], [SAM2, VEN2]] as const) {
        const auSamedi = [a[`${sam}|weekend|premier`], a[`${sam}|weekend|second`]]
        const auVendredi = [a[`${ven}|vendredi_soir|premier`], a[`${ven}|vendredi_soir|second`]]
        if (auSamedi.every(Boolean)) {
          expect([...auSamedi].sort()).toEqual([...auVendredi].sort())
        }
      }
    }
  })

  it('l’inversion des rôles est respectée : 1er du vendredi = 2nd du week-end', () => {
    const m = mouvementsPossibles(planningDeuxWeekends(), options())
    for (const x of m) {
      const a = apres(x)
      for (const [sam, ven] of [[SAM1, VEN1], [SAM2, VEN2]] as const) {
        const premierWE = a[`${sam}|weekend|premier`]
        const secondVen = a[`${ven}|vendredi_soir|second`]
        if (premierWE && secondVen) expect(premierWE).toBe(secondVen)
      }
    }
  })
})

// ── ③ LE FILTRE NE DOIT NI TOUT PRENDRE NI TOUT JETER ───────────────────────

describe('mouvementsPossibles — le ciblage', () => {
  it('ne rend que les mouvements impliquant une personne ciblée', () => {
    const m = mouvementsPossibles(planningDeuxWeekends(), options(EQUIPE, ['v1']))
    expect(m.length).toBeGreaterThan(0)
    for (const x of m) {
      // Le mouvement doit toucher Alice, soit parce qu'elle bouge, soit parce
      // qu'on lui donne une place.
      const concerne = x.affectations.some((a) => a.vetId === 'v1')
      expect(concerne).toBe(true)
    }
  })

  it('un ciblage sur quelqu’un qui n’a aucun week-end ne rend aucun mouvement de week-end', () => {
    const m = mouvementsPossibles(planningDeuxWeekends(), options(EQUIPE, ['v9']))
    expect(m).toEqual([])
  })

  it('sans ciblage, les échanges simples de semaine restent rendus', () => {
    // Non-régression : `mouvementsPossibles` ENGLOBE `echangesPossibles`, elle
    // ne la remplace pas. Perdre les échanges de semaine en gagnant ceux de
    // week-end serait un troc, pas un progrès.
    const m = mouvementsPossibles(planningComplet(), options())
    const simples = m.filter((x) => x.genre === 'echange_simple')
    expect(simples.length).toBe(echangesPossibles(planningComplet(), options()).length)
  })
})

// ── ④ LA LÉGALITÉ RESTE LE DERNIER MOT ──────────────────────────────────────

describe('mouvementsPossibles — le moteur garde le veto', () => {
  it('un week-end interdit à quelqu’un ne lui est jamais proposé', () => {
    // Carol ne peut pas travailler le samedi 8 : aucun mouvement ne doit l'y
    // amener. C'est le contrat de tout ce module — ce qui sort d'ici est ce que
    // `isValid` accepte, jamais une estimation.
    const carolIndisponible = vet('v3', 'Carol', {
      conges: [{ date_debut: SAM1, date_fin: SAM1, type: 'vacances' }],
    })
    const equipe = [EQUIPE[0], EQUIPE[1], carolIndisponible, EQUIPE[3]]
    const m = mouvementsPossibles(planningDeuxWeekends(), options(equipe))
    for (const x of m) {
      const a = apres(x)
      expect(a[`${SAM1}|weekend|premier`]).not.toBe('v3')
      expect(a[`${SAM1}|weekend|second`]).not.toBe('v3')
    }
  })
})
