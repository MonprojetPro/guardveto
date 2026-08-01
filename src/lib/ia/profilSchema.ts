// ============================================================
// GUARDVETO — Assistant IA : schéma de proposition de PROFIL (P5 slice 5)
// ============================================================
// L'IA traduit une phrase en langage naturel → une PROPOSITION de profil de
// planning. Elle travaille en termes HUMAINS (nom du profil, nom du profil
// source, horaires en HH:MM) ; le serveur résout ensuite et crée via les actions
// existantes (creerProfilComplet → RPC dupliquer_profil + setHoraires), qui
// restent la frontière de confiance. L'IA PROPOSE, l'humain DÉCIDE.
//
// Ce module est PUR (zod + conversion) → entièrement testable, AUCUN appel API.
//
// PÉRIMÈTRE (honnêteté end-to-end, miroir de admin/structure/actions.ts) :
// l'IA ne compose QUE des profils à partir des types de garde EXISTANTS. Elle ne
// peut PAS inventer un type inédit, monter à >2 vétos, ni changer jours/places/
// rôles (l'aval — gardes V1, agenda, PDF — ne saurait pas les persister → ce
// serait une coquille vide). Ces réglages s'ouvriront avec P3b/P6.
// ============================================================

import { z } from 'zod'

/** Les 4 types de garde horodatables (les seuls que l'aval sait persister). */
export const CODES_CRENEAU_IA = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie'] as const
export type CodeCreneauIa = (typeof CODES_CRENEAU_IA)[number]

/** 'HH:MM' 24h strict (miroir du serveur). */
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const OFFSET_MIN = 0
const OFFSET_MAX = 3

/** Libellé « en clair » d'un code (aperçu + messages). */
const LIBELLE_CODE: Record<string, string> = {
  semaine_soir: 'soir de semaine',
  vendredi_soir: 'vendredi soir',
  weekend: 'week-end',
  ferie: 'jour férié',
}
/** Jour de fin en clair (offset > 0). */
const OFFSET_CLAIR: Record<number, string> = {
  1: 'le lendemain', 2: 'le surlendemain', 3: 'trois jours après',
}

/**
 * Schéma de la proposition produite par l'IA (sortie structurée). L'IA remplit
 * `horaires` UNIQUEMENT pour les types qu'on veut explicitement changer ; sinon
 * null (le profil hérite alors des horaires de sa source).
 */
export const HoraireIaSchema = z.object({
  code: z.enum(CODES_CRENEAU_IA),
  heure_debut: z.string(), // 'HH:MM'
  heure_fin: z.string(),   // 'HH:MM'
  offset_jours_fin: z.number().int(), // 0 = même jour, 1 = lendemain…
})

export const PropositionProfilSchema = z.object({
  /** Ce que l'IA a compris de la demande, reformulé en français. */
  comprehension: z.string(),
  /** true si la demande se traduit en un profil composable dans le périmètre. */
  faisable: z.boolean(),
  /** Message à l'utilisateur : explication, précision demandée, ou raison de refus. */
  message: z.string(),
  /** Nom du nouveau profil. */
  nom: z.string().nullable(),
  /** Nom du profil SOURCE à dupliquer (tel qu'écrit) ; null → profil par défaut. */
  source_profil: z.string().nullable(),
  saison_suggeree: z.enum(['ete', 'hiver']).nullable(),
  /** Effectif de garde le soir en semaine : 1 à 4 ; null → selon la période. */
  nb_vetos_semaine_soir: z.number().int().nullable(),
  /** Horaires à ajuster (sparse) ; null → hérite de la source. */
  horaires: z.array(HoraireIaSchema).nullable(),
})

export type PropositionProfil = z.infer<typeof PropositionProfilSchema>

/** Profil minimal pour la résolution nom → id (source de duplication). */
export interface ProfilResolu {
  id: string
  nom: string
  est_defaut: boolean
}

/** Un horaire à ajuster sur un type de garde du nouveau profil. */
export interface HoraireOverride {
  code: string
  heure_debut: string // 'HH:MM'
  heure_fin: string   // 'HH:MM'
  offset_jours_fin: number // 0..3
}

/** Payload prêt pour la création serveur (creerProfilComplet). */
export interface CreerProfilCompletPayload {
  nom: string
  /** Profil source à dupliquer ; null → profil défaut du cabinet. */
  source_profil_id: string | null
  saison_suggeree: 'ete' | 'hiver' | null
  nb_vetos_semaine_soir: number | null
  /** Horaires à ajuster après duplication (sparse). */
  horaires: HoraireOverride[]
}

export type ConversionProfilResultat =
  | { ok: true; payload: CreerProfilCompletPayload }
  | { ok: false; raison: string }

/** Minutes depuis minuit pour une chaîne 'HH:MM' déjà validée. */
function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10))
  return h * 60 + m
}

/** Résout un nom de profil source → id (ou null = défaut), insensible casse. */
type ResolutionSource =
  | { ok: true; id: string | null }
  | { ok: false; cause: 'aucun' | 'ambigu' }

function resoudreSource(nom: string | null, profils: ProfilResolu[]): ResolutionSource {
  if (!nom || !nom.trim()) return { ok: true, id: null } // pas de source → défaut
  const norm = nom.trim().toLowerCase()
  // « par défaut » (et variantes) → profil défaut du cabinet.
  if (['par défaut', 'par defaut', 'défaut', 'defaut', 'profil par défaut', 'profil par defaut'].includes(norm)) {
    return { ok: true, id: null }
  }
  const matchs = profils.filter((p) => p.nom.trim().toLowerCase() === norm)
  if (matchs.length === 0) return { ok: false, cause: 'aucun' }
  if (matchs.length > 1) return { ok: false, cause: 'ambigu' }
  return { ok: true, id: matchs[0].id }
}

/**
 * propositionVersProfilPayload — convertit une proposition IA (termes humains)
 * en CreerProfilCompletPayload, PUR. Rejette proprement ce qui est inexploitable
 * (nom manquant, source introuvable, horaire hors périmètre/incohérent). La
 * validation métier finale reste côté serveur (creerProfilComplet + RLS).
 */
export function propositionVersProfilPayload(
  p: PropositionProfil,
  profils: ProfilResolu[],
): ConversionProfilResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en profil.' }

  const nom = p.nom?.trim()
  if (!nom) return { ok: false, raison: 'Donne un nom au profil (ex. « Été », « Vacances »).' }
  if (nom.length > 60) return { ok: false, raison: 'Le nom du profil est trop long (60 caractères max).' }

  const src = resoudreSource(p.source_profil, profils)
  if (!src.ok) {
    if (src.cause === 'ambigu') {
      return { ok: false, raison: `Plusieurs profils s'appellent « ${p.source_profil} » : précise lequel dupliquer.` }
    }
    return { ok: false, raison: `Profil source « ${p.source_profil} » introuvable. Crée-le d'abord, ou pars du profil par défaut.` }
  }

  const effectif = p.nb_vetos_semaine_soir
  if (
    effectif !== null && effectif !== undefined &&
    (!Number.isInteger(effectif) || effectif < 1 || effectif > 4)
  ) {
    return { ok: false, raison: 'Pour l’effectif du soir en semaine, indique entre 1 et 4 vétérinaires.' }
  }

  // Horaires à ajuster : format strict + cohérence + pas de doublon de type.
  const horaires: HoraireOverride[] = []
  const vus = new Set<string>()
  for (const h of p.horaires ?? []) {
    const lib = LIBELLE_CODE[h.code] ?? h.code
    if (vus.has(h.code)) {
      return { ok: false, raison: `Deux horaires différents indiqués pour « ${lib} » — garde-en un seul.` }
    }
    vus.add(h.code)
    if (!HEURE_RE.test(h.heure_debut) || !HEURE_RE.test(h.heure_fin)) {
      return { ok: false, raison: `Heure invalide pour « ${lib} » (format attendu comme 18:30).` }
    }
    const off = h.offset_jours_fin
    if (!Number.isInteger(off) || off < OFFSET_MIN || off > OFFSET_MAX) {
      return { ok: false, raison: `Jour de fin invalide pour « ${lib} ».` }
    }
    if (off === 0 && enMinutes(h.heure_fin) <= enMinutes(h.heure_debut)) {
      return { ok: false, raison: `Pour « ${lib} », l’heure de fin doit être après le début, ou la garde doit finir un jour suivant.` }
    }
    horaires.push({
      code: h.code,
      heure_debut: h.heure_debut,
      heure_fin: h.heure_fin,
      offset_jours_fin: off,
    })
  }

  return {
    ok: true,
    payload: {
      nom,
      source_profil_id: src.id,
      saison_suggeree: p.saison_suggeree ?? null,
      nb_vetos_semaine_soir: effectif ?? null,
      horaires,
    },
  }
}

/**
 * apercuProfil — rend la proposition en une phrase française de prévisualisation
 * (ce qui serait créé). Pur ; renvoie '' si le nom manque.
 */
export function apercuProfil(p: PropositionProfil): string {
  const nom = p.nom?.trim()
  if (!nom) return ''
  const parts: string[] = []
  const base = p.source_profil?.trim()
    ? `basé sur « ${p.source_profil.trim()} »`
    : 'basé sur le profil par défaut'
  parts.push(`Créer le profil « ${nom} », ${base}.`)
  if (p.saison_suggeree) parts.push(`Saison suggérée : ${p.saison_suggeree === 'ete' ? 'été' : 'hiver'}.`)
  const n = p.nb_vetos_semaine_soir
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 4) {
    parts.push(`Effectif du soir en semaine : ${n} vétérinaire${n > 1 ? 's' : ''}.`)
  }
  const hs = (p.horaires ?? []).filter((h) => HEURE_RE.test(h.heure_debut) && HEURE_RE.test(h.heure_fin))
  if (hs.length > 0) {
    const desc = hs
      .map((h) => {
        const lib = LIBELLE_CODE[h.code] ?? h.code
        const suff = h.offset_jours_fin === 0 ? '' : ` (${OFFSET_CLAIR[h.offset_jours_fin] ?? ''})`
        return `${lib} ${h.heure_debut} → ${h.heure_fin}${suff}`
      })
      .join(' ; ')
    parts.push(`Horaires ajustés : ${desc}.`)
  }
  return parts.join(' ')
}
