// GUARDVETO — Les formes de données de la cloche (B-183).
// À part de `app/(v2)/cloche-actions.ts` : un fichier `'use server'` ne doit
// exporter que des fonctions async.

export interface NotificationCloche {
  id: string
  type: string
  titre: string
  message: string
  lien: string | null
  lu: boolean
  created_at: string
}

export interface EtatCloche {
  items: NotificationCloche[]
  nbNonLues: number
  /** La lecture a échoué : ne pas afficher « aucune notification ». */
  erreur: boolean
  /** Il reste des notifications plus anciennes à charger (B-191). */
  aSuite?: boolean
}

/** « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 2 j », puis la date. */
export function tempsRelatif(iso: string, maintenant: number = Date.now()): string {
  const min = Math.floor((maintenant - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.floor(h / 24)
  if (j < 7) return `il y a ${j} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

/**
 * Le lien d'une notification, s'il reste DANS GuardVeto ; sinon `null`.
 *
 * ⚠️ CERBÈRE (03/11) : un vétérinaire peut écrire une notification destinée à
 *    l'administratrice (policy `notifications_insert_demande_conge`). Sans ce
 *    filtre, un lien « https://… » ou « javascript:… » glissé dedans partirait
 *    au clic de l'admin. Seules les adresses internes (« /planning », pas
 *    « //autre-site ») sont suivies.
 */
export function lienInterne(lien: string | null | undefined): string | null {
  if (typeof lien !== 'string') return null
  const l = lien.trim()
  if (!l.startsWith('/') || l.startsWith('//') || l.startsWith('/\\')) return null
  return l
}

/** Le chiffre de la pastille : au-delà de 9, « 9+ » (la pastille reste petite). */
export function chiffrePastille(n: number): string | null {
  if (n <= 0) return null
  return n > 9 ? '9+' : String(n)
}
