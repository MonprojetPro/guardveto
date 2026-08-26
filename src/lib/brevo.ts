// Envoi d'emails transactionnels via l'API Brevo
// Variables requises : BREVO_API_KEY, BREVO_FROM_EMAIL, BREVO_FROM_NAME
//
// #10c (multi-cabinet) — l'expéditeur (from email + from name) peut désormais
// être porté PAR CABINET (colonnes cabinets.brevo_from_email / brevo_from_name)
// et passé en argument. À défaut, on retombe sur les variables d'env
// BREVO_FROM_EMAIL / BREVO_FROM_NAME, puis sur le défaut historique — le
// comportement du cabinet pilote (colonnes nulles) est donc inchangé.

import { adresseUtilisable } from '@/lib/emails/destinataire'

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
}): Promise<{ error: string } | { success: true; messageId: string | null }> {
  // ── Y a-t-il quelqu'un au bout ? ────────────────────────────────────────
  // Depuis que l'e-mail d'un vétérinaire est facultatif (2026-08-22), un
  // destinataire peut être vide. Ce refus est le DERNIER filet : les appelants
  // filtrent déjà en amont (cf. lib/emails/destinataire.ts) et n'arrivent
  // normalement jamais ici. Il est posé quand même, parce qu'un envoi vers `""`
  // ne plante pas franchement — il part, Brevo le rejette, et la ligne du
  // journal dit « erreur » sans dire que le problème est une fiche incomplète.
  if (!adresseUtilisable(to)) {
    console.warn('[Brevo] Destinataire sans adresse — envoi refusé avant tout appel réseau')
    return { error: 'Destinataire sans adresse' }
  }

  // `.trim()` : un retour à la ligne collé à la clé rend l'en-tête HTTP invalide.
  const apiKey = process.env.BREVO_API_KEY?.trim()
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

    // L'identifiant du message est la SEULE prise sur ce qu'il devient ensuite :
    // c'est par lui que `/api/webhooks/brevo` retrouve la ligne du journal quand
    // Brevo annonce « remis », « rejeté » ou « spam ». Sans lui, on reste au
    // constat du départ — ce qui a laissé trois « Envoyé » affichés pour des
    // messages rejetés (2026-08-21).
    const json = (await response.json().catch(() => null)) as { messageId?: string } | null
    return { success: true, messageId: json?.messageId ?? null }
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

// Demi-journées retirées des e-mails (B-043) : le produit ne planifie que les
// soirs et les week-ends, et le moteur n'a jamais lu ce champ.

/** Signature neutre côté cabinet (D3 — plus de « Anne-Sophie » en dur).
 *  Reçoit le nom d'expéditeur du cabinet ; repli générique si absent. */
function signatureCabinet(signature?: string | null): string {
  return signature?.trim() || 'l’équipe du cabinet'
}

export function emailCongeValide(params: {
  prenom: string
  type: string
  creneau: string | null
  date_debut: string
  date_fin: string
  /** Nom d'expéditeur du cabinet (cabinets.brevo_from_name) — D3. */
  signature?: string | null
}) {
  const { prenom, type, creneau, date_debut, date_fin } = params
  const signature = signatureCabinet(params.signature)
  const isIndispo = type === 'indisponibilite'
  const typeLabel = TYPE_LABELS[type] ?? type
  const periode = isIndispo
    ? formatDate(date_debut)
    : `du ${formatDate(date_debut)} au ${formatDate(date_fin)}`

  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <div style="background:#1e6b8c;padding:24px 28px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">GuardVeto</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">Bonjour ${prenom},</p>
    <p style="margin:0 0 20px">Votre demande a été <strong style="color:#059669">validée</strong> par ${signature}.</p>
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
  /** Nom d'expéditeur du cabinet (cabinets.brevo_from_name) — D3. */
  signature?: string | null
}) {
  const { prenom, type, creneau, date_debut, date_fin, raison } = params
  const signature = signatureCabinet(params.signature)
  const isIndispo = type === 'indisponibilite'
  const typeLabel = TYPE_LABELS[type] ?? type
  const periode = isIndispo
    ? formatDate(date_debut)
    : `du ${formatDate(date_debut)} au ${formatDate(date_fin)}`

  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <div style="background:#1e6b8c;padding:24px 28px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">GuardVeto</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">Bonjour ${prenom},</p>
    <p style="margin:0 0 20px">Votre demande a été <strong style="color:#dc2626">refusée</strong> par ${signature}.</p>
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
    <p style="margin:0;color:#6b7280;font-size:13px">Si vous avez des questions, contactez ${signature} directement.</p>
  </div>
</div>`
}
