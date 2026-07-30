// ============================================================
// GUARDVETO V2 — D'où vient-on quand on fait appel à Filou
// ============================================================
// Filou est posé sur plusieurs écrans, toujours pour le même geste : ramener
// à l'accueil, où il a sa tablette et le tableau du cabinet. Mais arriver sur
// un « bonjour » générique après avoir cliqué depuis l'onglet Dépannages, c'est
// perdre en route la seule chose qu'on savait de la personne : ce qu'elle était
// en train de regarder.
//
// L'origine voyage donc dans le fragment d'URL (`/accueil#filou=depannages`).
// Le fragment et pas la query : il ne part pas au serveur, ne casse pas le
// cache de la route, et disparaît de la barre d'adresse dès qu'il est lu.
//
// ⚠ RÈGLE DURE — n'annoncer QUE ce que Filou sait réellement faire. Une
// question d'accroche qui promet « je t'aide à valider ce congé » alors qu'aucun
// outil ne sait le faire est une coquille vide : la personne répond « oui »,
// et Filou se dégonfle. Les phrases ci-dessous sont adossées au catalogue
// d'outils réel (`src/lib/ia/outils/`). Toute nouvelle promesse doit être
// vérifiée dans ce catalogue AVANT d'être écrite ici.
//
// ⚠ SECOND PIÈGE, moins visible : le champ de saisie de la tablette n'existe
// QUE pour un administrateur (`FilouChat.tsx`, l'action serveur est admin-only).
// Poser une question à un vétérinaire qui n'a aucun moyen d'y répondre serait
// la même coquille vide, d'un cran plus vexante. C'est l'appelant qui tranche
// (cf. `Epicentre.tsx`) : rien n'est dit hors administrateur. Les accroches
// ci-dessous sont donc écrites pour un administrateur, et peuvent nommer des
// outils qui lui sont réservés.
// ============================================================

/** Les écrans depuis lesquels on peut faire appel à Filou. */
export type OrigineFilou =
  | 'planning'
  | 'conges'
  | 'echanges'
  | 'depannages'
  | 'equipe'
  | 'regles'
  | 'reglages'
  | 'historique'

/** Ce que Filou dit en arrivant, selon l'écran quitté. */
export interface AccrocheFilou {
  /** La question d'ouverture, à la première personne, telle qu'elle s'affiche. */
  question: string
  /** Deux ou trois exemples de phrases que la personne peut lui envoyer.
   *  Chacune doit correspondre à un outil qui existe vraiment. */
  exemples: string[]
}

/** Ce que Filou propose, écran par écran.
 *
 *  Chaque exemple porte en commentaire le nom de l'outil qui le rend possible :
 *  c'est ce qui permet, quand un outil disparaît du catalogue, de retrouver
 *  d'un coup d'œil les phrases devenues des promesses en l'air. */
export const ACCROCHES: Record<OrigineFilou, AccrocheFilou> = {
  planning: {
    question:
      'Tu reviens du planning — tu veux qu’on le regarde ensemble ? Je sais dire qui est de garde, où en sont les périodes, et si le planning publié tient toujours la route.',
    exemples: [
      'Qui est de garde ce week-end ?', // lire_gardes
      'Où en sont les périodes du cabinet ?', // lire_etat_periodes
      'Est-ce que le planning publié respecte encore les règles ?', // verifier_coherence_planning
    ],
  },
  conges: {
    question:
      'Tu veux que je t’aide à répondre à une demande de congé ? Je peux te sortir la file d’attente, et préparer la validation ou le refus — c’est toi qui cliques.',
    exemples: [
      'Quels souhaits de congé attendent une réponse ?', // lire_souhaits_en_attente
      'Qui est en congé la semaine prochaine ?', // lire_conges
      'Valide le congé de Manon en juillet.', // valider_conge
    ],
  },
  echanges: {
    question:
      'Tu veux qu’on regarde les échanges de gardes ? Je te dis qui a proposé quoi à qui, et je prépare ta validation ou ton refus.',
    exemples: [
      'Quels échanges attendent ma validation ?', // lire_echanges
      'Valide l’échange entre Fanny et Antoine.', // valider_echange_admin
      'Refuse l’échange proposé sur le 14 juillet.', // refuser_echange_admin
    ],
  },
  depannages: {
    question:
      'Tu veux qu’on fasse le point sur les dépannages ? Je sais qui doit une garde à qui, quels créneaux d’une absence n’ont encore personne, et je peux lancer un appel à volontaires.',
    exemples: [
      'Où en sont les dettes de dépannage ?', // lire_compensations
      'Quels créneaux restent à couvrir après l’absence de Victor ?', // lire_creneaux_touches
      'Envoie un appel à volontaires pour la garde de vendredi.', // appeler_volontaires
    ],
  },
  equipe: {
    question:
      'Tu veux qu’on regarde l’équipe ? Je lis toutes les fiches, et je sais changer trois choses : le dernier recours, la présence au planning et les étiquettes. Le reste passe par la fiche.',
    exemples: [
      'Qui est en dernier recours ?', // lire_equipe
      'Sors Anne-Cat du planning.', // modifier_veterinaire
      'Mets l’étiquette junior à Manon.', // modifier_veterinaire
    ],
  },
  regles: {
    question:
      'Tu veux qu’on touche aux règles du cabinet ? Dis-la-moi en français, je la traduis — et rien ne compte tant que tu n’as pas validé.',
    exemples: [
      'Manon jamais de garde le mercredi.', // creer_regle
      'Quelles règles sont en pause ?', // lister_regles
      'Mets en pause la règle sur les grands week-ends.', // agir_sur_regles
    ],
  },
  reglages: {
    question:
      'Tu veux qu’on règle quelque chose sur le cabinet ? Créneaux, horaires, profils de planning, importance de l’équité, adresse, agenda partagé : décris-le, je prépare, tu valides.',
    exemples: [
      'Quels créneaux contient le profil Été ?', // lire_creneaux_profil
      'Change les horaires de la garde de nuit en semaine.', // regler_horaires_creneau
      'Rends les week-ends plus importants dans l’équité.', // regler_equite
    ],
  },
  historique: {
    question:
      'Tu veux qu’on regarde en arrière ? Les périodes passées, les compteurs de gardes, qui a fait Noël et le Nouvel An — là je ne fais que lire, je ne change rien.',
    exemples: [
      'Qui a fait Noël ces dernières années ?', // lire_historique_fetes
      'Montre-moi les compteurs de la période en cours.', // lire_compteurs
      'Liste les périodes passées.', // lire_historique_periodes
    ],
  },
}

/** Le fragment à viser depuis un écran donné. */
export function lienAccueilDepuis(origine: OrigineFilou): string {
  return `/accueil#filou=${origine}`
}

/** Vrai si ce fragment prétend porter une origine — connue ou non.
 *
 *  Sert au nettoyage : un `#filou=depannage` mal orthographié doit disparaître
 *  de la barre d'adresse comme les autres, sinon il traîne dans un lien partagé
 *  et laisse croire qu'il fait quelque chose. */
export function portUneOrigine(hash: string): boolean {
  return /(?:^#|[#&])filou=/.test(hash)
}

/** Lit l'origine dans un fragment d'URL. Rend `null` si le fragment n'en
 *  porte pas, ou en porte une qu'on ne connaît pas (lien tapé à la main,
 *  version précédente) — dans ce cas Filou accueille normalement. */
export function lireOrigine(hash: string): OrigineFilou | null {
  const m = /(?:^#|[#&])filou=([a-z]+)/.exec(hash)
  const valeur = m?.[1]
  return valeur && valeur in ACCROCHES ? (valeur as OrigineFilou) : null
}
