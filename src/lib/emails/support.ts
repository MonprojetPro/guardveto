// ============================================================
// GUARDVETO — Le corps de l'e-mail de support
// ============================================================
// Il ne part PAS vers un vétérinaire : il part du cabinet vers l'éditeur. Ce
// n'est donc pas une notification, c'est un signalement — et ce qu'il doit
// contenir n'est pas « ce qui est agréable à lire », c'est « ce qu'il faut
// pour dépanner sans repasser trois questions au cabinet ».
//
// D'où le bloc technique en bas : écran d'origine, navigateur, version
// déployée, identifiant de la demande. Personne ne le lit quand tout va bien ;
// le jour où ça compte, il fait gagner une journée.
//
// Les liens vers les pièces jointes sont SIGNÉS et expirent : le bucket est
// privé, une capture d'écran de planning porte des noms de personnes et des
// absences. L'échéance est écrite en toutes lettres à côté, sinon un lien mort
// dans six mois passera pour une panne.
// ============================================================

import { poidsLisible } from '@/lib/support/contraintes'

export interface PieceJointeEmail {
  /** Le nom tel que la personne l'a déposé, accents compris. */
  nom: string
  /** L'URL signée, valable jusqu'à `echeance`. */
  lien: string
  taille: number
}

export interface ContexteDemandeEmail {
  /** L'écran depuis lequel la demande a été ouverte. */
  ecran: string | null
  navigateur: string | null
  /** L'empreinte du déploiement, quand la plateforme la fournit. */
  version: string | null
}

/** Échappement HTML — le texte vient d'un formulaire, il n'est pas du balisage. */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Les retours à la ligne d'un `<textarea>` deviennent des retours à la ligne lus. */
function paragraphes(texte: string): string {
  return echapper(texte)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;white-space:pre-wrap">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

export function sujetEmailSupport(type: 'bug' | 'amelioration', cabinet: string, titre: string): string {
  const etiquette = type === 'bug' ? 'BUG' : 'IDÉE'
  return `[GuardVeto · ${etiquette}] ${cabinet} — ${titre}`
}

export function corpsEmailSupport({
  type,
  titre,
  description,
  auteur,
  auteurEmail,
  cabinet,
  demandeId,
  pieces,
  echeance,
  contexte,
  quand,
}: {
  type: 'bug' | 'amelioration'
  titre: string
  description: string
  auteur: string
  auteurEmail: string | null
  cabinet: string
  demandeId: string
  pieces: PieceJointeEmail[]
  echeance: string
  contexte: ContexteDemandeEmail
  quand: string
}): string {
  const estBug = type === 'bug'
  const couleur = estBug ? '#B4462F' : '#2C6BA8'
  const etiquette = estBug ? 'Bug signalé' : 'Amélioration demandée'

  const blocPieces =
    pieces.length === 0
      ? `<p style="margin:0;color:#6b7280;font-size:13px">Aucune pièce jointe.</p>`
      : `
      <ul style="margin:0;padding-left:18px">
        ${pieces
          .map(
            (p) => `<li style="margin:0 0 6px">
              <a href="${p.lien}" style="color:#2C6BA8">${echapper(p.nom)}</a>
              <span style="color:#6b7280;font-size:12px"> — ${poidsLisible(p.taille)}</span>
            </li>`,
          )
          .join('')}
      </ul>
      <p style="margin:10px 0 0;color:#6b7280;font-size:12px">
        Ces liens expirent le ${echapper(echeance)}. Passé cette date, les fichiers restent
        en place — il faut simplement en redemander l’accès.
      </p>`

  return `
<div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">
  <div style="background:${couleur};padding:20px 24px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase">
      GuardVeto · ${etiquette}
    </p>
    <p style="margin:6px 0 0;color:#fff;font-weight:700;font-size:19px">${echapper(titre)}</p>
  </div>

  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 18px;color:#6b7280;font-size:13px">
      <strong style="color:#1a1a2e">${echapper(auteur)}</strong>${
        auteurEmail ? ` (${echapper(auteurEmail)})` : ''
      } · cabinet <strong style="color:#1a1a2e">${echapper(cabinet)}</strong> · ${echapper(quand)}
    </p>

    <div style="background:#fff;border:1px solid #e5e7eb;border-left:4px solid ${couleur};border-radius:6px;padding:16px;margin:0 0 20px;font-size:14px;line-height:1.6">
      ${paragraphes(description)}
    </div>

    <p style="margin:0 0 8px;font-weight:700;font-size:14px">Pièces jointes</p>
    ${blocPieces}

    <hr style="border:0;border-top:1px solid #e5e7eb;margin:22px 0">

    <p style="margin:0 0 8px;font-weight:700;font-size:13px;color:#6b7280">Contexte technique</p>
    <table style="font-size:12px;color:#6b7280;border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0">Écran</td><td>${echapper(contexte.ecran ?? 'inconnu')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0">Navigateur</td><td>${echapper(contexte.navigateur ?? 'inconnu')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0">Version</td><td>${echapper(contexte.version ?? 'inconnue')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0">Demande</td><td>${echapper(demandeId)}</td></tr>
    </table>
  </div>
</div>`
}
