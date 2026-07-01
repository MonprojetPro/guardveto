// ============================================================
// GUARDVETO — Banc d'essai de FIABILITÉ du moteur
// ============================================================
//
// OBJECTIF : prouver de façon RIGOUREUSE et GÉNÉRIQUE que le solver
// applique fidèlement N'IMPORTE QUEL jeu de règles dures.
//
// MÉTHODE :
//   1. On génère BEAUCOUP de scénarios VARIÉS et DÉTERMINISTES
//      (paramétrés par index — aucun Math.random global).
//   2. Pour chaque scénario, on lance le solver (genererPlanningPur).
//   3. Si le solver réussit → on passe le planning au VALIDATEUR
//      INDÉPENDANT (validerPlanning) et on EXIGE zéro violation dure.
//   4. Si le solver échoue (impasse) → cas légitimement infaisable,
//      exclu du compte des violations (mais compté à part).
//
// Le validateur ne réutilise AUCUNE fonction de hard-constraints.ts :
// un bug silencieux dans le solver ne peut donc PAS se cacher des deux
// côtés (c'est tout l'intérêt de l'indépendance).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning, type Violation } from '@/engine/validation/validerPlanning'
import type { VetEngine, ContrainteEngine, CongeEngine, CalendrierResolu } from '@/engine/types'

// ── Calendrier explicite PARTAGÉ solver ↔ validateur ──
// IMPÉRATIF : le solver, sans `calendrier`, retombe sur la liste de vacances
// CODÉE EN DUR de utils.ts ; le validateur indépendant, lui, n'utilise QUE le
// calendrier passé (il n'invente aucun référentiel). Pour que la comparaison
// porte sur EXACTEMENT le même référentiel des deux côtés, on injecte un
// `calendrier` explicite dans CHAQUE scénario. Les deux camps voient alors
// les mêmes vacances/fériés → toute divergence restante est un VRAI bug moteur.
// (On reproduit ici les vacances zone C 2025-2027 de utils.ts + fériés FR.)
const CAL_PARTAGE: CalendrierResolu = {
  feries: new Set([
    '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25', '2026-07-14',
    '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
    '2027-01-01', '2027-05-01',
  ]),
  vacancesScolaires: [
    { debut: '2026-02-14', fin: '2026-03-02' },
    { debut: '2026-04-11', fin: '2026-04-27' },
    { debut: '2026-07-04', fin: '2026-08-31' },
    { debut: '2026-10-17', fin: '2026-11-02' },
    { debut: '2026-12-19', fin: '2027-01-04' },
    { debut: '2027-02-13', fin: '2027-03-01' },
    { debut: '2027-04-10', fin: '2027-04-26' },
    { debut: '2027-07-03', fin: '2027-08-31' },
  ],
}

// ── PRNG déterministe (mulberry32) — PAS de Math.random ──
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Helpers de dates (purs) ──────────────────────────────
function plusJours(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}
function jIndex(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay()
}
/** Avance jusqu'au prochain lundi (inclus si déjà lundi) */
function prochainLundi(date: string): string {
  let d = date
  while (jIndex(d) !== 1) d = plusJours(d, 1)
  return d
}

// ── Lundis de référence par saison (réalistes) ──────────
// Été : autour de mai-août. Hiver : septembre-avril.
const LUNDIS_ETE = ['2026-05-04', '2026-05-18', '2026-06-01', '2026-06-15', '2026-07-06']
const LUNDIS_HIVER = ['2026-09-07', '2026-09-21', '2026-10-05', '2026-11-02', '2027-01-11', '2027-02-08']

// ── Génération d'un véto paramétré ───────────────────────
const PRENOMS = [
  'Alice', 'Bruno', 'Claire', 'David', 'Emma', 'Felix', 'Gina', 'Hugo',
]

interface OptionsScenario {
  saison: 'ete' | 'hiver'
  dateDebut: string
  dateFin: string
  nbVets: number
  /** Active des duos interdits */
  duosInterdits: boolean
  /** Active une indispo cyclique (parité ancrée) */
  indispoCyclique: boolean
  /** Active des repos fixes / conditionnels */
  reposFixes: boolean
  /** Active des congés */
  conges: boolean
  /** Force un dernier recours */
  dernierRecours: boolean
  /** Intensité des congés (0 = aucun) */
  intensiteConges: number
}

/**
 * Construit un jeu de vétos déterministe pour un scénario donné.
 * Les contraintes sont attachées en fonction des options ET de l'index
 * du véto, pour produire des combinaisons variées mais reproductibles.
 */
function construireVets(opts: OptionsScenario, seed: number): VetEngine[] {
  const r = rng(seed)
  const vets: VetEngine[] = []
  const jours = ['lundi', 'mardi', 'mercredi', 'jeudi']

  for (let i = 0; i < opts.nbVets; i++) {
    const id = `v${i + 1}`
    const contraintes: ContrainteEngine[] = []
    const conges: CongeEngine[] = []

    // Repos fixe simple (1 véto sur ~3) avec parfois flexible_vacances
    if (opts.reposFixes && i % 3 === 0) {
      contraintes.push({
        id: `${id}-rf`,
        type: 'jour_repos_fixe',
        actif: true,
        config: {
          jour: jours[i % jours.length],
          flexible_vacances: i % 2 === 0,
        },
      })
    }

    // Repos conditionnel (1 véto sur ~3, décalé)
    if (opts.reposFixes && i % 3 === 1) {
      contraintes.push({
        id: `${id}-rc`,
        type: 'jour_repos_conditionnel',
        actif: true,
        config: { si_garde_we: 'mardi', sinon: 'vendredi' },
      })
    }

    // Indispo cyclique (1 véto, parité ancrée sur le début de période)
    if (opts.indispoCyclique && i === 1) {
      contraintes.push({
        id: `${id}-ic`,
        type: 'indisponibilite_cyclique',
        actif: true,
        config: {
          semaines: i % 2 === 0 ? 'paires' : 'impaires',
          periodes: ['soir_semaine', 'weekend'],
          ancre: opts.dateDebut,
        },
      })
    }

    // Congés (intensité variable, sur des fenêtres déterministes)
    if (opts.conges && i % 2 === 0 && opts.intensiteConges > 0) {
      const offset = Math.floor(r() * 14) + 7 * (i % 3)
      const debut = plusJours(opts.dateDebut, offset)
      const fin = plusJours(debut, opts.intensiteConges)
      conges.push({ date_debut: debut, date_fin: fin, type: 'vacances' })
    }

    vets.push({
      id,
      nom: `Nom${i + 1}`,
      prenom: PRENOMS[i % PRENOMS.length] + (i >= PRENOMS.length ? `_${i}` : ''),
      statut: i < Math.ceil(opts.nbVets / 2) ? 'associe' : 'salarie',
      dernier_recours: false,
      contraintes,
      conges,
    })
  }

  // Duos interdits : on lie 2 paires de vétos (réciproque, comme en V1)
  if (opts.duosInterdits && opts.nbVets >= 4) {
    const lier = (aIdx: number, bIdx: number) => {
      vets[aIdx].contraintes.push({
        id: `v${aIdx + 1}-duo`,
        type: 'duo_interdit',
        actif: true,
        config: { avec_veterinaire_id: vets[bIdx].id },
      })
      vets[bIdx].contraintes.push({
        id: `v${bIdx + 1}-duo`,
        type: 'duo_interdit',
        actif: true,
        // Variante de format : params (forme V2 brique) — teste le lecteur n-aire
        config: { params: { avec_veterinaire_id: vets[aIdx].id } },
      })
    }
    lier(opts.nbVets - 1, opts.nbVets - 2)
  }

  // Dernier recours (le dernier véto), pour les scénarios qui le veulent
  if (opts.dernierRecours && opts.nbVets >= 1) {
    vets[opts.nbVets - 1].dernier_recours = true
    vets[opts.nbVets - 1].contraintes = []
    vets[opts.nbVets - 1].conges = []
  }

  return vets
}

/**
 * Construit un scénario complet déterministe à partir d'un index.
 * Fait varier : saison, longueur de période, nb de vétos, combinaisons
 * de règles, intensité des congés. Aucun aléa global — tout dérive de `i`.
 */
function construireScenario(i: number): { input: SolverInput; opts: OptionsScenario; label: string } {
  const saison: 'ete' | 'hiver' = i % 2 === 0 ? 'hiver' : 'ete'
  const lundis = saison === 'ete' ? LUNDIS_ETE : LUNDIS_HIVER
  const dateDebut = prochainLundi(lundis[i % lundis.length])

  // Longueur de période : 3 à 12 semaines (variée)
  const nbSemaines = 3 + (i % 10)
  const dateFin = plusJours(dateDebut, nbSemaines * 7 - 1)

  // 5 à 8 vétos
  const nbVets = 5 + (i % 4)

  const opts: OptionsScenario = {
    saison,
    dateDebut,
    dateFin,
    nbVets,
    duosInterdits: i % 3 === 0,
    indispoCyclique: i % 4 === 0,
    reposFixes: i % 2 === 0,
    conges: i % 3 !== 2,
    dernierRecours: i % 5 === 0,
    intensiteConges: (i % 4) * 2, // 0, 2, 4, 6 jours
  }

  const vets = construireVets(opts, 1000 + i)

  const input: SolverInput = {
    dateDebut,
    dateFin,
    saison,
    vets,
    bonusMalus: {},
    lnsTimeoutMs: 2000, // budget LNS court pour garder le run rapide
    calendrier: CAL_PARTAGE, // référentiel calendaire identique des deux côtés
  }

  const label =
    `#${i} ${saison} ${nbSemaines}sem ${nbVets}vétos` +
    `${opts.duosInterdits ? ' +duo' : ''}` +
    `${opts.indispoCyclique ? ' +cyclique' : ''}` +
    `${opts.reposFixes ? ' +repos' : ''}` +
    `${opts.conges ? ` +congés(${opts.intensiteConges}j)` : ''}` +
    `${opts.dernierRecours ? ' +dernierRecours' : ''}`

  return { input, opts, label }
}

// ── Cas limites EXPLICITES (en plus des scénarios paramétrés) ──
function casLimites(): Array<{ input: SolverInput; label: string }> {
  const cas: Array<{ input: SolverInput; label: string }> = []

  // Beaucoup de duos interdits simultanés
  {
    const vets: VetEngine[] = Array.from({ length: 6 }, (_, i) => ({
      id: `d${i + 1}`, nom: `N${i}`, prenom: PRENOMS[i],
      statut: i < 3 ? 'associe' : 'salarie', dernier_recours: false,
      contraintes: [], conges: [],
    }))
    // 2 paires interdites
    const interdire = (a: number, b: number, fmt: 'legacy' | 'params') => {
      vets[a].contraintes.push({
        id: `d${a}-x`, type: 'duo_interdit', actif: true,
        config: fmt === 'legacy'
          ? { avec_veterinaire_id: vets[b].id }
          : { params: { avec_veterinaire_id: vets[b].id } },
      })
    }
    interdire(0, 1, 'legacy'); interdire(1, 0, 'params')
    interdire(2, 3, 'params'); interdire(3, 2, 'legacy')
    cas.push({
      input: {
        dateDebut: '2026-09-07', dateFin: plusJours('2026-09-07', 6 * 7 - 1),
        saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 2000, calendrier: CAL_PARTAGE,
      },
      label: 'cas-limite multi-duos interdits (formats mixtes)',
    })
  }

  // Dernier recours FORCÉ : juste assez de vétos pour exiger le dernier recours certains soirs
  {
    const vets: VetEngine[] = Array.from({ length: 5 }, (_, i) => ({
      id: `f${i + 1}`, nom: `N${i}`, prenom: PRENOMS[i],
      statut: 'associe', dernier_recours: i === 4,
      contraintes: i < 4 ? [{
        id: `f${i}-rf`, type: 'jour_repos_fixe' as const, actif: true,
        config: { jour: ['lundi', 'mardi', 'mercredi', 'jeudi'][i] },
      }] : [],
      conges: [],
    }))
    cas.push({
      input: {
        dateDebut: '2026-09-07', dateFin: plusJours('2026-09-07', 4 * 7 - 1),
        saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 2000, calendrier: CAL_PARTAGE,
      },
      label: 'cas-limite dernier recours quasi forcé',
    })
  }

  // Congés lourds (la moitié des vétos absents une partie de la période)
  {
    const vets: VetEngine[] = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i + 1}`, nom: `N${i}`, prenom: PRENOMS[i],
      statut: i < 4 ? 'associe' : 'salarie', dernier_recours: i === 6,
      contraintes: [],
      conges: i % 2 === 0
        ? [{ date_debut: '2026-09-21', date_fin: '2026-09-27', type: 'vacances' as const }]
        : [],
    }))
    cas.push({
      input: {
        dateDebut: '2026-09-07', dateFin: plusJours('2026-09-07', 5 * 7 - 1),
        saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 2000, calendrier: CAL_PARTAGE,
      },
      label: 'cas-limite congés lourds',
    })
  }

  // Indispo cyclique avec parité ancrée chevauchant une fin d'année (semaine ISO 53)
  {
    const vets: VetEngine[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`, nom: `N${i}`, prenom: PRENOMS[i],
      statut: i < 3 ? 'associe' : 'salarie', dernier_recours: false,
      contraintes: i === 0 ? [{
        id: 'p1-ic', type: 'indisponibilite_cyclique' as const, actif: true,
        config: { semaines: 'impaires', periodes: ['soir_semaine', 'weekend'], ancre: '2026-12-07' },
      }] : [],
      conges: [],
    }))
    cas.push({
      input: {
        dateDebut: '2026-12-07', dateFin: plusJours('2026-12-07', 6 * 7 - 1),
        saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 2000,
        calendrier: { feries: new Set(), vacancesScolaires: [{ debut: '2026-12-19', fin: '2027-01-04' }] },
      },
      label: 'cas-limite parité ancrée à cheval sur semaine ISO 53',
    })
  }

  // Légitimement INFAISABLE : 1 seul véto pour un WE qui en exige 2.
  // Doit produire un ÉCHEC solver (impasse) — PAS un planning « valide »
  // tronqué. Sert à prouver que le bench distingue infaisable ≠ violé.
  {
    const vets: VetEngine[] = [
      { id: 'x1', nom: 'Seul', prenom: 'Leo', statut: 'associe', dernier_recours: false, contraintes: [], conges: [] },
    ]
    cas.push({
      input: {
        dateDebut: '2026-09-07', dateFin: '2026-09-13',
        saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 1000, calendrier: CAL_PARTAGE,
      },
      label: 'cas-limite LÉGITIMEMENT infaisable (1 véto, WE exige 2)',
    })
  }

  return cas
}

// ============================================================
// BANC D'ESSAI
// ============================================================

const NB_SCENARIOS = 80

interface Resultat {
  label: string
  faisable: boolean
  violations: Violation[]
}

const resultats: Resultat[] = []

// Scénarios paramétrés
for (let i = 0; i < NB_SCENARIOS; i++) {
  const { input, label } = construireScenario(i)
  const r = genererPlanningPur(input)
  if (r.success) {
    const v = validerPlanning(r.planning, input)
    resultats.push({ label, faisable: true, violations: v })
  } else {
    resultats.push({ label: label + ' [IMPASSE]', faisable: false, violations: [] })
  }
}

// Cas limites explicites
for (const { input, label } of casLimites()) {
  const r = genererPlanningPur(input)
  if (r.success) {
    const v = validerPlanning(r.planning, input)
    resultats.push({ label, faisable: true, violations: v })
  } else {
    resultats.push({ label: label + ' [IMPASSE]', faisable: false, violations: [] })
  }
}

const totalGeneres = resultats.length
const faisables = resultats.filter((r) => r.faisable)
const infaisables = resultats.filter((r) => !r.faisable)
const avecViolations = faisables.filter((r) => r.violations.length > 0)

// Compte des violations par règle
const parRegle: Record<string, number> = {}
for (const r of avecViolations) {
  for (const v of r.violations) {
    parRegle[v.regle] = (parRegle[v.regle] ?? 0) + 1
  }
}

// ── VERDICT CHIFFRÉ (affiché dans la sortie du run) ──
// eslint-disable-next-line no-console
console.log('\n========== VERDICT FIABILITÉ MOTEUR ==========')
// eslint-disable-next-line no-console
console.log(`Plannings générés      : ${totalGeneres}`)
// eslint-disable-next-line no-console
console.log(`Faisables (succès)     : ${faisables.length}`)
// eslint-disable-next-line no-console
console.log(`Infaisables (impasse)  : ${infaisables.length}  (légitimes, exclus)`)
// eslint-disable-next-line no-console
console.log(`Plannings AVEC violation dure : ${avecViolations.length}`)
// eslint-disable-next-line no-console
console.log(`Violations dures par règle    :`, JSON.stringify(parRegle))
if (avecViolations.length > 0) {
  // eslint-disable-next-line no-console
  console.log('\n--- DÉTAIL DES VIOLATIONS ---')
  for (const r of avecViolations) {
    // eslint-disable-next-line no-console
    console.log(`\n[${r.label}]`)
    for (const v of r.violations.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`  • ${v.regle} | ${v.detail}`)
    }
    if (r.violations.length > 10) {
      // eslint-disable-next-line no-console
      console.log(`  … +${r.violations.length - 10} autres`)
    }
  }
}
// eslint-disable-next-line no-console
console.log('\n==============================================\n')

// ============================================================
// ASSERTIONS
// ============================================================

describe('Banc de fiabilité du moteur — application fidèle de N\'IMPORTE QUEL jeu de règles', () => {
  it(`génère un grand nombre de plannings (>= 50)`, () => {
    expect(totalGeneres).toBeGreaterThanOrEqual(50)
  })

  it('exerce AUSSI le chemin « légitimement infaisable » (>= 1 impasse)', () => {
    // Prouve que le bench distingue un échec solver légitime d'une vraie
    // violation : un scénario impossible (1 véto / WE à 2) doit faire échec.
    expect(infaisables.length).toBeGreaterThanOrEqual(1)
  })

  it('produit majoritairement des plannings faisables (sanity)', () => {
    // La plupart des scénarios sont volontairement faisables : on veut
    // exercer le solver, pas seulement provoquer des impasses.
    expect(faisables.length).toBeGreaterThanOrEqual(totalGeneres * 0.5)
  })

  it('AUCUN planning « valide » ne contient de violation de contrainte DURE', () => {
    // Message d'échec ultra-explicite pour identifier la racine.
    if (avecViolations.length > 0) {
      const recap = avecViolations
        .map((r) => `\n[${r.label}]\n` + r.violations.map((v) => `  • ${v.regle}: ${v.detail}`).join('\n'))
        .join('\n')
      throw new Error(
        `${avecViolations.length} planning(s) déclaré(s) valide(s) par le solver contiennent des violations dures ` +
        `(par règle: ${JSON.stringify(parRegle)}):\n${recap}`
      )
    }
    expect(avecViolations.length).toBe(0)
  })

  // Vérifications par règle (chaque assertion isole une famille de contraintes)
  for (const regle of ['COUVERTURE', 'R1', 'R2', 'R3', 'R6', 'R8', 'R9', 'R16', 'R17', 'R18', 'R19', 'R21']) {
    it(`zéro violation de type ${regle}`, () => {
      expect(parRegle[regle] ?? 0).toBe(0)
    })
  }
})

// ============================================================
// CONTRÔLE NÉGATIF (anti-faux-vert)
// ============================================================
// Prouve que le validateur a des DENTS : si on lui soumet un planning
// volontairement SABOTÉ, il DOIT trouver la violation correspondante.
// Sans ce contrôle, un « zéro violation » pourrait simplement signifier
// que le validateur est aveugle. C'est la parade directe au bug réel
// (une contrainte qui se tait silencieusement).
describe('Contrôle négatif — le validateur DÉTECTE bien les violations plantées', () => {
  const baseVets: VetEngine[] = [
    {
      id: 'a1', nom: 'A', prenom: 'Alice', statut: 'associe', dernier_recours: false,
      contraintes: [{ id: 'a1-rf', type: 'jour_repos_fixe', actif: true, config: { jour: 'lundi' } }],
      conges: [{ date_debut: '2026-09-08', date_fin: '2026-09-08', type: 'vacances' }],
    },
    { id: 'b1', nom: 'B', prenom: 'Bruno', statut: 'associe', dernier_recours: false, contraintes: [], conges: [] },
    {
      id: 'c1', nom: 'C', prenom: 'Claire', statut: 'salarie', dernier_recours: false,
      contraintes: [{ id: 'c1-duo', type: 'duo_interdit', actif: true, config: { avec_veterinaire_id: 'b1' } }],
      conges: [],
    },
  ]
  const input = {
    dateDebut: '2026-09-07', dateFin: '2026-09-13',
    saison: 'hiver' as const, vets: baseVets,
    calendrier: { feries: new Set<string>(), vacancesScolaires: [] },
  }

  it('détecte R1 (garde le jour de repos fixe)', () => {
    const v = validerPlanning(
      { attributions: [{ date: '2026-09-07', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'a1' }, { role: 'second', vetId: 'b1' }] }] },
      input
    )
    expect(v.some((x) => x.regle === 'R1')).toBe(true)
  })

  it('détecte R16 (garde pendant un congé)', () => {
    const v = validerPlanning(
      { attributions: [{ date: '2026-09-08', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'a1' }, { role: 'second', vetId: 'b1' }] }] },
      input
    )
    expect(v.some((x) => x.regle === 'R16')).toBe(true)
  })

  it('détecte R6 (duo interdit Bruno+Claire)', () => {
    const v = validerPlanning(
      { attributions: [{ date: '2026-09-09', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'c1' }] }] },
      input
    )
    expect(v.some((x) => x.regle === 'R6')).toBe(true)
  })

  it('détecte R21 (même véto 1er ET 2nd)', () => {
    const v = validerPlanning(
      { attributions: [{ date: '2026-09-09', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'b1' }] }] },
      input
    )
    expect(v.some((x) => x.regle === 'R21')).toBe(true)
  })

  it('détecte la COUVERTURE manquante (créneau absent)', () => {
    const v = validerPlanning({ attributions: [] }, input)
    expect(v.some((x) => x.regle === 'COUVERTURE')).toBe(true)
  })

  it('détecte R9 (duo WE ≠ duo vendredi soir)', () => {
    const v = validerPlanning(
      {
        attributions: [
          { date: '2026-09-11', type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'a1' }, { role: 'second', vetId: 'b1' }] },
          { date: '2026-09-12', type: 'weekend', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'c1' }] },
        ],
      },
      input
    )
    expect(v.some((x) => x.regle === 'R9')).toBe(true)
  })

  it('détecte R8 (pas d\'inversion 1er/2nd entre ven et WE)', () => {
    const v = validerPlanning(
      {
        attributions: [
          { date: '2026-09-11', type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'a1' }, { role: 'second', vetId: 'b1' }] },
          { date: '2026-09-12', type: 'weekend', placements: [{ role: 'premier', vetId: 'a1' }, { role: 'second', vetId: 'b1' }] }, // même rôles → viole R8
        ],
      },
      input
    )
    expect(v.some((x) => x.regle === 'R8')).toBe(true)
  })

  it('NE signale RIEN sur un mini-planning sain', () => {
    // 4 vétos sans conflit : Alice (repos lun + congé mar 08), Bruno, Doris, Eve.
    // Bruno+Claire sont duo interdit → on n'utilise PAS Claire ici.
    const vetsSains: VetEngine[] = [
      {
        id: 'a1', nom: 'A', prenom: 'Alice', statut: 'associe', dernier_recours: false,
        contraintes: [{ id: 'a1-rf', type: 'jour_repos_fixe', actif: true, config: { jour: 'lundi' } }],
        conges: [{ date_debut: '2026-09-08', date_fin: '2026-09-08', type: 'vacances' }],
      },
      { id: 'b1', nom: 'B', prenom: 'Bruno', statut: 'associe', dernier_recours: false, contraintes: [], conges: [] },
      { id: 'd1', nom: 'D', prenom: 'Doris', statut: 'salarie', dernier_recours: false, contraintes: [], conges: [] },
      { id: 'e1', nom: 'E', prenom: 'Eve', statut: 'salarie', dernier_recours: false, contraintes: [], conges: [] },
    ]
    const inputSain = {
      dateDebut: '2026-09-07', dateFin: '2026-09-13', saison: 'hiver' as const,
      vets: vetsSains, calendrier: { feries: new Set<string>(), vacancesScolaires: [] },
    }
    // Semaine du 7 sept : lun→jeu (hiver, 2 vétos), ven soir + WE (duo inversé).
    // Aucun véto sur son repos/congé ; aucun duo interdit ; rôles inversés ven↔WE.
    const sain = {
      attributions: [
        { date: '2026-09-07', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'd1' }] }, // lun (Alice exclue)
        { date: '2026-09-08', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'd1' }] }, // mar (Alice en congé)
        { date: '2026-09-09', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'd1' }, { role: 'second', vetId: 'e1' }] }, // mer
        { date: '2026-09-10', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'e1' }] }, // jeu
        { date: '2026-09-11', type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'a1' }, { role: 'second', vetId: 'b1' }] },
        { date: '2026-09-12', type: 'weekend', placements: [{ role: 'premier', vetId: 'b1' }, { role: 'second', vetId: 'a1' }] }, // inversé → R8 ok
      ],
    }
    const v = validerPlanning(sain, inputSain)
    expect(v).toEqual([])
  })
})
