// ============================================================
// GUARDVETO — Types TypeScript partagés
// ============================================================

export type UserRole = 'admin' | 'veto'
export type StatutVeto = 'associe' | 'salarie'
export type StatutPeriode = 'brouillon' | 'publie' | 'verrouille'
export type TypeGarde = 'semaine' | 'weekend' | 'ferie'
export type TypeConge = 'vacances' | 'formation' | 'sante' | 'autre' | 'indisponibilite'
export type CreneauConge = 'journee' | 'matin' | 'apres-midi' | 'soiree'
export type StatutConge = 'souhait' | 'valide' | 'refuse'
export type Saison = 'ete' | 'hiver'

export interface Veterinaire {
  id: string
  user_id: string | null
  invite_pending: boolean
  nom: string
  prenom: string
  email: string
  statut: StatutVeto
  role_app: UserRole
  actif: boolean
  dernier_recours: boolean
  couleur: string
  created_at: string
}

export interface Periode {
  id: string
  saison: Saison
  numero: number | null
  libelle: string | null
  date_debut: string
  date_fin: string
  statut: StatutPeriode
  publie_at: string | null
  created_at: string
  /** Effectif configurable la nuit en semaine (1 ou 2). NULL/absent → repli saison. */
  nb_vetos_semaine_soir?: number | null
}

export interface Garde {
  id: string
  periode_id: string
  date: string
  type: TypeGarde
  premier_id: string | null
  second_id: string | null
  verrouille: boolean
  modifie_manuellement: boolean
  created_at: string
  updated_at: string
}

export interface GardeDenormalisee extends Garde {
  premier_prenom: string | null
  premier_nom: string | null
  premier_couleur: string | null
  second_prenom: string | null
  second_nom: string | null
  second_couleur: string | null
  saison: Saison
  periode_statut: StatutPeriode
}

export interface Conge {
  id: string
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: TypeConge
  creneau: CreneauConge | null
  statut: StatutConge
  commentaire: string | null
  raison_refus: string | null
  saisi_par: string | null
  valide_par: string | null
  created_at: string
}

export interface ContrainteVeto {
  id: string
  veterinaire_id: string
  type: 'jour_repos_fixe' | 'jour_repos_conditionnel' | 'indisponibilite_cyclique' | 'duo_interdit'
  config: Record<string, unknown>
  actif: boolean
  created_at: string
}

export interface CompteurGardes {
  periode_id: string
  veterinaire_id: string
  prenom: string
  nom: string
  statut: StatutVeto
  couleur: string
  we_premier: number
  we_second: number
  we_total: number
  sem_premier: number
  sem_second: number
  sem_total: number
  feries_premier: number
  feries_second: number
  feries_total: number
  total_gardes: number
}

export interface BonusMalus {
  id: string
  veterinaire_id: string
  periode_id: string
  ecart_we: number
  ecart_semaine: number
  ecart_feries: number
  ecart_grands_we: number
  created_at: string
}

// ── Gestion de crise (LOT 1) ────────────────────────────────
export type MotifAbsence = 'maladie' | 'urgence' | 'autre'
export type StatutAbsence = 'active' | 'resolue' | 'annulee'
export type RoleCompensation = 'premier' | 'second'
export type StatutCompensation = 'a_compenser' | 'compensee' | 'annulee'

/** Indisponibilité imprévue déclarée APRÈS publication d'un planning (≠ Conge). */
export interface Absence {
  id: string
  cabinet_id: string
  veterinaire_id: string
  date_debut: string
  date_fin: string
  motif: MotifAbsence
  commentaire: string | null
  statut: StatutAbsence
  declaree_par: string | null
  created_at: string
}

/** Trace légère du dépannage : qui a remplacé qui sur une garde, suite à une absence. */
export interface Compensation {
  id: string
  cabinet_id: string
  absence_id: string
  garde_id: string
  remplacant_id: string
  remplace_id: string
  role: RoleCompensation | null
  statut: StatutCompensation
  created_at: string
}

// Navigation
export interface NavItem {
  label: string
  href: string
  icon: string
  roles: UserRole[]
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Planning',      href: '/planning',            icon: 'Calendar',     roles: ['admin', 'veto'] },
  { label: 'Congés',        href: '/conges',              icon: 'CalendarOff',  roles: ['admin', 'veto'] },
  { label: 'Compteurs',     href: '/compteurs',           icon: 'BarChart3',    roles: ['admin', 'veto'] },
  { label: 'Règles',        href: '/regles',              icon: 'ScrollText',   roles: ['admin', 'veto'] },
  { label: 'Demandes',      href: '/admin/demandes',      icon: 'Inbox',        roles: ['admin'] },
  { label: 'Dépannages',    href: '/admin/depannages',    icon: 'LifeBuoy',     roles: ['admin'] },
  { label: 'Périodes',      href: '/admin/periodes',      icon: 'CalendarRange', roles: ['admin'] },
  { label: 'Vétérinaires',  href: '/admin/veterinaires',  icon: 'Users',        roles: ['admin'] },
]
