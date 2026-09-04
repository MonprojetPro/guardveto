// ============================================================
// GUARDVETO — LES PLACES FIGÉES PAR L'ADMIN (B-111, lot 1)
// ============================================================
// MiKL, le 2026-09-04 : « l'admin doit pouvoir pré-remplir certaines dates […]
// ces dates seront d'office cadenassées […] et quand le moteur regénère il doit
// tenir compte de ce qui a été déjà fixé ».
//
// ── LE TROU QUE CE MODULE BOUCHE ───────────────────────────────────────────
//
// Un verrou existait déjà, mais seulement à l'ÉCRITURE : `ecrirePlanningV1` ne
// supprime ni ne recouvre une garde verrouillée. Son propre commentaire disait
// le reste : « le solver régénère toute la période SANS LES CONNAÎTRE ».
//
// Autrement dit, le moteur composait comme si les cases figées étaient libres,
// et on jetait ses propositions dessus après coup. Conséquence : l'équité, les
// enchaînements et les repos étaient calculés sur un planning qui n'est pas
// celui qui serait affiché. La personne figée ne comptait dans aucun compteur ;
// une garde posée la veille d'une case figée ne voyait pas cette case.
//
// ── LE PRINCIPE, ET POURQUOI IL EST FORMULÉ COMME UN INVARIANT ─────────────
//
// Une place figée n'est pas un résultat du moteur : c'est une DONNÉE D'ENTRÉE,
// au même titre qu'un congé. Elle est dans le planning à tout instant, dès la
// première pose et jusqu'au rendu final.
//
// Ce module ne pose donc pas un garde-fou par chemin — il y en a six qui
// défont des attributions pour les reconstruire (seed, LNS, remplissage au
// mieux, rattrapage, rééquilibrage des rôles, reconstruction de portion), et
// la leçon du 26/08 est explicite : « une exclusion posée en amont ne protège
// que les chemins existant ce jour-là ; tout nouveau code qui CHOISIT une
// personne rouvre le trou sans faire rougir un seul test ».
//
// Il expose deux primitives, à appliquer partout où l'on défait ou reconstruit :
//
//   • `stepsHorsFigees` — une place figée n'est JAMAIS une place à pourvoir ;
//   • `reposerFigees`   — après toute amputation, les figées sont remises.
//
// `reposerFigees` est IDEMPOTENTE : l'appeler deux fois ne change rien, et
// l'appeler « pour rien » sur un planning déjà correct ne coûte qu'un parcours.
// C'est délibéré — on préfère un invariant qu'on peut appliquer sans réfléchir
// à une précaution qu'il faut se rappeler de poser.
//
// ── CE QU'ON IGNORE, ET POURQUOI ───────────────────────────────────────────
//
// Une figée qui ne correspond à AUCUN step de la période est ignorée : créneau
// retiré du catalogue, date hors bornes, rôle renommé. La réinjecter poserait
// dans le planning une garde que le produit ne sait plus décrire — invisible à
// l'écran, absente des places attendues, mais bien présente dans les compteurs.
// C'est exactement la famille de silence que ce projet paie depuis le début :
// mieux vaut une figée qui disparaît visiblement qu'une garde fantôme.
// ============================================================

import type { AttributionGarde, CodeCreneau, PlanningPartiel, RoleGarde } from './types'
import { attributionVide, avecVet } from './attribution'

/**
 * Une place cadenassée par l'admin : « CETTE personne, sur CETTE place ».
 *
 * La granularité est la PLACE, pas la case (arbitrage de MiKL du 04/09) : il
 * peut figer le 1er sans le 2nd, le 2nd sans le 1er, ou les deux. Le moteur
 * complète alors les places libres de la même case.
 */
export interface PlaceFigee {
  date: string
  type: CodeCreneau
  role: RoleGarde
  vetId: string
}

/** Forme minimale d'un step attendue ici — sous-ensemble structurel de SolverStep. */
interface StepMinimal {
  date: string
  type: CodeCreneau
  role: RoleGarde
  rolesCreneau?: string[]
}

/** Clé d'identité d'une place : date + créneau + rôle. */
export function clePlaceFigee(date: string, type: CodeCreneau, role: RoleGarde): string {
  return `${date}|${type}|${role}`
}

/**
 * Index des places figées, prêt à interroger.
 *
 * En cas de doublon (deux figées sur la même place), la DERNIÈRE gagne. Le cas
 * ne devrait pas se produire — l'unicité est tenue en base — mais un index qui
 * choisit silencieusement au hasard serait pire qu'un choix arbitraire écrit.
 */
export type IndexFigees = Map<string, PlaceFigee>

export function indexerFigees(figees: readonly PlaceFigee[] | undefined): IndexFigees {
  const index: IndexFigees = new Map()
  for (const f of figees ?? []) {
    index.set(clePlaceFigee(f.date, f.type, f.role), f)
  }
  return index
}

/** Cette place est-elle cadenassée ? */
export function estFigee(index: IndexFigees, date: string, type: CodeCreneau, role: RoleGarde): boolean {
  return index.has(clePlaceFigee(date, type, role))
}

/**
 * Les steps qu'il reste à pourvoir : tout sauf les places figées.
 *
 * C'est la moitié « ne pas y toucher » de l'invariant. Sans elle, le moteur
 * chercherait un candidat pour une place déjà occupée — et le poserait.
 */
export function stepsHorsFigees<T extends StepMinimal>(steps: readonly T[], index: IndexFigees): T[] {
  if (index.size === 0) return [...steps]
  return steps.filter((s) => !estFigee(index, s.date, s.type, s.role))
}

/**
 * Remonte en tête les places restantes des cases PARTIELLEMENT cadenassées.
 *
 * ── POURQUOI CET ORDRE EST NÉCESSAIRE, ET POURQUOI ON NE TOUCHE PAS À R9 ───
 *
 * Mesuré le 04/09 : cadenasser le 1er d'un week-end rendait TOUTE la génération
 * impossible. La sonde a nommé le coupable — R9, « le vendredi soir doit avoir
 * les mêmes vétérinaires que le week-end ».
 *
 * R9 juge un candidat contre l'équipe du créneau lié DÈS QU'ELLE EXISTE, sans
 * vérifier qu'elle est complète. Un week-end cadenassé à moitié est une équipe
 * d'une seule personne : le vendredi n'avait donc plus qu'un candidat possible,
 * que l'inversion des rôles interdisait à son tour. Impasse totale, alors que la
 * solution était évidente — désigner d'abord le second du week-end.
 *
 * En génération ordinaire le cas ne se présentait jamais : le week-end n'existe
 * pas encore quand le vendredi se décide. C'est la même famille que la leçon du
 * 02/09 (« une place à null existe encore pour R9, qui répond "il n'y est pas"
 * et refuse toute pose ») : un état intermédiaire que le contrôle mutuel des
 * créneaux liés ne sait pas lire.
 *
 * ⚠️ On ne corrige PAS R9 en lui faisant ignorer les équipes incomplètes. Ce
 * serait plus permissif au mauvais endroit : le vendredi pourrait alors se poser
 * avec des personnes qui ne seront jamais du week-end, et le cadenas ne pouvant
 * pas s'adapter, on obtiendrait exactement l'incohérence que R9 existe pour
 * empêcher. On lui donne donc ce qu'elle sait lire — une équipe complète — en
 * traitant ces places-là en premier.
 *
 * L'ordre relatif du reste est préservé (tri stable) : sans cadenas, la liste
 * est rendue inchangée, donc la génération reste byte-identique.
 */
export function prioriserCasesFigees<T extends StepMinimal>(
  steps: readonly T[],
  index: IndexFigees,
): T[] {
  if (index.size === 0) return [...steps]

  const casesFigees = new Set<string>()
  for (const f of index.values()) casesFigees.add(`${f.date}|${f.type}`)

  const prioritaires: T[] = []
  const reste: T[] = []
  for (const s of steps) {
    (casesFigees.has(`${s.date}|${s.type}`) ? prioritaires : reste).push(s)
  }
  return [...prioritaires, ...reste]
}

/**
 * Les figées qui ont réellement une place dans cette période, groupées en
 * attributions prêtes à servir de planning de départ.
 *
 * ⚠️ La forme produite est EXACTEMENT celle que le solver crée lui-même
 * (`attributionVide` avec les rôles du catalogue, puis `avecVet`). Ce n'est pas
 * un détail de style : `ecrirePlanningV1` lit les places par POSITION
 * (`placements[0]` → `premier_id`, `placements[1]` → `second_id`). Une
 * attribution construite dans un autre ordre — par exemple en ne gardant que la
 * place figée — écrirait le 2nd dans la colonne du 1er, sans qu'aucun test
 * d'égalité de contenu ne s'en aperçoive.
 */
export function attributionsDesFigees(
  index: IndexFigees,
  steps: readonly StepMinimal[],
): AttributionGarde[] {
  if (index.size === 0) return []

  // Un step par place réellement attendue — c'est lui qui autorise la figée à
  // exister, et qui porte les rôles déclarés du créneau.
  const parCase = new Map<string, { date: string; type: CodeCreneau; rolesCreneau?: string[]; poses: PlaceFigee[] }>()

  for (const step of steps) {
    const figee = index.get(clePlaceFigee(step.date, step.type, step.role))
    if (!figee) continue
    const cleCase = `${step.date}|${step.type}`
    const entree = parCase.get(cleCase)
    if (entree) {
      entree.poses.push(figee)
    } else {
      parCase.set(cleCase, {
        date: step.date,
        type: step.type,
        rolesCreneau: step.rolesCreneau,
        poses: [figee],
      })
    }
  }

  const attributions: AttributionGarde[] = []
  for (const { date, type, rolesCreneau, poses } of parCase.values()) {
    let attr = attributionVide(date, type, rolesCreneau)
    for (const p of poses) attr = avecVet(attr, p.role, p.vetId)
    attributions.push(attr)
  }
  return attributions
}

/**
 * Les cadenas qui ne correspondent à AUCUNE place de la période.
 *
 * Ils sont ignorés par tout le reste du module (cf. en-tête), et c'est le bon
 * comportement — mais les ignorer EN SILENCE serait exactement le défaut que ce
 * produit combat. L'admin a posé un cadenas ; s'il ne s'applique nulle part, il
 * doit l'apprendre, pas le découvrir en constatant que la personne a changé.
 *
 * Causes possibles : créneau retiré du catalogue depuis la pose, effectif de
 * nuit réduit (la 2ᵉ place n'existe plus), date sortie des bornes de la période,
 * rôle renommé.
 */
export function figeesSansPlace(
  index: IndexFigees,
  steps: readonly StepMinimal[],
): PlaceFigee[] {
  if (index.size === 0) return []
  const attendues = new Set(steps.map((s) => clePlaceFigee(s.date, s.type, s.role)))
  return [...index.entries()]
    .filter(([cle]) => !attendues.has(cle))
    .map(([, figee]) => figee)
}

/**
 * Remet les places figées sur un planning — après une amputation, une
 * reconstruction, ou par simple précaution.
 *
 * IDEMPOTENTE et sans effet quand il n'y a pas de figée : on peut l'appeler
 * partout où un planning vient d'être fabriqué, sans avoir à démontrer qu'elle
 * était nécessaire. C'est le but — un invariant qu'on applique sans réfléchir
 * survit à l'ajout du prochain chemin, une précaution qu'il faut se rappeler
 * de poser ne survit à rien.
 *
 * Les figées sans step correspondant sont ignorées (cf. en-tête du module).
 */
export function reposerFigees(
  planning: PlanningPartiel,
  index: IndexFigees,
  steps: readonly StepMinimal[],
): PlanningPartiel {
  if (index.size === 0) return planning

  const aReposer = attributionsDesFigees(index, steps)
  if (aReposer.length === 0) return planning

  const attributions = planning.attributions.map((a) => a)

  for (const figee of aReposer) {
    const idx = attributions.findIndex((a) => a.date === figee.date && a.type === figee.type)
    if (idx < 0) {
      attributions.push(figee)
      continue
    }
    // La case existe : on n'écrase QUE les places cadenassées, pour ne pas
    // effacer ce que le moteur a légitimement posé sur les places libres.
    let attr = attributions[idx]
    for (const place of figee.placements) {
      if (!place.vetId) continue
      if (!estFigee(index, figee.date, figee.type, place.role)) continue

      // Garde-fou : si la personne cadenassée a été posée sur une AUTRE place
      // de la même case, la reposer ici la mettrait deux fois sur la même
      // garde. Le cas ne devrait pas survenir (la figée est dans le planning
      // dès le départ, donc `isValid` voit le doublon et le refuse) — mais un
      // planning où quelqu'un est à la fois 1er et 2nd est une aberration
      // qu'aucun écran ne rattrape, et qui partirait telle quelle dans les
      // agendas. On la rend impossible ici plutôt que de compter dessus.
      const ailleurs = attr.placements.find((p) => p.vetId === place.vetId && p.role !== place.role)
      if (ailleurs) attr = avecVet(attr, ailleurs.role, null)

      attr = avecVet(attr, place.role, place.vetId)
    }
    attributions[idx] = attr
  }

  return { attributions }
}
