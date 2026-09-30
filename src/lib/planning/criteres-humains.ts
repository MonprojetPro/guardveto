// ============================================================
// GUARDVETO — Les critères HUMAINS de relecture du planning (B-062, lot 1)
// ============================================================
// POURQUOI CE FICHIER EXISTE — MiKL, le 27/08 :
//
//   « L'idée c'est vraiment d'avoir un observateur indépendant qui se rapproche
//    plus de la doctrine humaine (repos, épuisement, équilibre global, etc.)
//    que celle d'un moteur algorithmique. »
//
// ── LE PIÈGE QU'IL FAUT ÉVITER ──────────────────────────────────────────────
//
// Si on donne à Filou les mêmes critères qu'au moteur, il devient une doublure
// coûteuse : il refait le même calcul, plus lentement et moins bien. Sa valeur
// est exactement là où le moteur est AVEUGLE.
//
//   Le moteur sait compter des totaux justes.
//   Il ne verra jamais que les 3 gardes de Jean tombent la même semaine.
//
//   Le moteur sait vérifier qu'une règle est respectée.
//   Il ne verra jamais que cinq jours de garde en six, c'est quelqu'un d'épuisé.
//
//   Le moteur sait dire « c'est légal ».
//   Il ne sait pas dire « c'est légal et personne ne l'accepterait ».
//
// Chacun des critères ci-dessous est né d'un constat RÉEL de MiKL sur un vrai
// planning, pas d'une liste théorique. Le numéro d'item du board est cité :
// le jour où l'un d'eux devient inutile, on saura ce qu'il servait à attraper.
//
// ── CE QUE CE FICHIER N'EST PAS ─────────────────────────────────────────────
//
// Ce n'est PAS une formule. On donne à Filou une INTENTION (« l'équité doit
// être maximale, voici ce que ça veut dire ici »), jamais un coefficient. Les
// coefficients sont l'affaire du moteur, et les recopier ici les ferait
// diverger au premier réglage changé.
//
// ── ÉVOLUTION ───────────────────────────────────────────────────────────────
//
// Zone d'ombre 1 tranchée par MiKL le 27/08 : la liste est FIGÉE dans un
// premier temps, pas réglable par cabinet. On la fait évoluer avec ce qu'il
// observe. La rendre réglable tout de suite aurait demandé un écran de
// configuration avant même de savoir si les critères sont les bons.
// ============================================================

/** Un critère de relecture, tel que Filou le reçoit. */
export interface CritereHumain {
  /** Clé stable — Filou la cite dans sa proposition, le rapport la regroupe. */
  cle: string
  /** Le titre montré à l'admin dans le rapport. */
  titre: string
  /** Ce qu'on demande à Filou de regarder, écrit comme on le dirait à un humain. */
  consigne: string
  /** D'où vient ce critère — un constat réel, avec son item de board. */
  origine: string
}

export const CRITERES_HUMAINS: CritereHumain[] = [
  // ── LA DOCTRINE DU PRODUIT ────────────────────────────────────────────────
  {
    cle: 'equite_volume',
    titre: 'Personne ne porte plus que sa part',
    consigne:
      "Regarde le nombre total de gardes de chacun sur la période, en tenant compte de ses absences : quelqu'un qui est là tout le temps doit en faire plus que quelqu'un qui est absent la moitié du temps. Signale un écart que l'équipe trouverait injuste, pas un écart d'une garde.",
    origine: 'Doctrine du produit — la raison d’être du moteur.',
  },
  {
    cle: 'role_avantage',
    titre: 'Le rôle qui rapporte doit tourner',
    consigne:
      "Le premier de garde du week-end porte l'avantage financier. Regarde qui l'obtient et qui ne l'obtient JAMAIS. Quelqu'un qui fait des week-ends sans jamais être premier accumule la charge sans la contrepartie — c'est le déséquilibre le plus mal vécu, et il ne se voit pas dans un total de gardes.",
    origine:
      'B-061 — Fanny faisait 2 week-ends, les deux en seconde, et rien ne le signalait.',
  },
  {
    cle: 'bouche_trou',
    titre: 'Personne n’est le bouche-trou permanent',
    consigne:
      "Regarde si une même personne revient systématiquement sur les créneaux que personne ne veut, ou comble toutes les absences des autres. Un planning peut être parfaitement équilibré en nombre et reposer entièrement sur la disponibilité d'une seule personne.",
    origine: 'Doctrine du produit — le corollaire de l’équité en volume.',
  },

  // ── LA CHARGE HUMAINE — ce que le moteur ne voit pas ──────────────────────
  {
    cle: 'concentration',
    titre: 'Les gardes ne s’entassent pas sur une seule semaine',
    consigne:
      "C'est le point le plus important. Le moteur compte des TOTAUX justes, jamais le RYTHME : tout le quota d'une personne peut tomber sur une seule semaine, et plus rien ensuite. Repère les semaines où quelqu'un enchaîne, même si son total sur la période est correct.",
    origine:
      'B-037 — Antoine de garde le week-end des 3-4 octobre PUIS lundi 5, mardi 6 et jeudi 8 : cinq jours de garde en six, avec un total pourtant exact.',
  },
  {
    cle: 'repos_reel',
    titre: 'Il reste du repos entre deux gardes',
    consigne:
      "Une garde de nuit déborde sur le lendemain matin. Deux gardes séparées d'un jour ne laissent pas un jour de repos, elles en laissent une demie. Regarde les enchaînements dimanche → lundi, et tout ce qui suit immédiatement un week-end de garde.",
    origine:
      'B-037 — `espacement_min` est posée à 2 jours mais réglée sur « à éviter » : le moteur la viole donc légalement.',
  },
  {
    cle: 'veille_de_repos',
    titre: 'On ne mord pas sur un jour d’absence',
    consigne:
      "Une garde la veille d'un jour où la personne n'est pas là (congé, formation, jour de repos fixe) lui mange ce jour-là : elle rentre le matin. Signale-les, même quand la règle du cabinet ne les interdit pas.",
    origine: 'B-063 — la règle existe désormais, mais reste au niveau « à éviter ».',
  },
  {
    cle: 'epuisement',
    titre: 'Personne ne sort épuisé de la période',
    consigne:
      "Prends du recul sur la période entière, personne par personne. Si tu devais annoncer ce planning à l'équipe en salle de pause, y a-t-il quelqu'un dont tu te dirais « celui-là, il ne va pas tenir » ? Dis-le, même si aucune règle n'est enfreinte.",
    origine:
      'MiKL, 27/08 — c’est la question qu’un associé se pose et qu’aucun calcul ne pose.',
  },

  // ── CE QUE L’ADMINISTRATRICE FAIT À LA MAIN (B-138) ───────────────────────
  //
  // Ces deux-là ne viennent pas d'un défaut constaté mais d'une PRATIQUE : ce
  // qu'Anne-Sophie corrigeait elle-même, chaque période, sans que rien ne
  // l'aide. MiKL, le 30/09 : « c'est juste du bon sens, si tout le permet c'est
  // logique de faire tourner les vétos dispo ».
  //
  // ⚠️ Ils ont failli partir en règles du moteur. Impossible, et pour une
  // raison qui vaut d'être retenue : « quand l'effectif le permet » est un
  // jugement de situation. Une brique dure l'appliquerait aussi en pleine
  // période de congés, où il n'y a personne d'autre — elle rendrait le planning
  // infaisable au lieu de se relâcher toute seule. C'est exactement la
  // frontière que ce fichier trace.
  {
    cle: 'decharge_avant_weekend',
    titre: 'Le binôme du week-end arrive frais',
    consigne:
      "Repère qui tient chaque week-end, puis regarde les nuits du lundi au jeudi DE CETTE MÊME SEMAINE — celles qui PRÉCÈDENT son week-end, pas celles d'après. Quand l'effectif le permettait, cette personne ne devrait pas avoir enchaîné des nuits juste avant de prendre le week-end : il y avait du monde pour les tenir. Sers-toi du nombre de disponibles qu'on te donne semaine par semaine, ne le recalcule pas. Ne le signale que si un autre prénom figure dans la liste « peuvent aussi » de la nuit concernée : s'il n'y a personne d'autre, ce n'est pas un défaut mais une contrainte, et le dire serait du bruit. NE PROPOSE JAMAIS de retirer un vendredi soir : il va au binôme du week-end par la structure du cabinet, le mouvement serait refusé.",
    origine:
      'B-138 — pratique manuelle d’Anne-Sophie, rapportée par MiKL le 30/09. Le sens a été corrigé par lui avant tout code : c’est la semaine EN COURS, pas la suivante.',
  },
  {
    cle: 'rotation_roles_semaine',
    // « en semaine » dans le TITRE, pas seulement dans la consigne : le titre
    // est ce que l'admin lit dans le rapport, juste à côté de « Le rôle qui
    // rapporte doit tourner » (le premier du WEEK-END). Sans la précision, les
    // deux constats se confondent à la lecture.
    titre: 'Chacun passe en premier ET en second, en semaine',
    consigne:
      "Sur les nuits de semaine, regarde le rôle de chaque personne : « premier » ou « second ». Signale qui n'apparaît que dans un seul des deux sur toute la période — toujours second, on n'apprend jamais à mener ; toujours premier, on porte toujours la décision. Ce n'est pas une question de total : deux personnes peuvent avoir le même nombre de nuits et l'une n'avoir jamais été première. NE DIS RIEN si les nuits de cette période n'ont qu'une seule place — regarde les places qu'on te donne : s'il n'y a aucun « second », c'est la structure de la période, pas un défaut. Ne dis rien non plus pour quelqu'un qui n'a qu'une seule nuit : il ne peut pas être dans les deux rôles.",
    origine:
      'B-138 — « elle fait en sorte que chaque véto fasse une nuit de garde en 1er et une en 2ème ». ⚠️ À NE PAS CONFONDRE avec `role_avantage`, qui porte sur le PREMIER DU WEEK-END et son avantage financier (B-061) ; ici c’est la rotation en semaine, sans enjeu d’argent. La borne « une seule place » vient d’une mesure en base le 30/09 : en été, `semaine_soir` n’a qu’un véto — sans elle, le critère aurait crié « personne n’est jamais second » sur toute période d’été.',
  },

  // ── L’ÉQUILIBRE DANS LE TEMPS ─────────────────────────────────────────────
  {
    cle: 'equilibre_global',
    titre: 'L’équilibre se juge au-delà de cette période',
    consigne:
      "Les compteurs cumulés des périodes précédentes te sont donnés. Quelqu'un qui a beaucoup donné avant doit être ménagé maintenant, et l'inverse. Une période équitable prise isolément peut aggraver un déséquilibre installé depuis six mois.",
    origine:
      'MiKL, 27/08 — « équilibre global ». Sans l’historique, l’expression ne veut rien dire sur 12 semaines.',
  },
  {
    cle: 'cases_vides',
    titre: 'Les cases vides méritent une dernière chance',
    consigne:
      "S'il reste des places à pourvoir, cherche qui pourrait les prendre en déplaçant une ou deux autres gardes. Ne propose JAMAIS quelqu'un d'absent. Si tu ne trouves pas, dis-le clairement plutôt que de proposer un nom au hasard.",
    origine:
      'B-053 / B-060 — le moteur rend désormais un planning partiel ; ces cases sont le premier endroit où un regard neuf peut servir.',
  },
]

/** Retrouve un critère par sa clé. Rend `undefined` si Filou en invente une. */
export function critereParCle(cle: string): CritereHumain | undefined {
  return CRITERES_HUMAINS.find((c) => c.cle === cle)
}

/**
 * Le bloc de critères tel qu'il part dans le prompt.
 *
 * Écrit ici et pas dans le prompt : un critère se relit, se discute et
 * s'amende, et il doit rester lisible par quelqu'un qui n'ouvre jamais le
 * fichier de l'agent.
 */
export function critereEnTexte(): string {
  return CRITERES_HUMAINS.map(
    (c) => `[${c.cle}] ${c.titre}\n${c.consigne}`,
  ).join('\n\n')
}
