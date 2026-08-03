// ============================================================
// GUARDVETO — Contraintes dures (R1–R9, R16–R19)
// ============================================================

import type {
  VetEngine, VetEngineNormalise, SlotGarde, PlanningPartiel, ValidationResult, AttributionGarde, CalendrierResolu,
  ContrainteEngine, RoleGarde,
} from '../types'
import {
  jourDeLaSemaine, estSemaineImpaire, estSemaineImpaireAncrée, estEnVacancesScolaires,
  estJourFerie, estEnEte, lundiDeSemaine, vendrediDeSemaine, samediDeSemaine, addDays,
  attributionsAvecContexte,
} from '../utils'
import {
  DEFAULT_STRUCTURE_CONFIG, estStructureDure, relationsEffectives,
  RELATIONS_STRUCTURE_DEFAUT, compositionsDures, rolesInterditsDurs,
  type StructureConfig, type StructureRegleConfig, type RelationStructure,
} from '../structure-config'
import { apparierSourcePourCible, apparierCiblePourSource } from '../relations-structure'
import {
  violeCompositionPose, messageComposition,
  violeRoleInterdit, messageRoleInterdit,
} from './composition-equipe'
import { raisonSeulementAvecDur } from './seulement-avec'
import { estAttribue, vetPourRole, roleDuVet } from '../attribution'
import { fetesCouvertesParSlot, cleInstanceFete } from '../historique-fete'

// ── Helpers internes ────────────────────────────────────

function invalid(raison: string): ValidationResult {
  return { valid: false, raison }
}

function ok(warning?: string): ValidationResult {
  return { valid: true, warning }
}

// ── Routage DUR / MOU des règles configurées (P1-B) ──────
//
// Chaque règle de cabinet porte un « étage » (config.force, 0..5) :
//   0 invariant · 1 reglementaire · 2 jamais   → DUR (blocage)
//   3 sauf_crise · 4 evitee · 5 si_possible     → MOU (pénalité, ne bloque pas)
// Les règles STRUCTURELLES (R8/R9/R16-R21, effectifs) restent dures en toutes
// circonstances — seules les règles CONFIGURÉES par véto (R1/R2/R3/R6) sont
// routées. Défaut DUR quand l'étage est absent (contraintes legacy sans force)
// → comportement historique préservé.

/** Étage au-delà duquel une règle configurée devient MOLLE (pénalité). */
const ETAGE_DUR_MAX = 2

/** Lit l'étage (0..5) d'une contrainte ; 2 (dur) par défaut si absent. */
function etageDe(c: { config: Record<string, unknown> }): number {
  const f = c.config?.force
  return typeof f === 'number' ? f : ETAGE_DUR_MAX
}

/** Une contrainte d'étage ≤ 2 est appliquée en DUR (bloque). */
function estDure(c: { config: Record<string, unknown> }): boolean {
  return etageDe(c) <= ETAGE_DUR_MAX
}

/** Pénalité souple selon l'étage (plus l'étage est haut, plus c'est faible). */
const PENALITE_ETAGE: Record<number, number> = { 3: 100, 4: 50, 5: 20 }
function penaliteEtage(etage: number): number {
  return PENALITE_ETAGE[etage] ?? 0
}

/** Recherche l'attribution d'une date+type dans le planning partiel */
function getAttribution(
  planning: PlanningPartiel,
  date: string,
  type: SlotGarde['type']
): AttributionGarde | undefined {
  return planning.attributions.find((a) => a.date === date && a.type === type)
}

/** Vérifie si le véto a une garde WE liée à cette semaine.
 *  Lun/Mar/Mer → le WE pertinent est celui de la semaine précédente (le WE vient de se terminer).
 *  Jeu/Ven/Sam/Dim → le WE pertinent est celui de la semaine courante (le WE arrive).
 *  Vérifie aussi vendredi_soir car R9 garantit que ven soir = même duo que le WE. */
export function aGardeWeekendCetteSemaine(
  vetId: string,
  date: string,
  planning: PlanningPartiel
): boolean {
  const idx = new Date(date + 'T12:00:00Z').getUTCDay() // 0=dim,1=lun…6=sam
  let sam: string
  if (idx >= 1 && idx <= 3) {
    // Lun/Mar/Mer → samedi précédent
    const lundi = lundiDeSemaine(date)
    sam = addDays(lundi, -2)
  } else {
    sam = samediDeSemaine(date)
  }
  // Vérifie la garde weekend (samedi)
  const aWE = getAttribution(planning, sam, 'weekend')
  if (aWE && estAttribue(aWE, vetId)) return true
  // Vérifie aussi vendredi_soir (lié au même WE par R9)
  const ven = addDays(sam, -1)
  const aVen = getAttribution(planning, ven, 'vendredi_soir')
  return !!aVen && estAttribue(aVen, vetId)
}

/** Vérifie si le véto est déjà de garde vendredi soir cette semaine */
function aGardeVendrediSoir(
  vetId: string,
  date: string,
  planning: PlanningPartiel
): boolean {
  const ven = vendrediDeSemaine(date)
  const a = getAttribution(planning, ven, 'vendredi_soir')
  return !!a && estAttribue(a, vetId)
}

/**
 * Extrait la liste des UUID de vétérinaires "interdits en duo" d'une config
 * de contrainte `duo_interdit`, quelle que soit sa forme :
 *   • V1 legacy : { avec_veterinaire_id: 'uuid' }
 *   • V2 brique  : { params: { avec_veterinaire_id: 'uuid' } }
 *   • V2 n-aire   : { axes: { qui: 'uuid' | ['uuid', …] } }
 * Renvoie toujours un tableau (vide si rien d'exploitable).
 */
function lireDuoInterditIds(config: Record<string, unknown>): string[] {
  const ids: string[] = []

  const pousser = (v: unknown) => {
    if (typeof v === 'string' && v.trim() !== '') ids.push(v)
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim() !== '') ids.push(x)
  }

  // 1. Top-level (legacy)
  pousser(config.avec_veterinaire_id)

  // 2. params (brique V2 — la migration y range la config legacy intégrale)
  const params = config.params
  if (params && typeof params === 'object') {
    pousser((params as Record<string, unknown>).avec_veterinaire_id)
  }

  // 3. axes.qui (forme V2 n-aire éventuelle)
  const axes = config.axes
  if (axes && typeof axes === 'object') {
    pousser((axes as Record<string, unknown>).qui)
  }

  // Dédoublonnage déterministe
  return [...new Set(ids)]
}

// ── Contraintes individuelles ────────────────────────────

/**
 * R1 — Jours de repos fixes
 * Vérifie les contraintes `jour_repos_fixe` actives du vétérinaire.
 */
/**
 * Le repos fixe vise-t-il CE type de garde ?
 *
 * `creneaux` absent ou vide = toute la journée (comportement historique, et
 * celui de toutes les règles déjà en base). Une liste = seulement ces gardes-là.
 *
 * POURQUOI CE CIBLAGE EXISTE — un cabinet peut déclarer plusieurs gardes le
 * même jour (une de jour, une de soir : la structure le permet, il suffit de
 * les ajouter). Sans ciblage, « ne fait pas de garde le mercredi » les bloque
 * TOUTES, y compris quand la contrainte réelle ne porte que sur l'après-midi.
 * La donnée d'origine du cabinet pilote porte d'ailleurs un `periode:
 * 'apres_midi'` qu'aucun code n'a jamais évalué — la règle promettait une
 * portée partielle et bloquait la journée entière. Tant qu'il n'y a qu'une
 * garde par jour, les deux se confondent ; le jour où ce n'est plus vrai, la
 * règle interdit trois fois ce qu'elle annonce, sans que rien ne le signale.
 */
function viseCeCreneau(cfg: Record<string, unknown>, slot: SlotGarde): boolean {
  const cibles = cfg.creneaux
  if (!Array.isArray(cibles) || cibles.length === 0) return true
  return (cibles as unknown[]).some((code) => code === slot.type)
}

function violeReposFixe(
  c: ContrainteEngine, slot: SlotGarde, calendrier?: CalendrierResolu,
): boolean {
  const jour = jourDeLaSemaine(slot.date)
  const cfg = c.config as Record<string, unknown>

  // Format simple : { jour, flexible_vacances, creneaux? }
  if (typeof cfg.jour === 'string') {
    if (cfg.jour !== jour) return false
    if (!viseCeCreneau(cfg, slot)) return false
    // Exception vacances scolaires — deux noms tolérés (V1 flexible_vacances
    // / V2 exception_vacances_scolaires).
    const flexibleVac = Boolean(cfg.flexible_vacances ?? cfg.exception_vacances_scolaires)
    if (flexibleVac && estEnVacancesScolaires(slot.date, calendrier)) return false
    return true
  }

  // Format avec tableau de règles (Anne-Sophie)
  if (Array.isArray(cfg.regles)) {
    type Regle = {
      jour: string; periode?: string; semaine?: string; ancre?: string; creneaux?: unknown
    }
    for (const regle of cfg.regles as Regle[]) {
      if (regle.jour !== jour) continue
      // Le ciblage se lit AUSSI par entrée : un cabinet peut ne bloquer que la
      // garde de jour le lundi et toute la journée le mercredi.
      if (!viseCeCreneau(regle as unknown as Record<string, unknown>, slot)) continue
      if (regle.semaine === 'impaire' || regle.semaine === 'paire') {
        // Utiliser l'ancre mobile si disponible (F7-001 fix parité ISO 53)
        let estImpaire: boolean
        if (regle.ancre && calendrier) {
          estImpaire = estSemaineImpaireAncrée(slot.date, regle.ancre, calendrier.vacancesScolaires)
        } else if (regle.ancre) {
          estImpaire = estSemaineImpaireAncrée(slot.date, regle.ancre, [])
        } else {
          estImpaire = estSemaineImpaire(slot.date)
        }
        if (regle.semaine === 'impaire' && !estImpaire) continue
        if (regle.semaine === 'paire' && estImpaire) continue
      }
      return true
    }
  }
  return false
}

function checkR1JourReposFixe(vet: VetEngine, slot: SlotGarde, calendrier?: CalendrierResolu): ValidationResult {
  const jour = jourDeLaSemaine(slot.date)
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'jour_repos_fixe') continue
    if (estDure(c) && violeReposFixe(c, slot, calendrier)) {
      return invalid(`R1 : ${vet.prenom} a un jour de repos fixe le ${jour}`)
    }
  }
  return ok()
}

/**
 * R2 — Anne-So indisponible semaines impaires (soirs + WE)
 * S'applique via contrainte `indisponibilite_cyclique`.
 *
 * Utilise `estSemaineImpaireAncrée()` si le calendrier est fourni et que la contrainte
 * a une `ancre` (date de début de période) — évite le bug semaine ISO 53.
 * Fallback sur `estSemaineImpaire()` (ancienne logique) si le calendrier est absent.
 */
function violeIndispoCyclique(
  c: ContrainteEngine, slot: SlotGarde, calendrier?: CalendrierResolu,
): boolean {
  const cfg = c.config as Record<string, unknown>
  const semaines = cfg.semaines as string | undefined
  const periodes = (cfg.periodes ?? []) as string[]
  const ancre = cfg.ancre as string | undefined

  // Utiliser l'ancre mobile si disponible (F7-001 fix parité ISO 53)
  // Sinon fallback sur la parité ISO globale (comportement V1)
  let estImpaire: boolean
  if (ancre && calendrier) {
    estImpaire = estSemaineImpaireAncrée(slot.date, ancre, calendrier.vacancesScolaires)
  } else if (ancre) {
    estImpaire = estSemaineImpaireAncrée(slot.date, ancre, [])
  } else {
    estImpaire = estSemaineImpaire(slot.date)
  }

  const concerneCetteSemaine =
    semaines === 'toutes' ||
    (semaines === 'impaires' && estImpaire) ||
    (semaines === 'paires' && !estImpaire)
  if (!concerneCetteSemaine) return false

  const estSoir = slot.type === 'semaine_soir' || slot.type === 'vendredi_soir'
  const estWe = slot.type === 'weekend'
  if (periodes.includes('soir_semaine') && estSoir) return true
  if (periodes.includes('weekend') && estWe) return true
  // Créneau SUR-MESURE (code hors types historiques) : choix CONSERVATEUR —
  // une indispo cyclique signifie « pas là ces semaines-là » ; on bloque dès
  // qu'une période est configurée, plutôt que de planifier un véto absent.
  // (La granularité par créneau du cabinet viendra avec les règles par type.)
  if (!estSoir && !estWe && slot.type !== 'ferie' && periodes.length > 0) return true
  return false
}

function checkR2IndispoCyclique(vet: VetEngine, slot: SlotGarde, calendrier?: CalendrierResolu): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'indisponibilite_cyclique') continue
    if (estDure(c) && violeIndispoCyclique(c, slot, calendrier)) {
      // « est indisponible impairess » : le `s` collé produisait un mot qui
      // n'existe pas, et la phrase n'avait de toute façon pas de sens sans le
      // nom de ce qui est pair ou impair (retour MiKL du 2026-08-03). Ces
      // libellés remontent jusqu'aux cartes du pré-vol : ils se lisent.
      const semaines = (c.config as Record<string, unknown>).semaines as string | undefined
      const quand =
        semaines === 'paires' ? 'les semaines paires'
        : semaines === 'impaires' ? 'les semaines impaires'
        : 'une semaine sur deux'
      return invalid(`R2 : ${vet.prenom} est indisponible ${quand}`)
    }
  }
  return ok()
}

/**
 * R3 — Repos conditionnel (si garde WE → jour A, sinon jour B)
 * Ex : Jean repos vendredi, SAUF si garde WE → mardi
 */
function violeReposConditionnel(
  c: ContrainteEngine, vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const jour = jourDeLaSemaine(slot.date)
  const cfg = c.config as Record<string, unknown>
  const siGardeWe = cfg.si_garde_we as string | undefined
  const sinon = cfg.sinon as string | undefined

  // vendredi_soir EST une garde WE par définition (R9 lie ven soir + sam).
  // Si on évalue vendredi_soir, le samedi n'est pas encore planifié →
  // on considère gardeWe = true pour éviter de bloquer à tort.
  const gardeWe = slot.type === 'vendredi_soir'
    ? true
    : aGardeWeekendCetteSemaine(vet.id, slot.date, planning)

  if (gardeWe && siGardeWe === jour) return true
  if (!gardeWe && sinon === jour) return true
  return false
}

function checkR3ReposConditionnel(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel
): ValidationResult {
  const jour = jourDeLaSemaine(slot.date)
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'jour_repos_conditionnel') continue
    if (estDure(c) && violeReposConditionnel(c, vet, slot, planning)) {
      return invalid(`R3/R5 : ${vet.prenom} est en repos le ${jour}`)
    }
  }
  return ok()
}

/**
 * R6 — Jamais Manon + Antoine seuls (duo_interdit)
 */
/** Renvoie l'id du partenaire interdit déjà présent sur ce slot, sinon null. */
function violeDuoInterdit(
  c: ContrainteEngine, slot: SlotGarde, planning: PlanningPartiel,
): string | null {
  // Lecture du/des partenaire(s) interdit(s) — tolère 3 formes de config :
  //   • V1 legacy  : { avec_veterinaire_id: 'uuid' }
  //   • V2 brique   : { brique:'duo_interdit', force:2, params:{ avec_veterinaire_id:'uuid' } }
  //   • V2 n-aire    : axes.qui = 'uuid' | ['uuid', …]   (forme future)
  const autresIds = lireDuoInterditIds(c.config as Record<string, unknown>)
  if (autresIds.length === 0) return null

  const attr = getAttribution(planning, slot.date, slot.type)
  if (!attr) return null

  for (const autreId of autresIds) {
    if (estAttribue(attr, autreId)) return autreId
  }
  return null
}

function checkR6DuoInterdit(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel,
  allVets: VetEngine[]
): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'duo_interdit') continue
    if (!estDure(c)) continue
    const autreId = violeDuoInterdit(c, slot, planning)
    if (autreId) {
      const autreVet = allVets.find((v) => v.id === autreId)
      return invalid(
        `R6 : ${vet.prenom} et ${autreVet?.prenom ?? '?'} ne peuvent pas être en duo seuls`
      )
    }
  }
  return ok()
}

/**
 * R7 — Anne-Cat uniquement en dernier recours
 * Ce n'est pas un blocage dur mais un avertissement pour le solver.
 */
function checkR7DernierRecours(vet: VetEngine): ValidationResult {
  if (vet.dernier_recours) {
    return ok(`R7 : ${vet.prenom} est dernier recours — à n'utiliser que si aucun autre vétérinaire n'est disponible`)
  }
  return ok()
}

/** Le couple historique (messages legacy conservés mot pour mot pour lui). */
function estCoupleHistorique(rel: RelationStructure): boolean {
  return rel.sourceCode === 'vendredi_soir' && rel.cibleCode === 'weekend'
}

/**
 * Message R8 (inversion). Préserve le libellé historique pour le couple
 * vendredi↔WE (et premier/second — P4 slice 2) ; générique au-delà.
 * Le sens : « ton rôle sur le créneau cible doit être DIFFÉRENT de celui
 * tenu sur le créneau source lié » (pour 2 rôles = inversion 1er/2nd).
 */
function messageR8(prenom: string, roleSource: string, rel: RelationStructure): string {
  if (estCoupleHistorique(rel)) {
    if (roleSource === 'premier') return `R8 : ${prenom} était 1er vendredi soir → doit être 2nd ce week-end`
    if (roleSource === 'second') return `R8 : ${prenom} était 2nd vendredi soir → doit être 1er ce week-end`
    return `R8 : ${prenom} avait le rôle « ${roleSource} » vendredi soir → doit changer de rôle ce week-end`
  }
  return `R8 : ${prenom} avait le rôle « ${roleSource} » sur « ${rel.sourceCode} » → doit changer de rôle sur « ${rel.cibleCode} »`
}

/**
 * R8 — Inversion des rôles entre créneaux liés (réglable).
 *
 * GÉNÉRIQUE (RG tranche 2) : le couple n'est plus câblé vendredi↔WE — chaque
 * relation `inversion_role` (donnée, repli couple historique) impose que le
 * rôle tenu sur l'occurrence CIBLE diffère de celui tenu sur l'occurrence
 * SOURCE appariée (adjacence, cf. relations-structure). Sémantique N-places
 * (P4 slice 2) conservée : « différent », sans présumer les noms de rôle.
 */
function checkR8Inversion(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  planning: PlanningPartiel,
  cfg: StructureRegleConfig = DEFAULT_STRUCTURE_CONFIG.r8_inversion,
  relations: readonly RelationStructure[] = RELATIONS_STRUCTURE_DEFAUT
): ValidationResult {
  // Désactivée ou souple → ne bloque pas (souple = pénalité gérée au scoring).
  if (!estStructureDure(cfg)) return ok()

  for (const rel of relations) {
    if (rel.genre !== 'inversion_role' || slot.type !== rel.cibleCode) continue
    const attrSource = apparierSourcePourCible(planning, rel, slot.date)
    if (!attrSource) continue // source non planifiée / hors fenêtre → pas de contrainte

    // Le rôle sur la cible doit différer de celui tenu sur la source liée.
    const roleSource = roleDuVet(attrSource, vet.id)
    if (roleSource !== null && roleVisé === roleSource) {
      return invalid(messageR8(vet.prenom, roleSource, rel))
    }
  }

  return ok()
}

/** Messages R9 : libellés historiques pour le couple vendredi↔WE, génériques sinon. */
function messageR9Cible(prenom: string, rel: RelationStructure): string {
  return estCoupleHistorique(rel)
    ? `R9 : ${prenom} n'est pas dans le duo du vendredi soir — le WE doit avoir les mêmes vétérinaires`
    : `R9 : ${prenom} n'est pas dans l'équipe de « ${rel.sourceCode} » — « ${rel.cibleCode} » doit avoir les mêmes vétérinaires`
}
function messageR9Source(prenom: string, rel: RelationStructure): string {
  return estCoupleHistorique(rel)
    ? `R9 : ${prenom} n'est pas dans le duo WE — le vendredi soir doit avoir les mêmes vétérinaires`
    : `R9 : ${prenom} n'est pas dans l'équipe de « ${rel.cibleCode} » — « ${rel.sourceCode} » doit avoir les mêmes vétérinaires`
}

/**
 * R9 — Créneaux liés = même équipe (réglable).
 *
 * GÉNÉRIQUE (RG tranche 2) : chaque relation `meme_binome` (donnée, repli
 * couple historique vendredi↔WE) impose que l'occurrence CIBLE et l'occurrence
 * SOURCE appariée portent les MÊMES vétérinaires. Contrôlé dans les deux sens
 * (on planifie la cible en regardant la source déjà posée, et inversement).
 */
function checkR9VendrediLieWE(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel,
  cfg: StructureRegleConfig = DEFAULT_STRUCTURE_CONFIG.r9_liaison,
  relations: readonly RelationStructure[] = RELATIONS_STRUCTURE_DEFAUT
): ValidationResult {
  // Désactivée ou souple → ne bloque pas (souple = pénalité gérée au scoring).
  if (!estStructureDure(cfg)) return ok()

  for (const rel of relations) {
    if (rel.genre !== 'meme_binome') continue

    if (slot.type === rel.cibleCode) {
      // On planifie la CIBLE : le véto doit être dans l'équipe de la source liée.
      const attrSource = apparierSourcePourCible(planning, rel, slot.date)
      if (attrSource && !estAttribue(attrSource, vet.id)) {
        return invalid(messageR9Cible(vet.prenom, rel))
      }
    }

    if (slot.type === rel.sourceCode) {
      // On planifie la SOURCE : cohérence avec la cible liée si déjà posée.
      const attrCible = apparierCiblePourSource(planning, rel, slot.date)
      if (attrCible && !estAttribue(attrCible, vet.id)) {
        return invalid(messageR9Source(vet.prenom, rel))
      }
    }
  }

  return ok()
}

/**
 * R16 — Véto en congé = aucune garde
 */
function checkR16Conge(vet: VetEngine, slot: SlotGarde): ValidationResult {
  for (const conge of vet.conges) {
    if (slot.date >= conge.date_debut && slot.date <= conge.date_fin) {
      return invalid(`R16 : ${vet.prenom} est en congé du ${conge.date_debut} au ${conge.date_fin}`)
    }
  }
  return ok()
}

/**
 * Effectif d'un créneau semaine_soir : besoin d'un 2nd ?
 * Configurable (slot.besoinSecond) ; repli historique sur la saison (hiver = 2,
 * été = 1) quand l'effectif n'est pas porté par le slot (contraintes legacy).
 */
function semaineBesoinSecond(slot: SlotGarde): boolean {
  return slot.besoinSecond ?? (slot.saison === 'hiver')
}

/**
 * R17 — Effectif semaine : pas de 2nd quand le créneau n'en a pas besoin.
 * (Historiquement « été = 1 seul » ; désormais piloté par l'effectif configurable.)
 */
function checkR17Ete(slot: SlotGarde, roleVisé: RoleGarde): ValidationResult {
  if (slot.type === 'semaine_soir' && roleVisé === 'second' && !semaineBesoinSecond(slot)) {
    return invalid('R17 : une seule garde de nuit en semaine sur ce créneau (pas de 2nd)')
  }
  return ok()
}

/**
 * R18 — Effectif semaine à 2 : le 1er doit être désigné avant le 2nd.
 * (Historiquement « hiver = 2 » ; désormais piloté par l'effectif configurable.)
 */
function checkR18Hiver(slot: SlotGarde, roleVisé: RoleGarde, planning: PlanningPartiel): ValidationResult {
  if (slot.type !== 'semaine_soir' || !semaineBesoinSecond(slot)) return ok()

  const attr = getAttribution(planning, slot.date, slot.type)
  // Si on assigne le 2nd mais qu'il n'y a pas de 1er → invalide
  if (roleVisé === 'second' && attr && !vetPourRole(attr, 'premier')) {
    return invalid('R18 : En hiver, le 1er de garde doit être désigné avant le 2nd')
  }
  return ok()
}

/**
 * R19 — WE : toujours 2 de garde
 * Un weekend nécessite toujours un 1er et un 2nd.
 */
function checkR19Weekend(slot: SlotGarde, roleVisé: RoleGarde, planning: PlanningPartiel): ValidationResult {
  if (slot.type !== 'weekend') return ok()

  const attr = getAttribution(planning, slot.date, slot.type)
  if (roleVisé === 'second' && attr && !vetPourRole(attr, 'premier')) {
    return invalid('R19 : Le 1er de garde WE doit être désigné avant le 2nd')
  }
  return ok()
}

/**
 * R21 — 1er et 2nd d'un même créneau = deux vétérinaires DIFFÉRENTS.
 *
 * Pour le week-end, c'est déjà garanti indirectement par R8 (inversion 1er/2nd)
 * et R9 (même duo que vendredi soir). Mais pour les gardes de semaine en hiver,
 * aucune règle ne l'imposait → le solver pouvait réassigner le 1er comme 2nd
 * (premier_id === second_id). Cette règle interdit qu'un véto déjà présent dans
 * un rôle du créneau occupe l'autre rôle.
 */
function checkR21RolesDistincts(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  planning: PlanningPartiel
): ValidationResult {
  const attr = getAttribution(planning, slot.date, slot.type)
  if (!attr) return ok()

  // Généralisé N-places (P3a-2) : chaque PLACE d'un créneau doit être un véto
  // différent. Le véto est-il déjà posé sur une AUTRE place de ce créneau ?
  // (isValid est évalué AVANT l'assignation de `roleVisé`, donc `estAttribue`
  // ne remonte que les places DÉJÀ pourvues.) Pour le défaut à 2 rôles, c'est
  // exactement l'ancien contrôle 1er↔2nd — équivalence préservée.
  if (estAttribue(attr, vet.id)) {
    return invalid(`R21 : ${vet.prenom} occupe déjà une place de ce créneau — chaque place doit être un vétérinaire différent`)
  }
  return ok()
}

/**
 * COMPOSITION — Composition d'équipe par tag (backlog n°6, règles DURES).
 *
 * « Au moins un senior par créneau ciblé » / « un junior jamais seul ».
 * Ne juge que la POSE COMPLÉTANTE (l'équipe du créneau se fige) — cf.
 * rules/composition-equipe.ts. Les règles souples (étage ≥ 3) ne bloquent
 * pas : elles pèsent au scoring (les deux scoreurs).
 */
function checkComposition(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  planning: PlanningPartiel,
  structure: StructureConfig,
  allVets: VetEngine[],
): ValidationResult {
  const regles = compositionsDures(structure)
  if (regles.length === 0) return ok()

  const vetsById = new Map(allVets.map((v) => [v.id, v]))
  for (const regle of regles) {
    if (violeCompositionPose(regle, slot, roleVisé, vet, planning, vetsById)) {
      return invalid(messageComposition(regle, vet.prenom))
    }
  }
  return ok()
}

/**
 * ROLE_TAG — Rôle interdit selon attribut (backlog n°22, règles DURES).
 *
 * « Un junior jamais 1er » : un véto portant le tag ne peut pas tenir le
 * rôle interdit sur les créneaux ciblés. Gabarit R17 (place par place).
 * Les règles souples (étage ≥ 3) pèsent au scoring (les deux scoreurs).
 */
function checkRoleInterditTag(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  structure: StructureConfig,
): ValidationResult {
  for (const regle of rolesInterditsDurs(structure)) {
    if (violeRoleInterdit(regle, slot.type, roleVisé, vet)) {
      return invalid(messageRoleInterdit(regle, vet.prenom))
    }
  }
  return ok()
}

/**
 * R22 — Un vétérinaire ne tient qu'UNE garde par jour (inter-créneaux).
 *
 * Nécessaire depuis que plusieurs créneaux peuvent coexister le même jour
 * (P3b — ex : garde de jour + garde de nuit). R21 ne couvre que les places
 * d'un MÊME créneau ; espacement_min saute explicitement le même jour.
 * Sur le catalogue par défaut (un seul créneau par jour), cette règle ne se
 * déclenche jamais → byte-identique.
 *
 * Limite connue (héritage weekend atomique) : le créneau `weekend` est daté du
 * samedi mais couvre ven→dim ; un créneau sur-mesure daté du dimanche n'est
 * donc PAS vu comme le même jour. Disparaîtra avec la fin du weekend magique.
 */
function checkR22UneGardeParJour(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel
): ValidationResult {
  for (const a of planning.attributions) {
    if (a.date === slot.date && a.type !== slot.type && estAttribue(a, vet.id)) {
      return invalid(
        `R22 : ${vet.prenom} a déjà une garde ce jour-là (${a.type}) — une seule garde par jour`
      )
    }
  }
  return ok()
}

// ── Volet MOU des règles configurées (P1-B) ──────────────

/**
 * penaliteContraintesConfig — pénalité souple des règles CONFIGURÉES d'étage ≥ 3
 * (sauf_crise / evitee / si_possible) que ce candidat violerait. Les règles
 * d'étage ≤ 2 ne sont PAS comptées ici (elles bloquent en dur via isValid).
 * Le moteur préfère donc les éviter, sans jamais les rendre obligatoires.
 *
 * @returns somme des pénalités (0 = aucune règle molle violée)
 */
// ── Limite de charge réglable (brique `au_plus_n`) ───────────
// « au plus N gardes par fenêtre » (semaine civile par défaut, ou glissante de
// K jours). Réglable par cabinet (dur si étage ≤ 2, sinon pénalité). Compte les
// gardes DÉJÀ posées dans la fenêtre (planning partiel) : poser ce créneau ferait
// dejaCount + 1 → viole si ça dépasse N. Filtre optionnel par type de créneau.

/** Fenêtre [debut, fin] (ISO) selon la config : semaine civile ou glissante_K_jours. */
function fenetreAuPlusN(slotDate: string, cfg: Record<string, unknown>): { debut: string; fin: string } {
  const f = cfg.fenetre
  if (typeof f === 'string') {
    const m = f.match(/^glissante_(\d+)_jours$/)
    if (m) {
      const k = parseInt(m[1], 10)
      return { debut: addDays(slotDate, -(k - 1)), fin: slotDate }
    }
  }
  // Défaut : semaine civile (lundi → dimanche).
  const lundi = lundiDeSemaine(slotDate)
  return { debut: lundi, fin: addDays(lundi, 6) }
}

/** Compte les gardes d'un véto dans [debut, fin], filtrées par type si `creneaux` fourni. */
function compterGardesFenetre(
  vetId: string, planning: PlanningPartiel, debut: string, fin: string, creneaux?: string[],
): number {
  let n = 0
  for (const a of planning.attributions) {
    if (a.date < debut || a.date > fin) continue
    if (creneaux && !creneaux.includes(a.type)) continue
    if (estAttribue(a, vetId)) n++
  }
  return n
}

/** Lit les types de créneaux filtrés (axe `quoi`), ou undefined si pas de filtre. */
function lireCreneauxFiltre(cfg: Record<string, unknown>): string[] | undefined {
  const c = cfg.creneaux
  if (Array.isArray(c)) {
    const arr = c.filter((x): x is string => typeof x === 'string')
    return arr.length > 0 ? arr : undefined
  }
  return undefined
}

/** Poser `vet` sur `slot` dépasserait-il la limite N de cette contrainte ? */
function violeAuPlusN(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const cfg = c.config as Record<string, unknown>
  const nRaw = cfg.n
  const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
  if (!Number.isFinite(n) || n < 0) return false // mal configurée → inerte (jamais de crash)
  const creneaux = lireCreneauxFiltre(cfg)
  // Si un filtre de créneaux existe et que le créneau courant n'en fait pas partie,
  // la règle ne s'applique pas à ce slot.
  if (creneaux && !creneaux.includes(slot.type)) return false
  const { debut, fin } = fenetreAuPlusN(slot.date, cfg)
  const deja = compterGardesFenetre(vetId, planning, debut, fin, creneaux)
  return deja + 1 > n
}

function checkAuPlusN(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'au_plus_n') continue
    if (estDure(c) && violeAuPlusN(c, vet.id, slot, planning)) {
      const n = (c.config as Record<string, unknown>).n
      return invalid(`AU_PLUS_N : ${vet.prenom} dépasserait ${n} garde(s) sur la fenêtre`)
    }
  }
  return ok()
}

// ── Espacement minimal réglable (brique `espacement_min`) ────
// « au moins X jours entre deux gardes » d'un même véto. Réglable (dur ≤ 2,
// sinon pénalité). On compare la date du créneau visé aux gardes DÉJÀ posées.

/** Nombre de jours (absolu) entre deux dates ISO yyyy-MM-dd. */
function joursEntreDates(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00Z').getTime()
  const db = new Date(b + 'T12:00:00Z').getTime()
  return Math.round(Math.abs(db - da) / 86_400_000)
}

/** Poser `vet` sur `slot` violerait-il l'espacement minimal de cette contrainte ? */
function violeEspacementMin(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const cfg = c.config as Record<string, unknown>
  const eRaw = cfg.ecart_min_jours
  const ecart = typeof eRaw === 'number' ? eRaw : typeof eRaw === 'string' ? parseInt(eRaw, 10) : NaN
  if (!Number.isFinite(ecart) || ecart <= 0) return false // inerte si mal configurée
  for (const a of planning.attributions) {
    if (!estAttribue(a, vetId)) continue
    if (a.date === slot.date) continue // même jour : géré ailleurs (R21/effectif)
    if (joursEntreDates(a.date, slot.date) < ecart) return true
  }
  return false
}

function checkEspacementMin(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'espacement_min') continue
    if (estDure(c) && violeEspacementMin(c, vet.id, slot, planning)) {
      const e = (c.config as Record<string, unknown>).ecart_min_jours
      return invalid(`ESPACEMENT : ${vet.prenom} doit espacer ses gardes d'au moins ${e} jour(s)`)
    }
  }
  return ok()
}

// ── Fréquence des week-ends réglable (brique `espacement_weekend`) ──
// « au plus 1 garde de week-end toutes les N semaines » (= 1 WE sur N). Ne
// concerne QUE les créneaux `weekend` (le vendredi soir, lié au WE par R9, n'est
// pas compté ici). Deux gardes WE doivent être espacées d'au moins N semaines :
// on viole si une autre garde WE du véto est à moins de N×7 jours du slot visé.
// Réglable (dur si étage ≤ 2, sinon pénalité). N ≤ 1 ⇒ aucune contrainte (inerte).

function violeEspacementWeekend(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  if (slot.type !== 'weekend') return false // ne s'applique qu'aux week-ends
  const cfg = c.config as Record<string, unknown>
  const nRaw = cfg.n_semaines
  const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
  if (!Number.isFinite(n) || n <= 1) return false // n ≤ 1 ou mal configurée → inerte
  const seuil = n * 7
  for (const a of planning.attributions) {
    if (a.type !== 'weekend') continue
    if (!estAttribue(a, vetId)) continue
    if (a.date === slot.date) continue
    if (joursEntreDates(a.date, slot.date) < seuil) return true
  }
  return false
}

function checkEspacementWeekend(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'espacement_weekend') continue
    if (estDure(c) && violeEspacementWeekend(c, vet.id, slot, planning)) {
      const n = (c.config as Record<string, unknown>).n_semaines
      return invalid(`FREQ_WE : ${vet.prenom} ne doit pas faire plus d'un week-end toutes les ${n} semaines`)
    }
  }
  return ok()
}

// ── Cadencement « 1 WE sur N ancré » (brique `cadencement_weekend`, #20) ──
// À NE PAS confondre avec espacement_weekend (un ESPACEMENT). Ici c'est un
// CADENCEMENT ANCRÉ : les week-ends « du véto » sont ceux dont le samedi tombe
// à un multiple de N×7 jours d'une date d'ancrage (un samedi de référence),
// passé OU futur (arithmétique modulo SIGNÉE). Cas type : pompier volontaire de
// garde 1 WE sur 3 à dates fixes. Cycle CALENDAIRE STRICT — AUCUN recalage
// vacances (contrairement à l'indispo cyclique). Deux sens :
//   • interdit (cas pompier) : les WE DU CYCLE sont INTERDITS de garde véto ;
//     les autres WE restent libres → viole si le WE candidat est SUR le cycle.
//   • impose : les gardes WE du véto doivent tomber SUR le cycle (hors cycle =
//     violation) → viole si le WE candidat est HORS cycle. (Filtre de POSITION,
//     n'oblige pas à poser à chaque WE du cycle.)
// La brique juge le SLOT candidat par rapport à l'ancre SEULE : elle ne lit pas
// le planning (indépendante du lookback #17 par construction — l'ancrage absolu
// rend le cadencement stable à travers les périodes). Étage ≤ 2 = dur, sinon
// pénalité. Params invalides (n<2, ancre non-date, sens inconnu) → INERTE.

/** Ramène une date au SAMEDI de sa semaine (imite le recalage d'estSemaineImpaireAncrée
 *  sans recalage vacances). Réutilise le helper `samediDeSemaine` du moteur. */
function samediAncre(date: string): string {
  return samediDeSemaine(date)
}

/** Le samedi `sam` appartient-il au cycle « 1 sur N » ancré sur `ancreSam` ?
 *  (différence en semaines multiple de N — modulo signé, passé ou futur). */
function estWeekendDuCycle(sam: string, ancreSam: string, n: number): boolean {
  const ms =
    new Date(sam + 'T12:00:00Z').getTime() -
    new Date(ancreSam + 'T12:00:00Z').getTime()
  const semaines = Math.round(ms / (7 * 24 * 60 * 60 * 1000))
  // Modulo positif (JS `%` garde le signe du dividende) → phase correcte des 2 côtés.
  return ((semaines % n) + n) % n === 0
}

/** Poser `vet` sur `slot` violerait-il un cadencement de week-end ? */
function violeCadencementWeekend(c: ContrainteEngine, slot: SlotGarde): boolean {
  if (slot.type !== 'weekend') return false // ne s'applique qu'aux week-ends
  const cfg = c.config as Record<string, unknown>
  const nRaw = cfg.n_semaines
  const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
  if (!Number.isFinite(n) || n < 2) return false // inerte (n < 2 = pas un cycle)
  const ancre = cfg.ancre
  // Ancre = une vraie date ISO. Non-date → inerte (jamais de crash).
  if (typeof ancre !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ancre)) return false
  if (Number.isNaN(new Date(ancre + 'T12:00:00Z').getTime())) return false
  const sens = cfg.sens
  if (sens !== 'interdit' && sens !== 'impose') return false // sens inconnu → inerte

  // Le WE est daté du SAMEDI ; l'ancre est ramenée au samedi de sa semaine.
  const surCycle = estWeekendDuCycle(slot.date, samediAncre(ancre), n)
  // interdit : violer si SUR le cycle (le véto est déjà pris ailleurs).
  // impose   : violer si HORS du cycle (ses gardes WE doivent y tomber).
  return sens === 'interdit' ? surCycle : !surCycle
}

function checkCadencementWeekend(vet: VetEngine, slot: SlotGarde): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'cadencement_weekend') continue
    if (estDure(c) && violeCadencementWeekend(c, slot)) {
      const cfg = c.config as Record<string, unknown>
      const n = cfg.n_semaines
      return cfg.sens === 'impose'
        ? invalid(`CADENCE_WE : le week-end de garde de ${vet.prenom} doit tomber sur son cycle (1 sur ${n})`)
        : invalid(`CADENCE_WE : ${vet.prenom} est indisponible ce week-end (cycle 1 sur ${n})`)
    }
  }
  return ok()
}

// ── Successions / séries / repos avancés (Vague 5 tranche B — #13) ──
// Trois briques de RYTHME de la famille `sequence`, toutes par-véto et réglables
// (dur si étage ≤ 2, sinon pénalité). Elles raisonnent en JOURS CIVILS COUVERTS :
// le créneau `weekend` est daté du SAMEDI mais couvre sam+dim → le « lendemain »
// d'un week-end est le lundi. On ré-utilise donc partout `joursCouvertsGarde`
// (miroir de syncAttributions.joursImpactesGarde, étendu au dimanche du WE).
//
// SYMÉTRIE (leçon solver : WE posés AVANT les soirs de semaine) : chaque prédicat
// juge le candidat contre les gardes déjà posées AVANT ET APRÈS lui dans le
// temps. En phase candidat on répond « si j'ajoute cette garde, la contrainte
// tient-elle ? » — on inclut donc virtuellement les jours du slot visé.
//
// Vue étendue (#17) : ces prédicats reçoivent le `planning` DÉJÀ enrichi du
// lookback inter-périodes (cf. isValid / penaliteContraintesConfig) → une série
// entamée en fin de période précédente compte.

/**
 * Jours civils COUVERTS par une garde `type` datée `date`.
 * `weekend` (daté du samedi) couvre samedi + dimanche ; tout autre type = 1 jour.
 * Miroir de `syncAttributions.joursImpactesGarde` (qui, lui, ne renvoie que
 * [vendredi, samedi] pour l'agenda) — ici c'est la couverture RÉELLE de présence
 * de garde (sam+dim), ce qui importe pour succession/série/repos.
 */
function joursCouvertsGarde(date: string, type: string): string[] {
  return type === 'weekend' ? [date, addDays(date, 1)] : [date]
}

/**
 * Tous les jours civils où `vetId` est de garde dans `planning` (dépliés :
 * un week-end compte samedi ET dimanche). Set trié pour un balayage déterministe.
 */
function joursDeGardeVet(vetId: string, planning: PlanningPartiel): Set<string> {
  const jours = new Set<string>()
  for (const a of planning.attributions) {
    if (!estAttribue(a, vetId)) continue
    for (const j of joursCouvertsGarde(a.date, a.type)) jours.add(j)
  }
  return jours
}

// ── succession_interdite ─────────────────────────────────────
// « pas de garde de type B le lendemain d'une garde de type A » (par véto).
// Sémantique JOUR CIVIL : A le jour J, B le jour J+1 → violation. Le « lendemain »
// d'un weekend (daté samedi, fin = dimanche) est donc le LUNDI (J+2 depuis samedi).
// Symétrique : on vérifie si le candidat (B) suit un A déjà posé, ET si le candidat
// (A) précède un B déjà posé.

/** Poser `vet` sur `slot` créerait-il une succession interdite (dans un sens ou l'autre) ? */
function violeSuccessionInterdite(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const cfg = c.config as Record<string, unknown>
  const typeAvant = cfg.type_avant
  const typeApres = cfg.type_apres
  if (typeof typeAvant !== 'string' || typeof typeApres !== 'string') return false // inerte
  if (typeAvant === '' || typeApres === '') return false

  const joursSlot = joursCouvertsGarde(slot.date, slot.type)
  const premierJourSlot = joursSlot[0]
  const dernierJourSlot = joursSlot[joursSlot.length - 1]

  for (const a of planning.attributions) {
    if (a.date === slot.date && a.type === slot.type) continue // le slot lui-même
    if (!estAttribue(a, vetId)) continue
    const joursA = joursCouvertsGarde(a.date, a.type)
    const premierJourA = joursA[0]
    const dernierJourA = joursA[joursA.length - 1]

    // Cas 1 : le CANDIDAT est le « après » (type B), l'autre garde est un « avant » (type A).
    //   lendemain de la FIN de A == début du candidat ?
    if (slot.type === typeApres && a.type === typeAvant) {
      if (addDays(dernierJourA, 1) === premierJourSlot) return true
    }
    // Cas 2 : le CANDIDAT est l'« avant » (type A), l'autre garde est un « après » (type B).
    //   lendemain de la FIN du candidat == début de B ?
    if (slot.type === typeAvant && a.type === typeApres) {
      if (addDays(dernierJourSlot, 1) === premierJourA) return true
    }
  }
  return false
}

function checkSuccessionInterdite(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'succession_interdite') continue
    if (estDure(c) && violeSuccessionInterdite(c, vet.id, slot, planning)) {
      const cfg = c.config as Record<string, unknown>
      return invalid(
        `SUCCESSION : ${vet.prenom} ne peut pas enchaîner « ${cfg.type_apres} » juste après « ${cfg.type_avant} »`,
      )
    }
  }
  return ok()
}

// ── serie_max ────────────────────────────────────────────────
// « jamais plus de N jours de garde d'affilée » (stretch borné). Jours consécutifs
// = dates civiles adjacentes (weekend = 2 jours). Filtre optionnel `creneaux` :
// on ne compte que les jours issus des types listés (absent = tous). Poser le
// candidat créerait-il une série (maximale, autour du candidat) de plus de N jours ?

/** Longueur de la plus longue série de jours consécutifs contenant `pivot` dans `jours`. */
function longueurSerieAutour(pivot: string, jours: Set<string>): number {
  if (!jours.has(pivot)) return 0
  let n = 1
  let d = addDays(pivot, -1)
  while (jours.has(d)) { n++; d = addDays(d, -1) }
  d = addDays(pivot, 1)
  while (jours.has(d)) { n++; d = addDays(d, 1) }
  return n
}

/** Poser `vet` sur `slot` créerait-il une série de plus de N jours d'affilée ? */
function violeSerieMax(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const cfg = c.config as Record<string, unknown>
  const nRaw = cfg.n_jours
  const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
  if (!Number.isFinite(n) || n <= 0) return false // n ≤ 0 ou mal configurée → inerte
  const creneaux = lireCreneauxFiltre(cfg)
  // Filtre : le slot visé doit lui-même être compté, sinon poser ce slot ne peut
  // pas allonger une série de types comptés.
  if (creneaux && !creneaux.includes(slot.type)) return false

  // Jours de garde du véto (filtrés par type si demandé) + les jours du candidat.
  const jours = new Set<string>()
  for (const a of planning.attributions) {
    if (a.date === slot.date && a.type === slot.type) continue
    if (!estAttribue(a, vetId)) continue
    if (creneaux && !creneaux.includes(a.type)) continue
    for (const j of joursCouvertsGarde(a.date, a.type)) jours.add(j)
  }
  const joursSlot = joursCouvertsGarde(slot.date, slot.type)
  for (const j of joursSlot) jours.add(j)

  // Série maximale contenant le premier jour du candidat (les jours du candidat
  // sont contigus par construction — WE = sam+dim adjacents).
  return longueurSerieAutour(joursSlot[0], jours) > n
}

function checkSerieMax(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'serie_max') continue
    if (estDure(c) && violeSerieMax(c, vet.id, slot, planning)) {
      const n = (c.config as Record<string, unknown>).n_jours
      return invalid(`SERIE_MAX : ${vet.prenom} ne peut pas faire plus de ${n} jour(s) de garde d'affilée`)
    }
  }
  return ok()
}

// ── repos_apres_serie ────────────────────────────────────────
// « après N gardes consécutives (jours d'affilée), imposer M jours sans garde ».
// Une série d'AU MOINS N jours (une série de MOINS de N n'impose rien) doit être
// suivie d'au moins M jours sans garde : les M jours qui suivent la FIN d'un
// stretch maximal de ≥ N jours doivent être libres. On juge autour du candidat :
// il peut être la garde de trop dans la fenêtre de repos due à un stretch antérieur,
// OU il peut clore/allonger un stretch qui impose un repos violé par une garde
// postérieure déjà posée. Balayer TOUS les stretches (planning partiel borné)
// couvre les deux sens sans threading d'ordre de pose.

/** Poser `vet` sur `slot` violerait-il un repos dû après une série de ≥ N jours ? */
function violeReposApresSerie(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const cfg = c.config as Record<string, unknown>
  const nRaw = cfg.n_jours
  const mRaw = cfg.repos_jours
  const n = typeof nRaw === 'number' ? nRaw : typeof nRaw === 'string' ? parseInt(nRaw, 10) : NaN
  const m = typeof mRaw === 'number' ? mRaw : typeof mRaw === 'string' ? parseInt(mRaw, 10) : NaN
  if (!Number.isFinite(n) || n <= 0) return false // inerte
  if (!Number.isFinite(m) || m <= 0) return false // pas de repos exigé → inerte

  // Ensemble des jours de garde AVEC le candidat inclus.
  const jours = joursDeGardeVet(vetId, planning)
  const joursSlot = joursCouvertsGarde(slot.date, slot.type)
  for (const j of joursSlot) jours.add(j)

  // Toute FIN de stretch maximal (jour de garde dont le lendemain est libre) de
  // longueur ≥ N impose que les M jours suivants soient libres. Le jour F+1 l'est
  // par définition (fin maximale) ; une garde à F+2..F+M (avec un TROU en F+1)
  // viole le repos. On repère donc une garde dans (F, F+M] APRÈS le trou.
  for (const fin of jours) {
    if (jours.has(addDays(fin, 1))) continue // pas une fin de stretch maximal
    let len = 1
    let d = addDays(fin, -1)
    while (jours.has(d)) { len++; d = addDays(d, -1) }
    if (len < n) continue // série trop courte → aucun repos imposé
    // Fenêtre de repos : F+1 … F+M. Une garde y tombe → violation.
    for (let k = 1; k <= m; k++) {
      if (jours.has(addDays(fin, k))) return true
    }
  }
  return false
}

function checkReposApresSerie(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'repos_apres_serie') continue
    if (estDure(c) && violeReposApresSerie(c, vet.id, slot, planning)) {
      const cfg = c.config as Record<string, unknown>
      return invalid(
        `REPOS_SERIE : ${vet.prenom} doit avoir au moins ${cfg.repos_jours} jour(s) de repos après ${cfg.n_jours} jour(s) de garde d'affilée`,
      )
    }
  }
  return ok()
}

// ── exclusion_dates — XOR « pas les deux » (Vague 6 tranche B — #15a) ────────
// Règle PAR-VÉTO : le véto ne peut être de garde À LA FOIS sur les deux cibles.
// Sémantique FIGÉE « pas les DEUX » (jamais « exactement une »). Deux formes,
// une seule par règle :
//   • fetes : ['noel','nouvel_an'] — paire de codes fête. Pour CHAQUE année
//     couverte, exclusion entre une instance de la 1re fête et de la 2e fête DE
//     LA MÊME ANNÉE (convention d'année portée par feteDeDate via
//     fetesCouvertesParSlot — un slot weekend daté du samedi couvre sam+dim).
//   • dates : ['YYYY-MM-DD','YYYY-MM-DD'] — paire de dates ISO. Exclusion « au
//     sens jours couverts » : on réutilise joursCouvertsGarde (WE = sam+dim).
// Le prédicat regarde le slot candidat + les gardes DÉJÀ posées du véto (comme
// au_plus_n) : « si j'ajoute cette garde, le véto couvre-t-il les DEUX cibles ? »
// INTRA-PÉRIODE (pas de lookback #17). Mal configurée → INERTE.

/** Lit la paire de codes fête (exactement 2, distinctes) ou null. */
function lirePaireFetes(cfg: Record<string, unknown>): [string, string] | null {
  const f = cfg.fetes
  if (!Array.isArray(f) || f.length !== 2) return null
  const [a, b] = f
  if (typeof a !== 'string' || typeof b !== 'string') return null
  if (a !== 'noel' && a !== 'nouvel_an') return null
  if (b !== 'noel' && b !== 'nouvel_an') return null
  if (a === b) return null // paire identique → inerte
  return [a, b]
}

/** Lit la paire de dates ISO (exactement 2, distinctes, bien formées) ou null. */
function lirePaireDates(cfg: Record<string, unknown>): [string, string] | null {
  const d = cfg.dates
  if (!Array.isArray(d) || d.length !== 2) return null
  const [a, b] = d
  if (typeof a !== 'string' || typeof b !== 'string') return null
  const isISO = (x: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(x + 'T12:00:00Z').getTime())
  if (!isISO(a) || !isISO(b)) return null
  if (a === b) return null // paire identique → inerte
  return [a, b]
}

/** Poser `vet` sur `slot` ferait-il couvrir au véto LES DEUX cibles d'une règle XOR ? */
function violeExclusionDates(
  c: ContrainteEngine, vetId: string, slot: SlotGarde, planning: PlanningPartiel,
): boolean {
  const cfg = c.config as Record<string, unknown>

  // ── Forme FÊTES : « pas Noël ET Nouvel An la même année » ──
  const fetes = lirePaireFetes(cfg)
  if (fetes) {
    // Instances de fête couvertes par le slot candidat (fête → set d'années).
    const parFeteCandidat = new Map<string, Set<number>>()
    for (const inst of fetesCouvertesParSlot(slot.date, slot.type)) {
      if (inst.fete !== fetes[0] && inst.fete !== fetes[1]) continue
      const s = parFeteCandidat.get(inst.fete) ?? new Set<number>()
      s.add(inst.annee)
      parFeteCandidat.set(inst.fete, s)
    }
    if (parFeteCandidat.size === 0) return false // le candidat ne touche aucune des 2 fêtes
    // Le candidat couvre-t-il À LUI SEUL les deux fêtes de la même année ?
    // (Impossible avec les fêtes actuelles — ≥ 6 jours d'écart — mais le
    // validateur juge « jours couverts par le planning » : miroir obligatoire
    // pour que les deux gardiens restent d'accord si le référentiel s'étend.)
    const annees0 = parFeteCandidat.get(fetes[0])
    const annees1 = parFeteCandidat.get(fetes[1])
    if (annees0 && annees1) {
      for (const an of annees0) if (annees1.has(an)) return true
    }
    // L'AUTRE fête est-elle déjà couverte par une garde du véto, la MÊME année ?
    for (const a of planning.attributions) {
      if (a.date === slot.date && a.type === slot.type) continue // le slot lui-même
      if (!estAttribue(a, vetId)) continue
      for (const inst of fetesCouvertesParSlot(a.date, a.type)) {
        if (inst.fete !== fetes[0] && inst.fete !== fetes[1]) continue
        // Cherche l'AUTRE fête de la paire, sur la même année, côté candidat.
        const autre = inst.fete === fetes[0] ? fetes[1] : fetes[0]
        if (parFeteCandidat.get(autre)?.has(inst.annee)) return true
      }
    }
    return false
  }

  // ── Forme DATES libres : « pas le 24 ET le 31 » (jours couverts) ──
  const dates = lirePaireDates(cfg)
  if (dates) {
    const joursCandidat = new Set(joursCouvertsGarde(slot.date, slot.type))
    const candidatCouvre = (d: string) => joursCandidat.has(d)
    // Quelles cibles le candidat couvre-t-il ?
    const cible0 = candidatCouvre(dates[0])
    const cible1 = candidatCouvre(dates[1])
    if (!cible0 && !cible1) return false // le candidat ne touche aucune des 2 dates
    // Le candidat couvre-t-il À LUI SEUL les deux dates ? (ex. paire samedi +
    // dimanche du même week-end : un seul slot `weekend` couvre les deux.)
    // Sans ce refus, le moteur poserait la garde et le validateur — qui juge
    // les jours couverts du planning FINAL — crierait une violation fantôme
    // au gate de publication (désaccord des deux gardiens).
    if (cible0 && cible1) return true
    // L'autre cible est-elle déjà couverte par une garde existante du véto ?
    for (const a of planning.attributions) {
      if (a.date === slot.date && a.type === slot.type) continue // le slot lui-même
      if (!estAttribue(a, vetId)) continue
      const jours = new Set(joursCouvertsGarde(a.date, a.type))
      if (cible0 && jours.has(dates[1])) return true
      if (cible1 && jours.has(dates[0])) return true
    }
    return false
  }

  return false // aucune forme valide → inerte
}

function checkExclusionDates(vet: VetEngine, slot: SlotGarde, planning: PlanningPartiel): ValidationResult {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'exclusion_dates') continue
    if (estDure(c) && violeExclusionDates(c, vet.id, slot, planning)) {
      return invalid(
        `XOR_DATES : ${vet.prenom} ne peut pas être de garde à la fois sur les deux dates/fêtes exclusives`,
      )
    }
  }
  return ok()
}

// ── seulement_avec — garde conditionnelle ORIENTÉE (Vague 6 tranche C — #15b) ──
// « A seulement si B est de garde sur le MÊME créneau ». Jugée à la POSE
// COMPLÉTANTE (gabarit composition_equipe) : à la pose qui complète l'équipe
// d'un slot ciblé, si A est présent sans B → refus. Slot 1 place → A refusé
// (B ne peut pas y être). ORIENTÉE : le prédicat ne se déclenche que quand on
// pose A (le porteur) ; B reste libre d'être de garde sans A. Souple → pénalité.

function checkSeulementAvec(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  planning: PlanningPartiel,
  allVets: VetEngine[],
): ValidationResult {
  // Pas de Map pré-construite : isValid est le chemin le plus chaud du moteur
  // (LNS) — le prénom de B n'est résolu (find O(n)) qu'en cas de refus.
  const raison = raisonSeulementAvecDur(vet, slot, roleVisé, planning, allVets)
  return raison ? invalid(raison) : ok()
}

export function penaliteContraintesConfig(
  slot: SlotGarde,
  vet: VetEngine,
  _role: RoleGarde,
  planning: PlanningPartiel,
  calendrier?: CalendrierResolu,
  // #17 — même lookback que isValid : les variantes MOLLES des règles de rythme
  // doivent aussi voir la jonction de périodes (les deux gardiens de score restent
  // cohérents). Absent/vide → byte-identique.
  contexteAnterieur?: AttributionGarde[],
): number {
  // Vue étendue pour les seules règles de rythme (cf. isValid). Les règles
  // non-rythme (repos fixe, indispo cyclique, duo) gardent le planning courant.
  const planningRythme = attributionsAvecContexte(planning, contexteAnterieur)
  let pen = 0
  for (const c of vet.contraintes) {
    if (!c.actif || estDure(c)) continue // dur → géré par isValid
    let viole = false
    switch (c.type) {
      case 'jour_repos_fixe':
        viole = violeReposFixe(c, slot, calendrier); break
      case 'indisponibilite_cyclique':
        viole = violeIndispoCyclique(c, slot, calendrier); break
      case 'jour_repos_conditionnel':
        viole = violeReposConditionnel(c, vet, slot, planningRythme); break
      case 'duo_interdit':
        viole = violeDuoInterdit(c, slot, planning) !== null; break
      case 'au_plus_n':
        viole = violeAuPlusN(c, vet.id, slot, planningRythme); break
      case 'espacement_min':
        viole = violeEspacementMin(c, vet.id, slot, planningRythme); break
      case 'espacement_weekend':
        viole = violeEspacementWeekend(c, vet.id, slot, planningRythme); break
      // Cadencement « 1 WE sur N ancré » (#20) : jugé sur l'ancre, sans planning.
      case 'cadencement_weekend':
        viole = violeCadencementWeekend(c, slot); break
      // Successions / séries / repos avancés (#13) — règles de RYTHME → vue étendue.
      case 'succession_interdite':
        viole = violeSuccessionInterdite(c, vet.id, slot, planningRythme); break
      case 'serie_max':
        viole = violeSerieMax(c, vet.id, slot, planningRythme); break
      case 'repos_apres_serie':
        viole = violeReposApresSerie(c, vet.id, slot, planningRythme); break
      // XOR « pas les deux » (#15a) : INTRA-PÉRIODE → planning courant (jamais le
      // lookback : le XOR ne se juge que sur la période en cours, par principe).
      case 'exclusion_dates':
        viole = violeExclusionDates(c, vet.id, slot, planning); break
    }
    if (viole) pen += penaliteEtage(etageDe(c))
  }
  return pen
}

// ── Point d'entrée principal ─────────────────────────────

/**
 * isValid — Vérifie si l'attribution d'un vétérinaire à un créneau est valide.
 *
 * @param slot       Le créneau de garde à vérifier
 * @param vet        Le vétérinaire à assigner
 * @param roleVisé   Le rôle dans ce créneau (premier ou second)
 * @param allVets    Tous les vétérinaires (pour R6)
 * @param planning   Le planning partiellement construit
 * @returns          { valid, raison?, warning? }
 */
export function isValid(
  slot: SlotGarde,
  vet: VetEngineNormalise,
  roleVisé: RoleGarde,
  allVets: VetEngineNormalise[],
  planning: PlanningPartiel,
  calendrier?: CalendrierResolu,
  structure: StructureConfig = DEFAULT_STRUCTURE_CONFIG,
  // #17 (Vague 5) — lookback inter-périodes : attributions FIGÉES de la fin de
  // la période précédente (~10 j). Absent/vide → comportement historique
  // (byte-identique). Consommé UNIQUEMENT par les règles de RYTHME ci-dessous
  // (R3, au_plus_n, espacement_min, espacement_weekend) via une vue étendue —
  // jamais par la couverture, l'équité, R21/R22, la composition, etc.
  contexteAnterieur?: AttributionGarde[],
): ValidationResult {
  // Relations entre créneaux liés (RG tranche 2) : la donnée si chargée,
  // sinon le couple historique vendredi↔WE — mêmes couples pour R8 et R9.
  const relations = relationsEffectives(structure)

  // Vue étendue = lookback + planning courant, POUR LES SEULES règles de rythme.
  // Absent/vide → identiquement `planning` (référence inchangée, byte-identique).
  const planningRythme = attributionsAvecContexte(planning, contexteAnterieur)

  const checks: ValidationResult[] = [
    checkR16Conge(vet, slot),
    checkR17Ete(slot, roleVisé),
    checkR18Hiver(slot, roleVisé, planning),
    checkR19Weekend(slot, roleVisé, planning),
    checkR1JourReposFixe(vet, slot, calendrier),
    checkR2IndispoCyclique(vet, slot, calendrier),
    // R3 (repos conditionnel) : « garde WE cette semaine ? » doit voir le WE du
    // lookback quand la semaine chevauche la jonction → planning ÉTENDU.
    checkR3ReposConditionnel(vet, slot, planningRythme),
    checkR6DuoInterdit(vet, slot, planning, allVets),
    checkR9VendrediLieWE(vet, slot, planning, structure.r9_liaison, relations),
    checkR21RolesDistincts(vet, slot, roleVisé, planning),
    checkR22UneGardeParJour(vet, slot, planning),
    // Rythme (fenêtres glissantes / espacements) : voient le lookback → étendu.
    checkAuPlusN(vet, slot, planningRythme),
    checkEspacementMin(vet, slot, planningRythme),
    checkEspacementWeekend(vet, slot, planningRythme),
    // Cadencement « 1 WE sur N ancré » (#20) : jugé par rapport à l'ancre SEULE
    // (pas le planning ni le lookback — l'ancrage absolu suffit).
    checkCadencementWeekend(vet, slot),
    // Successions / séries / repos avancés (#13) — règles de RYTHME → vue étendue.
    checkSuccessionInterdite(vet, slot, planningRythme),
    checkSerieMax(vet, slot, planningRythme),
    checkReposApresSerie(vet, slot, planningRythme),
    // XOR « pas les deux » (#15a) : INTRA-PÉRIODE → planning courant (JAMAIS le
    // lookback : le XOR ne se juge que sur la période en cours, par principe).
    checkExclusionDates(vet, slot, planning),
    // seulement_avec (#15b) : garde conditionnelle ORIENTÉE, jugée à la POSE
    // COMPLÉTANTE (nbPlaces threadé par le step) — dur seulement. Intra-période.
    checkSeulementAvec(vet, slot, roleVisé, planning, allVets),
    // R8 : ne s'applique que si slot.type est la CIBLE d'une relation
    // inversion_role (le check filtre lui-même — générique, plus de « WE only »).
    checkR8Inversion(vet, slot, roleVisé, planning, structure.r8_inversion, relations),
    // COMPOSITION (n°6) : équipe par tag — dur seulement (pose complétante).
    checkComposition(vet, slot, roleVisé, planning, structure, allVets),
    // ROLE_TAG (n°22) : rôle interdit selon attribut — dur seulement.
    checkRoleInterditTag(vet, slot, roleVisé, structure),
  ]

  // Renvoie la première contrainte violée
  for (const result of checks) {
    if (!result.valid) return result
  }

  // Toutes OK → renvoie warning si présent (dernier recours)
  const r7 = checkR7DernierRecours(vet)
  return r7
}

// Export des fonctions individuelles pour les tests
export {
  checkR1JourReposFixe,
  checkR2IndispoCyclique,
  checkR3ReposConditionnel,
  checkR6DuoInterdit,
  checkR7DernierRecours,
  checkR8Inversion,
  checkR9VendrediLieWE,
  checkR16Conge,
  checkR17Ete,
  checkR18Hiver,
  checkR19Weekend,
  checkR21RolesDistincts,
  checkR22UneGardeParJour,
  checkAuPlusN,
  checkEspacementMin,
  checkEspacementWeekend,
  checkCadencementWeekend,
  checkSuccessionInterdite,
  checkSerieMax,
  checkReposApresSerie,
  checkExclusionDates,
  checkSeulementAvec,
  checkComposition,
  checkRoleInterditTag,
}
