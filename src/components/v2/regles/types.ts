// ============================================================
// GUARDVETO V2 — Le vocabulaire partagé de « Règles & structure »
// ============================================================
// Les quatre onglets de l'écran parlent des mêmes objets : un profil, un
// créneau, une liaison, une règle. Ce fichier est le seul endroit où ces
// formes sont décrites — un onglet qui redéclarerait « son » créneau
// finirait par diverger de celui d'à côté, et l'utilisateur verrait deux
// vérités pour une seule donnée.
//
// Tout est déjà MIS EN CLAIR côté serveur (jours, places, horaires en
// français) : les onglets affichent, ils ne recalculent pas. Une phrase
// construite à deux endroits est une phrase qui finit par différer.
// ============================================================

/** Un profil de planning du cabinet (« Hiver », « Été »…). */
export interface ProfilUI {
  id: string
  nom: string
  estDefaut: boolean
  /** 'ete' | 'hiver' | null — proposé automatiquement à la création d'une période. */
  saisonSuggeree: string | null
  /** Vétérinaires de garde le soir en semaine (1 ou 2), ou null = selon la saison. */
  effectifSoirSemaine: number | null
  /** Catalogue de ce profil, déjà trié par `ordre`. */
  creneaux: CreneauUI[]
  /** Liaisons de ce profil. */
  relations: RelationUI[]
}

/** Un type de garde du catalogue, tel que le moteur le consomme. */
export interface CreneauUI {
  id: string
  /** Code machine (`weekend`, `sm_garde_de_jour`…) ou null (créneau non codifié). */
  code: string | null
  nom: string
  /** Jours d'application, 0 = dimanche … 6 = samedi. */
  joursSemaine: number[]
  surFeries: boolean
  /** 'HH:MM'. */
  heureDebut: string
  heureFin: string
  /** 0 = le jour même, 1 = le lendemain, 2 = le surlendemain, 3 = trois jours après. */
  offsetJoursFin: number
  nbPlaces: number
  /** Libellés des places, longueur = nbPlaces. */
  roles: string[]
  actif: boolean
  ordre: number
  /**
   * Un des 4 créneaux du seed. Conséquences : insupprimable (seulement
   * désactivable), et ses JOURS sont figés — l'ancrage jour → type de garde est
   * ré-implémenté exprès dans le validateur, en contrôle croisé du moteur.
   */
  estSeed: boolean
  // ── Déjà mis en clair côté serveur ──
  /** « Lun, Mar, Mer + jours fériés ». */
  joursClair: string
  /** « 2 places : 1er, 2nd ». */
  placesClair: string
  /** « De 19:00 à 08:00, le lendemain ». */
  horairesClair: string
}

/** Le genre d'une liaison entre deux créneaux. */
export type GenreRelationUI = 'meme_binome' | 'inversion_role'

/** Une liaison « source → cible » d'un profil. */
export interface RelationUI {
  id: string
  sourceId: string
  cibleId: string
  sourceNom: string
  cibleNom: string
  genre: GenreRelationUI
  actif: boolean
}

/**
 * Le NIVEAU d'un genre de liaison (ferme / souple), qui vit dans
 * `regles_cabinet` et non dans `relation_creneau`.
 *
 * C'est une frontière de persistance, pas une frontière de sujet : la liste
 * des liaisons et leur fermeté sont une seule question pour l'utilisateur, et
 * l'onglet « Enchaînements » les montre ensemble. En V1 elles étaient sur deux
 * écrans différents — on créait la liaison ici et on réglait sa force là-bas.
 */
export interface NiveauLiaisonUI {
  /** `liaison_creneaux` (même équipe) ou `inversion_role` (rôles différents). */
  actif: boolean
  /** 'jamais' | 'sauf_crise' | 'evitee' | 'si_possible'. */
  force: string
}

/** Un vétérinaire, réduit à ce que l'écran des règles affiche. */
export interface VetoUI {
  id: string
  prenom: string
  nom: string
  couleur: string
  tags: string[] | null
}
