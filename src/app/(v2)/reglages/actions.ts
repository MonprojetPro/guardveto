'use server'

// ============================================================
// GUARDVETO V2 — Server action « Envoyer un e-mail de test »
// ============================================================
// POURQUOI CE FICHIER EXISTE — audit du 2026-08-14
//
// L'envoi d'e-mails était cassé en production depuis 11 jours (le serveur
// d'envoi refusait l'adresse IP de l'hébergeur) et PERSONNE ne l'avait vu :
// pour découvrir la panne, il fallait publier un planning et attendre qu'un
// vétérinaire signale n'avoir rien reçu. Un réglage d'envoi sans bouton
// d'essai, c'est un robinet qu'on ne peut ouvrir qu'en inondant la maison.
//
// CE QUE CETTE ACTION GARANTIT
//
// ① Elle emprunte EXACTEMENT le chemin des vrais envois — `sendBrevoEmail`,
//    avec l'expéditeur du cabinet, la même clé, le même point d'appel. Un test
//    qui passerait par une route à lui ne prouverait rien : il validerait le
//    test, pas l'envoi.
// ② Le destinataire n'est PAS saisissable : c'est l'adresse de l'administrateur
//    connecté, lue en base. Un champ libre serait un relais de spam ouvert, et
//    un champ de plus à rater en démonstration.
// ③ L'envoi est journalisé comme les autres, `veterinaire_id` renseigné — sans
//    quoi il n'apparaîtrait pas dans le journal juste en dessous (la RLS et le
//    filtre de l'écran bornent tous deux sur ce champ).
//
// Le message d'échec renvoyé est DÉJÀ traduit en français (`raisonEchec`) : la
// modale côté écran reprend les messages serveur mot pour mot, c'est donc ici
// que la traduction doit avoir lieu, pas dans le composant.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendBrevoEmail } from '@/lib/brevo'
import { raisonEchec } from '@/lib/emails/echec'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'

/** Le type journalisé pour un essai d'envoi. Doit figurer dans la contrainte
 *  `email_log_type_check` (migration 20260814120000). */
const TYPE_TEST = 'email_test'

function corpsEmailTest(prenom: string, quand: string): string {
  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <div style="background:#1e6b8c;padding:24px 28px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">GuardVeto</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">Bonjour ${prenom},</p>
    <p style="margin:0 0 20px">
      Cet e-mail est un <strong>essai</strong>, envoyé depuis l'écran Réglages de GuardVeto.
    </p>
    <div style="background:#fff;border:1px solid #d1fae5;border-left:4px solid #059669;border-radius:6px;padding:16px;margin:0 0 20px">
      <p style="margin:0;font-weight:600">Si tu lis ces lignes, la tuyauterie fonctionne.</p>
      <p style="margin:8px 0 0;color:#6b7280;font-size:13px">
        Les plannings publiés, les changements de garde et les réponses aux congés
        partiront par le même chemin.
      </p>
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px">Essai demandé le ${quand}.</p>
  </div>
</div>`
}

/**
 * Envoie un e-mail d'essai à l'administrateur connecté, par le chemin réel.
 *
 * Retourne l'adresse touchée en cas de succès (l'écran l'affiche : « envoyé à
 * … » vaut mieux qu'un « c'est parti » qui ne dit pas où), et un message déjà
 * traduit en cas d'échec.
 */
export async function envoyerEmailDeTest(): Promise<
  { success: true; destinataire: string } | { error: string }
> {
  const supabase = await createClient()

  // ── Garde admin (jamais seulement le masquage côté écran) ──────────────
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, email, role_app, actif')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  const vet = moi as {
    id: string
    prenom: string
    nom: string
    email: string | null
    role_app: string
  } | null

  if (!vet) return { error: 'Non authentifié.' }
  if (vet.role_app !== 'admin') {
    return { error: "Réservé à l'administrateur du cabinet." }
  }

  // Le destinataire vient de la BASE, jamais du client.
  const destinataire = (vet.email ?? '').trim()
  if (!destinataire) {
    return {
      error:
        "Ta fiche n'a pas d'adresse e-mail — l'essai n'a nulle part où aller. Renseigne-la sur la page Équipe.",
    }
  }

  // ── Expéditeur du cabinet (repli env géré dans sendBrevoEmail) ─────────
  const { data: cabinetDb } = await supabase
    .from('cabinets')
    .select('brevo_from_email, brevo_from_name')
    .limit(1)
    .maybeSingle()

  const cab = (cabinetDb ?? {}) as { brevo_from_email?: string | null; brevo_from_name?: string | null }

  const quand = new Date().toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  // ── L'envoi, par le chemin des vrais e-mails ───────────────────────────
  const resultat = await sendBrevoEmail({
    to: destinataire,
    toName: `${vet.prenom} ${vet.nom}`,
    subject: 'GuardVeto — essai d’envoi',
    htmlContent: corpsEmailTest(vet.prenom, quand),
    fromEmail: cab.brevo_from_email,
    fromName: cab.brevo_from_name,
  })

  const erreurBrute = 'error' in resultat ? (resultat.error ?? null) : null

  // ── Journalisation, best-effort ────────────────────────────────────────
  // Best-effort ASSUMÉ, comme `journaliserEmailConge` : si la trace échoue,
  // l'envoi a quand même eu lieu, et c'est CE fait-là qui intéresse
  // l'administrateur. Une trace ratée ne doit pas faire croire à un envoi raté.
  // ⚠️ Supabase RETOURNE ses erreurs, il ne les lève pas : un `try/catch` seul
  // transformerait un refus de contrainte en silence, et la ligne manquante
  // passerait pour « rien ne s'est envoyé ». On lit donc `error` explicitement.
  try {
    const { error: erreurLog } = await supabase.from('email_log').insert({
      type: TYPE_TEST,
      destinataire,
      veterinaire_id: vet.id,
      statut: erreurBrute ? 'erreur' : 'envoye',
      // Le BRUT, comme toutes les autres lignes du journal (cf. notifications.ts).
      // La traduction est le travail de l'AFFICHAGE : stocker déjà traduit
      // ferait repasser le texte dans `raisonEchec` au rendu, qui ne
      // reconnaîtrait plus rien et le tronquerait.
      erreur: erreurBrute,
      // La prise du webhook (`/api/webhooks/brevo`) sur ce message : c'est par
      // cet identifiant qu'un « rejeté » annoncé plus tard retrouve sa ligne.
      // Sans lui, l'essai resterait « Parti » même refusé — exactement ce qui
      // s'est produit le 2026-08-21.
      resend_id: 'messageId' in resultat ? resultat.messageId : null,
    })
    if (erreurLog) {
      console.error(
        `[reglages] Essai d’envoi non journalisé (${erreurLog.message}) — la migration 20260814120000 qui autorise le type « ${TYPE_TEST} » est-elle appliquée ?`,
      )
    }
  } catch (e) {
    console.error('[reglages] Journalisation de l’essai d’envoi échouée:', e)
  }

  revalidatePath('/reglages')

  if (erreurBrute) return { error: raisonEchec(erreurBrute) }
  return { success: true, destinataire }
}

// ============================================================
// GUARDVETO V2 — Server action « Réglages d'affichage de l'agenda Google »
// ============================================================
// Chantier agenda Google (2026-08-27). Trois choses réglées d'un coup, parce
// qu'elles vivent sur le même écran et s'enregistrent ensemble :
//   · journée entière ou horaires précis (cabinets.agenda_journee_entiere) ;
//   · horaires dans le titre (cabinets.agenda_afficher_horaires) ;
//   · la base de l'intitulé PAR CRÉNEAU (creneau_modele.libelle_agenda) —
//     par créneau et non un mot unique pour tout le cabinet : en V3 le
//     produit gère aussi le planning de JOURNÉE, un mot unique figerait
//     « garde » pour des créneaux qui n'en seront pas (décision de MiKL,
//     voir le commentaire de `CreneauModele.libelleAgenda`).
//
// ⚠️ ASYMÉTRIE DÉLIBÉRÉE DES DEUX ÉCRITURES CI-DESSOUS — élément à vérifier
// à l'application de la migration `20260827180000_agenda_google_socle` :
//   · `creneau_modele` porte une policy RLS `admin_write` (comme
//     `regles_cabinet`, `equite_cabinet`…) : un `.update()` direct, borné par
//     `assertAdmin` + `cabinet_id`, est le même chemin que
//     `admin/structure/actions.ts` prend déjà pour cette table.
//   · `cabinets` n'a AUCUNE policy UPDATE pour `authenticated` (voir
//     20260616140000_add_cabinets.sql : « réservées au service_role »).
//     C'est pour ça que les deux réglages voisins de cet écran
//     (`configurerPartagesCabinet`, `configurerAdresseCabinet`) passent par
//     un RPC SECURITY DEFINER plutôt qu'un `.update()`. La migration du
//     20260827180000 pose les DEUX colonnes `agenda_journee_entiere` /
//     `agenda_afficher_horaires` mais AUCUN rpc pour les écrire : ce
//     `.rpc('configurer_agenda_cabinet', …)` suit donc le nom que porterait
//     un tel RPC s'il existait — IL RESTE À CRÉER (SOCLE ou migration
//     dédiée) avant que ce bouton fonctionne en base. Tant qu'il manque,
//     l'appel échoue proprement (Postgrest renvoie une fonction introuvable),
//     ça ne s'installe pas en silence.
// ============================================================

/** Un intitulé de créneau à enregistrer. `libelle` vide = on revient au `nom`
 *  du créneau (NULL en base) — même logique que le nom d'un véto dans
 *  Google Agenda (`libelle_agenda`, `admin/veterinaires/actions.ts`). */
export interface LibelleCreneauAEnregistrer {
  creneauId: string
  libelle: string
}

export interface AgendaAffichageFormData {
  journeeEntiere: boolean
  afficherHoraires: boolean
  libellesCreneaux: LibelleCreneauAEnregistrer[]
}

async function assertAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ error: string } | { ok: true }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()
  if (!vet) return { error: 'Non authentifié.' }
  if ((vet as { role_app: string }).role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }
  return { ok: true }
}

/** `''` → `null` (retombe sur `creneau_modele.nom`), sinon la chaîne bornée. */
function normaliserLibelleCreneau(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t.slice(0, 60)
}

export async function configurerAgendaAffichage(
  data: AgendaAffichageFormData,
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return { error: garde.error }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // ── 1. Journée entière / horaires précis, et horaires dans le titre ────
  // Voir l'avertissement en tête de fichier : ce RPC n'existe pas encore.
  const { error: erreurCabinet } = await supabase.rpc('configurer_agenda_cabinet', {
    p_journee_entiere: data.journeeEntiere,
    p_afficher_horaires: data.afficherHoraires,
  })
  if (erreurCabinet) return { error: erreurCabinet.message }

  // ── 2. La base de l'intitulé, par créneau ───────────────────────────────
  // `creneau_modele` a une policy admin_write : direct .update(), borné par
  // cabinet_id (double barrière avec la RLS, comme le reste du projet) et
  // profil_id IS NULL — seul le SOCLE porte ce libellé, jamais une période
  // type qui affine (cf. `chargerCreneauModele`, « le socle donne l'ensemble
  // des possibilités »).
  for (const { creneauId, libelle } of data.libellesCreneaux) {
    const { error } = await supabase
      .from('creneau_modele')
      .update({ libelle_agenda: normaliserLibelleCreneau(libelle) })
      .eq('id', creneauId)
      .eq('cabinet_id', cabinetId)
      .is('profil_id', null)
    if (error) return { error: error.message }
  }

  revalidatePath('/reglages')
  return { success: true }
}
