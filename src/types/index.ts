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
  /**
   * FACULTATIF depuis le 2026-08-22 : une fiche existe avant que la personne
   * soit invitée, et n'a alors pas encore d'adresse. `null` veut dire « pas
   * encore invité », pas « adresse perdue ».
   */
  email: string | null
  statut: StatutVeto
  role_app: UserRole
  actif: boolean
  dernier_recours: boolean
  couleur: string
  /** Étiquettes d'équipe (ex. junior, senior) — règles de composition (n°6/n°22). */
  tags?: string[]
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
  /** Profil de planning choisi (P5). NULL/absent → profil défaut du cabinet. */
  profil_id?: string | null
}

/** Profil de planning nommé d'un cabinet (structure + effectif réutilisables, P5). */
export interface ProfilPlanning {
  id: string
  nom: string
  est_defaut: boolean
  /** Saison proposée par défaut à la génération (suggestion UI). */
  saison_suggeree: Saison | null
  /** Effectif nuit semaine porté par le profil (null = selon la saison). */
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

/**
 * Une place au-delà de la deuxième, telle que la vue `planning_semaine` la
 * renvoie (colonne `places_sup`). Les places 0 et 1 restent portées par les
 * colonnes `premier_` et `second_` : ce sont elles qui subissent l'inversion
 * du vendredi.
 */
export interface PlaceSupplementaire {
  place_index: number
  role: string
  id: string
  prenom: string
  nom: string
  couleur: string
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
  /**
   * Places 3 et 4 d'un créneau sur-mesure. Vide dans l'immense majorité des
   * cas (un créneau a 1 ou 2 places) — absent si la donnée vient d'une source
   * qui ne passe pas par la vue.
   */
  places_sup?: PlaceSupplementaire[]
  /**
   * Cabinet propriétaire, exposé par la vue `planning_semaine` depuis le
   * 2026-08-21. La vue n'ayant AUCUNE RLS, c'est la seule chose qui permette à
   * ses lecteurs de se borner à leur propre cabinet.
   */
  cabinet_id?: string
  /**
   * Backlog 8 bis — ce JOUR précis porte-t-il un remplacement exceptionnel ?
   * Une garde de week-end couvre trois jours ; l'exception n'en concerne
   * qu'un. La garde, elle, n'a pas bougé — elle porte toujours l'équité et le
   * roulement. Ces drapeaux servent à SIGNALER l'exception, pour qu'elle ne
   * passe pas pour l'attribution ordinaire.
   *
   * Absents si la donnée ne vient pas de la vue `planning_semaine`.
   */
  jour_exceptionnel?: boolean
  exception_premier?: boolean
  exception_second?: boolean
  /**
   * Réponse de l'admin à « ce jour compte-t-il comme un jour de 1er de garde
   * (celui qui porte l'avantage financier) ? ». Jamais deviné : la question
   * est posée au moment du changement.
   */
  compte_1er_we?: boolean
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
  { label: 'Échanges',      href: '/echanges',            icon: 'ArrowLeftRight', roles: ['admin', 'veto'] },
  // « Compteurs » menait à l'écran V1 `/compteurs`, resté en ligne à côté de
  // `/historique` (V2) qui affiche les MÊMES chiffres. Deux écrans, deux
  // habillages, aucun des deux ne disant lequel faisait foi. L'URL V1 redirige
  // désormais ici ; l'entrée de menu y va directement.
  { label: 'Compteurs',     href: '/historique',          icon: 'BarChart3',    roles: ['admin', 'veto'] },
  // « Règles » mène désormais à l'écran V2 « Règles & structure », qui a
  // absorbé l'ancienne page /admin/structure — d'où la disparition de l'entrée
  // « Structure » juste en dessous. L'écran est admin : tout y est de la
  // configuration de cabinet, et le dock V2 ne l'a jamais proposé aux vétos.
  { label: 'Organisation',  href: '/regles',              icon: 'ScrollText',   roles: ['admin'] },
  { label: 'Demandes',      href: '/admin/demandes',      icon: 'Inbox',        roles: ['admin'] },
  { label: 'Dépannages',    href: '/admin/depannages',    icon: 'LifeBuoy',     roles: ['admin'] },
  // Les deux pages V1 correspondantes ont été supprimées : `/admin/periodes`
  // était un doublon complet de la section « périodes » de `/historique`, et
  // `/admin/veterinaires` lisait ET écrivait dans `contraintes_veto` — une
  // table que le moteur n'ouvre plus. Un admin qui y réglait une contrainte
  // croyait agir sur le planning sans que rien ne bouge. Les entrées mènent
  // désormais aux écrans V2 qui portent réellement ces sujets.
  // Plus d'entrée « Périodes » séparée : elle pointait déjà sur `/historique`,
  // tout comme « Compteurs » ci-dessus depuis que la V1 a été repliée. Deux
  // entrées sur la même adresse s'allumaient ensemble à chaque visite, sans
  // qu'aucune ne mène ailleurs que l'autre.
  { label: 'Vétérinaires',  href: '/equipe',              icon: 'Users',        roles: ['admin'] },
  { label: 'Journal e-mails', href: '/admin/journal-emails', icon: 'MailWarning', roles: ['admin'] },
]
