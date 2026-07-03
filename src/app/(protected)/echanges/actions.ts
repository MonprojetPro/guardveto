'use server'

// ============================================================
// GUARDVETO — Échanges de gardes self-service (backlog n°2, slice 1)
// ============================================================
// Cycle : proposerEchange (véto) → accepter/refuser (confrère ciblé)
//         → valider/refuser (admin) → application du changement.
//
// L'APPLICATION passe par le chemin d'édition manuelle EXISTANT
// (`appliquerChangementGarde`) : mise à jour gardes + garde_placements +
// bilan bonus/malus + Google Agenda + email « garde modifiée » — aucun
// câblage dupliqué (règle INSPECTION DES CONSUMERS).
//
// RLS : la table echanges_gardes borne QUI peut lire/écrire (demandeur,
// cible, admin — isolation cabinet RESTRICTIVE). Les TRANSITIONS de statut
// sont validées ICI (frontière de confiance applicative).
//
// Notifications in-app : la policy INSERT de `notifications` est admin-only
// → pour notifier depuis une session véto, on utilise un client service_role
// APRÈS toutes les validations, avec cabinet_id explicite (jamais dérivé du
// client). Best-effort : un échec de notif ne casse jamais l'échange.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'
import {
  creerNotification,
  contenuEchangePropose,
  contenuEchangeAccepte,
  contenuEchangeRefuse,
  contenuEchangeValide,
  contenuEchangeRefuseAdmin,
} from '@/lib/notifications-inapp'

type Role = 'premier' | 'second'

// ── Auth helpers (même pattern que /regles, /admin/structure) ──

interface AuthVeto {
  id: string
  prenom: string
  nom: string
  role_app: string
  cabinet_id: string | null
}

async function getAuthVeto(
  supabase: SupabaseClient<any, any, any>,
): Promise<AuthVeto | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, role_app, cabinet_id')
    .eq('user_id', user.id)
    .single()
  return (vet as AuthVeto | null) ?? null
}

/** Client service_role — UNIQUEMENT pour l'insertion de notifications
 *  (policy INSERT admin-only), toujours APRÈS validation complète. */
function clientNotifs(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Chargement / validation d'une garde pour l'échange ──

interface GardeRow {
  id: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
  verrouille: boolean
  cabinet_id: string | null
  periode: { statut?: string } | { statut?: string }[] | null
}

function statutPeriode(g: GardeRow): string | undefined {
  return Array.isArray(g.periode) ? g.periode[0]?.statut : g.periode?.statut
}

function vetAuRole(g: GardeRow, role: Role): string | null {
  return role === 'premier' ? g.premier_id : g.second_id
}

function aujourdHuiISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Charge une garde et vérifie qu'elle est échangeable par `vetId` au rôle
 * donné : future, période publiée, non verrouillée, et le véto y est bien
 * assigné à ce rôle. Retourne la garde ou un message d'erreur en français.
 */
async function chargerGardeEchangeable(
  supabase: SupabaseClient<any, any, any>,
  gardeId: string,
  vetId: string,
  role: Role,
  qui: string,
): Promise<{ garde: GardeRow } | { error: string }> {
  const { data } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, verrouille, cabinet_id, periode:periode_id(statut)')
    .eq('id', gardeId)
    .single()

  const garde = data as GardeRow | null
  if (!garde) return { error: 'Garde introuvable.' }
  if (garde.date <= aujourdHuiISO()) {
    return { error: `La garde ${qui} est aujourd'hui ou déjà passée — trop tard pour l'échanger.` }
  }
  if (statutPeriode(garde) !== 'publie') {
    return { error: `La garde ${qui} n'est pas sur un planning publié.` }
  }
  if (garde.verrouille) {
    return { error: `La garde ${qui} est verrouillée : demande à l'administrateur de la modifier.` }
  }
  if (vetAuRole(garde, role) !== vetId) {
    return { error: `Cette garde ${qui} n'est pas (ou plus) assignée au bon vétérinaire sur ce rôle.` }
  }
  return { garde }
}

/** Le véto est-il en congé/indispo VALIDÉ ce jour-là ? */
async function estEnConge(
  supabase: SupabaseClient<any, any, any>,
  vetId: string,
  date: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('conges')
    .select('id')
    .eq('veterinaire_id', vetId)
    .eq('statut', 'valide')
    .lte('date_debut', date)
    .gte('date_fin', date)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

// ============================================================
// 1. PROPOSER (véto demandeur)
// ============================================================

export interface ProposerEchangePayload {
  gardeId: string
  roleDemandeur: Role
  cibleId: string
  /** Garde de la cible reprise en retour (null = cession simple). */
  gardeContrepartieId?: string | null
  roleContrepartie?: Role | null
  message?: string | null
}

export async function proposerEchange(payload: ProposerEchangePayload) {
  const supabase = await createClient()
  const moi = await getAuthVeto(supabase)
  if (!moi) return { error: 'Non authentifié.' }
  if (!moi.cabinet_id) return { error: 'Cabinet introuvable.' }

  if (payload.cibleId === moi.id) {
    return { error: 'On ne s\'échange pas une garde avec soi-même 🙂' }
  }

  // La cible existe, est active, dans MON cabinet (RLS borne déjà la lecture).
  const { data: cible } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, actif')
    .eq('id', payload.cibleId)
    .single()
  if (!cible || !(cible as { actif: boolean }).actif) {
    return { error: 'Confrère introuvable ou inactif.' }
  }

  // Ma garde : future, publiée, non verrouillée, à moi sur ce rôle.
  const resGarde = await chargerGardeEchangeable(
    supabase, payload.gardeId, moi.id, payload.roleDemandeur, 'proposée',
  )
  if ('error' in resGarde) return { error: resGarde.error }
  const maGarde = resGarde.garde

  // La cible ne doit pas déjà être sur cette garde (R21 : places distinctes).
  if (maGarde.premier_id === payload.cibleId || maGarde.second_id === payload.cibleId) {
    return { error: `${(cible as { prenom: string }).prenom} est déjà de garde ce jour-là sur ce créneau.` }
  }

  // La cible ne doit pas être en congé validé ce jour-là.
  if (await estEnConge(supabase, payload.cibleId, maGarde.date)) {
    return { error: `${(cible as { prenom: string }).prenom} est en congé validé ce jour-là.` }
  }

  // Contrepartie (échange) : la garde de la cible, mêmes vérifications
  // symétriques — et JE ne dois pas être en congé le jour de la contrepartie.
  let contrepartie: GardeRow | null = null
  if (payload.gardeContrepartieId) {
    if (!payload.roleContrepartie) return { error: 'Rôle de la garde reprise manquant.' }
    const resContre = await chargerGardeEchangeable(
      supabase, payload.gardeContrepartieId, payload.cibleId, payload.roleContrepartie, 'reprise en échange',
    )
    if ('error' in resContre) return { error: resContre.error }
    contrepartie = resContre.garde

    if (contrepartie.premier_id === moi.id || contrepartie.second_id === moi.id) {
      return { error: 'Tu es déjà de garde sur le créneau que tu veux reprendre.' }
    }
    if (await estEnConge(supabase, moi.id, contrepartie.date)) {
      return { error: 'Tu es en congé validé le jour de la garde que tu veux reprendre.' }
    }
  }

  // Anti-doublon : pas déjà un échange en cours sur cette garde + rôle.
  const { data: doublon } = await supabase
    .from('echanges_gardes')
    .select('id')
    .eq('garde_id', payload.gardeId)
    .eq('role_demandeur', payload.roleDemandeur)
    .in('statut', ['proposee', 'acceptee'])
    .limit(1)
    .maybeSingle()
  if (doublon) {
    return { error: 'Un échange est déjà en cours pour cette garde. Annule-le d\'abord si tu veux en proposer un autre.' }
  }

  const { error } = await supabase.from('echanges_gardes').insert({
    cabinet_id: moi.cabinet_id,
    garde_id: payload.gardeId,
    role_demandeur: payload.roleDemandeur,
    demandeur_id: moi.id,
    cible_id: payload.cibleId,
    garde_contrepartie_id: payload.gardeContrepartieId ?? null,
    role_contrepartie: payload.gardeContrepartieId ? payload.roleContrepartie : null,
    message: payload.message?.trim() || null,
    statut: 'proposee',
  })
  if (error) return { error: 'Impossible d\'enregistrer la proposition. Réessaie.' }

  // Notif in-app à la cible (service_role — cf. en-tête ; best-effort).
  const c = contenuEchangePropose(moi.prenom, maGarde.date, maGarde.type)
  await creerNotification(clientNotifs(), {
    veterinaireId: payload.cibleId,
    type: 'echange_propose',
    titre: c.titre,
    message: c.message,
    lien: c.lien,
    cabinetId: moi.cabinet_id,
  })

  revalidatePath('/echanges')
  return { success: true }
}

// ============================================================
// 2. ACCEPTER / REFUSER (confrère ciblé)
// ============================================================

async function chargerEchangePour(
  supabase: SupabaseClient<any, any, any>,
  echangeId: string,
) {
  const { data } = await supabase
    .from('echanges_gardes')
    .select(`
      id, cabinet_id, statut, message, motif_refus,
      garde_id, role_demandeur, demandeur_id, cible_id,
      garde_contrepartie_id, role_contrepartie,
      garde:garde_id(id, date, type),
      demandeur:demandeur_id(id, prenom, nom),
      cible:cible_id(id, prenom, nom)
    `)
    .eq('id', echangeId)
    .single()
  return data as {
    id: string
    cabinet_id: string
    statut: string
    garde_id: string
    role_demandeur: Role
    demandeur_id: string
    cible_id: string
    garde_contrepartie_id: string | null
    role_contrepartie: Role | null
    garde: { id: string; date: string; type: string } | { id: string; date: string; type: string }[] | null
    demandeur: { id: string; prenom: string; nom: string } | { id: string; prenom: string; nom: string }[] | null
    cible: { id: string; prenom: string; nom: string } | { id: string; prenom: string; nom: string }[] | null
  } | null
}

function un<T>(rel: T | T[] | null): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export async function accepterEchange(echangeId: string) {
  const supabase = await createClient()
  const moi = await getAuthVeto(supabase)
  if (!moi) return { error: 'Non authentifié.' }

  const echange = await chargerEchangePour(supabase, echangeId)
  if (!echange) return { error: 'Échange introuvable.' }
  if (echange.cible_id !== moi.id) return { error: 'Cette proposition ne t\'est pas adressée.' }
  if (echange.statut !== 'proposee') return { error: 'Cette proposition n\'est plus en attente.' }

  const garde = un(echange.garde)
  if (!garde || garde.date <= aujourdHuiISO()) {
    return { error: 'Trop tard : la garde est passée ou imminente.' }
  }

  const { error } = await supabase
    .from('echanges_gardes')
    .update({ statut: 'acceptee' })
    .eq('id', echangeId)
    .eq('statut', 'proposee') // compare-and-swap : jamais 2 transitions concurrentes
  if (error) return { error: 'Impossible d\'accepter. Réessaie.' }

  // Notifs : le demandeur + les admins (validation attendue).
  const notifs = clientNotifs()
  const versDemandeur = contenuEchangeAccepte(moi.prenom, garde.date, false)
  await creerNotification(notifs, {
    veterinaireId: echange.demandeur_id,
    type: 'echange_accepte',
    titre: versDemandeur.titre,
    message: versDemandeur.message,
    lien: versDemandeur.lien,
    cabinetId: echange.cabinet_id,
  })
  const { data: admins } = await notifs
    .from('veterinaires')
    .select('id')
    .eq('cabinet_id', echange.cabinet_id)
    .eq('role_app', 'admin')
    .eq('actif', true)
  const versAdmin = contenuEchangeAccepte(moi.prenom, garde.date, true)
  for (const a of (admins ?? []) as { id: string }[]) {
    await creerNotification(notifs, {
      veterinaireId: a.id,
      type: 'echange_accepte',
      titre: versAdmin.titre,
      message: versAdmin.message,
      lien: versAdmin.lien,
      cabinetId: echange.cabinet_id,
    })
  }

  revalidatePath('/echanges')
  return { success: true }
}

export async function refuserEchange(echangeId: string, motif?: string) {
  const supabase = await createClient()
  const moi = await getAuthVeto(supabase)
  if (!moi) return { error: 'Non authentifié.' }

  const echange = await chargerEchangePour(supabase, echangeId)
  if (!echange) return { error: 'Échange introuvable.' }
  if (echange.cible_id !== moi.id) return { error: 'Cette proposition ne t\'est pas adressée.' }
  if (echange.statut !== 'proposee') return { error: 'Cette proposition n\'est plus en attente.' }

  const { error } = await supabase
    .from('echanges_gardes')
    .update({ statut: 'refusee', motif_refus: motif?.trim() || null })
    .eq('id', echangeId)
    .eq('statut', 'proposee')
  if (error) return { error: 'Impossible de refuser. Réessaie.' }

  const garde = un(echange.garde)
  if (garde) {
    const c = contenuEchangeRefuse(moi.prenom, garde.date)
    await creerNotification(clientNotifs(), {
      veterinaireId: echange.demandeur_id,
      type: 'echange_refuse',
      titre: c.titre,
      message: c.message,
      lien: c.lien,
      cabinetId: echange.cabinet_id,
    })
  }

  revalidatePath('/echanges')
  return { success: true }
}

// ============================================================
// 3. ANNULER (demandeur, tant que non validé)
// ============================================================

export async function annulerEchange(echangeId: string) {
  const supabase = await createClient()
  const moi = await getAuthVeto(supabase)
  if (!moi) return { error: 'Non authentifié.' }

  const echange = await chargerEchangePour(supabase, echangeId)
  if (!echange) return { error: 'Échange introuvable.' }
  if (echange.demandeur_id !== moi.id) return { error: 'Seul l\'auteur de la proposition peut l\'annuler.' }
  if (echange.statut !== 'proposee' && echange.statut !== 'acceptee') {
    return { error: 'Cet échange ne peut plus être annulé.' }
  }

  const { error } = await supabase
    .from('echanges_gardes')
    .update({ statut: 'annulee' })
    .eq('id', echangeId)
    .in('statut', ['proposee', 'acceptee'])
  if (error) return { error: 'Impossible d\'annuler. Réessaie.' }

  revalidatePath('/echanges')
  return { success: true }
}

// ============================================================
// 4. VALIDER / REFUSER (admin) — la validation APPLIQUE l'échange
// ============================================================

export async function validerEchangeAdmin(echangeId: string) {
  const supabase = await createClient()
  const moi = await getAuthVeto(supabase)
  if (!moi) return { error: 'Non authentifié.' }
  if (moi.role_app !== 'admin') return { error: 'Action réservée à l\'administrateur du cabinet.' }
  if (!moi.cabinet_id) return { error: 'Cabinet introuvable.' }

  const echange = await chargerEchangePour(supabase, echangeId)
  if (!echange) return { error: 'Échange introuvable.' }
  if (echange.statut !== 'acceptee') {
    return { error: 'Seul un échange accepté par le confrère peut être validé.' }
  }

  // ── Re-vérification COMPLÈTE au moment T (le planning a pu bouger) ──
  const resGarde = await chargerGardeEchangeable(
    supabase, echange.garde_id, echange.demandeur_id, echange.role_demandeur, 'à céder',
  )
  if ('error' in resGarde) {
    return { error: `Échange inapplicable : ${resGarde.error}` }
  }
  const gardeA = resGarde.garde
  if (gardeA.premier_id === echange.cible_id || gardeA.second_id === echange.cible_id) {
    return { error: 'Échange inapplicable : le confrère est déjà sur ce créneau.' }
  }

  let gardeB: GardeRow | null = null
  if (echange.garde_contrepartie_id && echange.role_contrepartie) {
    const resContre = await chargerGardeEchangeable(
      supabase, echange.garde_contrepartie_id, echange.cible_id, echange.role_contrepartie, 'reprise en échange',
    )
    if ('error' in resContre) {
      return { error: `Échange inapplicable : ${resContre.error}` }
    }
    gardeB = resContre.garde
    if (gardeB.premier_id === echange.demandeur_id || gardeB.second_id === echange.demandeur_id) {
      return { error: 'Échange inapplicable : le demandeur est déjà sur le créneau repris.' }
    }
  }

  // ── Application via le chemin d'édition manuelle EXISTANT ──
  // (gardes + garde_placements + bilan + agenda + email hérités.)
  const nouveauxA = {
    premier_id: echange.role_demandeur === 'premier' ? echange.cible_id : gardeA.premier_id,
    second_id: echange.role_demandeur === 'second' ? echange.cible_id : gardeA.second_id,
  }
  const resA = await appliquerChangementGarde({
    supabase,
    gardeId: gardeA.id,
    premier_id: nouveauxA.premier_id,
    second_id: nouveauxA.second_id,
    force: false,
    auteurVetId: moi.id,
    cabinetId: moi.cabinet_id,
  })
  if (!resA.ok) return { error: `Application impossible : ${resA.error}` }

  if (gardeB && echange.role_contrepartie) {
    const nouveauxB = {
      premier_id: echange.role_contrepartie === 'premier' ? echange.demandeur_id : gardeB.premier_id,
      second_id: echange.role_contrepartie === 'second' ? echange.demandeur_id : gardeB.second_id,
    }
    const resB = await appliquerChangementGarde({
      supabase,
      gardeId: gardeB.id,
      premier_id: nouveauxB.premier_id,
      second_id: nouveauxB.second_id,
      force: false,
      auteurVetId: moi.id,
      cabinetId: moi.cabinet_id,
    })
    if (!resB.ok) {
      // Rollback best-effort du 1er mouvement pour ne pas laisser un demi-échange.
      await appliquerChangementGarde({
        supabase,
        gardeId: gardeA.id,
        premier_id: gardeA.premier_id,
        second_id: gardeA.second_id,
        force: false,
        auteurVetId: moi.id,
        cabinetId: moi.cabinet_id,
      })
      return { error: `Application impossible sur la garde reprise (${resB.error}). La première garde a été remise en l'état.` }
    }
  }

  const { error } = await supabase
    .from('echanges_gardes')
    .update({ statut: 'validee' })
    .eq('id', echangeId)
    .eq('statut', 'acceptee')
  if (error) {
    // Le planning est déjà à jour ; on signale seulement.
    return { error: 'Le planning a bien été modifié mais le statut de l\'échange n\'a pas pu être mis à jour. Recharge la page.' }
  }

  // Notifs aux deux vétos (l'email « garde modifiée » est déjà parti via
  // appliquerChangementGarde).
  const notifs = clientNotifs()
  const c = contenuEchangeValide(gardeA.date)
  for (const vetId of [echange.demandeur_id, echange.cible_id]) {
    await creerNotification(notifs, {
      veterinaireId: vetId,
      type: 'echange_valide',
      titre: c.titre,
      message: c.message,
      lien: c.lien,
      cabinetId: echange.cabinet_id,
    })
  }

  revalidatePath('/echanges')
  revalidatePath('/planning')
  return { success: true }
}

export async function refuserEchangeAdmin(echangeId: string, motif?: string) {
  const supabase = await createClient()
  const moi = await getAuthVeto(supabase)
  if (!moi) return { error: 'Non authentifié.' }
  if (moi.role_app !== 'admin') return { error: 'Action réservée à l\'administrateur du cabinet.' }

  const echange = await chargerEchangePour(supabase, echangeId)
  if (!echange) return { error: 'Échange introuvable.' }
  if (echange.statut !== 'acceptee' && echange.statut !== 'proposee') {
    return { error: 'Cet échange n\'est plus en attente.' }
  }

  const { error } = await supabase
    .from('echanges_gardes')
    .update({ statut: 'refusee_admin', motif_refus: motif?.trim() || null })
    .eq('id', echangeId)
    .in('statut', ['proposee', 'acceptee'])
  if (error) return { error: 'Impossible de refuser. Réessaie.' }

  const garde = un(echange.garde)
  if (garde) {
    const notifs = clientNotifs()
    const c = contenuEchangeRefuseAdmin(garde.date, motif?.trim() || null)
    for (const vetId of [echange.demandeur_id, echange.cible_id]) {
      await creerNotification(notifs, {
        veterinaireId: vetId,
        type: 'echange_refuse_admin',
        titre: c.titre,
        message: c.message,
        lien: c.lien,
        cabinetId: echange.cabinet_id,
      })
    }
  }

  revalidatePath('/echanges')
  return { success: true }
}
