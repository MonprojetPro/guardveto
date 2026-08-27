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
// ── MODÈLE : OPUS, ASSUMÉ ───────────────────────────────────────────────────
//
// Décision de MiKL le 27/08 : « je suis pour utiliser Opus direct car comme tu
// le dis ça ne sera pas un grand usage ». Une génération, c'est 4 fois par an
// et par cabinet — le raisonnement d'ensemble sur 12 semaines vaut le palier le
// plus capable. Réglable par `GUARDVETO_IA_MODELE_RELECTURE` pour pouvoir
// mesurer un autre palier sans redéployer, comme le reste du produit.
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
  return process.env.GUARDVETO_IA_MODELE_RELECTURE?.trim() || 'claude-opus-4-8'
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
 * 16 000 est le plafond recommandé pour un appel NON diffusé : au-delà, c'est
 * la connexion HTTP qui devient le risque, et il faudrait passer la relecture
 * en flux — un autre chantier.
 */
const MAX_TOKENS_RELECTURE = 16000

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
  /** Le rôle qui porte l'avantage financier, s'il est configuré. */
  roleAvantageFinancier: string | null
}

// ── Ce que Filou répond ──────────────────────────────────────

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
    .min(1)
    .max(6)
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
    .max(120)
    .describe(
      "UNE SEULE PHRASE COURTE, 120 caractères maximum. Le prénom, le fait, le chiffre — rien d'autre. Exemples de la bonne longueur : « Anne-Sophie fait 1 week-end et n'est jamais première. » · « Antoine enchaîne 4 gardes du 2 au 7 octobre. » · « Manon n'a aucun week-end, mais elle est absente 3 semaines. » C'est la seule ligne que l'administratrice lira à coup sûr : tout ce qui n'y tient pas va dans `detail`.",
    ),
  detail: z
    .string()
    .max(400)
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

const SortieRelectureSchema = z.object({
  synthese: z
    .string()
    .min(40)
    .max(320)
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
    .max(8)
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
    'accepterait à cet endroit. C’est une vérification déjà faite, pas une',
    'estimation : si un prénom y figure, l’y mettre respecte toutes les règles.',
    'Si la liste est vide, personne d’autre ne peut prendre cette place.',
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
): Promise<ResultatRelecture> {
  if (!assistantIaDisponible()) {
    throw new Error('Assistant IA non configuré (clé API manquante).')
  }

  const client = new Anthropic({ apiKey: cleIA() })

  const response = await client.messages.parse({
    model: modeleRelecture(),
    max_tokens: MAX_TOKENS_RELECTURE,
    thinking: { type: 'adaptive' },
    // Le prompt système est identique d'une relecture à l'autre : mis en cache,
    // il n'est refacturé qu'au dixième du prix. Tout ce qui varie (le planning
    // lui-même) est dans le message utilisateur, hors cache.
    system: [
      { type: 'text', text: systemeRelecture(), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: dossierEnTexte(dossier) }],
    output_config: { format: zodOutputFormat(SortieRelectureSchema) },
  })

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

  return normaliserRelecture(brut, dossier)
}

// ── Nettoyage de la réponse ──────────────────────────────────

const CLES_CRITERES = new Set(CRITERES_HUMAINS.map((c) => c.cle))

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
): ResultatRelecture {
  const idsConnus = new Set(dossier.equipe.map((p) => p.vetId))
  const placesConnues = new Set(
    dossier.places.map((p) => `${p.date}|${p.type}|${p.role}`),
  )

  const changements: ChangementPropose[] = []
  let n = 0

  for (const c of brut.changements ?? []) {
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
      critere: CLES_CRITERES.has(c.critere) ? c.critere : 'epuisement',
      affectations: c.affectations.map((a) => ({
        date: a.date, type: a.type, role: a.role, vetId: a.vetId,
      })),
    })
  }

  // La revue, dans l'ordre du catalogue — pas dans celui où Filou a répondu.
  // L'admin lit toujours les mêmes critères au même endroit d'une génération à
  // l'autre ; un ordre qui bouge se relit à chaque fois.
  const revueParCle = new Map<string, SortieRelecture['revue'][number]>()
  for (const r of brut.revue ?? []) {
    if (!CLES_CRITERES.has(r.critere)) continue
    if (!revueParCle.has(r.critere)) {
      revueParCle.set(r.critere, {
        ...r,
        constat: r.constat.trim(),
        // Un détail qui répète le constat double la lecture pour rien.
        detail: r.detail?.trim() || undefined,
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
    synthese: brut.synthese.trim(),
    revue,
    changements,
    criteresNonTraites,
  }
}
