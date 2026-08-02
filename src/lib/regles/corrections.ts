// ============================================================
// GUARDVETO — Ce que Filou propose quand une règle coince
// ============================================================
// Le pré-vol dit CE QUI cloche. Ce fichier dit QUOI FAIRE — en français, et
// sans rien inventer : chaque correction est déduite du code d'avertissement,
// pas devinée. C'est la part « porte-parole » de Filou : le moteur a trouvé,
// il traduit et propose.
//
// POURQUOI PAS L'IA ICI
//
// Un modèle qui « propose une correction » se trompe de la pire façon possible :
// avec aplomb, sur un cas que personne ne relira. Le projet a déjà payé ce prix
// (une suggestion inventée = un aller-retour ET un appel facturé). Les
// corrections ci-dessous sont finies, vérifiables, et gratuites. Le bouton
// « demander à Filou » du rebord reste là pour les cas qui sortent du cadre.
//
// TROIS REGISTRES, DANS CET ORDRE
//
//   1. `assouplir` — la règle est trop dure pour ce que l'effectif permet.
//      C'est la correction la plus fréquente, et la moins destructrice : la
//      règle reste, le moteur la respecte quand il peut.
//   2. `ailleurs`  — il manque quelque chose HORS de cette règle (une étiquette
//      sans porteur, un binôme sorti de l'effectif). On envoie au bon écran.
//   3. `renoncer`  — la règle ne peut pas tenir en l'état, et l'assouplir n'y
//      changerait rien (elle serait simplement ignorée).
// ============================================================

import type { AvertissementPreVol, CodeAvertissementPreVol } from '@/engine/pre-vol'

export interface CorrectionProposee {
  /** Ce que Filou propose de faire, à l'infinitif — c'est un bouton. */
  label: string
  /** Ce que ça change, en une phrase. */
  detail: string
  /** `assouplir` retombe sur un niveau de fermeté ; `ailleurs` navigue. */
  genre: 'assouplir' | 'ailleurs' | 'renoncer'
  /** Pour `assouplir` : le niveau visé. Pour `ailleurs` : la destination. */
  cible?: string
}

/** Le niveau proposé quand une règle ferme est intenable. « Sauf crise » est
 *  le premier cran qui laisse le moteur passer outre — et il le DIT dans le
 *  planning, ce qui garde la règle visible au lieu de la diluer. */
const CRAN_ASSOUPLI = 'sauf_crise'

const ASSOUPLIR: CorrectionProposee = {
  label: 'Passer la règle en « sauf urgence »',
  detail:
    'Le moteur la respectera partout où c’est possible, et ne s’autorisera à l’enfreindre que s’il ne trouve aucun planning sans elle — en le signalant.',
  genre: 'assouplir',
  cible: CRAN_ASSOUPLI,
}

const ALLER_EQUIPE: CorrectionProposee = {
  label: 'Ouvrir la page Équipe',
  detail: 'Pour poser l’étiquette sur les fiches concernées, ou réactiver une fiche.',
  genre: 'ailleurs',
  cible: '/equipe',
}

/**
 * Les corrections proposées pour un avertissement donné, de la plus utile à la
 * moins. Un code inconnu ne renvoie rien : mieux vaut une modale sans bouton
 * qu'un bouton qui ne corrige pas le bon problème.
 */
const PAR_CODE: Partial<Record<CodeAvertissementPreVol, CorrectionProposee[]>> = {
  // Un véto que ses règles écartent de TOUT : c'est presque toujours une règle
  // dure de trop. L'assouplir lui rend des créneaux.
  veto_jamais_disponible: [
    ASSOUPLIR,
    {
      label: 'Revoir ses autres règles',
      detail:
        'Ce sont ses règles CUMULÉES qui l’écartent de tout : celle-ci n’est peut-être que la goutte d’eau.',
      genre: 'ailleurs',
      cible: '/regles',
    },
  ],
  // Un créneau que personne ne peut plus pourvoir : le planning n'existera pas.
  // Assouplir est ici la seule issue qui garde la règle.
  creneau_impossible: [
    ASSOUPLIR,
    {
      label: 'Restreindre les types de garde visés',
      detail:
        'La règle ne s’appliquerait qu’aux gardes que tu choisis, au lieu de toutes — le créneau bloqué redeviendrait pourvoyable.',
      genre: 'renoncer',
    },
  ],
  // Plafonds de charge : la somme ne couvre pas les places à pourvoir.
  charge_globale_insuffisante: [
    {
      label: 'Relever le plafond',
      detail:
        'À eux tous, les plafonds actuels ne couvrent pas le nombre de gardes de la période : il en resterait forcément sans personne.',
      genre: 'renoncer',
    },
    ASSOUPLIR,
  ],
  weekends_insuffisants: [
    {
      label: 'Relever la limite de week-ends',
      detail:
        'Les limites cumulées laissent moins de week-ends disponibles que la période n’en compte.',
      genre: 'renoncer',
    },
    ASSOUPLIR,
  ],
  // Étiquettes : le manque est HORS de la règle.
  composition_sans_porteur: [ALLER_EQUIPE],
  cohorte_equite_sans_porteur: [ALLER_EQUIPE],
  role_interdit_intenable: [
    {
      label: 'Retirer l’étiquette à quelqu’un',
      detail:
        'Tous les vétérinaires actifs la portent : plus personne ne peut tenir ce rôle, et le créneau resterait vide.',
      genre: 'ailleurs',
      cible: '/equipe',
    },
    ASSOUPLIR,
  ],
  // Règles fantômes : elles visent quelqu'un qui n'est plus là.
  regle_veto_sorti: [ALLER_EQUIPE],
  duo_veto_sorti: [ALLER_EQUIPE],
  seulement_avec_partenaire_sorti: [ALLER_EQUIPE],
  // Paramétrage sans effet : ni assouplir ni naviguer n'y changeront rien.
  sequence_inerte: [
    {
      label: 'Revoir les valeurs saisies',
      detail:
        'Telle qu’elle est réglée, cette règle n’interdit rien : le moteur la lira sans jamais qu’elle change quoi que ce soit.',
      genre: 'renoncer',
    },
  ],
}

/** Les corrections à proposer pour un lot d'avertissements, dédoublonnées et
 *  dans l'ordre où elles ont été rencontrées. */
export function correctionsPour(
  avertissements: AvertissementPreVol[],
): CorrectionProposee[] {
  const vues = new Set<string>()
  const sortie: CorrectionProposee[] = []
  for (const a of avertissements) {
    for (const c of PAR_CODE[a.code] ?? []) {
      if (vues.has(c.label)) continue
      vues.add(c.label)
      sortie.push(c)
    }
  }
  return sortie
}

/**
 * La phrase d'ouverture de Filou. Elle dit combien, et sur quoi le contrôle a
 * porté — sans dramatiser : ces avertissements ne sont pas des refus, et
 * l'admin a le droit de passer outre en connaissance de cause.
 */
export function phraseGardien(nb: number, periode?: string): string {
  const ou = periode ? ` sur ${periode}` : ''
  if (nb === 1) {
    return `J’ai vérifié cette règle avec toutes les autres : il y a un point qui coince${ou}.`
  }
  return `J’ai vérifié cette règle avec toutes les autres : il y a ${nb} points qui coincent${ou}.`
}
