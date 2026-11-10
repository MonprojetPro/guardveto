// ============================================================
// GUARDVETO — Le mail d'un message de la messagerie (B-193c)
// ============================================================
// Le message VIT dans la messagerie ; ce mail ne fait que prévenir (décision
// ⑫ du cadrage V3). Il porte donc le texte entier — pour qu'on puisse le lire
// sans se connecter — et un lien pour répondre dans GuardVeto, jamais un
// « répondre à ce mail » qui ouvrirait un second historique.
//
// Le lien est écrit EN TEXTE : Brevo réécrit les liens cliquables pour suivre
// les clics, et certaines messageries les cassent (piège payé, « liens en texte
// dans les mails Brevo »).
// ============================================================

export interface PieceMail {
  nom: string
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Les retours à la ligne du message deviennent des retours à la ligne lus. */
function paragraphes(texte: string): string {
  return echapper(texte.trim())
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;white-space:pre-wrap">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** L'adresse publique du produit, sans barre finale. */
export function adresseProduit(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://guardveto.vercel.app').replace(/\/+$/, '')
}

export function sujetMailMessage(p: { auteur: string; cabinet: string; equipe: boolean }): string {
  return p.equipe
    ? `${p.cabinet} — message de ${p.auteur} à l’équipe`
    : `${p.cabinet} — message de ${p.auteur}`
}

export function corpsMailMessage(p: {
  auteur: string
  cabinet: string
  equipe: boolean
  corps: string
  pieces: PieceMail[]
  lien: string
}): string {
  const contexte = p.equipe
    ? `${echapper(p.auteur)} a écrit à toute l’équipe dans la messagerie de GuardVeto :`
    : `${echapper(p.auteur)} vous a écrit dans la messagerie de GuardVeto :`

  const texte = p.corps.trim() ? paragraphes(p.corps) : ''
  const pieces =
    p.pieces.length > 0
      ? `<p style="margin:0 0 12px;color:#7C6A55">Pièce${p.pieces.length > 1 ? 's' : ''} jointe${
          p.pieces.length > 1 ? 's' : ''
        } (à ouvrir dans GuardVeto) : ${p.pieces.map((x) => echapper(x.nom)).join(', ')}</p>`
      : ''

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#3A2A1C;max-width:560px">
<p style="margin:0 0 14px">${contexte}</p>
<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #C7530F;background:#FBF3E2">${texte}${pieces}</div>
<p style="margin:0 0 6px">Pour répondre, ouvrez la conversation dans GuardVeto (copiez l’adresse dans votre navigateur) :</p>
<p style="margin:0 0 18px;font-family:monospace">${echapper(p.lien)}</p>
<p style="margin:0;font-size:12px;color:#A08D75">${echapper(p.cabinet)} · ce message a été envoyé depuis la messagerie de l’équipe. Les réponses à ce mail ne sont pas lues : répondez dans GuardVeto.</p>
</div>`
}
