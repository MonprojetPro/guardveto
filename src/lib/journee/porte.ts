// ============================================================
// GUARDVETO — La porte d'entrée du module `planning-journee`
// ============================================================
// B-120 chantier 3, lot 1. Ce fichier n'invente RIEN : il extrait la fonction
// `porteOuverte()` écrite au chantier 2 dans `app/(v2)/journee/actions.ts`, pour
// que le second fichier d'actions (les trames) l'appelle au lieu de la recopier.
//
// ⚠️ POURQUOI L'EXTRAIRE PLUTÔT QUE LA DUPLIQUER — la raison est déjà écrite
//    dans le commentaire d'origine, et elle vaut plus encore maintenant : « une
//    garde recopiée quatre fois est une garde oubliée la cinquième ». C'est le
//    défaut « convention recopiée trois fois, appliquée deux fois » payé le
//    30/09 (B-130b), où un week-end valait 4 places pour le moteur et 2 lignes
//    en base parce que la règle vivait à trois endroits.
//
// ⚠️ POURQUOI PAS DANS LE FICHIER `'use server'` : un module marqué `'use server'`
//    ne peut exporter que des actions sérialisables. `porteOuverte` rend un
//    client Supabase — il ne franchira jamais la frontière réseau. Il doit donc
//    vivre hors de ce fichier, et c'est ici.
//
// ── L'ORDRE DES TROIS GARDES, ET POURQUOI IL EST CELUI-LÀ ───────────────────
//   ① le module  — ce cabinet a-t-il acheté cette capacité ?
//   ② l'admin    — cette personne a-t-elle le droit de la régler ?
//   ③ la saisie  — ce qu'elle envoie est-il cohérent ? (chez l'appelant)
//
// Chacune est doublée en base par la RLS et les CHECK des migrations. Deux
// gardiens qui disent la même chose, délibérément.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { exigerModule, ModuleEteintError } from '@/lib/produit/modules-serveur'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Le module dont dépend tout le planning journée. */
export const MODULE_JOURNEE = 'planning-journee'

export type Porte =
  | { ok: true; supabase: SupabaseClient<any, any, any>; cabinetId: string }
  | { ok: false; probleme: string }

export type PorteTrame =
  | {
      ok: true
      supabase: SupabaseClient<any, any, any>
      cabinetId: string
      /** `true` : l'admin, qui règle tout le monde. `false` : un véto, pour lui seul. */
      estAdmin: boolean
      /** La fiche de la personne connectée. */
      moiId: string
    }
  | { ok: false; probleme: string }

/**
 * B-175 — la porte des SEMAINES TYPES (trames), plus large que `porteJournee`.
 *
 * MiKL, 27/10 : « chaque véto sa semaine type, l'admin garde la main ». Un
 * vétérinaire passe donc, mais SEULEMENT pour les lignes qui le désignent —
 * c'est à l'appelant de vérifier chaque ligne avec `peutEcrireTrame`.
 * Le secrétariat n'a pas de fiche `veterinaires` : il est refusé ici.
 *
 * ⚠️ La base porte le même refus (policy `trames_journee_veto_own_write`).
 *    Deux gardiens, délibérément : l'écran évite l'erreur, le serveur refuse
 *    le chemin qu'on n'a pas prévu, la base refuse ce que le serveur oublierait.
 */
export async function porteTrame(): Promise<PorteTrame> {
  const supabase = await createClient()

  try {
    await exigerModule(supabase, MODULE_JOURNEE)
  } catch (e) {
    if (e instanceof ModuleEteintError) return { ok: false, probleme: e.message }
    throw e
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, probleme: 'Non authentifié.' }

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  const fiche = moi as { id?: string; role_app?: string } | null
  if (!fiche?.id) {
    return { ok: false, probleme: 'Seuls les vétérinaires du cabinet ont une semaine type.' }
  }

  return {
    ok: true,
    supabase,
    cabinetId: await resoudreCabinetId(supabase),
    estAdmin: fiche.role_app === 'admin',
    moiId: fiche.id,
  }
}

/** Un véto n'écrit que SES lignes ; l'admin écrit toutes celles du cabinet. */
export function peutEcrireTrame(
  porte: { estAdmin: boolean; moiId: string },
  veterinaireId: string | null | undefined,
): boolean {
  if (porte.estAdmin) return true
  return !!veterinaireId && veterinaireId === porte.moiId
}

export const REFUS_TRAME_AUTRUI =
  'Vous ne pouvez modifier que votre propre semaine type. Pour celle d’un collègue, voyez avec l’administratrice.'

/**
 * Les deux premières gardes, dans l'ordre. Rend le client si tout passe.
 *
 * ⚠️ LE MODULE EN PREMIÈRE LIGNE, avant toute lecture et toute écriture. Pas
 *    après la garde admin, pas après la validation : si le module est éteint, ce
 *    cabinet n'a pas à exister du point de vue de cet écran, et une action
 *    éteinte ne doit pas même révéler qu'un réglage existe.
 */
export async function porteJournee(): Promise<Porte> {
  const supabase = await createClient()

  // ① LE MODULE.
  try {
    await exigerModule(supabase, MODULE_JOURNEE)
  } catch (e) {
    if (e instanceof ModuleEteintError) return { ok: false, probleme: e.message }
    throw e
  }

  // ② L'ADMIN. Masquer une entrée de dock n'a jamais fermé une URL.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, probleme: 'Non authentifié.' }

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  if ((moi as { role_app?: string } | null)?.role_app !== 'admin') {
    return { ok: false, probleme: "Réservé à l'administrateur du cabinet." }
  }

  // Le cabinet vient du SERVEUR (JWT, puis repli sur la fiche), jamais d'un
  // champ envoyé par le client — sans quoi on offrirait un formulaire pour
  // écrire chez le voisin.
  return { ok: true, supabase, cabinetId: await resoudreCabinetId(supabase) }
}
