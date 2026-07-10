// Envoi d'emails transactionnels via l'API Brevo
// Variables requises : BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME
//
// #10c (multi-cabinet) — l'expéditeur (from email + from name) peut désormais
// être porté PAR CABINET (colonnes cabinets.brevo_from_email / brevo_from_name)
// et passé en argument. À défaut, on retombe sur les variables d'env
// BREVO_FROM_EMAIL / BREVO_FROM_NAME, puis sur le défaut historique — le
// comportement du cabinet pilote (colonnes nulles) est donc inchangé.

export async function sendBrevoEmail({
  to,
  toName,
  subject,
  htmlContent,
  fromEmail,
  fromName,
}: {
  to: string
  toName: string
  subject: string
  htmlContent: string
  /** Expéditeur propre au cabinet (fallback env puis défaut si absent). */
  fromEmail?: string | null
  fromName?: string | null
}) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.warn('[Brevo] BREVO_API_KEY manquante — email non envoyé')
    return { error: 'Config email manquante' }
  }

  // D4 — plus d'expéditeur client en dur. On privilégie l'expéditeur du cabinet
  // (colonnes cabinets.brevo_*), sinon la variable d'env générique BREVO_FROM_EMAIL,
  // sinon on refuse l'envoi (mieux qu'expédier depuis l'adresse d'un autre cabinet).
  const senderEmail =
    (fromEmail?.trim() || process.env.BREVO_FROM_EMAIL?.trim() || '')
  const senderName =
    (fromName?.trim() || process.env.BREVO_FROM_NAME?.trim() || 'GuardVeto')

  if (!senderEmail) {
    console.warn('[Brevo] Aucun expéditeur configuré (cabinet.brevo_from_email / BREVO_FROM_EMAIL) — email non envoyé')
    return { error: 'Expéditeur email manquant' }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [{ email: to, name: toName }],
        subject,
        htmlContent,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[Brevo] Erreur envoi:', err)
      return { error: err }
    }

    return { success: true }
  } catch (e) {
    console.error('[Brevo] Exception:', e)
    return { error: String(e) }
  }
}

// ── Templates email ──────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
}

const TYPE_LABELS: Record<string, string> = {
  vacances: 'Vacances', formation: 'Formation', sante: 'Congé maladie',
  indisponibilite: 'Indisponibilité ponctuelle', autre: 'Autre',
}

const CRENEAU_LABELS: Record<string, string> = {
  journee: 'Journée entière', matin: 'Matin', 'apres-midi': 'Après-midi', soiree: 'Soirée',
}

export function emailCongeValide(params: {
  prenom: string
  type: string
  creneau: string | null
  date_debut: string
  date_fin: string
}) {
  const { prenom, type, creneau, date_debut, date_fin } = params
  const isIndispo = type === 'indisponibilite'
  const typeLabel = TYPE_LABELS[type] ?? type
  const periode = isIndispo
    ? `${formatDate(date_debut)}${creneau ? ` — ${CRENEAU_LABELS[creneau] ?? creneau}` : ''}`
    : `du ${formatDate(date_debut)} au ${formatDate(date_fin)}`

  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <div style="background:#1e6b8c;padding:24px 28px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">GuardVeto</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">Bonjour ${prenom},</p>
    <p style="margin:0 0 20px">Votre demande a été <strong style="color:#059669">validée</strong> par Anne-Sophie.</p>
    <div style="background:#fff;border:1px solid #d1fae5;border-left:4px solid #059669;border-radius:6px;padding:16px;margin:0 0 20px">
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Type</p>
      <p style="margin:0 0 14px;font-weight:600">${typeLabel}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Période</p>
      <p style="margin:0;font-weight:600">${periode}</p>
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px">Vous pouvez consulter vos congés directement dans GuardVeto.</p>
  </div>
</div>`
}

export function emailCongeRefuse(params: {
  prenom: string
  type: string
  creneau: string | null
  date_debut: string
  date_fin: string
  raison: string | null
}) {
  const { prenom, type, creneau, date_debut, date_fin, raison } = params
  const isIndispo = type === 'indisponibilite'
  const typeLabel = TYPE_LABELS[type] ?? type
  const periode = isIndispo
    ? `${formatDate(date_debut)}${creneau ? ` — ${CRENEAU_LABELS[creneau] ?? creneau}` : ''}`
    : `du ${formatDate(date_debut)} au ${formatDate(date_fin)}`

  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <div style="background:#1e6b8c;padding:24px 28px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">GuardVeto</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">Bonjour ${prenom},</p>
    <p style="margin:0 0 20px">Votre demande a été <strong style="color:#dc2626">refusée</strong> par Anne-Sophie.</p>
    <div style="background:#fff;border:1px solid #fee2e2;border-left:4px solid #dc2626;border-radius:6px;padding:16px;margin:0 0 20px">
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Type</p>
      <p style="margin:0 0 14px;font-weight:600">${typeLabel}</p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Période</p>
      <p style="margin:0 ${raison ? '14px' : '0'};font-weight:600">${periode}</p>
      ${raison ? `
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Motif</p>
      <p style="margin:0;font-style:italic;color:#374151">${raison}</p>
      ` : ''}
    </div>
    <p style="margin:0;color:#6b7280;font-size:13px">Si vous avez des questions, contactez Anne-Sophie directement.</p>
  </div>
</div>`
}
