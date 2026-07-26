// ============================================================
// GUARDVETO — Banc d'essai : combien coûte Filou, et quel modèle suffit ?
// ============================================================
// SERVER-ONLY, et FACTURÉ : chaque exécution fait de vrais appels à l'API.
//
// La question à laquelle il répond, chiffres en main : le moteur de Filou tourne
// sur le palier le plus cher du catalogue (Opus, 5 $ / 25 $ le million de
// tokens) alors que sa tâche — traduire une phrase en règle structurée — est
// peut-être à la portée de Haiku (1 $ / 5 $). Un facteur 5 sur une appli dont
// l'abonnement doit rester accessible, ça se vérifie au lieu de se supposer.
//
// Deux mesures :
//   1. le POIDS du prompt (comptage exact, non facturé) → le coût plancher de
//      chaque demande, avant même la réponse ;
//   2. la QUALITÉ et le COÛT RÉEL de chaque palier sur les mêmes phrases, les
//      dollars étant calculés depuis `usage` — pas depuis une règle de trois.
//
// Une des phrases est volontairement INFAISABLE : un modèle qui invente une
// règle plutôt que d'avouer son ignorance est disqualifié, quel que soit son
// prix. Sur un logiciel de planning de gardes, une règle inventée est pire
// qu'une question sans réponse.
//
// Le banc AFFICHE, il ne tranche pas — la décision de modèle est celle de MiKL.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { SortieIaSchema, normaliserProposition } from './regleSchema'
import { construireSystemIA, modeleIA } from './proposerRegle'
import type { ContexteIA } from './contexteCabinet'

/** Tarifs publics, en dollars par MILLION de tokens (relevés le 2026-07-26).
 *  À revérifier avant toute décision : ils bougent, et Sonnet 5 est en tarif
 *  d'introduction jusqu'au 2026-08-31 (2 $ / 10 $ au lieu de 3 $ / 15 $). */
export const PALIERS = [
  { modele: 'claude-opus-4-8', nom: 'Opus 4.8', entree: 5, sortie: 25, actuel: true, adaptatif: true },
  { modele: 'claude-sonnet-5', nom: 'Sonnet 5', entree: 3, sortie: 15, actuel: false, adaptatif: true },
  // Haiku 4.5 REFUSE le raisonnement adaptatif (« adaptive thinking is not
  // supported on this model ») : il tourne donc sans raisonnement étendu. C'est
  // sa configuration normale, et la comparaison reste juste — on mesure ce que
  // chaque palier sait faire au mieux, pas une configuration uniforme qu'un
  // seul d'entre eux accepte.
  { modele: 'claude-haiku-4-5', nom: 'Haiku 4.5', entree: 1, sortie: 5, actuel: false, adaptatif: false },
] as const

/** Prix d'un token selon d'où il vient : écrire le cache coûte 1,25×, le relire
 *  0,1×. Ignorer cette distinction ferait passer le cache pour inutile. */
const MULT_ECRITURE_CACHE = 1.25
const MULT_LECTURE_CACHE = 0.1

interface PhraseEpreuve {
  texte: string
  /** Type de règle attendu ; `null` = la demande DOIT être refusée. */
  attendu: string | null
  quoi: string
}

/**
 * Les phrases d'épreuve, CONSTRUITES À PARTIR DU CONTEXTE RÉEL du cabinet.
 *
 * La première version jugeait sur des réponses figées, et pénalisait les
 * modèles quand ils avaient raison : « un junior n'est jamais seul de garde »
 * était comptée fausse alors qu'aucune étiquette « junior » n'existe dans le
 * cabinet — refuser était la BONNE réponse, et le prompt le leur demande
 * explicitement. Un banc qui sanctionne la bonne réponse ne mesure rien.
 */
export function phrasesEpreuve(ctx: ContexteIA): PhraseEpreuve[] {
  const prenom = ctx.vets[0]?.prenom ?? 'Manon'
  const autre = ctx.vets[1]?.prenom ?? 'Antoine'
  const tag = ctx.tagsEquipe[0] ?? null

  return [
    {
      texte: `${prenom} ne fait jamais de garde le mercredi`,
      attendu: 'interdire_creneau',
      quoi: 'Interdiction simple',
    },
    {
      texte: `Au moins 3 jours entre deux gardes pour ${autre}`,
      attendu: 'espacement_min',
      quoi: 'Espacement (piège : ce n’est pas un plafond)',
    },
    tag
      ? {
          texte: `Un ${tag} n’est jamais seul de garde`,
          attendu: 'composition_equipe',
          quoi: `Règle d’équipe (étiquette « ${tag} », réellement posée)`,
        }
      : {
          // Aucune étiquette dans ce cabinet : la bonne réponse est de refuser
          // en expliquant qu'il faut d'abord les poser sur les fiches.
          texte: 'Un junior n’est jamais seul de garde',
          attendu: null,
          quoi: 'Étiquette INEXISTANTE — doit être refusé (aucune étiquette posée)',
        },
    {
      texte: 'Il faudrait repeindre la salle d’attente en bleu',
      attendu: null,
      quoi: 'Hors sujet — doit être REFUSÉ',
    },
  ]
}

/**
 * JEU COMPLET — une demande par type de règle, plus les pièges de
 * désambiguïsation que le catalogue prend soin d'écarter.
 *
 * C'est le FILET DE SÉCURITÉ pour toucher au prompt : le jeu rapide n'exerce
 * que 3 types sur 19, donc un catalogue raccourci pourrait casser les 16 autres
 * sans que rien ne le signale. Ici, une régression se voit.
 *
 * Les étiquettes : trois types (composition_equipe, role_interdit_tag,
 * equilibrer) n'ont de sens que si le cabinet en a posé. Quand ce n'est pas le
 * cas, le contexte est ENRICHI de « junior » / « senior » — sans quoi la bonne
 * réponse serait un refus et ces types resteraient intestés.
 */
export function phrasesCompletes(ctx: ContexteIA): PhraseEpreuve[] {
  const a = ctx.vets[0]?.prenom ?? 'Manon'
  const b = ctx.vets[1]?.prenom ?? 'Victor'
  const c = ctx.vets[2]?.prenom ?? 'Antoine'
  const tag = ctx.tagsEquipe[0] ?? 'junior'

  return [
    { texte: `${a} ne fait jamais de garde le mercredi`, attendu: 'interdire_creneau', quoi: '1 · Interdiction d’un jour' },
    { texte: `${a} est en repos le lundi si elle a fait le week-end, sinon le mardi`, attendu: 'repos_conditionnel', quoi: '2 · Repos conditionnel' },
    { texte: `${b} est indisponible les soirs de semaine une semaine sur deux, les semaines paires`, attendu: 'alternance_ancre', quoi: '3 · Alternance ancrée' },
    { texte: `${a} et ${b} ne doivent jamais être de garde seuls tous les deux`, attendu: 'duo_interdit', quoi: '4 · Duo interdit' },
    { texte: `${c} fait au plus 2 week-ends par mois`, attendu: 'au_plus_n', quoi: '5 · Plafond (piège : pas une fréquence)' },
    { texte: `Au moins 3 jours entre deux gardes pour ${c}`, attendu: 'espacement_min', quoi: '6 · Espacement minimum' },
    { texte: `${a} veut au moins 2 jours de repos entre ses gardes`, attendu: 'espacement_min', quoi: '6 bis · « repos entre gardes » = espacement' },
    { texte: `${b} ne prend qu’un week-end sur trois`, attendu: 'espacement_weekend', quoi: '7 · Fréquence de week-ends' },
    { texte: `Un ${tag} n’est jamais seul de garde`, attendu: 'composition_equipe', quoi: '8 · Composition d’équipe' },
    { texte: `Un ${tag} n’est jamais 1er de garde`, attendu: 'role_interdit_tag', quoi: '9 · Rôle interdit par étiquette' },
    { texte: `${a} préfère être de garde le mardi`, attendu: 'preferer_creneau', quoi: '10 · Préférence de créneau' },
    { texte: `${c} préfère être de garde avec ${b}`, attendu: 'preferer_avec', quoi: '11 · Préférence de binôme (souple)' },
    { texte: `${b} souhaite faire plus de gardes que les autres`, attendu: 'volume_gardes', quoi: '12 · Volume de gardes' },
    { texte: 'Pas de garde de semaine juste après un week-end', attendu: 'succession_interdite', quoi: '13 · Succession interdite' },
    { texte: `Jamais plus de 3 jours de garde d’affilée pour ${a}`, attendu: 'serie_max', quoi: '14 · Série maximale' },
    { texte: `Après 2 jours de garde d’affilée, ${c} doit avoir 2 jours sans garde`, attendu: 'repos_apres_serie', quoi: '15 · Repos après série' },
    { texte: `${b} est pompier volontaire : il est pris un week-end sur trois à partir du samedi 5 septembre 2026`, attendu: 'cadencement_weekend', quoi: '16 · Cadencement ancré (piège : pas le type 7)' },
    { texte: `${a} ne veut pas faire Noël et le Nouvel An la même année`, attendu: 'exclusion_dates', quoi: '17 · Exclusion « pas les deux »' },
    { texte: `Répartis équitablement les week-ends entre les ${tag}s`, attendu: 'equilibrer', quoi: '18 · Équité par cohorte' },
    { texte: `${c} n’est de garde que si ${b} est de garde avec lui`, attendu: 'seulement_avec', quoi: '19 · Garde conditionnelle (piège : pas le type 11)' },
    { texte: 'Il faudrait repeindre la salle d’attente en bleu', attendu: null, quoi: 'Hors sujet — doit être REFUSÉ' },
  ]
}

/** Le contexte utilisé par le jeu complet : les étiquettes sont ajoutées si le
 *  cabinet n'en a pas, sinon trois types resteraient intestés. */
export function contextePourJeuComplet(ctx: ContexteIA): ContexteIA {
  if (ctx.tagsEquipe.length > 0) return ctx
  return { ...ctx, tagsEquipe: ['junior', 'senior'] }
}

export interface LigneBanc {
  modele: string
  nomModele: string
  phrase: string
  quoi: string
  /** Type de règle proposé, `null` si la demande a été refusée. */
  brique: string | null
  /** A trouvé la bonne règle, OU a correctement refusé l'infaisable. */
  juste: boolean
  /** Ce que Filou a répondu — pour juger le TON, pas seulement l'exactitude. */
  message: string
  /** Tokens d'entrée facturés PLEIN TARIF (ni écrits ni relus au cache). */
  tokensEntree: number
  /** Tokens écrits dans le cache (facturés 1,25×) — première demande seulement. */
  tokensCacheEcrits: number
  /** Tokens relus depuis le cache (facturés 0,1×) — le gain. */
  tokensCacheLus: number
  tokensSortie: number
  dollars: number
  /** Ce que la même demande aurait coûté SANS cache — pour voir l'écart. */
  dollarsSansCache: number
  ms: number
  /** Message d'erreur si CET appel a échoué. Une panne sur un modèle ne doit
   *  pas emporter la mesure des deux autres : c'est justement en comparant
   *  qui passe et qui échoue qu'on apprend quelque chose. */
  erreur?: string
}

export interface PoidsPrompt {
  modele: string
  nomModele: string
  tokens: number
  /** Coût de la seule entrée, par demande. */
  dollarsEntree: number
  erreur?: string
}

export interface ResumeModele {
  modele: string
  nomModele: string
  actuel: boolean
  justes: number
  total: number
  dollarsMoyen: number
  /** Moyenne si le cache n'existait pas — la colonne « avant ». */
  dollarsMoyenSansCache: number
  msMoyen: number
  /** Vrai si ce palier n'a pas pu être mesuré du tout (appels en erreur). */
  enEchec: boolean
}

export interface ResultatBanc {
  poids: PoidsPrompt[]
  lignes: LigneBanc[]
  resume: ResumeModele[]
  /** Ce que cette exécution vient de coûter, réellement. */
  dollarsDepenses: number
  /** Taille du prompt en caractères — utile pour comprendre d'où vient le coût. */
  caracteresPrompt: number
}

/**
 * Lance le banc. Séquentiel à dessein : ces appels coûtent de l'argent, et une
 * rafale parallèle sur trois modèles risquerait un 429 qui fausserait les
 * latences mesurées.
 */
export interface OptionsBanc {
  /** `rapide` : 4 phrases × 3 paliers, pour comparer les modèles.
   *  `complet` : une demande par type de règle sur UN SEUL palier, pour vérifier
   *  qu'une modification du prompt n'a rien cassé. */
  jeu?: 'rapide' | 'complet'
  /** Restreint la mesure à ces modèles (le jeu complet n'en teste qu'un). */
  modeles?: string[]
}

export async function lancerBancEssai(
  ctx: ContexteIA,
  options: OptionsBanc = {},
): Promise<ResultatBanc> {
  const complet = options.jeu === 'complet'
  const client = new Anthropic()

  // Le jeu complet enrichit le contexte d'étiquettes si le cabinet n'en a pas,
  // sinon trois types de règles resteraient intestés.
  const ctxUtilise = complet ? contextePourJeuComplet(ctx) : ctx
  const system = construireSystemIA(
    ctxUtilise.vets,
    ctxUtilise.typesCreneaux,
    ctxUtilise.tagsEquipe,
    ctxUtilise.rolesCabinet,
  )
  const phrases = complet ? phrasesCompletes(ctxUtilise) : phrasesEpreuve(ctxUtilise)
  const paliers = options.modeles?.length
    ? PALIERS.filter((p) => options.modeles!.includes(p.modele))
    : complet
      ? // Par défaut, le jeu complet tourne sur le modèle du produit : on
        // vérifie le prompt, pas les paliers.
        PALIERS.filter((p) => p.modele === modeleIA())
      : PALIERS
  // Le prompt est mis en cache comme en production : sans ça, le banc mesurerait
  // un coût que le produit ne paie plus.
  const systemAvecCache = [
    { type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } },
  ]

  // ── 1. Le poids du prompt (comptage exact, non facturé) ──
  const poids: PoidsPrompt[] = []
  for (const p of paliers) {
    try {
      const { input_tokens } = await client.messages.countTokens({
        model: p.modele,
        system,
        messages: [{ role: 'user', content: phrases[0].texte }],
      })
      poids.push({
        modele: p.modele,
        nomModele: p.nom,
        tokens: input_tokens,
        dollarsEntree: (input_tokens * p.entree) / 1_000_000,
      })
    } catch (e) {
      poids.push({
        modele: p.modele,
        nomModele: p.nom,
        tokens: 0,
        dollarsEntree: 0,
        erreur: e instanceof Error ? e.message : 'erreur inconnue',
      })
    }
  }

  // ── 2. Qualité et coût réel, palier par palier ──
  const lignes: LigneBanc[] = []
  for (const p of paliers) {
    for (const phrase of phrases) {
      const t0 = Date.now()
      try {
      const reponse = await client.messages.parse({
        model: p.modele,
        max_tokens: 4000,
        // Haiku 4.5 rejette le raisonnement adaptatif : on le lui épargne
        // plutôt que de compter comme un échec ce qui est une incompatibilité.
        ...(p.adaptatif ? { thinking: { type: 'adaptive' as const } } : {}),
        system: systemAvecCache,
        messages: [{ role: 'user', content: phrase.texte }],
        output_config: { format: zodOutputFormat(SortieIaSchema) },
      })
      const ms = Date.now() - t0
      const prop = reponse.parsed_output ? normaliserProposition(reponse.parsed_output) : null
      const u = reponse.usage
      const plein = u.input_tokens
      const ecrits = u.cache_creation_input_tokens ?? 0
      const lus = u.cache_read_input_tokens ?? 0

      // Chaque origine a son tarif. Additionner les trois au prix fort ferait
      // disparaître le gain du cache dans le calcul.
      const dollars =
        (plein * p.entree +
          ecrits * p.entree * MULT_ECRITURE_CACHE +
          lus * p.entree * MULT_LECTURE_CACHE +
          u.output_tokens * p.sortie) /
        1_000_000
      const dollarsSansCache =
        ((plein + ecrits + lus) * p.entree + u.output_tokens * p.sortie) / 1_000_000

      const brique = prop?.faisable ? (prop.brique_id ?? null) : null
      lignes.push({
        modele: p.modele,
        nomModele: p.nom,
        phrase: phrase.texte,
        quoi: phrase.quoi,
        brique,
        juste: phrase.attendu === null ? !prop?.faisable : brique === phrase.attendu,
        message: prop?.message ?? '(aucune réponse structurée)',
        tokensEntree: plein,
        tokensCacheEcrits: ecrits,
        tokensCacheLus: lus,
        tokensSortie: u.output_tokens,
        dollars,
        dollarsSansCache,
        ms,
      })
      } catch (e) {
        // On enregistre l'échec comme un résultat à part entière : « Haiku
        // refuse ce schéma » est une information, pas une panne du banc.
        lignes.push({
          modele: p.modele,
          nomModele: p.nom,
          phrase: phrase.texte,
          quoi: phrase.quoi,
          brique: null,
          juste: false,
          message: '',
          tokensEntree: 0,
          tokensCacheEcrits: 0,
          tokensCacheLus: 0,
          tokensSortie: 0,
          dollars: 0,
          dollarsSansCache: 0,
          ms: Date.now() - t0,
          erreur: e instanceof Error ? e.message : 'erreur inconnue',
        })
      }
    }
  }

  const resume: ResumeModele[] = paliers.map((p) => {
    const r = lignes.filter((l) => l.modele === p.modele)
    return {
      modele: p.modele,
      nomModele: p.nom,
      actuel: p.actuel,
      justes: r.filter((l) => l.juste).length,
      total: r.length,
      dollarsMoyen: r.reduce((s, l) => s + l.dollars, 0) / r.length,
      dollarsMoyenSansCache: r.reduce((s, l) => s + l.dollarsSansCache, 0) / r.length,
      msMoyen: Math.round(r.reduce((s, l) => s + l.ms, 0) / r.length),
      enEchec: r.every((l) => l.erreur),
    }
  })

  return {
    poids,
    lignes,
    resume,
    dollarsDepenses: lignes.reduce((s, l) => s + l.dollars, 0),
    caracteresPrompt: system.length,
  }
}
