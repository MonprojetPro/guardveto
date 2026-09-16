'use server'

// ============================================================
// GUARDVETO — Trancher une proposition de Filou depuis le planning (B-122 lot 2)
// ============================================================
// Trois gestes, tous réservés à l'admin :
//   • appliquerPropositionAction  — une seule proposition, « case par case ».
//   • appliquerToutesPropositionsAction — le lot entier, « en bloc ».
//   • rejeterPropositionAction    — l'admin dit non, explicitement.
//
// ── LA REVALIDATION AU CLIC, PAS AU MOMENT DE LA PROPOSITION ────────────────
//
// La proposition stockée en base date de la dernière relecture. Le planning a
// pu bouger depuis (retouche manuelle, cadenas posé, autre proposition du même
// lot déjà appliquée). On reconstruit donc le contexte et le planning ACTUELS
// à chaque appel, et c'est `engine/relecture/appliquerProposition.ts` qui
// décide — jamais une réécriture directe depuis le contenu stocké.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resoudreContexte } from '@/data/resoudreContexte'
import { monterValidationPeriode } from '@/data/monterValidationPeriode'
import { persisterResultat } from '@/data/persisterResultat'
import { ecrirePlanningV1 } from '@/data/ecrirePlanningV1'
import {
  chargerPropositionsEnAttente, marquerPropositionDecidee,
} from '@/data/propositionsRelecture'
import { reappliquerProposition, reappliquerLot } from '@/engine/relecture/appliquerProposition'
import type { ChangementPropose, OptionsArbitrage } from '@/engine/relecture/arbitrer'
import type { CalendrierResolu, PlanningPartiel } from '@/engine/types'
import type { SupabaseClient } from '@supabase/supabase-js'

type Client = Awaited<ReturnType<typeof createClient>>

/** Même garde que `route.ts` de la relecture : admin, et le cabinet du JETON (règle C1). */
async function assertAdminEtCabinet(
  supabase: Client,
): Promise<{ error: string } | { cabinetId: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()
  if (vet?.role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }

  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) return { error: 'Cabinet non configuré pour cet utilisateur.' }
  return { cabinetId }
}

/** Le planning et le contexte d'arbitrage TELS QU'ILS SONT MAINTENANT — jamais figés. */
async function construireContexteActuel(
  supabase: Client,
  periodeId: string,
  cabinetId: string,
): Promise<{ planning: PlanningPartiel; options: OptionsArbitrage; calendrier?: CalendrierResolu }> {
  const contexte = await resoudreContexte(periodeId, cabinetId)
  const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
  if (!montage) throw new Error('Aucun planning à modifier pour cette période.')

  return {
    planning: montage.construirePlanning(montage.gardes),
    calendrier: contexte.calendrier,
    options: {
      vets: contexte.vets,
      dateDebut: contexte.dateDebut,
      dateFin: contexte.dateFin,
      saison: contexte.saison,
      calendrier: contexte.calendrier,
      nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
      structureConfig: contexte.structureConfig,
      creneaux: contexte.creneaux,
      contexteAnterieur: contexte.contexteAnterieur,
      roleAvantageFinancier: contexte.roleAvantageFinancier ?? null,
      // B-112 — même source que la relecture et la génération : jamais une
      // seconde lecture des cadenas, qui finirait par diverger.
      placesFigees: contexte.placesFigees,
    },
  }
}

/** Écrit un planning décidé et le publie sur les deux tables (V2 + V1). */
async function ecrirePlanning(
  supabase: Client,
  planning: PlanningPartiel,
  periodeId: string,
  cabinetId: string,
  calendrier: CalendrierResolu | undefined,
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  try {
    await persisterResultat(planning, periodeId, cabinetId)
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }
  const ecriture = await ecrirePlanningV1(supabase, planning, periodeId, cabinetId, calendrier)
  if (!ecriture.ok) {
    return { ok: false, erreur: ecriture.erreur ?? 'Écriture du planning échouée.' }
  }
  return { ok: true }
}

/** Rafraîchit les écrans qui affichent le planning et ses compteurs. */
function revaliderEcransPlanning() {
  revalidatePath('/planning')
  revalidatePath('/accueil')
}

export async function appliquerPropositionAction(
  propositionId: string,
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const supabase: SupabaseClient = await createClient()
  const garde = await assertAdminEtCabinet(supabase)
  if ('error' in garde) return { ok: false, erreur: garde.error }

  const { data: ligne, error } = await supabase
    .from('propositions_relecture')
    .select('id, periode_id, changement, statut')
    .eq('id', propositionId)
    .single()
  if (error || !ligne) return { ok: false, erreur: 'Proposition introuvable.' }
  if (ligne.statut !== 'en_attente') {
    return { ok: false, erreur: 'Cette proposition a déjà été tranchée.' }
  }

  let contexte
  try {
    contexte = await construireContexteActuel(supabase, ligne.periode_id, garde.cabinetId)
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }

  const resultat = reappliquerProposition(
    contexte.planning, ligne.changement as ChangementPropose, contexte.options,
  )
  if (resultat.issue !== 'appliquee' || !resultat.planning) {
    return { ok: false, erreur: resultat.raison ?? 'Ce changement ne peut plus être appliqué.' }
  }

  const ecrit = await ecrirePlanning(
    supabase, resultat.planning, ligne.periode_id, garde.cabinetId, contexte.calendrier,
  )
  if (!ecrit.ok) return ecrit

  await marquerPropositionDecidee(supabase, propositionId, 'appliquee')
  revaliderEcransPlanning()
  return { ok: true }
}

export async function rejeterPropositionAction(
  propositionId: string,
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const supabase: SupabaseClient = await createClient()
  const garde = await assertAdminEtCabinet(supabase)
  if ('error' in garde) return { ok: false, erreur: garde.error }

  const resultat = await marquerPropositionDecidee(supabase, propositionId, 'rejetee')
  if (!resultat.ok) return { ok: false, erreur: resultat.erreur ?? 'Rejet impossible.' }

  revaliderEcransPlanning()
  return { ok: true }
}

export interface ResultatApplicationLot {
  ok: true
  appliquees: number
  /** Ce qui n'a pas pu suivre, avec pourquoi — jamais un échec muet. */
  bloquees: { raison: string }[]
}

export async function appliquerToutesPropositionsAction(
  periodeId: string,
): Promise<ResultatApplicationLot | { ok: false; erreur: string }> {
  const supabase: SupabaseClient = await createClient()
  const garde = await assertAdminEtCabinet(supabase)
  if ('error' in garde) return { ok: false, erreur: garde.error }

  const { propositions, erreur } = await chargerPropositionsEnAttente(supabase, periodeId)
  if (erreur) return { ok: false, erreur }
  if (propositions.length === 0) return { ok: true, appliquees: 0, bloquees: [] }

  let contexte
  try {
    contexte = await construireContexteActuel(supabase, periodeId, garde.cabinetId)
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }

  const { appliquees, bloquees, planning } = reappliquerLot(
    contexte.planning, propositions.map((p) => p.changement), contexte.options,
  )

  if (appliquees.length > 0) {
    const ecrit = await ecrirePlanning(supabase, planning, periodeId, garde.cabinetId, contexte.calendrier)
    if (!ecrit.ok) return ecrit

    const idsAppliques = propositions
      .filter((p) => appliquees.includes(p.changementId))
      .map((p) => p.id)
    await Promise.all(idsAppliques.map((id) => marquerPropositionDecidee(supabase, id, 'appliquee')))
  }

  revaliderEcransPlanning()
  return {
    ok: true,
    appliquees: appliquees.length,
    bloquees: bloquees.map((b) => ({ raison: b.raison })),
  }
}
