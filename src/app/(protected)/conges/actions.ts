'use server'

import { createClient } from '@/lib/supabase/server'
import { programmerAgendasPerso } from '@/lib/agenda-perso/declencher'
import { refusSiBloquant } from '@/data/controleImpact'
import type { Impact } from '@/data/controleImpact'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { exigerIdentite } from '@/lib/identite'
import { revalidatePath } from 'next/cache'
// ── B-165c — `/planning` MANQUAIT AUX CINQ REVALIDATIONS DE CE FICHIER ──────
//
// 🔴 Les congés y étaient revalidés sur `/conges`, `/absences` et
//    `/admin/demandes` — jamais sur `/planning`. Or la grille du planning lit
//    les congés (`absencesGrille`, les compteurs) et, depuis B-165, le tableau
//    de bord d'une journée y affiche sa rangée des absents.
//
// ⚠️ LE DÉFAUT NE SE VOYAIT PAS, ET C'EST POURQUOI IL A DURÉ. Les deux écrans
//    qui posaient des congés jusqu'ici (`CongesList`, `AbsencesV2`) ne sont
//    PAS `/planning` : on ne regardait jamais la grille au moment où elle
//    devenait fausse. On la retrouvait plus tard, rafraîchie par autre chose,
//    sans jamais faire le lien. Le chemin ouvert par B-165c, lui, pose un
//    congé DEPUIS le planning et revient dessus — il rend le trou visible
//    immédiatement.
//
// 🔑 Les cinq sont corrigés, pas seulement la création. Valider ou refuser une
//    demande depuis l'écran Demandes laissait la grille tout aussi périmée ;
//    ne réparer que mon chemin aurait laissé le défaut en place sous une forme
//    plus difficile à retrouver.
import { sendBrevoEmail, emailCongeValide, emailCongeRefuse } from '@/lib/brevo'
import { adresseUtilisable } from '@/lib/emails/destinataire'
import {
  detecterConflitPlanningPublie,
  detecterConflitsPourDecision,
} from '@/lib/conges/detection-conflit'
import { sendCongeDemande } from '@/lib/notifications'
import { chargerReglagesEmail } from '@/lib/notifications-reglages'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { CreneauConge, TypeConge } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'
// B-160 — un conge accorde retire les presences de journee deja posees.
import { retirerPresencesCouvertes } from '@/lib/journee/absence-retire-presences'
// B-163 — l'unique autorité sur ce qu'une absence couvre.
import {
  PERIMETRE_PAR_DEFAUT,
  lirePerimetre,
  toucheLesGardes,
  validerPerimetre,
  type PerimetreAbsence,
} from '@/lib/absences/perimetre'

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
  /**
   * ⚠️ MORT DEPUIS B-043, CONSERVÉ POUR NE RIEN CASSER. Écrit `null` par le
   *    formulaire. Le champ vivant est `perimetre` juste en dessous.
   */
  creneau: CreneauConge | null
  /**
   * CE QUE L'ABSENCE COUVRE (B-163) — la demande du 13/10 : « au moment de
   * poser un congé ou une absence ça doit apparaître dans la fenêtre ».
   *
   * Optionnel parce que des appelants anciens (Filou, imports) construisent
   * encore cet objet sans lui ; replié sur `journee-et-nuit`, soit le
   * comportement d'avant ce lot. Un oubli ne libère jamais une garde.
   */
  perimetre?: PerimetreAbsence
  /** Les bornes du `ponctuel`, et de lui seul. Ignorées pour les autres. */
  heure_debut?: string | null
  heure_fin?: string | null
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
  | {
      error: string
      success?: undefined
      conflit?: undefined
      impact?: Impact
      presencesRetirees?: undefined
    }
  /**
   * `presencesRetirees` (B-160) : combien de presences de journee ont ete
   * retirees parce que le conge les couvrait. Remonte a l'ecran pour etre DIT —
   * un planning qui change tout seul se lit comme une panne.
   */
  | {
      success: true
      error?: undefined
      conflit?: ConflitPlanning
      impact?: undefined
      presencesRetirees?: number
    }

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

  // ── B-163 — LE PÉRIMÈTRE EST VALIDÉ AVANT D'ÊTRE ÉCRIT ────────────────────
  //
  // ⚠️ LE CONTRÔLE N'EST PAS DANS LE FORMULAIRE, et c'est la leçon « trois
  //    chemins d'écriture, deux gardiens » : une validation posée seulement
  //    dans l'écran est une validation que l'URL et Filou contournent. La base
  //    garde aussi (CHECK de la migration) — trois gardiens qui disent la même
  //    chose, délibérément.
  const perim = validerPerimetre(
    data.perimetre ?? PERIMETRE_PAR_DEFAUT,
    data.heure_debut,
    data.heure_fin,
  )
  if (!perim.ok) return { error: perim.probleme }

  const { error } = await supabase.from('conges').insert({
    cabinet_id: cabinetId,
    veterinaire_id,
    date_debut: data.date_debut,
    date_fin: data.date_fin,
    type: data.type,
    creneau: data.creneau || null,
    perimetre: perim.perimetre,
    heure_debut: perim.heures?.heure_debut ?? null,
    heure_fin: perim.heures?.heure_fin ?? null,
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
  revalidatePath('/planning') // B-165c — la grille et le tableau de bord aussi (note en tête)

  // ── B-134 : prévenir l'administratrice qu'une demande vient d'arriver ──────
  // UNIQUEMENT quand c'est un véto qui pose (statut 'souhait'). Un congé posé
  // par l'admin naît validé : il n'y a pas de demande, et personne à prévenir —
  // s'envoyer un e-mail à soi-même pour une décision qu'on vient de prendre est
  // exactement le genre de bruit qui fait couper les notifications.
  //
  // Avant ce lot, poser une demande ne prévenait PERSONNE : ni e-mail, ni
  // cloche. Elle n'existait que dans le tableau des absences, à condition d'y
  // aller — et le premier cabinet abonné n'y allait pas.
  if (!isAdmin) {
    await notifierDemandeAuxAdmins(supabase, cabinetId, veterinaire_id, data)
  }

  // ── B-160a — UN CONGÉ POSÉ PAR L'ADMIN RETIRE AUSSI LES PRÉSENCES ─────────
  //
  // 🔴 LE TROU MESURÉ LE 13/10, ET LE PLUS INSTRUCTIF DU LOT. B-160 avait
  //    branché la brique sur `validerConge` (accepter un SOUHAIT de véto) et sur
  //    `POST /api/absences` — pas ici. Or `createConge` naît `statut: 'valide'`
  //    quand c'est l'admin qui pose : c'est LE chemin qu'elle utilise.
  //
  //    Preuve en base le 13/10 : congé validé du 02 au 03/11 pour
  //    Anne-Catherine, trame active le mardi, et sa présence du 03/11 toujours
  //    là. MiKL : « j'ai déclaré une absence et un congé sur un jour où elle
  //    travaille et tout va bien pour le système ».
  //
  // 🔑 LA LEÇON, TROISIÈME OCCURRENCE : on avait couvert les chemins qu'on avait
  //    SOUS LES YEUX, pas la liste des chemins. Le gardien de couverture dans
  //    `tests/lib/absence-retire-presences.test.ts` porte désormais ce
  //    fichier — il refuse qu'un chemin d'écriture oublie la brique.
  //
  // ⚠️ RIEN POUR UN SOUHAIT. Un congé non tranché ne retire aucune présence :
  //    ce serait le valider en silence.
  let presencesRetirees = 0
  if (isAdmin) {
    const r = await retirerPresencesCouvertes(supabase, {
      veterinaire_id,
      date_debut: data.date_debut,
      date_fin: data.date_fin,
      perimetre: perim.perimetre,
    })
    presencesRetirees = r.retirees
    programmerAgendasPerso(r.cabinetId) // B-173
  }

  // ── Détection de conflit congé ↔ planning publié (cas « Antoine ») ──────
  // UNIQUEMENT quand le congé est CRÉÉ déjà validé par un admin (statut 'valide').
  // Un simple souhait de véto ne déclenche RIEN ici. La détection NE BLOQUE PAS
  // (le congé est déjà enregistré — choix admin assumé) : on remonte juste un
  // signal `conflit` au front pour proposer la réparation du planning.
  //
  // ⚠️ ET UNIQUEMENT SI LE CONGÉ TOUCHE LES GARDES (B-163). Un congé « le
  //    matin » ne peut pas entrer en conflit avec une garde du soir : alerter
  //    l'admin et lui proposer de réattribuer serait l'inviter à réparer ce qui
  //    n'est pas cassé.
  if (isAdmin && toucheLesGardes(perim.perimetre)) {
    const conflit = await detecterConflit(
      supabase,
      cabinetId,
      veterinaire_id,
      data.date_debut,
      data.date_fin,
      perim.perimetre,
    )
    if (conflit) return { success: true, conflit, presencesRetirees }
  }

  // B-160a — le compte remonte à l'écran. Un planning qui change tout seul se
  // lit comme une panne : il faut que la modale puisse le DIRE.
  return { success: true, presencesRetirees }
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
  /**
   * B-163 — obligatoire ICI, sans repli, contrairement au détecteur lui-même.
   *
   * ⚠️ CE WRAPPER EST INTERNE AU FICHIER qui connaît toujours le périmètre du
   *    congé qu'il vient d'écrire ou de valider. Lui offrir un défaut aurait
   *    créé le seul endroit du lot où « oublier » reste confortable — et c'est
   *    toujours là que l'oubli se produit.
   */
  perimetre: PerimetreAbsence,
): Promise<ConflitPlanning | null> {
  const { aConflit, creneauxImpactes } = await detecterConflitPlanningPublie({
    supabase,
    cabinetId,
    veterinaireId,
    dateDebut,
    dateFin,
    perimetre,
  })
  if (!aConflit) return null
  return {
    veterinaire_id: veterinaireId,
    date_debut: dateDebut,
    date_fin: dateFin,
    creneauxImpactes,
  }
}

/**
 * recoitDecisionConge — B-134. Ce vétérinaire veut-il encore être averti par
 * e-mail quand sa demande est tranchée ?
 *
 * ⚠️ FAIL-OPEN : tout ce qui rate (cabinet non résolu, lecture impossible)
 *    répond « oui ». Un fail-closed transformerait une panne de lecture en
 *    silence sur les réponses aux congés, et personne ne remarque un e-mail qui
 *    n'arrive pas. Mieux vaut un e-mail de trop qu'un véto qui ne sait jamais
 *    que sa demande a été refusée.
 *
 * ⚠️ NE COMMANDE QUE L'E-MAIL. La décision reste visible dans l'app, quoi qu'il
 *    arrive : le réglage réduit le bruit de la boîte mail, il ne coupe pas
 *    l'information.
 */
async function recoitDecisionConge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  veterinaireId: string,
): Promise<boolean> {
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const reglages = await chargerReglagesEmail(supabase, cabinetId)
    return reglages.recoitVeto(veterinaireId, 'conge_decision')
  } catch (err) {
    console.error(
      '[conges] B-134 — préférences illisibles, l’e-mail part quand même :',
      err instanceof Error ? err.message : err,
    )
    return true
  }
}

/**
 * notifierDemandeAuxAdmins — B-134. Une demande vient d'être posée par un véto :
 * l'administratrice doit l'apprendre sans aller regarder le tableau.
 *
 * ⚠️ TOTALEMENT BEST-EFFORT. Le congé est DÉJÀ enregistré quand on arrive ici ;
 *    tout ce qui rate dans cette fonction est tracé et avalé. Faire échouer la
 *    pose d'une demande parce qu'un e-mail n'est pas parti serait un très mauvais
 *    échange — et le véto n'aurait aucun moyen de comprendre le refus.
 *
 * ⚠️ CE QUE LA DÉTECTION VOIT, SOUS L'IDENTITÉ DU VÉTO. Elle tourne avec le
 *    client du demandeur, dont la RLS ne laisse lire `periodes` que si elle est
 *    `publie` ou `verrouille`. Le seau `brouillon` du détecteur est donc
 *    toujours vide ici, par construction — et c'est sans conséquence : un
 *    brouillon n'est pas urgent (il se régénère, personne ne l'a reçu), et
 *    l'admin verra le verdict complet sur l'écran Absences, qui tourne sous SON
 *    identité. Ce qu'on cherche à signaler, c'est le cas où l'équipe a DÉJÀ reçu
 *    le planning — et celui-là, la RLS du véto le laisse parfaitement voir.
 */
async function notifierDemandeAuxAdmins(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cabinetId: string,
  veterinaireId: string,
  data: CongeFormData,
): Promise<void> {
  try {
    const { data: demandeur } = await supabase
      .from('veterinaires')
      .select('id, nom, prenom')
      .eq('id', veterinaireId)
      .maybeSingle()

    if (!demandeur) {
      console.error('[conges] B-134 — demandeur introuvable, aucun e-mail envoyé')
      return
    }

    const verdict = await detecterConflitsPourDecision({
      supabase,
      cabinetId,
      veterinaireId,
      dateDebut: data.date_debut,
      dateFin: data.date_fin,
      // B-163 — l'e-mail qui prévient l'administratrice ne doit pas annoncer un
      // conflit de garde pour une demande qui ne concerne que le matin. Une
      // alerte fausse est pire qu'une alerte absente : elle use l'attention.
      perimetre: lirePerimetre(data.perimetre),
    })

    await sendCongeDemande(supabase, {
      cabinetId,
      demandeur: demandeur as { id: string; prenom: string; nom: string },
      type: data.type,
      dateDebut: data.date_debut,
      dateFin: data.date_fin,
      commentaire: data.commentaire || null,
      gardesPubliees: verdict.publiees,
    })
  } catch (err) {
    console.error(
      '[conges] B-134 — notification de demande en échec (le congé est bien enregistré) :',
      err instanceof Error ? err.message : err,
    )
  }
}

export async function updateConge(id: string, data: CongeFormData) {
  const supabase = await createClient()

  // B-163 — le périmètre est modifiable comme les dates, et validé pareil.
  const perim = validerPerimetre(
    data.perimetre ?? PERIMETRE_PAR_DEFAUT,
    data.heure_debut,
    data.heure_fin,
  )
  if (!perim.ok) return { error: perim.probleme }

  // Le statut AVANT modification : il décide si les présences doivent bouger.
  const { data: avant } = await supabase
    .from('conges')
    .select('statut')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase
    .from('conges')
    .update({
      veterinaire_id: data.veterinaire_id,
      date_debut: data.date_debut,
      date_fin: data.date_fin,
      type: data.type,
      creneau: data.creneau || null,
      perimetre: perim.perimetre,
      heure_debut: perim.heures?.heure_debut ?? null,
      heure_fin: perim.heures?.heure_fin ?? null,
      commentaire: data.commentaire || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  // ── B-163 — DÉPLACER UN CONGÉ DÉJÀ VALIDÉ RETIRE SUR SES NOUVELLES DATES ──
  //
  // 🔑 TROU TROUVÉ EN BALAYANT LES CHEMINS, PAS EN RECETTE. B-160 couvrait la
  //    validation d'un souhait et la déclaration d'une absence ; B-160a y a
  //    ajouté la création par l'admin. Restait la MODIFICATION : élargir un
  //    congé validé du mardi au mercredi laissait la présence du mercredi en
  //    place, exactement comme le défaut d'origine.
  //
  // ⚠️ CE QUI N'EST PAS FAIT, ET QUI EST ASSUMÉ : les présences des jours qu'on
  //    QUITTE ne reviennent pas. C'est la limite écrite depuis B-160 — la
  //    brique ne repose rien, c'est l'application des trames (additive) qui
  //    repose. Rétrécir un congé puis relancer « Remplir les journées » retrouve
  //    donc le monde attendu, et aucune donnée n'est inventée au passage.
  let presencesRetirees = 0
  if ((avant as { statut?: string } | null)?.statut === 'valide') {
    const r = await retirerPresencesCouvertes(supabase, {
      veterinaire_id: data.veterinaire_id,
      date_debut: data.date_debut,
      date_fin: data.date_fin,
      perimetre: perim.perimetre,
    })
    presencesRetirees = r.retirees
    programmerAgendasPerso(r.cabinetId) // B-173
  }

  revalidatePath('/conges')
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
  revalidatePath('/admin/demandes')
  revalidatePath('/planning') // B-165c — la grille et le tableau de bord aussi (note en tête)
  return { success: true, presencesRetirees }
}

export async function deleteConge(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('conges').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/absences') // écran V2 — lecteur des mêmes congés
  revalidatePath('/admin/demandes')
  revalidatePath('/planning') // B-165c — la grille et le tableau de bord aussi (note en tête)
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
    // B-163 — `perimetre` décide ce que la décision retire, et ce que l'e-mail
    // annonce. `creneau` reste lu le temps que l'e-mail soit migré ; il vaut
    // `null` partout depuis août (B-043).
    .select('veterinaire_id, date_debut, date_fin, type, creneau, perimetre, heure_debut, heure_fin')
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

  // B-160 — LE CONGÉ ACCORDÉ RETIRE LES PRÉSENCES DE JOURNÉE DÉJÀ POSÉES.
  //
  // Jusqu'au 13/10, rien ne le faisait : l'application des trames écartait les
  // congés AU MOMENT DE LA POSE, et rien ne repassait quand le congé arrivait
  // après. Le planning montrait alors quelqu'un au cabinet un jour où il était
  // en vacances, sans qu'aucun écran ne le signale.
  //
  // ⚠️ ON UTILISE LES DATES EFFECTIVES, pas celles de la demande : l'admin peut
  //    accorder une fenêtre plus courte que celle demandée, et retirer sur la
  //    demande viderait des jours finalement travaillés.
  // ⚠️ Best-effort : un échec ici ne doit pas annuler un congé déjà accordé.
  //    Il est journalisé par la brique, et le compte revient à l'appelant.
  let presencesRetirees = 0
  if (conge?.veterinaire_id && debutEffectif && finEffective) {
    const r = await retirerPresencesCouvertes(supabase, {
      veterinaire_id: conge.veterinaire_id,
      date_debut: debutEffectif,
      date_fin: finEffective,
      // B-163 — ce que le congé couvre décide ce qui est retiré. Un congé
      // « le matin » ne vide que les tranches du matin ; un « ponctuel » ne
      // vide rien du tout.
      perimetre: lirePerimetre((conge as { perimetre?: unknown }).perimetre),
    })
    presencesRetirees = r.retirees
    programmerAgendasPerso(r.cabinetId) // B-173
  }

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
    // B-134 — et à condition que ce véto n'ait pas coupé cet e-mail dans ses
    // réglages. La décision reste visible dans l'app : on retire l'e-mail, pas
    // l'information.
    if (
      vet &&
      adresseUtilisable(vet.email) &&
      (await recoitDecisionConge(supabase, conge.veterinaire_id))
    ) {
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
          // B-163 — l'e-mail DIT le perimetre : le veto lit la decision dans sa
          // boite, pas forcement dans l'app.
          perimetre: (conge as { perimetre?: unknown }).perimetre,
          heure_debut: (conge as { heure_debut?: string | null }).heure_debut,
          heure_fin: (conge as { heure_fin?: string | null }).heure_fin,
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
  revalidatePath('/planning') // B-165c — la grille et le tableau de bord aussi (note en tête)

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
        // B-163 — le périmètre du congé qu'on vient d'accorder.
        lirePerimetre((conge as { perimetre?: unknown }).perimetre),
      )
      if (conflit) return { success: true, conflit }
    }
  }

  // B-160 — le nombre de presences retirees REMONTE a l'ecran. Un planning qui
  // change tout seul se lit comme une panne : l'admin a valide un conge, elle
  // n'a pas demande qu'on vide des journees. On le dit, meme quand le conflit
  // de garde prend la main juste au-dessus (ce cas-la a sa propre modale).
  return { success: true, presencesRetirees }
}

export async function refuserConge(id: string, raison?: string) {
  const supabase = await createClient()

  // Récupère les données du congé + vet AVANT la mise à jour (pour l'email)
  const { data: conge } = await supabase
    .from('conges')
    // B-163 — `perimetre` décide ce que la décision retire, et ce que l'e-mail
    // annonce. `creneau` reste lu le temps que l'e-mail soit migré ; il vaut
    // `null` partout depuis août (B-043).
    .select('veterinaire_id, date_debut, date_fin, type, creneau, perimetre, heure_debut, heure_fin')
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
    // échec dans le journal — et le réglage B-134 de ce véto est respecté.
    if (
      vet &&
      adresseUtilisable(vet.email) &&
      (await recoitDecisionConge(supabase, conge.veterinaire_id))
    ) {
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
          // B-163 — le refus dit ce que la demande couvrait : sans ca, le veto
          // ne sait pas s'il doit reposer une matinee ou une semaine.
          perimetre: (conge as { perimetre?: unknown }).perimetre,
          heure_debut: (conge as { heure_debut?: string | null }).heure_debut,
          heure_fin: (conge as { heure_fin?: string | null }).heure_fin,
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
  revalidatePath('/planning') // B-165c — la grille et le tableau de bord aussi (note en tête)
  return { success: true }
}
