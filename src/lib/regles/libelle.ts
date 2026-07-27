// ============================================================
// GUARDVETO — Dire une règle en français (source UNIQUE)
// ============================================================
// Ces fonctions vivaient dans `ReglesClient.tsx`. Elles en sortent parce que
// Filou doit maintenant LIRE les règles existantes pour proposer d'en supprimer
// ou d'en désactiver une : il faut qu'il les nomme EXACTEMENT comme l'écran
// Règles les nomme. Deux rendus séparés auraient divergé au premier ajout de
// brique, et Filou aurait proposé de supprimer « la règle du mercredi » pendant
// que l'écran en affichait une autre formulation.
//
// Module neutre (ni serveur ni client) : appelé par le composant de la page
// Règles ET par l'action serveur de l'assistant.
// ============================================================

import { rendreRegle } from '@/engine/briques/catalogue'

/** Le minimum dont on a besoin pour nommer une règle. */
export interface RegleNommable {
  id: string
  brique_id: string
  params_json: unknown
}

interface ParamsJson {
  qui?: { refs?: unknown }
  params?: unknown
}

/**
 * Clé de paire non ordonnée d'un duo interdit (sinon null). Sert à n'afficher
 * QU'UNE ligne par duo, alors que la base en stocke deux (A→B + B→A, requis par
 * le moteur). Le toggle/suppression côté serveur gèrent déjà les deux sens.
 */
export function clePaireDuo(r: RegleNommable): string | null {
  if (r.brique_id !== 'duo_interdit') return null
  const pj = r.params_json as { qui?: { refs?: unknown[] }; params?: { avec_veterinaire_id?: unknown } }
  const owner = pj?.qui?.refs?.[0]
  const partner = pj?.params?.avec_veterinaire_id
  if (typeof owner !== 'string' || typeof partner !== 'string') return null
  return [owner, partner].sort().join('|')
}

/** Retire le sens miroir des duos : on ne garde que la 1re ligne de chaque paire. */
export function fusionnerDuos<T extends RegleNommable>(rows: T[]): T[] {
  const vues = new Set<string>()
  return rows.filter((r) => {
    const cle = clePaireDuo(r)
    if (!cle) return true
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

/** Une règle existante que Filou propose de toucher, telle qu'affichée. */
export interface RegleVisee {
  id: string
  libelle: string
  actif: boolean
}

/**
 * Traduit les numéros renvoyés par l'assistant (R1, R2…) en règles réelles.
 *
 * FRONTIÈRE DE CONFIANCE : c'est le seul endroit où une sortie de modèle
 * devient un identifiant de ligne. On ne garde donc QUE des numéros présents
 * dans la liste qu'on a nous-mêmes envoyée — un numéro halluciné, hors bornes
 * ou répété est jeté en silence, jamais résolu « au plus proche ». L'ordre de
 * la réponse est conservé : c'est celui dans lequel Filou en a parlé.
 */
export function reglesVisees<T extends { id: string; actif: boolean }>(
  candidates: T[],
  libelles: string[],
  numeros: unknown[],
): RegleVisee[] {
  const retenus = [
    ...new Set(
      numeros.filter(
        (n): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= candidates.length,
      ),
    ),
  ]
  return retenus.map((n) => ({
    id: candidates[n - 1].id,
    libelle: libelles[n - 1] ?? '',
    actif: candidates[n - 1].actif,
  }))
}

export function phraseRegle(regle: RegleNommable, nomVeto: (id: string) => string): string {
  const pj = (regle.params_json ?? {}) as ParamsJson
  const refs = pj.qui?.refs
  // Multi-propriétaires (n°18) : le sujet affiche TOUTES les réfs — sauf pour
  // un duo interdit où refs[1] est le PARTENAIRE (déjà rendu par le prédicat).
  const refsStr = Array.isArray(refs) ? refs.filter((x): x is string => typeof x === 'string') : []
  const sujets = regle.brique_id === 'duo_interdit' ? refsStr.slice(0, 1) : refsStr
  const sujet = sujets.map(nomVeto).join(', ')
  const params = (pj.params ?? {}) as Record<string, unknown>
  const predicat = rendreRegle(regle.brique_id, params, { nomVeto })
  return sujet ? `${sujet} ${predicat}` : predicat
}
