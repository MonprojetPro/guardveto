// ============================================================
// GUARDVETO — Assistant IA : schéma de proposition de LIAISON (RG4)
// ============================================================
// L'IA traduit une phrase en langage naturel → une PROPOSITION de liaison
// entre deux créneaux (« même équipe » = ex R9, « rôles différents » = ex R8).
// Elle travaille en termes HUMAINS (noms des créneaux et du profil, tels
// qu'affichés) ; le serveur résout ensuite noms → ids et crée via
// creerRelationCreneau (frontière de confiance + RLS + trigger d'intégrité).
// L'IA PROPOSE, l'humain DÉCIDE.
//
// Ce module est PUR (zod + conversion) → entièrement testable, AUCUN appel API.
// ============================================================

import { z } from 'zod'

/** Genres de liaison consommés par le moteur (repos_apres : pas encore). */
export const GENRES_RELATION_IA = ['meme_binome', 'inversion_role'] as const
export type GenreRelationIa = (typeof GENRES_RELATION_IA)[number]

/** Libellé « en clair » d'un genre (aperçu + messages). */
export const GENRE_RELATION_CLAIR: Record<GenreRelationIa, string> = {
  meme_binome: 'même équipe',
  inversion_role: 'rôles différents',
}

/**
 * Schéma de la proposition produite par l'IA (sortie structurée). Les créneaux
 * et le profil sont désignés par leur NOM tel qu'affiché dans l'application —
 * la résolution nom → id se fait côté serveur, sur le profil résolu.
 */
export const PropositionRelationSchema = z.object({
  /** Ce que l'IA a compris de la demande, reformulé en français. */
  comprehension: z.string(),
  /** true si la demande se traduit en une liaison dans le périmètre. */
  faisable: z.boolean(),
  /** Message à l'utilisateur : explication, précision demandée, ou raison de refus. */
  message: z.string(),
  /** Nom du profil concerné (tel qu'écrit) ; null → profil par défaut. */
  profil: z.string().nullable(),
  /** Nom du créneau qui a lieu EN PREMIER (chronologiquement). */
  premier_creneau: z.string().nullable(),
  /** Nom du créneau qui SUIT (celui qui se calque sur le premier). */
  second_creneau: z.string().nullable(),
  genre: z.enum(GENRES_RELATION_IA).nullable(),
})

export type PropositionRelation = z.infer<typeof PropositionRelationSchema>

/** Créneau minimal pour la résolution nom → id (catalogue du profil résolu). */
export interface CreneauResoluIA {
  id: string
  nom: string
  /** Jours couverts (0=dim … 6=sam) — pour la garde « même équipe + même jour ». */
  joursSemaine: number[]
}

/** Payload prêt pour la création serveur (creerRelationCreneau). */
export interface CreerRelationIaPayload {
  profil_id: string
  source_id: string
  cible_id: string
  genre: GenreRelationIa
}

export type ConversionRelationResultat =
  | { ok: true; payload: CreerRelationIaPayload }
  | { ok: false; raison: string }

/** Résout un nom de créneau → la ligne du catalogue (insensible à la casse). */
function resoudreCreneau(nom: string | null, creneaux: CreneauResoluIA[]): CreneauResoluIA | null {
  if (!nom || !nom.trim()) return null
  const norm = nom.trim().toLowerCase()
  return creneaux.find((c) => c.nom.trim().toLowerCase() === norm) ?? null
}

/**
 * propositionVersRelationPayload — convertit une proposition IA (termes humains)
 * en payload de création, PUR. Rejette proprement ce qui est inexploitable
 * (créneau introuvable, genre manquant, auto-lien, « même équipe » entre deux
 * créneaux couvrant un même jour — impossible avec R22). La validation métier
 * finale reste côté serveur (creerRelationCreneau + RLS + trigger).
 */
export function propositionVersRelationPayload(
  p: PropositionRelation,
  creneaux: CreneauResoluIA[],
  profilId: string,
): ConversionRelationResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en liaison.' }

  if (!p.genre) {
    return { ok: false, raison: 'Précise la règle : « même équipe » sur les deux gardes, ou « rôles différents ».' }
  }

  const source = resoudreCreneau(p.premier_creneau, creneaux)
  if (!source) {
    return {
      ok: false,
      raison: p.premier_creneau?.trim()
        ? `Le type de garde « ${p.premier_creneau.trim()} » n'existe pas dans ce profil.`
        : 'Indique les deux types de garde à lier.',
    }
  }
  const cible = resoudreCreneau(p.second_creneau, creneaux)
  if (!cible) {
    return {
      ok: false,
      raison: p.second_creneau?.trim()
        ? `Le type de garde « ${p.second_creneau.trim()} » n'existe pas dans ce profil.`
        : 'Indique les deux types de garde à lier.',
    }
  }
  if (source.id === cible.id) {
    return { ok: false, raison: 'Choisis deux types de garde différents pour les lier.' }
  }

  // Même garde métier que le serveur : « même équipe » entre deux créneaux
  // couvrant un même jour = incompatible avec R22 (jamais deux gardes le même
  // jour pour un même véto) → planning ingénérable.
  if (p.genre === 'meme_binome') {
    const joursSource = new Set(source.joursSemaine)
    if (cible.joursSemaine.some((j) => joursSource.has(j))) {
      return {
        ok: false,
        raison:
          `« ${source.nom} » et « ${cible.nom} » couvrent un même jour : exiger la même équipe `
          + 'est impossible (un vétérinaire ne peut pas tenir deux gardes le même jour). '
          + 'Essaie « rôles différents », ou des créneaux de jours différents.',
      }
    }
  }

  return {
    ok: true,
    payload: { profil_id: profilId, source_id: source.id, cible_id: cible.id, genre: p.genre },
  }
}

/**
 * apercuRelation — rend la proposition en une phrase française de
 * prévisualisation. Pur ; renvoie '' si un créneau manque.
 */
export function apercuRelation(p: PropositionRelation, nomProfil?: string): string {
  const src = p.premier_creneau?.trim()
  const cib = p.second_creneau?.trim()
  if (!src || !cib || !p.genre) return ''
  const regle = GENRE_RELATION_CLAIR[p.genre]
  const surProfil = nomProfil ? ` (profil « ${nomProfil} »)` : ''
  return `Lier « ${src} » → « ${cib} » : ${regle}${surProfil}.`
}
