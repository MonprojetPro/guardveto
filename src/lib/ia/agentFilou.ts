// ============================================================
// GUARDVETO — La boucle de Filou : il lit, il recoupe, il propose
// ============================================================
// SERVER-ONLY. Jusqu'ici Filou n'avait qu'une chose à faire d'une phrase : la
// traduire en règle. Ici il reçoit un CATALOGUE D'OUTILS et décide lui-même
// lesquels appeler. C'est ce qui lui permet de répondre « aucune règle ne
// l'empêche, mais elle est en dernier recours » — deux lectures recoupées, une
// réponse honnête — au lieu de « je ne peux rien faire ».
//
// LA RÈGLE DE SÛRETÉ, tenue ici et pas ailleurs : les outils de LECTURE
// s'exécutent librement pendant la boucle ; le PREMIER outil d'écriture arrête
// la boucle et ressort en PROPOSITION. Rien n'est jamais écrit depuis ce
// fichier. C'est le seul endroit où cette frontière est décidée, pour qu'elle
// ne puisse pas être contournée outil par outil.
//
// Boucle manuelle plutôt que le « tool runner » du SDK : celui-ci exécute les
// outils automatiquement, ce qui est exactement ce qu'on refuse pour les
// écritures. La frontière proposer/agir vaut la vingtaine de lignes de boucle.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { cleIA, modeleIA } from './proposerRegle'
import { versDefinitionApi, type ContexteOutil, type Outil, type PropositionAction } from './outils/types'

/** Ce que la boucle rend à l'appelant. */
export type IssueFilou =
  /** Filou a répondu — une lecture, une explication, une question. */
  | { genre: 'message'; texte: string; outilsAppeles: string[] }
  /** Filou veut FAIRE quelque chose et attend le feu vert. */
  | {
      genre: 'proposition'
      /** Le mot d'accompagnement, s'il en a écrit un avant de proposer. */
      texte: string
      outil: string
      params: unknown
      /** Ce que l'aperçu a calculé et que l'exécution devra retrouver tel quel. */
      charge?: unknown
      proposition: PropositionAction
      outilsAppeles: string[]
    }
  | { genre: 'erreur'; texte: string }

/** Nombre d'allers-retours autorisés. Chaque tour est un appel facturé : sans
 *  plafond, une boucle qui se cherche coûterait sans fin. Six laisse la place à
 *  « je lis l'équipe, je lis les règles, je recoupe, je réponds ». */
const TOURS_MAX = 6

const SYSTEM = `Tu es Filou, l'assistant de GuardVeto — le logiciel qui gère le planning de gardes d'un cabinet vétérinaire.

Tu parles à un membre du cabinet. Tu as des OUTILS pour consulter et pour agir sur son cabinet. Tu ne sais rien de ce cabinet sans les appeler : ne réponds jamais de mémoire ou au jugé sur ce qu'il contient.

COMMENT TU TRAVAILLES

1. Cherche avant de conclure. Si la question porte sur ce que le cabinet contient — qui, quand, quelles règles, quels congés — appelle les outils qui le disent. Plusieurs si nécessaire : une règle et une fiche vétérinaire ne disent pas la même chose.
2. Recoupe. Une contrainte peut venir d'une règle, d'un réglage de fiche, d'un congé ou de la structure du planning. Ne conclus « rien ne l'empêche » qu'après avoir regardé partout où ça pouvait être.
3. Réponds court, en français simple, et dis d'où vient ta réponse. Pas de jargon technique, pas d'identifiants à l'écran.
4. Si tu n'as pas d'outil pour ce qu'on te demande, dis-le franchement plutôt que d'expliquer comment le faire à la main.

QUAND TU AGIS

Les outils qui MODIFIENT quelque chose ne s'exécutent pas quand tu les appelles : ils préparent une proposition que la personne validera d'un clic. Appelle-les dès que la demande implique un changement — c'est le geste attendu, pas une audace. Un seul par réponse.

CE QUE TU NE FAIS JAMAIS

- Affirmer un fait sur le cabinet sans l'avoir lu avec un outil.
- Annoncer qu'une modification est faite : tu la proposes, la personne décide.
- Renvoyer quelqu'un faire à la main une chose que tu peux proposer.
- Inventer un vétérinaire, une date, une règle ou un chiffre.`

/**
 * Fait tourner Filou sur une demande. N'écrit jamais en base.
 *
 * @param phrase   ce que la personne a écrit
 * @param outils   le catalogue, DÉJÀ filtré selon ses droits
 * @param ctx      le contexte d'exécution des outils
 * @param aujourdhui date du jour au format ISO — passée dans le message et non
 *   dans le prompt système, qui doit rester identique à l'octet d'un appel à
 *   l'autre pour que sa mise en cache serve.
 */
export async function faireTravaillerFilou(
  phrase: string,
  outils: Outil[],
  ctx: ContexteOutil,
  aujourdhui: string,
): Promise<IssueFilou> {
  const client = new Anthropic({ apiKey: cleIA() })
  const parNom = new Map(outils.map((o) => [o.nom, o]))
  const definitions = outils.map(versDefinitionApi)
  const outilsAppeles: string[] = []

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Nous sommes le ${aujourdhui}.\n\n${phrase}`,
    },
  ]

  for (let tour = 0; tour < TOURS_MAX; tour++) {
    let reponse: Anthropic.Message
    try {
      reponse = await client.messages.create({
        model: modeleIA(),
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: definitions,
        messages,
      })
    } catch (e) {
      return { genre: 'erreur', texte: e instanceof Error ? e.message : "Erreur de l'assistant." }
    }

    const texte = reponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n')

    if (reponse.stop_reason !== 'tool_use') {
      return {
        genre: 'message',
        texte: texte || "Je n'ai pas su quoi répondre. Reformule autrement ?",
        outilsAppeles,
      }
    }

    const appels = reponse.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    messages.push({ role: 'assistant', content: reponse.content })

    const resultats: Anthropic.ToolResultBlockParam[] = []
    for (const appel of appels) {
      const outil = parNom.get(appel.name)
      if (!outil) {
        resultats.push(erreurOutil(appel.id, `L'outil « ${appel.name} » n'existe pas.`))
        continue
      }
      outilsAppeles.push(outil.nom)

      // Ce que le modèle a produit n'est pas de confiance : on le repasse par le
      // schéma avant de le laisser toucher quoi que ce soit.
      const valides = outil.params.safeParse(appel.input ?? {})
      if (!valides.success) {
        resultats.push(
          erreurOutil(appel.id, `Paramètres invalides : ${valides.error.issues.map((i) => i.message).join(', ')}`),
        )
        continue
      }

      if (outil.genre === 'lecture') {
        try {
          const donnees = await outil.executer(valides.data, ctx)
          resultats.push({
            type: 'tool_result',
            tool_use_id: appel.id,
            content: JSON.stringify(donnees ?? null),
          })
        } catch (e) {
          resultats.push(
            erreurOutil(appel.id, e instanceof Error ? e.message : 'Lecture impossible.'),
          )
        }
        continue
      }

      // ── Écriture : on ne fait rien, on décrit ──────────────
      let resume: Awaited<ReturnType<typeof outil.resumer>>
      try {
        resume = await outil.resumer(valides.data, ctx)
      } catch (e) {
        resultats.push(
          erreurOutil(appel.id, e instanceof Error ? e.message : 'Action impossible.'),
        )
        continue
      }
      if (!resume.ok) {
        // Filou reprend la main avec la raison : il expliquera, ou tentera
        // autrement. Un bouton qui échouerait au clic serait pire.
        resultats.push(erreurOutil(appel.id, resume.raison))
        continue
      }

      return {
        genre: 'proposition',
        texte,
        outil: outil.nom,
        params: valides.data,
        charge: resume.charge,
        proposition: resume.proposition,
        outilsAppeles,
      }
    }

    messages.push({ role: 'user', content: resultats })
  }

  return {
    genre: 'message',
    texte:
      "Je tourne en rond sur cette demande — je préfère m'arrêter plutôt que de continuer à chercher. Reformule-la autrement ?",
    outilsAppeles,
  }
}

function erreurOutil(id: string, texte: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content: texte, is_error: true }
}
