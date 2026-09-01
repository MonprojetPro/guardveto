// ============================================================
// GUARDVETO — Validateur INDÉPENDANT de planning
// ============================================================
//
// OBJECTIF : prouver que le planning PRODUIT par le solver respecte
// TOUTES les contraintes dures, en ré-implémentant CHAQUE vérification
// À PARTIR de la définition de la règle — SANS réutiliser les fonctions
// `check*` de `rules/hard-constraints.ts`.
//
// POURQUOI L'INDÉPENDANCE EST IMPÉRATIVE :
//   Le solver et le validateur ne doivent partager AUCUNE logique de
//   contrainte. Si un bug se glisse dans `hard-constraints.ts` (ex. le
//   bug réel de 2026-06 où `duo_interdit` lisait le mauvais chemin de
//   config après une migration et se taisait silencieusement), un
//   validateur qui réutilise ces mêmes fonctions ne le verrait PAS :
//   le bug passerait des deux côtés. Ici on regarde uniquement le
//   RÉSULTAT (le planning final) et on le confronte à la règle métier.
//
// Ce validateur n'importe donc DÉLIBÉRÉMENT que :
//   - les types (formes de données)
//   - des helpers de dates PURS et triviaux (jour de semaine, addition de
//     jours) — ré-implémentés ici pour ne dépendre d'aucune logique métier.
//
// Il ne lit PAS les vacances scolaires « en dur » : celles-ci sont passées
// par le `calendrier` du SolverInput (ou laissées vides), exactement comme
// le solver les reçoit, pour que la comparaison soit faite sur le MÊME
// référentiel calendaire.
// ============================================================

import type {
  VetEngine,
  AttributionGarde,
  PlanningPartiel,
  CalendrierResolu,
  JourSemaine,
} from '../types'
import { normaliserContraintesVets } from '../normaliserContraintes'
// Les `detail` de ce fichier ne sont PAS des journaux techniques : ils
// s'affichent tels quels dans la fenêtre de publication et dans le bandeau
// d'incohérences, sous les yeux du cabinet. Une date y va donc en français.
import { dateFr, periodeFr } from '@/lib/dates-fr'
import {
  DEFAULT_STRUCTURE_CONFIG, estStructureDure, RELATIONS_STRUCTURE_DEFAUT,
  type StructureConfig, type RelationStructure,
} from '../structure-config'
import type { CreneauModele } from '../creneau-modele'

// ── Entrée minimale attendue (sous-ensemble de SolverInput) ──
export interface ValidationInput {
  dateDebut: string
  dateFin: string
  saison: 'ete' | 'hiver'
  vets: VetEngine[]
  calendrier?: CalendrierResolu
  /** Effectif configurable (1 ou 2 vétos la nuit en semaine). Absent → repli saison. */
  nbVetosSemaineSoir?: number
  /**
   * Config R8/R9 (réglables). On ne signale une violation R8/R9 que si la règle
   * est appliquée en DUR (active + étage ≤ 2). Souple/désactivée → pas de
   * violation (sinon le validateur crierait des violations FANTÔMES pour un
   * cabinet qui a assoupli/coupé la règle). MÊME config que le moteur.
   */
  structureConfig?: StructureConfig
  /**
   * Catalogue de créneaux du cabinet (fondamentaux universels, P1) — MÊME source
   * que le moteur (SolverInput.creneaux). Présent → la dérivation jour→type est
   * LUE du catalogue (donnée), comme le moteur en P2b ; absent/vide → repli sur
   * le mapping en dur historique. Ré-implémenté ici (cf. typeCreneauPourJour) sans
   * importer la dérivation du solver, pour préserver l'INDÉPENDANCE : une
   * divergence de structure se traduit en violation DÉTECTÉE, pas cachée.
   */
  creneaux?: CreneauModele[]
  /**
   * #17 (Vague 5) — LOOKBACK INTER-PÉRIODES. Attributions FIGÉES de la fin de la
   * période PRÉCÉDENTE (~10 j), MÊME donnée que `SolverInput.contexteAnterieur`.
   * Le validateur ÉTEND lui-même ses listes de dates avec ce lookback dans ses
   * seuls blocs de RYTHME (espacement_min, espacement_weekend, R3) — sans importer
   * le helper du moteur (principe des deux gardiens indépendants). Absent/vide →
   * comportement historique byte-identique. Ne touche NI la couverture NI R21/R22.
   */
  contexteAnterieur?: AttributionGarde[]
}

// ── Une violation détectée ───────────────────────────────
export interface Violation {
  /** Code de la règle violée (R1, R2, … ou un invariant de couverture) */
  regle: string
  /** Date ISO du créneau concerné */
  date: string
  /** Type de créneau */
  type: string
  /** Rôle concerné, si pertinent — label libre (P3a-2), défauts premier/second. */
  role?: string
  /** Vétérinaire fautif, si identifiable */
  vetId?: string
  /** Détail concret lisible */
  detail: string
  /**
   * ORIGINE de la violation — n'est posé QUE sur les règles de RYTHME, et
   * seulement quand la réponse est « pas cette période ».
   *
   *   • absent   → la violation implique au moins une date de la période
   *                validée : c'est CE planning qui la produit ;
   *   • 'anterieure' → TOUTES les dates en cause viennent du LOOKBACK #17, donc
   *                d'une période ANTÉRIEURE. Le planning courant n'y est pour
   *                rien — mais elle reste signalée, parce que ces dates peuvent
   *                encore être dans le futur et qu'on peut encore agir dessus
   *                (déverrouiller la période précédente, retoucher à la main).
   *
   * L'affichage s'en sert pour dire « héritée de l'historique, hors de cette
   * période » au lieu de laisser croire à une faute de la génération courante.
   */
  origine?: 'anterieure'
}

// ── Helpers de dates PURS (ré-implémentés, zéro dépendance métier) ──

const JOURS: JourSemaine[] = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
]

/** Index du jour : 0=dimanche … 6=samedi */
function jIndex(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay()
}

function jourNom(date: string): JourSemaine {
  return JOURS[jIndex(date)]
}

function plusJours(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

/** Nombre de jours (absolu) entre deux dates ISO. Remonté au niveau module :
 *  `ecartReelEntreGardes` en a besoin, et il ne peut pas voir une closure. */
function joursEntre(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00Z').getTime()
  const db = new Date(b + 'T12:00:00Z').getTime()
  return Math.round(Math.abs(db - da) / 86_400_000)
}

/**
 * Jours civils COUVERTS par une garde : le week-end est daté du samedi mais
 * couvre samedi ET dimanche.
 *
 * Miroir DÉLIBÉRÉ de `hard-constraints.joursCouvertsGarde` — ce validateur est
 * un second gardien indépendant et n'importe jamais `rules/`. Trois copies
 * identiques de ce miroir vivaient plus bas dans ce fichier ; elles sont
 * remplacées par celle-ci, sans changer leur comportement. Trois définitions du
 * même mot dans un seul fichier finissent toujours par diverger (B-088).
 */
function joursCouvertsDeGarde(date: string, type: string): string[] {
  return type === 'weekend' ? [date, plusJours(date, 1)] : [date]
}

/**
 * Écart RÉEL entre deux gardes, en jours de répit — la plus petite distance
 * entre leurs jours couverts, jamais entre leurs dates d'ancrage.
 *
 * Un week-end daté du samedi et une garde le lundi étaient réputés à 2 jours
 * d'écart, alors que la personne sort de garde le lundi matin et reprend le
 * lundi soir. Trouvé par MiKL le 2026-08-31 sur Hiver P2.
 */
function ecartReelEntreGardes(
  dateA: string, typeA: string, dateB: string, typeB: string,
): number {
  let min = Infinity
  for (const ja of joursCouvertsDeGarde(dateA, typeA)) {
    for (const jb of joursCouvertsDeGarde(dateB, typeB)) {
      const d = joursEntre(ja, jb)
      if (d < min) min = d
    }
  }
  return min
}

/** Lundi de la semaine ISO contenant `date` */
function lundiDe(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  const j = d.getUTCDay()
  const diff = j === 0 ? -6 : 1 - j
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

function samediDe(date: string): string {
  return plusJours(lundiDe(date), 5)
}

function entre(date: string, debut: string, fin: string): boolean {
  return date >= debut && date <= fin
}

// ── Calendrier (vacances / fériés) — depuis l'input UNIQUEMENT ──
// Pour rester 100% indépendant et déterministe, on n'utilise QUE le
// calendrier fourni (comme le solver). Sans calendrier → vacances vides,
// fériés vides : on n'invente aucun référentiel en dur.

function estEnVacances(date: string, cal?: CalendrierResolu): boolean {
  if (!cal) return false
  return cal.vacancesScolaires.some((v) => entre(date, v.debut, v.fin))
}

/**
 * Parité « ancrée » ré-implémentée indépendamment.
 * Compte les semaines pleines (différence de lundis / 7) entre l'ancre
 * effective et la date. L'ancre effective avance au lundi du dernier début
 * de vacances <= date (et strictement après l'ancre initiale).
 */
function estSemaineImpaireAncree(
  date: string,
  ancre: string,
  vacances: Array<{ debut: string; fin: string }>
): boolean {
  const ancreLundi = lundiDe(ancre)
  const dateLundi = lundiDe(date)
  let ancreEff = ancreLundi
  for (const v of vacances) {
    const vLundi = lundiDe(v.debut)
    if (v.debut <= date && vLundi > ancreEff) ancreEff = vLundi
  }
  const MS_SEM = 7 * 24 * 60 * 60 * 1000
  const diff =
    new Date(dateLundi + 'T12:00:00Z').getTime() -
    new Date(ancreEff + 'T12:00:00Z').getTime()
  const nbSem = Math.round(diff / MS_SEM)
  return nbSem % 2 !== 0
}

/** Parité ISO globale (fallback quand aucune ancre n'est fournie) */
function numeroSemaineISO(date: string): number {
  const d = new Date(date + 'T12:00:00Z')
  const jeudi = new Date(d)
  jeudi.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)))
  const debutAnnee = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 1))
  return Math.ceil(((jeudi.getTime() - debutAnnee.getTime()) / 86400000 + 1) / 7)
}

function estSemaineImpaireISO(date: string): boolean {
  return numeroSemaineISO(date) % 2 !== 0
}

/**
 * Un repos fixe vise-t-il CE type de garde ? Absent ou vide = toute la journée.
 *
 * ⚠️ MIROIR EXACT de `viseCeCreneau` (hard-constraints.ts). Les deux gardiens
 *    doivent lire la règle de la MÊME façon : si le validateur ignorait le
 *    ciblage, il compterait comme violation une garde que le solver a placée en
 *    toute légalité — et le planning s'afficherait « incohérent » sans l'être.
 *    Le projet a déjà payé ce prix sur R8/R9 (une config threadée au moteur mais
 *    pas au validateur).
 */
function viseCeCreneau(cfg: Record<string, unknown>, typeSlot: string): boolean {
  const cibles = cfg.creneaux
  if (!Array.isArray(cibles) || cibles.length === 0) return true
  return (cibles as unknown[]).some((code) => code === typeSlot)
}

/** Résout la parité « impaire » d'une date selon la config de contrainte */
function estImpaire(
  date: string,
  ancre: string | undefined,
  cal?: CalendrierResolu
): boolean {
  if (ancre) {
    return estSemaineImpaireAncree(date, ancre, cal?.vacancesScolaires ?? [])
  }
  return estSemaineImpaireISO(date)
}

// ── Lecteur de partenaires « duo interdit » (toutes formes de config) ──
// Ré-implémenté indépendamment (le bug réel de 2026-06 venait précisément
// d'un lecteur qui ne regardait pas tous les chemins → on couvre les 3).
function lireDuoInterditIds(config: Record<string, unknown>): string[] {
  const ids: string[] = []
  const pousser = (v: unknown) => {
    if (typeof v === 'string' && v.trim() !== '') ids.push(v)
    else if (Array.isArray(v))
      for (const x of v) if (typeof x === 'string' && x.trim() !== '') ids.push(x)
  }
  pousser(config.avec_veterinaire_id)
  const params = config.params
  if (params && typeof params === 'object') {
    pousser((params as Record<string, unknown>).avec_veterinaire_id)
  }
  const axes = config.axes
  if (axes && typeof axes === 'object') {
    pousser((axes as Record<string, unknown>).qui)
  }
  return [...new Set(ids)]
}

// ── Helpers d'accès au planning ──────────────────────────

function trouver(
  planning: PlanningPartiel,
  date: string,
  type: string
): AttributionGarde | undefined {
  return planning.attributions.find((a) => a.date === date && a.type === type)
}

// ── Accès aux PLACES (modèle P3a) — ré-implémentés INDÉPENDAMMENT ──
// Le validateur ne partage aucune logique avec le solver (cf. en-tête). Ces
// accesseurs sur la forme `placements` sont triviaux et ré-écrits ici, comme
// jIndex/plusJours, pour ne dépendre d'aucun helper du moteur.

/** Véto d'une place (par label de rôle), ou null si place absente/non pourvue. */
function vetRole(a: AttributionGarde | undefined, role: string): string | null {
  return a?.placements.find((p) => p.role === role)?.vetId ?? null
}

/** Le véto occupe-t-il l'une des places de ce créneau ? */
function surCreneau(a: AttributionGarde | undefined, vetId: string): boolean {
  return !!a && a.placements.some((p) => p.vetId === vetId)
}

/** Tous les vétos assignés (n'importe quelle place) sur une attribution */
function membres(a: AttributionGarde | undefined): string[] {
  if (!a) return []
  return a.placements.map((p) => p.vetId).filter((x): x is string => x !== null)
}

// ── Construction des créneaux ATTENDUS (couverture) ──────
// Indépendant du solver : on dérive la structure directement de la règle
// métier R17/R18/R19 (été = 1 véto semaine, hiver = 2 ; WE & ven soir = 2).
// Le type de créneau d'un jour vient du CATALOGUE si le cabinet en fournit un
// (donnée, comme le moteur en P2b), sinon du mapping en dur historique.
interface SlotAttendu {
  date: string
  /** Code du créneau : historique OU sur-mesure (P3b). */
  type: string
  /**
   * Places attendues (labels, dans l'ordre) — P3a-2. Vient du catalogue si le
   * cabinet en fournit un (`nbPlaces`/`roles`), sinon du défaut 2-rôles en dur.
   * L'effectif configurable plafonne UNIQUEMENT `semaine_soir` (été 1 / hiver 2).
   */
  roles: string[]
}

/**
 * Slots attendus sur la période, DÉRIVÉS du catalogue si présent (donnée),
 * sinon du mapping en dur historique. Ré-implémenté ICI, sans importer la
 * dérivation du moteur (`stepsForDay`) : le validateur reste DÉLIBÉRÉMENT
 * indépendant, exactement comme il ré-implémente déjà `jIndex`/`plusJours`.
 * Une divergence entre cette dérivation et celle du solver se traduit alors
 * en violation DÉTECTÉE par le banc d'essai, pas cachée.
 *
 * Généralisé P3b : TOUS les créneaux actifs non-fériés couvrant un jour sont
 * attendus (plus de « premier créneau seulement »), y compris les codes
 * SUR-MESURE. Seuls un code null (jamais codifié) et 'ferie' (reclassification
 * au scoring, pas un slot) sont sans slot attendu — même contrat que le moteur.
 * Seul `semaine_soir` est plafonné par l'effectif configurable. Pour le
 * catalogue PAR DÉFAUT, le résultat est identique au mapping en dur (banc
 * d'équivalence).
 */
/**
 * Le plafond d'effectif d'une nuit de semaine, RÉ-IMPLÉMENTÉ ICI À DESSEIN.
 *
 * Le moteur a `plafondNuitSemaine()` dans structure-creneaux.ts ; ce validateur
 * ne l'importe pas, par la même règle qui lui interdit `typeGardePourJour` : il
 * doit rester un contrôle CROISÉ, capable de contredire le moteur. S'il partage
 * la fonction, une erreur dedans devient invisible — les deux se trompent
 * ensemble et se donnent raison.
 *
 * La contrepartie est que les deux définitions doivent bouger ensemble. Le
 * garde-fou n'est pas la mémoire mais les tests d'équivalence : un désaccord
 * fait remonter des violations fantômes sur des plannings sains.
 *
 * Règle (2026-08-04) : la surcharge du planning si elle existe ; sinon la
 * structure des gardes décide (aucun plafond) ; sinon, à défaut de structure,
 * le repli saison.
 */
function plafondNuitSemaineLocal(input: ValidationInput): number {
  if (typeof input.nbVetosSemaineSoir === 'number') return input.nbVetosSemaineSoir
  const avecCatalogue = Boolean(input.creneaux && input.creneaux.length > 0)
  return avecCatalogue ? Number.POSITIVE_INFINITY : (input.saison === 'hiver' ? 2 : 1)
}

function slotsAttendus(input: ValidationInput): SlotAttendu[] {
  const effectifSemaine = plafondNuitSemaineLocal(input)
  const slots: SlotAttendu[] = []
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
      // Repli en dur historique (legacy / hors-cabinet) — miroir de typeGardePourJour.
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

// ============================================================
// validerPlanning — POINT D'ENTRÉE
// ============================================================
/**
 * Inspecte le planning final et retourne TOUTES les violations de
 * contraintes DURES trouvées. Un tableau vide = planning fiable.
 */
export function validerPlanning(
  planning: PlanningPartiel,
  input: ValidationInput
): Violation[] {
  const violations: Violation[] = []
  // Normalise les contraintes (hisse config.params.* à la racine) — MÊME
  // normalisation que le solver (genererPlanningPur), pour que validateur et
  // moteur lisent les règles à l'identique (fin de la cécité commune).
  const vetsNorm = normaliserContraintesVets(input.vets)
  const vetsById = new Map(vetsNorm.map((v) => [v.id, v]))
  const cal = input.calendrier

  // #17 — lookback inter-périodes. Ré-implémenté INDÉPENDAMMENT (pas d'import du
  // helper moteur) : on concatène les attributions figées antérieures DEVANT les
  // attributions courantes, et ce planning ÉTENDU n'est utilisé QUE par les blocs
  // de RYTHME ci-dessous (espacement_min, espacement_weekend, R3). Les blocs de
  // couverture / R21 / R22 / composition gardent `planning` (le lookback ne crée
  // aucun slot et ne compte dans aucune équité). Absent/vide → `planning` tel quel
  // (byte-identique).
  const lookback = input.contexteAnterieur ?? []
  const planningRythme: PlanningPartiel =
    lookback.length === 0
      ? planning
      : { attributions: [...lookback, ...planning.attributions] }

  // ORIGINE des violations de rythme (Lot 1). Le lookback fait délibérément
  // regarder le validateur AVANT le début de la période ; il en ressort parfois
  // une paire dont les DEUX dates sont antérieures — deux week-ends de la
  // période précédente, par exemple. Ce n'est pas une faute du planning courant,
  // et l'afficher comme telle envoie l'admin corriger une garde qui n'est pas là.
  //
  // Le critère est exactement celui du lookback (loader.ts : `.lt('date',
  // date_debut)`) : une date antérieure à `dateDebut` vient forcément de lui.
  // Sans lookback, rien n'est jamais marqué (comportement historique intact).
  const avantPeriode = (d: string): boolean => lookback.length > 0 && d < input.dateDebut
  /** `{ origine: 'anterieure' }` si TOUTES les dates en cause précèdent la période. */
  const marqueOrigine = (...dates: string[]): { origine?: 'anterieure' } =>
    dates.length > 0 && dates.every(avantPeriode) ? { origine: 'anterieure' } : {}

  // ── A. COUVERTURE : chaque créneau attendu existe et est complet ──
  const attendus = slotsAttendus(input)
  for (const s of attendus) {
    const attr = trouver(planning, s.date, s.type)
    if (!attr) {
      violations.push({
        regle: 'COUVERTURE',
        date: s.date,
        type: s.type,
        detail: `Créneau attendu absent du planning (${s.type} du ${dateFr(s.date)})`,
      })
      continue
    }
    // Chaque place attendue (P3a-2) doit être pourvue. Messages premier/second
    // conservés à l'identique (compat) ; générique pour les places au-delà.
    for (const role of s.roles) {
      if (vetRole(attr, role)) continue
      if (role === 'premier') {
        violations.push({
          regle: 'COUVERTURE',
          date: s.date,
          type: s.type,
          role: 'premier',
          detail: `Aucun 1er de garde assigné (${s.type} du ${dateFr(s.date)})`,
        })
      } else if (role === 'second') {
        violations.push({
          regle: s.type === 'weekend' ? 'R19' : 'R18',
          date: s.date,
          type: s.type,
          role: 'second',
          detail:
            s.type === 'weekend'
              ? `week-end sans 2nd de garde (${dateFr(s.date)})`
              : s.type === 'vendredi_soir'
                ? `vendredi soir sans 2nd de garde (${dateFr(s.date)})`
                : `hiver, garde semaine sans 2nd (${dateFr(s.date)})`,
        })
      } else {
        violations.push({
          regle: 'COUVERTURE',
          date: s.date,
          type: s.type,
          role,
          detail: `Place « ${role} » non pourvue (${s.type} du ${dateFr(s.date)})`,
        })
      }
    }
  }

  // ── R17 — effectif nuit semaine = 1 : pas de 2nd en semaine_soir ──
  // Conditionné à l'effectif RÉSOLU, comme le moteur (`slot.besoinSecond`) et
  // la section COUVERTURE ci-dessus — et non au seul `saison === 'ete'` : un
  // cabinet peut régler 2 vétos/nuit en été (fix audit 2026-07-03 : violations
  // fantômes sur été + effectif 2).
  //
  // ⚠️ On lit le nombre de places RÉELLEMENT attendues sur une nuit de semaine
  // (`attendus`), au lieu de recalculer le plafond (2026-08-04). Depuis que la
  // structure des gardes décide en l'absence de surcharge, le plafond seul ne
  // suffit plus : il vaut « aucune limite », alors que le créneau peut très
  // bien n'avoir qu'une place. Recalculer aurait rendu R17 muette là où elle
  // doit parler — et une règle muette ne se remarque jamais.
  const placesNuitSemaine = attendus.find((s) => s.type === 'semaine_soir')?.roles.length
  if (placesNuitSemaine !== undefined && placesNuitSemaine < 2) {
    for (const a of planning.attributions) {
      const second = vetRole(a, 'second')
      if (a.type === 'semaine_soir' && second) {
        violations.push({
          regle: 'R17',
          date: a.date,
          type: a.type,
          role: 'second',
          vetId: second,
          detail: `une seule garde de nuit en semaine (effectif réglé à 1) — un 2nd a été assigné (${dateFr(a.date)})`,
        })
      }
    }
  }

  // ── R21 — toutes les places d'un même créneau = vétos DISTINCTS ──
  // Généralisé N-places (P3a-2) : un même véto ne peut occuper deux places du
  // créneau. Pour le défaut à 2 rôles, c'est exactement « 1er ≠ 2nd ».
  for (const a of planning.attributions) {
    const vus = new Set<string>()
    for (const { vetId } of a.placements) {
      if (!vetId) continue
      if (vus.has(vetId)) {
        violations.push({
          regle: 'R21',
          date: a.date,
          type: a.type,
          vetId,
          detail: `le même vétérinaire occupe deux places du créneau (${a.type} du ${dateFr(a.date)})`,
        })
      } else {
        vus.add(vetId)
      }
    }
  }

  // ── COMPOSITION — équipe par tag (backlog n°6), règles DURES seulement ──
  // Ré-implémenté INDÉPENDAMMENT (jamais d'import de rules/composition-equipe) :
  // on juge l'ÉQUIPE EFFECTIVEMENT PUBLIÉE de chaque créneau ciblé.
  //   • au_moins_un : aucun véto de l'équipe ne porte le tag → violation.
  //   • pas_seuls   : l'équipe n'est composée QUE de porteurs du tag → violation.
  // Souple (étage ≥ 3) → jamais une violation (préférence, pas interdiction).
  {
    const compositions = (input.structureConfig?.compositions ?? []).filter(
      (r) => r.actif && r.etage <= 2,
    )
    for (const regle of compositions) {
      const tagNorm = regle.tag.trim().toLowerCase()
      const porteTag = (vetId: string): boolean => {
        const vt = vetsById.get(vetId)
        return !!vt && (vt.tags ?? []).some((t) => t.trim().toLowerCase() === tagNorm)
      }
      for (const a of planning.attributions) {
        if (regle.creneaux && regle.creneaux.length > 0 && !regle.creneaux.includes(a.type)) continue
        const equipe = membres(a)
        if (equipe.length === 0) continue // couverture jugée à part
        const nbPorteurs = equipe.filter(porteTag).length
        if (regle.mode === 'au_moins_un' && nbPorteurs === 0) {
          violations.push({
            regle: 'COMPOSITION',
            date: a.date,
            type: a.type,
            detail: `aucun vétérinaire « ${regle.tag} » sur ce créneau (${a.type} du ${dateFr(a.date)})`,
          })
        }
        if (regle.mode === 'pas_seuls' && nbPorteurs > 0 && nbPorteurs === equipe.length) {
          violations.push({
            regle: 'COMPOSITION',
            date: a.date,
            type: a.type,
            vetId: equipe[0],
            detail: `uniquement des vétérinaires « ${regle.tag} » sur ce créneau (${a.type} du ${dateFr(a.date)}) — il en faut au moins un sans ce tag`,
          })
        }
      }
    }
  }

  // ── ROLE_TAG — rôle interdit selon attribut (backlog n°22), DUR seulement ──
  // Ré-implémenté INDÉPENDAMMENT : chaque place tenue est confrontée à la
  // règle « un porteur du tag ne tient jamais ce rôle ». Souple → silencieux.
  {
    const rolesInterdits = (input.structureConfig?.rolesInterdits ?? []).filter(
      (r) => r.actif && r.etage <= 2,
    )
    for (const regle of rolesInterdits) {
      const tagNorm = regle.tag.trim().toLowerCase()
      for (const a of planning.attributions) {
        if (regle.creneaux && regle.creneaux.length > 0 && !regle.creneaux.includes(a.type)) continue
        const vetId = vetRole(a, regle.role)
        if (!vetId) continue
        const vt = vetsById.get(vetId)
        if (!vt) continue
        const porte = (vt.tags ?? []).some((t) => t.trim().toLowerCase() === tagNorm)
        if (porte) {
          violations.push({
            regle: 'ROLE_TAG',
            date: a.date,
            type: a.type,
            role: regle.role,
            vetId,
            detail: `${vt.prenom} porte le tag « ${regle.tag} » — le rôle « ${regle.role} » lui est interdit (${a.type} du ${dateFr(a.date)})`,
          })
        }
      }
    }
  }

  // ── R22 — une seule garde par JOUR et par véto (inter-créneaux, P3b) ──
  // Nécessaire depuis que plusieurs créneaux peuvent coexister le même jour.
  // Sur le catalogue par défaut (un créneau/jour), jamais déclenchée.
  {
    const parJourVet = new Map<string, string>() // "date|vetId" → type déjà vu
    for (const a of planning.attributions) {
      for (const { vetId } of a.placements) {
        if (!vetId) continue
        const cle = `${a.date}|${vetId}`
        const deja = parJourVet.get(cle)
        if (deja !== undefined && deja !== a.type) {
          violations.push({
            regle: 'R22',
            date: a.date,
            type: a.type,
            vetId,
            detail: `le même vétérinaire tient deux gardes le ${dateFr(a.date)} (${deja} + ${a.type})`,
          })
        } else {
          parJourVet.set(cle, a.type)
        }
      }
    }
  }

  // ── Parcours par attribution pour les règles « par véto » ──
  for (const a of planning.attributions) {
    for (const { role, vetId } of a.placements) {
      if (!vetId) continue
      const vet = vetsById.get(vetId)
      if (!vet) {
        violations.push({
          regle: 'COUVERTURE',
          date: a.date,
          type: a.type,
          role,
          vetId,
          detail: `Vétérinaire inconnu assigné (${vetId}) sur ${a.type} du ${dateFr(a.date)}`,
        })
        continue
      }

      // ── R16 — congé validé = aucune garde ──
      for (const conge of vet.conges) {
        if (entre(a.date, conge.date_debut, conge.date_fin)) {
          violations.push({
            regle: 'R16',
            date: a.date,
            type: a.type,
            role,
            vetId,
            detail: `${vet.prenom} est en congé ${periodeFr(conge.date_debut, conge.date_fin)} mais de garde le ${dateFr(a.date)}`,
          })
        }
      }

      // ── Contraintes individuelles ──
      const jour = jourNom(a.date)
      const estSoir = a.type === 'semaine_soir' || a.type === 'vendredi_soir'
      const estWe = a.type === 'weekend'

      for (const c of vet.contraintes) {
        if (!c.actif) continue
        const cfg = c.config as Record<string, unknown>

        // P1-B — DUR / MOU : seules les règles configurées d'étage ≤ 2 sont des
        // violations DURES. Une règle molle (≥ 3 : sauf_crise/evitee/si_possible)
        // est une PRÉFÉRENCE — le moteur a le droit de ne pas l'honorer faute de
        // choix → on ne la compte pas comme violation (cohérent avec isValid).
        const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
        if (etage > 2) continue

        // ── R1 — jour de repos fixe ──
        if (c.type === 'jour_repos_fixe') {
          // Forme simple { jour, flexible_vacances, creneaux? }
          if (typeof cfg.jour === 'string') {
            if (cfg.jour === jour && viseCeCreneau(cfg, a.type)) {
              const flexible =
                Boolean(cfg.flexible_vacances ?? cfg.exception_vacances_scolaires) &&
                estEnVacances(a.date, cal)
              if (!flexible) {
                violations.push({
                  regle: 'R1',
                  date: a.date,
                  type: a.type,
                  role,
                  vetId,
                  detail: `${vet.prenom} a un repos fixe le ${jour} mais de garde le ${dateFr(a.date)}`,
                })
              }
            }
          }
          // Forme avec tableau de règles (ex. Anne-Sophie)
          if (Array.isArray(cfg.regles)) {
            type Regle = {
              jour: string; periode?: string; semaine?: string; ancre?: string; creneaux?: unknown
            }
            for (const regle of cfg.regles as Regle[]) {
              if (regle.jour !== jour) continue
              if (!viseCeCreneau(regle as unknown as Record<string, unknown>, a.type)) continue
              if (regle.semaine === 'impaire' || regle.semaine === 'paire') {
                const imp = estImpaire(a.date, regle.ancre, cal)
                if (regle.semaine === 'impaire' && !imp) continue
                if (regle.semaine === 'paire' && imp) continue
              }
              violations.push({
                regle: 'R1',
                date: a.date,
                type: a.type,
                role,
                vetId,
                // Le `JSON.stringify(regle)` d'origine crachait la règle brute
                // dans la phrase : « (règle {"jour":"lundi","semaine":"impaire",
                // "ancre":"2026-09-21"}) ». Illisible, et servi au cabinet dans
                // la fenêtre de publication. La semaine visée se dit en trois
                // mots ; le reste appartient aux journaux, pas à l'écran.
                detail: `${vet.prenom} a un repos fixe le ${jour} (une semaine sur deux) mais de garde le ${dateFr(a.date)}`,
              })
            }
          }
        }

        // ── R2 — indisponibilité cyclique (parité ancrée) ──
        if (c.type === 'indisponibilite_cyclique') {
          const semaines = cfg.semaines as string | undefined
          const periodes = (cfg.periodes ?? []) as string[]
          const ancre = cfg.ancre as string | undefined
          const imp = estImpaire(a.date, ancre, cal)
          const concerne =
            semaines === 'toutes' ||
            (semaines === 'impaires' && imp) ||
            (semaines === 'paires' && !imp)
          if (concerne) {
            if (periodes.includes('soir_semaine') && estSoir) {
              violations.push({
                regle: 'R2',
                date: a.date,
                type: a.type,
                role,
                vetId,
                detail: `${vet.prenom} indisponible soirs semaines ${semaines} mais de garde le ${dateFr(a.date)}`,
              })
            }
            if (periodes.includes('weekend') && estWe) {
              violations.push({
                regle: 'R2',
                date: a.date,
                type: a.type,
                role,
                vetId,
                detail: `${vet.prenom} indisponible week-ends ${semaines} mais de garde le ${dateFr(a.date)}`,
              })
            }
            // Créneau SUR-MESURE : miroir du choix conservateur du moteur —
            // une indispo cyclique bloque tout créneau non historique dès
            // qu'une période est configurée (véto « pas là cette semaine-là »).
            if (!estSoir && !estWe && a.type !== 'ferie' && periodes.length > 0) {
              violations.push({
                regle: 'R2',
                date: a.date,
                type: a.type,
                role,
                vetId,
                detail: `${vet.prenom} indisponible semaines ${semaines} mais de garde (${a.type}) le ${dateFr(a.date)}`,
              })
            }
          }
        }

        // ── R3/R4/R5 — repos conditionnel (selon garde WE de la semaine) ──
        if (c.type === 'jour_repos_conditionnel') {
          const siGardeWe = cfg.si_garde_we as string | undefined
          const sinon = cfg.sinon as string | undefined
          // #17 : planning ÉTENDU → « garde WE cette semaine ? » voit le WE du
          // lookback quand la 1re semaine chevauche la jonction de périodes.
          //
          // ORIGINE (Lot 1) : R3 n'est JAMAIS marquée « héritée ». La boucle
          // englobante parcourt `planning.attributions` (la période seule) : la
          // garde fautive — celle qui aurait dû être un repos — est toujours DANS
          // la période. Le lookback ne sert ici qu'à savoir s'il y avait un WE,
          // il ne peut pas porter la violation.
          const gardeWe = aGardeWeekendCetteSemaine(vetId, a.date, planningRythme)
          if (gardeWe && siGardeWe === jour) {
            violations.push({
              regle: 'R3',
              date: a.date,
              type: a.type,
              role,
              vetId,
              detail: `${vet.prenom} doit se reposer le ${jour} (garde WE cette semaine) mais de garde le ${dateFr(a.date)}`,
            })
          }
          if (!gardeWe && sinon === jour) {
            violations.push({
              regle: 'R3',
              date: a.date,
              type: a.type,
              role,
              vetId,
              detail: `${vet.prenom} doit se reposer le ${jour} (pas de garde WE cette semaine) mais de garde le ${dateFr(a.date)}`,
            })
          }
        }

        // ── R6 — duo interdit ──
        if (c.type === 'duo_interdit') {
          const interdits = lireDuoInterditIds(cfg)
          const co = membres(a).filter((m) => m !== vetId)
          for (const autre of co) {
            if (interdits.includes(autre)) {
              const autreVet = vetsById.get(autre)
              violations.push({
                regle: 'R6',
                date: a.date,
                type: a.type,
                vetId,
                detail: `duo interdit ${vet.prenom} + ${autreVet?.prenom ?? autre} sur ${a.type} du ${dateFr(a.date)}`,
              })
            }
          }
        }
      }
    }
  }

  // ── AU_PLUS_N — limite de charge par fenêtre (brique réglable) ──
  // Re-comptage INDÉPENDANT : pour chaque véto porteur d'une règle `au_plus_n`
  // DURE (étage ≤ 2), on compte ses gardes par fenêtre (semaine civile ou
  // glissante de K jours) et on signale tout dépassement. Une règle molle
  // (étage ≥ 3) est une préférence → pas une violation dure.
  for (const vet of vetsNorm) {
    for (const c of vet.contraintes) {
      if (!c.actif || c.type !== 'au_plus_n') continue
      const cfg = c.config as Record<string, unknown>
      const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
      if (etage > 2) continue
      const nRaw = cfg.n
      const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
      if (!Number.isFinite(n) || n < 0) continue

      const creneaux = Array.isArray(cfg.creneaux)
        ? (cfg.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
        : undefined
      // #17 : gardes du LOOKBACK incluses → une fenêtre (glissante ou semaine
      // civile) qui chevauche la jonction compte aussi les gardes de la période
      // précédente (anti-dépassement à cheval).
      const gardesVet = planningRythme.attributions.filter(
        (a) =>
          surCreneau(a, vet.id) &&
          (!creneaux || creneaux.includes(a.type)),
      )

      const fenetreStr = typeof cfg.fenetre === 'string' ? (cfg.fenetre as string) : ''
      const mGliss = fenetreStr.match(/^glissante_(\d+)_jours$/)
      const dejaSignale = new Set<string>()
      for (const ancre of gardesVet) {
        let debut: string
        let fin: string
        if (mGliss) {
          const k = parseInt(mGliss[1], 10)
          debut = plusJours(ancre.date, -(k - 1))
          fin = ancre.date
        } else {
          debut = lundiDe(ancre.date)
          fin = plusJours(debut, 6)
        }
        if (dejaSignale.has(debut)) continue
        const count = gardesVet.filter((a) => a.date >= debut && a.date <= fin).length
        if (count > n) {
          dejaSignale.add(debut)
          violations.push({
            regle: 'AU_PLUS_N',
            date: debut,
            type: 'fenetre',
            vetId: vet.id,
            detail: `${vet.prenom} a ${count} gardes (max ${n}) sur la fenêtre du ${dateFr(debut)}${mGliss ? ` (${mGliss[1]}j glissants)` : ' (semaine civile)'}`,
            ...marqueOrigine(debut, fin),
          })
        }
      }
    }
  }

  // ── ESPACEMENT_MIN — au moins X jours entre deux gardes (brique réglable) ──
  // Re-vérification INDÉPENDANTE : on trie les dates de garde du véto et on
  // contrôle l'écart entre dates consécutives (si tous ≥ X, toutes les paires le
  // sont). Seules les règles DURES (étage ≤ 2) sont des violations.
  for (const vet of vetsNorm) {
    for (const c of vet.contraintes) {
      if (!c.actif || c.type !== 'espacement_min') continue
      const cfg = c.config as Record<string, unknown>
      const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
      if (etage > 2) continue
      const eRaw = cfg.ecart_min_jours
      const ecart = typeof eRaw === 'number' ? eRaw : typeof eRaw === 'string' ? parseInt(eRaw, 10) : NaN
      if (!Number.isFinite(ecart) || ecart <= 0) continue

      // #17 : on inclut les gardes du LOOKBACK → une garde en fin de période
      // précédente trop proche d'une garde du début de la période courante est
      // détectée (jonction). Le tri place la date antérieure en `[i-1]`.
      //
      // On conserve le TYPE, et pas seulement la date : le couple imposé par la
      // structure (vendredi soir ↔ week-end, même binôme) est TOUJOURS à un jour
      // d'écart. Sans cette distinction, le validateur signalait une violation
      // sur CHAQUE week-end — dix fausses alertes qui noyaient les vraies
      // (recette MiKL, 2026-08-20). Ré-implémenté ici INDÉPENDAMMENT du moteur,
      // conformément au principe des deux gardiens.
      const couples = input.structureConfig?.relations ?? RELATIONS_STRUCTURE_DEFAUT
      const lieParStructure = (tA: string, tB: string): boolean =>
        couples.some(
          (r) =>
            r.genre === 'meme_binome' &&
            ((r.sourceCode === tA && r.cibleCode === tB) ||
              (r.sourceCode === tB && r.cibleCode === tA)),
        )

      const gardes = planningRythme.attributions
        .filter((a) => surCreneau(a, vet.id))
        .map((a) => ({ date: a.date, type: a.type }))
        .sort((x, y) => x.date.localeCompare(y.date))
      const vues = new Set<string>()
      for (let i = 1; i < gardes.length; i++) {
        const prec = gardes[i - 1]
        const cur = gardes[i]
        if (prec.date === cur.date) continue
        // Écart RÉEL : un week-end couvre samedi + dimanche, il ne se compare pas
        // par sa date d'ancrage (cf. ecartReelEntreGardes).
        const j = ecartReelEntreGardes(prec.date, prec.type, cur.date, cur.type)
        // Une seule garde étalée sur deux créneaux liés n'est pas un enchaînement.
        if (j === 1 && lieParStructure(prec.type, cur.type)) continue
        if (j < ecart) {
          const cle = `${prec.date}|${cur.date}`
          if (vues.has(cle)) continue
          vues.add(cle)
          violations.push({
            regle: 'ESPACEMENT',
            date: cur.date,
            type: 'espacement',
            vetId: vet.id,
            detail: `${vet.prenom} — seulement ${j} jour(s) entre le ${dateFr(prec.date)} et le ${dateFr(cur.date)} (min ${ecart})`,
            ...marqueOrigine(prec.date, cur.date),
          })
        }
      }
    }
  }

  // ── ESPACEMENT_WEEKEND — « au plus 1 WE toutes les N semaines » (réglable) ──
  // Re-vérification INDÉPENDANTE : on trie les dates de garde DE WEEK-END du véto
  // et on contrôle l'écart entre week-ends consécutifs. Si tous ≥ N×7 jours,
  // toutes les paires le sont. Seules les règles DURES (étage ≤ 2) sont des
  // violations (souple = préférence). MÊME logique que le moteur (les 2 gardiens).
  for (const vet of vetsNorm) {
    for (const c of vet.contraintes) {
      if (!c.actif || c.type !== 'espacement_weekend') continue
      const cfg = c.config as Record<string, unknown>
      const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
      if (etage > 2) continue
      const nRaw = cfg.n_semaines
      const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
      if (!Number.isFinite(n) || n <= 1) continue
      const seuil = n * 7

      // #17 : week-ends du LOOKBACK inclus → deux WE consécutifs à cheval sur la
      // jonction de périodes sont détectés. Tri = date antérieure en premier.
      const datesWe = planningRythme.attributions
        .filter((a) => a.type === 'weekend' && surCreneau(a, vet.id))
        .map((a) => a.date)
        .sort()
      const vues = new Set<string>()
      for (let i = 1; i < datesWe.length; i++) {
        if (datesWe[i - 1] === datesWe[i]) continue
        const j = joursEntre(datesWe[i - 1], datesWe[i])
        if (j < seuil) {
          const cle = `${datesWe[i - 1]}|${datesWe[i]}`
          if (vues.has(cle)) continue
          vues.add(cle)
          violations.push({
            regle: 'FREQ_WE',
            date: datesWe[i],
            type: 'espacement_weekend',
            vetId: vet.id,
            detail: `${vet.prenom} — deux week-ends à ${j} jour(s) d'écart (${dateFr(datesWe[i - 1])} → ${dateFr(datesWe[i])}), min 1 toutes les ${n} semaines`,
            ...marqueOrigine(datesWe[i - 1], datesWe[i]),
          })
        }
      }
    }
  }

  // ── CADENCEMENT « 1 WE sur N ancré » (Vague 5 tranche C — #20) ──
  // Re-vérification INDÉPENDANTE (jamais d'import de rules/) : chaque garde de
  // WEEK-END tenue par un véto porteur d'une règle `cadencement_weekend` DURE
  // (étage ≤ 2) est confrontée à son cycle ancré. Le WE est daté du SAMEDI ;
  // l'ancre est ramenée au samedi de SA semaine (cycle calendaire STRICT, AUCUN
  // recalage vacances). Helpers ré-implémentés ici (miroirs triviaux).
  //   • sens='interdit' : une garde WE tombant SUR le cycle → violation.
  //   • sens='impose'   : une garde WE tombant HORS du cycle → violation.
  // Ne consomme NI le planning NI le lookback (jugé sur l'ancre seule). Souple
  // (étage ≥ 3) → jamais une violation (préférence).
  {
    const samediDeLocal = (date: string): string => samediDe(date)
    const surCycle = (sam: string, ancreSam: string, n: number): boolean => {
      const ms =
        new Date(sam + 'T12:00:00Z').getTime() -
        new Date(ancreSam + 'T12:00:00Z').getTime()
      const semaines = Math.round(ms / (7 * 24 * 60 * 60 * 1000))
      return ((semaines % n) + n) % n === 0
    }
    for (const vet of vetsNorm) {
      for (const c of vet.contraintes) {
        if (!c.actif || c.type !== 'cadencement_weekend') continue
        const cfg = c.config as Record<string, unknown>
        const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
        if (etage > 2) continue
        const nRaw = cfg.n_semaines
        const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
        if (!Number.isFinite(n) || n < 2) continue // inerte
        const ancre = cfg.ancre
        if (typeof ancre !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ancre)) continue
        if (Number.isNaN(new Date(ancre + 'T12:00:00Z').getTime())) continue
        const sens = cfg.sens
        if (sens !== 'interdit' && sens !== 'impose') continue
        const ancreSam = samediDeLocal(ancre)

        for (const a of planning.attributions) {
          if (a.type !== 'weekend' || !surCreneau(a, vet.id)) continue
          const dansLeCycle = surCycle(a.date, ancreSam, n)
          const viole = sens === 'interdit' ? dansLeCycle : !dansLeCycle
          if (viole) {
            violations.push({
              regle: 'CADENCE_WE',
              date: a.date,
              type: a.type,
              vetId: vet.id,
              detail:
                sens === 'interdit'
                  ? `${vet.prenom} est de garde le week-end du ${dateFr(a.date)} alors que ce week-end tombe sur son cycle d'indisponibilité (1 sur ${n}, ancre ${dateFr(ancre)})`
                  : `${vet.prenom} est de garde le week-end du ${dateFr(a.date)} hors de son cycle imposé (1 sur ${n}, ancre ${dateFr(ancre)})`,
            })
          }
        }
      }
    }
  }

  // ── SUCCESSION / SÉRIE / REPOS avancés (Vague 5 tranche B — #13) ──
  // Re-vérification INDÉPENDANTE (jamais d'import de rules/) des trois briques de
  // rythme `sequence`. On raisonne en JOURS CIVILS COUVERTS : le week-end (daté du
  // samedi) couvre samedi + dimanche → son « lendemain » est le lundi. Helpers
  // ré-implémentés ici (miroir triviaux, comme jIndex/plusJours). #17 : on inclut
  // les gardes du LOOKBACK (planningRythme) → une série/succession à cheval sur la
  // jonction de périodes est détectée. Seules les règles DURES (étage ≤ 2) sont
  // des violations (souple = préférence, silencieux).
  const joursCouverts = joursCouvertsDeGarde

  // Jours de garde (dépliés) d'un véto sur le planning ÉTENDU (rythme), filtrés
  // par types si `creneaux` fourni.
  const joursGardeVet = (vetId: string, creneaux?: string[]): Set<string> => {
    const jours = new Set<string>()
    for (const a of planningRythme.attributions) {
      if (!surCreneau(a, vetId)) continue
      if (creneaux && !creneaux.includes(a.type)) continue
      for (const j of joursCouverts(a.date, a.type)) jours.add(j)
    }
    return jours
  }

  for (const vet of vetsNorm) {
    for (const c of vet.contraintes) {
      if (!c.actif) continue
      const cfg = c.config as Record<string, unknown>
      const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
      if (etage > 2) continue // souple → pas une violation dure

      // ── succession_interdite — B jamais le lendemain de A ──
      if (c.type === 'succession_interdite') {
        const typeAvant = cfg.type_avant
        const typeApres = cfg.type_apres
        if (typeof typeAvant !== 'string' || typeof typeApres !== 'string') continue
        if (typeAvant === '' || typeApres === '') continue
        // Toutes les gardes « avant » (type A) du véto : le lendemain de leur FIN
        // ne doit pas porter une garde « après » (type B).
        for (const a of planningRythme.attributions) {
          if (a.type !== typeAvant || !surCreneau(a, vet.id)) continue
          const joursA = joursCouverts(a.date, a.type)
          const lendemain = plusJours(joursA[joursA.length - 1], 1)
          for (const b of planningRythme.attributions) {
            if (b.type !== typeApres || !surCreneau(b, vet.id)) continue
            if (joursCouverts(b.date, b.type)[0] === lendemain) {
              violations.push({
                regle: 'SUCCESSION',
                date: b.date,
                type: b.type,
                vetId: vet.id,
                detail: `${vet.prenom} fait « ${typeApres} » le ${dateFr(b.date)}, lendemain de « ${typeAvant} » (${dateFr(a.date)}) — interdit`,
                ...marqueOrigine(a.date, b.date),
              })
            }
          }
        }
      }

      // ── serie_max — jamais plus de N jours d'affilée ──
      if (c.type === 'serie_max') {
        const nRaw = cfg.n_jours
        const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
        if (!Number.isFinite(n) || n <= 0) continue
        const creneaux = Array.isArray(cfg.creneaux)
          ? (cfg.creneaux as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined
        const jours = joursGardeVet(vet.id, creneaux && creneaux.length > 0 ? creneaux : undefined)
        // Longueur de chaque série maximale (une série = jours consécutifs) : on
        // ne signale qu'aux DÉBUTS de série (jour dont la veille n'est pas de garde).
        const vues = new Set<string>()
        for (const j of jours) {
          if (jours.has(plusJours(j, -1))) continue // pas un début de série
          let len = 1
          let d = plusJours(j, 1)
          while (jours.has(d)) { len++; d = plusJours(d, 1) }
          if (len > n && !vues.has(j)) {
            vues.add(j)
            violations.push({
              regle: 'SERIE_MAX',
              date: j,
              type: 'serie',
              vetId: vet.id,
              detail: `${vet.prenom} enchaîne ${len} jours de garde d'affilée à partir du ${dateFr(j)} (max ${n})`,
              // La série entière doit être antérieure : une série à cheval sur la
              // jonction touche bien la période courante.
              ...marqueOrigine(j, plusJours(j, len - 1)),
            })
          }
        }
      }

      // ── repos_apres_serie — après N jours d'affilée, ≥ M jours sans garde ──
      if (c.type === 'repos_apres_serie') {
        const nRaw = cfg.n_jours
        const mRaw = cfg.repos_jours
        const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
        const m = typeof mRaw === 'number' ? mRaw : typeof mRaw === 'string' ? parseInt(mRaw, 10) : NaN
        if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(m) || m <= 0) continue
        const jours = joursGardeVet(vet.id)
        const vues = new Set<string>()
        for (const fin of jours) {
          if (jours.has(plusJours(fin, 1))) continue // pas une fin de stretch maximal
          let len = 1
          let d = plusJours(fin, -1)
          while (jours.has(d)) { len++; d = plusJours(d, -1) }
          if (len < n) continue // série trop courte → aucun repos imposé
          for (let k = 1; k <= m; k++) {
            const jour = plusJours(fin, k)
            if (jours.has(jour) && !vues.has(`${fin}|${jour}`)) {
              vues.add(`${fin}|${jour}`)
              violations.push({
                regle: 'REPOS_SERIE',
                date: jour,
                type: 'repos_serie',
                vetId: vet.id,
                detail: `${vet.prenom} est de garde le ${dateFr(jour)} alors qu'une série d'au moins ${n} jours (fin le ${dateFr(fin)}) impose ${m} jour(s) de repos`,
                ...marqueOrigine(fin, jour),
              })
            }
          }
        }
      }
    }
  }

  // ── EXCLUSION DE DATES / XOR « pas les deux » (Vague 6 tranche B — #15a) ──
  // Re-vérification INDÉPENDANTE (jamais d'import de rules/) : un véto porteur
  // d'une règle `exclusion_dates` DURE (étage ≤ 2) ne doit pas être de garde À
  // LA FOIS sur les deux cibles. Deux formes (une seule par règle) :
  //   • fetes ['noel','nouvel_an'] : pour CHAQUE année couverte, exclusion entre
  //     une instance de la 1re fête et une de la 2e DE LA MÊME ANNÉE. La
  //     convention d'année (nouvel_an(N) = 31 déc N + 1er janv N+1) est
  //     ré-implémentée ici (feteInstance) — miroir trivial, pas d'import.
  //   • dates ['YYYY-MM-DD','YYYY-MM-DD'] : exclusion « au sens jours couverts »
  //     (un week-end daté du samedi couvre samedi + dimanche → joursCouverts).
  // INTRA-PÉRIODE : on n'utilise PAS planningRythme (pas de lookback #17 : le XOR
  // se juge sur la période courante par principe). Config inerte (forme absente,
  // paire identique, date non-ISO) → aucune violation (jamais de fantôme).
  {
    // Fête (et année de saison) portée par une DATE — ré-implémenté indépendamment.
    // Convention : 24/25 déc → noel(année) ; 31 déc → nouvel_an(année) ;
    // 1er janv → nouvel_an(année-1) (même réveillon que le 31 déc précédent).
    const feteInstance = (date: string): { fete: string; annee: number } | null => {
      const mmjj = date.substring(5)
      const annee = Number(date.substring(0, 4))
      if (mmjj === '12-24' || mmjj === '12-25') return { fete: 'noel', annee }
      if (mmjj === '12-31') return { fete: 'nouvel_an', annee }
      if (mmjj === '01-01') return { fete: 'nouvel_an', annee: annee - 1 }
      return null
    }
    // Instances de fête (dédoublonnées) couvertes par un slot (weekend = sam+dim).
    const fetesDuSlot = (date: string, type: string): { fete: string; annee: number }[] => {
      const jours = type === 'weekend' ? [date, plusJours(date, 1)] : [date]
      const vues = new Set<string>()
      const out: { fete: string; annee: number }[] = []
      for (const j of jours) {
        const inst = feteInstance(j)
        if (!inst) continue
        const cle = `${inst.fete}|${inst.annee}`
        if (vues.has(cle)) continue
        vues.add(cle)
        out.push(inst)
      }
      return out
    }
    const joursCouvertsXor = joursCouvertsDeGarde

    const isISO = (x: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(x + 'T12:00:00Z').getTime())

    for (const vet of vetsNorm) {
      for (const c of vet.contraintes) {
        if (!c.actif || c.type !== 'exclusion_dates') continue
        const cfg = c.config as Record<string, unknown>
        const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
        if (etage > 2) continue // souple → pas une violation dure

        // Forme FÊTES.
        const fetesRaw = cfg.fetes
        const fetes = Array.isArray(fetesRaw) && fetesRaw.length === 2
          ? fetesRaw.filter((x): x is string => x === 'noel' || x === 'nouvel_an')
          : []
        if (fetes.length === 2 && fetes[0] !== fetes[1]) {
          // Année → set des fêtes (de la paire) couvertes par le véto cette année.
          const parAnnee = new Map<number, Set<string>>()
          const preuve = new Map<string, string>() // `annee|fete` → date de garde
          for (const a of planning.attributions) {
            if (!surCreneau(a, vet.id)) continue
            for (const inst of fetesDuSlot(a.date, a.type)) {
              if (inst.fete !== fetes[0] && inst.fete !== fetes[1]) continue
              const s = parAnnee.get(inst.annee) ?? new Set<string>()
              s.add(inst.fete)
              parAnnee.set(inst.annee, s)
              preuve.set(`${inst.annee}|${inst.fete}`, a.date)
            }
          }
          for (const [annee, couvertes] of parAnnee) {
            if (couvertes.has(fetes[0]) && couvertes.has(fetes[1])) {
              violations.push({
                regle: 'XOR_DATES',
                date: preuve.get(`${annee}|${fetes[1]}`) ?? '',
                type: 'exclusion_dates',
                vetId: vet.id,
                detail: `${vet.prenom} est de garde à la fois pour ${fetes[0]} et ${fetes[1]} en ${annee} (interdit : pas les deux)`,
              })
            }
          }
          continue // une seule forme par règle
        }

        // Forme DATES libres.
        const datesRaw = cfg.dates
        const dates = Array.isArray(datesRaw) && datesRaw.length === 2
          ? datesRaw.filter((x): x is string => typeof x === 'string' && isISO(x))
          : []
        if (dates.length === 2 && dates[0] !== dates[1]) {
          let couvre0: string | null = null
          let couvre1: string | null = null
          for (const a of planning.attributions) {
            if (!surCreneau(a, vet.id)) continue
            const jours = joursCouvertsXor(a.date, a.type)
            if (jours.includes(dates[0])) couvre0 = a.date
            if (jours.includes(dates[1])) couvre1 = a.date
          }
          if (couvre0 && couvre1) {
            violations.push({
              regle: 'XOR_DATES',
              date: dates[1],
              type: 'exclusion_dates',
              vetId: vet.id,
              detail: `${vet.prenom} est de garde à la fois le ${dateFr(dates[0])} (${couvre0}) et le ${dateFr(dates[1])} (${couvre1}) — interdit : pas les deux`,
            })
          }
        }
      }
    }
  }

  // ── seulement_avec — garde conditionnelle ORIENTÉE (Vague 6 tranche C — #15b) ──
  // Re-vérification INDÉPENDANTE (jamais d'import de rules/) : un véto A porteur
  // d'une règle `seulement_avec` DURE (étage ≤ 2) ne doit JAMAIS figurer sur un
  // créneau (dans le ciblage) sans son partenaire requis B dans la MÊME équipe.
  // ORIENTÉE : on ne juge QUE les créneaux où A est présent — B reste libre
  // d'être de garde sans A. Souple (étage ≥ 3) → jamais une violation.
  // Config inerte (partenaire absent) → aucune violation (jamais de fantôme).
  {
    for (const vet of vetsNorm) {
      for (const c of vet.contraintes) {
        if (!c.actif || c.type !== 'seulement_avec') continue
        const cfg = c.config as Record<string, unknown>
        const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
        if (etage > 2) continue // souple → pas une violation dure
        const b = cfg.avec_veterinaire_id
        if (typeof b !== 'string' || b.trim() === '') continue // inerte
        // Ciblage créneaux (absent/vide = tous).
        const ciblage = Array.isArray(cfg.creneaux)
          ? (cfg.creneaux as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : []
        for (const a of planning.attributions) {
          if (ciblage.length > 0 && !ciblage.includes(a.type)) continue
          const equipe = membres(a)
          if (!equipe.includes(vet.id)) continue // A pas sur ce créneau
          if (!equipe.includes(b)) {
            const nomB = vetsById.get(b)?.prenom ?? '?'
            violations.push({
              regle: 'SEULEMENT_AVEC',
              date: a.date,
              type: a.type,
              vetId: vet.id,
              detail: `${vet.prenom} est de garde le ${dateFr(a.date)} (${a.type}) sans ${nomB}, alors qu'il ne peut être de garde QUE si ${nomB} l'est sur le même créneau`,
            })
          }
        }
      }
    }
  }

  // ── R9 — créneaux liés = même équipe · R8 — rôles changés entre eux ──
  // GÉNÉRIQUE (RG tranche 3) : le couple vendredi↔WE n'est plus câblé — les
  // couples viennent de la DONNÉE (structureConfig.relations ; undefined →
  // repli couple historique, [] → aucun couple), MÊME précédence que le moteur.
  // On ne signale une violation que si la règle du GENRE est appliquée en DUR
  // (active + ferme). Souple/désactivée → pas de violation fantôme.
  //
  // APPARIEMENT ré-implémenté INDÉPENDAMMENT (jamais le module du moteur) :
  // l'occurrence SOURCE appariée à une occurrence cible est l'occurrence
  // ADJACENTE — on remonte jour par jour (même jour inclus, fenêtre 7 jours) ;
  // la première occurrence rencontrée décide : le créneau source → appariée ;
  // une autre occurrence du créneau cible → rien (elle capture la source).
  // Pour le couple historique, c'est EXACTEMENT le vendredi J-1 du samedi.
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const r9Dur = estStructureDure(structure.r9_liaison)
  const r8Dur = estStructureDure(structure.r8_inversion)
  const relations = structure.relations ?? RELATIONS_STRUCTURE_DEFAUT

  const FENETRE_LIAISON_JOURS = 7
  const sourceLiee = (rel: RelationStructure, dateCible: string): AttributionGarde | undefined => {
    for (let k = 0; k <= FENETRE_LIAISON_JOURS; k++) {
      const d = plusJours(dateCible, -k)
      const src = trouver(planning, d, rel.sourceCode)
      if (src) return src
      if (k > 0 && trouver(planning, d, rel.cibleCode)) return undefined
    }
    return undefined
  }
  const coupleHistorique = (rel: RelationStructure): boolean =>
    rel.sourceCode === 'vendredi_soir' && rel.cibleCode === 'weekend'

  for (const a of planning.attributions) {
    if (!r9Dur && !r8Dur) break // les deux assouplies/coupées → rien à contrôler
    for (const rel of relations) {
      if (a.type !== rel.cibleCode) continue
      const dur = rel.genre === 'meme_binome' ? r9Dur : r8Dur
      if (!dur) continue
      const attrSource = sourceLiee(rel, a.date)
      if (!attrSource) continue // pas d'occurrence source appariée → rien à coupler

      // R9 (meme_binome) : ensembles de vétos identiques.
      if (rel.genre === 'meme_binome') {
        const equipeCible = new Set(membres(a))
        const equipeSource = new Set(membres(attrSource))
        const memesMembres =
          equipeCible.size === equipeSource.size && [...equipeCible].every((m) => equipeSource.has(m))
        if (!memesMembres) {
          violations.push({
            regle: 'R9',
            date: a.date,
            type: a.type,
            detail: coupleHistorique(rel)
              ? `le duo WE [${[...equipeCible].join(',')}] diffère du duo vendredi soir [${[...equipeSource].join(',')}] (semaine du ${dateFr(attrSource.date)})`
              : `l'équipe de « ${rel.cibleCode} » [${[...equipeCible].join(',')}] diffère de celle de « ${rel.sourceCode} » [${[...equipeSource].join(',')}] (${dateFr(attrSource.date)})`,
          })
        }
      }

      // R8 (inversion_role) : généralisé N-places (P4 slice 2) — pour CHAQUE
      // place, si le véto qui la tenait sur la source la tient ENCORE sur la
      // cible → rôle non changé → violation. Pour 2 rôles, ce sont exactement
      // les deux contrôles 1er/2nd historiques (messages conservés).
      if (rel.genre === 'inversion_role') {
        for (const p of attrSource.placements) {
          const vetSrc = p.vetId
          if (!vetSrc) continue
          if (vetRole(a, p.role) !== vetSrc) continue
          const prenom = vetsById.get(vetSrc)?.prenom ?? vetSrc
          const detail = coupleHistorique(rel)
            ? p.role === 'premier'
              ? `${prenom} est 1er vendredi soir ET 1er le WE — l'inversion impose 2nd le WE (${dateFr(a.date)})`
              : p.role === 'second'
                ? `${prenom} est 2nd vendredi soir ET 2nd le WE — l'inversion impose 1er le WE (${dateFr(a.date)})`
                : `${prenom} garde le rôle « ${p.role} » du vendredi au WE — l'inversion impose d'en changer (${dateFr(a.date)})`
            : `${prenom} garde le rôle « ${p.role} » de « ${rel.sourceCode} » à « ${rel.cibleCode} » — les rôles doivent changer (${dateFr(a.date)})`
          violations.push({ regle: 'R8', date: a.date, type: a.type, vetId: vetSrc, detail })
        }
      }
    }
  }

  return violations
}

// ── R3 helper : le véto a-t-il une garde WE liée à CETTE semaine ? ──
// Ré-implémenté indépendamment. Lun/Mar/Mer → le WE pertinent est celui
// qui vient de se terminer (semaine précédente). Jeu→Dim → le WE à venir
// de la semaine courante. On regarde le samedi (weekend) ET le vendredi
// soir associé (couplés par R9).
function aGardeWeekendCetteSemaine(
  vetId: string,
  date: string,
  planning: PlanningPartiel
): boolean {
  const idx = jIndex(date)
  let sam: string
  if (idx >= 1 && idx <= 3) {
    // lundi/mardi/mercredi → samedi de la semaine précédente
    sam = plusJours(lundiDe(date), -2)
  } else {
    sam = samediDe(date)
  }
  const we = trouver(planning, sam, 'weekend')
  if (surCreneau(we, vetId)) return true
  const ven = plusJours(sam, -1)
  const av = trouver(planning, ven, 'vendredi_soir')
  return surCreneau(av, vetId)
}
