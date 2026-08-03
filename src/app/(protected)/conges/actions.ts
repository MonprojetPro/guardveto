'use server'

import { createClient } from '@/lib/supabase/server'
import { refusSiBloquant } from '@/data/controleImpact'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import { sendBrevoEmail, emailCongeValide, emailCongeRefuse } from '@/lib/brevo'
import { detecterConflitPlanningPublie } from '@/lib/conges/detection-conflit'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { CreneauConge, TypeConge } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * #10c — Expéditeur Brevo du cabinet courant (from email + from name), lus sur
 * `cabinets`. Best-effort : toute erreur (cabinet non résolu, colonnes nulles)
 * renvoie `{}` → sendBrevoEmail retombe alors sur l'env puis le défaut.
 */
async function chargerExpediteurCabinet(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ fromEmail?: string | null; fromName?: string | null }> {
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const { data } = await supabase
      .from('cabinets')
      .select('brevo_from_email, brevo_from_name')
      .eq('id', cabinetId)
      .single()
    return {
      fromEmail: (data as { brevo_from_email?: string | null } | null)?.brevo_from_email ?? null,
      fromName: (data as { brevo_from_name?: string | null } | null)?.brevo_from_name ?? null,
    }
  } catch {
    return {}
  }
}

/**
 * D5 — journalise dans `email_log` l'envoi (ou l'échec) d'un e-mail de congé.
 * Aligne le chemin sendBrevoEmail sur celui de sendViaBrevo (notifications.ts) :
 * mêmes colonnes/statuts que le journal admin (/admin/journal-emails). Types
 * autorisés par la contrainte email_log_type_check (migration élargie).
 * Best-effort : toute erreur d'insertion est loguée mais jamais bloquante.
 */
async function journaliserEmailConge(
  supabase: SupabaseClient<any, any, any>,
  params: {
    type: 'conge_valide' | 'conge_refuse'
    destinataire: string
    veterinaire_id: string
    resultat: { error?: string; success?: boolean }
  },
): Promise<void> {
  const erreur = params.resultat.error ?? null
  try {
    await supabase.from('email_log').insert({
      type: params.type,
      destinataire: params.destinataire,
      veterinaire_id: params.veterinaire_id,
      statut: erreur ? 'erreur' : 'envoye',
      erreur,
    })
  } catch (e) {
    console.error('[conges] Journalisation email_log échouée:', e)
  }
}

/**
 * Signal de conflit renvoyé au front quand un congé devenu EFFECTIF (validé)
 * chevauche une ou plusieurs gardes d'un planning DÉJÀ PUBLIÉ pour ce véto.
 * Présent UNIQUEMENT en cas de conflit — le contrat de succès reste rétro-compatible
 * (`{ success: true }` inchangé quand il n'y a aucun conflit).
 */
export interface ConflitPlanning {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  creneauxImpactes: CreneauImpacte[]
}

export interface CongeFormData {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: TypeConge
  creneau: CreneauConge | null
  commentaire: string
}

/**
 * Résultat d'une action qui peut détecter un conflit planning publié.
 * - `error` : échec (le congé n'a pas été enregistré).
 * - `success: true` (+ `conflit?`) : congé enregistré ; `conflit` présent
 *   UNIQUEMENT si l'enregistrement chevauche une garde déjà publiée.
 */
export type CongeActionResult =
  | { error: string; success?: undefined; conflit?: undefined }
  | { success: true; error?: undefined; conflit?: ConflitPlanning }

export async function createConge(
  data: CongeFormData,
  saisi_par: string,
  isAdmin: boolean,
): Promise<CongeActionResult> {
  const supabase = await createClient()

  // Pour un veto non-admin, on force le veterinaire_id à celui de l'utilisateur connecté
  // (évite le cas où le client enverrait un id différent)
  let veterinaire_id = data.veterinaire_id
  if (!isAdmin) {
    const { data: vetId, error: rpcErr } = await supabase.rpc('get_veterinaire_id')
    if (rpcErr || !vetId) return { error: 'Vétérinaire introuvable ou non authentifié' }
    veterinaire_id = vetId
  }

  // cabinet_id dérivé côté serveur (jamais du client) — sinon le congé
  // est inséré avec cabinet_id NULL et reste invisible sous RLS stricte.
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { error } = await supabase.from('conges').insert({
    cabinet_id: cabinetId,
    veterinaire_id,
    date_debut: data.date_debut,
    date_fin: data.date_fin,
    type: data.type,
    creneau: data.creneau || null,
    statut: isAdmin ? 'valide' : 'souhait',
    commentaire: data.commentaire || null,
    saisi_par,
    valide_par: isAdmin ? saisi_par : null,
  })

  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/admin/demandes')

  // ── Détection de conflit congé ↔ planning publié (cas « Antoine ») ──────
  // UNIQUEMENT quand le congé est CRÉÉ déjà validé par un admin (statut 'valide').
  // Un simple souhait de véto ne déclenche RIEN ici. La détection NE BLOQUE PAS
  // (le congé est déjà enregistré — choix admin assumé) : on remonte juste un
  // signal `conflit` au front pour proposer la réparation du planning.
  if (isAdmin) {
    const conflit = await detecterConflit(
      supabase,
      cabinetId,
      veterinaire_id,
      data.date_debut,
      data.date_fin,
    )
    if (conflit) return { success: true, conflit }
  }

  return { success: true }
}

/**
 * detecterConflit — wrapper interne : interroge le détecteur LOT A3 et, en cas
 * de conflit, façonne le signal `ConflitPlanning` prêt à remonter au front.
 * Fail-open hérité du détecteur : ne plante jamais la création/validation.
 */
async function detecterConflit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cabinetId: string,
  veterinaireId: string,
  dateDebut: string,
  dateFin: string,
): Promise<ConflitPlanning | null> {
  const { aConflit, creneauxImpactes } = await detecterConflitPlanningPublie({
    supabase,
    cabinetId,
    veterinaireId,
    dateDebut,
    dateFin,
  })
  if (!aConflit) return null
  return {
    veterinaire_id: veterinaireId,
    date_debut: dateDebut,
    date_fin: dateFin,
    creneauxImpactes,
  }
}

export async function updateConge(id: string, data: CongeFormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('conges')
    .update({
      veterinaire_id: data.veterinaire_id,
      date_debut: data.date_debut,
      date_fin: data.date_fin,
      type: data.type,
      creneau: data.creneau || null,
      commentaire: data.commentaire || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}

export async function deleteConge(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('conges').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}

export async function validerConge(
  id: string,
  valide_par: string,
  date_debut?: string,
  date_fin?: string,
  /**
   * L'admin a vu les conséquences et valide quand même. Sans ce drapeau, un
   * congé qui rend un créneau impossible à pourvoir est REFUSÉ — cf. le
   * contrôle d'impact ci-dessous.
   */
  confirmeImpact?: boolean,
): Promise<CongeActionResult> {
  const supabase = await createClient()

  // Récupère les données du congé + vet AVANT la mise à jour (pour l'email)
  const { data: conge } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin, type, creneau')
    .eq('id', id)
    .single()

  // ── LE PASSAGE OBLIGÉ (palier 2 de l'audit du 2026-08-03) ──
  // Valider un congé est une modification du monde comme une autre : il retire
  // un vétérinaire de la circulation sur une plage de dates. C'était même le
  // trou le plus coûteux du produit — le planning n'était re-validé qu'APRÈS
  // coup, une fois le mal fait, et il fallait tout régénérer.
  if (conge) {
    const c = conge as { veterinaire_id: string; date_debut: string; date_fin: string }
    let cabinetId: string | null = null
    try {
      cabinetId = await resoudreCabinetId(supabase)
    } catch {
      cabinetId = null // cabinet irrésolu : on ne bloque pas une validation
    }
    if (cabinetId) {
      const refus = await refusSiBloquant(
        supabase,
        cabinetId,
        {
          genre: 'conge_ajoute',
          vetId: c.veterinaire_id,
          dateDebut: date_debut ?? c.date_debut,
          dateFin: date_fin ?? c.date_fin,
        },
        confirmeImpact === true,
      )
      if (refus) return { error: refus.error }
    }
  }

  const update: Record<string, unknown> = { statut: 'valide', valide_par }
  if (date_debut) update.date_debut = date_debut
  if (date_fin) update.date_fin = date_fin

  const { error } = await supabase.from('conges').update(update).eq('id', id)
  if (error) return { error: error.message }

  // Dates effectives après validation (l'admin a pu ajuster début/fin).
  const debutEffectif = date_debut ?? conge?.date_debut ?? null
  const finEffective = date_fin ?? conge?.date_fin ?? null

  // Notification email (fire-and-forget — n'échoue pas le process principal)
  if (conge) {
    const { data: vet } = await supabase
      .from('veterinaires')
      .select('email, prenom, nom')
      .eq('id', conge.veterinaire_id)
      .single()

    if (vet) {
      const expediteur = await chargerExpediteurCabinet(supabase)
      sendBrevoEmail({
        to: vet.email,
        toName: `${vet.prenom} ${vet.nom}`,
        subject: 'Votre demande a été validée — GuardVeto',
        htmlContent: emailCongeValide({
          prenom: vet.prenom,
          type: conge.type,
          creneau: conge.creneau,
          date_debut: date_debut ?? conge.date_debut,
          date_fin: date_fin ?? conge.date_fin,
          signature: expediteur.fromName,
        }),
        ...expediteur,
      })
        .then((res) =>
          journaliserEmailConge(supabase, {
            type: 'conge_valide',
            destinataire: vet.email,
            veterinaire_id: conge.veterinaire_id,
            resultat: res,
          }),
        )
        .catch(console.error)
    }
  }

  revalidatePath('/conges')
  revalidatePath('/admin/demandes')

  // ── Détection de conflit congé ↔ planning publié (cas « Antoine ») ──────
  // Le congé vient de devenir EFFECTIF (statut 'valide') : on vérifie s'il
  // chevauche une garde d'un planning déjà publié pour ce véto. La validation
  // n'est JAMAIS bloquée (le congé reste validé) — on remonte un signal au front.
  if (conge && debutEffectif && finEffective) {
    let cabinetId: string | null = null
    try {
      cabinetId = await resoudreCabinetId(supabase)
    } catch {
      // Pas de cabinet résolu → on n'alerte pas, mais la validation reste OK.
      cabinetId = null
    }
    if (cabinetId) {
      const conflit = await detecterConflit(
        supabase,
        cabinetId,
        conge.veterinaire_id,
        debutEffectif,
        finEffective,
      )
      if (conflit) return { success: true, conflit }
    }
  }

  return { success: true }
}

export async function refuserConge(id: string, raison?: string) {
  const supabase = await createClient()

  // Récupère les données du congé + vet AVANT la mise à jour (pour l'email)
  const { data: conge } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin, type, creneau')
    .eq('id', id)
    .single()

  const { error } = await supabase
    .from('conges')
    .update({ statut: 'refuse', raison_refus: raison ?? null })
    .eq('id', id)

  if (error) return { error: error.message }

  // Notification email
  if (conge) {
    const { data: vet } = await supabase
      .from('veterinaires')
      .select('email, prenom, nom')
      .eq('id', conge.veterinaire_id)
      .single()

    if (vet) {
      const expediteur = await chargerExpediteurCabinet(supabase)
      sendBrevoEmail({
        to: vet.email,
        toName: `${vet.prenom} ${vet.nom}`,
        subject: 'Votre demande n\'a pas pu être acceptée — GuardVeto',
        htmlContent: emailCongeRefuse({
          prenom: vet.prenom,
          type: conge.type,
          creneau: conge.creneau,
          date_debut: conge.date_debut,
          date_fin: conge.date_fin,
          raison: raison ?? null,
          signature: expediteur.fromName,
        }),
        ...expediteur,
      })
        .then((res) =>
          journaliserEmailConge(supabase, {
            type: 'conge_refuse',
            destinataire: vet.email,
            veterinaire_id: conge.veterinaire_id,
            resultat: res,
          }),
        )
        .catch(console.error)
    }
  }

  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}
