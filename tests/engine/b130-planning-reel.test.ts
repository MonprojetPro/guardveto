// ============================================================
// GUARDVETO — B-130 : un planning se juge avec LES REGLES DE SA GENERATION
// ============================================================
// MiKL, le 25/09, capture a l'appui : « c'est quoi ces successions de gardes
// pour Jean, c'est n'importe quoi ! ».
//
// ── CE QUE CE HARNAIS DISAIT, ET POURQUOI C'ETAIT FAUX ──────────────────────
//
// Sa premiere version rejouait les DEUX plannings du 25/09 avec `espacement_min`
// en force « jamais » (etage 2, DURE), et concluait a 8 enchainements illegaux
// — donc a un moteur qui enfreint ses propres regles dures.
//
// La regle ne valait PAS « jamais » quand le planning A a ete genere. La table
// `snapshots_regles` enregistre les regles actives A CHAQUE generation, et elle
// est formelle (mesure du 30/09, figee dans le JSON) :
//
//     14:20 · 14:22 · 14:29 · 14:31  →  jamais  (etage 2, dure)
//     14:51 · 14:53  ← PLANNING A    →  evitee  (etage 4, SOUPLE)
//     15:07 · 15:09  ← planning B    →  jamais  (etage 2, dure)
//
// Le moteur n'a donc rien enfreint : a 14h50 l'espacement etait une PENALITE,
// pas une interdiction. Les 8 « violations » ont ete obtenues en jugeant avec la
// regle telle qu'elle est DEVENUE a 15h07. L'intermittence — A sale, B propre —
// s'explique entierement par la, et par rien d'autre.
//
// ⚠️ LE PIEGE ETAIT SIGNALE, ET PERSONNE NE L'A APPLIQUE A LA BONNE REGLE. Le
//    releve d'origine porte, en toutes lettres : « les regles ci-dessous ne sont
//    PAS celles qui s'appliquaient a la generation de 14h50 ». Quatre ecarts y
//    sont listes — `espacement_min`, la regle au coeur du dossier, n'en fait pas
//    partie. Un avertissement general ne protege pas de son propre angle mort :
//    seule une mesure par generation le fait. C'est ce que ce fichier verrouille.
//
// ── CE QUE CE HARNAIS VERROUILLE DESORMAIS ─────────────────────────────────
//
// ① Juge avec la force REELLE  → le planning A est CONFORME. Ce test tombe le
//    jour ou quelqu'un rejuge un planning avec une regle qu'il n'a pas connue.
// ② Juge avec la force DURCIE  → 8 violations. Ce n'est pas un bug du moteur :
//    c'est la mesure du VRAI defaut produit, celui qui reste ouvert — durcir une
//    regle rend un planning deja enregistre non conforme, et RIEN ne le dit.
// ③ Le planning B, juge avec SA regle a lui (dure), est propre.
//
// ❌ Il ne rejoue toujours PAS la generation : il juge des plannings enregistres.
//
// POURQUOI FIGER LES DONNEES PLUTOT QUE LIRE LA BASE
//
// Le planning de 14h50 a ete ECRASE par la generation de 15h07, seize minutes
// plus tard. Sans cette copie, la preuve aurait disparu. Les donnees vivent dans
// `docs/mesures/b130-hiver-p2-valdallier-2026-09-25.json`, avec leurs reserves.
// ============================================================

import { describe, it, expect } from 'vitest'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { mapperReglesCabinet, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, PlanningPartiel, VetEngineNormalise } from '@/engine/types'
import donnees from '../../docs/mesures/b130-hiver-p2-valdallier-2026-09-25.json'

/** jour de la semaine (1 = lundi … 7 = dimanche) d'une date ISO. */
function jourSemaine(date: string): number {
  const j = new Date(date + 'T12:00:00Z').getUTCDay()
  return j === 0 ? 7 : j
}

/**
 * Vocabulaire de la BASE → vocabulaire du MOTEUR.
 * La base ne connait que `semaine | weekend | ferie` ; le moteur distingue le
 * vendredi soir du reste de la semaine, parce que lui seul est lie au week-end.
 */
function typeMoteur(date: string, typeBase: string): string {
  if (typeBase !== 'semaine') return typeBase
  return jourSemaine(date) === 5 ? 'vendredi_soir' : 'semaine_soir'
}

const EFFECTIF = donnees.equipe.map((v) => v.id)

/**
 * La force en vigueur a une generation donnee, LUE dans la mesure des snapshots.
 * Ecrire la force en dur dans un test serait refaire l'erreur que ce fichier
 * repare : elle doit venir de ce que la base a enregistre ce jour-la.
 */
function forceALaGeneration(snapshotCreeLe: string): string {
  const releve = donnees.force_espacement_min_par_generation.releves.find(
    (r) => r.snapshot_cree_le === snapshotCreeLe,
  )
  if (!releve) throw new Error(`Aucun snapshot releve a ${snapshotCreeLe}`)
  return releve.force
}

/** Monte l'equipe avec la seule regle qui nous interesse, a la force demandee. */
function equipeAvecEspacementMin(force: string): VetEngineNormalise[] {
  const ligne = {
    id: donnees.regle_au_coeur_du_sujet.id,
    brique_id: donnees.regle_au_coeur_du_sujet.brique_id,
    force,
    actif: donnees.regle_au_coeur_du_sujet.actif,
    params_json: donnees.regle_au_coeur_du_sujet.params_json,
  } as unknown as RegleCabinetRow

  const { contraintesParVet, rejets } = mapperReglesCabinet(
    [ligne], new Set(['espacement_min']), EFFECTIF,
  )
  // Une regle rejetee au chargement n'atteindrait jamais le moteur : on le
  // verifie ici plutot que de decouvrir un zero violation trompeur plus bas.
  expect(rejets).toEqual([])

  const vets: VetEngine[] = donnees.equipe.map((v) => ({
    id: v.id, prenom: v.prenom, nom: 'X',
    statut: v.statut as VetEngine['statut'],
    dernier_recours: v.dernier_recours,
    conges: [],
    contraintes: contraintesParVet.get(v.id) ?? [],
  }))
  return normaliserContraintesVets(vets)
}

const idDe = (prenom: string) =>
  donnees.equipe.find((v) => v.prenom === prenom)?.id ?? `inconnu:${prenom}`

/** Les gardes d'une personne (planning A, partiel) en attributions moteur. */
function planningDUnePersonne(
  gardes: ReadonlyArray<{ date: string; type: string; role: string }>,
  prenom: string,
): PlanningPartiel {
  const vetId = idDe(prenom)
  return {
    attributions: gardes.map((g) => ({
      date: g.date,
      type: typeMoteur(g.date, g.type),
      placements: [
        { role: 'premier', vetId: g.role === 'premier' ? vetId : null },
        { role: 'second', vetId: g.role === 'second' ? vetId : null },
      ],
    })),
  }
}

const PERIODE = {
  dateDebut: donnees.meta.date_debut,
  dateFin: donnees.meta.date_fin,
  saison: 'hiver' as const,
  nbVetosSemaineSoir: 2,
}

// Generique, et pas `{ regle: string }` : un filtre qui rabote le type de ce
// qu'il laisse passer rendait `detail` et `date` invisibles aux assertions —
// c'etait l'origine des erreurs `tsc` que ce fichier trainait depuis le 25/09.
const espacements = <T extends { regle: string }>(violations: ReadonlyArray<T>): T[] =>
  violations.filter((v) => v.regle === 'ESPACEMENT')

/** Violations d'espacement d'une personne du planning A, a la force donnee. */
function violationsDe(prenom: 'Jean' | 'Fanny', force: string) {
  const gardes = prenom === 'Jean'
    ? donnees.planning_A_14h50.gardes_de_jean
    : donnees.planning_A_14h50.gardes_de_fanny
  const vets = equipeAvecEspacementMin(force)
  return espacements(validerPlanning(planningDUnePersonne(gardes, prenom), { ...PERIODE, vets }))
}

// ── ⓪ LE GARDE-FOU DU HARNAIS LUI-MEME ─────────────────────────────────────
//
// Tout ce fichier repose sur une force lue dans une mesure. Si une force mal
// orthographiee produisait une equipe SANS contrainte, les tests ① passeraient
// au vert pour la mauvaise raison — un zero violation obtenu en n'ayant rien
// charge. On verifie donc que ce cas est bien un ECHEC bruyant.

describe('B-130 — le harnais ne peut pas passer a vide', () => {
  it('une force mal orthographiee fait tomber le test, elle ne le rend pas vert', () => {
    expect(() => equipeAvecEspacementMin('evitee_typo')).toThrow()
  })

  it('un snapshot inexistant leve, au lieu de rendre une force par defaut', () => {
    expect(() => forceALaGeneration('2026-09-25T00:00:00Z')).toThrow(/Aucun snapshot/)
  })
})

// ── ① LE PLANNING A, JUGE AVEC LA REGLE QU'IL A REELLEMENT CONNUE ──────────

describe('B-130 — planning A (14h50), juge avec la regle de SA generation', () => {
  const FORCE_REELLE = forceALaGeneration('2026-09-25T14:51:01Z')

  it('la regle etait SOUPLE a 14h51 — c est la mesure, pas une hypothese', () => {
    expect(FORCE_REELLE).toBe('evitee')
  })

  it('Jean : aucune regle dure enfreinte — le moteur a fait son travail', () => {
    expect(violationsDe('Jean', FORCE_REELLE)).toHaveLength(0)
  })

  it('Fanny : aucune regle dure enfreinte non plus', () => {
    expect(violationsDe('Fanny', FORCE_REELLE)).toHaveLength(0)
  })
})

// ── ② LE MEME PLANNING, JUGE AVEC LA REGLE DURCIE APRES COUP ───────────────
//
// Ces nombres ne decrivent pas un defaut du moteur. Ils mesurent ce que l'admin
// ne voit nulle part : ce que devient un planning deja enregistre quand la regle
// se durcit sous lui. Le jour ou le produit saura le signaler, ces tests seront
// le point de depart de sa recette.

describe('B-130 — le meme planning A, juge avec la regle DURCIE a 15h07', () => {
  const FORCE_DURCIE = forceALaGeneration('2026-09-25T15:07:12Z')

  it('la regle est redevenue DURE a 15h07', () => {
    expect(FORCE_DURCIE).toBe('jamais')
  })

  it('Jean : 6 enchainements deviennent non conformes, en silence', () => {
    const violations = violationsDe('Jean', FORCE_DURCIE)
    expect(violations).toHaveLength(6)
    expect(violations.every((v) => v.detail?.includes('seulement 1 jour'))).toBe(true)
  })

  it('Fanny : 2 de plus — ce n etait donc pas propre a Jean', () => {
    const violations = violationsDe('Fanny', FORCE_DURCIE)
    expect(violations).toHaveLength(2)
    // Lundi 19 → mardi 20 octobre, puis le week-end du 7 novembre (qui couvre
    // samedi ET dimanche) → lundi 9 : elle rentre le lundi matin et repart le
    // lundi soir. Zero repit, compte comme un jour.
    expect(violations.map((v) => v.date)).toEqual(['2026-10-20', '2026-11-09'])
  })
})

// ── ③ LE PLANNING B, JUGE AVEC SA PROPRE REGLE (DURE) ──────────────────────

describe('B-130 — planning B (15h07), juge avec la regle de SA generation', () => {
  it('genere SOUS la regle dure, il la respecte', () => {
    const force = forceALaGeneration('2026-09-25T15:07:12Z')
    expect(force).toBe('jamais')

    const vets = equipeAvecEspacementMin(force)
    const planning: PlanningPartiel = {
      attributions: donnees.planning_B_15h09.gardes.map((g) => ({
        date: g.date,
        type: typeMoteur(g.date, g.type),
        placements: [
          { role: 'premier', vetId: g.premier ? idDe(g.premier) : null },
          { role: 'second', vetId: g.second ? idDe(g.second) : null },
        ],
      })),
    }
    expect(espacements(validerPlanning(planning, { ...PERIODE, vets }))).toHaveLength(0)
  })
})
