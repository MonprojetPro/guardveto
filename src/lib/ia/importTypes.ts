// ============================================================
// GUARDVETO — Le vocabulaire de l'import d'un ancien planning
// ============================================================
// Des TYPES, et rien d'autre. Ce fichier existe pour une raison précise :
// l'écran de validation (composant client) et l'action serveur doivent parler
// la même langue, et aucun des deux ne peut importer l'autre.
//
//   • L'action vit dans un `'use server'`, qui n'a pas le droit d'exporter un
//     type — page blanche en production garantie (piège déjà payé).
//   • La lecture (`lirePlanningImporte.ts`) embarque le SDK Anthropic :
//     l'importer depuis un composant client tirerait tout le SDK dans le
//     paquet envoyé au navigateur.
//
// Ce fichier n'importe rien, ne dépend de rien, et se laisse donc lire des
// deux côtés sans conséquence.
// ============================================================

/** Un vétérinaire du cabinet, tel que la résolution des noms le connaît. */
export interface VetoConnu {
  id: string
  prenom: string
  nom: string
}

/**
 * Une ligne du document, telle qu'elle s'affiche pour être validée.
 *
 * `premierLu` / `secondLu` gardent ce qui était ÉCRIT sur le document, même
 * quand le rattachement a échoué : sans ça, une case mal reconnue disparaîtrait
 * de l'écran au lieu de se signaler.
 */
export interface LignePlanningLue {
  /** Identifiant local, stable côté écran (l'ordre de lecture). */
  cle: number
  date: string
  type: 'weekend' | 'semaine' | 'ferie'
  premierId: string | null
  secondId: string | null
  premierLu: string
  secondLu: string
  /** Les noms lus qui ne correspondent à personne du cabinet. */
  inconnus: string[]
}

export interface LecturePlanning {
  lignes: LignePlanningLue[]
  /** Ce que le modèle a déclaré ne PAS avoir su lire. Une phrase par endroit. */
  illisibles: string[]
  remarque: string
  ms: number
  modele: string
}

/** Ce que l'écran renvoie au serveur au moment d'écrire. */
export interface LigneAEcrire {
  date: string
  type: string
  premierId: string | null
  secondId: string | null
}

export type ReponseImport =
  | { error: string }
  | { fichier: string; lecture: LecturePlanning; vets: VetoConnu[] }

export type ReponseEcritureImport =
  | { error: string }
  | {
      success: true
      periodeId: string
      libelle: string
      nbGardes: number
      dateDebut: string
      dateFin: string
      /** Faux quand les gardes sont bien écrites mais que le rattrapage
       *  d'équité (`bonus_malus`) n'a pas pu l'être : l'historique est là,
       *  l'amorçage de l'équité non. Ça se dit, ça ne se tait pas. */
      bilanEcrit: boolean
    }
