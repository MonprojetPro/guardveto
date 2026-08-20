// ============================================================
// GUARDVETO — Dire une règle en français (source UNIQUE)
// ============================================================
// Ces fonctions vivaient dans `ReglesClient.tsx`. Elles en sortent parce que
// Filou doit maintenant LIRE les règles existantes pour proposer d'en supprimer
// ou d'en désactiver une : il faut qu'il les nomme EXACTEMENT comme l'écran
// Règles les nomme. Deux rendus séparés auraient divergé au premier ajout de
// brique, et Filou aurait proposé de supprimer « la règle du mercredi » pendant
// que l'écran en affichait une autre formulation.
//
// Module neutre (ni serveur ni client) : appelé par le composant de la page
// Règles ET par l'action serveur de l'assistant.
// ============================================================

import { rendreRegle } from '@/engine/briques/catalogue'
// `paramsRegle` n'importe rien (module de FORME pur) : aucun cycle possible.
import { estRegleTous, LIBELLE_OWNER_TOUS } from '@/lib/regles/paramsRegle'

/** Le minimum dont on a besoin pour nommer une règle. */
export interface RegleNommable {
  id: string
  brique_id: string
  params_json: unknown
}

// ── La force d'une règle, dite pareil partout ───────────────────────────────
// L'écran Règles groupe par force et affiche une pastille de couleur. L'écran
// Équipe montre les mêmes règles, fiche par fiche : il lui faut le MÊME
// vocabulaire, sinon une contrainte serait « rouge » ici et « ferme » là.
// `etage` est l'ordre de sévérité (0 = le plus dur) — il sert à trier.

export interface ForceMeta {
  etage: number
  symbole: string
  /** Le mot du badge — quatre mots DIFFÉRENTS, quatre couleurs DIFFÉRENTES. */
  mot: string
  /** Le choix, tel qu'il se lit dans le formulaire. Une décision, pas un grade. */
  choix: string
  /** Ce que le moteur fera vraiment. C'est ça qui permet de choisir. */
  aide: string
}

/**
 * Les quatre niveaux de fermeté, dits pareil PARTOUT (formulaire, fiche véto,
 * écran Règles).
 *
 * Refonte du 2026-07-31. Ils s'appelaient « Interdiction ferme », « À éviter
 * sauf crise », « Préférence (évitée) » et « Préférence (si possible) ». Les
 * deux derniers commençaient par le même mot ET portaient la même pastille
 * jaune. MiKL : « je me mets à la place d'un admin, comment il va savoir
 * choisir ? faut revoir ce truc, c'est vital ».
 *
 * Trois principes appliqués :
 *  · quatre mots d'attaque tous différents — Jamais / Sauf / Éviter / Souhait ;
 *  · quatre couleurs distinctes, du rouge au vert, qui se lisent comme une
 *    échelle même sans lire le texte ;
 *  · chaque niveau dit ce que le MOTEUR fera, pas à quel point c'est
 *    « important » — un adjectif ne se compare pas, un comportement si.
 */
export const FORCE_META: Record<string, ForceMeta> = {
  invariant: {
    etage: 0, symbole: '🔴', mot: 'Intouchable',
    choix: 'Intouchable',
    aide: "Règle de fond du cabinet — elle ne se modifie pas ici.",
  },
  reglementaire: {
    etage: 1, symbole: '⚪', mot: 'Réglementaire',
    choix: 'Réglementaire',
    aide: 'Imposée par la loi ou la convention. Fournie pré-assemblée.',
  },
  jamais: {
    etage: 2, symbole: '🔴', mot: 'Jamais',
    choix: 'Jamais — c’est interdit',
    aide: "Le moteur ne le fera en aucun cas. Quitte à ne pas trouver de planning du tout et à te demander d'arbitrer.",
  },
  sauf_crise: {
    etage: 3, symbole: '🟠', mot: 'Sauf urgence',
    choix: "Sauf s'il n'a vraiment plus le choix",
    aide: "Il l'évite toujours. Il ne s'y résout que si aucune autre combinaison ne marche — plutôt que de rendre un planning incomplet.",
  },
  evitee: {
    etage: 4, symbole: '🟡', mot: 'À éviter',
    choix: "Il fait tout pour l'éviter",
    aide: "Il accepte de déséquilibrer un peu la répartition des gardes pour ne pas avoir à le faire. Mais il le fera plutôt que de bloquer.",
  },
  si_possible: {
    etage: 5, symbole: '🟢', mot: 'Souhait',
    choix: 'Un souhait, si ça n’embête personne',
    aide: "Il en tient compte en dernier, une fois l'équité assurée. Ne coûte jamais une garde à quelqu'un d'autre.",
  },
}

export function etageDe(force: string): number {
  return FORCE_META[force]?.etage ?? 99
}

export function symboleDe(force: string): string {
  return FORCE_META[force]?.symbole ?? '⚪'
}

export function motForce(force: string): string {
  return FORCE_META[force]?.mot ?? 'Règle'
}

export function choixForce(force: string): string {
  return FORCE_META[force]?.choix ?? 'Règle'
}

export function aideForce(force: string): string {
  return FORCE_META[force]?.aide ?? ''
}

interface ParamsJson {
  qui?: { refs?: unknown }
  params?: unknown
}

/**
 * Clé de paire non ordonnée d'un duo interdit (sinon null). Sert à n'afficher
 * QU'UNE ligne par duo, alors que la base en stocke deux (A→B + B→A, requis par
 * le moteur). Le toggle/suppression côté serveur gèrent déjà les deux sens.
 */
export function clePaireDuo(r: RegleNommable): string | null {
  if (r.brique_id !== 'duo_interdit') return null
  const pj = r.params_json as { qui?: { refs?: unknown[] }; params?: { avec_veterinaire_id?: unknown } }
  const owner = pj?.qui?.refs?.[0]
  const partner = pj?.params?.avec_veterinaire_id
  if (typeof owner !== 'string' || typeof partner !== 'string') return null
  return [owner, partner].sort().join('|')
}

/** Retire le sens miroir des duos : on ne garde que la 1re ligne de chaque paire. */
export function fusionnerDuos<T extends RegleNommable>(rows: T[]): T[] {
  const vues = new Set<string>()
  return rows.filter((r) => {
    const cle = clePaireDuo(r)
    if (!cle) return true
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

/**
 * Les règles qui concernent UN véto, telles qu'on les montre sur sa fiche.
 *
 * Trois pièges, tous vécus :
 *
 * 1. Un duo interdit est stocké en DEUX lignes (A→B et B→A, le moteur a besoin
 *    des deux sens). Sur la fiche de A, la ligne B→A compte aussi : elle
 *    contraint A tout autant. On récupère donc les deux, puis on n'en garde
 *    qu'une (`fusionnerDuos`).
 * 2. …mais laquelle ? Si on garde B→A, la fiche de A affiche « B ne peut pas
 *    être seul avec A » — vrai, mais tourné à l'envers pour qui lit la fiche de
 *    A. On trie donc pour que la ligne dont A est le sujet passe en premier.
 * 3. Les règles du cabinet (équité, créneaux liés) n'ont pas de `qui` : elles
 *    ne remontent jamais ici, et c'est voulu — elles vivent sur l'écran Règles.
 */
export function reglesDuVeto<T extends RegleNommable>(regles: T[], vetoId: string): T[] {
  const concerne = regles.filter((r) => {
    const pj = (r.params_json ?? {}) as {
      qui?: { refs?: unknown }
      params?: { avec_veterinaire_id?: unknown }
    }
    const refs = Array.isArray(pj.qui?.refs) ? pj.qui.refs : []
    if (refs.includes(vetoId)) return true
    return r.brique_id === 'duo_interdit' && pj.params?.avec_veterinaire_id === vetoId
  })

  const estSujet = (r: T) => {
    const refs = ((r.params_json ?? {}) as { qui?: { refs?: unknown } }).qui?.refs
    return Array.isArray(refs) && refs[0] === vetoId
  }
  // Tri STABLE : on ne fait que remonter les lignes dont le véto est le sujet,
  // l'ordre d'arrivée est conservé pour tout le reste.
  const ordonne = [...concerne].sort((a, b) => Number(estSujet(b)) - Number(estSujet(a)))

  return fusionnerDuos(ordonne)
}

/**
 * Les briques qui visent une ÉTIQUETTE plutôt qu'une personne.
 *
 * Elles ne rangent pas leur cible dans `qui.refs` (qui vaut `null`) mais dans
 * `params.tag` — c'est pour ça que `reglesDuVeto` ne peut pas les voir, et
 * c'est normal : elle cherche un identifiant de véto, il n'y en a pas.
 *
 * `equilibrer` est volontairement ABSENTE de cette liste, bien qu'elle accepte
 * un `tag` : une cohorte d'équité règle la façon dont le moteur RÉPARTIT la
 * charge, elle n'interdit rien à personne. L'afficher parmi les contraintes
 * d'un vétérinaire ferait passer un réglage de justice pour une restriction.
 */
const BRIQUES_PAR_ETIQUETTE = new Set(['composition_equipe', 'role_interdit_tag'])

/**
 * Les règles qui pèsent sur un véto À TRAVERS UNE DE SES ÉTIQUETTES.
 *
 * POURQUOI CETTE FONCTION EXISTE — audit du 2026-08-14
 *
 * « Les seniors ne sont jamais 1er de garde » contraint Anne-Catherine aussi
 * sûrement qu'un repos fixe nominatif. Pourtant sa fiche n'en montrait rien :
 * `reglesDuVeto` filtre sur `qui.refs`, et ces règles-là ont `qui = null`.
 * Résultat, on pouvait ouvrir la fiche d'un vétérinaire, n'y voir aucune
 * contrainte, et en conclure que le cabinet n'avait rien réglé pour lui.
 *
 * Ces règles sont rendues EN LECTURE SEULE sur la fiche : elles ne lui
 * appartiennent pas — elles appartiennent à l'étiquette, et se modifient
 * là où l'étiquette se règle. Proposer un crayon ici mènerait au mieux à
 * une surprise (modifier pour un, c'est modifier pour tous), au pire à un
 * refus serveur.
 *
 * La comparaison est faite en minuscules : la base peut contenir « Senior » et
 * « senior », qui sont la même étiquette pour le moteur.
 */
export function reglesParEtiquetteDuVeto<T extends RegleNommable>(
  regles: T[],
  tags: readonly string[] | null | undefined,
): T[] {
  const siens = new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t !== ''))
  if (siens.size === 0) return []

  return regles.filter((r) => {
    if (!BRIQUES_PAR_ETIQUETTE.has(r.brique_id)) return false
    const tag = ((r.params_json ?? {}) as { params?: { tag?: unknown } }).params?.tag
    return typeof tag === 'string' && siens.has(tag.trim().toLowerCase())
  })
}

/** Une règle existante que Filou propose de toucher, telle qu'affichée. */
export interface RegleVisee {
  id: string
  libelle: string
  actif: boolean
}

/**
 * Traduit les numéros renvoyés par l'assistant (R1, R2…) en règles réelles.
 *
 * FRONTIÈRE DE CONFIANCE : c'est le seul endroit où une sortie de modèle
 * devient un identifiant de ligne. On ne garde donc QUE des numéros présents
 * dans la liste qu'on a nous-mêmes envoyée — un numéro halluciné, hors bornes
 * ou répété est jeté en silence, jamais résolu « au plus proche ». L'ordre de
 * la réponse est conservé : c'est celui dans lequel Filou en a parlé.
 */
export function reglesVisees<T extends { id: string; actif: boolean }>(
  candidates: T[],
  libelles: string[],
  numeros: unknown[],
): RegleVisee[] {
  const retenus = [
    ...new Set(
      numeros.filter(
        (n): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= candidates.length,
      ),
    ),
  ]
  return retenus.map((n) => ({
    id: candidates[n - 1].id,
    libelle: libelles[n - 1] ?? '',
    actif: candidates[n - 1].actif,
  }))
}

export function phraseRegle(regle: RegleNommable, nomVeto: (id: string) => string): string {
  const pj = (regle.params_json ?? {}) as ParamsJson
  // Règle collective (`qui.type = 'tous'`) : aucune réf n'est figée, le sujet
  // ne peut donc pas se déduire des refs. Sans ce cas, la phrase s'afficherait
  // SANS sujet (« de garde au plus un week-end sur 3 ») — l'admin ne saurait
  // pas à qui elle s'applique. Traité ici : `phraseRegle` est la source unique
  // de l'écran Règles ET de la fiche du véto dans l'écran Équipe.
  if (estRegleTous(pj)) {
    return `${LIBELLE_OWNER_TOUS} ${rendreRegle(regle.brique_id, (pj.params ?? {}) as Record<string, unknown>, { nomVeto })}`
  }
  const refs = pj.qui?.refs
  // Multi-propriétaires (n°18) : le sujet affiche TOUTES les réfs — sauf pour
  // un duo interdit où refs[1] est le PARTENAIRE (déjà rendu par le prédicat).
  const refsStr = Array.isArray(refs) ? refs.filter((x): x is string => typeof x === 'string') : []
  const sujets = regle.brique_id === 'duo_interdit' ? refsStr.slice(0, 1) : refsStr
  const sujet = sujets.map(nomVeto).join(', ')
  const params = (pj.params ?? {}) as Record<string, unknown>
  const predicat = rendreRegle(regle.brique_id, params, { nomVeto })
  return sujet ? `${sujet} ${predicat}` : predicat
}
