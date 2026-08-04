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

/**
 * Une période type du cabinet (« Hiver », « Été »…) — table `profils_planning`.
 *
 * ⚠️ DEPUIS LE 2026-08-04, elle ne possède plus de structure : elle AFFINE le
 * socle du cabinet. MiKL : « la structure donne l'ensemble des possibilités,
 * les périodes types les affinent par période ».
 */
export interface ProfilUI {
  id: string
  nom: string
  estDefaut: boolean
  /**
   * Ses choix : `creneauId` → nombre de vétérinaires voulu. **0 = pas de garde
   * de ce type sur cette période**. Un créneau du socle absent de cette table
   * est pris tel quel (toutes ses places) — l'état d'une période type neuve.
   */
  affinage: Record<string, number>
  /** Le socle DÉJÀ affiné : ce que cette période type produit réellement. */
  creneaux: CreneauUI[]
  /** Les liaisons qui survivent à son affinage (les deux bouts existent). */
  relations: RelationUI[]
}

/** Ce que l'écran « Organisation » lit d'un coup : le socle, et qui l'affine. */
export interface StructureCabinetUI {
  /** LE SOCLE — ce qui est possible dans ce cabinet. `nbPlaces` = le maximum. */
  socle: CreneauUI[]
  /** Les enchaînements, portés par le socle eux aussi. */
  relations: RelationUI[]
  profils: ProfilUI[]
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
  /**
   * Les fiches DÉSACTIVÉES sont chargées elles aussi : une règle peut viser
   * quelqu'un qui ne fait plus de gardes, et la masquer afficherait un identifiant
   * brut à la place de son prénom. Mais on ne PROPOSE que les actifs quand il
   * s'agit de poser une étiquette : le serveur ne la pose que sur des fiches
   * actives (`poserEtiquetteSurVetos`), et une case à cocher sans effet est pire
   * qu'une case absente.
   */
  actif?: boolean
}
