// ============================================================
// GUARDVETO — B-178 : l'invitation à ajouter son agenda GuardVeto
// ============================================================
// Remplace l'e-mail automatique de Google (en anglais, signé par l'adresse
// technique du compte de service). Un seul geste demandé : un bouton.
// Le lien est aussi écrit en clair, pour les messageries qui cassent les boutons.
// ============================================================

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function sujetInvitationAgenda(): string {
  return 'Votre planning GuardVeto dans Google Agenda'
}

export function emailInvitationAgenda(p: {
  prenom: string
  /** Le compte Google à qui l'agenda est partagé (alias « + » retiré). */
  compte: string
  lien: string
  nomAgenda: string
}): string {
  const prenom = echapper(p.prenom.trim() || 'Bonjour')
  const compte = echapper(p.compte)
  const lien = echapper(p.lien)
  return `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">
  <div style="background:#1e6b8c;padding:24px 28px;border-radius:8px 8px 0 0">
    <p style="margin:0;color:#fff;font-weight:700;font-size:18px">GuardVeto</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px">
    <p style="margin:0 0 16px">${p.prenom.trim() ? `Bonjour ${prenom},` : 'Bonjour,'}</p>
    <p style="margin:0 0 20px">Votre planning est prêt dans un agenda Google à votre nom, « ${echapper(p.nomAgenda)} ». Il se met à jour tout seul.</p>
    <p style="margin:0 0 24px;text-align:center">
      <a href="${lien}" style="display:inline-block;background:#1e6b8c;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">Ajouter à mon Google Agenda</a>
    </p>
    <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Connectez-vous à Google avec <strong>${compte}</strong> : l’agenda n’est ouvert qu’à ce compte.</p>
    <p style="margin:0;color:#6b7280;font-size:13px">Si le bouton ne s’ouvre pas, copiez ce lien : ${lien}</p>
  </div>
</div>`
}
