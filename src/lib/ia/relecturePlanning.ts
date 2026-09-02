// ============================================================
// GUARDVETO — Filou relit le planning généré (B-062, lot 1)
// ============================================================
// Ce module ne DÉCIDE rien et n'écrit rien. Il pose une question à Filou et
// rend ce qu'il répond, sous une forme que le moteur pourra contrôler
// (`engine/relecture/arbitrer`). C'est la seule pièce de la chaîne qui parle à
// un modèle — tout ce qui juge est ailleurs, et testable sans réseau.
//
// ── LE RÔLE DE FILOU ICI ────────────────────────────────────────────────────
//
// MiKL, 27/08 : « un observateur indépendant qui se rapproche plus de la
// doctrine humaine (repos, épuisement, équilibre global) que celle d'un moteur
// algorithmique ». On ne lui demande donc PAS de rejouer le calcul du moteur —
// il serait une doublure coûteuse. On lui demande de voir ce que le moteur ne
// voit pas. Les critères sont dans `lib/planning/criteres-humains.ts`, écrits
// en français, relisibles et amendables sans ouvrir ce fichier.
//
// ── MODÈLE : SONNET 5, MESURÉ PUIS TRANCHÉ ──────────────────────────────────
//
// Décision de MiKL le 31/08, après le banc (`bancRelecture.ts`) : « on ne va
// pas tergiverser 3 h et dépenser pour rien, on prend Sonnet 5 ».
//
// Ce qu'Opus 4.8 coûtait vraiment, mesuré sur Hiver P1 (48 places, 7
// personnes) : 152,1 s et 35,7 ¢ sans réglage d'application, 128,3 s et 30,4 ¢
// à `medium`. Les deux DÉPASSENT le plafond de 120 s de la route — la relecture
// d'aujourd'hui ne tenait déjà plus dans son propre budget de temps.
//
// ⚠️ Le banc a rendu DEUX ÉCHECS sur Sonnet 5, et aucun n'était le modèle :
//   • `medium` : coupé à 16 000 jetons sur 16 000 — notre plafond, atteint pile.
//     Sonnet 5 produit plus de jetons qu'Opus pour un même texte ; le budget
//     était calibré sur l'autre modèle. → `MAX_TOKENS_RELECTURE` relevé.
//   • `low` : relecture COMPLÈTE et correcte, jetée par notre propre schéma
//     pour cause de texte trop long. → contraintes de longueur retirées du
//     schéma, appliquées en coupe (voir le bloc au-dessus d'`AffectationSchema`).
//
// Les deux correctifs valent pour TOUS les modèles : le second défaut était
// armé sur Opus aussi, il n'avait simplement pas encore explosé.
//
// Réglable par `GUARDVETO_IA_MODELE_RELECTURE` — revenir à `claude-opus-4-8`
// ne demande donc pas un déploiement de code.
//
// ⚠️ Variable SÉPARÉE de `GUARDVETO_IA_MODELE` (le Filou du quotidien, Sonnet
// par décision du 24/08) : une seule variable ferait basculer les 630 appels
// mensuels du chat en même temps que les 4 relectures annuelles.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { assistantIaDisponible, cleIA } from './proposerRegle'
import { critereEnTexte, CRITERES_HUMAINS } from '@/lib/planning/criteres-humains'
import type { ChangementPropose } from '@/engine/relecture/arbitrer'

/**
 * Le modèle de la relecture. `trim()` obligatoire : un copier-coller dans
 * l'interface Vercel colle facilement un retour à la ligne invisible en fin de
 * valeur, et l'API répond alors 404 not_found_error (incident 2026-07-27).
 */
export function modeleRelecture(): string {
  return process.env.GUARDVETO_IA_MODELE_RELECTURE?.trim() || 'claude-sonnet-5'
}

/** Les crans d'application acceptés par l'API, du plus court au plus fouillé. */
export const EFFORTS_RELECTURE = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortRelecture = (typeof EFFORTS_RELECTURE)[number]

/**
 * `low`, et le banc du 31/08 est formel : SUR CETTE TÂCHE, PLUS D'APPLICATION
 * DONNE UN MOINS BON RÉSULTAT. Mesuré sur Hiver P1 (48 places, 7 personnes) :
 *
 *   • `high` (l'ancien défaut de l'API) — ÉCHEC : coupé à 24 000 jetons sur
 *     24 000, après 247,6 s. Aucune relecture rendue.
 *   • `medium` — 178,3 s, 16 972 jetons, 29,21 ¢ … et **0 critère sur 9**.
 *   • `low` — 64,7 s, 5 654 jetons, 12,23 ¢, **9 critères sur 9**, 4 problèmes
 *     et 4 points à surveiller, 2 propositions.
 *
 * Pour comparaison, Opus 4.8 à `medium` : 115,2 s, 27,31 ¢, 9/9, 4 problèmes.
 * `low` sur Sonnet 5 fait donc AUSSI BIEN, deux fois plus vite et pour moins de
 * la moitié du prix.
 *
 * ⚠️ CE N'EST PAS UN RÉGLAGE D'ÉCONOMIE, C'EST LE RÉGLAGE QUI MARCHE. Le
 * remonter « pour être plus sûr » est le geste qui casse la relecture — c'est
 * exactement ce qui la cassait sans que personne l'ait choisi. L'explication
 * tient au travail demandé : les compteurs, les absences et la liste des
 * remplaçants sont SERVIS TOUT CALCULÉS. Il reste à lire, comparer et rédiger.
 * Donner plus de place à ce travail-là ne l'améliore pas : ça l'étale.
 *
 * Réglable par `GUARDVETO_IA_EFFORT_RELECTURE` si un cabinet ou une période
 * beaucoup plus grande demandait autre chose — mais à mesurer au banc AVANT,
 * jamais au ressenti.
 */
const EFFORT_PAR_DEFAUT: EffortRelecture = 'low'

/**
 * L'application demandée à la relecture — le SEUL levier sur son temps.
 *
 * ⚠️ Le budget de jetons de réflexion n'existe plus : `thinking: { type:
 * 'enabled', budget_tokens: N }` est refusé par l'API (400, incident du
 * 2026-07-28). La réflexion est toujours `adaptive` ; ce qui se règle, c'est
 * `output_config.effort` — exactement comme le Filou du quotidien
 * (`agentFilou.ts`), qui tourne à `medium` depuis le 28/07.
 *
 * ⚠️ NON RÉGLÉ = `high`, le défaut de l'API. Ce n'est donc pas un choix qui a
 * été fait, c'est un choix qui n'a pas été fait : la relecture réfléchit au
 * cran par défaut le plus fouillé de la gamme, sur le modèle le plus lent, pour
 * une tâche qui lui sert les compteurs, les absences et la liste des
 * remplaçants tout calculés. C'est la première cause du temps d'attente mesuré
 * le 31/08 — et sur une période de 12 semaines, elle ferait dépasser le plafond
 * de 120 s de la route.
 *
 * Réglable SANS TOUCHER AU CODE : `GUARDVETO_IA_EFFORT_RELECTURE`. Laissée
 * vide, elle conserve le comportement d'aujourd'hui — le banc mesure ce qui
 * tourne réellement, il ne mesure pas un réglage qu'on vient de poser.
 */
export function effortRelecture(): EffortRelecture {
  const brut = process.env.GUARDVETO_IA_EFFORT_RELECTURE?.trim().toLowerCase()
  return EFFORTS_RELECTURE.includes(brut as EffortRelecture)
    ? (brut as EffortRelecture)
    : EFFORT_PAR_DEFAUT
}

/**
 * Le budget de sortie de la relecture.
 *
 * ⚠️ CE PLAFOND COUVRE LA RÉFLEXION **ET** LA RÉPONSE. La première version
 * était à 8 000, ce qui était sous-dimensionné : avec la réflexion adaptative
 * sur douze semaines de planning, le modèle peut consommer tout le budget à
 * réfléchir et se faire couper AVANT d'avoir rendu sa réponse structurée. On
 * n'obtient alors pas une réponse partielle mais RIEN du tout — la sortie
 * structurée n'existe qu'entière — et l'écran affiche « Filou n'a pas pu
 * relire », sans dire que c'était une question de place.
 *
 * ⚠️ MESURÉ LE 31/08 : 16 000 ne suffisait plus. Sonnet 5 à `medium` a produit
 * **16 000 jetons sur 16 000 autorisés** et s'est fait couper avant d'avoir
 * rendu sa réponse structurée — l'écran a affiché « Filou n'a pas pu relire »
 * pour un manque de place, exactement le scénario que le commentaire ci-dessus
 * décrivait. Sonnet 5 produit plus de jetons qu'Opus pour un même texte : un
 * budget calibré sur Opus est trop court pour lui.
 *
 * Relevé à 24 000, soit la moitié en plus.
 *
 * ⚠️ ET C'EST CE QUI A IMPOSÉ LE FLUX. Le SDK REFUSE un appel non diffusé dès
 * que `max_tokens` dépasse **21 333** — il estime la durée par
 * `3600 × max_tokens / 128000` et lève au-delà de 10 minutes
 * (`client.js:_calculateNonstreamingTimeout`). Le refus est IMMÉDIAT et local :
 * aucun appel ne part, rien n'est facturé, et le message ne parle que de
 * streaming — jamais de `max_tokens`, qui en est pourtant la seule cause.
 *
 * Monter le budget SANS passer en flux était donc contradictoire : les deux
 * vont ensemble. C'est ce qui a fait échouer les 4 configurations du banc en
 * 0,0 s le 31/08.
 */
const MAX_TOKENS_RELECTURE = 24000

// ── Ce qu'on donne à lire à Filou ────────────────────────────

/** Une place du planning, telle qu'elle lui est présentée. */
export interface PlaceLisible {
  date: string
  /** Le jour en toutes lettres — « lundi 21 septembre ». */
  jour: string
  /** Le créneau en français — « nuit de semaine », « week-end ». */
  creneau: string
  type: string
  role: string
  /** Prénom de la personne, ou null si la place est vide. */
  prenom: string | null
  vetId: string | null
  /**
   * Qui d'autre POURRAIT tenir cette place — calculé par le moteur lui-même.
   *
   * ⚠️ C'est la pièce qui manquait, et sans elle la relecture ne servait à
   * rien. MiKL, 27/08 : « je ne comprends pas qu'à partir de ces constats il
   * n'y ait pas de changements appliqués... il n'avait aucune idée de comment
   * faire pour changer au mieux ? »
   *
   * Il avait raison sur la cause : Filou voyait les problèmes mais n'avait
   * AUCUN moyen de savoir si un échange était légal. Il devait deviner, et
   * devant l'incertitude il s'abstenait — d'où 6 constats sur 7 marqués « pas
   * de correction automatique ». Lui donner les possibles change un observateur
   * impuissant en quelqu'un qui propose des choses qui passent.
   */
  remplacants: string[]
}

/** Ce que Filou sait d'une personne de l'équipe. */
export interface PersonneLisible {
  vetId: string
  prenom: string
  /** Gardes sur CETTE période, par grande catégorie. */
  gardesPeriode: { total: number; weekends: number; premierWeekend: number }
  /** Compteurs cumulés des périodes précédentes — l'équilibre global. */
  historique?: { total: number; weekends: number; premierWeekend: number }
  /** Ses absences sur la période, en français. */
  absences: string[]
  /** Ses règles personnelles, en français (repos fixes, indisponibilités). */
  regles: string[]
}

export interface DossierRelecture {
  /** La période, en français — « du 21 septembre au 18 octobre ». */
  periode: string
  saison: 'ete' | 'hiver'
  places: PlaceLisible[]
  equipe: PersonneLisible[]
  /** Les règles du cabinet, en français. Ce que CE cabinet a décidé. */
  reglesCabinet: string[]
  /**
   * Les PRÉFÉRENCES du cabinet que ce planning n'a pas pu respecter (B-096).
   *
   * Ce ne sont pas des violations : le cabinet les a réglées en « sauf en cas
   * de crise » ou plus souple, le moteur avait donc le droit de les enfreindre
   * et l'a payé en pénalité. Mais il faut le DIRE — sur Hiver P2, la règle
   * « au moins 3 semaines entre deux week-ends » était enfreinte huit fois,
   * dont trois d'affilée par la même personne, et personne ne l'a vu.
   *
   * Filou ne pouvait pas les retrouver seul : il aurait fallu soustraire des
   * dates de tête sur 118 lignes. Le moteur, lui, les connaît.
   *
   * Vide → aucune préférence enfreinte, et là ça veut vraiment dire ça.
   */
  preferencesEnfreintes: string[]
  /** Le rôle qui porte l'avantage financier, s'il est configuré. */
  roleAvantageFinancier: string | null
  /**
   * Les ÉCHANGES que le moteur accepte — deux places dont les occupants peuvent
   * permuter (B-093).
   *
   * Pourquoi c'est indispensable et pas un confort : la liste `remplacants`
   * d'une place ne dit qui pourrait la prendre que si l'on ne libère QUE
   * celle-là. Sur un planning que le moteur vient d'optimiser, c'est presque
   * toujours personne — mesuré le 2026-09-01 : 53 places sur 118 sans aucun
   * remplaçant. Filou lisait ces listes vides comme « rien n'est possible » et
   * s'abstenait, d'où sept constats sur sept marqués « pas de correction
   * automatique ». Ce qui reste à améliorer dans un planning optimisé, ce sont
   * les échanges.
   *
   * Vide → aucun mouvement légal, et là ça veut vraiment dire ça.
   *
   * ── B-096 : CE N'EST PLUS UNE LISTE D'ÉCHANGES À DEUX PLACES ──────────────
   *
   * Elle l'était, et c'est ce qui laissait les week-ends hors de portée. Le
   * week-end est lié à son vendredi par deux règles dures ; un mouvement à deux
   * places qui touche l'un sans l'autre casse le binôme et se fait refuser.
   * AUCUNE place de week-end n'était donc atteignable — or c'est là que vivent
   * l'avantage financier du 1er et l'essentiel du déséquilibre de charge.
   *
   * Chaque entrée porte désormais un nombre libre de places, ET son EFFET
   * mesuré sur le planning. Sans l'effet, on disait « le moteur accepte » sans
   * jamais dire « ça vaut le coup » : légal et souhaitable confondus.
   */
  mouvements: MouvementLisible[]
  /**
   * Combien de mouvements légaux ont été écartés de la liste faute de place.
   *
   * Mesuré le 02/09 : une période d'hiver complète produit **3012 mouvements**,
   * dont 2736 échanges simples. Les envoyer tous noierait le signal — Filou ne
   * choisirait pas dans une aide mais dans un mur, ce qui était déjà le cas ce
   * jour-là. On borne donc, en gardant d'abord les leviers rares.
   *
   * ⚠️ Ce nombre est DIT à Filou. Une liste tronquée en silence se lirait
   * « voilà tout ce qui est possible ».
   */
  mouvementsEcartes: number
}

/** Un mouvement applicable, décrit en français, avec son effet mesuré. */
export interface MouvementLisible {
  /** La phrase qui le résume — « Antoine et Victor échangent leurs rôles du week-end du 24 octobre ». */
  resume: string
  /** Le détail, une ligne par place qui change. */
  lignes: string[]
  /**
   * Ce que le mouvement fait au planning, mesuré par le moteur lui-même
   * (`scorerPlanning`), jamais estimé.
   */
  effet: 'ameliore' | 'egal' | 'degrade'
  /** Ce sur quoi il agit, en français. Absent quand l'effet est nul. */
  surQuoi?: string
  /** Coordonnées machine, pour que Filou puisse les recopier sans les inventer. */
  affectations: { date: string; type: string; role: string; vetId: string }[]
}

// ── Ce que Filou répond ──────────────────────────────────────

// ⚠️ AUCUNE LIMITE DE LONGUEUR NI DE CARDINALITÉ DANS CE SCHÉMA — et c'est une
// correction, pas un oubli (B-089, mesuré le 31/08).
//
// L'API n'accepte PAS les contraintes de longueur (`.max()`, `.min()`) ni les
// contraintes de cardinalité de tableau dans une sortie structurée : le SDK les
// RETIRE du schéma envoyé au modèle, puis les valide LUI-MÊME à la réception.
// Le modèle n'a donc jamais su qu'il y avait une limite — et quand il la
// dépassait, le SDK levait, et **toute la relecture était perdue**.
//
// Mesuré : sur Sonnet 5, une relecture complète et correcte a été jetée parce
// que la synthèse faisait plus de 320 caractères et que quatre `detail` —
// un champ FACULTATIF — dépassaient 400. Neuf constats justes détruits par une
// contrainte de mise en forme que le modèle ne pouvait pas connaître.
//
// C'est le défaut de B-062 retourné : le schéma écrit pour rendre le SILENCE
// impossible était devenu une cause de silence. « Filou n'a pas pu relire »
// s'affichait pour un texte trop long.
//
// La brièveté reste EXIGÉE — mais là où elle peut être obtenue : dans les
// `describe` ci-dessous, que le modèle lit. Et là où elle peut être garantie :
// à la normalisation, qui COUPE au lieu de rejeter. Une consigne de mise en
// forme ne doit jamais pouvoir détruire un contenu juste.
const AffectationSchema = z.object({
  date: z.string().describe('Date ISO yyyy-mm-dd de la place, exactement comme fournie.'),
  type: z.string().describe('Le code de créneau de la place, exactement comme fourni.'),
  role: z.string().describe('Le rôle de la place, exactement comme fourni.'),
  vetId: z
    .string()
    .nullable()
    .describe(
      "L'identifiant de la personne à mettre sur cette place, exactement comme fourni dans l'équipe. null pour vider la place.",
    ),
})

const ChangementSchema = z.object({
  motif: z
    .string()
    .describe(
      "Le POURQUOI, en français simple, adressé à l'administratrice du cabinet. Une à deux phrases. Elle doit pouvoir le répéter à l'équipe telle quelle. Jamais de code de règle, jamais de jargon.",
    ),
  critere: z
    .string()
    .describe(
      'La clé du critère visé, parmi celles fournies. Exactement telle qu’écrite entre crochets.',
    ),
  affectations: z
    .array(AffectationSchema)
    .describe(
      "Les places à modifier, toutes ensemble. Pourvoir une case vide = une seule affectation. Un échange entre deux personnes = DEUX affectations (chacune reçoit la place de l'autre). Un échange de rôles sur un week-end = QUATRE affectations, parce que le vendredi soir qui le précède doit suivre.",
    ),
})

// ⚠️ CE SCHÉMA REND LE SILENCE IMPOSSIBLE — c'est sa raison d'être.
//
// La première version autorisait `constats: []`. Le 27/08, sur les vraies
// données de Val d'Allier, Filou a rendu une relecture ENTIÈREMENT VIDE
// (synthèse vide, zéro constat, zéro proposition) et l'écran a affiché
// « Filou n'a rien à redire à ce planning » — sur un planning où Anne-Sophie
// faisait 8 gardes sans jamais être 1re du week-end, Antoine enchaînait un
// week-end puis le lundi et le mercredi, et deux cases restaient vides.
//
// Ce n'était pas un manque de données : la mesure a montré que tout était
// dans le dossier. C'était le PROMPT, qui décourageait de parler. Une consigne
// de retenue est suivie à la lettre, et le taux de détection s'effondre.
//
// La parade ne peut pas être une consigne de plus — c'est une consigne qui a
// causé le problème. Elle est STRUCTURELLE : le schéma exige une ligne PAR
// CRITÈRE, donc « ne rien dire » n'est plus une sortie valide. Filou doit se
// prononcer sur chacun, et écrire ce qu'il a regardé même quand tout va bien.
//
// C'est exactement le mécanisme que le produit applique déjà à `Filou suit le
// produit` et au `tableau ne peut pas se taire` : trois réponses admises, une
// seule interdite — le silence.
const RevueSchema = z.object({
  critere: z
    .string()
    .describe('La clé du critère, exactement telle qu’écrite entre crochets.'),
  verdict: z
    .enum(['probleme', 'a_surveiller', 'rien_a_signaler'])
    .describe(
      "probleme : l'équipe le refuserait ou le vivrait mal. a_surveiller : ça se discutera, ou c'est limite. rien_a_signaler : tu as regardé et c'est bon.",
    ),
  constat: z
    .string()
    .describe(
      "UNE SEULE PHRASE COURTE, 120 caractères maximum. Le prénom, le fait, le chiffre — rien d'autre. Exemples de la bonne longueur : « Anne-Sophie fait 1 week-end et n'est jamais première. » · « Antoine enchaîne 4 gardes du 2 au 7 octobre. » · « Manon n'a aucun week-end, mais elle est absente 3 semaines. » C'est la seule ligne que l'administratrice lira à coup sûr : tout ce qui n'y tient pas va dans `detail`.",
    ),
  detail: z
    .string()
    .optional()
    .describe(
      "Le reste : les dates précises, l'historique, la comparaison avec les autres. Facultatif — ne le remplis que s'il ajoute vraiment quelque chose. Ne répète JAMAIS la phrase du constat.",
    ),
  corrigeable: z
    .boolean()
    .describe(
      'true si tu proposes un changement pour celui-ci, false sinon. false est obligatoire quand le verdict est rien_a_signaler.',
    ),
})

/** Exporté pour que le garde-fou de B-089 puisse prouver qu'il n'y a plus de
 *  contrainte de longueur ici — sans quoi la régression ne se verrait qu'en
 *  production, sur un texte un peu trop long. */
export const SortieRelectureSchema = z.object({
  synthese: z
    .string()
    .describe(
      "DEUX PHRASES, pas plus. Ce que l'administratrice doit retenir si elle ne lit que ça : la ou les deux personnes dont la situation t'a le plus frappé, avec le chiffre. Pas d'énumération, pas de préambule.",
    ),
  revue: z
    .array(RevueSchema)
    .describe(
      'UNE ENTRÉE PAR CRITÈRE, tous les critères, sans exception et dans l’ordre où ils te sont donnés. Aucun critère ne peut être omis : si tu n’as rien trouvé sur l’un d’eux, dis-le explicitement avec rien_a_signaler et explique ce que tu as vérifié.',
    ),
  changements: z
    .array(ChangementSchema)
    .describe(
      'Les changements concrets que tu proposes. Un changement par problème que tu sais corriger.',
    ),
})

export type SortieRelecture = z.infer<typeof SortieRelectureSchema>

export interface ResultatRelecture {
  synthese: string
  revue: SortieRelecture['revue']
  changements: ChangementPropose[]
  /**
   * Les critères sur lesquels Filou ne s'est PAS prononcé, malgré la consigne.
   *
   * Remonté plutôt qu'absorbé : une revue incomplète ressemble en tout point à
   * une revue clean, et c'est exactement la confusion qui a produit le « Filou
   * n'a rien à redire » du 27/08. Si cette liste n'est pas vide, l'écran doit
   * le dire — le contraire serait la phrase rassurante que le produit bannit.
   */
  criteresNonTraites: string[]
  /**
   * Le nombre de lignes de revue rendues par Filou qu'on n'a PAS su rattacher
   * à un critère connu.
   *
   * Sans ce compteur, « 0 critère sur 9 » a deux causes indiscernables : il
   * n'a rien dit, ou il a parlé et nous avons tout jeté. Le 31/08, c'était la
   * seconde — et rien à l'écran ne permettait de le savoir.
   */
  entreesNonRattachees: number
  /**
   * Ce que l'appel a coûté, tel que l'API le rapporte. Rempli à chaque appel,
   * lu par le banc de mesure.
   *
   * ⚠️ `sortie` compte la RÉFLEXION **et** la réponse — l'API ne les sépare
   * pas. On ne peut donc pas dire « il a réfléchi N jetons » ; on peut dire
   * combien il en a produit en tout, ce qui est ce qui se paie et ce qui prend
   * le temps. Ne pas présenter ce chiffre comme un temps de réflexion isolé.
   */
  mesure: {
    modele: string
    effort: EffortRelecture
    entree: number
    sortie: number
    cacheEcrit: number
    cacheLu: number
  }
}

// ── Le prompt ────────────────────────────────────────────────

/**
 * Le prompt système. Exposé pour pouvoir en compter les tokens sans appel
 * facturé, comme les autres prompts du projet.
 *
 * ⚠️ Il ne contient NI date, NI horodatage, NI identifiant : il doit rester
 * identique à l'octet d'une relecture à l'autre pour que la mise en cache
 * serve. Tout ce qui varie passe par le message utilisateur.
 */
export function systemeRelecture(): string {
  return `Tu es Filou, l'assistant du cabinet vétérinaire. Aujourd'hui on te confie un rôle
particulier : tu relis un planning de gardes que le moteur vient de produire, et tu dis ce
que tu en penses.

QUI TU ES DANS CE RÔLE
Tu n'es pas un second moteur de calcul. Le moteur sait déjà compter des totaux, vérifier
des règles et optimiser un score — le refaire ne servirait à rien. Tu es l'associé
expérimenté qui relit le planning avant qu'il ne soit affiché en salle de pause, et qui
dit « attends, là tu épuises Antoine ». Ton regard est HUMAIN : le repos réel, la fatigue,
l'équilibre vécu, ce qui se dira dans l'équipe.

CE QUI EST DÉJÀ GARANTI, ET QUE TU N'AS PAS À VÉRIFIER
Le planning qu'on te montre respecte DÉJÀ toutes les règles dures du cabinet. Ne signale
pas une règle enfreinte : il n'y en a pas. Et ne perds pas ton temps à revérifier les
absences — elles te sont données, personne d'absent n'est de garde.

CE QU'ON TE DEMANDE DE REGARDER
${critereEnTexte()}

TU DOIS TE PRONONCER SUR CHAQUE CRITÈRE
C'est la règle la plus importante. Pour chacun des critères ci-dessus, sans exception, tu
rends une ligne : ce que tu as regardé, et ce que tu as trouvé. Un critère sur lequel tu
n'as rien à signaler se dit — « j'ai vérifié, voici pourquoi ça tient » — il ne se saute
pas. Ne filtre pas tes observations par importance : ton travail ici est la COUVERTURE.
Signale ce que tu vois, même ce dont tu n'es pas certain, en indiquant sa gravité — c'est
l'administratrice qui décidera de ce qui compte.

TU SAIS DÉJÀ CE QUI EST POSSIBLE — SERS-T'EN
Chaque place du planning est suivie de « peuvent aussi : … », la liste des personnes que le
moteur accepterait à cet endroit. Ce n'est pas une supposition, c'est une vérification déjà
faite : si un prénom y figure, l'y mettre respecte toutes les règles du cabinet.

Tu n'as donc rien à deviner. Dès qu'un problème que tu relèves peut se corriger avec ces
listes, PROPOSE le changement — ne le classe pas « sans correction possible » par prudence.
Un problème qui a une solution visible dans ces listes et que tu laisses sans proposition
est un travail à moitié fait.

Trois façons de t'en servir :
- Une place vide dont la liste n'est pas vide : propose quelqu'un, c'est immédiat.
- Quelqu'un de trop chargé sur une semaine : regarde ses gardes de cette semaine, et
  passe-en une à quelqu'un qui figure dans la liste de cette place.
- Un échange entre deux personnes : chacune doit figurer dans la liste de la place de
  l'autre. Si l'une n'y est pas, l'échange sera refusé — cherche ailleurs.

⚠️ LE VENDREDI SOIR ET LE WEEK-END NE SE SÉPARENT PAS
Ce sont les mêmes personnes, avec les rôles inversés : qui est premier le vendredi soir est
second le week-end, et inversement. Pour changer qui est premier au week-end, il faut donc
AUSSI changer le vendredi soir qui le précède — quatre places, pas deux. Une proposition qui
ne touche que le week-end sera refusée par le moteur.

TA MARGE DE MANŒUVRE
Chaque changement que tu proposes repassera devant le moteur, qui vérifiera qu'il ne casse
aucune règle. S'il est légal, il sera appliqué : tu as le dernier mot. S'il enfreint une
règle, il sera montré à l'administratrice avec ton motif et l'objection du moteur, et c'est
elle qui tranchera. Tu ne peux donc rien casser en proposant. Une proposition imparfaite
qui se fait refuser coûte une ligne de lecture ; un problème que tu passes sous silence
coûte des mois à quelqu'un de l'équipe.

COMMENT TU ÉCRIS — LA BRIÈVETÉ EST UNE EXIGENCE, PAS UN STYLE
Tu parles à l'administratrice du cabinet, pas à un développeur. Français simple, tutoiement,
prénoms des personnes, dates en toutes lettres. Jamais de code de règle, jamais de jargon,
jamais d'identifiant technique dans une phrase. Un chiffre à chaque affirmation : « Fanny
fait 2 week-ends et n'est jamais première » vaut mieux que « le rôle est mal réparti ».

Elle lit ça entre deux consultations. Un rapport qu'on n'a pas envie de lire ne sert à
personne, même quand tout ce qu'il dit est juste. Donc : une phrase courte par point, le
reste dans le champ « detail » qui restera replié. N'énumère pas toutes les dates quand deux
suffisent à faire comprendre. Ne récapitule pas ce que tu viens d'écrire.

CE QUI EST INTERDIT
- Rendre une revue incomplète : il faut une ligne par critère, toujours.
- Proposer quelqu'un d'absent, quelle que soit la raison.
- Inventer une personne, une date ou un créneau qui ne sont pas dans ce qu'on te donne.
- Affirmer sans le chiffre qui le prouve.
- Dire qu'un planning est bon quand il ne l'est pas, pour faire plaisir.

CE QUI DOIT T'ALERTER EN PRIORITÉ
Quelqu'un qui fait des week-ends sans jamais être premier. Quelqu'un qui enchaîne plusieurs
gardes en quelques jours pendant qu'un autre n'en a presque pas. Une place restée vide. Un
écart de charge que l'équipe remarquerait en regardant le planning affiché. Si l'un de ces
cas est présent dans ce qu'on te donne, il ne peut pas ressortir en « rien à signaler ».`
}

/** Met le dossier en forme pour le message utilisateur. */
export function dossierEnTexte(dossier: DossierRelecture): string {
  const lignes: string[] = []

  lignes.push(`PÉRIODE : ${dossier.periode} (${dossier.saison})`)
  if (dossier.roleAvantageFinancier) {
    lignes.push(
      `RÔLE QUI PORTE L'AVANTAGE FINANCIER : « ${dossier.roleAvantageFinancier} » du week-end.`,
    )
  }

  lignes.push('', "L'ÉQUIPE ET SES COMPTEURS")
  for (const p of dossier.equipe) {
    const g = p.gardesPeriode
    const parts = [
      `${p.prenom} (identifiant ${p.vetId})`,
      `cette période : ${g.total} garde${g.total > 1 ? 's' : ''}, dont ${g.weekends} week-end${g.weekends > 1 ? 's' : ''}, ${g.premierWeekend} fois premier du week-end`,
    ]
    if (p.historique) {
      parts.push(
        `historique cumulé : ${p.historique.total} gardes, ${p.historique.weekends} week-ends, ${p.historique.premierWeekend} fois premier`,
      )
    }
    if (p.absences.length > 0) parts.push(`absences : ${p.absences.join(' ; ')}`)
    if (p.regles.length > 0) parts.push(`ses règles : ${p.regles.join(' ; ')}`)
    lignes.push(`- ${parts.join(' — ')}`)
  }

  if (dossier.reglesCabinet.length > 0) {
    lignes.push('', 'LES RÈGLES DU CABINET (déjà respectées par ce planning)')
    for (const r of dossier.reglesCabinet) lignes.push(`- ${r}`)
  }

  lignes.push(
    '',
    'LE PLANNING, PLACE PAR PLACE',
    'Après chaque place, « peuvent aussi : … » liste les personnes que le moteur',
    'accepterait à cet endroit SANS RIEN DÉPLACER D’AUTRE. C’est une vérification',
    'déjà faite, pas une estimation : si un prénom y figure, l’y mettre respecte',
    'toutes les règles.',
    '',
    '⚠️ Une liste vide ne veut PAS dire « rien n’est possible ici ». Elle veut',
    'dire « personne ne peut prendre cette place sans qu’on bouge autre chose ».',
    'C’est le cas le plus fréquent : le planning que tu relis vient d’être',
    'optimisé, donc les places où l’on peut simplement poser quelqu’un d’autre',
    'n’améliorent rien. Ce qui reste à gagner est presque toujours un ÉCHANGE —',
    'et les échanges possibles te sont donnés plus bas, dans leur propre liste.',
  )
  for (const place of dossier.places) {
    const possibles =
      place.remplacants.length > 0
        ? `  → peuvent aussi : ${place.remplacants.join(', ')}`
        : '  → personne d’autre ne peut prendre cette place'
    lignes.push(
      `- ${place.jour} · ${place.creneau} · ${place.role} : ${place.prenom ?? '### PLACE VIDE ###'}` +
        `  [date=${place.date} type=${place.type} role=${place.role}]${possibles}`,
    )
  }

  const vides = dossier.places.filter((p) => !p.vetId).length
  lignes.push(
    '',
    vides > 0
      ? `Il reste ${vides} place${vides > 1 ? 's' : ''} à pourvoir. Regarde si l'une d'elles peut l'être.`
      : 'Toutes les places sont pourvues.',
  )

  // ── Les préférences que le planning n'a pas pu respecter ──
  lignes.push('', 'LES PRÉFÉRENCES DU CABINET QUE CE PLANNING ENFREINT')
  if (dossier.preferencesEnfreintes.length === 0) {
    lignes.push('Aucune. Toutes les préférences réglées par le cabinet sont respectées.')
  } else {
    lignes.push(
      `${dossier.preferencesEnfreintes.length}. Ce ne sont PAS des fautes : le cabinet`,
      'a réglé ces règles en « sauf en cas de crise » ou plus souple, le moteur',
      'avait donc le droit de les enfreindre pour tenir le reste.',
      '',
      'Mais elles comptent : c’est le cabinet qui les a écrites, et une préférence',
      'enfreinte plusieurs fois de suite sur la MÊME personne est exactement ce',
      'que l’équipe remarque. C’est le moteur qui les a repérées, pas toi — tu',
      'peux donc les citer telles quelles sans les recalculer.',
    )
    for (const p of dossier.preferencesEnfreintes) lignes.push(`- ${p}`)
  }

  // ── Les mouvements applicables ──
  lignes.push('', 'LES MOUVEMENTS QUE LE MOTEUR ACCEPTE')
  if (dossier.mouvements.length === 0) {
    lignes.push(
      'Aucun. Sur ce planning, aucun mouvement ne respecte toutes les règles —',
      'ici, cela veut bien dire qu’il n’y a rien à faire.',
    )
  } else {
    // Les AMÉLIORANTS d'abord : c'est là que Filou doit regarder en premier, et
    // un ordre quelconque le ferait piocher au hasard dans une liste où tout se
    // ressemble. Le tri n'est pas cosmétique, c'est la moitié de l'information.
    const rang = { ameliore: 0, egal: 1, degrade: 2 } as const
    const tries = [...dossier.mouvements].sort((a, b) => rang[a.effet] - rang[b.effet])
    const ameliorants = tries.filter((m) => m.effet === 'ameliore').length

    lignes.push(
      `${dossier.mouvements.length} mouvements ont été VÉRIFIÉS par le moteur : les`,
      'appliquer respecte toutes les règles. C’est ton principal levier — la',
      'plupart des déséquilibres ne se corrigent que comme ça.',
      '',
      'Chacun porte son EFFET, mesuré par le moteur sur le planning entier :',
      '  AMÉLIORE — le planning est meilleur après. Privilégie ceux-là.',
      '  ÉGAL     — légal, mais ne répare rien. À ne proposer que si tu corriges',
      '             quelque chose que le score ne mesure pas, et dis-le alors.',
      '  DÉGRADE  — légal, mais le planning est moins bon après. Ne le propose',
      '             que si tu assumes l’échange, et explique ce qu’on y gagne.',
      '',
      ameliorants > 0
        ? `${ameliorants} mouvement(s) AMÉLIORENT le planning. Commence par eux.`
        : 'Aucun mouvement n’améliore le planning au sens du moteur. Si tu en '
          + 'proposes un quand même, dis pourquoi il vaut mieux que le score.',
      '',
      '⚠️ ALLÉGER QUELQU’UN ET CHANGER SON RÔLE SONT DEUX CHOSES DIFFÉRENTES.',
      'Chaque mouvement dit, en toutes lettres, ce que chacun y gagne ou y perd :',
      '« libéré de N garde(s) », « prend N garde(s) de plus », ou « reste de',
      'garde autant qu’avant — seul son rôle change ». Ne le déduis pas des',
      'dates : c’est écrit, et c’est calculé, pas estimé.',
      '',
      'Un échange et une inversion de rôles ne diminuent la charge de PERSONNE :',
      'ils déplacent. Si quelqu’un est trop chargé, seul un mouvement où il est',
      '« libéré » l’allège vraiment. Proposer une inversion en annonçant qu’elle',
      'soulage quelqu’un serait faux, et l’administratrice te croira.',
      '',
      'Pour en proposer un, recopie TOUTES ses places telles qu’elles sont écrites.',
      'Un mouvement est un tout : en omettre une place le fait refuser.',
      ...(dossier.mouvementsEcartes > 0
        ? [
            '',
            `⚠️ ${dossier.mouvementsEcartes} autres mouvements légaux ne sont PAS listés ici :`,
            'la liste est bornée pour rester lisible. Les mouvements rares (ceux qui',
            'libèrent quelqu’un d’un week-end, ceux qui font tourner un rôle) y sont',
            'TOUS ; ce sont des échanges ordinaires qui ont été écartés. Donc si tu ne',
            'trouves pas de quoi corriger un point, dis « je n’ai pas trouvé », jamais',
            '« c’est impossible ».',
          ]
        : []),
    )

    for (const m of tries) {
      const effet = m.effet === 'ameliore' ? 'AMÉLIORE' : m.effet === 'degrade' ? 'DÉGRADE' : 'ÉGAL'
      lignes.push('', `- ${m.resume} → ${effet}${m.surQuoi ? ` (${m.surQuoi})` : ''}`)
      for (const l of m.lignes) lignes.push(`    ${l}`)
      for (const a of m.affectations) {
        lignes.push(`    [date=${a.date} type=${a.type} role=${a.role} vetId=${a.vetId}]`)
      }
    }
  }

  return lignes.join('\n')
}

// ── L'appel ──────────────────────────────────────────────────

/**
 * Demande à Filou de relire le planning.
 *
 * @throws si la clé API est absente, ou si le modèle ne rend rien d'exploitable.
 *         L'appelant DOIT transformer cette exception en « Filou n'a pas pu
 *         relire ce planning » — jamais en silence, jamais en « tout va bien ».
 *         Zone d'ombre 5, tranchée par MiKL le 27/08.
 */
export async function relirePlanningIA(
  dossier: DossierRelecture,
  options?: { modele?: string; effort?: EffortRelecture },
): Promise<ResultatRelecture> {
  if (!assistantIaDisponible()) {
    throw new Error('Assistant IA non configuré (clé API manquante).')
  }

  const client = new Anthropic({ apiKey: cleIA() })

  const modele = options?.modele ?? modeleRelecture()
  const effort = options?.effort ?? effortRelecture()

  // ⚠️ EN FLUX, ET CE N'EST PAS UN CONFORT — c'est ce que le budget impose.
  //
  // `messages.parse()` (non diffusé) est REFUSÉ par le SDK au-delà de 21 333
  // jetons de sortie, avant même de partir. `stream()` accepte exactement les
  // mêmes paramètres, sortie structurée comprise, et `finalMessage()` rend le
  // même objet avec son `parsed_output` : le reste du code ne change pas.
  //
  // Bénéfice au passage : la connexion ne reste plus muette pendant deux
  // minutes, ce qui était le vrai risque de coupure sur une longue relecture.
  const flux = client.messages.stream({
    model: modele,
    max_tokens: MAX_TOKENS_RELECTURE,
    thinking: { type: 'adaptive' },
    // Le prompt système est identique d'une relecture à l'autre : mis en cache,
    // il n'est refacturé qu'au dixième du prix. Tout ce qui varie (le planning
    // lui-même) est dans le message utilisateur, hors cache.
    system: [
      { type: 'text', text: systemeRelecture(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: dossierEnTexte(dossier) }],
    // ⚠️ `format` et `effort` vivent dans le MÊME objet : deux clés
    // `output_config` dans ce littéral, et la seconde écraserait la première
    // en silence — la sortie structurée disparaîtrait, ou l'application ne
    // serait jamais transmise, sans la moindre erreur pour le dire.
    // `effort` n'est ajouté que s'il est réglé : l'omettre laisse le défaut de
    // l'API (`high`), qui est le comportement d'aujourd'hui. Poser une valeur
    // « par prudence » changerait en silence ce que le banc doit mesurer.
    output_config: {
      format: zodOutputFormat(SortieRelectureSchema),
      ...(effort ? { effort } : {}),
    },
  })

  const response = await flux.finalMessage()

  const brut = response.parsed_output
  if (!brut) {
    // SONDE (27/08) — un « il n'a pas pu relire » sans cause est un mur.
    // `stop_reason` distingue les deux échecs possibles, qui appellent des
    // corrections opposées : `max_tokens` = la réponse a été COUPÉE (il faut
    // du budget, pas un autre modèle) ; `refusal` ou autre chose = le modèle
    // n'a pas voulu ou pas su répondre. Sans ce détail on corrige à l'aveugle.
    throw new Error(
      `Filou n'a pas pu structurer sa relecture (arrêt : ${response.stop_reason ?? 'inconnu'}, ` +
        `${response.usage?.output_tokens ?? '?'} tokens produits sur ${MAX_TOKENS_RELECTURE} autorisés).`,
    )
  }

  return {
    ...normaliserRelecture(brut, dossier),
    mesure: {
      modele,
      effort,
      entree: response.usage?.input_tokens ?? 0,
      sortie: response.usage?.output_tokens ?? 0,
      cacheEcrit: response.usage?.cache_creation_input_tokens ?? 0,
      cacheLu: response.usage?.cache_read_input_tokens ?? 0,
    },
  }
}

// ── Nettoyage de la réponse ──────────────────────────────────

const CLES_CRITERES = new Set(CRITERES_HUMAINS.map((c) => c.cle))

/**
 * Retrouve la clé d'un critère malgré une écriture approximative.
 *
 * ⚠️ MESURÉ LE 31/08 : Sonnet 5 à `medium` a rendu une synthèse juste et une
 * proposition… et **0 critère sur 9**. Une comparaison de clés stricte jetait
 * en SILENCE tout ce qui ne tombait pas à l'octet près.
 *
 * C'est la troisième fois que le même défaut se paie sur cette chaîne : on
 * refuse ce qu'on ne reconnaît pas, sans le dire. Une majuscule, un accent ou
 * un tiret au lieu d'un souligné suffisait à effacer un constat juste.
 *
 * Rattacher n'est PAS deviner : on compare des formes normalisées de la même
 * chaîne, jamais un sens. Ce qui ne se rattache pas est COMPTÉ et remonté —
 * voir `entreesNonRattachees`.
 */
function normaliserCle(brut: string): string {
  return brut
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const CLE_PAR_FORME = new Map(
  CRITERES_HUMAINS.map((c) => [normaliserCle(c.cle), c.cle]),
)

/** La clé officielle du critère, ou `null` si rien ne correspond. */
function rattacherCritere(brut: string): string | null {
  if (CLES_CRITERES.has(brut)) return brut
  return CLE_PAR_FORME.get(normaliserCle(brut)) ?? null
}

/**
 * Les longueurs voulues à l'écran. Elles ne sont PLUS des conditions de
 * validité (voir le bloc au-dessus du schéma) : ce sont des coupes.
 *
 * On coupe au dernier espace pour ne pas trancher un mot en deux, et on pose
 * « … » : l'admin voit qu'il manque quelque chose au lieu de lire une phrase
 * qui s'arrête net et paraît bâclée.
 */
const LONGUEURS = { synthese: 320, constat: 160, detail: 400 } as const

/** Nombre de propositions et de places retenues — au-delà, l'écran devient illisible. */
const PLAFONDS = { changements: 8, affectations: 6 } as const

function couper(texte: string, maximum: number): string {
  const propre = texte.trim()
  if (propre.length <= maximum) return propre
  const tronque = propre.slice(0, maximum - 1)
  const espace = tronque.lastIndexOf(' ')
  return `${(espace > maximum * 0.6 ? tronque.slice(0, espace) : tronque).trimEnd()}…`
}

/**
 * Met la réponse en forme et écarte ce qui ne tient pas debout.
 *
 * ⚠️ Ce filtre n'est pas de la défiance de principe : il attrape les erreurs
 * qui rendraient un changement INAPPLICABLE ou DANGEREUX, et lui seul peut le
 * faire — l'arbitrage moteur, en aval, refuserait bien une personne absente
 * (règle dure), mais il ne saurait pas distinguer « Filou s'est trompé
 * d'identifiant » de « le changement est illégal », et l'admin verrait un refus
 * incompréhensible.
 *
 * Ce qui est écarté ici est COMPTÉ et remonté à l'appelant : un silence
 * laisserait croire que Filou n'a rien proposé.
 */
export function normaliserRelecture(
  brut: SortieRelecture,
  dossier: DossierRelecture,
): Omit<ResultatRelecture, 'mesure'> {
  const idsConnus = new Set(dossier.equipe.map((p) => p.vetId))
  const placesConnues = new Set(
    dossier.places.map((p) => `${p.date}|${p.type}|${p.role}`),
  )

  const changements: ChangementPropose[] = []
  let n = 0

  for (const c of (brut.changements ?? []).slice(0, PLAFONDS.changements)) {
    // Une proposition sans aucune place à changer n'est pas applicable : elle
    // s'afficherait comme un geste vide. Elle est écartée ici, et comptée.
    if (c.affectations.length === 0) continue
    c.affectations = c.affectations.slice(0, PLAFONDS.affectations)
    // Une place inventée rendrait le changement inapplicable : l'arbitrage le
    // classerait « sans objet » et l'admin lirait une ligne vide de sens.
    const placesValides = c.affectations.every((a) =>
      placesConnues.has(`${a.date}|${a.type}|${a.role}`),
    )
    // Un identifiant inventé mettrait un fantôme sur une garde. Le validateur
    // ne connaît pas cette personne : il pourrait ne rien trouver à redire.
    const personnesValides = c.affectations.every(
      (a) => a.vetId === null || idsConnus.has(a.vetId),
    )
    if (!placesValides || !personnesValides) continue

    changements.push({
      id: `F${++n}`,
      motif: c.motif.trim(),
      critere: rattacherCritere(c.critere) ?? 'epuisement',
      affectations: c.affectations.map((a) => ({
        date: a.date, type: a.type, role: a.role, vetId: a.vetId,
      })),
    })
  }

  // La revue, dans l'ordre du catalogue — pas dans celui où Filou a répondu.
  // L'admin lit toujours les mêmes critères au même endroit d'une génération à
  // l'autre ; un ordre qui bouge se relit à chaque fois.
  const revueParCle = new Map<string, SortieRelecture['revue'][number]>()
  let entreesNonRattachees = 0
  for (const r of brut.revue ?? []) {
    const cle = rattacherCritere(r.critere)
    if (!cle) {
      // Compté, jamais avalé : c'est ce compteur qui dira, la prochaine fois,
      // si un « 0 critère sur 9 » veut dire « il n'a rien dit » ou « il a parlé
      // et nous n'avons pas su l'entendre ».
      entreesNonRattachees++
      continue
    }
    if (!revueParCle.has(cle)) {
      revueParCle.set(cle, {
        ...r,
        critere: cle,
        constat: couper(r.constat, LONGUEURS.constat),
        // Un détail qui répète le constat double la lecture pour rien.
        detail: r.detail?.trim() ? couper(r.detail, LONGUEURS.detail) : undefined,
      })
    }
  }

  const revue = CRITERES_HUMAINS.map((c) => revueParCle.get(c.cle)).filter(
    (r): r is SortieRelecture['revue'][number] => Boolean(r),
  )
  const criteresNonTraites = CRITERES_HUMAINS.filter(
    (c) => !revueParCle.has(c.cle),
  ).map((c) => c.titre)

  return {
    synthese: couper(brut.synthese, LONGUEURS.synthese),
    revue,
    changements,
    criteresNonTraites,
    entreesNonRattachees,
  }
}
