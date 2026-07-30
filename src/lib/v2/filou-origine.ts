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
// ⚠ RÈGLE DURE N°1 — n'annoncer QUE ce que Filou sait réellement faire. Une
// question d'accroche qui promet « je t'aide à valider ce congé » alors qu'aucun
// outil ne sait le faire est une coquille vide : la personne répond « oui »,
// et Filou se dégonfle. Les phrases ci-dessous sont adossées au catalogue
// d'outils réel (`src/lib/ia/outils/`). Toute nouvelle promesse doit être
// vérifiée dans ce catalogue AVANT d'être écrite ici.
//
// ⚠ RÈGLE DURE N°2 — ZÉRO DONNÉE INVENTÉE. Les exemples ont d'abord été écrits
// en dur, avec des prénoms et des dates de fantaisie : « Quels créneaux restent
// à couvrir après l'absence de Victor ? ». Aucun Victor n'était absent. Filou a
// répondu, très correctement, qu'il ne voyait rien — c'était la SUGGESTION qui
// mentait. Le prix est double : un aller-retour perdu pour la personne, et un
// appel au modèle facturé pour une question qui ne pouvait pas aboutir.
//   • Là où la donnée existe, on la cite exactement (le vrai prénom du souhait
//     en attente, le vrai libellé de la règle).
//   • Là où elle n'existe pas, on formule SANS nom propre ni date : une
//     question générale et vraie vaut infiniment mieux qu'une question précise
//     et fausse.
//   • Là où il n'y a rien d'honnête à proposer (file d'attente vide, aucune
//     absence en cours), on n'affiche AUCUN exemple. La question seule suffit.
// D'où `accrocheDepuis(origine, matiere)` : plus aucune phrase n'est écrite en
// dur avec un nom dedans. N'en réintroduisez pas.
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

/** Toutes les origines connues — sert aussi à valider un fragment d'URL. */
const ORIGINES: readonly OrigineFilou[] = [
  'planning',
  'conges',
  'echanges',
  'depannages',
  'equipe',
  'regles',
  'reglages',
  'historique',
]

/** Ce que Filou dit en arrivant, selon l'écran quitté. */
export interface AccrocheFilou {
  /** La question d'ouverture, à la première personne, telle qu'elle s'affiche. */
  question: string
  /** Deux ou trois phrases toutes prêtes, taillées dans la donnée réelle du
   *  cabinet. Un clic les envoie tel quel : elles doivent donc être vraies.
   *  Tableau vide = rien à proposer honnêtement, et on n'affiche rien. */
  exemples: string[]
}

/**
 * La matière réelle du cabinet dans laquelle les exemples sont taillés.
 *
 * Tout est optionnel : un cabinet qui démarre n'a ni souhait, ni échange, ni
 * absence, ni règle — et l'accroche doit alors se réduire à sa question sans
 * rien inventer pour combler.
 *
 * Rempli côté serveur par `chargerAccueil` (`src/data/v2/accueilEpicentre.ts`),
 * qui est le seul endroit à savoir lire la base.
 */
export interface MatiereFilou {
  /** Un prénom réel de l'équipe active, pour les phrases qui en réclament un. */
  prenomVeto: string | null
  /** Le souhait de congé le plus ancien encore en attente de décision. */
  souhait: { prenom: string; dateDebut: string; dateFin: string } | null
  /** Un échange de gardes réellement en attente de validation. */
  echange: { demandeur: string; cible: string } | null
  /** Une absence ACTIVE (celle que `lire_creneaux_touches` saura ouvrir). */
  absence: { prenom: string } | null
  /** Au moins une dette de dépannage à solder. */
  aDesDettes: boolean
  /** Le libellé EXACT d'une règle active, tel que l'écran Règles l'affiche. */
  regleActive: string | null
  /** Le nom du profil de planning de la période en cours. */
  profil: string | null
  /** Un créneau réel du catalogue, déjà en français (« la garde de week-end »). */
  creneau: string | null
  /** Une période existe (sinon les questions de planning n'ont pas d'objet). */
  aUnPlanning: boolean
  /** Au moins une période publiée en cours, donc quelque chose à re-vérifier. */
  planningPublie: boolean
  /** Une garde est posée pour ce soir. */
  gardeCeSoir: boolean
}

/** Cabinet vide : aucune donnée nulle part. Sert de repli et de cas de test. */
export const MATIERE_VIDE: MatiereFilou = {
  prenomVeto: null,
  souhait: null,
  echange: null,
  absence: null,
  aDesDettes: false,
  regleActive: null,
  profil: null,
  creneau: null,
  aUnPlanning: false,
  planningPublie: false,
  gardeCeSoir: false,
}

/** Ce que Filou dit en arrivant, écran par écran. Ces phrases-là ne portent
 *  aucune donnée : elles décrivent ses capacités, qui ne dépendent pas du
 *  contenu de la base. */
const QUESTIONS: Record<OrigineFilou, string> = {
  planning:
    'Tu reviens du planning — tu veux qu’on le regarde ensemble ? Je sais dire qui est de garde, où en sont les périodes, et si le planning publié tient toujours la route.',
  conges:
    'Tu veux que je t’aide à répondre à une demande de congé ? Je peux te sortir la file d’attente, et préparer la validation ou le refus — c’est toi qui cliques.',
  echanges:
    'Tu veux qu’on regarde les échanges de gardes ? Je te dis qui a proposé quoi à qui, et je prépare ta validation ou ton refus.',
  depannages:
    'Tu veux qu’on fasse le point sur les dépannages ? Je sais qui doit une garde à qui, quels créneaux d’une absence n’ont encore personne, et je peux lancer un appel à volontaires.',
  equipe:
    'Tu veux qu’on regarde l’équipe ? Je lis toutes les fiches, et je sais changer trois choses : le dernier recours, la présence au planning et les étiquettes. Le reste passe par la fiche.',
  regles:
    'Tu veux qu’on touche aux règles du cabinet ? Dis-la-moi en français, je la traduis — et rien ne compte tant que tu n’as pas validé.',
  reglages:
    'Tu veux qu’on règle quelque chose sur le cabinet ? Créneaux, horaires, profils de planning, importance de l’équité, adresse, agenda partagé : décris-le, je prépare, tu valides.',
  historique:
    'Tu veux qu’on regarde en arrière ? Les périodes passées, les compteurs de gardes, qui a fait Noël et le Nouvel An — là je ne fais que lire, je ne change rien.',
}

const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
})

/** « 2026-08-12 » → « 12 août ». Midi UTC : aucune date ne bascule d'un jour. */
function jourMois(iso: string): string {
  return JOUR_MOIS.format(new Date(iso + 'T12:00:00Z'))
}

/** « du 12 au 18 août », ou « le 12 août » quand c'est une seule journée. */
function periodeLisible(debut: string, fin: string): string {
  return debut === fin ? `le ${jourMois(debut)}` : `du ${jourMois(debut)} au ${jourMois(fin)}`
}

/**
 * L'accroche d'une origine, taillée dans la matière réelle du cabinet.
 *
 * Chaque exemple porte en commentaire le nom de l'outil qui le rend possible :
 * c'est ce qui permet, quand un outil disparaît du catalogue, de retrouver d'un
 * coup d'œil les phrases devenues des promesses en l'air.
 *
 * Fonction PURE : elle ne lit pas la base, elle ne fait que mettre en phrase ce
 * qu'on lui donne. Un `null` dans la matière retire l'exemple, il ne le remplace
 * jamais par un exemple de secours avec un nom au hasard.
 */
export function accrocheDepuis(origine: OrigineFilou, matiere: MatiereFilou): AccrocheFilou {
  return { question: QUESTIONS[origine], exemples: exemplesPour(origine, matiere) }
}

function exemplesPour(origine: OrigineFilou, m: MatiereFilou): string[] {
  // `null | false` = « pas d'exemple honnête ici », filtré juste après.
  const brut: (string | null | false)[] = (() => {
    switch (origine) {
      case 'planning':
        return [
          // Une question de planning n'a d'objet que s'il existe une période.
          m.aUnPlanning &&
            (m.gardeCeSoir
              ? 'Qui est de garde ce soir ?' // lire_gardes
              : 'Qui est de garde la semaine prochaine ?'), // lire_gardes
          'Où en sont les périodes du cabinet ?', // lire_etat_periodes
          m.planningPublie && 'Est-ce que le planning publié respecte encore les règles ?', // verifier_coherence_planning
        ]

      case 'conges':
        return [
          m.souhait && 'Quels souhaits de congé attendent une réponse ?', // lire_souhaits_en_attente
          'Qui est en congé la semaine prochaine ?', // lire_conges
          m.souhait &&
            // Le vrai demandeur et ses vraies dates : sans ça, Filou cherchait
            // un congé qui n'existait pas et la personne payait l'aller-retour.
            `Valide le congé de ${m.souhait.prenom} ${periodeLisible(
              m.souhait.dateDebut,
              m.souhait.dateFin,
            )}.`, // valider_conge
        ]

      case 'echanges':
        // Aucun échange en attente : Filou n'a rien à proposer qui ne soit un
        // coup d'épée dans l'eau. Sa question suffit.
        return [
          m.echange && 'Quels échanges attendent ma validation ?', // lire_echanges
          m.echange && `Valide l’échange entre ${m.echange.demandeur} et ${m.echange.cible}.`, // valider_echange_admin
        ]

      case 'depannages':
        return [
          m.aDesDettes && 'Où en sont les dettes de dépannage ?', // lire_compensations
          // `lire_creneaux_touches` EXIGE une absence active : sans absence
          // réelle, la question ne peut pas aboutir, quel que soit le prénom.
          m.absence && `Quels créneaux restent à couvrir après l’absence de ${m.absence.prenom} ?`, // lire_creneaux_touches
          m.absence && `Envoie un appel à volontaires pour les gardes de ${m.absence.prenom}.`, // appeler_volontaires
        ]

      case 'equipe':
        return [
          'Qui est en dernier recours ?', // lire_equipe
          'Qui ne participe plus au planning ?', // lire_equipe
          m.prenomVeto && `Mets l’étiquette junior à ${m.prenomVeto}.`, // modifier_veterinaire
        ]

      case 'regles':
        return [
          'Quelles règles sont en pause ?', // lister_regles
          // Une règle proposée sur quelqu'un qui n'existe pas serait refusée à
          // la résolution du prénom : on prend un vétérinaire réel de l'équipe.
          m.prenomVeto && `${m.prenomVeto} jamais de garde le mercredi.`, // creer_regle
          m.regleActive && `Mets en pause la règle « ${m.regleActive} ».`, // agir_sur_regles
        ]

      case 'reglages':
        return [
          m.profil && `Quels créneaux contient le profil « ${m.profil} » ?`, // lire_creneaux_profil
          m.creneau && `Change les horaires de ${m.creneau}.`, // regler_horaires_creneau
          'Comment est réglée l’équité ?', // lire_reglages_equite
        ]

      case 'historique':
        return [
          'Qui a fait Noël ces dernières années ?', // lire_historique_fetes
          m.aUnPlanning && 'Montre-moi les compteurs de la période en cours.', // lire_compteurs
          'Liste les périodes passées.', // lire_historique_periodes
        ]
    }
  })()

  return brut.filter((e): e is string => typeof e === 'string' && e.length > 0)
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
  return valeur && (ORIGINES as readonly string[]).includes(valeur)
    ? (valeur as OrigineFilou)
    : null
}
