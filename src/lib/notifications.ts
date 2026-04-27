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

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

// ── Types internes ────────────────────────────────────────────
interface Veterinaire {
  id: string
  nom: string
  prenom: string
  email: string
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
    : `Hiver — Période ${periode.numero}`

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

      <div style="margin-top:32px;text-align:center;">
        <a href="${appUrl()}/planning" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;display:inline-block;">
          Voir le planning complet
        </a>
      </div>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto. Pour toute question, contactez Anne-So.
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

      <div style="margin-top:24px;text-align:center;">
        <a href="${appUrl()}/planning" style="background:#d97706;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;display:inline-block;">
          Voir le planning
        </a>
      </div>

      <p style="color:#9ca3af;font-size:12px;margin-top:32px;">
        Cet email est envoyé automatiquement par GuardVeto. Pour toute question, contactez Anne-So.
      </p>
    </div>
  </div>
</body>
</html>`
}

// ── Logger interne ────────────────────────────────────────────
async function logEmail(
  supabase: SupabaseClient,
  params: {
    type: 'planning_publie' | 'garde_modifiee'
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
    : `Hiver — Période ${periode.numero}`

  // Récupérer tous les vétos actifs avec email
  const { data: vets } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, email')
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
  }

  console.log(`[notifications] Garde modifiée: ${sent} emails envoyés, ${errors} erreurs`)
  return { sent, errors }
}
