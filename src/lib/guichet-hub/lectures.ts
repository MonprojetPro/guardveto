// ============================================================
// GUARDVETO — Le guichet du Hub MPP : ce qu'on lit, et comment (B-207 lot 1)
// ============================================================
// PUR : aucune dépendance à Supabase. Les routes `/api/hub/*` lisent les
// tables avec le client service, puis passent les rangées brutes ici. Tout ce
// qui peut mentir (un état de compte, une période « en cours ») se décide dans
// ce fichier et se teste (`tests/lib/guichet-hub-lectures.test.ts`).
//
// Convention héritée du guichet MenuFacile : `null` veut dire « non
// calculable », jamais « zéro ». Un compteur inconnu affiché à 0 est un
// mensonge silencieux dans un cockpit de pilotage.
// ============================================================

/**
 * `mot_de_passe_a_choisir` : le lien a été ouvert (compte confirmé) mais aucun
 * mot de passe n'a été choisi (B-201/B-203, secrétariat). Ce n'est PAS une
 * invitation en attente : la renvoyer est refusé (le lien a servi) — le geste
 * juste est la réinitialisation. Les confondre faisait tourner le Hub en rond.
 */
export type EtatCompte = 'sans_compte' | 'invitation_en_attente' | 'mot_de_passe_a_choisir' | 'actif'

/** Ce que le Hub voit d'un compte Supabase Auth — trois dates, rien d'autre. */
export interface CompteAuth {
  id: string
  confirmed_at?: string | null
  last_sign_in_at?: string | null
  invited_at?: string | null
}

/**
 * L'état d'une fiche, tel que l'admin du cabinet le lit dans l'écran Équipe.
 * « Actif » = le lien d'invitation a été ouvert (compte confirmé). B-203 :
 * pour le secrétariat, il faut EN PLUS un vrai mot de passe choisi.
 */
export function etatCompte(
  userId: string | null,
  compte: CompteAuth | undefined,
  opts: { motDePasseExige?: boolean; motDePasseLe?: string | null } = {},
): EtatCompte {
  if (!userId || !compte) return 'sans_compte'
  if (!compte.confirmed_at) return 'invitation_en_attente'
  if (opts.motDePasseExige && !opts.motDePasseLe) return 'mot_de_passe_a_choisir'
  return 'actif'
}

export interface RangeePeriode {
  id: string
  cabinet_id: string | null
  libelle: string | null
  date_debut: string
  date_fin: string
  statut: string
  publie_at: string | null
}

export interface PeriodeResumee {
  id: string
  libelle: string | null
  debut: string
  fin: string
  statut: string
  publieLe: string | null
}

function resumer(p: RangeePeriode): PeriodeResumee {
  return { id: p.id, libelle: p.libelle, debut: p.date_debut, fin: p.date_fin, statut: p.statut, publieLe: p.publie_at }
}

/**
 * La période qui couvre `jour` (AAAA-MM-JJ), et la prochaine à venir.
 * Comparaison de chaînes ISO : `date_debut`/`date_fin` sont des `date` SQL,
 * sans fuseau — les convertir en `Date` décalerait d'un jour autour de minuit.
 */
export function periodesDuCabinet(
  periodes: RangeePeriode[],
  jour: string,
): { enCours: PeriodeResumee | null; prochaine: PeriodeResumee | null; derniereFin: string | null } {
  const tri = [...periodes].sort((a, b) => a.date_debut.localeCompare(b.date_debut))
  const enCours = tri.find((p) => p.date_debut <= jour && p.date_fin >= jour) ?? null
  const prochaine = tri.find((p) => p.date_debut > jour) ?? null
  const derniereFin = tri.length > 0 ? tri.reduce((m, p) => (p.date_fin > m ? p.date_fin : m), tri[0].date_fin) : null
  return {
    enCours: enCours ? resumer(enCours) : null,
    prochaine: prochaine ? resumer(prochaine) : null,
    derniereFin,
  }
}

/** Le jour (AAAA-MM-JJ) à Paris : le planning d'un cabinet français vit à cette heure-là. */
export function jourAParis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(maintenant)
}

/** La date la plus récente d'une liste (ISO), `null` si aucune. */
export function plusRecente(dates: (string | null | undefined)[]): string | null {
  let m: string | null = null
  for (const d of dates) if (d && (!m || d > m)) m = d
  return m
}
