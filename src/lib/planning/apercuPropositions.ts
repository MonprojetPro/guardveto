// ============================================================
// GUARDVETO — Quelles cases de la grille une proposition touche (B-123)
// ============================================================
// MiKL, le 17/09, en recette du Lot 2 : « j'aurais aime avoir les
// propositions qui apparaissent directement sur le planning […] c'est un
// gros pave de texte, donc faut que je lise, que j'aille voir sur le
// planning etc. Ce n'est pas fluide. »
//
// ── LA MÉTHODE, ET POURQUOI C'EST CELLE DES CADENAS ─────────────────────────
//
// La grille inverse déjà rôles ET personnes sur la ligne du vendredi
// (`ecrirePlanningV1`, vue `planning_semaine`) — c'est ce qui a fait échouer
// le cadenas le 04/09 : comparer par LIBELLÉ DE RÔLE désignait la mauvaise
// personne un jour sur trois. `PlanningV2.tsx` a déjà résolu ce problème pour
// les cadenas en raisonnant par PERSONNE (`vetId`), jamais par rôle — ce
// module fait exactement pareil, et pour la même raison : la date et le
// vétérinaire concerné sont vrais quel que soit le vocabulaire (moteur ou
// vue) utilisé pour nommer le créneau.
//
// ⚠️ CE QUE CE MODULE NE SAIT PAS FAIRE, ET C'EST ASSUMÉ : `ChangementPropose`
// ne porte que qui ARRIVE (`vetId`), jamais qui PART — cette information
// (`ChangementArbitre.avant`) n'est pas persistée dans `propositions_relecture`.
// Une place qui se viderait (`vetId: null`) ne peut donc pas être surlignée :
// on ne peut pas circler une case sans savoir QUI y aller regarder. Vu la
// rareté du cas (Filou propose presque toujours un échange, pas un retrait
// sec), l'écart est accepté plutôt que de complexifier le stockage pour lui.
// ============================================================

import type { ChangementPropose } from '@/engine/relecture/arbitrer'

export interface PropositionPourApercu {
  id: string
  changement: ChangementPropose
}

/**
 * Pour chaque date touchée par au moins une proposition en attente, la table
 * des vétérinaires qui ARRIVERAIENT sur une place — et par quelle proposition.
 *
 * Sérialisable tel quel (objets, pas de `Map`) : ce module tourne côté
 * serveur, le résultat traverse la frontière serveur/client vers `PlanningV2`.
 */
export function calculerTouchesApercu(
  propositions: readonly PropositionPourApercu[],
): Record<string, Record<string, string>> {
  const parDate: Record<string, Record<string, string>> = {}

  for (const p of propositions) {
    for (const a of p.changement.affectations) {
      // `vetId: null` = la proposition VIDE cette place. Rien à circler : on
      // ne connaît pas, ici, qui l'occupait pour le désigner (cf. en-tête).
      if (!a.vetId) continue
      const parVet = (parDate[a.date] ??= {})
      // Dernier gagnant en cas de chevauchement (même vétérinaire visé par
      // deux propositions le même jour) : cas limite, pas une donnée fausse —
      // cliquer la case ouvre l'une des deux, l'admin voit l'autre au tour
      // suivant.
      parVet[a.vetId] = p.id
    }
  }

  return parDate
}
