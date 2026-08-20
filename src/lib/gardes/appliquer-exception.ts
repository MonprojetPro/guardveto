// ============================================================
// GUARDVETO — Helper : poser une EXCEPTION sur UN SEUL jour d'une garde
// ============================================================
// Backlog 8 bis. Pendant de `appliquerChangementGarde`, mais à la maille du
// JOUR au lieu du bloc.
//
// LE CAS. Une garde de week-end est une ligne unique posée le samedi qui
// occupe vendredi, samedi et dimanche. Un vétérinaire peut avoir un
// empêchement sur UN de ces jours sans que le week-end entier soit à
// redistribuer. Jusqu'ici c'était impossible : tous les flux opéraient sur le
// bloc, donc changer le dimanche changeait aussi le vendredi et le samedi.
//
// CE QU'ON ÉCRIT. Rien dans `gardes`. La garde reste intacte — c'est elle qui
// porte l'équité, le roulement et l'avantage financier du 1er week-end. On
// pose une ligne dans `gardes_exceptions` qui dit « ce jour-là, sur ce rôle,
// c'est untel ». La vue `planning_semaine` s'en charge à l'affichage, et tous
// ses lecteurs suivent.
//
// ÉQUITÉ (règle MiKL, 2026-08-20). Un jour exceptionnel ne change RIEN aux
// compteurs — sauf s'il s'agit d'un dépannage. Ici, rien à faire pour
// l'obtenir : les compteurs lisent `gardes`, que l'exception ne touche pas.
// La seule exception à l'exception est l'avantage financier du 1er de garde,
// que l'admin tranche explicitement (`compte1erWe`) au moment du geste.
//
// CE QU'ON NE FAIT PAS. Aucun contrôle d'auth ni de cabinet : l'appelant (la
// route) DOIT avoir validé admin + cabinet AVANT — même contrat que
// `appliquerChangementGarde`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { syncGardeIndividuelle } from '@/lib/sync-calendrier'
import { creerNotification, contenuJourExceptionnel } from '@/lib/notifications-inapp'

export type MotifException = 'exception' | 'depannage'

export interface AppliquerExceptionParams {
  /** Client serveur (admin + cabinet déjà validés par l'appelant). */
  supabase: SupabaseClient
  /** Garde porteuse du bloc (la ligne posée le samedi, pour un week-end). */
  gardeId: string
  /** Le JOUR concerné, tel qu'il s'affiche au calendrier (ISO yyyy-mm-dd). */
  jour: string
  /** Qui tient le rôle de 1er CE JOUR-LÀ. null = place laissée vacante. */
  premier_id: string | null
  /** Qui tient le rôle de 2nd CE JOUR-LÀ. null = place laissée vacante. */
  second_id: string | null
  /**
   * Réponse de l'admin à « ce jour compte-t-il comme un jour de 1er de garde
   * (celui qui porte l'avantage financier) ? ». Jamais deviné.
   */
  compte1erWe: boolean
  /** exception = empêchement ponctuel · depannage = issu d'une crise. */
  motif: MotifException
  /** Absence à l'origine du remplacement (parcours crise). */
  absenceId?: string | null
  /** Déverrouille une garde verrouillée + trace dans audit_log. */
  force: boolean
  /** Id véto de l'auteur (audit_log + traçabilité de l'exception). */
  auteurVetId: string
}

export interface AppliquerExceptionResultat {
  ok: boolean
  status: number
  error?: string
  /** Nombre de rôles réellement modifiés sur ce jour (0 = rien à faire). */
  rolesModifies?: number
}

interface LigneVue {
  id: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
  verrouille: boolean
  periode_id: string
  periode_statut: string
}

interface ExceptionExistante {
  id: string
  role: 'premier' | 'second'
  veterinaire_id: string | null
  remplace_id: string | null
}

/**
 * appliquerExceptionJour — pose (ou retire) un remplacement exceptionnel sur
 * UN jour d'une garde, et déroule le cycle : écriture, audit, agenda, e-mail.
 *
 * Best-effort sur agenda + e-mail, comme le cycle du bloc : leurs erreurs sont
 * loguées mais ne font jamais échouer le changement — l'admin a agi, le
 * planning doit refléter son geste.
 */
export async function appliquerExceptionJour(
  params: AppliquerExceptionParams,
): Promise<AppliquerExceptionResultat> {
  const {
    supabase, gardeId, jour, premier_id, second_id,
    compte1erWe, motif, absenceId, force, auteurVetId,
  } = params

  // ── Même règle que sur le bloc : une place ne se tient pas deux fois ──
  if (premier_id && second_id && premier_id === second_id) {
    return {
      ok: false,
      status: 422,
      error:
        'Le même vétérinaire ne peut pas être à la fois 1er et 2nd de garde. Choisissez deux personnes différentes.',
    }
  }

  // ── Ce jour appartient-il vraiment à cette garde ? ────────
  //
  // On interroge la VUE, pas `gardes` : elle seule sait quels jours une garde
  // occupe réellement, en tenant compte du profil du cabinet (un vendredi
  // n'existe que si le binôme du week-end est bien lié à celui du vendredi).
  // Une date hors portée est refusée plutôt que d'écrire une exception
  // orpheline, que rien n'afficherait jamais.
  const { data: vueDb } = await supabase
    .from('planning_semaine')
    .select('id, date, type, premier_id, second_id, verrouille, periode_id, periode_statut')
    .eq('id', gardeId)
    .eq('date', jour)
    .maybeSingle()

  const ligne = vueDb as LigneVue | null
  if (!ligne) {
    return {
      ok: false,
      status: 422,
      error: "Ce jour ne fait pas partie de cette garde.",
    }
  }

  if (ligne.verrouille && !force) {
    return {
      ok: false,
      status: 422,
      error: 'Cette garde est verrouillée. Utilisez « Corriger » pour la modifier.',
    }
  }

  // ── Le cabinet, lu sur la garde (la vue ne le porte pas) ──
  const { data: gardeDb } = await supabase
    .from('gardes')
    .select('id, cabinet_id, date')
    .eq('id', gardeId)
    .single()

  const cabinetId = (gardeDb as { cabinet_id: string } | null)?.cabinet_id
  if (!cabinetId) return { ok: false, status: 404, error: 'Garde introuvable.' }

  // ── Qui était prévu ce jour-là, AVANT toute exception ─────
  //
  // La vue applique déjà les exceptions : ce qu'elle montre n'est donc pas
  // forcément le titulaire d'origine. Mais la toute première exception a figé
  // ce titulaire dans `remplace_id` — c'est lui qui fait foi ensuite. Sans
  // cette précaution, corriger deux fois le même jour ferait passer le
  // premier remplaçant pour le titulaire, et le retour à la normale
  // deviendrait impossible.
  const { data: dejaDb } = await supabase
    .from('gardes_exceptions')
    .select('id, role, veterinaire_id, remplace_id')
    .eq('garde_id', gardeId)
    .eq('date', jour)

  const deja = new Map<string, ExceptionExistante>()
  for (const e of ((dejaDb as ExceptionExistante[] | null) ?? [])) deja.set(e.role, e)

  const titulaireOrigine = (role: 'premier' | 'second'): string | null => {
    const e = deja.get(role)
    if (e) return e.remplace_id
    return role === 'premier' ? ligne.premier_id : ligne.second_id
  }

  const voulu: Record<'premier' | 'second', string | null> = {
    premier: premier_id,
    second: second_id,
  }

  // ── Écriture rôle par rôle ────────────────────────────────
  let rolesModifies = 0
  const roles: Array<'premier' | 'second'> = ['premier', 'second']

  for (const role of roles) {
    const origine = titulaireOrigine(role)
    const cible = voulu[role]
    const existante = deja.get(role)

    // Retour à la normale : la place revient à son titulaire → l'exception
    // n'a plus lieu d'être. On la SUPPRIME au lieu de la garder « neutre » :
    // une exception qui ne change rien est une trace trompeuse, et elle
    // ferait croire à un remplacement là où il n'y en a plus.
    if (cible === origine) {
      if (existante) {
        const { error } = await supabase
          .from('gardes_exceptions')
          .delete()
          .eq('id', existante.id)
        if (error) {
          return { ok: false, status: 500, error: `Suppression de l'exception impossible : ${error.message}` }
        }
        rolesModifies++
      }
      continue
    }

    // Rien à faire si l'exception existante dit déjà exactement ça (et que la
    // réponse sur l'avantage financier n'a pas changé non plus).
    if (existante && existante.veterinaire_id === cible && role !== 'premier') continue

    const payload = {
      cabinet_id: cabinetId,
      garde_id: gardeId,
      date: jour,
      role,
      veterinaire_id: cible,
      remplace_id: origine,
      motif,
      // L'avantage financier ne se pose que sur le 1er de garde ; la
      // contrainte SQL le refuserait ailleurs.
      compte_1er_we: role === 'premier' ? compte1erWe : false,
      absence_id: absenceId ?? null,
      cree_par: auteurVetId,
      mis_a_jour_le: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('gardes_exceptions')
      .upsert(payload, { onConflict: 'garde_id,date,role' })

    if (error) {
      return { ok: false, status: 500, error: `Enregistrement de l'exception impossible : ${error.message}` }
    }
    rolesModifies++
  }

  if (rolesModifies === 0) return { ok: true, status: 200, rolesModifies: 0 }

  // ── Audit : une correction sur garde verrouillée se trace ──
  if (force) {
    await supabase.from('audit_log').insert({
      cabinet_id: cabinetId,
      user_id: auteurVetId,
      action: 'exception_jour_forcee',
      table_cible: 'gardes_exceptions',
      ligne_id: gardeId,
      details: { jour, motif, compte_1er_we: compte1erWe },
    })
  }

  // ── Agenda + e-mails (best-effort, jamais bloquants) ──────
  //
  // L'agenda porte UN événement par garde : il est resynchronisé pour que sa
  // description reflète le jour modifié. Les vétérinaires concernés sont
  // prévenus par le même canal que pour une modification ordinaire — être
  // remplacé un seul jour se sait aussi bien qu'être remplacé tout un
  // week-end.
  try {
    await syncGardeIndividuelle(supabase, gardeId)
  } catch (e) {
    console.error('[exception-jour] synchro agenda échouée', e)
  }

  // Deux messages distincts : celui qu'on libère et celui qu'on engage n'ont
  // pas la même nouvelle à recevoir. Et l'un comme l'autre a besoin de savoir
  // que SEUL ce jour bouge — sinon chacun rappelle l'admin pour lui demander
  // s'il est encore de garde le reste du week-end.
  const perdent = roles.map((r) => titulaireOrigine(r)).filter((v): v is string => Boolean(v))
  const prennent = [premier_id, second_id].filter((v): v is string => Boolean(v))

  for (const vetId of new Set(perdent.filter((v) => !prennent.includes(v)))) {
    const c = contenuJourExceptionnel(jour, { prend: false })
    await creerNotification(supabase, {
      veterinaireId: vetId, cabinetId, type: 'garde_modifiee',
      titre: c.titre, message: c.message, lien: c.lien,
    })
  }

  for (const vetId of new Set(prennent.filter((v) => !perdent.includes(v)))) {
    const c = contenuJourExceptionnel(jour, { prend: true })
    await creerNotification(supabase, {
      veterinaireId: vetId, cabinetId, type: 'garde_modifiee',
      titre: c.titre, message: c.message, lien: c.lien,
    })
  }

  return { ok: true, status: 200, rolesModifies }
}
