// ============================================================
// GUARDVETO — B-137 lot 2 : l'EQUITE du moteur compte le vendredi soir
// ============================================================
// Le lot 1 a corrige la vue `compteurs_gardes`, qui ne comptait le vendredi
// NULLE PART. Restait a verifier le moteur — et la mesure a renverse
// l'hypothese de depart : **il comptait deja juste**.
//
//     src/engine/rules/optimization.ts
//     function estCreneauSemaine(attr) {
//       return attr.type === 'semaine_soir' || attr.type === 'vendredi_soir'
//     }
//
// Le vendredi entre donc dans `semainePremier` / `semaineSecond` depuis
// toujours. C'etaient la BASE et la VUE qui etaient en retard sur le moteur,
// jamais l'inverse.
//
// ⚠️ POURQUOI CE FICHIER EXISTE QUAND MEME. Ce comportement n'etait couvert par
//    AUCUN test : il tenait a une seule ligne, que rien n'empechait de reecrire
//    en `attr.type === 'semaine_soir'` lors d'un nettoyage — le vendredi
//    redeviendrait alors GRATUIT pour l'equite, et le moteur cesserait en
//    silence de repartir un soir de garde sur cinq. Un comportement juste mais
//    non garde n'est pas acquis, il est seulement encore vrai.
//
// C'est la lecon maison « un grep prouve qu'un code est ecrit, jamais qu'il est
// execute », appliquee a l'envers : ici le code est bon, et c'est sa PERENNITE
// qui n'etait pas assuree.
// ============================================================

import { describe, it, expect } from 'vitest'
import { compterParVet } from '@/engine/rules/optimization'
import type { VetEngine, PlanningPartiel } from '@/engine/types'

function vet(id: string, prenom: string): VetEngine {
  return { id, nom: prenom, prenom, statut: 'associe', dernier_recours: false, contraintes: [], conges: [] }
}

const EQUIPE = [vet('v1', 'Alice'), vet('v2', 'Bob')]

/** Un vendredi seul — le samedi qui suit n'est volontairement PAS pose. */
const VENDREDI_SEUL: PlanningPartiel = {
  attributions: [
    { date: '2025-11-07', type: 'vendredi_soir', placements: [
      { role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' },
    ] },
  ],
}

/** Le meme soir, mais en creneau de semaine ordinaire. */
const LUNDI_SEUL: PlanningPartiel = {
  attributions: [
    { date: '2025-11-03', type: 'semaine_soir', placements: [
      { role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' },
    ] },
  ],
}

const WEEKEND_SEUL: PlanningPartiel = {
  attributions: [
    { date: '2025-11-08', type: 'weekend', placements: [
      { role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' },
    ] },
  ],
}

const par = (c: ReturnType<typeof compterParVet>, id: string) => c.find((x) => x.vetId === id)!

describe('B-137 — l’equite du moteur range le vendredi en SOIR DE SEMAINE', () => {
  it('un vendredi soir pese sur semainePremier / semaineSecond', () => {
    const c = compterParVet(VENDREDI_SEUL, EQUIPE)

    expect(par(c, 'v1').semainePremier).toBe(1)
    expect(par(c, 'v2').semaineSecond).toBe(1)
  })

  it('il ne pese PAS sur les compteurs de week-end', () => {
    const c = compterParVet(VENDREDI_SEUL, EQUIPE)

    // Le coeur du sujet : « le week-end c'est samedi dimanche » (MiKL, 30/09).
    expect(par(c, 'v1').weGardes).toBe(0)
    expect(par(c, 'v1').weekendPremier).toBe(0)
    expect(par(c, 'v2').weGardes).toBe(0)
  })

  it('il compte EXACTEMENT comme un lundi soir — aucune difference', () => {
    const vendredi = compterParVet(VENDREDI_SEUL, EQUIPE)
    const lundi = compterParVet(LUNDI_SEUL, EQUIPE)

    // Les compteurs sont identiques a l'identifiant de date pres : c'est la
    // definition meme de « le vendredi compte comme les autres jours ».
    for (const id of ['v1', 'v2']) {
      expect(par(vendredi, id).semainePremier).toBe(par(lundi, id).semainePremier)
      expect(par(vendredi, id).semaineSecond).toBe(par(lundi, id).semaineSecond)
      expect(par(vendredi, id).weGardes).toBe(par(lundi, id).weGardes)
    }
  })

  it('un week-end, lui, ne pese PAS sur les soirs de semaine', () => {
    // Le miroir du test precedent : sans lui, un moteur qui compterait TOUT en
    // semaine passerait les trois premiers.
    const c = compterParVet(WEEKEND_SEUL, EQUIPE)

    expect(par(c, 'v1').weGardes).toBe(1)
    expect(par(c, 'v1').semainePremier).toBe(0)
    expect(par(c, 'v2').semaineSecond).toBe(0)
  })
})

// ── LOT 3 — LES REGLES « WEEK-END » NE DOIVENT PAS ATTRAPER LE VENDREDI ─────
//
// B-137 range le vendredi en soir de SEMAINE. Il faut donc verifier l'autre
// bord : qu'aucune regle parlant de week-end ne se mette a le compter. Les deux
// concernees (`espacement_weekend`, `cadencement_weekend`) filtrent sur
// `slot.type !== 'weekend'` — mais c'est une LECTURE du code, et ce projet juge
// sur l'execution. Ces deux tests transforment la lecture en preuve.

import { isValid } from '@/engine/rules/hard-constraints'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { SlotGarde } from '@/engine/types'

function vetAvecRegle(type: string, config: Record<string, unknown>) {
  return normaliserContraintesVets([{
    ...vet('v1', 'Alice'),
    contraintes: [{ type, actif: true, config: { ...config, force: 'jamais' } }],
  }] as never)
}

/** Le week-end du 08/11 est deja tenu par Alice : toute regle d'espacement mord. */
const DEJA_UN_WEEKEND: PlanningPartiel = {
  attributions: [
    { date: '2025-11-08', type: 'weekend', placements: [
      { role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' },
    ] },
  ],
}

const slot = (date: string, type: string): SlotGarde =>
  ({ date, type, saison: 'hiver', besoinSecond: true, nbPlaces: 2 }) as SlotGarde

describe('B-137 lot 3 — les regles « week-end » ignorent le vendredi', () => {
  it('espacement_weekend refuse un WEEK-END trop proche…', () => {
    const vets = vetAvecRegle('espacement_weekend', { n_semaines: 3 })
    const r = isValid(slot('2025-11-15', 'weekend'), vets[0], 'premier', vets, DEJA_UN_WEEKEND)

    // Sans ce premier test, le suivant passerait meme avec une regle inerte.
    expect(r.valid).toBe(false)
  })

  it('…et laisse passer le VENDREDI, qui n’est pas un week-end', () => {
    const vets = vetAvecRegle('espacement_weekend', { n_semaines: 3 })
    const r = isValid(slot('2025-11-14', 'vendredi_soir'), vets[0], 'premier', vets, DEJA_UN_WEEKEND)

    expect(r.valid).toBe(true)
  })

  it('cadencement_weekend ne s’applique pas non plus au vendredi', () => {
    const vets = vetAvecRegle('cadencement_weekend', {
      n_semaines: 3, ancre: '2025-11-08', sens: 'interdit',
    })
    const r = isValid(slot('2025-11-14', 'vendredi_soir'), vets[0], 'premier', vets, DEJA_UN_WEEKEND)

    expect(r.valid).toBe(true)
  })
})

// ── LOT 4 (B-130c) — LE VENDREDI ORPHELIN NE DISPARAIT PLUS EN SILENCE ─────
//
// Mesure du 30/09 : sur une periode du 03/11 au VENDREDI 28/11, le moteur
// attribue `vendredi 2025-11-28 : premier=v4 second=v3` — deux personnes de
// garde — puis l'ecriture jette la ligne (le vendredi n'a pas de ligne a lui)
// et aucun week-end ne peut la re-deriver. La garde disparaissait : ni
// calendrier, ni notification, ni agenda, et les deux vetos jamais prevenus.
//
// Le pre-vol le DIT desormais. Il ne repare pas — c'est assume, et ecrit au
// board : reparer demanderait de desactiver la re-derivation aux 7 endroits
// qui l'appliquent, sur un produit en service.

import { preVolRegles } from '@/engine/pre-vol'
import { RELATIONS_STRUCTURE_DEFAUT, DEFAULT_STRUCTURE_CONFIG } from '@/engine/structure-config'

const codes = (avs: ReturnType<typeof preVolRegles>) => avs.map((a) => a.code)

function preVol(dateDebut: string, dateFin: string, relations = RELATIONS_STRUCTURE_DEFAUT) {
  return preVolRegles({
    vets: [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'), vet('v4', 'David')],
    dateDebut, dateFin, saison: 'hiver',
    structureConfig: { ...DEFAULT_STRUCTURE_CONFIG, relations: [...relations] },
  })
}

describe('B-130c — un vendredi que rien ne pourra enregistrer est ANNONCE', () => {
  it('periode finissant un DIMANCHE : rien a signaler (le cas de tous les cabinets)', () => {
    // Le test qui empeche le detecteur de crier tout le temps. Sans lui, un
    // detecteur casse en « toujours vrai » passerait le test suivant.
    expect(codes(preVol('2025-11-03', '2025-11-30'))).not.toContain('vendredi_orphelin')
  })

  it('periode finissant un SAMEDI : rien non plus — le week-end porte son vendredi', () => {
    expect(codes(preVol('2025-11-03', '2025-11-29'))).not.toContain('vendredi_orphelin')
  })

  it('periode finissant un VENDREDI : le pre-vol le signale, avec la DATE', () => {
    const avs = preVol('2025-11-03', '2025-11-28')
    const orphelin = avs.find((a) => a.code === 'vendredi_orphelin')

    expect(orphelin).toBeDefined()
    // La date doit y etre : « un vendredi ne sera pas enregistre » sans dire
    // lequel oblige l'admin a chercher, donc a ne pas chercher.
    expect(orphelin!.message).toContain('2025-11-28')
    // On avertit, on ne barre pas la route : interdire toute periode finissant
    // un vendredi contraindrait le produit pour un cas acceptable en connaissance.
    expect(orphelin!.gravite).toBe('surveiller')
  })

  it('cabinet ayant retire le lien « meme binome » : signale UNE fois, pas par date', () => {
    // Sans `meme_binome`, aucun vendredi n'est derivable — quelles que soient
    // les bornes. Douze lignes identiques ne se liraient plus : une seule.
    const avs = preVol('2025-11-03', '2025-11-30', [])
    const orphelins = avs.filter((a) => a.code === 'vendredi_orphelin')

    expect(orphelins).toHaveLength(1)
    expect(orphelins[0].message).toContain('même binôme')
  })
})
