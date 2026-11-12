// ============================================================
// GUARDVETO — Le guichet du Hub MPP : lire une demande d'envoi (B-207)
// ============================================================
// PUR : aucune dependance a Supabase ni a Next. Refuse tot, en francais, ce
// que la base refuserait (elle refait TOUS ces controles dans
// `messagerie_envoyer_editeur` — ce fichier n'est qu'un premier filtre).
// ============================================================

import { estUuid, LONGUEUR_MESSAGE_MAX } from '@/lib/messagerie/regles'

/** Le meme plafond que la fonction SQL. */
export const DESTINATAIRES_MAX = 200

export interface DemandeEnvoiEditeur {
  cabinetId: string
  destinataires: string[]
  corps: string
}

export type LectureDemande = { ok: true; demande: DemandeEnvoiEditeur } | { ok: false; error: string }

export function lireDemandeEnvoi(corpsRequete: unknown): LectureDemande {
  if (!corpsRequete || typeof corpsRequete !== 'object') {
    return { ok: false, error: 'Requête illisible.' }
  }
  const r = corpsRequete as Record<string, unknown>

  if (!estUuid(r.cabinetId)) return { ok: false, error: 'Cabinet introuvable.' }

  if (!Array.isArray(r.destinataires) || r.destinataires.length === 0) {
    return { ok: false, error: 'Choisissez au moins un destinataire.' }
  }
  if (!r.destinataires.every(estUuid)) {
    return { ok: false, error: 'Un destinataire est mal formé.' }
  }
  const destinataires = [...new Set(r.destinataires as string[])]
  if (destinataires.length > DESTINATAIRES_MAX) {
    return { ok: false, error: `${DESTINATAIRES_MAX} destinataires au maximum par envoi.` }
  }

  const corps = typeof r.corps === 'string' ? r.corps : ''
  if (corps.trim() === '') return { ok: false, error: 'Le message est vide.' }
  if (corps.length > LONGUEUR_MESSAGE_MAX) {
    return { ok: false, error: `Le message dépasse ${LONGUEUR_MESSAGE_MAX} caractères.` }
  }

  return { ok: true, demande: { cabinetId: r.cabinetId, destinataires, corps } }
}
