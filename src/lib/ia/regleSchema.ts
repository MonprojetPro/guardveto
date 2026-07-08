// ============================================================
// GUARDVETO — Assistant IA : schéma de proposition de règle (Palier 3, slice 1)
// ============================================================
// L'IA traduit une phrase en langage naturel → une PROPOSITION de règle
// structurée. Elle travaille en termes HUMAINS (prénoms, jours) ; le serveur
// résout ensuite en ids + valide via le `upsertRegle` existant (frontière de
// confiance inchangée). L'IA PROPOSE, l'humain DÉCIDE (manifeste éthique).
//
// Ce module est PUR (zod + conversion) → entièrement testable, AUCUN appel API.
// Il ne propose QUE les 6 briques évaluables par le moteur (anti-coquille-vide).
// ============================================================

import { z } from 'zod'
import type {
  BriqueEvaluable, ForceFormulaire, UpsertReglePayload,
  CompositionReglePayload, RoleInterditReglePayload,
} from '@/app/(protected)/regles/actions'
import { rendreRegle } from '@/engine/briques/catalogue'

/** Les briques que l'IA peut proposer (= évaluables par le moteur). */
export const BRIQUES_IA = [
  'interdire_creneau',
  'repos_conditionnel',
  'alternance_ancre',
  'duo_interdit',
  'au_plus_n',
  'espacement_min',
  'espacement_weekend',
  // Règles GLOBALES (pas de vétérinaire) — équipe par tag (n°6 + n°22).
  'composition_equipe',
  'role_interdit_tag',
  // Desiderata (n°7) — préférences positives par véto, toujours souples.
  'preferer_creneau',
  'preferer_avec',
  'volume_gardes',
  // Successions / séries / repos avancés (#13) — règles de rythme par véto.
  'succession_interdite',
  'serie_max',
  'repos_apres_serie',
  // Cadencement « 1 WE sur N ancré » (#20) — par véto (cas pompier volontaire).
  'cadencement_weekend',
  // Exclusion « pas les deux » (Vague 6 tranche B — #15a) — par véto (XOR fêtes/dates).
  'exclusion_dates',
  // Équité par COHORTE de tag (Vague 6 tranche A — #21) — règle GLOBALE.
  'equilibrer',
] as const

/** Dimensions d'équité proposables par l'IA (miroir de EQUITY_DIMENSIONS). */
export const DIMENSIONS_EQUITE_IA = [
  'weekend', 'weekend_premier', 'ferie',
  'semaine_premier', 'semaine_second', 'grands_weekend',
] as const

export const FORCES_IA = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const

/**
 * Schéma de la proposition produite par l'IA (sortie structurée).
 * Tous les params sont optionnels (l'IA ne remplit que ceux de la brique
 * choisie) ; la validation métier STRICTE reste côté serveur (construireParams).
 */
export const PropositionRegleSchema = z.object({
  /** Ce que l'IA a compris de la demande, reformulé en français. */
  comprehension: z.string(),
  /** true si la demande se traduit en une brique disponible. */
  faisable: z.boolean(),
  /**
   * Message à l'utilisateur : explication, demande de précision si ambigu, ou
   * raison si non faisable (ex. « cette contrainte n'est pas gérable »).
   */
  message: z.string(),
  /** Prénom du vétérinaire concerné (tel qu'écrit dans la liste fournie). */
  veterinaire: z.string().nullable(),
  brique_id: z.enum(BRIQUES_IA).nullable(),
  force: z.enum(FORCES_IA).nullable(),
  // ── Paramètres (selon la brique) ───────────────────────────
  jour: z.string().nullable(),
  exception_vacances_scolaires: z.boolean().nullable(),
  si_garde_we: z.string().nullable(),
  sinon: z.string().nullable(),
  semaines: z.enum(['paires', 'impaires', 'toutes']).nullable(),
  periodes: z.array(z.enum(['soir_semaine', 'weekend'])).nullable(),
  /** Prénom du second vétérinaire (duo interdit). */
  partenaire: z.string().nullable(),
  n: z.number().int().nullable(),
  fenetre: z.enum(['semaine_civile', 'glissante_7_jours', 'glissante_14_jours', 'glissante_30_jours']).nullable(),
  /** au_plus_n : filtre optionnel par types de créneaux du cabinet (n°19).
   *  Codes EXACTS fournis dans le prompt (référentiel dynamique du cabinet).
   *  null / vide = toutes les gardes comptent. */
  creneaux: z.array(z.string()).nullable(),
  ecart_min_jours: z.number().int().nullable(),
  /** espacement_weekend : « au plus 1 week-end sur N » (N ≥ 2). */
  n_semaines: z.number().int().nullable(),
  /** composition_equipe : mode de la règle d'équipe (règle GLOBALE, n°6). */
  mode_composition: z.enum(['au_moins_un', 'pas_seuls']).nullable(),
  /** composition_equipe / role_interdit_tag : étiquette ciblée (parmi celles du cabinet). */
  tag: z.string().nullable(),
  /** role_interdit_tag : label du rôle interdit (parmi les rôles du cabinet, ex. premier). */
  role_interdit: z.string().nullable(),
  /** preferer_creneau : jours préférés (lundi..dimanche). */
  jours: z.array(z.enum(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'])).nullable(),
  /** volume_gardes : souhaite plus ou moins de gardes que la moyenne. */
  sens: z.enum(['plus', 'moins']).nullable(),
  /** succession_interdite (#13) : codes de créneaux « veille » et « lendemain interdit ». */
  type_avant: z.string().nullable(),
  type_apres: z.string().nullable(),
  /** serie_max / repos_apres_serie (#13) : longueur de série en jours. */
  n_jours: z.number().int().nullable(),
  /** repos_apres_serie (#13) : jours de repos imposés après la série. */
  repos_jours: z.number().int().nullable(),
  /** cadencement_weekend (#20) : date d'ancrage du cycle (un samedi, ISO yyyy-MM-dd). */
  ancre: z.string().nullable(),
  /** cadencement_weekend (#20) : sens du cadencement.
   *  interdit = WE du cycle interdits de garde (cas pompier) ;
   *  impose = gardes WE forcées sur le cycle. (n_semaines réutilisé pour le cycle N.) */
  sens_cadence: z.enum(['interdit', 'impose']).nullable(),
  /** exclusion_dates (#15a) : XOR « pas les deux ». UNE seule forme :
   *  fetes = paire de codes fête (noel/nouvel_an) ; dates = paire de dates ISO. */
  fetes: z.array(z.enum(['noel', 'nouvel_an'])).nullable(),
  dates: z.array(z.string()).nullable(),
  /** equilibrer (#21) : dimension d'équité à équilibrer sur la cohorte du tag. */
  dimension_equite: z.enum(DIMENSIONS_EQUITE_IA).nullable(),
  /** equilibrer (#21) : niveau d'importance de l'équilibrage (cohorte). */
  importance_equite: z.enum(['peu_important', 'normal', 'important', 'essentiel']).nullable(),
})

export type PropositionRegle = z.infer<typeof PropositionRegleSchema>

/** Vétérinaire minimal pour la résolution prénom → id. */
export interface VetoResolu {
  id: string
  prenom: string
}

/** Résultat de résolution d'un prénom : un id, ou la cause de l'échec. */
type ResolutionPrenom =
  | { ok: true; id: string }
  | { ok: false; cause: 'aucun' | 'ambigu' }

/**
 * Résout un prénom (insensible casse/espaces) vers un id de véto.
 * Distingue 0 match (`aucun`) de PLUSIEURS matchs (`ambigu`) : si deux vétos
 * portent le même prénom, on REFUSE de choisir au hasard (le mauvais véto
 * recevrait la règle silencieusement) — l'humain tranchera via le formulaire.
 */
function resoudrePrenom(prenom: string | null, vets: VetoResolu[]): ResolutionPrenom {
  if (!prenom) return { ok: false, cause: 'aucun' }
  const norm = prenom.trim().toLowerCase()
  const matchs = vets.filter((v) => v.prenom.trim().toLowerCase() === norm)
  if (matchs.length === 0) return { ok: false, cause: 'aucun' }
  if (matchs.length > 1) return { ok: false, cause: 'ambigu' }
  return { ok: true, id: matchs[0].id }
}

/** Message d'échec de résolution selon la cause (prénom utilisé dans le texte). */
function raisonPrenom(prenom: string | null, cause: 'aucun' | 'ambigu', second = false): string {
  const qui = second ? 'Second vétérinaire' : 'Vétérinaire'
  if (cause === 'ambigu') {
    return `Plusieurs vétérinaires s'appellent « ${prenom} » : l'assistant ne peut pas deviner lequel. Crée la règle via « Nouvelle règle » en sélectionnant le bon dans la liste.`
  }
  return `${qui} « ${prenom ?? '?'} » introuvable dans le cabinet.`
}

/** Tailles de fenêtre (jours) — un véto fait au plus 1 garde/jour, donc
 *  un plafond ≥ taille de fenêtre n'aura JAMAIS d'effet (= coquille vide). */
const TAILLE_FENETRE: Record<string, number> = {
  semaine_civile: 7,
  glissante_7_jours: 7,
  glissante_14_jours: 14,
  glissante_30_jours: 30,
}
/** Borne haute alignée sur le serveur (N_MAX_GARDES / ECART_MAX_JOURS). */
const N_MAX = 14
const ECART_MAX = 30
/** Fréquence WE « 1 sur N » : borne haute alignée sur le serveur (N_SEM_WE_MAX). */
const N_SEM_WE_MAX = 26
/** Séries / repos avancés (#13) : bornes hautes alignées sur le serveur. */
const SERIE_MAX_JOURS = 31
const REPOS_APRES_MAX = 30
/** Cadencement WE « 1 sur N » (#20) : bornes alignées sur le serveur. */
const N_SEM_CADENCE_MIN = 2
const N_SEM_CADENCE_MAX = 12

export type ConversionResultat =
  | { ok: true; payload: UpsertReglePayload }
  | { ok: false; raison: string }

/**
 * propositionVersPayload — convertit une proposition IA (termes humains) en
 * UpsertReglePayload (ids), PUR. Ne fait AUCUNE validation métier profonde :
 * c'est `upsertRegle`/`construireParams` (serveur) qui valide à la création.
 * Échoue seulement si la proposition est inexploitable (brique/véto manquants).
 */
export function propositionVersPayload(
  p: PropositionRegle,
  vets: VetoResolu[],
): ConversionResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en règle.' }
  if (!p.brique_id) return { ok: false, raison: 'Type de règle non déterminé par l’assistant.' }
  // Les règles GLOBALES (sans vétérinaire) ont leur propre conversion — cf.
  // propositionVersComposition / propositionVersRoleInterdit / propositionVersEquite.
  if (
    p.brique_id === 'composition_equipe' ||
    p.brique_id === 'role_interdit_tag' ||
    p.brique_id === 'equilibrer'
  ) {
    return { ok: false, raison: 'Règle globale : conversion dédiée (routage appelant).' }
  }

  const owner = resoudrePrenom(p.veterinaire, vets)
  if (!owner.ok) {
    return { ok: false, raison: raisonPrenom(p.veterinaire, owner.cause) }
  }

  // Force par défaut si l'IA n'en propose pas : la fréquence WE et les
  // desiderata (n°7) sont des PRÉFÉRENCES par défaut (ne jamais bloquer une
  // génération) ; un cadencement « interdit » (#20 : pompier réellement pris
  // ailleurs) est en revanche FERME par défaut ; les autres restent en sauf_crise.
  const DESIDERATA = new Set(['preferer_creneau', 'preferer_avec', 'volume_gardes'])
  const forceParDefaut: ForceFormulaire =
    p.brique_id === 'espacement_weekend' || DESIDERATA.has(p.brique_id)
      ? 'si_possible'
      : p.brique_id === 'cadencement_weekend' && p.sens_cadence === 'interdit'
        ? 'jamais'
        : 'sauf_crise'

  let force = (p.force ?? forceParDefaut) as ForceFormulaire
  // Desiderata : préférences PURES — « jamais » serait refusé par le serveur ;
  // on rétrograde au niveau souple le plus proche.
  if (DESIDERATA.has(p.brique_id) && force === 'jamais') force = 'sauf_crise'

  const payload: UpsertReglePayload = {
    brique_id: p.brique_id as BriqueEvaluable,
    owner_id: owner.id,
    force,
  }

  switch (p.brique_id) {
    case 'interdire_creneau':
      payload.jour = p.jour ?? undefined
      payload.exception_vacances_scolaires = p.exception_vacances_scolaires ?? false
      break
    case 'repos_conditionnel':
      payload.si_garde_we = p.si_garde_we ?? undefined
      payload.sinon = p.sinon ?? undefined
      break
    case 'alternance_ancre':
      payload.semaines = p.semaines ?? undefined
      payload.periodes = p.periodes ?? undefined
      break
    case 'duo_interdit': {
      const part = resoudrePrenom(p.partenaire, vets)
      if (!part.ok) {
        return { ok: false, raison: raisonPrenom(p.partenaire, part.cause, true) }
      }
      if (part.id === owner.id) {
        return { ok: false, raison: 'Un duo interdit doit concerner deux vétérinaires différents.' }
      }
      payload.avec_veterinaire_id = part.id
      break
    }
    case 'au_plus_n': {
      // Garde anti-coquille-vide : un plafond trop haut n'aurait aucun effet.
      // ⚠️ AUCUN chiffre affiché : le « réaliste » dépend du nb de gardes/jour
      //    que CHAQUE cabinet définit (ici borné à 1/jour → taille de fenêtre,
      //    et à la borne technique de stockage). Tant que la config cabinet
      //    n'expose pas ce nombre, on reste honnête : on dit « trop élevé »
      //    sans inventer un seuil métier. (cf. backlog plafonds config-cabinet)
      const n = p.n
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
        return { ok: false, raison: 'Indique un nombre de gardes valide (au moins 1).' }
      }
      const fenetre = p.fenetre ?? 'semaine_civile'
      const taille = TAILLE_FENETRE[fenetre] ?? 7
      if (n >= taille || n > N_MAX) {
        return { ok: false, raison: 'Ce plafond est trop élevé pour avoir un effet — indique un nombre plus petit.' }
      }
      payload.n = n
      payload.fenetre = fenetre
      // Filtre de créneaux (n°19) : codes proposés par l'IA depuis le
      // référentiel DU cabinet (prompt). La validation stricte des codes reste
      // côté serveur (upsertRegle) — frontière de confiance inchangée.
      const creneaux = (p.creneaux ?? []).filter(
        (x): x is string => typeof x === 'string' && x.trim() !== '',
      )
      if (creneaux.length > 0) payload.creneaux = [...new Set(creneaux)]
      break
    }
    case 'espacement_min': {
      const e = p.ecart_min_jours
      if (typeof e !== 'number' || !Number.isInteger(e) || e < 1 || e > ECART_MAX) {
        return { ok: false, raison: `Indique un écart minimal valide (entre 1 et ${ECART_MAX} jours).` }
      }
      payload.ecart_min_jours = e
      break
    }
    case 'espacement_weekend': {
      // « 1 week-end sur N » : N ≥ 2 (N=1 = tous les week-ends = aucune contrainte).
      const n = p.n_semaines
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 2 || n > N_SEM_WE_MAX) {
        return { ok: false, raison: `Précise une fréquence valide : un week-end sur 2 à ${N_SEM_WE_MAX}.` }
      }
      payload.n_semaines = n
      break
    }
    // ── Desiderata (n°7) — préférences positives ──
    case 'preferer_creneau': {
      const jours = [...new Set(p.jours ?? [])]
      const creneaux = [...new Set(
        (p.creneaux ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
      )]
      if (jours.length === 0 && creneaux.length === 0) {
        return { ok: false, raison: 'Précise au moins un jour ou un type de créneau préféré.' }
      }
      if (jours.length > 0) payload.jours = jours
      if (creneaux.length > 0) payload.creneaux = creneaux
      break
    }
    case 'preferer_avec': {
      const part = resoudrePrenom(p.partenaire, vets)
      if (!part.ok) {
        return { ok: false, raison: raisonPrenom(p.partenaire, part.cause, true) }
      }
      if (part.id === owner.id) {
        return { ok: false, raison: 'Le co-équipier préféré doit être un autre vétérinaire.' }
      }
      payload.avec_veterinaire_id = part.id
      break
    }
    case 'volume_gardes': {
      if (p.sens !== 'plus' && p.sens !== 'moins') {
        return { ok: false, raison: 'Précise le souhait : plus ou moins de gardes.' }
      }
      payload.sens = p.sens
      break
    }
    // ── Successions / séries / repos avancés (#13) ──
    case 'succession_interdite': {
      const avant = (p.type_avant ?? '').trim()
      const apres = (p.type_apres ?? '').trim()
      if (avant === '' || apres === '') {
        return { ok: false, raison: 'Précise le créneau de la veille et le créneau interdit le lendemain.' }
      }
      // La validité des CODES est re-vérifiée côté serveur (construireParams) —
      // frontière de confiance inchangée.
      payload.type_avant = avant
      payload.type_apres = apres
      break
    }
    case 'serie_max': {
      const n = p.n_jours
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SERIE_MAX_JOURS) {
        return { ok: false, raison: `Indique un nombre de jours d'affilée valide (entre 1 et ${SERIE_MAX_JOURS}).` }
      }
      payload.n_jours = n
      const creneaux = (p.creneaux ?? []).filter(
        (x): x is string => typeof x === 'string' && x.trim() !== '',
      )
      if (creneaux.length > 0) payload.creneaux = [...new Set(creneaux)]
      break
    }
    case 'repos_apres_serie': {
      const n = p.n_jours
      const repos = p.repos_jours
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SERIE_MAX_JOURS) {
        return { ok: false, raison: `Indique une longueur de série valide (entre 1 et ${SERIE_MAX_JOURS} jours).` }
      }
      if (typeof repos !== 'number' || !Number.isInteger(repos) || repos < 1 || repos > REPOS_APRES_MAX) {
        return { ok: false, raison: `Indique un nombre de jours de repos valide (entre 1 et ${REPOS_APRES_MAX}).` }
      }
      payload.n_jours = n
      payload.repos_jours = repos
      break
    }
    // ── Cadencement « 1 WE sur N ancré » (#20) ──
    case 'cadencement_weekend': {
      const n = p.n_semaines
      if (typeof n !== 'number' || !Number.isInteger(n) || n < N_SEM_CADENCE_MIN || n > N_SEM_CADENCE_MAX) {
        return { ok: false, raison: `Précise un cycle valide : un week-end sur ${N_SEM_CADENCE_MIN} à ${N_SEM_CADENCE_MAX}.` }
      }
      const ancre = (p.ancre ?? '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ancre) || Number.isNaN(new Date(ancre + 'T12:00:00Z').getTime())) {
        return { ok: false, raison: 'Précise la date de départ du cycle (un week-end de référence, ex. le samedi 5 septembre 2026).' }
      }
      if (p.sens_cadence !== 'interdit' && p.sens_cadence !== 'impose') {
        return { ok: false, raison: 'Précise si ces week-ends lui sont INTERDITS (engagement extérieur) ou si ses gardes DOIVENT tomber sur ce cycle.' }
      }
      payload.n_semaines = n
      payload.ancre = ancre
      payload.sens = p.sens_cadence
      break
    }
    // ── Exclusion « pas les deux » (#15a) ──
    case 'exclusion_dates': {
      // Forme FÊTES prioritaire (cas métier dominant : 24 XOR 31 déc).
      const fetes = [...new Set((p.fetes ?? []).filter(
        (x): x is 'noel' | 'nouvel_an' => x === 'noel' || x === 'nouvel_an',
      ))]
      if (fetes.length > 0) {
        if (fetes.length !== 2) {
          return { ok: false, raison: 'Précise les deux fêtes concernées (Noël et Nouvel An).' }
        }
        payload.fetes = fetes
        break
      }
      // Forme DATES libres.
      const isISO = (x: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(x + 'T12:00:00Z').getTime())
      const dates = (p.dates ?? []).filter((x): x is string => typeof x === 'string')
      if (dates.length !== 2 || !isISO(dates[0]) || !isISO(dates[1])) {
        return { ok: false, raison: 'Précise les deux dates à ne pas cumuler (ou dis « Noël et Nouvel An »).' }
      }
      if (dates[0] === dates[1]) {
        return { ok: false, raison: 'Les deux dates doivent être différentes.' }
      }
      payload.dates = [dates[0], dates[1]]
      break
    }
  }

  return { ok: true, payload }
}

export type ConversionCompositionResultat =
  | { ok: true; payload: CompositionReglePayload }
  | { ok: false; raison: string }

/**
 * propositionVersComposition — convertit une proposition `composition_equipe`
 * (règle GLOBALE : pas de vétérinaire nominal) en CompositionReglePayload.
 * `tagsEquipe` : étiquettes réellement portées par l'équipe (normalisées) —
 * anti-coquille-vide : un tag que personne ne porte est refusé ici (le serveur
 * re-vérifie à l'écriture, frontière de confiance inchangée).
 */
export function propositionVersComposition(
  p: PropositionRegle,
  tagsEquipe: string[],
): ConversionCompositionResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en règle.' }
  if (p.brique_id !== 'composition_equipe') {
    return { ok: false, raison: 'Type de règle non déterminé par l’assistant.' }
  }
  const mode = p.mode_composition
  if (mode !== 'au_moins_un' && mode !== 'pas_seuls') {
    return { ok: false, raison: 'Précise le sens de la règle : « toujours au moins un … » ou « … jamais seuls ».' }
  }
  const tag = (p.tag ?? '').trim().toLowerCase()
  if (tag === '') {
    return { ok: false, raison: 'Précise l’étiquette concernée (ex. junior, senior).' }
  }
  if (!tagsEquipe.includes(tag)) {
    return {
      ok: false,
      raison: `Aucun vétérinaire ne porte l'étiquette « ${tag} ». Ajoute-la d'abord sur les fiches concernées (page Équipe), puis reviens créer la règle.`,
    }
  }
  const creneaux = [...new Set(
    (p.creneaux ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  )]
  return {
    ok: true,
    payload: {
      mode,
      tag,
      ...(creneaux.length > 0 ? { creneaux } : {}),
      // Défaut FERME : « un junior jamais seul » est presque toujours une
      // exigence de sécurité, pas une préférence. L'admin ajuste avant création.
      force: (p.force ?? 'jamais') as ForceFormulaire,
    },
  }
}

export type ConversionRoleInterditResultat =
  | { ok: true; payload: RoleInterditReglePayload }
  | { ok: false; raison: string }

/**
 * propositionVersRoleInterdit — convertit une proposition `role_interdit_tag`
 * (« un junior jamais 1er ») en RoleInterditReglePayload. Mêmes gardes que la
 * composition : tag porté par l'équipe, rôle du catalogue du cabinet.
 */
export function propositionVersRoleInterdit(
  p: PropositionRegle,
  tagsEquipe: string[],
  rolesCabinet: string[],
): ConversionRoleInterditResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en règle.' }
  if (p.brique_id !== 'role_interdit_tag') {
    return { ok: false, raison: 'Type de règle non déterminé par l’assistant.' }
  }
  const tag = (p.tag ?? '').trim().toLowerCase()
  if (tag === '') {
    return { ok: false, raison: 'Précise l’étiquette concernée (ex. junior, senior).' }
  }
  if (!tagsEquipe.includes(tag)) {
    return {
      ok: false,
      raison: `Aucun vétérinaire ne porte l'étiquette « ${tag} ». Ajoute-la d'abord sur les fiches concernées (page Équipe), puis reviens créer la règle.`,
    }
  }
  const role = (p.role_interdit ?? '').trim()
  if (role === '' || !rolesCabinet.includes(role)) {
    return { ok: false, raison: 'Précise le rôle interdit (ex. 1er ou 2nd de garde).' }
  }
  const creneaux = [...new Set(
    (p.creneaux ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== ''),
  )]
  return {
    ok: true,
    payload: {
      tag,
      role,
      ...(creneaux.length > 0 ? { creneaux } : {}),
      // Défaut FERME : « un junior jamais 1er » = exigence de sécurité.
      force: (p.force ?? 'jamais') as ForceFormulaire,
    },
  }
}

/** Payload d'une cohorte d'équité (#21) — cible setCohorteEquite. */
export interface CohorteEquitePayload {
  dimension: string
  tag: string
  importance: string
}

export type ConversionEquiteResultat =
  | { ok: true; payload: CohorteEquitePayload }
  | { ok: false; raison: string }

/**
 * propositionVersEquite — convertit une proposition `equilibrer` (règle GLOBALE
 * d'équité par COHORTE de tag, #21) en CohorteEquitePayload. L'IA ne pilote
 * l'équité QUE par cohorte (dimension × tag) : l'équilibrage GLOBAL des 6
 * dimensions se règle aux menus (pas de valeur ajoutée IA). `tagsEquipe` : les
 * étiquettes réellement portées (anti-coquille-vide ; le serveur re-vérifie).
 */
export function propositionVersEquite(
  p: PropositionRegle,
  tagsEquipe: string[],
): ConversionEquiteResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en règle.' }
  if (p.brique_id !== 'equilibrer') {
    return { ok: false, raison: 'Type de règle non déterminé par l’assistant.' }
  }
  const dimension = p.dimension_equite
  if (!dimension) {
    return { ok: false, raison: 'Précise ce qu’il faut équilibrer (week-ends, fériés, soirs de semaine…).' }
  }
  const tag = (p.tag ?? '').trim().toLowerCase()
  if (tag === '') {
    return { ok: false, raison: 'Précise l’étiquette de la cohorte concernée (ex. junior, senior).' }
  }
  if (!tagsEquipe.includes(tag)) {
    return {
      ok: false,
      raison: `Aucun vétérinaire ne porte l'étiquette « ${tag} ». Ajoute-la d'abord sur les fiches concernées (page Équipe), puis reviens créer la règle.`,
    }
  }
  return {
    ok: true,
    payload: {
      dimension,
      tag,
      // Défaut « important » si l'IA n'a pas jugé le niveau (jamais « ignoree » :
      // une cohorte inerte n'a pas de sens à créer).
      importance: p.importance_equite ?? 'important',
    },
  }
}

/**
 * apercuProposition — rend la proposition en une phrase française (le même
 * rendu que la liste /regles), à partir des termes humains de la proposition.
 * Pur ; renvoie '' si la brique n'est pas déterminée.
 */
export function apercuProposition(p: PropositionRegle): string {
  if (!p.brique_id) return ''
  let params: Record<string, unknown> = {}
  switch (p.brique_id) {
    case 'interdire_creneau':
      params = { jour: p.jour, exception_vacances_scolaires: p.exception_vacances_scolaires ?? false }
      break
    case 'repos_conditionnel':
      params = { si_garde_we: p.si_garde_we, sinon: p.sinon }
      break
    case 'alternance_ancre':
      params = { semaines: p.semaines, periodes: p.periodes ?? [] }
      break
    case 'duo_interdit':
      // Le partenaire est un prénom : nomVeto le renvoie tel quel.
      params = { avec_veterinaire_id: p.partenaire }
      break
    case 'au_plus_n':
      params = { n: p.n, fenetre: p.fenetre, creneaux: p.creneaux ?? undefined }
      break
    case 'espacement_min':
      params = { ecart_min_jours: p.ecart_min_jours }
      break
    case 'espacement_weekend':
      params = { n_semaines: p.n_semaines }
      break
    case 'composition_equipe':
      params = { mode: p.mode_composition, tag: p.tag, creneaux: p.creneaux ?? undefined }
      break
    case 'role_interdit_tag':
      params = { tag: p.tag, role: p.role_interdit, creneaux: p.creneaux ?? undefined }
      break
    case 'preferer_creneau':
      params = { jours: p.jours ?? undefined, creneaux: p.creneaux ?? undefined }
      break
    case 'preferer_avec':
      // Le partenaire est un prénom : nomVeto le renvoie tel quel.
      params = { avec_veterinaire_id: p.partenaire }
      break
    case 'volume_gardes':
      params = { sens: p.sens }
      break
    case 'succession_interdite':
      params = { type_avant: p.type_avant, type_apres: p.type_apres }
      break
    case 'serie_max':
      params = { n_jours: p.n_jours, creneaux: p.creneaux ?? undefined }
      break
    case 'repos_apres_serie':
      params = { n_jours: p.n_jours, repos_jours: p.repos_jours }
      break
    case 'cadencement_weekend':
      params = { n_semaines: p.n_semaines, ancre: p.ancre, sens: p.sens_cadence }
      break
    case 'exclusion_dates':
      params = (p.fetes ?? []).length > 0
        ? { fetes: p.fetes }
        : { dates: p.dates ?? undefined }
      break
    case 'equilibrer':
      params = { dimension: p.dimension_equite, importance: p.importance_equite, tag: p.tag }
      break
  }
  const predicat = rendreRegle(p.brique_id, params, { nomVeto: (x) => x })
  // Règles GLOBALES (équipe + équité) : pas de sujet vétérinaire à préfixer.
  if (
    p.brique_id === 'composition_equipe' ||
    p.brique_id === 'role_interdit_tag' ||
    p.brique_id === 'equilibrer'
  ) return predicat
  return p.veterinaire ? `${p.veterinaire} ${predicat}` : predicat
}
