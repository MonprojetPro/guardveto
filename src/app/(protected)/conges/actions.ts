'use server'

import { createClient } from '@/lib/supabase/server'
import { refusSiBloquant } from '@/data/controleImpact'
import type { Impact } from '@/data/controleImpact'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { exigerIdentite } from '@/lib/identite'
import { revalidatePath } from 'next/cache'
import { sendBrevoEmail, emailCongeValide, emailCongeRefuse } from '@/lib/brevo'
import { adresseUtilisable } from '@/lib/emails/destinataire'
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
    resultat: { error?: string; success?: boolean; messageId?: string | null }
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
      // La prise du webhook sur ce message : sans elle, la ligne resterait
      // « Partie » même après un rejet annoncé par l'expéditeur.
      resend_id: params.resultat.messageId ?? null,
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
  /**
   * `impact` accompagne un refus du contrôle d'impact (palier 3 de l'audit du
   * 2026-08-03). Sans lui, l'écran n'avait qu'une phrase : correcte, et muette
   * sur ce qu'il fallait faire ensuite. Avec, il peut ouvrir `GardienImpact`,
   * qui porte les gestes de correction.
   */
  | { error: string; success?: undefined; conflit?: undefined; impact?: Impact }
  | { success: true; error?: undefined; conflit?: ConflitPlanning; impact?: undefined }

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
    // Un congé posé par l'administratrice naît validé : la décision est prise
    // au même instant que la demande. Le laisser NULL ferait apparaître un
    // congé « validé, on ne sait quand » — l'ambiguïté que `decide_le` existe
    // justement pour lever.
    decide_le: isAdmin ? new Date().toISOString() : null,
  })

  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
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
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
  revalidatePath('/admin/demandes')
  return { success: true }
}

export async function deleteConge(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('conges').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
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
      if (refus) return { error: refus.error, impact: refus.impact }
    }
  }

  // `decide_le` date le TRAITEMENT, pas l'arrivée de la demande (`created_at`).
  // Sans lui, une demande déposée le 3 et validée le 27 n'avait qu'une date —
  // et c'était la mauvaise pour répondre à « depuis quand attend-elle ? ».
  const update: Record<string, unknown> = {
    statut: 'valide',
    valide_par,
    decide_le: new Date().toISOString(),
  }
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

    // Sans adresse (fiche pas encore invitée), il n'y a personne à qui écrire.
    // On ne tente PAS l'envoi : une tentative laisserait une ligne « erreur »
    // dans le journal, et ferait passer une situation normale pour une panne.
    if (vet && adresseUtilisable(vet.email)) {
      const adresse = vet.email
      const expediteur = await chargerExpediteurCabinet(supabase)
      sendBrevoEmail({
        to: adresse,
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
            destinataire: adresse,
            veterinaire_id: conge.veterinaire_id,
            resultat: res,
          }),
        )
        .catch(console.error)
    }
  }

  revalidatePath('/conges')
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
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

  // ⚠️ QUI a refusé n'était écrit NULLE PART. `valide_par` était renseigné à la
  // validation et laissé vide au refus : un « non » restait anonyme, alors que
  // c'est précisément la décision dont on redemande la raison des mois après.
  //
  // L'identité est résolue ICI, côté serveur, et pas reçue en paramètre comme
  // le fait `validerConge` : le client n'a pas à déclarer qui il est pour
  // signer une décision. Best-effort — une identité irrésolue ne doit pas
  // empêcher un refus, elle laisse seulement la signature vide.
  let decidePar: string | null = null
  try {
    const identite = await exigerIdentite(supabase)
    decidePar = identite.genre === 'veto' ? identite.veto.id : null
  } catch {
    decidePar = null
  }

  const { error } = await supabase
    .from('conges')
    .update({
      statut: 'refuse',
      raison_refus: raison ?? null,
      valide_par: decidePar,
      decide_le: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { error: error.message }

  // Notification email
  if (conge) {
    const { data: vet } = await supabase
      .from('veterinaires')
      .select('email, prenom, nom')
      .eq('id', conge.veterinaire_id)
      .single()

    // Même règle qu'à la validation : pas d'adresse, pas d'envoi, pas de faux
    // échec dans le journal.
    if (vet && adresseUtilisable(vet.email)) {
      const adresse = vet.email
      const expediteur = await chargerExpediteurCabinet(supabase)
      sendBrevoEmail({
        to: adresse,
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
            destinataire: adresse,
            veterinaire_id: conge.veterinaire_id,
            resultat: res,
          }),
        )
        .catch(console.error)
    }
  }

  revalidatePath('/conges')
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
  revalidatePath('/admin/demandes')
  return { success: true }
}
