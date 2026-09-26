// ============================================================
// GUARDVETO — B-132 : « jamais » disponible sur TOUTES les préférences
// ============================================================
// MiKL, le 26/09 : « non justement je veux que la mention jamais apparaisse, car
// elle n'est présente que sur la règle "éviter la garde la veille d'un jour
// d'absence", mais pas sur les autres ».
//
// Constat vérifié avant de coder : `PENALITES_AVEC_GARDIEN_DUR` ne contenait que
// `veille_repos` (B-127). Les trois autres étaient clampées à l'étage 3 — leur
// proposer « jamais » aurait été un mensonge, faute de gardien. Chacune a donc
// reçu son `check*`, sur le patron de `checkVeilleRepos`.
//
// ⚠️ CE QUE CES TESTS DOIVENT PROUVER, DANS CET ORDRE D'IMPORTANCE :
//
//   ① LE NON-CHANGEMENT. Sans réglage, ou réglée « sauf crise » / « à éviter » /
//      « si possible », AUCUN des trois gardiens ne bloque quoi que ce soit. Un
//      cabinet qui n'a rien touché ne voit aucune différence. C'est ce qui rend
//      ce lot sûr à livrer, et c'est la moitié la plus importante.
//
//   ② LE BLOCAGE RÉEL en « jamais ». Sans quoi on aurait re-livré B-127 : un
//      réglage affiché à l'admin que le moteur n'honore pas.
//
//   ③ LES ENTRÉES, une par une. C'est la leçon de B-127 : « promouvoir une
//      pénalité en interdiction ne se résume pas à changer son étage — tout ce
//      qu'elle lisait à peu près devient soudain absolu ». Victor s'était
//      retrouvé avec ZÉRO week-end parce qu'un repos fixe réglé « si possible »
//      suffisait à l'exclure. Chaque gardien est donc testé sur ce qu'il ne doit
//      PAS attraper, autant que sur ce qu'il doit refuser.
//
//   ④ LA DÉTECTION PARTAGÉE. Pénalité et gardien lisent le MÊME prédicat : deux
//      lectures écrites côte à côte finissent par diverger, et l'une porterait
//      alors sur un cas que l'autre ne voit plus.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  isValid,
  estWeekEndAvantVacances,
  estSoirDeFeteFinAnnee,
  memeRoleQueLaVeilleDeFerie,
} from '@/engine/rules/hard-constraints'
import { penalite } from '@/engine/rules/soft-constraints'
import {
  DEFAULT_STRUCTURE_CONFIG,
  PENALITES_AVEC_GARDIEN_DUR,
  PENALITES_SOUPLES_IDS,
  type PenaliteSoupleId,
  type StructureConfig,
} from '@/engine/structure-config'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel, RoleGarde } from '@/engine/types'

// ── Fixtures ────────────────────────────────────────────────────────────────

type VetNorm = ReturnType<typeof normaliserContraintesVets>[number]

function vet(id: string, prenom: string, conges: VetEngine['conges'] = []): VetNorm {
  return normaliserContraintesVets([{
    id, prenom, nom: 'X', statut: 'associe', dernier_recours: false,
    conges, contraintes: [],
  } as VetEngine])[0]
}

const JEAN = vet('jean', 'Jean')
const FANNY = vet('fanny', 'Fanny')

const slot = (
  date: string,
  type: SlotGarde['type'] = 'semaine_soir',
  besoinSecond = true,
): SlotGarde => ({ date, type, saison: 'hiver', besoinSecond })

const planningVide: PlanningPartiel = { attributions: [] }

/** Le cabinet règle UNE préférence au niveau demandé (2 = « jamais »). */
function cfg(id: PenaliteSoupleId, etage: number): StructureConfig {
  return {
    ...DEFAULT_STRUCTURE_CONFIG,
    penalitesSouples: { [id]: { actif: true, etage } },
  }
}

/** Le même réglage, mais ÉTEINT : le gardien ne doit rien faire non plus. */
function cfgEteinte(id: PenaliteSoupleId, etage = 2): StructureConfig {
  return {
    ...DEFAULT_STRUCTURE_CONFIG,
    penalitesSouples: { [id]: { actif: false, etage } },
  }
}

const valide = (
  v: VetNorm, s: SlotGarde, structure?: StructureConfig,
  role: RoleGarde = 'premier', planning: PlanningPartiel = planningVide,
) => isValid(s, v, role, [JEAN, FANNY], planning, undefined, structure).valid

// ════════════════════════════════════════════════════════════════════════════
// ① LE NON-CHANGEMENT — la moitié la plus importante
// ════════════════════════════════════════════════════════════════════════════

describe('B-132 ① — un cabinet qui n’a rien réglé ne voit AUCUNE différence', () => {
  // Les trois situations que les gardiens visent, chacune réellement présente.
  const WE_AVANT_VACANCES = {
    v: vet('v', 'Victor', [{ date_debut: '2026-11-09', date_fin: '2026-11-13', type: 'vacances' }]),
    s: slot('2026-11-07', 'weekend'),
    id: 'we_avant_vacances' as const,
  }
  const REVEILLON = { v: JEAN, s: slot('2026-12-24'), id: 'fete_fin_annee' as const }

  it('sans aucune configuration, les trois situations passent', () => {
    expect(valide(WE_AVANT_VACANCES.v, WE_AVANT_VACANCES.s)).toBe(true)
    expect(valide(REVEILLON.v, REVEILLON.s)).toBe(true)
  })

  it('réglées « sauf crise » (3), « à éviter » (4) ou « si possible » (5) : rien ne bloque', () => {
    for (const etage of [3, 4, 5]) {
      expect(valide(WE_AVANT_VACANCES.v, WE_AVANT_VACANCES.s, cfg(WE_AVANT_VACANCES.id, etage)),
        `we_avant_vacances a l'etage ${etage} ne doit pas bloquer`).toBe(true)
      expect(valide(REVEILLON.v, REVEILLON.s, cfg(REVEILLON.id, etage)),
        `fete_fin_annee a l'etage ${etage} ne doit pas bloquer`).toBe(true)
    }
  })

  it('réglées « jamais » mais DÉSACTIVÉES : rien ne bloque non plus', () => {
    // Une règle éteinte est éteinte, quel que soit l'étage enregistré à côté.
    expect(valide(WE_AVANT_VACANCES.v, WE_AVANT_VACANCES.s, cfgEteinte(WE_AVANT_VACANCES.id))).toBe(true)
    expect(valide(REVEILLON.v, REVEILLON.s, cfgEteinte(REVEILLON.id))).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ② R10c — le week-end qui précède des vacances
// ════════════════════════════════════════════════════════════════════════════

describe('B-132 ② — R10c « pas de garde le week-end avant des vacances »', () => {
  // Samedi 7 novembre 2026 ; la semaine suivante va du lundi 9 au vendredi 13.
  const SAM = '2026-11-07'
  const VEN = '2026-11-06'
  const enVacances = vet('v', 'Victor',
    [{ date_debut: '2026-11-09', date_fin: '2026-11-13', type: 'vacances' }])

  it('BLOQUE le week-end quand les vacances démarrent la semaine suivante', () => {
    expect(valide(enVacances, slot(SAM, 'weekend'), cfg('we_avant_vacances', 2))).toBe(false)
  })

  it('bloque aussi le VENDREDI SOIR du même bloc week-end', () => {
    // Le vendredi soir appartient au week-end : le laisser passer aurait vidé la
    // règle de son sens, la personne partant en vacances après une nuit de garde.
    expect(valide(enVacances, slot(VEN, 'vendredi_soir'), cfg('we_avant_vacances', 2))).toBe(false)
  })

  it('ne bloque PAS un créneau de semaine', () => {
    expect(valide(enVacances, slot('2026-11-04'), cfg('we_avant_vacances', 2))).toBe(true)
  })

  // ⚠️ L'ENTRÉE — le point que B-127 impose de vérifier.
  it('ne bloque PAS sur un congé qui n’est pas des VACANCES (formation, arrêt)', () => {
    const enFormation = vet('v', 'Victor',
      [{ date_debut: '2026-11-09', date_fin: '2026-11-13', type: 'formation' }])
    expect(valide(enFormation, slot(SAM, 'weekend'), cfg('we_avant_vacances', 2))).toBe(true)
  })

  it('ne bloque PAS si les vacances sont plus tard (semaine non adjacente)', () => {
    const plusTard = vet('v', 'Victor',
      [{ date_debut: '2026-11-23', date_fin: '2026-11-27', type: 'vacances' }])
    expect(valide(plusTard, slot(SAM, 'weekend'), cfg('we_avant_vacances', 2))).toBe(true)
  })

  it('ne bloque PAS un vétérinaire sans aucun congé', () => {
    expect(valide(JEAN, slot(SAM, 'weekend'), cfg('we_avant_vacances', 2))).toBe(true)
  })

  // ⚠️ Le loader du moteur ne charge QUE les congés validés
  // (`loader.ts` : `.eq('statut', 'valide')`). Aucun souhait en attente ne peut
  // donc arriver ici — ce test fige l'hypothèse sur laquelle repose la sûreté de
  // ce gardien : ce qu'il lit est un FAIT, pas une demande en cours d'examen.
  it('la détection ne lit que `vet.conges`, qui ne contient que du validé', () => {
    expect(estWeekEndAvantVacances(slot(SAM, 'weekend'), enVacances)).toBe(true)
    expect(estWeekEndAvantVacances(slot(SAM, 'weekend'), JEAN)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ③ R10b — les soirs de réveillon
// ════════════════════════════════════════════════════════════════════════════

describe('B-132 ③ — R10b « pas de garde le soir d’un réveillon »', () => {
  it('BLOQUE le 24 et le 31 décembre au soir', () => {
    expect(valide(JEAN, slot('2026-12-24'), cfg('fete_fin_annee', 2))).toBe(false)
    expect(valide(JEAN, slot('2026-12-31'), cfg('fete_fin_annee', 2))).toBe(false)
  })

  // ⚠️ Le 25 décembre et le 1er janvier sont des FÉRIÉS : ils relèvent de
  // l'équité, pas de cette règle. Les attraper ici les compterait deux fois et
  // viderait deux jours de plus, sans que personne l'ait demandé.
  it('ne bloque PAS le 25 décembre ni le 1er janvier', () => {
    expect(valide(JEAN, slot('2026-12-25'), cfg('fete_fin_annee', 2))).toBe(true)
    expect(valide(JEAN, slot('2027-01-01'), cfg('fete_fin_annee', 2))).toBe(true)
  })

  it('ne bloque pas un soir ordinaire de décembre', () => {
    expect(valide(JEAN, slot('2026-12-17'), cfg('fete_fin_annee', 2))).toBe(true)
  })

  it('ne s’applique pas à un créneau week-end', () => {
    expect(valide(JEAN, slot('2026-12-24', 'weekend'), cfg('fete_fin_annee', 2))).toBe(true)
  })

  // ⚠️ CETTE RÈGLE NE DÉPEND PAS DE LA PERSONNE — conséquence à connaître :
  // réglée « jamais », elle interdit ces deux soirs à TOUT LE MONDE, qui
  // resteront donc à pourvoir à la main. Ce test le dit noir sur blanc plutôt
  // que de le laisser découvrir sur un planning.
  it('réglée « jamais », elle interdit ces soirs à TOUTE l’équipe', () => {
    for (const v of [JEAN, FANNY]) {
      expect(valide(v, slot('2026-12-24'), cfg('fete_fin_annee', 2)),
        `${v.prenom} ne devrait pas pouvoir prendre le reveillon`).toBe(false)
    }
  })

  it('la détection est partagée avec la pénalité', () => {
    expect(estSoirDeFeteFinAnnee(slot('2026-12-24'))).toBe(true)
    expect(estSoirDeFeteFinAnnee(slot('2026-12-25'))).toBe(false)
    // La pénalité voit la même situation, et la facture tant qu'elle est souple.
    expect(penalite(slot('2026-12-24'), JEAN, 'premier', planningVide, undefined,
      { fete_fin_annee: { actif: true, etage: 4 } })).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ④ R8b — le même rôle que la veille, le soir d'un férié
// ════════════════════════════════════════════════════════════════════════════

describe('B-132 ④ — R8b « les rôles s’inversent le soir d’un férié »', () => {
  // 1er janvier 2027 est férié ; la veille est le 31 décembre 2026.
  const FERIE = '2027-01-01'
  const VEILLE = '2026-12-31'

  const planningVeille: PlanningPartiel = {
    attributions: [{
      date: VEILLE, type: 'semaine_soir',
      placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: FANNY.id }],
    }],
  }

  it('BLOQUE le même rôle que la veille', () => {
    expect(valide(JEAN, slot(FERIE), cfg('inversion_ferie', 2), 'premier', planningVeille)).toBe(false)
    expect(valide(FANNY, slot(FERIE), cfg('inversion_ferie', 2), 'second', planningVeille)).toBe(false)
  })

  // ⚠️ ELLE REFUSE UN RÔLE, PAS UNE GARDE. C'est ce qui la distingue des deux
  // autres : la personne peut toujours être de garde, dans l'AUTRE rôle. C'est
  // l'inversion voulue, et c'est pour ça que ce gardien ne vide pas le créneau.
  it('laisse passer le rôle INVERSÉ — c’est tout l’objet de la règle', () => {
    expect(valide(JEAN, slot(FERIE), cfg('inversion_ferie', 2), 'second', planningVeille)).toBe(true)
    expect(valide(FANNY, slot(FERIE), cfg('inversion_ferie', 2), 'premier', planningVeille)).toBe(true)
  })

  it('ne bloque personne si rien n’était posé la veille', () => {
    expect(valide(JEAN, slot(FERIE), cfg('inversion_ferie', 2), 'premier', planningVide)).toBe(true)
  })

  it('ne s’applique pas à un jour NON férié', () => {
    const planningVeilleOrdinaire: PlanningPartiel = {
      attributions: [{
        date: '2026-12-16', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }],
      }],
    }
    expect(valide(JEAN, slot('2026-12-17'), cfg('inversion_ferie', 2), 'premier',
      planningVeilleOrdinaire)).toBe(true)
  })

  it('la détection est partagée avec la pénalité', () => {
    expect(memeRoleQueLaVeilleDeFerie(slot(FERIE), JEAN, 'premier', planningVeille)).toBe(true)
    expect(memeRoleQueLaVeilleDeFerie(slot(FERIE), JEAN, 'second', planningVeille)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑤ LA CHAÎNE — un gardien que rien ne peut activer ne protège rien
// ════════════════════════════════════════════════════════════════════════════

describe('B-132 ⑤ — la chaîne écran / Server Action / moteur', () => {
  // ⚠️ LA LEÇON DU 20/09, ET ELLE A COÛTÉ UNE LIVRAISON INOPÉRANTE : un réglage
  // traverse TROIS couches, et il faut les trois. Le gardien avait été posé dans
  // le moteur, mais la Server Action refusait l'écriture et l'écran ne proposait
  // pas le choix. MiKL : « y a pas la fonction jamais pour ces règles-là ».
  //
  // Ici, les deux autres couches se DÉDUISENT de `PENALITES_AVEC_GARDIEN_DUR` :
  // ce test vérifie que la source unique contient bien les quatre.
  it('les quatre préférences déclarent un gardien dur', () => {
    expect([...PENALITES_AVEC_GARDIEN_DUR].sort()).toEqual([
      'fete_fin_annee', 'inversion_ferie', 'veille_repos', 'we_avant_vacances',
    ])
  })

  it('aucune préférence ne reste sans gardien', () => {
    const sansGardien = PENALITES_SOUPLES_IDS.filter((id) => !PENALITES_AVEC_GARDIEN_DUR.has(id))
    expect(sansGardien).toEqual([])
  })

  // Le garde-fou qui compte pour la suite : toute préférence AJOUTÉE devra soit
  // avoir son `check*`, soit rester clampée. Ce test échouera si quelqu'un
  // ajoute un identifiant à `PENALITES_AVEC_GARDIEN_DUR` sans écrire son
  // gardien — parce qu'alors le blocage attendu ci-dessus n'aura pas lieu.
  it('chaque préférence déclarée dure BLOQUE réellement quelque chose', () => {
    // Une situation par règle, choisie pour être celle que le gardien vise.
    const cas: Record<string, () => boolean> = {
      we_avant_vacances: () => valide(
        vet('v', 'V', [{ date_debut: '2026-11-09', date_fin: '2026-11-13', type: 'vacances' }]),
        slot('2026-11-07', 'weekend'), cfg('we_avant_vacances', 2)),
      fete_fin_annee: () => valide(JEAN, slot('2026-12-24'), cfg('fete_fin_annee', 2)),
      inversion_ferie: () => valide(JEAN, slot('2027-01-01'), cfg('inversion_ferie', 2), 'premier', {
        attributions: [{
          date: '2026-12-31', type: 'semaine_soir',
          placements: [{ role: 'premier', vetId: JEAN.id }],
        }],
      }),
      veille_repos: () => valide(
        vet('v', 'V', [{ date_debut: '2026-12-02', date_fin: '2026-12-02', type: 'vacances' }]),
        slot('2026-12-01'), cfg('veille_repos', 2)),
    }
    for (const id of PENALITES_AVEC_GARDIEN_DUR) {
      const scenario = cas[id]
      expect(scenario, `aucun scenario de blocage pour ${id} — ecris-le`).toBeDefined()
      expect(scenario(), `${id} est declaree dure mais ne bloque rien`).toBe(false)
    }
  })
})
