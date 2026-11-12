// ============================================================
// GUARDVETO — La messagerie : formes et regles PURES (B-193)
// ============================================================
// Aucune dependance a React ni a Supabase : tout ce qui est piegeux se teste
// ici, sans navigateur (`tests/lib/messagerie.test.ts`).
//
// ⚠️ LES BORNES SONT CELLES DE LA BASE. `LONGUEUR_MESSAGE_MAX` et
//    `NB_PIECES_MAX` recopient les contraintes `messages_contenu` et
//    `messages_pieces_tableau` (migration 20261106120000). Une divergence
//    ferait remonter une erreur Postgres brute, en anglais, a l'ecran.
// ============================================================

import { NB_PIECES_MAX, refusFichier } from '@/lib/support/contraintes'

export { NB_PIECES_MAX }

/** 4000 caracteres : la borne de la contrainte `messages_contenu`. */
export const LONGUEUR_MESSAGE_MAX = 4000

/** Le nom du bucket de stockage des pieces jointes. */
export const BUCKET_MESSAGERIE = 'messagerie'

/** Combien de messages un fil charge d'un coup (puis « plus anciens »). */
export const TAILLE_PAGE_MESSAGES = 60

/** Les colonnes lues d'un message — UNE liste pour l'ecran et le serveur. */
export const COLONNES_MESSAGE =
  'id, conversation_id, auteur_user_id, auteur_nom, corps, pieces_jointes, cree_le, modifie_le, retire_le, mail_envoye_a, mail_echecs'

/**
 * `editeur` (B-207) : le fil « MonProjetPro » d'une personne, ecrit depuis le
 * Hub MPP. Un seul membre (le destinataire), qui lit et repond.
 */
export type GenreConversation = 'equipe' | 'privee' | 'editeur'

/** Le nom affiche du fil editeur, et l'auteur pose par la base (B-207). */
export const NOM_EDITEUR = 'MonProjetPro'

/** Une piece jointe, telle que stockee dans `messages.pieces_jointes`. */
export interface PieceMessage {
  /** Chemin dans le bucket, JAMAIS une URL : l'URL est signee a l'affichage. */
  chemin: string
  nom: string
  taille: number
  type: string
}

/** Un message tel que l'ecran l'affiche. */
export interface MessageFil {
  id: string
  conversationId: string
  auteurUserId: string | null
  auteurNom: string
  corps: string
  pieces: PieceMessage[]
  creeLe: string
  modifieLe: string | null
  retireLe: string | null
  /** B-193c — envoye aussi par mail a N personnes (`null` = pas d'envoi par mail). */
  mailEnvoyeA: number | null
  /** B-193c — combien de ces mails ont echoue. */
  mailEchecs: number | null
  /** Pose localement avant confirmation du serveur (envoi optimiste). */
  enEnvoi?: boolean
  /** L'envoi a echoue : le message reste visible, avec « Reessayer ». */
  echec?: boolean
}

/** Une conversation dans la liste de gauche (fonction `messagerie_conversations`). */
export interface ConversationListe {
  id: string
  genre: GenreConversation
  autreUserId: string | null
  autreNom: string | null
  autreActif: boolean
  dernierLe: string | null
  dernierExtrait: string | null
  dernierAuteurNom: string | null
  dernierDeMoi: boolean
  dernierRetire: boolean
  nbNonLus: number
}

/** Une personne a qui l'on peut ecrire (fonction `messagerie_annuaire`). */
export interface MembreAnnuaire {
  userId: string
  nom: string
  role: 'admin' | 'veto' | 'secretaire'
  /** B-193c — a une adresse mail (l'adresse elle-meme ne quitte jamais la base). */
  aEmail: boolean
}

/** La rangee brute rendue par la base, avant mise en forme. */
export interface RangeeMessage {
  id: string
  conversation_id: string
  auteur_user_id: string | null
  auteur_nom: string
  corps: string
  pieces_jointes: unknown
  cree_le: string
  modifie_le: string | null
  retire_le: string | null
  mail_envoye_a?: number | null
  mail_echecs?: number | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function estUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/** Les pieces d'une rangee, en ignorant tout ce qui n'a pas la bonne forme. */
export function piecesDe(brut: unknown): PieceMessage[] {
  if (!Array.isArray(brut)) return []
  return brut.flatMap((p) => {
    if (!p || typeof p !== 'object') return []
    const o = p as Record<string, unknown>
    if (typeof o.chemin !== 'string' || typeof o.nom !== 'string') return []
    return [
      {
        chemin: o.chemin,
        nom: o.nom,
        taille: typeof o.taille === 'number' ? o.taille : 0,
        type: typeof o.type === 'string' ? o.type : 'application/octet-stream',
      },
    ]
  })
}

export function versMessage(r: RangeeMessage): MessageFil {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    auteurUserId: r.auteur_user_id,
    auteurNom: r.auteur_nom,
    corps: r.corps,
    pieces: piecesDe(r.pieces_jointes),
    creeLe: r.cree_le,
    modifieLe: r.modifie_le,
    retireLe: r.retire_le,
    mailEnvoyeA: r.mail_envoye_a ?? null,
    mailEchecs: r.mail_echecs ?? null,
  }
}

/**
 * Le refus d'un message, en francais, ou `null` s'il part.
 *
 * Appele des DEUX cotes : l'ecran desactive le bouton, l'action serveur
 * refuse un envoi fabrique a la main.
 */
export function refusMessage(m: { corps: string; nbPieces: number }): string | null {
  if (m.nbPieces > NB_PIECES_MAX) {
    return `Trois pièces jointes au maximum — il y en a ${m.nbPieces}.`
  }
  if (m.corps.length > LONGUEUR_MESSAGE_MAX) {
    return `Message trop long (${m.corps.length} caractères, ${LONGUEUR_MESSAGE_MAX} au maximum).`
  }
  if (!m.corps.trim() && m.nbPieces === 0) return 'Le message est vide.'
  return null
}

/**
 * Le chemin d'une piece : « <cabinet>/<conversation>/<id>-<nom> ».
 *
 * Le PREFIXE est la frontiere : la policy du bucket le relit
 * (`messagerie_chemin_autorise`), et l'action serveur le reverifie.
 */
export function cheminPiece(
  cabinetId: string,
  conversationId: string,
  idFichier: string,
  nomSur: string,
): string {
  return `${cabinetId}/${conversationId}/${idFichier}-${nomSur}`
}

/** La piece est-elle bien rangee dans CETTE conversation de CE cabinet ? */
export function cheminDansConversation(
  chemin: string,
  cabinetId: string,
  conversationId: string,
): boolean {
  const morceaux = chemin.split('/')
  return (
    morceaux.length === 3 &&
    morceaux[0] === cabinetId &&
    morceaux[1] === conversationId &&
    morceaux[2].length > 0 &&
    !morceaux[2].includes('..')
  )
}

/** Le refus d'une piece declaree par le client, ou `null`. */
export function refusPiece(p: PieceMessage): string | null {
  return refusFichier({ name: p.nom, size: p.taille, type: p.type })
}

/**
 * Insere un message dans un fil, dans l'ordre chronologique, sans doublon.
 *
 * Le doublon n'est pas theorique : avec l'envoi optimiste, le meme message
 * arrive deux fois — pose localement, puis par le temps reel. Le message
 * porte le MEME identifiant des deux cotes (l'ecran le choisit avant
 * l'envoi), donc le dedoublonnage se fait sur l'identifiant, jamais sur le
 * texte : deux « ok » envoyes coup sur coup sont deux messages.
 */
export function fusionnerMessage(fil: MessageFil[], entrant: MessageFil): MessageFil[] {
  const sans = fil.filter((m) => m.id !== entrant.id)
  return [...sans, entrant].sort(
    (a, b) => new Date(a.creeLe).getTime() - new Date(b.creeLe).getTime(),
  )
}

/** Le nom d'une conversation dans la liste et en tete du fil. */
export function nomConversation(c: Pick<ConversationListe, 'genre' | 'autreNom'>): string {
  if (c.genre === 'equipe') return 'Toute l’équipe'
  if (c.genre === 'editeur') return NOM_EDITEUR
  return c.autreNom ?? 'Ancien membre'
}

/**
 * La ligne d'apercu sous le nom : le DERNIER message et qui l'a ecrit.
 * Jamais le premier (lecon du kit `boite-reception-operateur`).
 */
export function apercuConversation(c: ConversationListe): string {
  if (!c.dernierLe) return 'Aucun message pour l’instant'
  if (c.dernierRetire) return 'Message retiré'
  const texte = c.dernierExtrait?.trim() || 'Pièce jointe'
  if (c.dernierDeMoi) return `Vous : ${texte}`
  if (c.genre === 'equipe' && c.dernierAuteurNom) {
    return `${prenomDe(c.dernierAuteurNom)} : ${texte}`
  }
  return texte
}

/** « Anne-Sophie Martin » → « Anne-Sophie ». Le secretariat garde son nom entier. */
export function prenomDe(nom: string): string {
  const premier = nom.trim().split(/\s+/)[0]
  return premier || nom
}

/** Les deux lettres de la pastille d'une personne. */
export function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}

/** Jour d'affichage d'un message, pour les separateurs du fil. */
export function jourDe(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** « Aujourd'hui », « Hier », sinon « lundi 3 novembre ». */
export function libelleJour(iso: string, maintenant: Date = new Date()): string {
  const d = new Date(iso)
  const debut = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ecart = Math.round((debut(maintenant) - debut(d)) / 86_400_000)
  if (ecart === 0) return 'Aujourd’hui'
  if (ecart === 1) return 'Hier'
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== maintenant.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/** « 14:05 ». */
export function heureDe(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Les adresses web d'un texte, decoupees pour etre rendues en liens.
 * Seuls `http(s)://` deviennent cliquables : jamais `javascript:` ni rien
 * d'autre, et le texte autour reste du texte (aucun HTML interprete).
 */
export function decouperLiens(texte: string): { texte: string; lien: boolean }[] {
  const morceaux: { texte: string; lien: boolean }[] = []
  const motif = /https?:\/\/[^\s<>"']+/g
  let dernier = 0
  for (const m of texte.matchAll(motif)) {
    const debut = m.index ?? 0
    // La ponctuation finale (« voir https://x.fr. ») n'appartient pas au lien.
    const brut = m[0].replace(/[.,;:!?)\]]+$/, '')
    if (debut > dernier) morceaux.push({ texte: texte.slice(dernier, debut), lien: false })
    morceaux.push({ texte: brut, lien: true })
    dernier = debut + brut.length
  }
  if (dernier < texte.length) morceaux.push({ texte: texte.slice(dernier), lien: false })
  return morceaux
}

/** Le chiffre d'une pastille : au-dela de 99, « 99+ ». */
export function chiffreNonLus(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

/**
 * B-193c — la mention sous un message envoyé aussi par mail (visible de son
 * autrice seule). Un échec se dit, il ne se fond pas dans un total.
 */
export function libelleEnvoiMail(envoyes: number, echecs: number): string {
  const s = (n: number) => (n > 1 ? 's' : '')
  if (envoyes === 0 && echecs === 0) return 'mail : personne à prévenir'
  if (envoyes === 0) return 'le mail n’est pas parti'
  const base = 'envoyé aussi par mail à ' + envoyes + ' personne' + s(envoyes)
  return echecs > 0 ? base + ' · ' + echecs + ' échec' + s(echecs) : base
}
