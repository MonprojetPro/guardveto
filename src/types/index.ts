// ============================================================
// GUARDVETO — Types TypeScript partagés
// ============================================================

export type UserRole = 'admin' | 'veto' | 'secretaire'
export type StatutVeto = 'associe' | 'salarie'
export type StatutPeriode = 'brouillon' | 'publie' | 'verrouille'
export type TypeGarde = 'semaine' | 'weekend' | 'ferie'
export type TypeConge = 'vacances' | 'formation' | 'sante' | 'autre'
export type StatutConge = 'souhait' | 'valide' | 'refuse'
export type Saison = 'ete' | 'hiver'

export interface Veterinaire {
  id: string
  user_id: string | null
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
  date_debut: string
  date_fin: string
  statut: StatutPeriode
  publie_at: string | null
  created_at: string
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
  statut: StatutConge
  commentaire: string | null
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

// Navigation
export interface NavItem {
  label: string
  href: string
  icon: string
  roles: UserRole[]
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Planning',    href: '/planning',           icon: 'Calendar',    roles: ['admin', 'veto', 'secretaire'] },
  { label: 'Congés',     href: '/conges',             icon: 'CalendarOff', roles: ['admin', 'veto'] },
  { label: 'Compteurs',  href: '/compteurs',          icon: 'BarChart3',   roles: ['admin', 'veto'] },
  { label: 'Périodes',   href: '/admin/periodes',     icon: 'CalendarRange', roles: ['admin'] },
  { label: 'Vétérinaires', href: '/admin/veterinaires', icon: 'Users',     roles: ['admin'] },
]
