// ============================================================
// GUARDVETO — Notifications IN-APP (la cloche)
// ============================================================
// C2 — Pendant in-app des emails Brevo (src/lib/notifications.ts).
//
// Chaque événement qui envoie déjà un email crée AUSSI une notif in-app, via
// `creerNotification`. Best-effort : une erreur d'insertion est loguée mais ne
// bloque JAMAIS l'appelant (publication, modif, crise…) — exactement comme les
// emails.
//
// Le contenu (titre / message) est centralisé ici (builders `contenu*`) pour
// garder une voix cohérente sur toutes les notifs (rédaction NORA). Le `lien`
// pointe vers l'écran interne concerné.
//
// SÉCURITÉ : l'insertion résout le cabinet_id du véto destinataire pour
// respecter l'isolation multi-cabinet (RLS RESTRICTIVE). La RLS de lecture
// (get_veterinaire_id) garantit que chacun ne reçoit QUE ses notifs, y compris
// en Realtime.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// Types d'événements notifiables (alignés sur email_log.type).
// Liste volontairement ouverte : de nouveaux types viendront avec l'app
// (cf. audit notifs prévu en fin de développement).
export type NotifType =
  | 'planning_publie'
  | 'garde_modifiee'
  | 'rappel_publication'
  | 'appel_volontaires'
  | 'depannage_confirme'

interface CreerNotifParams {
  /** Véto destinataire (propriétaire de la notif). */
  veterinaireId: string
  type: NotifType
  titre: string
  message: string
  /** Lien interne optionnel vers l'écran concerné (ex: '/planning'). */
  lien?: string | null
  /**
   * cabinet_id du destinataire. Si non fourni, il est résolu depuis la table
   * veterinaires. Le fournir (quand on l'a déjà chargé) évite une requête.
   */
  cabinetId?: string | null
}

// ── Helpers de date ───────────────────────────────────────────
function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function roleLabel(role: 'premier' | 'second'): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

function typeGardeLabel(type: string): string {
  switch (type) {
    case 'weekend': return 'week-end'
    case 'ferie':   return 'jour férié'
    default:        return 'semaine'
  }
}

// ============================================================
// Builders de contenu (voix NORA) — un par événement
// ============================================================

export function contenuPlanningPublie(periodeLabel: string, nbGardes: number) {
  const gardesTxt =
    nbGardes === 0
      ? "Vous n'avez aucune garde sur cette période."
      : nbGardes === 1
        ? 'Vous avez 1 garde sur cette période.'
        : `Vous avez ${nbGardes} gardes sur cette période.`
  return {
    titre: 'Nouveau planning publié',
    message: `Le planning « ${periodeLabel} » est en ligne. ${gardesTxt}`,
    lien: '/planning',
  }
}

export function contenuGardeModifiee(date: string, typeGarde: string) {
  return {
    titre: 'Une de vos gardes a changé',
    message: `Votre garde du ${formatDateFr(date)} (${typeGardeLabel(typeGarde)}) a été modifiée. Vérifiez votre planning.`,
    lien: '/planning',
  }
}

export function contenuRappelPublication(periodeLabel: string, joursRestants: number) {
  const urgence = joursRestants <= 7
  const joursTxt = `${joursRestants} jour${joursRestants > 1 ? 's' : ''}`
  return {
    titre: urgence ? '⚠️ Planning à publier — urgent' : 'Pensez à publier le planning',
    message: `La période « ${periodeLabel} » commence dans ${joursTxt} et n'est pas encore publiée. Générez et publiez le planning dès que possible.`,
    lien: '/planning',
  }
}

export function contenuAppelVolontaires(
  date: string,
  typeGarde: string,
  role: 'premier' | 'second',
  absentPrenom: string | null,
) {
  const causeTxt = absentPrenom ? `Suite à l'absence de ${absentPrenom}, une` : 'Une'
  return {
    titre: 'Garde à pourvoir',
    message: `${causeTxt} garde du ${formatDateFr(date)} (${typeGardeLabel(typeGarde)}, ${roleLabel(role)}) cherche un volontaire. Le premier qui se déclare l'emporte.`,
    lien: '/planning',
  }
}

export function contenuDepannageConfirme(
  date: string,
  typeGarde: string,
  role: 'premier' | 'second',
) {
  return {
    titre: 'Merci — garde confirmée',
    message: `Vous assurez désormais la garde du ${formatDateFr(date)} (${typeGardeLabel(typeGarde)}, ${roleLabel(role)}). Elle apparaît dans votre planning.`,
    lien: '/planning',
  }
}

// ============================================================
// Insertion
// ============================================================

/**
 * Crée une notif in-app pour un véto. Best-effort : ne lève jamais.
 *
 * @param supabase client serveur (RLS-aware en contexte admin, ou service_role
 *                 pour les contextes sans session — cron, dépannage volontaire).
 */
export async function creerNotification(
  supabase: SupabaseClient,
  params: CreerNotifParams,
): Promise<void> {
  try {
    let cabinetId = params.cabinetId ?? null

    // Résout le cabinet du destinataire si non fourni (isolation multi-cabinet).
    if (cabinetId === undefined || cabinetId === null) {
      const { data: vet } = await supabase
        .from('veterinaires')
        .select('cabinet_id')
        .eq('id', params.veterinaireId)
        .single()
      cabinetId = (vet?.cabinet_id as string | null) ?? null
    }

    const { error } = await supabase.from('notifications').insert({
      cabinet_id:     cabinetId,
      veterinaire_id: params.veterinaireId,
      type:           params.type,
      titre:          params.titre,
      message:        params.message,
      lien:           params.lien ?? null,
    })

    if (error) {
      console.error(`[notif-inapp] Erreur insertion (${params.type} → ${params.veterinaireId}):`, error.message)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[notif-inapp] Exception (${params.type} → ${params.veterinaireId}):`, msg)
  }
}
