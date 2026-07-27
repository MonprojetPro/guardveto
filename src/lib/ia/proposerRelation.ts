// ============================================================
// GUARDVETO — Assistant IA : appel Claude pour une LIAISON (RG4)
// ============================================================
// SERVER-ONLY. Traduit une phrase FR → proposition de LIAISON entre deux
// créneaux (« même équipe » = ex R9, « rôles différents » = ex R8), en sortie
// structurée Zod. Un seul appel. L'IA ne crée jamais rien : elle PROPOSE,
// l'humain crée ensuite via creerRelationCreneau (frontière de confiance +
// RLS). Mêmes réglages que les assistants règles/profil (claude-opus-4-8,
// thinking adaptatif).
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  PropositionRelationSchema,
  type PropositionRelation,
} from './relationSchema'
import { cleIA } from './proposerRegle'

/** Décrit ce qu'est une liaison et son périmètre (anti-coquille-vide). */
const STRUCTURE_PROMPT = `Une LIAISON relie deux types de garde d'un profil de planning. Le moteur relie chaque garde du SECOND créneau à la garde du PREMIER créneau qui la précède immédiatement (dans les 7 jours), puis applique la règle choisie :
- meme_binome (« même équipe ») : les MÊMES vétérinaires assurent les deux gardes. C'est la règle historique entre le vendredi soir et le week-end.
- inversion_role (« rôles différents ») : un vétérinaire présent sur les deux gardes doit y CHANGER de rôle (ex. 1er sur l'une, 2nd sur l'autre).

Ce que tu remplis :
1. profil — le nom EXACT du profil concerné si l'utilisateur le précise, sinon null (profil par défaut).
2. premier_creneau — le nom EXACT du type de garde qui a lieu EN PREMIER chronologiquement (la garde de référence).
3. second_creneau — le nom EXACT du type de garde qui SUIT (celui qui se calque sur le premier).
4. genre — meme_binome ou inversion_role.

⚠️ ORDRE : si l'utilisateur dit « le week-end doit avoir la même équipe que le vendredi », le premier_creneau est le vendredi (il a lieu avant), le second_creneau le week-end.
⚠️ « même équipe » entre deux gardes qui ont lieu LE MÊME JOUR est impossible (un vétérinaire ne peut pas tenir deux gardes le même jour) : si la demande revient à ça, faisable=false et propose « rôles différents » à la place.

PÉRIMÈTRE — tu ne peux PAS : créer un type de garde, imposer un repos après une garde, ni régler le niveau ferme/souple d'une règle (ça se règle dans « Règles du planning »). Si la demande sort de là, faisable=false et explique simplement.`

/**
 * proposerRelationIA — appelle Claude pour traduire `phrase` en proposition de
 * liaison. `catalogueTexte` décrit les profils et leurs types de garde (noms
 * exacts) pour que l'IA ne cite que des noms existants.
 * @throws si ANTHROPIC_API_KEY absente, ou si la réponse ne parse pas.
 */
export async function proposerRelationIA(
  phrase: string,
  catalogueTexte: string,
): Promise<PropositionRelation> {
  if (!cleIA()) {
    throw new Error('Assistant IA non configuré (clé API manquante).')
  }

  const client = new Anthropic({ apiKey: cleIA() })

  const system = `Tu es l'assistant de configuration de GuardVeto, un logiciel de planning de gardes vétérinaires. Ton rôle : traduire une demande en langage naturel en UNE liaison entre deux types de garde. Tu PROPOSES seulement — un humain validera avant création.

Profils du cabinet et leurs types de garde (utilise EXACTEMENT ces noms) :
${catalogueTexte}

${STRUCTURE_PROMPT}

Règles de comportement :
- Réponds toujours en français. Dans "comprehension" reformule la demande ; dans "message" explique brièvement ta proposition (ou la précision qui manque).
- Si la demande est traduisible : faisable=true et remplis les 4 champs (profil = null si non précisé).
- Si la demande est ambiguë (créneaux non identifiables, règle absente…) OU hors périmètre : faisable=false, et explique dans "message".
- IMPORTANT — ton du "message" : parle comme à un vétérinaire, AVEC SES MOTS. Ne mentionne JAMAIS de terme technique interne (« genre », « source », « cible », « relation_creneau »…). Si c'est ambigu, demande simplement la précision manquante.
- N'invente jamais un nom de créneau ou de profil hors de la liste ci-dessus.`

  const response = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: phrase }],
    output_config: { format: zodOutputFormat(PropositionRelationSchema) },
  })

  const proposition = response.parsed_output
  if (!proposition) {
    throw new Error("L'assistant n'a pas pu structurer sa réponse. Reformule ta demande.")
  }
  return proposition
}
