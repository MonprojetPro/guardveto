// ============================================================
// GUARDVETO — Les formes échangées autour d'une demande de support
// ============================================================
// Ces types vivent ICI et pas dans `actions.ts` : un fichier `'use server'` ne
// peut RIEN exporter d'autre que des fonctions asynchrones. Un type réexporté
// depuis un tel fichier compile, passe les tests, et rend la page blanche en
// production — incident déjà payé sur ce projet, et gardé par
// `tests/lib/use-server-exports.test.ts`.
// ============================================================

import type { TypeDemande } from '@/lib/support/contraintes'

/** Une pièce déjà déposée dans le stockage, décrite au serveur. */
export interface PieceDeposee {
  /** Chemin dans le bucket `support` : `<cabinet>/<demande>/<nom>`. */
  chemin: string
  /** Le nom d'origine, accents et espaces compris — c'est lui qui part dans l'e-mail. */
  nomOrigine: string
  taille: number
  typeMime: string
}

/** Ce que le formulaire envoie à l'action serveur. */
export interface DepotDemande {
  /** Généré par le navigateur : il sert de dossier de dépôt AVANT l'insertion. */
  demandeId: string
  type: TypeDemande
  titre: string
  description: string
  pieces: PieceDeposee[]
  /** L'écran d'où part la demande, tel que le navigateur le connaît. */
  ecran: string | null
  navigateur: string | null
}

/** Une demande telle que l'écran la relit. */
export interface LigneDemande {
  id: string
  type: TypeDemande
  titre: string
  description: string
  statut: 'recue' | 'en_cours' | 'traitee' | 'fermee'
  nbPieces: number
  emailEnvoye: boolean
  emailErreur: string | null
  auteurNom: string | null
  /** Vrai si c'est l'utilisateur qui regarde qui l'a écrite. */
  deMoi: boolean
  createdAt: string
}
