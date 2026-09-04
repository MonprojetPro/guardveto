// ============================================================
// GUARDVETO — QUEL CRÉNEAU UN JOUR PORTE-T-IL DANS LA TABLE ? (B-111)
// ============================================================
// Sert au PRÉ-REMPLISSAGE : avant toute génération, une période n'a aucune
// ligne dans `gardes`. Pour poser une garde à la main sur un jour vide, l'écran
// doit savoir quel créneau créer — et il ne peut le deviner qu'ici.
//
// ── POURQUOI CE N'EST PAS UNE SIMPLE TABLE DE CORRESPONDANCE ───────────────
//
// Deux jours n'ont AUCUN créneau propre en base, et pour deux raisons
// différentes qu'il ne faut pas confondre :
//
//   • le DIMANCHE est couvert par la garde du samedi (un week-end est une
//     seule garde qui court du vendredi soir au lundi matin) ;
//   • le VENDREDI aussi : le moteur connaît un créneau `vendredi_soir`, mais la
//     table ne le stocke pas — il est porté par la garde de week-end, avec les
//     rôles inversés à l'affichage.
//
// Poser une garde « vendredi » créerait donc une ligne que rien ne lit, et qui
// entrerait en collision avec le week-end au premier calcul.
//
// ⚠️ CETTE FONCTION DOIT RESTER LA RÉCIPROQUE DE `mapTypeGardeEnDb`. Elles ne
// peuvent pas être fusionnées (celle-là part d'un jour, l'autre d'un créneau du
// moteur), mais elles décrivent le même découpage. Les laisser diverger ferait
// créer à la main des gardes que la génération écraserait au tour suivant, ou
// qui collisionneraient sur `UNIQUE(cabinet_id, date, type)`.
// ============================================================

import { typeGardePourJour } from '@/engine/structure-creneaux'

export interface CreneauPosable {
  /** Type tel qu'il sera écrit dans `gardes.type`. */
  type: string
  /** Ce qu'on affiche à l'admin (« nuit de semaine », « week-end »…). */
  libelle: string
}

/**
 * Le créneau qu'on peut créer à la main sur ce jour, ou `null` avec la raison.
 *
 * `estFerie` est fourni par l'appelant : le calendrier des fériés dépend de la
 * région du cabinet, et le recalculer ici en dur rouvrirait l'écart entre le
 * moteur (zone-aware) et l'écran, déjà payé le 2026-07-03.
 */
export function creneauPosableDuJour(
  dateISO: string,
  estFerie: boolean,
): { creneau: CreneauPosable } | { creneau: null; raison: string } {
  const jourIdx = new Date(dateISO + 'T12:00:00Z').getUTCDay() // 0 = dimanche
  const typeMoteur = typeGardePourJour(jourIdx)

  if (typeMoteur === 'weekend') {
    return { creneau: { type: 'weekend', libelle: 'week-end' } }
  }

  if (typeMoteur === 'semaine_soir') {
    return estFerie
      ? { creneau: { type: 'ferie', libelle: 'jour férié' } }
      : { creneau: { type: 'semaine', libelle: 'nuit de semaine' } }
  }

  if (typeMoteur === 'vendredi_soir') {
    return {
      creneau: null,
      raison: 'Le vendredi soir fait partie de la garde du week-end : fixez-la sur le samedi.',
    }
  }

  return {
    creneau: null,
    raison: 'Le dimanche est couvert par la garde du week-end : fixez-la sur le samedi.',
  }
}
