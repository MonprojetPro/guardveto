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
    .max(4)
    .describe(
      "Les places à modifier, toutes ensemble. Un échange entre deux personnes = DEUX affectations (chacune reçoit l'autre). Pourvoir une case vide = une seule.",
    ),
})

const ConstatSchema = z.object({
  critere: z.string().describe('La clé du critère concerné, parmi celles fournies.'),
  gravite: z
    .enum(['bloquant', 'notable', 'mineur'])
    .describe(
      "bloquant : l'équipe le refuserait. notable : ça se discutera. mineur : à savoir, sans plus.",
    ),
  constat: z
    .string()
    .describe(
      "Ce qui cloche, en français simple, avec le CHIFFRE qui le prouve et le PRÉNOM concerné. Jamais « il y a un déséquilibre » : dis lequel, chez qui, de combien.",
    ),
  corrigeable: z
    .boolean()
    .describe(
      'true si tu proposes un changement pour celui-ci, false si tu le signales sans savoir le corriger.',
    ),
})

const SortieRelectureSchema = z.object({
  synthese: z
    .string()
    .describe(
      "Deux à quatre phrases : ton impression d'ensemble sur ce planning, comme si tu l'annonçais à l'équipe. Honnête — si le planning est bon, dis-le simplement.",
    ),
  constats: z
    .array(ConstatSchema)
    .max(12)
    .describe('Ce qui cloche. Vide si le planning ne te pose aucun problème.'),
  changements: z
    .array(ChangementSchema)
    .max(8)
    .describe(
      'Les changements concrets que tu proposes. Vide si tu n’as rien à proposer. Ne propose JAMAIS un changement dont tu n’es pas sûr qu’il améliore la situation d’une personne réelle.',
    ),
})

export type SortieRelecture = z.infer<typeof SortieRelectureSchema>

export interface ResultatRelecture {
  synthese: string
  constats: SortieRelecture['constats']
  changements: ChangementPropose[]
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

TA MARGE DE MANŒUVRE
Chaque changement que tu proposes repassera devant le moteur, qui vérifiera qu'il ne
casse aucune règle. S'il est légal, il sera appliqué : tu as le dernier mot. S'il enfreint
une règle, il sera montré à l'administratrice avec ton motif et l'objection du moteur, et
c'est elle qui tranchera. Tu ne peux donc rien casser — mais chaque proposition mal pesée
lui coûte du temps de lecture. Ne propose que ce dont tu es sûr.

COMMENT TU ÉCRIS
Tu parles à l'administratrice du cabinet, pas à un développeur. Français simple, tutoiement,
prénoms des personnes, dates en toutes lettres. Jamais de code de règle, jamais de jargon,
jamais d'identifiant technique dans une phrase. Un chiffre à chaque affirmation : « Fanny
fait 2 week-ends et n'est jamais première » vaut mieux que « le rôle est mal réparti ».

CE QUI EST INTERDIT
- Proposer quelqu'un d'absent, quelle que soit la raison.
- Inventer une personne, une date ou un créneau qui ne sont pas dans ce qu'on te donne.
- Signaler un problème sans le chiffre qui le prouve.
- Dire qu'un planning est bon quand il ne l'est pas, pour faire plaisir.
- Proposer un changement « pour voir » : chacun doit améliorer la situation de quelqu'un.

SI LE PLANNING EST BON
Dis-le, franchement, et ne propose rien. Un planning sans reproche est un résultat, pas un
échec de ta part. Chercher un défaut pour justifier ta présence est exactement ce qu'on ne
veut pas.`
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

  lignes.push('', 'LE PLANNING, PLACE PAR PLACE')
  for (const place of dossier.places) {
    lignes.push(
      `- ${place.jour} · ${place.creneau} · ${place.role} : ${place.prenom ?? '### PLACE VIDE ###'}` +
        `  [date=${place.date} type=${place.type} role=${place.role}]`,
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
    max_tokens: 8000,
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
    throw new Error("Filou n'a pas pu structurer sa relecture.")
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

  return {
    synthese: brut.synthese.trim(),
    constats: (brut.constats ?? []).map((c) => ({
      ...c,
      critere: CLES_CRITERES.has(c.critere) ? c.critere : 'epuisement',
      constat: c.constat.trim(),
    })),
    changements,
  }
}
