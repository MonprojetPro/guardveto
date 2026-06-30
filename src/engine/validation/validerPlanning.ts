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
import {
  DEFAULT_STRUCTURE_CONFIG, estStructureDure,
  type StructureConfig,
} from '../structure-config'

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
}

// ── Une violation détectée ───────────────────────────────
export interface Violation {
  /** Code de la règle violée (R1, R2, … ou un invariant de couverture) */
  regle: string
  /** Date ISO du créneau concerné */
  date: string
  /** Type de créneau */
  type: string
  /** Rôle concerné, si pertinent */
  role?: 'premier' | 'second'
  /** Vétérinaire fautif, si identifiable */
  vetId?: string
  /** Détail concret lisible */
  detail: string
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

/** Lundi de la semaine ISO contenant `date` */
function lundiDe(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  const j = d.getUTCDay()
  const diff = j === 0 ? -6 : 1 - j
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

function vendrediDe(date: string): string {
  return plusJours(lundiDe(date), 4)
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

/** Tous les vétos assignés (premier OU second) sur une attribution */
function membres(a: AttributionGarde | undefined): string[] {
  if (!a) return []
  const out: string[] = []
  if (a.premier_id) out.push(a.premier_id)
  if (a.second_id) out.push(a.second_id)
  return out
}

// ── Construction des créneaux ATTENDUS (couverture) ──────
// Indépendant du solver : on dérive la structure directement de la règle
// métier R17/R18/R19 (été = 1 véto semaine, hiver = 2 ; WE & ven soir = 2).
interface SlotAttendu {
  date: string
  type: 'semaine_soir' | 'vendredi_soir' | 'weekend'
  besoinSecond: boolean
}

function slotsAttendus(input: ValidationInput): SlotAttendu[] {
  const slots: SlotAttendu[] = []
  let cur = input.dateDebut
  while (cur <= input.dateFin) {
    const idx = jIndex(cur)
    if (idx === 5) {
      slots.push({ date: cur, type: 'vendredi_soir', besoinSecond: true })
    } else if (idx === 6) {
      slots.push({ date: cur, type: 'weekend', besoinSecond: true })
    } else if (idx >= 1 && idx <= 4) {
      // Effectif configurable : besoin d'un 2nd si nb >= 2 ; repli saison sinon.
      const nb = input.nbVetosSemaineSoir ?? (input.saison === 'hiver' ? 2 : 1)
      slots.push({
        date: cur,
        type: 'semaine_soir',
        besoinSecond: nb >= 2,
      })
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

  // ── A. COUVERTURE : chaque créneau attendu existe et est complet ──
  const attendus = slotsAttendus(input)
  for (const s of attendus) {
    const attr = trouver(planning, s.date, s.type)
    if (!attr) {
      violations.push({
        regle: 'COUVERTURE',
        date: s.date,
        type: s.type,
        detail: `Créneau attendu absent du planning (${s.type} du ${s.date})`,
      })
      continue
    }
    if (!attr.premier_id) {
      violations.push({
        regle: 'COUVERTURE',
        date: s.date,
        type: s.type,
        role: 'premier',
        detail: `Aucun 1er de garde assigné (${s.type} du ${s.date})`,
      })
    }
    if (s.besoinSecond && !attr.second_id) {
      violations.push({
        regle: s.type === 'weekend' ? 'R19' : 'R18',
        date: s.date,
        type: s.type,
        role: 'second',
        detail:
          s.type === 'weekend'
            ? `R19 : week-end sans 2nd de garde (${s.date})`
            : s.type === 'vendredi_soir'
              ? `vendredi soir sans 2nd de garde (${s.date})`
              : `R18 : hiver, garde semaine sans 2nd (${s.date})`,
      })
    }
  }

  // ── R17 — Été : pas de 2nd en semaine_soir ──
  if (input.saison === 'ete') {
    for (const a of planning.attributions) {
      if (a.type === 'semaine_soir' && a.second_id) {
        violations.push({
          regle: 'R17',
          date: a.date,
          type: a.type,
          role: 'second',
          vetId: a.second_id,
          detail: `R17 : en été, une seule garde de nuit en semaine — un 2nd a été assigné (${a.date})`,
        })
      }
    }
  }

  // ── R21 — premier ≠ second sur un même créneau ──
  for (const a of planning.attributions) {
    if (a.premier_id && a.second_id && a.premier_id === a.second_id) {
      violations.push({
        regle: 'R21',
        date: a.date,
        type: a.type,
        vetId: a.premier_id,
        detail: `R21 : le même vétérinaire est 1er ET 2nd du créneau (${a.type} du ${a.date})`,
      })
    }
  }

  // ── Parcours par attribution pour les règles « par véto » ──
  for (const a of planning.attributions) {
    const roles: Array<{ role: 'premier' | 'second'; vetId: string | null }> = [
      { role: 'premier', vetId: a.premier_id },
      { role: 'second', vetId: a.second_id },
    ]
    for (const { role, vetId } of roles) {
      if (!vetId) continue
      const vet = vetsById.get(vetId)
      if (!vet) {
        violations.push({
          regle: 'COUVERTURE',
          date: a.date,
          type: a.type,
          role,
          vetId,
          detail: `Vétérinaire inconnu assigné (${vetId}) sur ${a.type} du ${a.date}`,
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
            detail: `R16 : ${vet.prenom} est en congé (${conge.date_debut}→${conge.date_fin}) mais de garde le ${a.date}`,
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
          // Forme simple { jour, flexible_vacances }
          if (typeof cfg.jour === 'string') {
            if (cfg.jour === jour) {
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
                  detail: `R1 : ${vet.prenom} a un repos fixe le ${jour} mais de garde le ${a.date}`,
                })
              }
            }
          }
          // Forme avec tableau de règles (ex. Anne-Sophie)
          if (Array.isArray(cfg.regles)) {
            type Regle = { jour: string; periode?: string; semaine?: string; ancre?: string }
            for (const regle of cfg.regles as Regle[]) {
              if (regle.jour !== jour) continue
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
                detail: `R1 : ${vet.prenom} a un repos fixe le ${jour} (règle ${JSON.stringify(regle)}) mais de garde le ${a.date}`,
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
                detail: `R2 : ${vet.prenom} indisponible soirs semaines ${semaines} mais de garde le ${a.date}`,
              })
            }
            if (periodes.includes('weekend') && estWe) {
              violations.push({
                regle: 'R2',
                date: a.date,
                type: a.type,
                role,
                vetId,
                detail: `R2 : ${vet.prenom} indisponible week-ends ${semaines} mais de garde le ${a.date}`,
              })
            }
          }
        }

        // ── R3/R4/R5 — repos conditionnel (selon garde WE de la semaine) ──
        if (c.type === 'jour_repos_conditionnel') {
          const siGardeWe = cfg.si_garde_we as string | undefined
          const sinon = cfg.sinon as string | undefined
          const gardeWe = aGardeWeekendCetteSemaine(vetId, a.date, planning)
          if (gardeWe && siGardeWe === jour) {
            violations.push({
              regle: 'R3',
              date: a.date,
              type: a.type,
              role,
              vetId,
              detail: `R3/R5 : ${vet.prenom} doit se reposer le ${jour} (garde WE cette semaine) mais de garde le ${a.date}`,
            })
          }
          if (!gardeWe && sinon === jour) {
            violations.push({
              regle: 'R3',
              date: a.date,
              type: a.type,
              role,
              vetId,
              detail: `R3/R5 : ${vet.prenom} doit se reposer le ${jour} (pas de garde WE cette semaine) mais de garde le ${a.date}`,
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
                detail: `R6 : duo interdit ${vet.prenom} + ${autreVet?.prenom ?? autre} sur ${a.type} du ${a.date}`,
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
      const gardesVet = planning.attributions.filter(
        (a) =>
          (a.premier_id === vet.id || a.second_id === vet.id) &&
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
            detail: `AU_PLUS_N : ${vet.prenom} a ${count} gardes (max ${n}) sur la fenêtre du ${debut}${mGliss ? ` (${mGliss[1]}j glissants)` : ' (semaine civile)'}`,
          })
        }
      }
    }
  }

  // ── ESPACEMENT_MIN — au moins X jours entre deux gardes (brique réglable) ──
  // Re-vérification INDÉPENDANTE : on trie les dates de garde du véto et on
  // contrôle l'écart entre dates consécutives (si tous ≥ X, toutes les paires le
  // sont). Seules les règles DURES (étage ≤ 2) sont des violations.
  const joursEntre = (a: string, b: string): number => {
    const da = new Date(a + 'T12:00:00Z').getTime()
    const db = new Date(b + 'T12:00:00Z').getTime()
    return Math.round(Math.abs(db - da) / 86_400_000)
  }
  for (const vet of vetsNorm) {
    for (const c of vet.contraintes) {
      if (!c.actif || c.type !== 'espacement_min') continue
      const cfg = c.config as Record<string, unknown>
      const etage = typeof cfg.force === 'number' ? (cfg.force as number) : 2
      if (etage > 2) continue
      const eRaw = cfg.ecart_min_jours
      const ecart = typeof eRaw === 'number' ? eRaw : typeof eRaw === 'string' ? parseInt(eRaw, 10) : NaN
      if (!Number.isFinite(ecart) || ecart <= 0) continue

      const dates = planning.attributions
        .filter((a) => a.premier_id === vet.id || a.second_id === vet.id)
        .map((a) => a.date)
        .sort()
      const vues = new Set<string>()
      for (let i = 1; i < dates.length; i++) {
        if (dates[i - 1] === dates[i]) continue
        const j = joursEntre(dates[i - 1], dates[i])
        if (j < ecart) {
          const cle = `${dates[i - 1]}|${dates[i]}`
          if (vues.has(cle)) continue
          vues.add(cle)
          violations.push({
            regle: 'ESPACEMENT',
            date: dates[i],
            type: 'espacement',
            vetId: vet.id,
            detail: `ESPACEMENT : ${vet.prenom} — seulement ${j} jour(s) entre le ${dates[i - 1]} et le ${dates[i]} (min ${ecart})`,
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

      const datesWe = planning.attributions
        .filter((a) => a.type === 'weekend' && (a.premier_id === vet.id || a.second_id === vet.id))
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
            detail: `FREQ_WE : ${vet.prenom} — deux week-ends à ${j} jour(s) d'écart (${datesWe[i - 1]} → ${datesWe[i]}), min 1 toutes les ${n} semaines`,
          })
        }
      }
    }
  }

  // ── R9 — vendredi soir = même duo que le week-end ──
  // ── R8 — inversion 1er/2nd entre vendredi soir et WE ──
  // On ne signale ces violations que si la règle est appliquée en DUR (active +
  // ferme). Souple/désactivée → le moteur a le droit de ne pas la respecter →
  // pas de violation fantôme. MÊME config que le moteur (les deux gardiens).
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const r9Dur = estStructureDure(structure.r9_liaison)
  const r8Dur = estStructureDure(structure.r8_inversion)
  for (const a of planning.attributions) {
    if (!r9Dur && !r8Dur) break // les deux assouplies/coupées → rien à contrôler
    if (a.type !== 'weekend') continue
    const ven = vendrediDe(a.date)
    const attrVen = trouver(planning, ven, 'vendredi_soir')
    if (!attrVen) continue // pas de vendredi → rien à coupler

    const duoWe = new Set(membres(a))
    const duoVen = new Set(membres(attrVen))

    // R9 : ensembles identiques (seulement si R9 est dure)
    const memesMembres =
      duoWe.size === duoVen.size && [...duoWe].every((m) => duoVen.has(m))
    if (r9Dur && !memesMembres) {
      violations.push({
        regle: 'R9',
        date: a.date,
        type: 'weekend',
        detail: `R9 : le duo WE [${[...duoWe].join(',')}] diffère du duo vendredi soir [${[...duoVen].join(',')}] (semaine du ${ven})`,
      })
    }

    // R8 : inversion des rôles (seulement si R8 est dure)
    if (r8Dur && attrVen.premier_id && a.premier_id === attrVen.premier_id) {
      violations.push({
        regle: 'R8',
        date: a.date,
        type: 'weekend',
        vetId: a.premier_id,
        detail: `R8 : ${vetsById.get(a.premier_id)?.prenom ?? a.premier_id} est 1er vendredi soir ET 1er le WE — l'inversion impose 2nd le WE (${a.date})`,
      })
    }
    if (r8Dur && attrVen.second_id && a.second_id === attrVen.second_id) {
      violations.push({
        regle: 'R8',
        date: a.date,
        type: 'weekend',
        vetId: a.second_id,
        detail: `R8 : ${vetsById.get(a.second_id)?.prenom ?? a.second_id} est 2nd vendredi soir ET 2nd le WE — l'inversion impose 1er le WE (${a.date})`,
      })
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
  if (we && (we.premier_id === vetId || we.second_id === vetId)) return true
  const ven = plusJours(sam, -1)
  const av = trouver(planning, ven, 'vendredi_soir')
  return !!av && (av.premier_id === vetId || av.second_id === vetId)
}
