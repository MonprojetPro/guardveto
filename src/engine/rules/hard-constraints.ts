// ============================================================
// GUARDVETO — Contraintes dures (R1–R9, R16–R19)
// ============================================================

import type {
  VetEngine, SlotGarde, PlanningPartiel, ValidationResult, AttributionGarde,
} from '../types'
import {
  jourDeLaSemaine, estSemaineImpaire, estEnVacancesScolaires,
  estJourFerie, estEnEte, lundiDeSemaine, vendrediDeSemaine, samediDeSemaine, addDays,
} from '../utils'

// ── Helpers internes ────────────────────────────────────

function invalid(raison: string): ValidationResult {
  return { valid: false, raison }
}

function ok(warning?: string): ValidationResult {
  return { valid: true, warning }
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
function aGardeWeekendCetteSemaine(
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
  if (aWE?.premier_id === vetId || aWE?.second_id === vetId) return true
  // Vérifie aussi vendredi_soir (lié au même WE par R9)
  const ven = addDays(sam, -1)
  const aVen = getAttribution(planning, ven, 'vendredi_soir')
  return aVen?.premier_id === vetId || aVen?.second_id === vetId
}

/** Vérifie si le véto est déjà de garde vendredi soir cette semaine */
function aGardeVendrediSoir(
  vetId: string,
  date: string,
  planning: PlanningPartiel
): boolean {
  const ven = vendrediDeSemaine(date)
  const a = getAttribution(planning, ven, 'vendredi_soir')
  return a?.premier_id === vetId || a?.second_id === vetId
}

// ── Contraintes individuelles ────────────────────────────

/**
 * R1 — Jours de repos fixes
 * Vérifie les contraintes `jour_repos_fixe` actives du vétérinaire.
 */
function checkR1JourReposFixe(vet: VetEngine, slot: SlotGarde): ValidationResult {
  const jour = jourDeLaSemaine(slot.date)
  const contraintes = vet.contraintes.filter(
    (c) => c.actif && c.type === 'jour_repos_fixe'
  )

  for (const c of contraintes) {
    const cfg = c.config as Record<string, unknown>

    // Format simple : { jour, flexible_vacances }
    if (typeof cfg.jour === 'string') {
      if (cfg.jour !== jour) continue

      // Si flexible en vacances scolaires → autorisé pendant les vacances
      if (cfg.flexible_vacances && estEnVacancesScolaires(slot.date)) continue

      return invalid(
        `R1 : ${vet.prenom} a un jour de repos fixe le ${jour}`
      )
    }

    // Format avec tableau de règles (Anne-Sophie)
    if (Array.isArray(cfg.regles)) {
      type Regle = { jour: string; periode?: string; semaine?: string }
      for (const regle of cfg.regles as Regle[]) {
        if (regle.jour !== jour) continue
        if (regle.semaine === 'impaire' && !estSemaineImpaire(slot.date)) continue
        if (regle.semaine === 'paire' && estSemaineImpaire(slot.date)) continue
        return invalid(`R1 : ${vet.prenom} a un repos fixe le ${jour} cette semaine`)
      }
    }
  }

  return ok()
}

/**
 * R2 — Anne-So indisponible semaines impaires (soirs + WE)
 * S'applique via contrainte `indisponibilite_cyclique`.
 */
function checkR2IndispoCyclique(vet: VetEngine, slot: SlotGarde): ValidationResult {
  const contraintes = vet.contraintes.filter(
    (c) => c.actif && c.type === 'indisponibilite_cyclique'
  )

  for (const c of contraintes) {
    const cfg = c.config as Record<string, unknown>
    const semaines = cfg.semaines as string | undefined
    const periodes = (cfg.periodes ?? []) as string[]

    const concerneCetteSemaine =
      semaines === 'toutes' ||
      (semaines === 'impaires' && estSemaineImpaire(slot.date)) ||
      (semaines === 'paires' && !estSemaineImpaire(slot.date))

    if (!concerneCetteSemaine) continue

    const estSoir = slot.type === 'semaine_soir' || slot.type === 'vendredi_soir'
    const estWe = slot.type === 'weekend'

    if (periodes.includes('soir_semaine') && estSoir) {
      return invalid(`R2 : ${vet.prenom} est indisponible les soirs de semaine ${semaines}s`)
    }
    if (periodes.includes('weekend') && estWe) {
      return invalid(`R2 : ${vet.prenom} est indisponible les weekends ${semaines}s`)
    }
  }

  return ok()
}

/**
 * R3 — Repos conditionnel (si garde WE → jour A, sinon jour B)
 * Ex : Jean repos vendredi, SAUF si garde WE → mardi
 */
function checkR3ReposConditionnel(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel
): ValidationResult {
  const jour = jourDeLaSemaine(slot.date)
  const contraintes = vet.contraintes.filter(
    (c) => c.actif && c.type === 'jour_repos_conditionnel'
  )

  for (const c of contraintes) {
    const cfg = c.config as Record<string, unknown>
    const siGardeWe = cfg.si_garde_we as string | undefined
    const sinon = cfg.sinon as string | undefined

    // vendredi_soir EST une garde WE par définition (R9 lie ven soir + sam).
    // Si on évalue vendredi_soir, le samedi n'est pas encore planifié →
    // on considère gardeWe = true pour éviter de bloquer à tort.
    const gardeWe = slot.type === 'vendredi_soir'
      ? true
      : aGardeWeekendCetteSemaine(vet.id, slot.date, planning)

    if (gardeWe && siGardeWe === jour) {
      return invalid(`R3/R5 : ${vet.prenom} est en repos le ${jour} (garde WE cette semaine)`)
    }
    if (!gardeWe && sinon === jour) {
      return invalid(`R3/R5 : ${vet.prenom} est en repos le ${jour} (pas de garde WE cette semaine)`)
    }
  }

  return ok()
}

/**
 * R6 — Jamais Manon + Antoine seuls (duo_interdit)
 */
function checkR6DuoInterdit(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel,
  allVets: VetEngine[]
): ValidationResult {
  const contraintes = vet.contraintes.filter(
    (c) => c.actif && c.type === 'duo_interdit'
  )

  for (const c of contraintes) {
    const cfg = c.config as Record<string, unknown>
    const autreId = cfg.avec_veterinaire_id as string | undefined
    if (!autreId) continue

    // Vérifie si l'autre est déjà assigné à ce slot
    const attr = getAttribution(planning, slot.date, slot.type)
    if (!attr) continue

    const autreDejaAssigne = attr.premier_id === autreId || attr.second_id === autreId
    if (!autreDejaAssigne) continue

    // Vérifie s'il y a un 3e vétérinaire disponible (senior) dans ce slot
    // Pour un slot à 2 places, si l'autre est déjà là → c'est leur duo → interdit
    const autreVet = allVets.find((v) => v.id === autreId)
    return invalid(
      `R6 : ${vet.prenom} et ${autreVet?.prenom ?? '?'} ne peuvent pas être en duo seuls`
    )
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

/**
 * R8 — Inversion 1er/2nd entre vendredi soir et WE
 * Si le véto était 1er vendredi soir → doit être 2nd le WE (et inversement).
 */
function checkR8Inversion(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: 'premier' | 'second',
  planning: PlanningPartiel
): ValidationResult {
  if (slot.type !== 'weekend') return ok()

  const ven = vendrediDeSemaine(slot.date)
  const attrVen = getAttribution(planning, ven, 'vendredi_soir')
  if (!attrVen) return ok()

  const etait1erVen = attrVen.premier_id === vet.id
  const etait2ndVen = attrVen.second_id === vet.id

  // Inversion : 1er vendredi → 2nd WE / 2nd vendredi → 1er WE
  if (etait1erVen && roleVisé === 'premier') {
    return invalid(`R8 : ${vet.prenom} était 1er vendredi soir → doit être 2nd ce week-end`)
  }
  if (etait2ndVen && roleVisé === 'second') {
    return invalid(`R8 : ${vet.prenom} était 2nd vendredi soir → doit être 1er ce week-end`)
  }

  return ok()
}

/**
 * R9 — Vendredi soir lié au WE (même duo)
 * Les vétos du WE doivent être les mêmes que vendredi soir.
 */
function checkR9VendrediLieWE(
  vet: VetEngine,
  slot: SlotGarde,
  planning: PlanningPartiel
): ValidationResult {
  if (slot.type === 'weekend') {
    // Vérifie que le vendredi soir a déjà des assignations cohérentes
    const ven = vendrediDeSemaine(slot.date)
    const attrVen = getAttribution(planning, ven, 'vendredi_soir')
    if (!attrVen) return ok() // vendredi pas encore planifié → ok

    // Le véto doit être dans le duo du vendredi soir
    const dansVendredi = attrVen.premier_id === vet.id || attrVen.second_id === vet.id
    if (!dansVendredi) {
      return invalid(
        `R9 : ${vet.prenom} n'est pas dans le duo du vendredi soir — le WE doit avoir les mêmes vétérinaires`
      )
    }
  }

  if (slot.type === 'vendredi_soir') {
    // Vérifie la cohérence avec le WE si déjà planifié
    const sam = samediDeSemaine(slot.date)
    const attrWe = getAttribution(planning, sam, 'weekend')
    if (!attrWe) return ok()

    const dansWe = attrWe.premier_id === vet.id || attrWe.second_id === vet.id
    if (!dansWe) {
      return invalid(
        `R9 : ${vet.prenom} n'est pas dans le duo WE — le vendredi soir doit avoir les mêmes vétérinaires`
      )
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
 * R17 — Été : 1 seul de garde la nuit en semaine
 * En été, seul le "premier" existe pour les gardes de semaine.
 */
function checkR17Ete(slot: SlotGarde, roleVisé: 'premier' | 'second'): ValidationResult {
  if (slot.type === 'semaine_soir' && slot.saison === 'ete' && roleVisé === 'second') {
    return invalid('R17 : En été, une seule garde de nuit en semaine (pas de 2nd)')
  }
  return ok()
}

/**
 * R18 — Hiver : 2 de garde la nuit en semaine (1er + 2nd)
 * En hiver, les deux rôles doivent être pourvus.
 */
function checkR18Hiver(slot: SlotGarde, roleVisé: 'premier' | 'second', planning: PlanningPartiel): ValidationResult {
  if (slot.type !== 'semaine_soir' || slot.saison !== 'hiver') return ok()

  const attr = getAttribution(planning, slot.date, slot.type)
  // Si on assigne le 2nd mais qu'il n'y a pas de 1er → invalide
  if (roleVisé === 'second' && attr && !attr.premier_id) {
    return invalid('R18 : En hiver, le 1er de garde doit être désigné avant le 2nd')
  }
  return ok()
}

/**
 * R19 — WE : toujours 2 de garde
 * Un weekend nécessite toujours un 1er et un 2nd.
 */
function checkR19Weekend(slot: SlotGarde, roleVisé: 'premier' | 'second', planning: PlanningPartiel): ValidationResult {
  if (slot.type !== 'weekend') return ok()

  const attr = getAttribution(planning, slot.date, slot.type)
  if (roleVisé === 'second' && attr && !attr.premier_id) {
    return invalid('R19 : Le 1er de garde WE doit être désigné avant le 2nd')
  }
  return ok()
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
  vet: VetEngine,
  roleVisé: 'premier' | 'second',
  allVets: VetEngine[],
  planning: PlanningPartiel
): ValidationResult {
  const checks: ValidationResult[] = [
    checkR16Conge(vet, slot),
    checkR17Ete(slot, roleVisé),
    checkR18Hiver(slot, roleVisé, planning),
    checkR19Weekend(slot, roleVisé, planning),
    checkR1JourReposFixe(vet, slot),
    checkR2IndispoCyclique(vet, slot),
    checkR3ReposConditionnel(vet, slot, planning),
    checkR6DuoInterdit(vet, slot, planning, allVets),
    checkR9VendrediLieWE(vet, slot, planning),
  ]

  // R8 uniquement pour les WE
  if (slot.type === 'weekend') {
    checks.push(checkR8Inversion(vet, slot, roleVisé, planning))
  }

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
}
