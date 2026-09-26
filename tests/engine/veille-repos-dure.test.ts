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
import {
  resoudrePenaliteSouple,
  DEFAULT_STRUCTURE_CONFIG,
  PENALITES_AVEC_GARDIEN_DUR,
  PENALITES_SOUPLES_IDS,
  type StructureConfig,
} from '@/engine/structure-config'
import { BRIQUES_AVEC_GARDIEN_DUR, BRIQUES_PENALITES_SOUPLES } from '@/data/mapReglesCabinet'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel } from '@/engine/types'

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

describe('un repos SOUPLE ne peut pas fonder une interdiction — le cas Victor', () => {
  // ⚠️ PAYÉ LE 20/09 AU SOIR, une heure après la mise en « jamais ». MiKL :
  // « Victor n'a jamais de week-end, ce qui fait qu'Antoine enchaîne 6
  // week-ends toutes les 2 semaines ». Mesure : Victor à **0 week-end** sur
  // toute la période, les autres à 5.
  //
  // Cause : Victor a un repos fixe le lundi réglé « si possible ». Le lundi
  // étant le lendemain de TOUT week-end, cette simple préférence lui
  // interdisait fermement chaque week-end de l'année. Le gardien lisait les
  // repos sans regarder leur fermeté — approximation sans gravité tant que
  // R10d n'était qu'une pénalité, exclusion totale une fois devenue dure.

  /** Victor : repos le lundi, mais en simple préférence. */
  function vetAvecReposLundi(force: number) {
    const v: VetEngine = {
      id: 'victor', prenom: 'Victor', nom: 'X', statut: 'salarie', dernier_recours: false,
      conges: [],
      contraintes: [{
        id: 'r1', type: 'jour_repos_fixe', actif: true,
        config: { brique: 'interdire_creneau', force, jour: 'lundi' },
      } as unknown as import('@/engine/types').ContrainteEngine],
    }
    return normaliserContraintesVets([v])[0]
  }

  const SAMEDI = '2026-12-05' // lendemain d'un week-end = le lundi 7

  it("n'interdit PAS le week-end quand le repos du lundi est « si possible »", () => {
    const v = vetAvecReposLundi(5)
    const r = isValid(slot(SAMEDI, 'weekend'), v, 'premier', [v], planningVide, undefined, structureAvecEtage(2))
    expect(r.valid, 'une preference ne peut pas exclure de tous les week-ends').toBe(true)
  })

  it('interdit bien le week-end quand le repos du lundi est « jamais »', () => {
    // L'autre moitie : un vrai repos dur doit, lui, continuer de bloquer.
    const v = vetAvecReposLundi(2)
    const r = isValid(slot(SAMEDI, 'weekend'), v, 'premier', [v], planningVide, undefined, structureAvecEtage(2))
    expect(r.valid).toBe(false)
    expect(r.raison).toContain('VEILLE_REPOS')
  })

  it('la PÉNALITÉ, elle, compte toujours tous les repos', () => {
    // Elle exprime un souhait : ne retenir que les repos durs l'affaiblirait
    // sans raison. Seul le gardien filtre.
    expect(estVeilleDeRepos(slot(SAMEDI, 'weekend'), vetAvecReposLundi(5))).toBe(true)
    expect(estVeilleDeRepos(slot(SAMEDI, 'weekend'), vetAvecReposLundi(5), undefined, true)).toBe(false)
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

  // ⚠️ B-132 (26/09) — CE TEST DISAIT L'INVERSE, ET C'EST VOULU.
  // Il vérifiait que les trois autres préférences étaient CLAMPÉES, faute de
  // gardien. MiKL a demandé le contraire : « je veux que la mention jamais
  // apparaisse [...] pas seulement sur une ». Chacune a donc reçu son `check*`,
  // et le clamp ne les concerne plus.
  it('B-132 — les trois autres préférences peuvent descendre à 2 : elles ont un gardien', () => {
    expect(resoudrePenaliteSouple('we_avant_vacances', { we_avant_vacances: { actif: true, etage: 2 } }).etage)
      .toBe(2)
    expect(resoudrePenaliteSouple('fete_fin_annee', { fete_fin_annee: { actif: true, etage: 2 } }).etage)
      .toBe(2)
    expect(resoudrePenaliteSouple('inversion_ferie', { inversion_ferie: { actif: true, etage: 2 } }).etage)
      .toBe(2)
  })

  // Le plancher borne toujours par le BAS : l'étage 2 est le plus dur atteignable
  // par un réglage de cabinet. Un 0 ou un 1 posé en base (import, sauvegarde,
  // saisie directe) ne doit pas faire passer la règle devant les invariants du
  // moteur, qui vivent aux étages 0 et 1.
  it('B-132 — un étage 0 ou 1 posé en base reste borné à 2, jamais en dessous', () => {
    expect(resoudrePenaliteSouple('fete_fin_annee', { fete_fin_annee: { actif: true, etage: 0 } }).etage)
      .toBe(2)
    expect(resoudrePenaliteSouple('inversion_ferie', { inversion_ferie: { actif: true, etage: 1 } }).etage)
      .toBe(2)
  })

  // ⚠️ LE CLAMP N'A PLUS AUCUN UTILISATEUR, et il doit RESTER.
  // Les quatre pénalités souples ont désormais un gardien : la branche
  // `plancher = 3` ne s'applique donc à personne aujourd'hui. Ce test ne la
  // supprime pas, il la garde armée — le jour où une pénalité SANS gardien est
  // ajoutée, il la vérifie tout seul, au lieu de laisser re-livrer le défaut de
  // B-127 (un réglage affiché que le moteur n'honore pas).
  it('B-132 — toute pénalité SANS gardien dur reste clampée à 3 (garde-fou armé)', () => {
    const sansGardien = PENALITES_SOUPLES_IDS.filter((id) => !PENALITES_AVEC_GARDIEN_DUR.has(id))
    for (const id of sansGardien) {
      expect(resoudrePenaliteSouple(id, { [id]: { actif: true, etage: 2 } }).etage,
        `${id} n'a pas de gardien dur : « jamais » doit rester impossible`).toBe(3)
    }
    // L'état du jour, dit explicitement pour qu'un ensemble vide ne passe pas
    // pour une vérification réussie : il n'y en a plus aucune.
    expect(sansGardien).toEqual([])
  })
})

describe('la chaîne complète — écran, Server Action, moteur', () => {
  // ⚠️ LE CORRECTIF DU 20/09 ÉTAIT INOPÉRANT, et MiKL l'a vu immédiatement :
  // « y a pas la fonction jamais pour ces règles-là ». Le gardien avait bien
  // été posé dans le moteur, mais DEUX autres verrous interdisaient le réglage
  // — la Server Action refusait l'écriture, et l'écran ne proposait pas le
  // choix. Un gardien que rien ne peut activer ne protège rien.
  //
  // Ce test tient le bout de chaîne que le code peut vérifier : la liste des
  // briques autorisées est bien DÉRIVÉE de celle du moteur, jamais recopiée.

  it('autorise « jamais » exactement pour les briques qui ont un gardien', () => {
    expect(BRIQUES_AVEC_GARDIEN_DUR.has('eviter_veille_repos')).toBe(true)
  })

  // ⚠️ B-132 — retourné le 26/09. Ce test verrouillait l'état d'alors : SEULE
  // `eviter_veille_repos` pouvait dire « jamais ». Les trois autres l'ont
  // désormais, et c'est la demande de MiKL. Ce qui compte n'a pas change : la
  // liste de l'écran DOIT rester dérivée de celle du moteur.
  it('B-132 — les trois autres préférences l’autorisent aussi désormais', () => {
    for (const brique of [
      'eviter_we_avant_vacances',
      'eviter_fete_fin_annee',
      'inversion_role_ferie',
    ]) {
      expect(BRIQUES_AVEC_GARDIEN_DUR.has(brique), `${brique} devrait avoir un gardien dur`).toBe(true)
    }
  })

  // La brique retirée par B-135 ne doit surtout pas reparaître dans la liste des
  // réglables : elle n'a plus de gardien, et n'a plus de règle du tout.
  it('B-135 — « eviter_we_consecutifs » n’y figure plus du tout', () => {
    expect(BRIQUES_AVEC_GARDIEN_DUR.has('eviter_we_consecutifs')).toBe(false)
  })

  it('reste synchronisée avec la liste du moteur, sans recopie', () => {
    // Si quelqu'un ajoute une brique ici sans écrire son `check*`, ce test ne
    // le verra pas — mais la dérivation garantit au moins qu'on ne peut pas
    // diverger de `PENALITES_AVEC_GARDIEN_DUR`, qui vit à côté du moteur.
    const attendues = [...PENALITES_AVEC_GARDIEN_DUR]
      .map((cle) => Object.entries(BRIQUES_PENALITES_SOUPLES).find(([, c]) => c === cle)?.[0])
      .filter(Boolean)
    expect([...BRIQUES_AVEC_GARDIEN_DUR].sort()).toEqual(attendues.sort())
  })
})
