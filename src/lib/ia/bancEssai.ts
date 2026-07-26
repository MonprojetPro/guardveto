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
import { construireSystemIA } from './proposerRegle'
import type { ContexteIA } from './contexteCabinet'

/** Tarifs publics, en dollars par MILLION de tokens (relevés le 2026-07-26).
 *  À revérifier avant toute décision : ils bougent, et Sonnet 5 est en tarif
 *  d'introduction jusqu'au 2026-08-31 (2 $ / 10 $ au lieu de 3 $ / 15 $). */
export const PALIERS = [
  { modele: 'claude-opus-4-8', nom: 'Opus 4.8', entree: 5, sortie: 25, actuel: true },
  { modele: 'claude-sonnet-5', nom: 'Sonnet 5', entree: 3, sortie: 15, actuel: false },
  { modele: 'claude-haiku-4-5', nom: 'Haiku 4.5', entree: 1, sortie: 5, actuel: false },
] as const

/** Les phrases d'épreuve. `attendu: null` = la demande NE DOIT PAS produire de
 *  règle ; le bon comportement est de refuser proprement. */
export const PHRASES_EPREUVE = [
  {
    texte: 'Manon ne fait jamais de garde le mercredi',
    attendu: 'interdire_creneau',
    quoi: 'Interdiction simple',
  },
  {
    texte: 'Au moins 3 jours entre deux gardes pour Antoine',
    attendu: 'espacement_min',
    quoi: 'Espacement (piège : ce n’est pas un plafond)',
  },
  {
    texte: 'Un junior n’est jamais seul de garde',
    attendu: 'composition_equipe',
    quoi: 'Règle d’équipe par étiquette',
  },
  {
    texte: 'Il faudrait repeindre la salle d’attente en bleu',
    attendu: null,
    quoi: 'Hors sujet — doit être REFUSÉ',
  },
] as const

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
  tokensEntree: number
  tokensSortie: number
  dollars: number
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
  msMoyen: number
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
export async function lancerBancEssai(ctx: ContexteIA): Promise<ResultatBanc> {
  const client = new Anthropic()
  const system = construireSystemIA(
    ctx.vets,
    ctx.typesCreneaux,
    ctx.tagsEquipe,
    ctx.rolesCabinet,
  )

  // ── 1. Le poids du prompt (comptage exact, non facturé) ──
  const poids: PoidsPrompt[] = []
  for (const p of PALIERS) {
    try {
      const { input_tokens } = await client.messages.countTokens({
        model: p.modele,
        system,
        messages: [{ role: 'user', content: PHRASES_EPREUVE[0].texte }],
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
  for (const p of PALIERS) {
    for (const phrase of PHRASES_EPREUVE) {
      const t0 = Date.now()
      try {
      const reponse = await client.messages.parse({
        model: p.modele,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system,
        messages: [{ role: 'user', content: phrase.texte }],
        output_config: { format: zodOutputFormat(SortieIaSchema) },
      })
      const ms = Date.now() - t0
      const prop = reponse.parsed_output ? normaliserProposition(reponse.parsed_output) : null
      const u = reponse.usage
      // Le cache compte comme de l'entrée : l'ignorer sous-estimerait la facture.
      const tokensEntree =
        u.input_tokens +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0)

      const brique = prop?.faisable ? (prop.brique_id ?? null) : null
      lignes.push({
        modele: p.modele,
        nomModele: p.nom,
        phrase: phrase.texte,
        quoi: phrase.quoi,
        brique,
        juste: phrase.attendu === null ? !prop?.faisable : brique === phrase.attendu,
        message: prop?.message ?? '(aucune réponse structurée)',
        tokensEntree,
        tokensSortie: u.output_tokens,
        dollars: (tokensEntree * p.entree + u.output_tokens * p.sortie) / 1_000_000,
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
          tokensSortie: 0,
          dollars: 0,
          ms: Date.now() - t0,
          erreur: e instanceof Error ? e.message : 'erreur inconnue',
        })
      }
    }
  }

  const resume: ResumeModele[] = PALIERS.map((p) => {
    const r = lignes.filter((l) => l.modele === p.modele)
    return {
      modele: p.modele,
      nomModele: p.nom,
      actuel: p.actuel,
      justes: r.filter((l) => l.juste).length,
      total: r.length,
      dollarsMoyen: r.reduce((s, l) => s + l.dollars, 0) / r.length,
      msMoyen: Math.round(r.reduce((s, l) => s + l.ms, 0) / r.length),
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
