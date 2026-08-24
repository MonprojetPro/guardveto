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
import { humaniserCodeGarde } from '@/lib/libelles-gardes'

// Types d'événements notifiables (alignés sur email_log.type).
// Liste volontairement ouverte : de nouveaux types viendront avec l'app
// (cf. audit notifs prévu en fin de développement).
export type NotifType =
  | 'planning_publie'
  | 'garde_modifiee'
  | 'rappel_publication'
  | 'appel_volontaires'
  | 'depannage_confirme'
  | 'incident_technique'
  | 'rappel_creation_periode'
  | 'echange_propose'
  | 'echange_accepte'
  | 'echange_refuse'
  | 'echange_valide'
  | 'echange_refuse_admin'
  | 'planning_retire'

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
    case 'semaine': return 'semaine'
    // Type SUR-MESURE (P3b) : son nom humanisé, plus jamais « semaine ».
    default:        return humaniserCodeGarde(type).toLowerCase()
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

/**
 * Un planning diffusé ne l'est plus — supprimé, ou remis en préparation.
 *
 * Le symétrique obligé de `contenuPlanningPublie` : on a prévenu l'équipe que
 * le planning était en ligne, on ne peut pas le retirer sans un mot. Chacun a
 * pu recopier ses gardes, poser un congé autour, prévenir sa famille. Le
 * silence, ici, ce serait laisser sept personnes travailler sur un planning
 * qui n'existe plus.
 *
 * @param definitif `true` = supprimé (rien à attendre) ;
 *                  `false` = repassé en préparation (une nouvelle version vient).
 */
export function contenuPlanningRetire(
  periodeLabel: string,
  quand: string,
  definitif: boolean,
) {
  return {
    titre: definitif ? 'Un planning a été supprimé' : 'Un planning est repassé en préparation',
    message: definitif
      ? `Le planning « ${periodeLabel} » (${quand}) a été supprimé par l'administrateur. `
        + `Ses gardes ne sont plus valables et ont été retirées de l'agenda du cabinet.`
      : `Le planning « ${periodeLabel} » (${quand}) a été repassé en préparation. `
        + `Ses gardes ont été retirées de l'agenda du cabinet en attendant une nouvelle version.`,
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

/**
 * Backlog 8 bis — un SEUL jour d'un bloc week-end a changé de titulaire.
 *
 * Le message dit le jour, pas la garde : « votre garde du samedi a changé »
 * serait faux quand c'est le dimanche qui bouge, et le vétérinaire irait
 * vérifier le mauvais jour. Il précise aussi que le reste du week-end ne
 * bouge pas — sans ça, chacun se demande s'il est encore de garde les autres
 * jours, et rappelle l'admin pour le lui demander.
 */
export function contenuJourExceptionnel(
  date: string,
  { prend }: { prend: boolean },
) {
  return {
    titre: prend ? 'Vous prenez une garde exceptionnelle' : 'Vous êtes remplacé·e sur une journée',
    message: prend
      ? `Vous êtes de garde le ${formatDateFr(date)}, à titre exceptionnel. Le reste du week-end est inchangé.`
      : `Quelqu'un vous remplace le ${formatDateFr(date)}. Le reste du week-end reste à votre charge.`,
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

export function contenuRappelCreationPeriode(dateFinDerniere: string, dejaFinie: boolean) {
  return dejaFinie
    ? {
        titre: '🚨 Plus aucune période de planning',
        message: `La dernière période s'est terminée le ${formatDateFr(dateFinDerniere)} et aucune ne la suit : les gardes ne sont plus planifiées. Crée la période suivante dès que possible.`,
        lien: '/historique',
      }
    : {
        titre: 'Pense à créer la période suivante',
        message: `La dernière période de planning se termine le ${formatDateFr(dateFinDerniere)} et aucune ne la suit. Crée la prochaine période pour laisser le temps de générer et publier le planning.`,
        lien: '/historique',
      }
}

// ── Contenus : échange de gardes ──────────────────────────────

export function contenuEchangePropose(
  prenomDemandeur: string,
  date: string,
  typeGarde: string,
  ouverte = false,
) {
  return ouverte
    ? {
        titre: 'Garde à reprendre — premier arrivé',
        message: `${prenomDemandeur} propose sa garde du ${formatDateFr(date)} (${typeGardeLabel(typeGarde)}) à qui peut la reprendre. Premier arrivé, premier servi — répondez depuis la page Échanges.`,
        lien: '/echanges',
      }
    : {
        titre: 'Proposition d\'échange de garde',
        message: `${prenomDemandeur} vous propose de reprendre sa garde du ${formatDateFr(date)} (${typeGardeLabel(typeGarde)}). Répondez depuis la page Échanges.`,
        lien: '/echanges',
      }
}

export function contenuEchangeAccepte(prenomCible: string, date: string, pourAdmin: boolean) {
  return pourAdmin
    ? {
        titre: 'Échange de garde à valider',
        message: `Un échange concernant la garde du ${formatDateFr(date)} a été accepté entre confrères. Il attend votre validation.`,
        lien: '/echanges',
      }
    : {
        titre: 'Échange accepté par votre confrère',
        message: `${prenomCible} a accepté votre proposition d'échange pour la garde du ${formatDateFr(date)}. Reste la validation de l'administrateur.`,
        lien: '/echanges',
      }
}

export function contenuEchangeRefuse(prenomCible: string, date: string) {
  return {
    titre: 'Échange décliné',
    message: `${prenomCible} a décliné votre proposition d'échange pour la garde du ${formatDateFr(date)}.`,
    lien: '/echanges',
  }
}

export function contenuEchangeValide(date: string) {
  return {
    titre: 'Échange de garde appliqué',
    message: `L'échange concernant la garde du ${formatDateFr(date)} a été validé : le planning est à jour.`,
    lien: '/planning',
  }
}

export function contenuEchangeRefuseAdmin(date: string, motif: string | null) {
  return {
    titre: 'Échange refusé par l\'administrateur',
    message: `L'échange concernant la garde du ${formatDateFr(date)} n'a pas été validé${motif ? ` : ${motif}` : '.'}`,
    lien: '/echanges',
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

// ============================================================
// Monitoring interne — incidents techniques (audit 2026-07-03)
// ============================================================

/**
 * Signale un incident technique aux ADMINS du cabinet via la cloche.
 *
 * Avant : un échec agenda/Brevo/placements = `console.error` dans les logs
 * Vercel que personne ne lit. Désormais l'admin est prévenu dans l'app.
 *
 * - `cabinetId` OBLIGATOIRE et filtré explicitement : les contextes
 *   service_role contournent la RLS (leçon multi-tenant — jamais de
 *   sélection d'admins sans borne cabinet).
 * - Anti-spam : si une notif `incident_technique` NON LUE avec le même titre
 *   existe déjà pour un admin (moins de 24 h), on ne double pas.
 * - Best-effort : ne lève JAMAIS (le monitoring ne doit pas casser le métier).
 */
export async function signalerIncidentTechnique(
  supabase: SupabaseClient,
  cabinetId: string,
  titre: string,
  detail: string,
): Promise<void> {
  try {
    if (!cabinetId) return

    const { data: admins } = await supabase
      .from('veterinaires')
      .select('id')
      .eq('cabinet_id', cabinetId)
      .eq('role_app', 'admin')
      .eq('actif', true)

    if (!admins || admins.length === 0) return

    const depuis = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    for (const admin of admins as { id: string }[]) {
      // Anti-spam : même incident non lu < 24 h → on ne ré-alerte pas.
      const { data: doublon } = await supabase
        .from('notifications')
        .select('id')
        .eq('veterinaire_id', admin.id)
        .eq('type', 'incident_technique')
        .eq('titre', titre)
        .eq('lu', false)
        .gte('created_at', depuis)
        .limit(1)
        .maybeSingle()
      if (doublon) continue

      await creerNotification(supabase, {
        veterinaireId: admin.id,
        type: 'incident_technique',
        titre,
        message: detail,
        lien: null,
        cabinetId,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[notif-inapp] signalerIncidentTechnique en échec (${titre}):`, msg)
  }
}
