// ============================================================
// GUARDVETO — Retirer un planning : l'ORDRE des opérations
// ============================================================
// Deux gestes partagent exactement la même mécanique :
//
//   • SUPPRIMER un planning  — les lignes partent, définitivement ;
//   • DÉPUBLIER un planning  — les lignes restent, la diffusion s'arrête.
//
// Ce qu'ils ont en commun n'est pas un détail d'implémentation : c'est la
// règle qui a coûté une soirée de rattrapage à la main
// (`scripts/nettoyer-periode-agenda.mjs`, 2026-08-21). Les gardes portent
// leurs `google_event_id` ; effacer les lignes d'abord, c'est perdre les
// poignées qui permettent de retirer les événements. Le cabinet se retrouve
// alors avec trente rendez-vous fantômes dans l'agenda de toute l'équipe, et
// PLUS AUCUN moyen, depuis le logiciel, de savoir lesquels.
//
// D'où la séquence, dans cet ordre et pas un autre :
//
//   1. CAPTURER les identifiants d'événements, tant que les lignes existent
//   2. Vérifier que l'agenda est joignable — sinon on s'arrête AVANT tout
//   3. Retirer les événements
//   4. ⛔ Un seul échec ⇒ ON NE TOUCHE PAS LA BASE. On le dit, et on s'arrête.
//   5. Écrire en base (suppression, ou retour en brouillon)
//   6. Tracer
//
// POURQUOI CE FICHIER NE CONNAÎT NI SUPABASE NI GOOGLE — l'étape 4 est la
// seule qui compte vraiment, et c'est la plus difficile à vérifier : il faut
// provoquer une panne Google pour la voir. En prenant ses étapes en
// paramètres, la séquence se teste avec des fonctions de papier, et le test
// prouve littéralement que l'écriture en base n'a JAMAIS été appelée
// (`tests/lib/retrait-planning.test.ts`).
// ============================================================

/**
 * TOUT ce que la première fenêtre de confirmation affiche — et rien qui ne
 * vienne d'une lecture réelle en base.
 *
 * Une phrase générique (« cette action est irréversible ») ne renseigne
 * personne : c'est le nombre de gardes, la période en toutes lettres et la
 * présence de rendez-vous dans l'agenda qui font qu'on renonce, ou pas.
 *
 * ⚠️ Aucune date au format de stockage ici : les champs sont DÉJÀ en français
 * (`lib/dates-fr`). L'écran n'a rien à reformater, donc rien à oublier.
 */
export interface BilanPlanningARetirer {
  id: string
  /** Le nom du planning, tel qu'il s'affiche — et tel qu'il faudra le recopier. */
  nom: string
  /** « du 21 septembre 2026 au 14 décembre 2026 ». */
  quand: string
  statut: string
  /** A-t-il été diffusé à l'équipe au moins une fois ? */
  publie: boolean
  /** « diffusé le 12 août 2026 », ou null s'il ne l'a jamais été. */
  publieLe: string | null
  nbGardes: number
  /** Gardes portant un rendez-vous dans l'agenda Google du cabinet. */
  nbEvenementsAgenda: number
  /** Vétérinaires qui ont au moins une garde dessus. */
  nbVetosConcernes: number
  /** Échanges de gardes rattachés — ils partiront avec. */
  nbEchanges: number
  /** Dépannages (compensations) rattachés. */
  nbDepannages: number
  /** Exceptions posées à la journée sur une garde. */
  nbExceptions: number
  /** L'agenda est-il configuré et joignable ? */
  agendaJoignable: boolean
  /**
   * Ce qui EMPÊCHE le geste, en français (une règle limitée à ce planning, par
   * exemple). Non nul = le bouton final ne doit pas être proposé.
   */
  bloquant: string | null
  /**
   * La deuxième confirmation doit-elle exiger de RECOPIER le nom ?
   *
   * Oui dès que le planning a été diffusé, ou qu'il a posé des rendez-vous dans
   * l'agenda de l'équipe — les deux cas où quelqu'un d'autre que l'admin a vu
   * passer quelque chose. Un brouillon d'essai resté dans le logiciel garde,
   * lui, le geste léger d'avant : deux clics, sans dactylographie.
   */
  exigeSaisieDuNom: boolean
}

/** Un événement d'agenda qu'on n'a pas réussi à retirer. */
export interface EchecAgenda {
  eventId: string
  /** Code HTTP renvoyé par Google, quand il y en a un. */
  code?: number | string
  message: string
}

/** Ce que le passage dans l'agenda a réellement produit. */
export interface BilanAgenda {
  /** Événements effectivement retirés. */
  effaces: number
  /**
   * Événements que Google ne connaissait déjà plus (404 / 410). Ce n'est PAS
   * un échec : l'état visé — « plus rien dans l'agenda » — est atteint.
   */
  dejaAbsents: number
  echecs: EchecAgenda[]
}

export const BILAN_AGENDA_VIDE: BilanAgenda = { effaces: 0, dejaAbsents: 0, echecs: [] }

/**
 * Les six étapes, fournies par l'appelant. Chacune fait UNE chose, et aucune
 * ne décide de l'ordre : c'est tout l'intérêt.
 */
export interface EtapesRetrait {
  /** ① Les identifiants d'événements portés par les gardes du planning. */
  lireEventIds: () => Promise<string[]>
  /**
   * ② L'agenda est-il joignable ? Faux = identifiants Google absents, ou aucun
   * agenda configuré pour le cabinet. On ne peut alors rien retirer.
   */
  agendaJoignable: () => Promise<boolean>
  /** ③ Le passage dans l'agenda, avec un bilan HONNÊTE des échecs. */
  retirerDeLAgenda: (eventIds: string[]) => Promise<BilanAgenda>
  /** ⑤ L'écriture en base — suppression des lignes, ou retour en brouillon. */
  ecrireEnBase: () => Promise<{ error?: string | null }>
  /** ⑥ La trace. Best-effort : son échec ne remet pas le geste en cause. */
  tracer: (agenda: BilanAgenda) => Promise<void>
}

export type ResultatRetrait =
  | { ok: true; agenda: BilanAgenda }
  | { ok: false; error: string; agenda?: BilanAgenda }

/**
 * Le refus quand l'agenda est injoignable alors qu'il porte des événements.
 *
 * Écrit pour une vétérinaire, pas pour un journal technique : elle doit
 * comprendre que le logiciel s'arrête POUR la protéger, et non qu'il est en
 * panne.
 */
function refusAgendaInjoignable(nb: number): string {
  return (
    `Ce planning a posé ${nb} rendez-vous dans l’agenda Google du cabinet, et `
    + `cet agenda n’est pas joignable en ce moment. Si on continuait, les `
    + `rendez-vous resteraient dans l’agenda de toute l’équipe sans plus aucun `
    + `moyen de les retrouver. Rien n’a été touché — réessaie plus tard, ou fais `
    + `vérifier la connexion à l’agenda dans les réglages.`
  )
}

/** Le refus quand une partie des rendez-vous a résisté. */
function refusAgendaIncomplet(bilan: BilanAgenda): string {
  const n = bilan.echecs.length
  return (
    `${n} rendez-vous ${n > 1 ? 'n’ont' : 'n’a'} pas pu être retiré${n > 1 ? 's' : ''} `
    + `de l’agenda Google. Le planning n’a PAS été touché : il est plus sûr de le `
    + `garder tel quel que de laisser ${n > 1 ? 'ces rendez-vous orphelins' : 'ce rendez-vous orphelin'} `
    + `dans l’agenda de l’équipe. Réessaie dans quelques minutes ; si ça se répète, `
    + `signale-le.`
  )
}

/**
 * Exécute la séquence. Renvoie un refus explicite plutôt que de lever :
 * l'appelant est une action serveur, et l'écran affiche le message tel quel.
 */
export async function executerRetraitPlanning(
  etapes: EtapesRetrait,
): Promise<ResultatRetrait> {
  // ① Les poignées, tant qu'elles existent.
  const eventIds = await etapes.lireEventIds()

  let agenda: BilanAgenda = { ...BILAN_AGENDA_VIDE }

  if (eventIds.length > 0) {
    // ② Un agenda muet n'est pas un agenda vide. Continuer reviendrait à
    //    parier que ces événements n'existent pas — le pari qui a produit
    //    l'incident.
    if (!(await etapes.agendaJoignable())) {
      return { ok: false, error: refusAgendaInjoignable(eventIds.length) }
    }

    // ③
    agenda = await etapes.retirerDeLAgenda(eventIds)

    // ④ LA LIGNE ROUGE.
    if (agenda.echecs.length > 0) {
      return { ok: false, error: refusAgendaIncomplet(agenda), agenda }
    }
  }

  // ⑤ L'agenda est propre : maintenant, et seulement maintenant.
  const ecriture = await etapes.ecrireEnBase()
  if (ecriture.error) {
    return { ok: false, error: ecriture.error, agenda }
  }

  // ⑥ La trace ne conditionne rien — mais son absence ne doit pas passer
  //    inaperçue côté serveur.
  try {
    await etapes.tracer(agenda)
  } catch (e) {
    console.error('[retrait-planning] trace non écrite :', e)
  }

  return { ok: true, agenda }
}
