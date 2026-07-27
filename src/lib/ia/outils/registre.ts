// ============================================================
// GUARDVETO — Le catalogue des outils de Filou
// ============================================================
// SERVER-ONLY. Un seul endroit où l'on déclare ce que Filou sait faire.
// Ajouter une capacité = écrire un outil dans un fichier de son domaine, puis
// l'ajouter à la liste ci-dessous. Rien d'autre à toucher : ni la boucle, ni
// l'action serveur, ni l'affichage.
//
// LE PÉRIMÈTRE SUIT LE RÔLE. Un vétérinaire non-administrateur ne reçoit pas
// les outils réservés à l'admin — pas grisés, pas refusés au clic : absents de
// son catalogue. Lui montrer une capacité pour lui répondre « accès refusé »
// serait la coquille vide qu'on refuse partout ailleurs.
// ============================================================

import { lireEquipe, modifierVeterinaire } from './equipe'
import { listerRegles, creerRegle, agirSurRegles } from './regles'
import type { ContexteOutil, Outil } from './types'

/** Tout ce que Filou sait faire, tous rôles confondus. */
export const CATALOGUE: Outil[] = [
  // Équipe
  lireEquipe,
  modifierVeterinaire,
  // Règles du cabinet
  listerRegles,
  creerRegle,
  agirSurRegles,
]

/** Le catalogue tel que cette personne y a droit. */
export function outilsPour(ctx: Pick<ContexteOutil, 'estAdmin'>): Outil[] {
  return CATALOGUE.filter((o) => !o.adminSeulement || ctx.estAdmin)
}

/** Retrouve un outil par son nom, en respectant les droits : c'est ce qui
 *  empêche qu'un nom d'outil renvoyé par le client déclenche une capacité
 *  hors de son périmètre. */
export function trouverOutil(nom: string, ctx: Pick<ContexteOutil, 'estAdmin'>): Outil | undefined {
  return outilsPour(ctx).find((o) => o.nom === nom)
}
