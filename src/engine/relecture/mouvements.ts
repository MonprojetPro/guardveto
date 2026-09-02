// ============================================================
// GUARDVETO — LES MOUVEMENTS QUE LE MOTEUR ACCEPTE (B-096)
// ============================================================
// MiKL, le 2026-09-02, devant la relecture réelle de Hiver P2 : huit constats,
// huit fois « il ne voit pas de correction automatique ». Filou nomme la cause
// lui-même :
//
//     « Aucun échange de rôle week-end n'est proposé par le moteur dans la
//       liste fournie, donc je ne peux pas corriger ce point moi-même sans
//       casser l'inversion vendredi/week-end. »
//
// ── CE QUI SE PASSAIT, ET C'EST PLUS LARGE QUE CE QU'IL DÉCRIT ──────────────
//
// Le week-end est lié à son vendredi par deux relations DURES : `meme_binome`
// (les mêmes deux personnes tiennent les deux créneaux) et `inversion_role`
// (le 1er du vendredi est le 2nd du week-end). `echangesPossibles` ne déplace
// que DEUX places. Toucher une place de week-end sans toucher le vendredi
// apparié casse le binôme, et `isValid` refuse.
//
// Conséquence : ce n'étaient pas seulement les échanges de RÔLE qui manquaient.
// AUCUNE place de week-end ni de vendredi n'était atteignable, pour personne.
// Or les deux déséquilibres que MiKL a vus vivent précisément là — l'avantage
// financier du 1er de week-end, et Antoine à 5 week-ends contre 3 à Fanny.
// On demandait à Filou de corriger ce qu'on l'empêchait de toucher.
//
// ── CE QUE CE MODULE AJOUTE ─────────────────────────────────────────────────
//
// La notion de GRAPPE : un créneau et tous ceux que les relations lui attachent
// (ici week-end + son vendredi). Un mouvement porte sur des grappes entières,
// jamais sur une place isolée — c'est ce qui préserve le binôme par
// construction plutôt que par vérification après coup.
//
// Deux familles, qui répondent chacune à un constat de Filou :
//   • `inversion_roles_weekend` — le binôme reste, les rôles tournent.
//     Répond à « le rôle qui rapporte doit tourner ».
//   • `echange_weekend` — deux personnes échangent leurs week-ends.
//     Répond à « personne ne porte plus que sa part ».
//
// ── CE QUI N'EST PAS FAIT, ET SE DIT ────────────────────────────────────────
//
// Un échange entre une place de WEEK-END et une place de SEMAINE n'est pas
// généré. Il faudrait que la personne sortante reprenne DEUX créneaux (le
// vendredi et le samedi) contre un seul, ce qui n'est plus un échange mais une
// redistribution. Limite assumée : le besoin mesuré porte sur les week-ends
// entre eux, et un mouvement mal formé serait refusé silencieusement par
// `isValid` — on aurait rallongé la liste sans rien débloquer.
//
// Une grappe dont un créneau porte plus de deux places pourvues n'est pas
// inversée non plus : « inverser » n'a de sens univoque qu'à deux. Les échanges
// de personnes, eux, fonctionnent quel que soit le nombre de places.
//
// ── LE CONTRAT, LE MÊME QUE CELUI DES ÉCHANGES ──────────────────────────────
//
// Ce qui sort d'ici est ce que `isValid` accepte, jamais une estimation. Chaque
// mouvement est appliqué sur une copie, place par place, dans l'ordre où le
// solver les poserait — le contrôle est CUMULATIF : la 4ᵉ pose est jugée sur le
// planning où les trois premières sont déjà faites.
// ============================================================

import type {
  AttributionGarde, CalendrierResolu, PlanningPartiel, VetEngine,
} from '../types'
import type { RelationStructure } from '../structure-config'
import { relationsEffectives, DEFAULT_STRUCTURE_CONFIG } from '../structure-config'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { isValid } from '../rules/hard-constraints'
import { genererSteps } from '../solver'
import { apparierSourcePourCible } from '../relations-structure'
import { addDays } from '../utils'
import {
  echangesPossibles, clePlace, poser,
  type OptionsEchanges, type PlaceOccupee,
} from './echanges'

/** Une place et QUI doit s'y trouver après le mouvement. */
export interface AffectationMouvement {
  date: string
  type: string
  role: string
  vetId: string
}

export type GenreMouvement =
  /** Deux places quelconques dont les occupants permutent (l'existant). */
  | 'echange_simple'
  /** Les rôles tournent au sein d'un week-end — le binôme ne change pas. */
  | 'inversion_roles_weekend'
  /** Deux personnes échangent leurs week-ends, vendredis compris. */
  | 'echange_weekend'
  /**
   * Quelqu'un REMPLACE une autre personne sur un week-end, sans contrepartie.
   *
   * ⚠️ LE SEUL MOUVEMENT QUI CHANGE LE NOMBRE DE WEEK-ENDS DE QUELQU'UN.
   *
   * Défaut de conception de la première livraison de B-096, trouvé par MiKL le
   * 2026-09-02 : *« on a encore Antoine et ses week-ends d'affilée »*. Les deux
   * autres genres sont des permutations — l'échange fait sortir Antoine d'un
   * week-end pour le faire entrer dans un autre, l'inversion garde le binôme.
   * Dans les deux cas son TOTAL est inchangé. Il était donc arithmétiquement
   * impossible de le faire passer de 5 week-ends à 4, et Filou n'avait toujours
   * pas le levier qu'on croyait lui avoir donné.
   *
   * Les remplacements simples (`remplacants.ts`) ne comblaient pas ce trou : ils
   * jugent place par place, donc toucher un week-end sans son vendredi casse le
   * binôme et se fait refuser. Exactement le défaut des échanges à deux places.
   */
  | 'remplacement_weekend'
  /**
   * Un remplacement de week-end rendu possible en LIBÉRANT D'ABORD l'obstacle.
   *
   * MESURÉ sur le vrai planning Hiver P2 le 2026-09-02 : `remplacement_weekend`
   * ne sortait JAMAIS pour alléger Antoine, sur aucun de ses cinq week-ends.
   * Ce n'était ni un bug ni un manque de candidats — c'est structurel.
   *
   * Un week-end est ENCADRÉ. Le vendredi qui le précède le suit (même binôme),
   * et l'espacement minimum de deux jours interdit d'être de garde le jeudi ET
   * le vendredi : tout candidat de garde le jeudi précédent est éliminé. De
   * l'autre côté, depuis que B-092 compte enfin les nuits du week-end, le lundi
   * suivant élimine les autres. Sur six vétérinaires, il ne reste personne.
   *
   * Un mouvement de quatre places ne pouvait donc pas suffire : il en faut un
   * de six. On déplace d'abord la garde qui bloque le remplaçant, puis on fait
   * le remplacement — le tout d'un seul bloc, validé comme un tout.
   */
  | 'remplacement_weekend_en_chaine'

/** Un mouvement applicable : toutes ses affectations, ensemble ou rien. */
export interface MouvementPossible {
  genre: GenreMouvement
  affectations: AffectationMouvement[]
}

/**
 * Combien de mouvements le dossier peut porter sans noyer le signal.
 *
 * MESURÉ le 2026-09-02 sur une période d'hiver complète (12 semaines, 6
 * vétérinaires) : **3012 mouvements**, dont 2736 échanges simples. Ceux-là
 * existaient depuis B-093 — le dossier envoyé à Filou le matin même en portait
 * donc des milliers, et il devait y choisir. Ça n'était pas une aide, c'était
 * un mur, et ça éclaire ses choix médiocres de ce jour-là.
 *
 * Le coût est double : le temps (chaque mouvement est scoré sur le planning
 * entier) et l'illisibilité. Le second est le pire — le premier fait attendre,
 * le second fait choisir n'importe quoi.
 */
export const PLAFOND_MOUVEMENTS = 400

/**
 * L'ordre dans lequel on garde les mouvements quand il faut couper.
 *
 * Les genres RARES d'abord, et ce n'est pas une préférence esthétique : ce sont
 * les seuls qui font quelque chose qu'aucun autre ne sait faire. Un
 * `remplacement_weekend` est le SEUL mouvement qui allège réellement quelqu'un
 * d'un week-end ; une `inversion_roles_weekend` la seule qui fasse tourner le
 * rôle qui rapporte. Il y en a une centaine face à des milliers d'échanges
 * simples : les laisser se faire noyer reviendrait à ne pas les avoir livrés.
 */
const PRIORITE: Record<GenreMouvement, number> = {
  // Mesuré le 02/09 sur le vrai planning : le remplacement DIRECT ne sort
  // jamais (le week-end est encadré par le jeudi et le lundi). La chaîne est
  // donc, en pratique, le seul mouvement qui allège vraiment quelqu'un — la
  // laisser se faire couper reviendrait à ne pas l'avoir écrite.
  remplacement_weekend_en_chaine: 0,
  remplacement_weekend: 1,
  inversion_roles_weekend: 2,
  echange_weekend: 3,
  echange_simple: 4,
}

/**
 * La liste bornée, et le nombre de mouvements écartés.
 *
 * ⚠️ `ecartes` n'est pas une statistique : il DOIT être dit à Filou. Une liste
 * tronquée en silence se lit « voilà tout ce qui est possible », et il
 * conclurait qu'il n'y a rien d'autre à faire. C'est la règle du projet sur les
 * plafonds : borner, oui ; borner sans le dire, jamais.
 */
export function prioriserMouvements(
  mouvements: readonly MouvementPossible[],
  plafond: number = PLAFOND_MOUVEMENTS,
): { retenus: MouvementPossible[]; ecartes: number } {
  if (mouvements.length <= plafond) return { retenus: [...mouvements], ecartes: 0 }

  // Tri stable sur la seule priorité de genre : à genre égal, l'ordre de
  // génération est conservé, donc deux relectures du même planning rendent la
  // même liste. Sans ça, on ne saurait jamais si un changement de comportement
  // vient du produit ou de l'ordre du jour.
  const tries = mouvements
    .map((m, i) => ({ m, i }))
    .sort((a, b) => PRIORITE[a.m.genre] - PRIORITE[b.m.genre] || a.i - b.i)
    .map((x) => x.m)

  return { retenus: tries.slice(0, plafond), ecartes: mouvements.length - plafond }
}

/**
 * Une GRAPPE : les attributions qu'une relation dure oblige à bouger ensemble.
 *
 * Pour le couple historique, c'est [vendredi_soir, weekend]. Rien n'est câblé :
 * les couples viennent des relations résolues, donc un cabinet qui n'a aucune
 * relation aura des grappes d'un seul créneau, et un cabinet qui en a d'autres
 * les verra traitées de la même façon.
 */
interface Grappe {
  /** L'occurrence « pivot » (la cible de la relation — le week-end). */
  pivot: AttributionGarde
  /** Toutes les attributions du groupe, pivot compris. */
  attributions: AttributionGarde[]
}

/**
 * Les grappes du planning, une par occurrence de créneau CIBLE d'une relation
 * `meme_binome`.
 *
 * L'appariement passe par `apparierSourcePourCible`, la fonction que le moteur
 * utilise lui-même pour juger la relation. En recalculer un ici (« le vendredi,
 * c'est la veille ») marcherait aujourd'hui et mentirait au premier cabinet qui
 * apparie autrement — c'est la formule magique que la tranche 2 avait
 * justement retirée.
 */
function grappesDuPlanning(
  planning: PlanningPartiel,
  relations: readonly RelationStructure[],
): Grappe[] {
  const liens = relations.filter((r) => r.genre === 'meme_binome')
  const out: Grappe[] = []

  for (const attr of planning.attributions) {
    const pertinentes = liens.filter((r) => r.cibleCode === attr.type)
    if (pertinentes.length === 0) continue

    const attributions: AttributionGarde[] = [attr]
    for (const rel of pertinentes) {
      const source = apparierSourcePourCible(planning, rel, attr.date)
      // Pas de source appariée → la grappe se réduit au pivot. C'est le cas
      // légitime du tout premier week-end d'une période, dont le vendredi
      // appartient à la période précédente : on ne le bouge pas.
      if (source && !attributions.includes(source)) attributions.push(source)
    }
    out.push({ pivot: attr, attributions })
  }

  return out
}

/** Les personnes présentes dans une grappe (une seule fois chacune). */
function gensDeLaGrappe(g: Grappe): string[] {
  const ids = new Set<string>()
  for (const attr of g.attributions) {
    for (const p of attr.placements) if (p.vetId) ids.add(p.vetId)
  }
  return [...ids]
}

/**
 * Toutes les affectations de la grappe, avec `remplacer` appliqué à chaque
 * occupant. Une identité (`x => x`) rendrait la grappe inchangée.
 */
function affectationsDeLaGrappe(
  g: Grappe,
  remplacer: (vetId: string) => string,
): AffectationMouvement[] {
  const out: AffectationMouvement[] = []
  for (const attr of g.attributions) {
    for (const p of attr.placements) {
      if (!p.vetId) continue
      out.push({ date: attr.date, type: attr.type, role: p.role, vetId: remplacer(p.vetId) })
    }
  }
  return out
}

/**
 * Les gardes de `vetId` qui l'empêchent de prendre cette grappe.
 *
 * Ce sont celles qui tombent JUSTE avant ou JUSTE après — le jeudi qui précède
 * le vendredi apparié, le lundi qui suit le dimanche. L'espacement minimum du
 * cabinet (2 jours dans le cas mesuré) les rend incompatibles avec la grappe.
 *
 * On ne cherche PAS à deviner quelle règle bloque : on propose de déplacer ces
 * gardes-là, et `isValid` tranche ensuite. Un module qui ré-implémenterait le
 * raisonnement de l'espacement divergerait de lui au premier réglage changé.
 *
 * La fenêtre est volontairement étroite (2 jours de part et d'autre). L'élargir
 * ferait exploser la combinatoire pour proposer des remaniements que personne
 * ne relierait au problème d'origine.
 */
const JOURS_AUTOUR_DE_LA_GRAPPE = 2

function gardesQuiBloquent(
  planning: PlanningPartiel,
  vetId: string,
  g: Grappe,
): Array<{ date: string; type: string; role: string }> {
  const jours = g.attributions.map((a) => a.date).sort()
  const premier = jours[0]
  const dernier = jours[jours.length - 1]
  const debut = addDays(premier, -JOURS_AUTOUR_DE_LA_GRAPPE)
  // +1 : le week-end couvre aussi le dimanche, qui n'est pas une date d'ancrage.
  const fin = addDays(dernier, JOURS_AUTOUR_DE_LA_GRAPPE + 1)

  const dansLaGrappe = new Set(g.attributions.map((a) => `${a.date}|${a.type}`))
  const out: Array<{ date: string; type: string; role: string }> = []

  for (const attr of planning.attributions) {
    if (dansLaGrappe.has(`${attr.date}|${attr.type}`)) continue
    if (attr.date < debut || attr.date > fin) continue
    for (const p of attr.placements) {
      if (p.vetId === vetId) out.push({ date: attr.date, type: attr.type, role: p.role })
    }
  }
  return out
}

/** Le planning où toutes les places listées sont VIDÉES. */
function viderPlaces(
  planning: PlanningPartiel,
  places: readonly { date: string; type: string; role: string }[],
): PlanningPartiel {
  const aVider = new Set(places.map((p) => clePlace(p.date, p.type, p.role)))
  return {
    attributions: planning.attributions.map((attr) => {
      if (!attr.placements.some((p) => aVider.has(clePlace(attr.date, attr.type, p.role)))) {
        return attr
      }
      return {
        ...attr,
        placements: attr.placements.map((p) =>
          aVider.has(clePlace(attr.date, attr.type, p.role)) ? { ...p, vetId: null } : p,
        ),
      }
    }),
  }
}

/** Ce qu'il faut pour juger un mouvement, regroupé une fois pour toutes. */
interface ContexteMouvements {
  vets: ReturnType<typeof normaliserContraintesVets>
  parStep: Map<string, ReturnType<typeof genererSteps>[number]>
  options: OptionsEchanges
}

/**
 * Le mouvement est-il accepté par le moteur, dans son ensemble ?
 *
 * ── POURQUOI PAS LE CONTRÔLE CUMULATIF DE `echanges.ts` ─────────────────────
 *
 * Un échange à deux places se juge en vidant les deux puis en reposant l'une
 * après l'autre. Appliqué à une grappe, ce procédé refuse TOUT, et j'ai mis un
 * moment à le voir : R9 exige que le vendredi et le week-end portent les mêmes
 * personnes. Vider les quatre places puis reposer la première fait juger cette
 * pose contre un week-end VIDE — « ce véto n'est pas dans le duo du week-end »,
 * refus. Tous les états intermédiaires d'une grappe sont invalides, parce que
 * la cohérence qu'on vérifie est justement MUTUELLE. Aucun ordre de pose ne
 * sauve ça ; il n'y avait rien à réordonner.
 *
 * ── CE QU'ON FAIT À LA PLACE, ET POURQUOI C'EST PLUS STRICT ─────────────────
 *
 * On construit le planning tel qu'il sera APRÈS le mouvement, puis on juge
 * chaque place dedans, cette place-là seule vidée. On ne demande donc plus
 * « peut-on en arriver là pas à pas ? » mais « l'état d'arrivée est-il légal ? »
 * — la seule question qui compte, puisque le mouvement s'applique d'un bloc.
 *
 * C'est plus fort que le cumulatif : chaque pose est jugée en voyant TOUTES les
 * autres, y compris celles qui viendraient « après » elle.
 *
 * R18 et R19 (« le 1er doit être désigné avant le 2nd ») ne gênent pas ici,
 * vérifié en lisant leur code : elles ne refusent que de poser un SECOND sur un
 * créneau dont le premier est absent. Le premier est toujours là — on n'a vidé
 * qu'une place, et jamais la sienne quand on juge le second.
 */
function mouvementLegal(
  ctx: ContexteMouvements,
  planning: PlanningPartiel,
  affectations: readonly AffectationMouvement[],
): boolean {
  let final = planning
  for (const aff of affectations) final = poser(final, aff, aff.vetId)

  for (const aff of affectations) {
    const step = ctx.parStep.get(clePlace(aff.date, aff.type, aff.role))
    const vet = ctx.vets.find((v) => v.id === aff.vetId)
    // Un step introuvable veut dire que la place n'existe pas dans la structure
    // de cette période : on refuse plutôt que d'inventer un slot.
    if (!step || !vet) return false

    const verdict = isValid(
      step, vet, aff.role, ctx.vets, viderPlaces(final, [aff]),
      ctx.options.calendrier, ctx.options.structureConfig, ctx.options.contexteAnterieur,
    )
    if (!verdict.valid) return false
  }

  return true
}

/** Le mouvement concerne-t-il au moins une personne ciblée ? */
function concerneUneCible(
  affectations: readonly AffectationMouvement[],
  avant: Map<string, string | null>,
  cibles: Set<string> | null,
): boolean {
  if (!cibles) return true
  return affectations.some((a) => {
    if (cibles.has(a.vetId)) return true // on lui donne une place
    const occupant = avant.get(clePlace(a.date, a.type, a.role))
    return occupant !== null && occupant !== undefined && cibles.has(occupant) // on lui en retire une
  })
}

/** Un échange à deux places, exprimé comme un mouvement. */
function depuisEchange(a: PlaceOccupee, b: PlaceOccupee): MouvementPossible {
  return {
    genre: 'echange_simple',
    affectations: [
      { date: a.date, type: a.type, role: a.role, vetId: b.vetId },
      { date: b.date, type: b.type, role: b.role, vetId: a.vetId },
    ],
  }
}

/**
 * Tous les mouvements que le moteur accepte : les échanges à deux places
 * (inchangés, via `echangesPossibles`) ET les mouvements de grappe.
 *
 * ENGLOBE `echangesPossibles`, ne la remplace pas : perdre les échanges de
 * semaine en gagnant ceux de week-end serait un troc, pas un progrès.
 */
export function mouvementsPossibles(
  planning: PlanningPartiel,
  options: OptionsEchanges,
): MouvementPossible[] {
  const vets = normaliserContraintesVets(options.vets)
  const steps = genererSteps(
    options.dateDebut, options.dateFin, options.saison,
    options.nbVetosSemaineSoir, options.creneaux,
  )
  const parStep = new Map(steps.map((s) => [clePlace(s.date, s.type, s.role), s]))
  const ctx: ContexteMouvements = { vets, parStep, options }

  const avant = new Map<string, string | null>()
  for (const attr of planning.attributions) {
    for (const p of attr.placements) avant.set(clePlace(attr.date, attr.type, p.role), p.vetId)
  }
  const cibles = options.vetsCibles ? new Set(options.vetsCibles) : null

  // ── ① Les échanges à deux places, tels quels ──
  const out: MouvementPossible[] = echangesPossibles(planning, options)
    .map((e) => depuisEchange(e.a, e.b))

  // ── ② Les mouvements de grappe ──
  const relations = relationsEffectives(options.structureConfig ?? DEFAULT_STRUCTURE_CONFIG)
  const grappes = grappesDuPlanning(planning, relations)

  /**
   * `completes` décrit l'état d'arrivée de TOUTE la grappe, places inchangées
   * comprises. Deux usages distincts, et les confondre serait une faute :
   *
   *   • on VALIDE sur l'ensemble — une place qui ne bouge pas peut devenir
   *     illégale parce que son voisin a changé (un duo interdit reformé, par
   *     exemple). Ne juger que ce qui bouge laisserait passer ça.
   *   • on TRANSMET le sous-ensemble qui change — Filou et l'arbitrage n'ont
   *     que faire d'une affectation qui redit ce qui est déjà là, et un
   *     mouvement de huit lignes dont quatre sont muettes se lit comme un
   *     remue-ménage alors que deux personnes permutent.
   */
  const ajouter = (genre: GenreMouvement, completes: AffectationMouvement[]) => {
    if (completes.length === 0) return
    const changees = completes.filter(
      (a) => avant.get(clePlace(a.date, a.type, a.role)) !== a.vetId,
    )
    if (changees.length === 0) return
    if (!concerneUneCible(changees, avant, cibles)) return
    if (!mouvementLegal(ctx, planning, completes)) return
    out.push({ genre, affectations: changees })
  }

  // ②a — l'inversion des rôles, grappe par grappe.
  for (const g of grappes) {
    const gens = gensDeLaGrappe(g)
    // « Inverser » n'a de sens univoque qu'entre deux personnes.
    if (gens.length !== 2) continue
    const [x, y] = gens
    ajouter(
      'inversion_roles_weekend',
      affectationsDeLaGrappe(g, (id) => (id === x ? y : id === y ? x : id)),
    )
  }

  // ②b — l'échange de personnes entre deux grappes.
  for (let i = 0; i < grappes.length; i++) {
    for (let j = i + 1; j < grappes.length; j++) {
      const g1 = grappes[i]
      const g2 = grappes[j]
      for (const x of gensDeLaGrappe(g1)) {
        for (const y of gensDeLaGrappe(g2)) {
          if (x === y) continue
          // Quelqu'un présent dans les DEUX grappes : l'échanger avec lui-même
          // sur l'une d'elles produirait un doublon sur un même créneau.
          if (gensDeLaGrappe(g1).includes(y) || gensDeLaGrappe(g2).includes(x)) continue
          ajouter('echange_weekend', [
            ...affectationsDeLaGrappe(g1, (id) => (id === x ? y : id)),
            ...affectationsDeLaGrappe(g2, (id) => (id === y ? x : id)),
          ])
        }
      }
    }
  }

  // ②c — le REMPLACEMENT sur une grappe : le seul mouvement qui change le
  // NOMBRE de week-ends de quelqu'un.
  //
  // Sans lui, tout ce module ne sait que redistribuer des week-ends entre les
  // mêmes personnes : chaque échange fait sortir quelqu'un d'un week-end pour
  // le faire entrer dans un autre. C'est ce qui manquait le 02/09, quand MiKL a
  // regardé le planning « corrigé » et retrouvé Antoine avec ses cinq week-ends.
  //
  // Le remplaçant est cherché dans TOUTE l'équipe, pas seulement parmi les
  // ciblés : c'est précisément quelqu'un qui n'a PAS de week-end ici qu'on
  // veut pouvoir faire entrer. Le filtre `concerneUneCible` s'applique ensuite
  // sur le mouvement entier — il suffit que la personne remplacée soit ciblée.
  // Combien de grappes (week-ends) chacun tient déjà — sert à ne tenter la
  // chaîne que dans le sens qui soulage.
  const weekendsDe = new Map<string, number>()
  for (const g of grappes) {
    for (const id of gensDeLaGrappe(g)) weekendsDe.set(id, (weekendsDe.get(id) ?? 0) + 1)
  }

  for (const g of grappes) {
    const presents = new Set(gensDeLaGrappe(g))
    for (const sortant of presents) {
      for (const entrant of vets) {
        if (presents.has(entrant.id)) continue // déjà sur ce week-end
        // Le dernier recours n'est jamais programmé spontanément : le proposer
        // ici contredirait la consigne que le dossier donne à Filou.
        if (entrant.dernier_recours) continue

        const direct = affectationsDeLaGrappe(g, (id) => (id === sortant ? entrant.id : id))
        const avantCompte = out.length
        ajouter('remplacement_weekend', direct)

        // ②d — SI LE REMPLACEMENT DIRECT EST REFUSÉ, libérer l'obstacle.
        //
        // Mesuré le 02/09 sur le vrai planning : c'est le cas GÉNÉRAL, pas
        // l'exception. Le week-end est encadré par le jeudi (qui bloque le
        // vendredi apparié) et par le lundi (depuis B-092). Sur six
        // vétérinaires, aucun candidat ne passe jamais — et Antoine gardait
        // ses cinq week-ends relecture après relecture.
        if (out.length > avantCompte) continue // le direct est passé, inutile

        // On ne tente la chaîne que si elle a un SENS : soulager quelqu'un de
        // plus chargé au profit de quelqu'un qui l'est moins. Déplacer une
        // garde pour transférer un week-end vers quelqu'un qui en a déjà plus
        // serait un remue-ménage à contresens — et c'est aussi ce qui rend le
        // calcul tenable (mesuré : sans ce filtre, la relecture dépassait
        // plusieurs secondes rien qu'à énumérer).
        if ((weekendsDe.get(entrant.id) ?? 0) >= (weekendsDe.get(sortant) ?? 0)) continue

        for (const obstacle of gardesQuiBloquent(planning, entrant.id, g)) {
          for (const repreneur of vets) {
            if (repreneur.id === entrant.id || repreneur.dernier_recours) continue
            if (repreneur.id === sortant) continue // il sort, ne le rechargeons pas
            ajouter('remplacement_weekend_en_chaine', [
              { ...obstacle, vetId: repreneur.id },
              ...direct,
            ])
          }
        }
      }
    }
  }

  return out
}
