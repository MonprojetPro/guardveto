// ============================================================
// GUARDVETO — B-178 : à QUEL compte Google partager l'agenda perso
// ============================================================
// Google ne rattache pas une adresse Gmail « + » (prenom+tag@gmail.com) au
// compte qui la reçoit : un partage donné à l'alias n'ouvre l'agenda à
// personne. Constaté le 30/10 au bac à sable : 7 agendas partagés à
// culus.osteo+<prenom>@gmail.com, et « Vous n'avez pas accès » en cliquant.
// Le courrier, lui, arrive bien dans la boîte : on écrit toujours à l'adresse
// de la fiche, mais on PARTAGE au compte, alias retiré.
// ============================================================

const DOMAINES_GMAIL = new Set(['gmail.com', 'googlemail.com'])

/** L'adresse du compte Google à qui partager. Null si l'adresse est inutilisable. */
export function adresseDePartage(email: string | null | undefined): string | null {
  const v = (email ?? '').trim().toLowerCase()
  const at = v.lastIndexOf('@')
  if (at <= 0 || at === v.length - 1) return null
  const local = v.slice(0, at)
  const domaine = v.slice(at + 1)
  if (!DOMAINES_GMAIL.has(domaine)) return v
  const sansAlias = local.split('+')[0]
  return sansAlias ? `${sansAlias}@${domaine}` : v
}

/** Le lien qui ouvre Google Agenda sur « ajouter cet agenda », sans passer par l'e-mail de Google. */
export function lienAjoutAgenda(calendarId: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calendarId)}`
}
