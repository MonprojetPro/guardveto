// ============================================================
// À qui peut-on écrire ?
// ============================================================
// Depuis le 2026-08-22, `veterinaires.email` est FACULTATIF : une fiche existe
// avant que la personne soit invitée, et n'a alors aucune adresse. C'est la
// vérité métier — mais elle crée un risque précis, que ce projet a déjà payé
// deux fois : l'envoi qui part vers rien et échoue sans que personne ne le
// sache (une notification à personne ; une RPC absente dont l'erreur n'était
// pas lue).
//
// Le danger n'est pas le plantage, c'est le SILENCE. Trois règles, portées ici
// et nulle part ailleurs :
//
//   ① Une chaîne vide n'est PAS une adresse. `''` traverse tous les contrôles
//      d'un `if (vet.email)` mal écrit et se fait passer pour un destinataire.
//      D'où `adresseUtilisable`, qui tranche une fois pour toutes.
//   ② Un vétérinaire sans adresse ne reçoit rien — c'est NORMAL, pas une
//      erreur. Le compter en échec ferait clignoter l'alerte de publication
//      pour un fonctionnement attendu.
//   ③ Mais ça ne doit JAMAIS empêcher les autres de recevoir. D'où le tri
//      plutôt qu'un refus global : on écrit à qui on peut, et on TRACE les
//      autres pour que « il n'a rien reçu » ait une réponse.
// ============================================================

/** Une fiche, vue par un envoi : seule l'adresse l'intéresse. */
export interface PorteurAdresse {
  email?: string | null
  prenom?: string | null
  nom?: string | null
}

/**
 * Y a-t-il quelqu'un au bout ?
 *
 * NULL, chaîne vide, espaces : autant de « personne ». Le prédicat rétrécit le
 * type pour que TypeScript refuse ensuite de passer un `string | null` à Brevo.
 */
export function adresseUtilisable(email: string | null | undefined): email is string {
  return typeof email === 'string' && email.trim().length > 0
}

/**
 * Normalise une adresse saisie : minuscules, sans espaces — ou NULL.
 *
 * Le NULL est le point important : enregistrer `''` créerait une fiche qui
 * SEMBLE avoir une adresse. La base ne saurait plus distinguer « pas encore
 * invité » de « adresse effacée par erreur », et l'index d'unicité
 * (cabinet_id, email) refuserait la deuxième fiche vide du cabinet.
 */
export function normaliserAdresse(email: string | null | undefined): string | null {
  if (!adresseUtilisable(email)) return null
  return email.trim().toLowerCase()
}

/** La forme que l'écran de saisie accepte — libre, mais pas n'importe quoi. */
export function adresseBienFormee(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * Sépare ceux à qui on peut écrire de ceux à qui on ne peut pas.
 *
 * Les deux listes sont rendues : la seconde n'est pas un déchet, c'est la
 * réponse à « pourquoi Manon n'a rien reçu ». Les appelants la journalisent.
 */
export function trierDestinataires<T extends PorteurAdresse>(
  liste: readonly T[],
): { joignables: T[]; sansAdresse: T[] } {
  const joignables: T[] = []
  const sansAdresse: T[] = []
  for (const p of liste) {
    if (adresseUtilisable(p.email)) joignables.push(p)
    else sansAdresse.push(p)
  }
  return { joignables, sansAdresse }
}

/** Le nom lisible d'une fiche, pour les traces (« Manon Dupuis »). */
export function nomLisible(p: PorteurAdresse): string {
  return [p.prenom, p.nom].filter(Boolean).join(' ').trim() || 'vétérinaire sans nom'
}

/**
 * Une trace uniforme pour les non-joints. Silencieuse à l'écran, visible dans
 * les journaux du serveur : c'est le seul endroit où l'on saura, plus tard, que
 * l'envoi a bien eu lieu MAIS pas pour tout le monde.
 */
export function tracerSansAdresse(canal: string, sansAdresse: readonly PorteurAdresse[]): void {
  if (sansAdresse.length === 0) return
  console.warn(
    `[emails] ${canal} — ${sansAdresse.length} vétérinaire(s) sans adresse e-mail, non contacté(s) : ` +
      sansAdresse.map(nomLisible).join(', '),
  )
}

/**
 * Peut-on inviter cette fiche ?
 *
 * Retourne le motif du refus, EN FRANÇAIS et en disant quoi faire — ou null si
 * l'invitation peut partir. Extrait ici pour être vérifiable par un test sans
 * base de données, et pour que l'écran et le serveur disent exactement la même
 * chose : l'un désactive le bouton, l'autre refuse pour de bon.
 */
export function motifInvitationImpossible(vet: PorteurAdresse): string | null {
  if (adresseUtilisable(vet.email)) return null
  const prenom = (vet.prenom ?? '').trim()
  return prenom
    ? `Ajoute d'abord l'adresse e-mail de ${prenom} pour pouvoir l'inviter.`
    : "Ajoute d'abord une adresse e-mail sur cette fiche pour pouvoir l'inviter."
}

/** Une fiche telle que le tri « reste-t-il quelqu'un à inviter ? » la lit. */
export interface FicheInvitable extends PorteurAdresse {
  actif: boolean
  /** `null` / absent = aucun compte n'a jamais été créé pour cette fiche. */
  user_id?: string | null
}

/**
 * fichesAInviter — B-133 : qui reste-t-il à inviter, et par quel geste ?
 *
 * Le 26/09, le premier cabinet abonné n'avait jamais vu le bouton « Inviter » :
 * des fiches créées, zéro invitation partie, donc zéro véto capable d'entrer
 * dans l'app. Un blocage total ET silencieux.
 *
 * ⚠️ LE CRITÈRE EST `!user_id`, PAS `invite_pending`. Une invitation déjà
 * partie n'est plus un blocage : la compter ici rendrait le rappel PERMANENT,
 * donc invisible — un signal qui ne s'éteint jamais est un signal qu'on cesse
 * de lire, et on aurait reconstruit l'angle mort qu'on prétend fermer.
 *
 * ⚠️ LES DEUX LISTES SONT SÉPARÉES parce qu'elles appellent des gestes
 * DIFFÉRENTS. Sans adresse, aucune invitation ne peut partir — le serveur
 * refuse, avec la même phrase que le bouton désactivé. Les fondre en un seul
 * chiffre enverrait l'admin cliquer sur un bouton grisé, et lui apprendrait à
 * ignorer le signal.
 *
 * Extrait ici, et pas calculé dans l'écran, pour la même raison que
 * `motifInvitationImpossible` juste au-dessus : le critère doit être vérifiable
 * par un test, sans base ni rendu.
 */
export function fichesAInviter<T extends FicheInvitable>(
  fiches: readonly T[],
): { pretes: T[]; sansAdresse: T[] } {
  const pretes: T[] = []
  const sansAdresse: T[] = []
  for (const f of fiches) {
    if (!f.actif || f.user_id) continue
    if (motifInvitationImpossible(f)) sansAdresse.push(f)
    else pretes.push(f)
  }
  return { pretes, sansAdresse }
}
