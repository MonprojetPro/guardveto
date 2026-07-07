// ============================================================
// GUARDVETO — Desiderata : préférences POSITIVES (backlog n°7)
// ============================================================
// Tout le catalogue historique est en interdiction/limite. Les desiderata
// sont l'inverse : « préfère le mardi », « préfère être avec X », « veut
// PLUS de gardes ». Trois briques PAR-VÉTO, STRUCTURELLEMENT SOUPLES
// (étage ≥ 3, jamais de gardien dur — l'écriture refuse « jamais » et
// l'évaluation clampe : une préférence ne bloque JAMAIS une génération).
//
// ⚠️ JAMAIS DE BONUS NÉGATIF dans le vecteur lexicographique : un coût
// négatif rendrait un planning « meilleur que parfait » et casserait la
// hiérarchie des étages. Chaque préférence est donc modélisée en PÉNALITÉ
// DE NON-SATISFACTION (0 si satisfaite, +poids sinon). Les termes négatifs
// restent réservés au TRI DES CANDIDATS (sans danger — précédent :
// malusAvantageFinancier), utilisé ici pour le biais de volume.
//
// Deux gardiens de score, MÊMES prédicats (leçon « double scoring ») :
//   • candidats (greedy + LNS) : penaliteDesiderataCandidat + biaisVolume ;
//   • global (scorerPlanning)  : scorerDesiderata (le LNS ne défait pas
//     ce que le greedy a construit).
// Le validateur indépendant ne voit RIEN (préférence ≠ violation).
// ============================================================

import type {
  VetEngine, SlotGarde, PlanningPartiel, RoleGarde, ContrainteEngine,
} from '../types'
import { jourDeLaSemaine } from '../utils'
import { penaliteStructureEtage } from '../structure-config'

/** Étage effectif d'un desiderata : TOUJOURS souple (clamp 3..5). */
function etageSouple(c: ContrainteEngine): number {
  const f = (c.config as Record<string, unknown>).force
  const etage = typeof f === 'number' ? f : 3
  return Math.min(5, Math.max(3, etage))
}

/** Poids intra-étage d'un desiderata (mêmes valeurs que les règles souples). */
function poidsDe(c: ContrainteEngine): number {
  return penaliteStructureEtage(etageSouple(c))
}

const TYPES_DESIDERATA = new Set(['preferer_creneau', 'preferer_avec', 'volume_gardes'])

/** Le véto a-t-il au moins un desiderata actif ? (early-exit perf) */
export function aDesiderata(vet: VetEngine): boolean {
  return vet.contraintes.some((c) => c.actif && TYPES_DESIDERATA.has(c.type))
}

// ── preferer_creneau — « préfère le mardi / les week-ends » ──
// params: { jours?: string[] (lundi..dimanche), creneaux?: string[] (codes) }
// — au moins l'un des deux. La préférence est satisfaite si le slot matche
// L'UN des jours OU L'UN des créneaux. Pénalité sur chaque garde posée HORS
// préférence : le moteur concentre les gardes du véto sur ce qu'il préfère.

function lireListe(cfg: Record<string, unknown>, cle: string): string[] {
  const v = cfg[cle]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

/** Le slot matche-t-il la préférence de créneau ? (config mal formée → true : inerte) */
function slotPrefere(c: ContrainteEngine, slot: Pick<SlotGarde, 'date' | 'type'>): boolean {
  const cfg = c.config as Record<string, unknown>
  const jours = lireListe(cfg, 'jours')
  const creneaux = lireListe(cfg, 'creneaux')
  if (jours.length === 0 && creneaux.length === 0) return true // inerte
  if (creneaux.includes(slot.type)) return true
  if (jours.length > 0 && jours.includes(jourDeLaSemaine(slot.date))) return true
  return false
}

// ── preferer_avec — « préfère être de garde avec X » ─────────
// params: { avec_veterinaire_id }. Jugé sur l'ÉQUIPE COMPLÈTE d'un créneau
// multi-places où le véto figure : X absent → pénalité. Même sémantique
// « pose complétante » que la composition (n°6) côté candidat.

function lirePartenaire(c: ContrainteEngine): string | null {
  const v = (c.config as Record<string, unknown>).avec_veterinaire_id
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// ── volume_gardes — « veut PLUS (ou MOINS) de gardes » ───────
// params: { sens: 'plus' | 'moins' }. Deux mécaniques complémentaires :
//   • TRI des candidats : terme signé (−poids = prioritaire partout, +poids =
//     déprioritisé) — c'est là que le volume se construit ;
//   • GLOBAL : pénalité proportionnelle à l'écart à la moyenne dans le
//     mauvais sens (veut plus mais ≤ moyenne → pénalité par garde manquante).
//     L'étage du desiderata (3-5) DOMINE l'équité (étage 6) : le biais est
//     assumé — c'est le véto (et l'admin) qui l'ont demandé.

function lireSens(c: ContrainteEngine): 'plus' | 'moins' | null {
  const v = (c.config as Record<string, unknown>).sens
  return v === 'plus' || v === 'moins' ? v : null
}

// ═══ Gardien 1 — scoreurs de CANDIDATS (greedy + LNS) ═══════

/**
 * Pénalité de non-satisfaction des préférences du candidat pour CETTE pose :
 *   • preferer_creneau : slot hors préférence → +poids ;
 *   • preferer_avec : pose COMPLÉTANTE d'un créneau multi-places sans X →
 *     +poids (avant complétion, l'avenir peut encore amener X).
 * (volume_gardes : cf. biaisVolumeCandidat — terme signé, pas une pénalité.)
 */
export function penaliteDesiderataCandidat(
  slot: SlotGarde,
  roleVisé: RoleGarde,
  vet: VetEngine,
  planning: PlanningPartiel,
): number {
  let pen = 0
  for (const c of vet.contraintes) {
    if (!c.actif) continue
    if (c.type === 'preferer_creneau') {
      if (!slotPrefere(c, slot)) pen += poidsDe(c)
    } else if (c.type === 'preferer_avec') {
      const partenaire = lirePartenaire(c)
      if (!partenaire) continue
      const attr = planning.attributions.find((a) => a.date === slot.date && a.type === slot.type)
      const total = slot.nbPlaces ?? attr?.placements.length
      if (total === undefined || total < 2) continue // solo/inconnu : pas jugeable
      const dejaIds = attr
        ? attr.placements.filter((p) => p.role !== roleVisé && p.vetId !== null).map((p) => p.vetId as string)
        : []
      if (dejaIds.length + 1 < total) continue // pose non complétante
      if (!dejaIds.includes(partenaire)) pen += poidsDe(c)
    }
  }
  return pen
}

/**
 * Biais de volume du candidat (terme SIGNÉ du tri, jamais dans le vecteur
 * global) : « veut plus » → −poids (prioritaire), « veut moins » → +poids.
 */
export function biaisVolumeCandidat(vet: VetEngine): number {
  let biais = 0
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'volume_gardes') continue
    const sens = lireSens(c)
    if (sens === 'plus') biais -= poidsDe(c)
    else if (sens === 'moins') biais += poidsDe(c)
  }
  return biais
}

// ═══ Gardien 2 — scoreur GLOBAL (scorerPlanning) ═════════════

export interface ContributionDesiderata {
  etage: number
  regle: string
  cout: number
}

/**
 * scorerDesiderata — pénalités de non-satisfaction sur le planning COMPLET,
 * à sommer dans le vecteur lexicographique (étage du desiderata). MÊMES
 * prédicats que le gardien candidat — le LNS optimise dans le même sens.
 */
export function scorerDesiderata(
  planning: PlanningPartiel,
  vets: VetEngine[],
): ContributionDesiderata[] {
  const out: ContributionDesiderata[] = []
  const avecDesiderata = vets.filter(aDesiderata)
  if (avecDesiderata.length === 0) return out

  // Gardes par véto (toutes places confondues) — sert à volume_gardes.
  const countParVet = new Map<string, number>()
  let totalGardes = 0
  for (const a of planning.attributions) {
    for (const p of a.placements) {
      if (!p.vetId) continue
      countParVet.set(p.vetId, (countParVet.get(p.vetId) ?? 0) + 1)
      totalGardes++
    }
  }
  const nbVets = Math.max(1, vets.length)
  const moyenne = totalGardes / nbVets

  for (const vet of avecDesiderata) {
    for (const c of vet.contraintes) {
      if (!c.actif) continue
      const etage = etageSouple(c)
      const poids = poidsDe(c)

      if (c.type === 'preferer_creneau') {
        // Une pénalité par garde du véto posée HORS préférence.
        for (const a of planning.attributions) {
          if (!a.placements.some((p) => p.vetId === vet.id)) continue
          if (!slotPrefere(c, a)) {
            out.push({ etage, regle: 'preferer-creneau', cout: poids })
          }
        }
      } else if (c.type === 'preferer_avec') {
        const partenaire = lirePartenaire(c)
        if (!partenaire) continue
        // Une pénalité par créneau MULTI-PLACES du véto sans son partenaire.
        for (const a of planning.attributions) {
          if (a.placements.length < 2) continue
          if (!a.placements.some((p) => p.vetId === vet.id)) continue
          if (!a.placements.some((p) => p.vetId === partenaire)) {
            out.push({ etage, regle: 'preferer-avec', cout: poids })
          }
        }
      } else if (c.type === 'volume_gardes') {
        const sens = lireSens(c)
        if (!sens) continue
        const count = countParVet.get(vet.id) ?? 0
        // Écart entier dans le MAUVAIS sens (0 si le souhait est honoré).
        const ecart = sens === 'plus'
          ? Math.max(0, Math.ceil(moyenne) - count)
          : Math.max(0, count - Math.floor(moyenne))
        if (ecart > 0) {
          out.push({ etage, regle: 'volume-gardes', cout: ecart * poids })
        }
      }
    }
  }
  return out
}
