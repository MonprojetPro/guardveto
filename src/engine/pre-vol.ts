// ============================================================
// GUARDVETO — Pré-vol de cohérence des règles (backlog n°23)
// ============================================================
// Le diagnostic d'impasse (diagnostic.ts) est BON mais RÉACTIF : il explique
// l'échec APRÈS une génération ratée. Ce module détecte AVANT de générer :
//   (a) les configurations de règles DURES arithmétiquement intenables
//       (véto que ses règles écartent de tout, limites de charge qui ne
//       couvrent pas la période, espacements week-end impossibles, créneaux
//       qu'aucune combinaison de vétos ne peut pourvoir) ;
//   (b) les règles FANTÔMES : une règle active qui pointe un vétérinaire
//       sorti de l'effectif (inactif/supprimé) — silencieusement sans effet.
//
// PRINCIPE DIRECTEUR — réutiliser le diagnostic, pas le réinventer :
//   • le « pourquoi un véto est écarté » = `raisonsSurCreneau` (diagnostic.ts),
//     rejouée ici sur un planning VIDE (avant génération, il n'y a pas de
//     contexte partiel — un véto écarté à vide le sera dans TOUT contexte,
//     les contraintes dures ne faisant que se resserrer quand le planning
//     se remplit) ;
//   • les libellés en clair = `rendreRegle` (catalogue/briques) — la MÊME
//     source de formulations françaises que le diagnostic ;
//   • la normalisation = `normaliserContraintesVets` (idempotente).
//
// GARANTIES :
//   • Fonction PURE (aucune I/O) — entièrement testable.
//   • Avertissements NON bloquants : la génération reste toujours possible.
//   • Un pré-vol qui ne détecte rien renvoie [] → l'UI n'affiche RIEN.
//   • Jamais d'exception : une règle mal formée est ignorée (comme le moteur).
// ============================================================

import type {
  VetEngine, VetEngineNormalise, SlotGarde, PlanningPartiel, Saison,
  CalendrierResolu, ContrainteEngine,
} from './types'
import { raisonsSurCreneau, type CreneauStep } from './diagnostic'
import { isValid } from './rules/hard-constraints'
import { normaliserContraintesVets } from './normaliserContraintes'
import { rendreRegle } from './briques/catalogue'
import { lundiDeSemaine, samediDeSemaine } from './utils'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig } from './structure-config'
import type { CreneauModele } from './creneau-modele'
import type { EquityCohorte } from './equity-weights'

// ── Types publics ────────────────────────────────────────────

export type CodeAvertissementPreVol =
  | 'regle_veto_sorti'          // règle active dont le propriétaire n'est plus dans l'effectif
  | 'duo_veto_sorti'            // duo interdit dont le partenaire n'est plus dans l'effectif
  | 'veto_jamais_disponible'    // un véto que ses règles/congés écartent de TOUT créneau
  | 'creneau_impossible'        // un créneau qu'aucune combinaison de vétos ne peut pourvoir
  | 'charge_globale_insuffisante' // Σ des plafonds de charge < places à pourvoir
  | 'weekends_insuffisants'     // Σ des plafonds week-end < places de week-end
  | 'composition_sans_porteur'  // règle de composition dont AUCUN véto actif ne porte le tag
  | 'role_interdit_intenable'   // rôle interdit à un tag que TOUS les vétos actifs portent
  | 'sequence_inerte'           // règle de rythme (série/succession/repos) mal paramétrée → sans effet
  | 'cohorte_equite_sans_porteur' // cohorte d'équité (#21) dont AUCUN véto actif ne porte le tag → inerte

/**
 * Un avertissement du pré-vol — TOUJOURS non bloquant.
 * `regles` : libellés en clair (formulations du catalogue) des règles en cause.
 * `message` : phrase compréhensible par une vétérinaire, sans jargon.
 */
export interface AvertissementPreVol {
  code: CodeAvertissementPreVol
  regles: string[]
  message: string
}

/** Fiche minimale d'un véto de l'annuaire (actifs ET sortis) — pour nommer. */
export interface VetAnnuaire {
  id: string
  prenom: string
  nom: string
  actif: boolean
}

export interface PreVolInput {
  /** Vétos ACTIFS avec leurs contraintes + congés (le contexte de génération). */
  vets: VetEngine[]
  dateDebut: string
  dateFin: string
  saison: Saison
  calendrier?: CalendrierResolu
  structureConfig?: StructureConfig
  /** Catalogue de créneaux du cabinet — absent = mapping historique en dur. */
  creneaux?: CreneauModele[]
  /** Effectif configurable nuit de semaine. Absent → repli saison. */
  nbVetosSemaineSoir?: number
  /** Annuaire COMPLET (actifs + inactifs) — pour nommer les vétos sortis. */
  annuaire?: VetAnnuaire[]
  /**
   * Contraintes par véto telles que mappées depuis `regles_cabinet`
   * (mapperReglesCabinet), AVANT le filtrage « vétos actifs » du loader.
   * C'est la seule façon de voir les règles fantômes : le loader les jette
   * en silence (aucun véto actif ne les ramasse). Absent → détection (b) sautée.
   */
  contraintesParVet?: Map<string, ContrainteEngine[]>
  /**
   * Cohortes d'équité par tag (Vague 6 tranche A — #21), telles qu'assemblées
   * dans equityWeights.cohortes par le loader. Absent/vide → détection sautée.
   * Sert au SEUL avertissement « cohorte sans porteur » (léger, non bloquant).
   */
  cohortesEquite?: EquityCohorte[]
}

// ── Helpers internes ─────────────────────────────────────────

const ETAGE_DUR_MAX = 2 // miroir de hard-constraints.ts (dur si étage ≤ 2)

function estDure(c: ContrainteEngine): boolean {
  const f = (c.config as Record<string, unknown>).force
  return (typeof f === 'number' ? f : ETAGE_DUR_MAX) <= ETAGE_DUR_MAX
}

/** Le `brique` d'une contrainte (repli sur le type) — même lecture que diagnostic.ts. */
function briqueDe(c: ContrainteEngine): string {
  const b = (c.config as Record<string, unknown>).brique
  return typeof b === 'string' ? b : c.type
}

/** Les params d'une contrainte (post-normalisation : params sinon racine). */
function paramsDe(c: ContrainteEngine): Record<string, unknown> {
  const cfg = c.config as Record<string, unknown>
  const p = cfg.params
  return p && typeof p === 'object' && !Array.isArray(p)
    ? (p as Record<string, unknown>)
    : cfg
}

/** Libellé « Prénom + prédicat » via le catalogue — même recette que le diagnostic. */
function libelleRegle(
  prenom: string,
  c: ContrainteEngine,
  nomVeto: (id: string) => string,
): string {
  return `${prenom} ${rendreRegle(briqueDe(c), paramsDe(c), { nomVeto })}`
}

/** Nombre de jours inclus entre deux dates ISO. */
function nbJoursEntre(debut: string, fin: string): number {
  const a = new Date(debut + 'T12:00:00Z').getTime()
  const b = new Date(fin + 'T12:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000) + 1
}

function plusJours(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function jIndex(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay() // 0=dim … 6=sam
}

/** Date lisible en français (« 8 novembre »). */
function dateLisible(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long',
  })
}

/** Retire le préfixe technique (« R3/R5 : », « AU_PLUS_N : ») d'une raison isValid. */
function sansPrefixeTechnique(raison: string): string {
  return raison.replace(/^[A-Z0-9/_-]+\s*:\s*/, '')
}

/** Nom lisible d'un créneau (nom du catalogue si dispo, sinon libellé historique). */
function nomCreneau(type: string, creneaux?: CreneauModele[]): string {
  const c = creneaux?.find((x) => x.code === type)
  if (c) return c.nom
  const NOMS: Record<string, string> = {
    semaine_soir: 'soir de semaine',
    vendredi_soir: 'vendredi soir',
    weekend: 'week-end',
  }
  return NOMS[type] ?? type
}

// ── Énumération des créneaux de la période ───────────────────
// Miroir de `slotsAttendus` (validation/validerPlanning.ts) : catalogue si
// présent (actif, non-férié, code non-null, jours cochés ; semaine_soir
// plafonné par l'effectif), sinon mapping historique en dur. Utilisé UNIQUEMENT
// pour des AVERTISSEMENTS (jamais bloquant) : une divergence éventuelle avec le
// solver produit au pire un avertissement de trop/de moins, jamais un planning faux.

interface SlotPreVol {
  date: string
  type: string
  roles: string[]
}

function enumererSlots(input: PreVolInput): SlotPreVol[] {
  const effectifSemaine = input.nbVetosSemaineSoir ?? (input.saison === 'hiver' ? 2 : 1)
  const slots: SlotPreVol[] = []
  let cur = input.dateDebut
  while (cur <= input.dateFin) {
    const idx = jIndex(cur)
    const creneaux = input.creneaux
    if (creneaux && creneaux.length > 0) {
      for (const c of creneaux) {
        if (!c.actif || c.surFeries || !c.joursSemaine.includes(idx)) continue
        if (c.code === null || c.code === 'ferie') continue
        const nbAttendu = c.code === 'semaine_soir'
          ? Math.min(c.nbPlaces, effectifSemaine)
          : c.nbPlaces
        const roles = c.roles.slice(0, nbAttendu)
        if (roles.length > 0) slots.push({ date: cur, type: c.code, roles })
      }
    } else {
      const t = idx === 5 ? 'vendredi_soir'
        : idx === 6 ? 'weekend'
        : idx >= 1 && idx <= 4 ? 'semaine_soir'
        : null
      if (t) {
        const roles = t === 'semaine_soir'
          ? (effectifSemaine >= 2 ? ['premier', 'second'] : ['premier'])
          : ['premier', 'second']
        slots.push({ date: cur, type: t, roles })
      }
    }
    cur = plusJours(cur, 1)
  }
  return slots
}

/** CreneauStep (contrat du diagnostic) depuis un slot du pré-vol + un rôle. */
function versStep(s: SlotPreVol, role: string, saison: Saison): CreneauStep {
  return { date: s.date, type: s.type, saison, role, besoinSecond: s.roles.length >= 2 }
}

// ── (b) Règles fantômes — véto sorti de l'effectif ───────────

function detecterReglesFantomes(
  input: PreVolInput,
  actifsIds: Set<string>,
  nomVeto: (id: string) => string,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  if (!input.contraintesParVet) return out

  for (const [vetId, contraintes] of input.contraintesParVet) {
    if (actifsIds.has(vetId)) continue
    const fiche = input.annuaire?.find((a) => a.id === vetId)
    const prenom = fiche ? fiche.prenom : 'un vétérinaire retiré de l’équipe'
    for (const c of contraintes) {
      if (!c.actif) continue
      out.push({
        code: 'regle_veto_sorti',
        regles: [libelleRegle(prenom, c, nomVeto)],
        message: fiche
          ? `Une règle concerne ${fiche.prenom} ${fiche.nom}, qui ne fait plus partie de l’équipe de garde : elle n’a plus aucun effet. Tu peux la supprimer depuis l’écran Règles.`
          : `Une règle concerne un vétérinaire qui a été retiré de l’équipe : elle n’a plus aucun effet. Tu peux la supprimer depuis l’écran Règles.`,
      })
    }
  }
  return out
}

/** Ids des partenaires d'un duo interdit (config normalisée : racine ou params). */
function lirePartenairesDuo(c: ContrainteEngine): string[] {
  const out = new Set<string>()
  const pousser = (v: unknown) => {
    if (typeof v === 'string' && v.trim() !== '') out.add(v)
  }
  const cfg = c.config as Record<string, unknown>
  const p = paramsDe(c)
  pousser(p.avec_veterinaire_id)
  pousser(cfg.avec_veterinaire_id)
  for (const src of [p.membres, cfg.membres]) {
    if (Array.isArray(src)) for (const m of src) pousser(m)
  }
  return [...out]
}

function detecterDuosFantomes(
  vets: VetEngineNormalise[],
  input: PreVolInput,
  actifsIds: Set<string>,
  nomVeto: (id: string) => string,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  for (const vet of vets) {
    for (const c of vet.contraintes) {
      if (!c.actif || c.type !== 'duo_interdit') continue
      const sortis = lirePartenairesDuo(c).filter(
        (id) => id !== vet.id && !actifsIds.has(id),
      )
      for (const id of sortis) {
        const fiche = input.annuaire?.find((a) => a.id === id)
        const nomPartenaire = fiche
          ? `${fiche.prenom} ${fiche.nom}`
          : 'un vétérinaire qui a été retiré de l’équipe'
        out.push({
          code: 'duo_veto_sorti',
          regles: [libelleRegle(vet.prenom, c, nomVeto)],
          message: `La règle « jamais ensemble » de ${vet.prenom} mentionne ${nomPartenaire}, qui ne fait plus partie de l’équipe de garde : cette règle n’a plus aucun effet.`,
        })
      }
    }
  }
  return out
}

// ── (a1) Vétos que leurs règles écartent de TOUT créneau ─────
// Rejeu de `raisonsSurCreneau` (diagnostic) sur planning VIDE : un véto écarté
// partout à vide le sera a fortiori dans tout contexte réel (les contraintes
// dures ne font que se resserrer quand le planning se remplit).

interface DisponibilitesParSlot {
  /** slot index → ids des vétos valides sur AU MOINS un rôle du slot. */
  candidatsParSlot: string[][]
  /** slot index → rôle → ids valides sur CE rôle. */
  candidatsParRole: Map<string, string[]>[]
}

function calculerDisponibilites(
  slots: SlotPreVol[],
  vetsN: VetEngineNormalise[],
  input: PreVolInput,
): DisponibilitesParSlot {
  // MÊME rejeu que raisonsSurCreneau (diagnostic.ts) : isValid sur le planning
  // vide. On appelle isValid directement (et pas raisonsSurCreneau) parce que
  // cette dernière ne remonte que les raisons préfixées « Rxx » — un véto
  // écarté par AU_PLUS_N/ESPACEMENT/FREQ_WE serait compté à tort disponible.
  const planningVide: PlanningPartiel = { attributions: [] }
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const candidatsParSlot: string[][] = []
  const candidatsParRole: Map<string, string[]>[] = []

  for (const s of slots) {
    const parRole = new Map<string, string[]>()
    const union = new Set<string>()
    for (const role of s.roles) {
      const slot: SlotGarde = {
        date: s.date, type: s.type, saison: input.saison, besoinSecond: s.roles.length >= 2,
      }
      const valides = vetsN
        .filter((v) => isValid(slot, v, role, vetsN, planningVide, input.calendrier, structure).valid)
        .map((v) => v.id)
      parRole.set(role, valides)
      for (const id of valides) union.add(id)
    }
    candidatsParSlot.push([...union])
    candidatsParRole.push(parRole)
  }
  return { candidatsParSlot, candidatsParRole }
}

function detecterVetosJamaisDisponibles(
  slots: SlotPreVol[],
  dispos: DisponibilitesParSlot,
  vetsN: VetEngineNormalise[],
  nomVeto: (id: string) => string,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  if (slots.length === 0) return out

  for (const vet of vetsN) {
    const disponibleQuelquePart = dispos.candidatsParSlot.some((ids) => ids.includes(vet.id))
    if (disponibleQuelquePart) continue

    const reglesDures = vet.contraintes.filter((c) => c.actif && estDure(c))
    if (reglesDures.length === 0) {
      // Aucune règle dure → l'exclusion vient des congés (R16).
      out.push({
        code: 'veto_jamais_disponible',
        regles: [],
        message: `${vet.prenom} est en congé sur toute la période : aucune garde ne pourra lui être attribuée.`,
      })
    } else {
      out.push({
        code: 'veto_jamais_disponible',
        regles: reglesDures.map((c) => libelleRegle(vet.prenom, c, nomVeto)),
        message: `Avec ses règles actuelles (et ses congés), ${vet.prenom} ne peut prendre aucune garde sur cette période : le planning se fera entièrement sans ${vet.prenom}. Vérifie que c’est bien voulu.`,
      })
    }
  }
  return out
}

// ── (a2) Créneaux qu'aucune combinaison ne peut pourvoir ─────
// Un créneau demande N vétos DISTINCTS. Si, à planning vide (le cas le PLUS
// favorable), un rôle n'a aucun candidat ou l'union des candidats < N, la
// génération échouera À COUP SÛR sur ce créneau.

const MAX_DATES_AFFICHEES = 4
const MAX_RAISONS_AFFICHEES = 3

function detecterCreneauxImpossibles(
  slots: SlotPreVol[],
  dispos: DisponibilitesParSlot,
  vetsN: VetEngineNormalise[],
  input: PreVolInput,
): AvertissementPreVol[] {
  // Regroupés par type de créneau (une seule alerte par type, dates agrégées).
  const parType = new Map<string, { dates: string[]; places: number; raisons: Set<string> }>()
  const planningVide: PlanningPartiel = { attributions: [] }
  const diagInput = {
    vets: vetsN,
    calendrier: input.calendrier,
    structureConfig: input.structureConfig,
  }

  slots.forEach((s, i) => {
    const parRole = dispos.candidatsParRole[i]
    const union = dispos.candidatsParSlot[i]
    const roleVide = s.roles.some((r) => (parRole.get(r) ?? []).length === 0)
    const pasAssezDistincts = union.length < s.roles.length
    if (!roleVide && !pasAssezDistincts) return

    let groupe = parType.get(s.type)
    if (!groupe) {
      groupe = { dates: [], places: s.roles.length, raisons: new Set() }
      parType.set(s.type, groupe)
    }
    groupe.dates.push(s.date)
    groupe.places = Math.max(groupe.places, s.roles.length)
    // Raisons dominantes : pourquoi les vétos écartés le sont (source unique diagnostic).
    if (groupe.raisons.size < MAX_RAISONS_AFFICHEES) {
      const step = versStep(s, s.roles[0], input.saison)
      const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
      for (const r of raisonsSurCreneau(step, planningVide, diagInput, structure)) {
        if (groupe.raisons.size >= MAX_RAISONS_AFFICHEES) break
        groupe.raisons.add(sansPrefixeTechnique(r.raison))
      }
    }
  })

  const out: AvertissementPreVol[] = []
  for (const [type, g] of parType) {
    const nom = nomCreneau(type, input.creneaux)
    const affichees = g.dates.slice(0, MAX_DATES_AFFICHEES).map(dateLisible).join(', ')
    const reste = g.dates.length - MAX_DATES_AFFICHEES
    const quand = reste > 0 ? `${affichees} (et ${reste} autre${reste > 1 ? 's' : ''} date${reste > 1 ? 's' : ''})` : affichees
    out.push({
      code: 'creneau_impossible',
      regles: [...g.raisons],
      message: g.places > 1
        ? `Le créneau « ${nom} » demande ${g.places} vétérinaires différents, mais il n’y en a pas assez de disponibles le ${quand} : la génération échouera sur ce créneau.`
        : `Personne ne peut prendre le créneau « ${nom} » le ${quand} : la génération échouera sur ce créneau.`,
    })
  }
  return out
}

// ── (a3) Arithmétique de charge — plafonds vs places à pourvoir ──
// « Espacements/limites impossibles vu le nombre de créneaux et de vétos » :
// on calcule pour chaque véto un PLAFOND certain de gardes sur la période
// (au_plus_n, espacement_min) ; si la somme des plafonds est inférieure au
// nombre de places à pourvoir, AUCUN planning n'existe — c'est prouvable
// avant de générer. Les bornes sont des MAJORANTS (jamais de faux positif).

interface CapaciteVet {
  cap: number
  reglesLimitantes: string[]
}

function capaciteVet(
  vet: VetEngineNormalise,
  nbSemainesCiviles: number,
  nbJours: number,
  nbSlots: number,
  nomVeto: (id: string) => string,
): CapaciteVet {
  let cap = nbSlots // sans limite : au plus une garde par créneau
  const limitantes: string[] = []

  for (const c of vet.contraintes) {
    if (!c.actif || !estDure(c)) continue
    const p = paramsDe(c)

    if (c.type === 'au_plus_n') {
      // Un filtre de créneaux rend la borne partielle → on l'ignore (prudent).
      const creneauxFiltre = p.creneaux ?? (c.config as Record<string, unknown>).creneaux
      if (Array.isArray(creneauxFiltre) && creneauxFiltre.length > 0) continue
      const nRaw = p.n
      const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
      if (!Number.isFinite(n) || n < 0) continue // mal configurée → inerte (comme le moteur)
      const f = typeof p.fenetre === 'string' ? p.fenetre : 'semaine_civile'
      const m = f.match(/^glissante_(\d+)_jours$/)
      const borne = m
        ? n * Math.ceil(nbJours / Math.max(1, parseInt(m[1], 10)))
        : n * nbSemainesCiviles // défaut : semaine civile (même défaut que le moteur)
      if (borne < cap) {
        cap = borne
        limitantes.push(libelleRegle(vet.prenom, c, nomVeto))
      }
    }

    if (c.type === 'espacement_min') {
      const eRaw = p.ecart_min_jours
      const ecart = typeof eRaw === 'number' ? eRaw : typeof eRaw === 'string' ? parseInt(eRaw, 10) : NaN
      if (!Number.isFinite(ecart) || ecart <= 0) continue
      const borne = Math.floor((nbJours - 1) / ecart) + 1
      if (borne < cap) {
        cap = borne
        limitantes.push(libelleRegle(vet.prenom, c, nomVeto))
      }
    }
  }
  return { cap: Math.max(0, cap), reglesLimitantes: limitantes }
}

function detecterChargeInsuffisante(
  slots: SlotPreVol[],
  vetsN: VetEngineNormalise[],
  input: PreVolInput,
  nomVeto: (id: string) => string,
): AvertissementPreVol[] {
  if (slots.length === 0 || vetsN.length === 0) return []
  const totalPlaces = slots.reduce((n, s) => n + s.roles.length, 0)
  const nbJours = nbJoursEntre(input.dateDebut, input.dateFin)
  const semaines = new Set<string>()
  for (const s of slots) semaines.add(lundiDeSemaine(s.date))
  const nbSemaines = Math.max(1, semaines.size)

  let somme = 0
  const regles: string[] = []
  for (const vet of vetsN) {
    const { cap, reglesLimitantes } = capaciteVet(vet, nbSemaines, nbJours, slots.length, nomVeto)
    somme += cap
    if (cap < slots.length) regles.push(...reglesLimitantes)
  }

  if (somme >= totalPlaces) return []
  return [{
    code: 'charge_globale_insuffisante',
    regles: [...new Set(regles)],
    message: `Les limites de charge configurées ne permettent pas de couvrir la période : ${totalPlaces} gardes sont à pourvoir, mais les règles n’en autorisent que ${somme} au total. Assouplis une de ces règles ou ajoute un vétérinaire, sinon la génération échouera.`,
  }]
}

// ── (a4) Espacement des week-ends vs nombre de week-ends ────

function detecterWeekendsInsuffisants(
  slots: SlotPreVol[],
  vetsN: VetEngineNormalise[],
  nomVeto: (id: string) => string,
): AvertissementPreVol[] {
  const weSlots = slots.filter((s) => s.type === 'weekend')
  if (weSlots.length === 0 || vetsN.length === 0) return []
  const wePlaces = weSlots.reduce((n, s) => n + s.roles.length, 0)
  const nbWe = weSlots.length

  // Dates des week-ends (samedis) de la période — pour évaluer la capacité
  // RÉDUITE d'un véto en cadencement `interdit` (#20 : il ne peut couvrir que
  // les WE HORS de son cycle). Le WE est daté du samedi.
  const datesWe = weSlots.map((s) => s.date)
  const samediAncre = (date: string): string => samediDeSemaine(date)
  const surCycle = (sam: string, ancreSam: string, n: number): boolean => {
    const ms =
      new Date(sam + 'T12:00:00Z').getTime() -
      new Date(ancreSam + 'T12:00:00Z').getTime()
    const semaines = Math.round(ms / (7 * 24 * 60 * 60 * 1000))
    return ((semaines % n) + n) % n === 0
  }

  let somme = 0
  const regles: string[] = []
  for (const vet of vetsN) {
    let cap = nbWe
    for (const c of vet.contraintes) {
      if (!c.actif || !estDure(c)) continue
      const p = paramsDe(c)
      if (c.type === 'espacement_weekend') {
        const nRaw = p.n_semaines
        const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
        if (!Number.isFinite(n) || n <= 1) continue // inerte (comme le moteur)
        const borne = Math.ceil(nbWe / n)
        if (borne < cap) {
          cap = borne
          regles.push(libelleRegle(vet.prenom, c, nomVeto))
        }
      } else if (c.type === 'cadencement_weekend' && p.sens === 'interdit') {
        // Cadencement pompier « interdit » : le véto ne peut couvrir QUE les WE
        // qui ne tombent PAS sur son cycle. On borne sa capacité au nombre de WE
        // hors cycle (indépendant de espacement_weekend → on prend le min).
        const nRaw = p.n_semaines
        const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
        if (!Number.isFinite(n) || n < 2) continue // inerte
        const ancre = typeof p.ancre === 'string' ? p.ancre : ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ancre) || Number.isNaN(new Date(ancre + 'T12:00:00Z').getTime())) continue
        const ancreSam = samediAncre(ancre)
        const horsCycle = datesWe.filter((d) => !surCycle(d, ancreSam, n)).length
        if (horsCycle < cap) {
          cap = horsCycle
          regles.push(libelleRegle(vet.prenom, c, nomVeto))
        }
      }
    }
    somme += cap
  }

  if (somme >= wePlaces) return []
  return [{
    code: 'weekends_insuffisants',
    regles: [...new Set(regles)],
    message: `Les règles d’espacement des week-ends ne permettent pas de couvrir tous les week-ends de la période : ${wePlaces} places de week-end sont à pourvoir, mais les règles n’en autorisent que ${somme} au total. Assouplis une de ces règles ou ajoute un vétérinaire.`,
  }]
}

// ============================================================
// preVolRegles — POINT D'ENTRÉE (fonction pure)
// ============================================================

/**
 * Analyse la configuration AVANT génération et renvoie la liste des
 * avertissements NON bloquants. Tableau vide = rien à signaler (silence).
 */
export function preVolRegles(input: PreVolInput): AvertissementPreVol[] {
  // Auto-normalisation (idempotente) — même parade anti-cécité params que le
  // diagnostic : le pré-vol est un LECTEUR de règles.
  const vetsN = normaliserContraintesVets(input.vets)
  const actifsIds = new Set(vetsN.map((v) => v.id))
  const nomVeto = (id: string) => {
    const actif = vetsN.find((v) => v.id === id)
    if (actif) return actif.prenom
    const fiche = input.annuaire?.find((a) => a.id === id)
    return fiche ? fiche.prenom : id
  }

  const slots = enumererSlots(input)
  const dispos = calculerDisponibilites(slots, vetsN, input)

  return [
    // (b) règles fantômes — véto sorti
    ...detecterReglesFantomes(input, actifsIds, nomVeto),
    ...detecterDuosFantomes(vetsN, input, actifsIds, nomVeto),
    // (a) contradictions arithmétiques certaines
    ...detecterVetosJamaisDisponibles(slots, dispos, vetsN, nomVeto),
    ...detecterCreneauxImpossibles(slots, dispos, vetsN, input),
    ...detecterChargeInsuffisante(slots, vetsN, input, nomVeto),
    ...detecterWeekendsInsuffisants(slots, vetsN, nomVeto),
    // (c) composition d'équipe sans porteur du tag (n°6)
    ...detecterCompositionsSansPorteur(vetsN, input),
    // (d) rôle interdit intenable — tous les vétos portent le tag (n°22)
    ...detecterRolesInterditsIntenables(vetsN, input),
    // (e) règles de rythme (#13) arithmétiquement inertes (ex. serie_max = 0)
    ...detecterSequencesInertes(vetsN, nomVeto),
    // (f) cohortes d'équité (#21) dont aucun véto actif ne porte le tag → inerte
    ...detecterCohortesEquiteSansPorteur(vetsN, input),
  ]
}

// ── (f) Cohortes d'équité — tag sans porteur (Vague 6 #21) ──
// Une cohorte d'équité taguée sur une étiquette QUE PERSONNE ne porte est
// simplement INERTE (variance calculée sur 0 véto = 0). Avertissement LÉGER,
// non bloquant : c'est probablement un tag oublié sur les fiches de l'équipe.
// (Une cohorte à 1 seul porteur est aussi de variance 0 mais reste un choix
// admin volontaire potentiel — on ne signale QUE le zéro porteur.)
function detecterCohortesEquiteSansPorteur(
  vets: VetEngine[],
  input: PreVolInput,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  const cohortes = input.cohortesEquite ?? []
  // Dédoublonne par tag (plusieurs dimensions peuvent viser le même tag absent).
  const tagsSansPorteur = new Set<string>()
  for (const co of cohortes) {
    const tagNorm = co.tag.trim().toLowerCase()
    if (tagNorm === '' || tagsSansPorteur.has(tagNorm)) continue
    const porteurs = vets.some((v) =>
      (v.tags ?? []).some((t) => t.trim().toLowerCase() === tagNorm),
    )
    if (!porteurs) tagsSansPorteur.add(tagNorm)
  }
  for (const tag of tagsSansPorteur) {
    out.push({
      code: 'cohorte_equite_sans_porteur',
      regles: [`équilibrage réservé aux vétérinaires « ${tag} »`],
      message: `Un réglage d'équité vise l'étiquette « ${tag} », mais aucun vétérinaire actif ne la porte : ce réglage n'a aucun effet. Ajoutez l'étiquette sur les fiches concernées (page Équipe) ou retirez la cohorte depuis l'écran Règles.`,
    })
  }
  return out
}

// ── (e) Successions / séries / repos avancés — configs inertes (#13) ──
// Ces briques ne rendent JAMAIS un véto « jamais disponible » (elles ne se
// déclenchent pas sur un planning vide), donc les détecteurs (a) ne les voient
// pas. En revanche une config arithmétiquement absurde les rend silencieusement
// SANS EFFET (coquille vide) — on le signale ici :
//   • serie_max avec n_jours ≤ 0 → aucune borne (le moteur la traite comme inerte)
//   • repos_apres_serie avec n_jours ≤ 0 OU repos_jours ≤ 0 → aucun repos imposé
//   • succession_interdite avec type_avant/type_apres vide → aucune succession jugée
// (Le moteur ignore déjà ces cas — pas de crash ; l'alerte évite juste le piège.)
function detecterSequencesInertes(
  vets: VetEngineNormalise[],
  nomVeto: (id: string) => string,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  const entier = (v: unknown): number =>
    typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN

  for (const vet of vets) {
    for (const c of vet.contraintes) {
      if (!c.actif) continue
      const p = paramsDe(c)
      let inerte = false
      if (c.type === 'serie_max') {
        const n = entier(p.n_jours)
        inerte = !Number.isFinite(n) || n <= 0
      } else if (c.type === 'repos_apres_serie') {
        const n = entier(p.n_jours)
        const m = entier(p.repos_jours)
        inerte = !Number.isFinite(n) || n <= 0 || !Number.isFinite(m) || m <= 0
      } else if (c.type === 'succession_interdite') {
        const av = typeof p.type_avant === 'string' ? p.type_avant.trim() : ''
        const ap = typeof p.type_apres === 'string' ? p.type_apres.trim() : ''
        inerte = av === '' || ap === ''
      } else if (c.type === 'cadencement_weekend') {
        // Cadencement « 1 WE sur N ancré » (#20) : inerte si n < 2, ancre non-date,
        // ou sens inconnu (le moteur l'ignore alors silencieusement).
        const n = entier(p.n_semaines)
        const ancre = typeof p.ancre === 'string' ? p.ancre : ''
        const ancreValide = /^\d{4}-\d{2}-\d{2}$/.test(ancre) &&
          !Number.isNaN(new Date(ancre + 'T12:00:00Z').getTime())
        const sensValide = p.sens === 'interdit' || p.sens === 'impose'
        inerte = !Number.isFinite(n) || n < 2 || !ancreValide || !sensValide
      } else if (c.type === 'exclusion_dates') {
        // XOR « pas les deux » (#15a) : inerte si AUCUNE forme valide (ni paire de
        // fêtes distinctes, ni paire de dates ISO distinctes) → le moteur l'ignore.
        const estCodeFete = (x: unknown) => x === 'noel' || x === 'nouvel_an'
        const fetes = Array.isArray(p.fetes) ? p.fetes : []
        const paireFetesOk =
          fetes.length === 2 && estCodeFete(fetes[0]) && estCodeFete(fetes[1]) && fetes[0] !== fetes[1]
        const isISO = (x: unknown): x is string =>
          typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) &&
          !Number.isNaN(new Date(x + 'T12:00:00Z').getTime())
        const dates = Array.isArray(p.dates) ? p.dates : []
        const paireDatesOk = dates.length === 2 && isISO(dates[0]) && isISO(dates[1]) && dates[0] !== dates[1]
        inerte = !paireFetesOk && !paireDatesOk
      } else {
        continue
      }
      if (inerte) {
        const estRythme = c.type !== 'exclusion_dates'
        out.push({
          code: 'sequence_inerte',
          regles: [libelleRegle(vet.prenom, c, nomVeto)],
          message: estRythme
            ? `Une règle de rythme de ${vet.prenom} est mal paramétrée (valeur nulle ou incomplète) : elle n'aura aucun effet. Modifie-la ou supprime-la depuis l'écran Règles.`
            : `Une règle « pas les deux dates » de ${vet.prenom} est mal paramétrée (dates identiques ou incomplètes) : elle n'aura aucun effet. Modifie-la ou supprime-la depuis l'écran Règles.`,
        })
      }
    }
  }
  return out
}

// ── (d) Rôle interdit par tag — intenable (backlog n°22) ──
// « Un junior jamais 1er » alors que TOUS les vétos actifs sont juniors :
// personne ne peut tenir le rôle sur les créneaux ciblés → impasse certaine
// si la règle est dure. Un tag que personne ne porte rend, lui, la règle
// simplement INERTE — signalé aussi (tag probablement oublié sur les fiches).
function detecterRolesInterditsIntenables(
  vets: VetEngine[],
  input: PreVolInput,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  const regles = (input.structureConfig?.rolesInterdits ?? []).filter((r) => r.actif)
  for (const regle of regles) {
    const tagNorm = regle.tag.trim().toLowerCase()
    const porteurs = vets.filter((v) =>
      (v.tags ?? []).some((t) => t.trim().toLowerCase() === tagNorm),
    )
    const libelle = `les vétérinaires « ${regle.tag} » ne tiennent jamais le rôle « ${regle.role} »`
    if (porteurs.length === 0) {
      out.push({
        code: 'role_interdit_intenable',
        regles: [libelle],
        message: `La règle « ${libelle} » est active mais aucun vétérinaire actif ne porte l'étiquette « ${regle.tag} » : elle est sans effet. Ajoutez l'étiquette sur les fiches concernées (Équipe) ou supprimez la règle.`,
      })
    } else if (porteurs.length === vets.length && regle.etage <= ETAGE_DUR_MAX) {
      out.push({
        code: 'role_interdit_intenable',
        regles: [libelle],
        message: `TOUS les vétérinaires actifs portent l'étiquette « ${regle.tag} » : personne ne peut tenir le rôle « ${regle.role} » sur les créneaux concernés — la génération échouera. Retirez l'étiquette d'au moins un vétérinaire ou assouplissez la règle.`,
      })
    }
  }
  return out
}

// ── (c) Composition d'équipe — tag sans porteur (backlog n°6) ──
// Une règle « au moins un vétérinaire "senior" » alors qu'AUCUN véto actif ne
// porte le tag = impasse CERTAINE sur tous les créneaux ciblés si la règle est
// dure (et pénalité systématique si souple). Une règle « pas seuls » sans
// porteur est, elle, simplement INERTE (personne à protéger) — on le signale
// aussi : c'est probablement un tag oublié sur les fiches de l'équipe.
function detecterCompositionsSansPorteur(
  vets: VetEngine[],
  input: PreVolInput,
): AvertissementPreVol[] {
  const out: AvertissementPreVol[] = []
  const compositions = (input.structureConfig?.compositions ?? []).filter((r) => r.actif)
  for (const regle of compositions) {
    const tagNorm = regle.tag.trim().toLowerCase()
    const porteurs = vets.filter((v) =>
      (v.tags ?? []).some((t) => t.trim().toLowerCase() === tagNorm),
    )
    if (porteurs.length > 0) continue
    const dure = regle.etage <= ETAGE_DUR_MAX
    if (regle.mode === 'au_moins_un') {
      out.push({
        code: 'composition_sans_porteur',
        regles: [`au moins un vétérinaire « ${regle.tag} » par créneau`],
        message: dure
          ? `La règle « au moins un vétérinaire ${regle.tag} » est active mais AUCUN vétérinaire actif ne porte l'étiquette « ${regle.tag} » : les créneaux concernés seront impossibles à pourvoir. Ajoutez l'étiquette sur les fiches de l'équipe (Équipe) ou désactivez la règle.`
          : `La préférence « au moins un vétérinaire ${regle.tag} » est active mais aucun vétérinaire actif ne porte l'étiquette « ${regle.tag} » : elle ne pourra jamais être satisfaite. Ajoutez l'étiquette sur les fiches de l'équipe ou désactivez la règle.`,
      })
    } else {
      out.push({
        code: 'composition_sans_porteur',
        regles: [`les vétérinaires « ${regle.tag} » ne sont jamais seuls`],
        message: `La règle « les vétérinaires ${regle.tag} ne sont jamais seuls » est active mais aucun vétérinaire actif ne porte l'étiquette « ${regle.tag} » : elle est sans effet. Ajoutez l'étiquette sur les fiches concernées (Équipe) ou supprimez la règle.`,
      })
    }
  }
  return out
}
