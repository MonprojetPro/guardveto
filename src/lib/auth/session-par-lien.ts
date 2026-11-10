// ============================================================
// GUARDVETO — UNE SESSION OUVERTE PAR UN LIEN N'EST PAS FINIE (B-201)
// ============================================================
// Un lien reçu par e-mail (invitation, « mot de passe oublié ») ouvre une
// session DÈS LE CLIC : il prouve qu'on possède la boîte mail, Supabase n'en
// demande pas plus. La page « Définir mon mot de passe » s'affiche ensuite —
// mais si on la quitte sans valider, on est dans l'application quand même.
// Jusqu'au jour où la session expire : là, plus de session, et aucun mot de
// passe. Porte fermée, avec pour seul message « identifiants invalides ».
//
// Payé le 08/11 par le compte secrétariat du Val d'Allier. Le 10/11, quatre
// vétérinaires vivaient sur une session de ce genre, certains depuis le 05/10.
//
// Supabase inscrit dans le jeton COMMENT la session a été ouverte (`amr`) :
// « password » pour une vraie connexion, « otp » pour un lien d'invitation ou
// magique, « recovery » pour un lien « mot de passe oublié ». C'est ce que lit
// cette fonction — pure, pour être testée sans base.
// ============================================================

/** Les façons d'ouvrir une session qui ne passent PAS par un mot de passe choisi. */
const METHODES_PAR_LIEN = new Set(['otp', 'recovery', 'invite', 'magiclink', 'email/signup'])

type Methode = string | { method?: string | null }

/**
 * Vrai si la session a été ouverte par un lien reçu par e-mail et JAMAIS
 * confirmée par un mot de passe — la personne doit alors en choisir un.
 *
 * Liste vide ou méthode inconnue → faux : dans le doute, on ne ferme la porte
 * à personne. Ce garde-fou sert à finir une inscription, pas à verrouiller.
 */
export function sessionSansMotDePasse(methodes: readonly Methode[] | null | undefined): boolean {
  if (!methodes || methodes.length === 0) return false
  const noms = methodes
    .map((m) => (typeof m === 'string' ? m : m?.method ?? ''))
    .filter((m) => m !== '')
  if (noms.includes('password')) return false
  return noms.some((m) => METHODES_PAR_LIEN.has(m))
}

/**
 * Les chemins qui restent ouverts à une session sans mot de passe.
 *
 * La page du mot de passe elle-même, le parcours des liens (`/auth/…`), la
 * connexion (pour pouvoir changer de compte) et les adresses techniques
 * (`/api`, qui font leurs propres contrôles — arbitrage MiKL du 10/11).
 */
export function cheminOuvertSansMotDePasse(pathname: string): boolean {
  return (
    pathname === '/set-password'
    || pathname === '/login'
    || pathname.startsWith('/auth/')
    || pathname.startsWith('/api')
    || pathname.startsWith('/_next')
  )
}
