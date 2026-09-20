// ============================================================
// GUARDVETO — R10d : « pas de garde la veille d'un repos », version DURE (B-127)
// ============================================================
// ⚠️ CE QUI A ÉTÉ PAYÉ. MiKL, le 20/09 : « j'ai repéré au moins 3 gardes mises
// la veille d'un congé, alors que ça fait partie des règles les plus dures ».
// Mesure faite sur la période réelle : il y en avait **7** sur le seul Hiver P1.
//
// La règle existait pourtant, active, et réglée en base. Mais elle n'était
// implémentée QUE comme pénalité souple, et `structure-config` clampait tout
// réglage à l'étage 3 — « ces règles n'ont aucun gardien dur », disait le code.
// Choisir « jamais » dans l'interface n'avait donc AUCUN effet : un paramètre
// affiché à l'admin que le moteur n'évaluait pas.
//
// Ces tests figent les deux moitiés de la correction :
//   ① réglée dure, la règle BLOQUE réellement ;
//   ② réglée souple (ou par défaut), elle ne bloque rien — le comportement
//      historique de tous les cabinets est intact.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, estVeilleDeRepos } from '@/engine/rules/hard-constraints'
import { resoudrePenaliteSouple } from '@/engine/structure-config'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel, StructureConfig } from '@/engine/types'
import { DEFAULT_STRUCTURE_CONFIG } from '@/engine/structure-config'

const MAR = '2026-12-01'
const MER = '2026-12-02'

function vet(conges: VetEngine['conges']): ReturnType<typeof normaliserContraintesVets>[number] {
  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges,
    contraintes: [],
  }
  return normaliserContraintesVets([v])[0]
}

const slot = (date: string, type: SlotGarde['type'] = 'semaine_soir'): SlotGarde => ({
  date, type, saison: 'hiver', besoinSecond: false,
})

const planningVide: PlanningPartiel = { attributions: [] }

/** Le cabinet règle R10d au niveau demandé (2 = « jamais », 4 = « à éviter »). */
function structureAvecEtage(etage: number): StructureConfig {
  return {
    ...DEFAULT_STRUCTURE_CONFIG,
    penalitesSouples: { veille_repos: { actif: true, etage } },
  }
}

// Congé le mercredi : une garde le mardi soir tombe donc la veille.
const CONGE_MERCREDI = [{ date_debut: MER, date_fin: MER, type: 'vacances' as const }]

describe('estVeilleDeRepos — la détection, partagée par la pénalité et le gardien', () => {
  it('reconnaît un congé posé le lendemain', () => {
    expect(estVeilleDeRepos(slot(MAR), vet(CONGE_MERCREDI))).toBe(true)
  })

  it('ne se déclenche pas quand le lendemain est libre', () => {
    expect(estVeilleDeRepos(slot(MAR), vet([]))).toBe(false)
  })

  it("compte le LUNDI comme lendemain d'un week-end, pas le dimanche", () => {
    // La garde de week-end court jusqu'au dimanche : c'est le lundi qui doit
    // être libre. Un congé le dimanche ne la rend pas « veille de repos ».
    const samedi = '2026-12-05'
    const lundi = '2026-12-07'
    const congeLundi = [{ date_debut: lundi, date_fin: lundi, type: 'vacances' as const }]
    expect(estVeilleDeRepos(slot(samedi, 'weekend'), vet(congeLundi))).toBe(true)

    const congeDimanche = [{ date_debut: '2026-12-06', date_fin: '2026-12-06', type: 'vacances' as const }]
    expect(estVeilleDeRepos(slot(samedi, 'weekend'), vet(congeDimanche))).toBe(false)
  })

  it("prend TOUS les types d'absence, pas seulement les vacances", () => {
    // Précision de MiKL au 26/08 : une formation ou un arrêt se respectent
    // autant que des vacances.
    const formation = [{ date_debut: MER, date_fin: MER, type: 'formation' as const }]
    expect(estVeilleDeRepos(slot(MAR), vet(formation))).toBe(true)
  })
})

describe('R10d réglée DURE — elle bloque enfin', () => {
  it('refuse la garde de la veille quand le cabinet a choisi « jamais »', () => {
    const v = vet(CONGE_MERCREDI)
    const r = isValid(slot(MAR), v, 'premier', [v], planningVide, undefined, structureAvecEtage(2))
    expect(r.valid).toBe(false)
    expect(r.raison).toContain('VEILLE_REPOS')
  })

  it("laisse passer les autres jours — elle ne bloque QUE la veille", () => {
    const v = vet(CONGE_MERCREDI)
    const lundi = '2026-11-30'
    expect(isValid(slot(lundi), v, 'premier', [v], planningVide, undefined, structureAvecEtage(2)).valid)
      .toBe(true)
  })

  it('ne bloque rien si le cabinet a désactivé la règle', () => {
    const v = vet(CONGE_MERCREDI)
    const structure: StructureConfig = {
      ...DEFAULT_STRUCTURE_CONFIG,
      penalitesSouples: { veille_repos: { actif: false, etage: 2 } },
    }
    expect(isValid(slot(MAR), v, 'premier', [v], planningVide, undefined, structure).valid).toBe(true)
  })
})

describe('R10d réglée SOUPLE — le comportement historique est intact', () => {
  it('ne bloque PAS en « à éviter » (étage 4, le défaut)', () => {
    const v = vet(CONGE_MERCREDI)
    expect(isValid(slot(MAR), v, 'premier', [v], planningVide, undefined, structureAvecEtage(4)).valid)
      .toBe(true)
  })

  it('ne bloque PAS en « sauf crise » (étage 3) — le réglage de Val d’Allier', () => {
    // ⚠️ Le réglage RÉEL du cabinet au 20/09. Il explique pourquoi les 7 gardes
    // sont passées : « sauf crise » est un étage MOU par définition dans ce
    // produit. Pour que la règle bloque, il faut la passer à « jamais ».
    const v = vet(CONGE_MERCREDI)
    expect(isValid(slot(MAR), v, 'premier', [v], planningVide, undefined, structureAvecEtage(3)).valid)
      .toBe(true)
  })

  it('ne bloque PAS sans aucun réglage — tous les cabinets existants', () => {
    const v = vet(CONGE_MERCREDI)
    expect(isValid(slot(MAR), v, 'premier', [v], planningVide).valid).toBe(true)
  })
})

describe('le plancher d’étage — ce qui rendait le réglage inopérant', () => {
  it('laisse désormais `veille_repos` descendre au niveau DUR', () => {
    // Avant B-127 : clampé à 3, donc « jamais » devenait « sauf crise » en
    // silence. C'est le mensonge que ce test empêche de revenir.
    expect(resoudrePenaliteSouple('veille_repos', { veille_repos: { actif: true, etage: 2 } }).etage)
      .toBe(2)
  })

  it('CLAMPE toujours les règles qui n’ont pas de gardien dur', () => {
    // Leur proposer « jamais » resterait un paramètre sans effet.
    expect(resoudrePenaliteSouple('we_consecutif', { we_consecutif: { actif: true, etage: 2 } }).etage)
      .toBe(3)
    expect(resoudrePenaliteSouple('fete_fin_annee', { fete_fin_annee: { actif: true, etage: 0 } }).etage)
      .toBe(3)
  })
})
