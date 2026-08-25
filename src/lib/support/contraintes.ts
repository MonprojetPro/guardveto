// ============================================================
// GUARDVETO — Ce qu'une demande de support a le droit d'être
// ============================================================
// Fichier PARTAGÉ entre le navigateur et le serveur, et c'est tout son
// intérêt : le formulaire refuse poliment avec ces valeurs, l'action serveur
// refuse fermement avec les MÊMES. Deux jeux de limites finissent toujours par
// diverger, et c'est la limite affichée qui devient alors un mensonge.
//
// ⚠️ Une TROISIÈME copie existe, et elle est volontaire : `file_size_limit` et
// `allowed_mime_types` du bucket `support` (migration 20260825120000). Elle ne
// peut pas être importée d'ici — elle vit chez Supabase, hors d'atteinte du
// code. C'est précisément pourquoi elle compte : le navigateur se contourne en
// dix secondes avec les outils de développement, le bucket non. Si l'une des
// deux bouge, l'autre doit bouger le même jour.
// ============================================================

/** 10 Mo. Identique à `file_size_limit` du bucket — voir l'avertissement ci-dessus. */
export const TAILLE_MAX_OCTETS = 10 * 1024 * 1024

/** Trois pièces jointes. Identique à la contrainte `cardinality(...) <= 3` en base. */
export const NB_PIECES_MAX = 3

/**
 * Les formats acceptés.
 *
 * `image/heic` et `image/heif` sont là pour une raison précise : c'est le
 * format par défaut des photos d'iPhone. Les oublier, c'est refuser la capture
 * d'écran de la moitié de l'équipe sans lui dire pourquoi.
 */
export const FORMATS_ACCEPTES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const

/** Ce que l'attribut `accept` d'un `<input type="file">` attend. */
export const ACCEPT_HTML = FORMATS_ACCEPTES.join(',')

export type TypeDemande = 'bug' | 'amelioration'

export const LONGUEUR_TITRE = { min: 3, max: 140 } as const
export const LONGUEUR_DESCRIPTION = { min: 10, max: 5000 } as const

/** « 3,4 Mo » — jamais « 3565158 octets », que personne ne lit. */
export function poidsLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
}

/**
 * Le refus d'un fichier, en français, ou `null` s'il passe.
 *
 * Il DIT LE POIDS RÉEL et la limite : « trop lourd » tout seul envoie refaire
 * la manipulation à l'aveugle, sans savoir de combien on dépasse.
 */
export function refusFichier(fichier: { name: string; size: number; type: string }): string | null {
  // Le type est vérifié AVANT le poids : un fichier au mauvais format ne sera
  // jamais accepté, quelle que soit sa taille — lui reprocher son poids
  // d'abord enverrait le compresser pour rien.
  if (!(FORMATS_ACCEPTES as readonly string[]).includes(fichier.type)) {
    return `« ${fichier.name} » n’est pas un format que je peux recevoir. Envoie une image (capture d’écran, photo) ou un PDF.`
  }
  if (fichier.size > TAILLE_MAX_OCTETS) {
    return `« ${fichier.name} » est trop lourd (${poidsLisible(fichier.size)}, et la limite est de ${poidsLisible(TAILLE_MAX_OCTETS)}). Une capture d’écran suffit presque toujours — inutile d’envoyer la photo en pleine qualité.`
  }
  if (fichier.size === 0) {
    return `« ${fichier.name} » est vide — le fichier n’a peut-être pas fini de se copier.`
  }
  return null
}

/**
 * Le nom d'un fichier, ramené à ce qu'un chemin de stockage accepte.
 *
 * Un nom réel porte des accents, des espaces, parfois des apostrophes
 * (« Capture d'écran 2026-08-25 à 10.10.12.png ») : Supabase Storage les
 * refuse ou les mutile en silence. On garde l'extension, on assainit le reste,
 * et le VRAI nom part dans l'e-mail — c'est là qu'il sert à quelque chose.
 */
export function nomDeFichierSur(nom: string): string {
  const point = nom.lastIndexOf('.')
  const base = point > 0 ? nom.slice(0, point) : nom
  const ext = point > 0 ? nom.slice(point + 1).toLowerCase() : 'bin'

  const propre = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // les accents, décollés par NFD puis retirés
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase()

  const extPropre = ext.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  return `${propre || 'fichier'}.${extPropre}`
}

/**
 * Le refus d'une demande entière, en français, ou `null` si elle tient debout.
 *
 * Appelé des DEUX côtés : le formulaire s'en sert pour désactiver le bouton,
 * l'action serveur pour refuser un envoi fabriqué à la main. Les bornes sont
 * celles des contraintes `CHECK` de la table — une divergence ici ferait
 * remonter une erreur Postgres brute à l'écran, en anglais.
 */
export function refusDemande(d: { titre: string; description: string }): string | null {
  const titre = d.titre.trim()
  const description = d.description.trim()

  if (titre.length < LONGUEUR_TITRE.min) {
    return 'Donne un titre court à ta demande — quelques mots suffisent.'
  }
  if (titre.length > LONGUEUR_TITRE.max) {
    return `Ce titre est trop long (${titre.length} caractères pour ${LONGUEUR_TITRE.max} au maximum). Le détail a sa place juste en dessous.`
  }
  if (description.length < LONGUEUR_DESCRIPTION.min) {
    return 'Décris ce qui se passe en une phrase au moins : ce que tu faisais, et ce que tu attendais.'
  }
  if (description.length > LONGUEUR_DESCRIPTION.max) {
    return `Cette description est très longue (${description.length} caractères pour ${LONGUEUR_DESCRIPTION.max} au maximum). Garde l’essentiel, on t’en demandera plus si besoin.`
  }
  return null
}
