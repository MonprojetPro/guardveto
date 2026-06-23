// ============================================================
// GUARDVETO — Notifications email (Brevo)
// ============================================================
// STORY-019 — Envoi d'emails aux vétérinaires via Brevo (ex-Sendinblue).
//
// Fonctions exportées :
//   sendPlanningPublie(supabase, periodeId)
//     → Email à tous les vétos actifs lors de la publication
//   sendGardeModifiee(supabase, gardeId, oldPremier, oldSecond)
//     → Email aux vétos concernés (ancien + nouveau) lors d'une modif
//
// Variables d'env requises :
//   BREVO_API_KEY       — Clé API Brevo (Paramètres > SMTP & API > API)
//   BREVO_FROM_EMAIL    — Email expéditeur vérifié dans Brevo
//   BREVO_FROM_NAME     — Nom affiché (optionnel, défaut : "GuardVeto")
//
// Comportement : best-effort — les erreurs d'envoi sont loguées
// dans la table email_log mais ne bloquent JAMAIS la publication.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  creerNotification,
  contenuPlanningPublie,
  contenuGardeModifiee,
  contenuRappelPublication,
  contenuAppelVolontaires,
  contenuDepannageConfirme,
} from './notifications-inapp'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

// ── Types internes ────────────────────────────────────────────
interface Veterinaire {
  id: string
  nom: string
  prenom: string
  email: string
  cabinet_id?: string | null
}

interface Garde {
  id: string
  date: string
  type: string
  premier: Veterinaire | null
  second: Veterinaire | null
}

// ── Helpers ───────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00Z')
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function typeLabel(type: string): string {
  switch (type) {
    case 'weekend': return 'Week-end'
    case 'ferie':   return 'Jour férié'
    default:        return 'Semaine'
  }
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://guardveto.vercel.app'
}

// ── Envoi via API Brevo (fetch) ───────────────────────────────
async function sendViaBrevo(params: {
  to: { email: string; name: string }[]
  subject: string
  html: string
}): Promise<string | null> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    throw new Error('BREVO_API_KEY non définie')
  }

  const fromEmail = process.env.BREVO_FROM_EMAIL
  if (!fromEmail) {
    throw new Error('BREVO_FROM_EMAIL non définie')
  }

  const fromName = process.env.BREVO_FROM_NAME ?? 'GuardVeto'

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'accept':       'application/json',
      'api-key':      apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender:  { name: fromName, email: fromEmail },
      to:      params.to,
      subject: params.subject,
      htmlContent: params.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Brevo HTTP ${res.status}: ${body}`)
  }

  const json = await res.json() as { messageId?: string }
  return json.messageId ?? null
}

// ── Email : Nouveau planning publié ──────────────────────────
function buildPlanningPublieHtml(
  vet: Veterinaire,
  periode: { saison: string; numero: number | null; date_debut: string; date_fin: string },
  gardes: Garde[]
): string {
  const periodeLabel = periode.saison === 'ete'
    ? 'Été'
    : periode.numero ? `Hiver — Période ${periode.numero}` : 'Hiver'

  const gardeRows = gardes.length > 0
    ? gardes.map((g) => {
        const partner = g.premier?.id === vet.id ? g.second : g.premier
        const partnerText = partner ? ` (avec ${partner.prenom} ${partner.nom})` : ''
        return `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${formatDate(g.date)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${typeLabel(g.type)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${partnerText || '—'}</td>
        </tr>`
      }).join('')
    : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#6b7280;">Aucune garde assignée sur cette période.</td></tr>`

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#1d4ed8;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;">GuardVeto</h1>
      <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px;">Nouveau planning publié</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;">Bonjour ${vet.prenom},</p>
      <p style="color:#374151;">Le planning de gardes pour la période <strong>${periodeLabel}</strong> vient d'être publié.</p>
      <p style="color:#6b7280;font-size:13px;">Du ${formatDate(periode.date_debut)} au ${formatDate(periode.date_fin)}</p>

      <h2 style="color:#1d4ed8;font-size:16px;margin-top:32px;">Vos gardes</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:8px 12px;color:#374151;">Date</th>
            <th style="text-align:left;padding:8px 12px;color:#374151;">Type</th>
            <th style="text-align:left;padding:8px 12px;color:#374151;">Binôme</th>
          </tr>
        </thead>
        <tbody>${gardeRows}</tbody>
      </table>

      <div style="margin-top:32px;background:#f3f4f6;border-radius:8px;padding:20px 24px;">
        <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.5;">
          Pour consulter le planning complet et gérer vos disponibilités, vous pouvez à tout moment vous connecter à votre espace personnel :
        </p>
        <p style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#1d4ed8;word-break:break-all;">${appUrl()}</p>
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
          Copiez cette adresse dans votre navigateur, puis connectez-vous avec votre adresse email professionnelle.
        </p>
      </div>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto. Pour toute question, contactez votre administrateur.
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── Email : Garde modifiée ────────────────────────────────────
function buildGardeModifieeHtml(
  vet: Veterinaire,
  garde: { date: string; type: string },
  oldPremier: Veterinaire | null,
  oldSecond: Veterinaire | null,
  newPremier: Veterinaire | null,
  newSecond: Veterinaire | null,
): string {
  const formatVet = (v: Veterinaire | null) =>
    v ? `${v.prenom} ${v.nom}` : '—'

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#d97706;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;">GuardVeto</h1>
      <p style="margin:8px 0 0;color:#fde68a;font-size:14px;">Garde modifiée</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;">Bonjour ${vet.prenom},</p>
      <p style="color:#374151;">Une garde du planning a été modifiée par l'administrateur.</p>

      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:16px;margin:24px 0;">
        <p style="margin:0 0 8px;color:#92400e;font-weight:bold;">Garde du ${formatDate(garde.date)} — ${typeLabel(garde.type)}</p>
        <table style="width:100%;font-size:14px;">
          <tr>
            <td style="color:#6b7280;padding:4px 0;width:80px;">Avant :</td>
            <td style="color:#374151;">${formatVet(oldPremier)}${oldSecond ? ` + ${formatVet(oldSecond)}` : ''}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;padding:4px 0;">Après :</td>
            <td style="color:#374151;font-weight:bold;">${formatVet(newPremier)}${newSecond ? ` + ${formatVet(newSecond)}` : ''}</td>
          </tr>
        </table>
      </div>

      <div style="margin-top:24px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:20px 24px;">
        <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.5;">
          Pour voir le détail de votre planning à jour, vous pouvez vous connecter à votre espace personnel :
        </p>
        <p style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#d97706;word-break:break-all;">${appUrl()}</p>
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
          Copiez cette adresse dans votre navigateur, puis connectez-vous avec votre adresse email professionnelle.
        </p>
      </div>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto. Pour toute question, contactez votre administrateur.
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── Email : Rappel de publication ────────────────────────────
function buildRappelPublicationHtml(
  admin: Veterinaire,
  periode: { saison: string; numero: number | null; date_debut: string },
  joursRestants: number,
): string {
  const periodeLabel = periode.saison === 'ete'
    ? 'Été'
    : periode.numero ? `Hiver — Période ${periode.numero}` : 'Hiver'

  const urgence = joursRestants <= 7

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${urgence ? '#dc2626' : '#d97706'};padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;">GuardVeto</h1>
      <p style="margin:8px 0 0;color:${urgence ? '#fecaca' : '#fde68a'};font-size:14px;">
        ${urgence ? '⚠️ Rappel urgent — publication requise' : '🔔 Rappel de publication'}
      </p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;">Bonjour ${admin.prenom},</p>
      <p style="color:#374151;">
        La période <strong>${periodeLabel}</strong> commence le
        <strong>${formatDate(periode.date_debut)}</strong>
        et <strong>le planning n'est pas encore publié</strong>.
      </p>

      <div style="background:${urgence ? '#fef2f2' : '#fffbeb'};border:1px solid ${urgence ? '#fca5a5' : '#fcd34d'};border-radius:6px;padding:16px;margin:24px 0;">
        <p style="margin:0;color:${urgence ? '#991b1b' : '#92400e'};font-weight:bold;font-size:15px;">
          ⏰ Il reste <strong>${joursRestants} jour${joursRestants > 1 ? 's' : ''}</strong> avant le début de la période.
        </p>
      </div>

      <p style="color:#374151;">
        Pensez à générer et publier le planning dès que possible afin que les vétérinaires puissent en prendre connaissance.
      </p>

      <div style="margin-top:32px;background:${urgence ? '#fef2f2' : '#fffbeb'};border:1px solid ${urgence ? '#fca5a5' : '#fcd34d'};border-radius:8px;padding:20px 24px;">
        <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.5;">
          Pour générer et publier le planning, connectez-vous à votre espace administrateur :
        </p>
        <p style="margin:0 0 10px;font-size:16px;font-weight:bold;color:${urgence ? '#dc2626' : '#d97706'};word-break:break-all;">${appUrl()}</p>
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
          Copiez cette adresse dans votre navigateur, puis connectez-vous avec votre adresse email professionnelle.
        </p>
      </div>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto.
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── Export : Rappel de publication (admin uniquement) ─────────
export async function sendRappelPublication(
  supabase: SupabaseClient,
  periodeId: string,
  joursRestants: number,
): Promise<{ sent: number; errors: number }> {
  const { data: periode } = await supabase
    .from('periodes')
    .select('id, saison, numero, date_debut')
    .eq('id', periodeId)
    .single()

  if (!periode) {
    console.error('[notifications] Période introuvable pour rappel:', periodeId)
    return { sent: 0, errors: 0 }
  }

  const periodeLabel = periode.saison === 'ete'
    ? 'Été'
    : periode.numero ? `Hiver — Période ${periode.numero}` : 'Hiver'

  // Uniquement les admins actifs
  const { data: admins } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, email, cabinet_id')
    .eq('role_app', 'admin')
    .eq('actif', true)

  if (!admins || admins.length === 0) return { sent: 0, errors: 0 }

  const urgence = joursRestants <= 7
  const subject = urgence
    ? `[GuardVeto] ⚠️ Urgent — Planning ${periodeLabel} non publié (J-${joursRestants})`
    : `[GuardVeto] Rappel — Planning ${periodeLabel} non publié (J-${joursRestants})`

  let sent = 0
  let errors = 0

  for (const admin of admins) {
    const html = buildRappelPublicationHtml(admin, periode, joursRestants)

    try {
      const messageId = await sendViaBrevo({
        to:      [{ email: admin.email, name: `${admin.prenom} ${admin.nom}` }],
        subject,
        html,
      })

      await logEmail(supabase, {
        type: 'rappel_publication',
        destinataire: admin.email,
        veterinaire_id: admin.id,
        periode_id: periodeId,
        resend_id: messageId,
        statut: 'envoye',
      })
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[notifications] Erreur rappel_publication → ${admin.email}:`, msg)
      await logEmail(supabase, {
        type: 'rappel_publication',
        destinataire: admin.email,
        veterinaire_id: admin.id,
        periode_id: periodeId,
        statut: 'erreur',
        erreur: msg,
      })
      errors++
    }

    // Notif in-app (indépendante de l'email — créée même si Brevo échoue).
    const notif = contenuRappelPublication(periodeLabel, joursRestants)
    await creerNotification(supabase, {
      veterinaireId: admin.id,
      type: 'rappel_publication',
      titre: notif.titre,
      message: notif.message,
      lien: notif.lien,
      cabinetId: admin.cabinet_id,
    })
  }

  console.log(`[notifications] Rappel publication (J-${joursRestants}) — ${periodeLabel}: ${sent} envoyés, ${errors} erreurs`)
  return { sent, errors }
}

// ── Logger interne ────────────────────────────────────────────
async function logEmail(
  supabase: SupabaseClient,
  params: {
    type: 'planning_publie' | 'garde_modifiee' | 'rappel_publication' | 'appel_volontaires' | 'depannage_confirme'
    destinataire: string
    veterinaire_id: string | null
    periode_id?: string | null
    garde_id?: string | null
    resend_id?: string | null
    statut: 'envoye' | 'erreur'
    erreur?: string | null
  }
): Promise<void> {
  await supabase.from('email_log').insert({
    type:           params.type,
    destinataire:   params.destinataire,
    veterinaire_id: params.veterinaire_id,
    periode_id:     params.periode_id ?? null,
    garde_id:       params.garde_id ?? null,
    resend_id:      params.resend_id ?? null,
    statut:         params.statut,
    erreur:         params.erreur ?? null,
  })
}

// ── Export : Nouveau planning publié ─────────────────────────
export async function sendPlanningPublie(
  supabase: SupabaseClient,
  periodeId: string
): Promise<{ sent: number; errors: number }> {
  // Récupérer la période
  const { data: periode } = await supabase
    .from('periodes')
    .select('id, saison, numero, date_debut, date_fin')
    .eq('id', periodeId)
    .single()

  if (!periode) {
    console.error('[notifications] Période introuvable:', periodeId)
    return { sent: 0, errors: 0 }
  }

  const periodeLabel = periode.saison === 'ete'
    ? 'Été'
    : periode.numero ? `Hiver — Période ${periode.numero}` : 'Hiver'

  // Récupérer tous les vétos actifs avec email
  const { data: vets } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, email, cabinet_id')
    .eq('actif', true)

  if (!vets || vets.length === 0) return { sent: 0, errors: 0 }

  // Récupérer toutes les gardes de la période avec les vétos
  const { data: gardesRaw } = await supabase
    .from('gardes')
    .select(`
      id, date, type,
      premier:premier_id(id, nom, prenom, email),
      second:second_id(id, nom, prenom, email)
    `)
    .eq('periode_id', periodeId)
    .order('date')

  const gardes: Garde[] = (gardesRaw ?? []).map((g: Record<string, unknown>) => ({
    id:      g.id as string,
    date:    g.date as string,
    type:    g.type as string,
    premier: g.premier as Veterinaire | null,
    second:  g.second  as Veterinaire | null,
  }))

  let sent = 0
  let errors = 0

  for (const vet of vets) {
    const mesGardes = gardes.filter(
      (g) => g.premier?.id === vet.id || g.second?.id === vet.id
    )

    const html    = buildPlanningPublieHtml(vet, periode, mesGardes)
    const subject = `[GuardVeto] Nouveau planning — ${periodeLabel}`

    try {
      const messageId = await sendViaBrevo({
        to:      [{ email: vet.email, name: `${vet.prenom} ${vet.nom}` }],
        subject,
        html,
      })

      await logEmail(supabase, {
        type: 'planning_publie',
        destinataire: vet.email,
        veterinaire_id: vet.id,
        periode_id: periodeId,
        resend_id: messageId,
        statut: 'envoye',
      })
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[notifications] Erreur envoi planning_publie → ${vet.email}:`, msg)
      await logEmail(supabase, {
        type: 'planning_publie',
        destinataire: vet.email,
        veterinaire_id: vet.id,
        periode_id: periodeId,
        statut: 'erreur',
        erreur: msg,
      })
      errors++
    }

    // Notif in-app (indépendante de l'email).
    const notif = contenuPlanningPublie(periodeLabel, mesGardes.length)
    await creerNotification(supabase, {
      veterinaireId: vet.id,
      type: 'planning_publie',
      titre: notif.titre,
      message: notif.message,
      lien: notif.lien,
      cabinetId: vet.cabinet_id,
    })
  }

  console.log(`[notifications] Planning publié: ${sent} emails envoyés, ${errors} erreurs`)
  return { sent, errors }
}

// ── Export : Garde modifiée ───────────────────────────────────
export async function sendGardeModifiee(
  supabase: SupabaseClient,
  gardeId: string,
  oldPremier: Veterinaire | null,
  oldSecond: Veterinaire | null,
): Promise<{ sent: number; errors: number }> {
  // Récupérer la garde avec les nouveaux assignés
  const { data: gardeRaw } = await supabase
    .from('gardes')
    .select(`
      id, date, type,
      premier:premier_id(id, nom, prenom, email),
      second:second_id(id, nom, prenom, email)
    `)
    .eq('id', gardeId)
    .single()

  if (!gardeRaw) {
    console.error('[notifications] Garde introuvable:', gardeId)
    return { sent: 0, errors: 0 }
  }

  const garde = {
    id:      gardeRaw.id as string,
    date:    gardeRaw.date as string,
    type:    gardeRaw.type as string,
    premier: gardeRaw.premier as unknown as Veterinaire | null,
    second:  gardeRaw.second  as unknown as Veterinaire | null,
  }

  // Destinataires = vétos touchés (anciens ET nouveaux), sans doublons
  const destinatairesMap = new Map<string, Veterinaire>()
  for (const v of [oldPremier, oldSecond, garde.premier, garde.second]) {
    if (v?.id && v?.email) destinatairesMap.set(v.id, v)
  }
  const destinataires = Array.from(destinatairesMap.values())

  if (destinataires.length === 0) return { sent: 0, errors: 0 }

  const subject = `[GuardVeto] Garde modifiée — ${formatDate(garde.date)}`

  let sent = 0
  let errors = 0

  for (const vet of destinataires) {
    const html = buildGardeModifieeHtml(
      vet,
      garde,
      oldPremier,
      oldSecond,
      garde.premier,
      garde.second,
    )

    try {
      const messageId = await sendViaBrevo({
        to:      [{ email: vet.email, name: `${vet.prenom} ${vet.nom}` }],
        subject,
        html,
      })

      await logEmail(supabase, {
        type: 'garde_modifiee',
        destinataire: vet.email,
        veterinaire_id: vet.id,
        garde_id: gardeId,
        resend_id: messageId,
        statut: 'envoye',
      })
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[notifications] Erreur envoi garde_modifiee → ${vet.email}:`, msg)
      await logEmail(supabase, {
        type: 'garde_modifiee',
        destinataire: vet.email,
        veterinaire_id: vet.id,
        garde_id: gardeId,
        statut: 'erreur',
        erreur: msg,
      })
      errors++
    }

    // Notif in-app (cabinet_id résolu depuis la table — destinataires hérités).
    const notif = contenuGardeModifiee(garde.date, garde.type)
    await creerNotification(supabase, {
      veterinaireId: vet.id,
      type: 'garde_modifiee',
      titre: notif.titre,
      message: notif.message,
      lien: notif.lien,
    })
  }

  console.log(`[notifications] Garde modifiée: ${sent} emails envoyés, ${errors} erreurs`)
  return { sent, errors }
}

// ============================================================
// LOT 4 — Appel aux volontaires (Mode 2 de la gestion de crise)
// ============================================================
// L'admin, plutôt que d'IMPOSER un remplaçant, DEMANDE : il envoie un email à
// tous les vétos LÉGAUX (candidats issus de proposerReparation) pour UN créneau
// libéré par une absence. Chaque email contient un lien ABSOLU « Je prends ce
// créneau » qui pointe vers l'endpoint d'acceptation (volontaire). Le premier
// qui clique et passe les contrôles serveur emporte le créneau (anti-collision
// géré côté endpoint, pas ici).
// ============================================================

/** Rôle libéré (pour l'affichage email). */
function roleLabel(role: 'premier' | 'second'): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

/**
 * Construit le lien ABSOLU « Je prends ce créneau ».
 *
 * ⚠️ LEÇON PROJET (emails-brevo-liens-texte) : Brevo casse les liens cliquables
 * sans domaine absolu. On exige donc une URL absolue (NEXT_PUBLIC_APP_URL). Si
 * elle n'est pas disponible, on renvoie null et l'email affiche le lien EN TEXTE
 * (jamais de lien cassé / relatif).
 *
 * Le lien pointe vers une page de confirmation côté app qui POST l'endpoint
 * /api/absences/[id]/volontaire. Les identifiants nécessaires (absence, garde,
 * rôle) sont passés en query — l'endpoint REVALIDE tout côté serveur (un lien
 * partagé/forwardé ne contourne aucun contrôle : auth + cabinet + éligibilité).
 */
function buildLienVolontaire(params: {
  absenceId: string
  gardeId: string
  role: 'premier' | 'second'
}): string | null {
  // appUrl() renvoie toujours une valeur (défaut https://guardveto.vercel.app),
  // donc on a toujours un domaine absolu en pratique. On garde malgré tout la
  // garde explicite : si jamais la variable était vidée, on bascule en texte.
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) return null
  const url = new URL('/crise/volontaire', base)
  url.searchParams.set('absence', params.absenceId)
  url.searchParams.set('garde', params.gardeId)
  url.searchParams.set('role', params.role)
  return url.toString()
}

// ── Email : Appel aux volontaires ─────────────────────────────
function buildAppelVolontairesHtml(
  vet: Veterinaire,
  creneau: { date: string; type: string; role: 'premier' | 'second' },
  absent: { prenom: string; nom: string } | null,
  lien: string | null,
): string {
  const absentTxt = absent ? `${absent.prenom} ${absent.nom}` : 'un confrère'

  // Bouton si lien absolu disponible, sinon lien EN TEXTE CLAIR (jamais cassé).
  const ctaBlock = lien
    ? `<div style="text-align:center;margin:28px 0;">
         <a href="${lien}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:8px;">
           Je prends ce créneau
         </a>
       </div>
       <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;text-align:center;">
         Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
         <span style="color:#6b7280;word-break:break-all;">${lien}</span>
       </p>`
    : `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:20px 24px;margin:24px 0;">
         <p style="margin:0 0 10px;color:#065f46;font-size:14px;font-weight:bold;">Pour prendre ce créneau :</p>
         <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
           Connectez-vous à votre espace GuardVeto, ouvrez la section « Gestion de crise »
           et déclarez-vous volontaire sur la garde du ${formatDate(creneau.date)}.
         </p>
       </div>`

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#059669;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;">GuardVeto</h1>
      <p style="margin:8px 0 0;color:#a7f3d0;font-size:14px;">Appel aux volontaires</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;">Bonjour ${vet.prenom},</p>
      <p style="color:#374151;">
        Suite à l'absence imprévue de <strong>${absentTxt}</strong>, une garde
        cherche un remplaçant. Vous êtes éligible pour la couvrir.
      </p>

      <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:16px;margin:24px 0;">
        <p style="margin:0 0 6px;color:#065f46;font-weight:bold;font-size:15px;">
          ${formatDate(creneau.date)} — ${typeLabel(creneau.type)}
        </p>
        <p style="margin:0;color:#047857;font-size:14px;">Rôle à pourvoir : <strong>${roleLabel(creneau.role)}</strong></p>
      </div>

      <p style="color:#374151;font-size:14px;">
        Si vous êtes disponible, vous pouvez vous porter volontaire d'un clic.
        <strong>Le premier qui se déclare emporte le créneau</strong> — pensez à vérifier
        avant de cliquer.
      </p>

      ${ctaBlock}

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto. Si vous n'êtes plus disponible
        ou si quelqu'un a déjà pris la garde, le lien vous l'indiquera. Pour toute question,
        contactez votre administrateur.
      </p>
    </div>
  </div>
</body>
</html>`
}

/**
 * sendAppelVolontaires — envoie l'appel aux volontaires pour UN créneau libéré.
 *
 * Reçoit la liste des vétos LÉGAUX (candidats de proposerReparation, identifiés
 * par leur id) ; résout leurs emails depuis `veterinaires` (VetEngine n'a pas
 * l'email) et envoie à chacun un email avec lien ABSOLU « Je prends ce créneau ».
 *
 * Best-effort, comme les autres notifications : les erreurs d'envoi sont loguées
 * (email_log) mais ne bloquent jamais l'appelant.
 *
 * @param supabase     client serveur (RLS-aware ou service — l'appelant décide)
 * @param candidatIds  ids des vétos légaux à solliciter (déjà filtrés/validés)
 * @param creneau      le créneau libéré (gardeId, date, type DB, rôle)
 * @param absence      l'absence à l'origine (id + véto absent, pour le contexte)
 */
export async function sendAppelVolontaires(
  supabase: SupabaseClient,
  candidatIds: string[],
  creneau: { gardeId: string; date: string; type: string; role: 'premier' | 'second' },
  absence: { id: string; veterinaire_id: string },
): Promise<{ sent: number; errors: number }> {
  if (candidatIds.length === 0) return { sent: 0, errors: 0 }

  // Emails des candidats (actifs uniquement) — VetEngine ne porte pas l'email.
  const { data: candidats } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, email, cabinet_id')
    .in('id', candidatIds)
    .eq('actif', true)

  if (!candidats || candidats.length === 0) return { sent: 0, errors: 0 }

  // Véto absent (pour personnaliser le message) — best-effort.
  const { data: absent } = await supabase
    .from('veterinaires')
    .select('prenom, nom')
    .eq('id', absence.veterinaire_id)
    .single()

  const lien = buildLienVolontaire({
    absenceId: absence.id,
    gardeId: creneau.gardeId,
    role: creneau.role,
  })

  const subject = `[GuardVeto] Garde à pourvoir — ${formatDate(creneau.date)}`

  let sent = 0
  let errors = 0

  for (const vet of candidats as Veterinaire[]) {
    const html = buildAppelVolontairesHtml(
      vet,
      { date: creneau.date, type: creneau.type, role: creneau.role },
      (absent as { prenom: string; nom: string } | null) ?? null,
      lien,
    )

    try {
      const messageId = await sendViaBrevo({
        to:      [{ email: vet.email, name: `${vet.prenom} ${vet.nom}` }],
        subject,
        html,
      })

      await logEmail(supabase, {
        type: 'appel_volontaires',
        destinataire: vet.email,
        veterinaire_id: vet.id,
        garde_id: creneau.gardeId,
        resend_id: messageId,
        statut: 'envoye',
      })
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[notifications] Erreur appel_volontaires → ${vet.email}:`, msg)
      await logEmail(supabase, {
        type: 'appel_volontaires',
        destinataire: vet.email,
        veterinaire_id: vet.id,
        garde_id: creneau.gardeId,
        statut: 'erreur',
        erreur: msg,
      })
      errors++
    }

    // Notif in-app (indépendante de l'email).
    const absentObj = absent as { prenom: string; nom: string } | null
    const notif = contenuAppelVolontaires(
      creneau.date,
      creneau.type,
      creneau.role,
      absentObj?.prenom ?? null,
    )
    await creerNotification(supabase, {
      veterinaireId: vet.id,
      type: 'appel_volontaires',
      titre: notif.titre,
      message: notif.message,
      lien: notif.lien,
      cabinetId: vet.cabinet_id,
    })
  }

  console.log(`[notifications] Appel volontaires (garde ${creneau.gardeId}): ${sent} envoyés, ${errors} erreurs`)
  return { sent, errors }
}

// ── Email : Confirmation au volontaire qui a pris le créneau ──
function buildDepannageConfirmeHtml(
  vet: Veterinaire,
  creneau: { date: string; type: string; role: 'premier' | 'second' },
): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#059669;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;">GuardVeto</h1>
      <p style="margin:8px 0 0;color:#a7f3d0;font-size:14px;">Merci — créneau confirmé</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;">Bonjour ${vet.prenom},</p>
      <p style="color:#374151;">
        Merci ! Vous êtes désormais affecté·e à cette garde. Elle apparaît dans votre planning
        et a été synchronisée avec votre agenda.
      </p>

      <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:16px;margin:24px 0;">
        <p style="margin:0 0 6px;color:#065f46;font-weight:bold;font-size:15px;">
          ${formatDate(creneau.date)} — ${typeLabel(creneau.type)}
        </p>
        <p style="margin:0;color:#047857;font-size:14px;">Votre rôle : <strong>${roleLabel(creneau.role)}</strong></p>
      </div>

      <p style="color:#374151;font-size:14px;">
        Ce dépannage est tracé : votre administrateur en tiendra compte dans l'équilibrage des gardes.
      </p>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto. Pour toute question, contactez votre administrateur.
      </p>
    </div>
  </div>
</body>
</html>`
}

/**
 * sendDepannageConfirme — confirme au volontaire qu'il a bien pris le créneau.
 * Best-effort (erreur loguée, jamais bloquante pour l'endpoint).
 */
export async function sendDepannageConfirme(
  supabase: SupabaseClient,
  veterinaireId: string,
  creneau: { gardeId: string; date: string; type: string; role: 'premier' | 'second' },
): Promise<{ sent: number; errors: number }> {
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, email, cabinet_id')
    .eq('id', veterinaireId)
    .single()

  if (!vet) return { sent: 0, errors: 0 }

  const v = vet as Veterinaire

  // Notif in-app (indépendante de l'email).
  const notif = contenuDepannageConfirme(creneau.date, creneau.type, creneau.role)
  await creerNotification(supabase, {
    veterinaireId: v.id,
    type: 'depannage_confirme',
    titre: notif.titre,
    message: notif.message,
    lien: notif.lien,
    cabinetId: v.cabinet_id,
  })

  const html = buildDepannageConfirmeHtml(v, creneau)
  const subject = `[GuardVeto] Garde confirmée — ${formatDate(creneau.date)}`

  try {
    const messageId = await sendViaBrevo({
      to:      [{ email: v.email, name: `${v.prenom} ${v.nom}` }],
      subject,
      html,
    })
    await logEmail(supabase, {
      type: 'depannage_confirme',
      destinataire: v.email,
      veterinaire_id: v.id,
      garde_id: creneau.gardeId,
      resend_id: messageId,
      statut: 'envoye',
    })
    return { sent: 1, errors: 0 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[notifications] Erreur depannage_confirme → ${v.email}:`, msg)
    await logEmail(supabase, {
      type: 'depannage_confirme',
      destinataire: v.email,
      veterinaire_id: v.id,
      garde_id: creneau.gardeId,
      statut: 'erreur',
      erreur: msg,
    })
    return { sent: 0, errors: 1 }
  }
}
