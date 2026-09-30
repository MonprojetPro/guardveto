// ============================================================
// GUARDVETO — Combien de monde il y avait, semaine par semaine (B-138)
// ============================================================
// POURQUOI CE FICHIER EXISTE — MiKL, le 30/09, rapportant une pratique du
// cabinet :
//
//   « Quand tous les vétos (ou suffisamment) étaient présents sur une semaine,
//    elle faisait en sorte que ceux qui font le week-end ne font pas de garde
//    la semaine. »
//
// Le critère de relecture `decharge_avant_weekend` repose entièrement sur un
// jugement : « il y avait assez de monde cette semaine-là ». Or ce nombre
// n'existait nulle part dans le dossier de Filou. On lui donnait les congés de
// chacun, séparément, et il devait croiser sept listes de tête pour en déduire
// un effectif — exactement le genre de calcul où il se trompe d'un ou deux.
//
// ── LE PRINCIPE, DÉJÀ PAYÉ DEUX FOIS ────────────────────────────────────────
//
// Ce qui déclenche un constat se CALCULE, jamais ne se déduit. C'est la leçon
// de B-098 (`monterDossierRelecture.ts`, l. 319) : Filou annonçait « ça allège
// le lundi de Victor » alors que Victor restait de garde. Il ne mentait pas —
// personne ne le lui avait dit, et il déduisait mal. On calcule donc ici, ce
// qui est trivial et TESTABLE, plutôt que de lui demander un raisonnement où
// il échoue en silence.
//
// ── DEUX CHOIX QUI SE VOIENT DANS LE RÉSULTAT ───────────────────────────────
//
// ① LE DERNIER RECOURS NE COMPTE PAS DANS L'EFFECTIF.
//    Anne-Catherine est disponible sur le papier, mais le moteur ne la
//    programme jamais spontanément. La compter ferait lire « 7 vétos
//    disponibles » là où 6 seulement peuvent réellement prendre la nuit — et
//    Filou conclurait « il y avait du monde » sur un effectif fictif. Le
//    libellé le dit en clair, sinon le chiffre paraîtrait faux.
//
// ② ON COMPTE LES SOIRS LUNDI → JEUDI, PAS LA SEMAINE ENTIÈRE.
//    C'est le seul créneau que le critère peut proposer de déplacer. Le
//    vendredi soir est attribué au binôme du week-end par la structure du
//    cabinet (`relation_creneau` : `meme_binome` + `inversion_role`, vérifié en
//    base le 30/09) : le compter reviendrait à mesurer une disponibilité sur un
//    soir dont personne ne peut être déchargé.
//
// ── CE QUE CE COMPTE NE VOIT PAS, ET POURQUOI ON LE DIT ─────────────────────
//
// ⚠️ IL NE CONNAÎT QUE LES CONGÉS VALIDÉS. Une indisponibilité qui vient d'une
// RÈGLE personnelle — un repos fixe le lundi, un créneau interdit — n'y est pas.
// Quelqu'un qui ne prend jamais le lundi soir est donc compté « disponible » ce
// lundi-là, et l'effectif est SURESTIMÉ.
//
// On ne le corrige pas ici, et c'est délibéré : décoder les paramètres des
// règles reviendrait à recopier le moteur dans ce fichier, où les deux
// divergeraient au premier réglage ajouté — c'est la doctrine de
// `criteres-humains.ts`, et le défaut B-023 qu'elle a déjà coûté.
//
// Deux choses rendent ce manque tenable, et aucune n'est le silence :
//   • le texte servi à Filou LE DIT — « 6 sur 6 » sans réserve se lirait comme
//     une vérité complète, et personne ne va vérifier une bonne nouvelle ;
//   • le garde-fou est EN AVAL : la consigne exige qu'un prénom figure dans la
//     liste « peuvent aussi » avant tout signalement, et cette liste est
//     calculée par le moteur — qui, lui, connaît les règles. Un effectif
//     surestimé ne suffit donc pas à produire un signalement.
//
// ⚠️ Les congés en ATTENTE sont volontairement hors du compte (`loader.ts`
// filtre `statut = 'valide'`). L'effectif doit décrire le monde dans lequel ce
// planning a été généré, pas celui d'aujourd'hui — sinon on jugerait un
// planning avec des données qu'il n'avait pas, exactement le défaut de B-130.
// ============================================================

import { lundiDeSemaine, addDays, dateEntre } from '@/engine/utils'
import { dateFr } from '@/lib/dates-fr'

/** Une personne, réduite à ce que ce calcul consomme. */
export interface PersonnePourEffectif {
  id: string
  prenom: string
  dernier_recours?: boolean
  conges?: Array<{ date_debut: string; date_fin: string; type?: string }>
}

/** L'effectif d'une semaine, tel que Filou le lira. */
export interface EffectifSemaine {
  /** Lundi de la semaine, en ISO — la clé stable. */
  lundi: string
  /** Combien peuvent tenir les quatre soirs, sans aucune absence. */
  disponibles: number
  /**
   * L'effectif de référence : l'équipe hors dernier recours.
   *
   * Servi À CÔTÉ de `disponibles` et jamais déduit d'un total attendu : « 4 »
   * ne veut rien dire, « 4 sur 6 » se juge.
   */
  effectif: number
  /** Qui est absent au moins un des quatre soirs, avec l'ampleur. */
  absents: Array<{ prenom: string; partiel: boolean }>
}

/** Les quatre soirs que le critère peut déplacer : lundi → jeudi. */
const SOIRS = [0, 1, 2, 3] as const

/**
 * L'effectif de chaque semaine de la période.
 *
 * Une semaine n'est rendue que si l'un de ses soirs lundi-jeudi tombe DANS la
 * période. Sans ce filtre, une période qui démarre un samedi produirait une
 * ligne pour une semaine dont le cabinet n'a aucune garde — Filou y lirait un
 * effectif sans planning en face, et chercherait un défaut dans le vide.
 */
export function effectifParSemaine(
  dateDebut: string,
  dateFin: string,
  vets: PersonnePourEffectif[],
): EffectifSemaine[] {
  if (!dateDebut || !dateFin || dateFin < dateDebut) return []

  const comptables = vets.filter((v) => !v.dernier_recours)
  const semaines: EffectifSemaine[] = []

  for (
    let lundi = lundiDeSemaine(dateDebut);
    lundi <= dateFin;
    lundi = addDays(lundi, 7)
  ) {
    const soirs = SOIRS
      .map((n) => addDays(lundi, n))
      .filter((d) => dateEntre(d, dateDebut, dateFin))
    if (soirs.length === 0) continue

    const absents: Array<{ prenom: string; partiel: boolean }> = []
    let disponibles = 0

    for (const v of comptables) {
      const conges = v.conges ?? []
      const manques = soirs.filter((d) =>
        conges.some((c) => dateEntre(d, c.date_debut, c.date_fin)),
      ).length

      if (manques === 0) {
        disponibles += 1
      } else {
        // « en partie » n'est pas un ornement : quelqu'un absent un seul soir
        // sur quatre reste mobilisable sur les trois autres, et le taire le
        // rendrait indisponible aux yeux de Filou.
        absents.push({ prenom: v.prenom, partiel: manques < soirs.length })
      }
    }

    semaines.push({ lundi, disponibles, effectif: comptables.length, absents })
  }

  return semaines
}

/**
 * Les lignes telles qu'elles partent dans le dossier de relecture.
 *
 * Mis en français ici et pas dans le prompt : c'est la même raison que
 * `criteres-humains.ts` — ce texte se relit et s'amende, et il doit rester
 * lisible par quelqu'un qui n'ouvre jamais le fichier de l'agent.
 */
export function effectifEnTexte(semaines: EffectifSemaine[]): string[] {
  return semaines.map((s) => {
    const absents = s.absents
      .map((a) => (a.partiel ? `${a.prenom} (en partie)` : a.prenom))
      .join(', ')
    const queue = absents ? ` — absents : ${absents}` : ' — personne d’absent'
    // Le jour de la semaine est NOMMÉ (« du lundi 5 janvier ») : sans lui,
    // Filou doit supposer où commence une semaine, et le critère repose
    // entièrement sur le fait qu'un week-end appartient à la semaine dont il
    // est la fin — confirmé par MiKL le 30/09.
    return `Semaine du ${dateFr(s.lundi)} : ${s.disponibles} sur ${s.effectif} disponibles les quatre soirs${queue}`
  })
}
