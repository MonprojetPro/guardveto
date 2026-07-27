// ============================================================
// GUARDVETO — Ce que Filou doit FAIRE de la demande (routeur d'intention)
// ============================================================
// SERVER-ONLY. Avant l'arrivée de ce routeur, Filou n'avait qu'une réponse
// possible : traduire la phrase en NOUVELLE règle. Toute demande qui revenait à
// LEVER une contrainte existante — « Anne-Catherine peut désormais travailler le
// jeudi soir » — finissait en « ce n'est pas ici que ça se configure, allez la
// chercher dans la liste ». Autrement dit : il renvoyait l'admin faire à la main
// une action qu'il pouvait faire lui-même.
//
// POURQUOI UN APPEL SÉPARÉ, et pas un champ de plus dans le schéma de création :
// ce schéma-là a DÉJÀ mis l'assistant à terre en production (2026-07-26) en
// dépassant les plafonds de l'API sur les sorties structurées. On n'y touche
// pas. Ce routeur a son propre schéma, minuscule et stable, et le chemin de
// création reste exactement celui qui est recetté.
//
// Le routeur voit les règles du cabinet NUMÉROTÉES (R1, R2…), jamais leurs
// identifiants : un modèle recopie mal un UUID, alors qu'un petit entier ne
// s'invente pas. La correspondance numéro → identifiant est refaite côté
// serveur, sur la liste qu'on a nous-mêmes envoyée.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { cleIA, modeleIA } from './proposerRegle'

/** Une règle telle que le routeur la voit : un numéro, une phrase, un état. */
export interface RegleNumerotee {
  numero: number
  phrase: string
  actif: boolean
}

const IntentionSchema = z.object({
  intention: z
    .enum(['creer', 'agir', 'autre'])
    .describe(
      'creer = la demande décrit une NOUVELLE contrainte à ajouter. ' +
        'agir = la demande revient à lever, rétablir ou supprimer une règle DÉJÀ EXISTANTE de la liste. ' +
        'autre = ni l\'un ni l\'autre (question, demande hors sujet, aucune règle correspondante).',
    ),
  action: z
    .enum(['desactiver', 'supprimer', 'activer', 'aucune'])
    .describe(
      'Seulement si intention=agir. desactiver = mettre la règle en pause (réversible). ' +
        'supprimer = l\'effacer définitivement, à ne choisir que si la demande le dit clairement. ' +
        'activer = remettre en service une règle actuellement en pause. Sinon : aucune.',
    ),
  regles: z
    .array(z.number().int())
    .describe('Numéros des règles visées (les R… de la liste). Vide si intention ≠ agir.'),
  explication: z
    .string()
    .describe(
      'Une phrase en français, adressée à l\'admin, qui dit ce que tu as compris. ' +
        'Si intention=autre, dis pourquoi tu ne peux rien faire.',
    ),
})

export type SortieIntention = z.infer<typeof IntentionSchema>

const SYSTEM = `Tu es Filou, l'assistant de GuardVeto, un logiciel de planning de gardes vétérinaires.

Ton SEUL travail ici : dire ce qu'il faut faire de la demande de l'admin. Tu ne rédiges pas la règle, tu ne calcules rien, tu ne décides rien — un humain validera ensuite.

Trois cas, et trois seulement :

1. « creer » — la demande ajoute une contrainte qui n'existe pas encore.
   Exemples : « Manon ne fait jamais de garde le mercredi », « au moins 3 jours entre deux gardes pour Antoine ».

2. « agir » — la demande porte sur une règle DÉJÀ dans la liste ci-dessous.
   • Elle LÈVE une contrainte (« X peut désormais… », « ce n'est plus le cas », « enlève la règle du mercredi ») → action « desactiver », ou « supprimer » si la demande dit explicitement de supprimer/effacer définitivement.
   • Elle RÉTABLIT une contrainte en pause → action « activer ».
   Donne les numéros des règles concernées. Plusieurs numéros si plusieurs règles correspondent.

3. « autre » — aucune règle de la liste ne correspond, ou la demande n'est pas une règle du tout.

RÈGLES ABSOLUES :
- Ne cite QUE des numéros présents dans la liste. Jamais un numéro inventé.
- Dans le doute entre « creer » et « agir », regarde la liste : si une règle existante dit déjà le contraire de ce qu'on te demande, c'est « agir ».
- Préfère « desactiver » à « supprimer » : la mise en pause se rattrape, pas l'effacement.
- N'invente jamais une règle qui n'est pas dans la liste pour justifier un « agir ».`

/**
 * Décide ce que Filou doit faire d'une phrase, au vu des règles existantes.
 * @throws si la clé API est absente, ou si la réponse ne parse pas.
 */
export async function routerIntentionIA(
  phrase: string,
  regles: RegleNumerotee[],
): Promise<SortieIntention> {
  const client = new Anthropic({ apiKey: cleIA() })

  const liste =
    regles.length === 0
      ? '(le cabinet n’a encore aucune règle par vétérinaire)'
      : regles
          .map((r) => `R${r.numero} — ${r.phrase}${r.actif ? '' : ' [EN PAUSE]'}`)
          .join('\n')

  const response = await client.messages.parse({
    model: modeleIA(),
    max_tokens: 700,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Règles actuelles du cabinet :\n${liste}\n\nDemande de l'admin :\n« ${phrase} »`,
      },
    ],
    output_config: { format: zodOutputFormat(IntentionSchema) },
  })

  const sortie = response.parsed_output
  if (!sortie) throw new Error("L'assistant n'a pas renvoyé de réponse exploitable.")
  return sortie
}
