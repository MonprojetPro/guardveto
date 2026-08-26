// ============================================================
// GUARDVETO — Effectif mobilisable par la GÉNÉRATION (B-046)
// ============================================================
// Décision produit de MiKL, le 2026-08-26 :
//
//   « Le dernier recours ne doit JAMAIS être compté pour la génération de
//     planning. Il n'apparaît que pour les modifications en mode manuel. »
//
// AVANT — le dernier recours n'était pas exclu, il était seulement REPOUSSÉ :
// score 1 000 000 dans le solver (`scorerCandidat` / `scorerCandidatLNS`) et
// simple avertissement R7 dans les contraintes dures. Conséquence : quand le
// moteur n'avait plus personne, il le plaçait quand même — et l'admin
// découvrait un planning où le dernier recours était de garde sans l'avoir
// décidé. Le score n'était pas un garde-fou, c'était un ordre de préférence.
//
// APRÈS — il sort de l'effectif AVANT le moteur. Le solver ne le voit pas,
// l'équité ne le compte pas, le pré-vol ne le compte pas dans les vétos
// mobilisables. Si la période devient insoluble sans lui, on le DIT
// (cf. `exclusDernierRecours` dans le rapport d'impasse) au lieu de
// le mobiliser en douce.
//
// ⚠️ Ce filtre ne s'applique QU'À LA GÉNÉRATION (génération, replay, pré-vol).
// Les chemins MANUELS le gardent disponible, c'est toute sa raison d'être :
//   • retouche d'une garde (modale de disponibilités, PATCH d'une garde) ;
//   • réparation d'une absence / dépannage (`lib/crise/*`) ;
//   • appel aux volontaires (personne ne lui impose rien, il se propose).
// ============================================================

/**
 * Retire de l'effectif les vétérinaires « dernier recours ».
 *
 * Générique sur le type : le moteur manipule des `VetEngine`, la crise des
 * `VetEngineNormalise`, l'écran d'équipe des lignes DB — tous portent
 * `dernier_recours`, et aucun n'a besoin d'être converti pour passer ici.
 */
export function effectifPourGeneration<T extends { dernier_recours: boolean }>(
  vets: T[],
): T[] {
  return vets.filter((v) => !v.dernier_recours)
}

/**
 * Les vétérinaires que `effectifPourGeneration` a écartés.
 *
 * Sert à DIRE l'exclusion quand la génération échoue : une impasse causée par
 * un réglage volontaire doit nommer ce réglage, sinon l'admin cherche un
 * coupable parmi ses règles pendant une heure. Même famille que la règle
 * « le tableau ne peut pas se taire ».
 */
export function exclusDeLaGeneration<T extends { dernier_recours: boolean }>(
  vets: T[],
): T[] {
  return vets.filter((v) => v.dernier_recours)
}
