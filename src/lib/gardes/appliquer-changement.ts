// ============================================================
// GUARDVETO — Helper PARTAGÉ : appliquer un changement de garde
// ============================================================
// Cœur du cycle d'application d'un changement d'attribution sur UNE garde :
//   1. mise à jour premier_id/second_id (+ modifie_manuellement, updated_at)
//   2. déverrouillage + audit_log si force
//   3. recalcul du bilan bonus/malus si la période est publiée/verrouillée
//   4. synchro Google Agenda (best-effort)
//   5. envoi email aux vétos concernés (best-effort)
//
// Extrait de PATCH /api/gardes/[id] pour être réutilisé SANS duplication par
// la gestion de crise (POST /api/absences/[id]/reparer). La route PATCH et la
// route de réparation appellent donc EXACTEMENT le même cycle.
//
// ⚠️ Ce helper ne fait AUCUN contrôle d'auth ni de cabinet : l'appelant (la
//    route) DOIT avoir validé admin + cabinet AVANT. Il ne fait pas non plus la
//    validation métier « ce véto est-il légal sur ce créneau » — c'est la
//    responsabilité de l'appelant (la route de crise le fait via proposerReparation).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'
import { syncGardeIndividuelle } from '@/lib/sync-calendrier'
import { sendGardeModifiee } from '@/lib/notifications'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import { placementsPourPaire } from '@/data/gardePlacements'
import { syncAttributionsPourGarde } from '@/data/syncAttributions'

/** Vétérinaire « avant modif » (pour l'email de notification). */
export interface VetoNotif {
  id: string
  nom: string
  prenom: string
  email: string
}

export interface AppliquerChangementParams {
  /** Client serveur (déjà authentifié — admin + cabinet validés par l'appelant). */
  supabase: SupabaseClient
  /** Garde à modifier. */
  gardeId: string
  /** Nouvel·le 1er de garde (ou null pour libérer le rôle). */
  premier_id: string | null
  /** Nouveau·elle 2nd de garde (ou null pour libérer le rôle). */
  second_id: string | null
  /** Déverrouille la garde + trace dans audit_log (correction d'une garde verrouillée). */
  force: boolean
  /** Id véto de l'auteur de la modif (pour audit_log.user_id). */
  auteurVetId: string
  /**
   * Cabinet courant, pour le recalcul du bilan bonus/malus. À FOURNIR
   * impérativement quand `supabase` est un client SERVICE_ROLE (sans session) :
   * `resoudreCabinetId` lit la session et échouerait silencieusement, sautant
   * le recalcul (cas du dépannage volontaire). Si absent, on retombe sur
   * `resoudreCabinetId` (chemin authentifié classique).
   */
  cabinetId?: string
}

export interface AppliquerChangementResultat {
  ok: boolean
  /** Code HTTP suggéré à la route (200 si ok, 404/422/500 sinon). */
  status: number
  /** Message d'erreur si !ok. */
  error?: string
}

/**
 * appliquerChangementGarde — applique un changement d'attribution sur UNE garde
 * et déroule TOUT le cycle (update, audit, bilan, agenda, email). Best-effort sur
 * agenda + email (les erreurs sont loguées, jamais bloquantes).
 *
 * Renvoie un résultat structuré (ok + status + error) plutôt qu'une NextResponse :
 * la route appelante construit sa réponse (utile en lot pour la crise).
 */
export async function appliquerChangementGarde(
  params: AppliquerChangementParams,
): Promise<AppliquerChangementResultat> {
  const { supabase, gardeId, premier_id, second_id, force, auteurVetId } = params
  const cabinetIdFourni = params.cabinetId

  // ── Règle : le même véto ne peut pas être 1er ET 2nd ──
  if (premier_id && second_id && premier_id === second_id) {
    return {
      ok: false,
      status: 422,
      error:
        'Le même vétérinaire ne peut pas être à la fois 1er et 2nd de garde. Choisissez deux personnes différentes.',
    }
  }

  // ── Chargement de la garde + période + anciens assignés ──
  const { data: garde } = await supabase
    .from('gardes')
    .select(`
      id, verrouille, periode_id, modifie_manuellement, cabinet_id,
      premier_id, second_id,
      periode:periode_id(statut),
      oldPremier:premier_id(id, nom, prenom, email),
      oldSecond:second_id(id, nom, prenom, email)
    `)
    .eq('id', gardeId)
    .single()

  if (!garde) return { ok: false, status: 404, error: 'Garde introuvable.' }

  if (garde.verrouille && !force) {
    return {
      ok: false,
      status: 422,
      error: 'Cette garde est verrouillée. Utilisez « Corriger » pour la modifier.',
    }
  }

  // ── Mise à jour ──────────────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    premier_id,
    second_id,
    modifie_manuellement: true,
    updated_at: new Date().toISOString(),
  }
  if (force) updatePayload.verrouille = false

  const { error } = await supabase.from('gardes').update(updatePayload).eq('id', gardeId)
  if (error) {
    return { ok: false, status: 500, error: `Erreur lors de la mise à jour : ${error.message}` }
  }

  // ── Double écriture P3b-2 — miroir de la paire dans garde_placements ──
  //    Résout la désync : l'édition manuelle ET la crise (qui transite ici)
  //    répercutent enfin le changement sur la liste de places. ADDITIF (aucun
  //    lecteur encore) + best-effort : n'interrompt JAMAIS le cycle d'édition V1.
  //    On remplace les places de CETTE garde (delete → re-insert la paire).
  try {
    const cabinetIdGarde = (garde as Record<string, unknown>).cabinet_id as string | null
    if (cabinetIdGarde) {
      await supabase.from('garde_placements').delete().eq('garde_id', gardeId)
      const placements = placementsPourPaire(cabinetIdGarde, gardeId, premier_id, second_id)
      if (placements.length > 0) {
        const { error: placementsErr } = await supabase.from('garde_placements').insert(placements)
        if (placementsErr) {
          console.error('[P3b-2] miroir garde_placements échoué:', placementsErr.message)
        }
      }
    }
  } catch (e) {
    console.error('[P3b-2] miroir garde_placements exception:', e)
  }

  // ── Synchro V2 (P6 verrou n°7, étape 3) — miroir `attributions` ──
  //    TOUS les chemins de mutation (édition PATCH, crise, dépannage
  //    volontaire, échanges) transitent ici : c'est LE point unique où V2
  //    suit V1. Un week-end resynchronise AUSSI son vendredi_soir V2 lié
  //    (relations du profil appliquées). Best-effort : n'interrompt JAMAIS
  //    le cycle V1 ; un échec alerte les admins (cloche) et sera de toute
  //    façon détecté par le contrôle de dérive V1↔V2 de la re-validation.
  {
    const cabinetIdSync =
      cabinetIdFourni ?? ((garde as Record<string, unknown>).cabinet_id as string | null)
    const sync = await syncAttributionsPourGarde(supabase, gardeId)
    if (!sync.ok) {
      console.error('[sync-V2] synchro attributions échouée:', sync.erreur)
      if (cabinetIdSync) {
        await signalerIncidentTechnique(
          supabase, cabinetIdSync,
          'Copie technique du planning (V2) désynchronisée',
          'La modification de garde est bien enregistrée dans le planning affiché, mais sa copie technique (attributions) n\'a pas pu être mise à jour. Le contrôle de cohérence la signalera tant qu\'elle diverge ; signale-le si ça se répète.',
        )
      }
    }
  }

  // ── Audit log (correction d'une garde verrouillée) ──────
  if (force) {
    await supabase.from('audit_log').insert({
      table_name: 'gardes',
      record_id: gardeId,
      action: 'update',
      old_data: {
        premier_id: garde.premier_id,
        second_id: garde.second_id,
        verrouille: true,
        modifie_manuellement: garde.modifie_manuellement,
      },
      new_data: { premier_id, second_id, verrouille: false, modifie_manuellement: true },
      user_id: auteurVetId,
    })
  }

  // ── Recalcul auto du bilan bonus/malus (période publiée/verrouillée) ──
  const periodeRel = (garde as Record<string, unknown>).periode as
    | { statut?: string }
    | { statut?: string }[]
    | null
  const periodeStatut = Array.isArray(periodeRel) ? periodeRel[0]?.statut : periodeRel?.statut

  if (periodeStatut === 'publie' || periodeStatut === 'verrouille') {
    const [compteurs, totalWE] = await Promise.all([
      queryCompteurs(supabase, garde.periode_id),
      queryTotalWE(supabase, garde.periode_id),
    ])

    if (compteurs.length > 0) {
      // Priorité au cabinetId fourni par l'appelant (indispensable en
      // service_role sans session). Sinon, résolution via la session.
      let cabinetId: string | null = cabinetIdFourni ?? null
      if (!cabinetId) {
        try {
          cabinetId = await resoudreCabinetId(supabase)
        } catch (err) {
          console.error(
            '[appliquerChangementGarde] cabinet_id introuvable pour recalcul bilan:',
            err instanceof Error ? err.message : String(err),
          )
        }
      }

      if (cabinetId) {
        const bilans = calculerBilans(compteurs, totalWE)
        const rows = bilans.map((b) => ({
          cabinet_id: cabinetId as string,
          veterinaire_id: b.veterinaire_id,
          periode_id: garde.periode_id,
          ecart_we: b.ecart_we,
          ecart_semaine: b.ecart_semaine,
          ecart_feries: b.ecart_feries,
          ecart_grands_we: b.ecart_grands_we,
        }))
        await supabase
          .from('bonus_malus')
          .upsert(rows, { onConflict: 'cabinet_id,veterinaire_id,periode_id' })
      }
    }
  }

  // ── Synchro Agenda + notifications (best-effort, AWAIT obligatoire sur Vercel) ──
  const oldPremier = (garde as Record<string, unknown>).oldPremier as VetoNotif | null
  const oldSecond = (garde as Record<string, unknown>).oldSecond as VetoNotif | null

  // cabinet_id pour le monitoring : fourni par l'appelant, sinon celui de la garde.
  const cabinetIdIncident =
    cabinetIdFourni ?? ((garde as Record<string, unknown>).cabinet_id as string | null)

  try {
    await syncGardeIndividuelle(supabase, gardeId)
  } catch (err) {
    console.error(
      '[appliquerChangementGarde] Erreur sync agenda:',
      err instanceof Error ? err.message : String(err),
    )
    if (cabinetIdIncident) {
      await signalerIncidentTechnique(
        supabase, cabinetIdIncident,
        'Synchro Google Agenda en échec sur une garde',
        'La modification de garde est bien enregistrée dans le planning, mais Google Agenda n\'a pas pu être mis à jour. Republier la période resynchronisera tout.',
      )
    }
  }

  try {
    await sendGardeModifiee(supabase, gardeId, oldPremier, oldSecond)
  } catch (err) {
    console.error(
      '[appliquerChangementGarde] Erreur notifications email:',
      err instanceof Error ? err.message : String(err),
    )
    if (cabinetIdIncident) {
      await signalerIncidentTechnique(
        supabase, cabinetIdIncident,
        'Email de modification de garde en échec',
        'La garde a bien été modifiée mais l\'email de prévenance aux vétérinaires concernés n\'est pas parti. Pense à les prévenir si besoin.',
      )
    }
  }

  return { ok: true, status: 200 }
}
