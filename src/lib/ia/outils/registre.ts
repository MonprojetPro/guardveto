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
import {
  lireGardes,
  lireEtatPeriodes,
  verifierPreVolPeriode,
  creerPeriode,
  reglerPeriode,
  publierPeriode,
} from './planning'
import {
  lireConges,
  lireSouhaitsEnAttente,
  poserConge,
  validerConge,
  refuserConge,
  supprimerConge,
} from './conges'
import {
  lireAbsences,
  lireCompensations,
  lireCreneauxTouches,
  declarerAbsence,
  appelerVolontaires,
  reparerAbsence,
  marquerCompensation,
} from './absences'
import {
  lireEchanges,
  proposerEchangeOutil,
  accepterEchangeOutil,
  refuserEchangeOutil,
  annulerEchangeOutil,
  validerEchangeAdminOutil,
  refuserEchangeAdminOutil,
} from './echanges'
import {
  lireCompteurs,
  verifierCoherencePlanning,
  lireHistoriquePeriodes,
  lireHistoriqueFetes,
  lireReglagesEquite,
  reglerEquite,
} from './compteurs'
import {
  lireProfilsPlanning,
  lireCreneauxProfil,
  lireRelationsCreneaux,
  lireReglagesCabinet,
  creerProfilDepuisPhrase,
  creerRelationDepuisPhrase,
  agirSurCreneau,
  agirSurRelation,
  supprimerProfilDepuisNom,
  reglerHorairesCreneau,
  creerCreneauSurMesureDepuisPhrase,
  configurerAdresseDepuisPhrase,
  configurerPartagesDepuisPhrase,
} from './structure'
import type { ContexteOutil, Outil } from './types'

/** Tout ce que Filou sait faire, tous rôles confondus.
 *
 *  L'ordre compte un peu : le catalogue est envoyé tel quel au modèle, et les
 *  premiers outils pèsent dans ce qu'il envisage en premier. On met donc en
 *  tête ce qu'on veut qu'il consulte avant de conclure — l'équipe et les
 *  règles — et les gestes rares en fin de liste. */
export const CATALOGUE: Outil[] = [
  // Qui fait quoi — à consulter avant toute conclusion sur une personne
  lireEquipe,
  listerRegles,
  // Le planning et les compteurs
  lireGardes,
  lireEtatPeriodes,
  lireCompteurs,
  lireHistoriquePeriodes,
  lireHistoriqueFetes,
  verifierCoherencePlanning,
  // Absences, congés, échanges — le quotidien
  lireConges,
  lireSouhaitsEnAttente,
  lireAbsences,
  lireCompensations,
  lireCreneauxTouches,
  lireEchanges,
  // Les réglages
  lireReglagesEquite,
  lireProfilsPlanning,
  lireCreneauxProfil,
  lireRelationsCreneaux,
  lireReglagesCabinet,

  // ── Ce qui modifie : rien ne s'exécute sans un clic humain ──
  modifierVeterinaire,
  creerRegle,
  agirSurRegles,
  poserConge,
  validerConge,
  refuserConge,
  supprimerConge,
  declarerAbsence,
  appelerVolontaires,
  reparerAbsence,
  marquerCompensation,
  proposerEchangeOutil,
  accepterEchangeOutil,
  refuserEchangeOutil,
  annulerEchangeOutil,
  validerEchangeAdminOutil,
  refuserEchangeAdminOutil,
  creerPeriode,
  reglerPeriode,
  publierPeriode,
  verifierPreVolPeriode,
  reglerEquite,
  creerProfilDepuisPhrase,
  creerRelationDepuisPhrase,
  agirSurCreneau,
  agirSurRelation,
  supprimerProfilDepuisNom,
  reglerHorairesCreneau,
  creerCreneauSurMesureDepuisPhrase,
  configurerAdresseDepuisPhrase,
  configurerPartagesDepuisPhrase,
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
