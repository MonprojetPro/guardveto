// ============================================================
// GUARDVETO — Assistant IA : appel Claude pour un PROFIL (P5 slice 5)
// ============================================================
// SERVER-ONLY. Traduit une phrase FR → proposition de PROFIL de planning
// structurée (sortie structurée Zod). Un seul appel. L'IA ne crée jamais rien :
// elle PROPOSE, l'humain crée ensuite via creerProfilComplet (frontière de
// confiance + RLS). Modèle : claude-opus-4-8, thinking adaptatif — mêmes réglages
// que l'assistant de règles (proposerRegle.ts).
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  PropositionProfilSchema,
  type PropositionProfil,
  type ProfilResolu,
} from './profilSchema'
import { cleIA } from './proposerRegle'

/** Décrit ce qu'est une période type et le périmètre composable (anti-coquille-vide). */
const STRUCTURE_PROMPT = `Une PÉRIODE TYPE est une façon de tourner, réutilisable (ex. « Hiver », « Été »), qu'on choisit à la création d'un planning.

COMMENT S'ORGANISE UN CABINET — à comprendre avant de proposer quoi que ce soit :
· LA STRUCTURE DES GARDES est le SOCLE, commun à tout le cabinet : quels types de garde existent, quels jours ils couvrent, à quels horaires, et jusqu'à combien de vétérinaires chacun peut accueillir.
· UNE PÉRIODE TYPE AFFINE ce socle : elle dit seulement, pour chaque garde, combien de vétérinaires elle veut — de zéro au maximum permis. Zéro signifie que cette garde n'existe pas sur cette période.
Le socle donne les possibilités, la période type choisit dedans.

Ce que tu peux régler ici :
1. nom — le nom de la nouvelle période type (obligatoire).
2. source_profil — le nom EXACT de la période type dont on reprend les réglages, si l'utilisateur le mentionne (« comme l'hiver », « à partir de X »). Sinon null : on part de celle par défaut.
3. horaires — les horaires à CHANGER, uniquement pour les types que l'utilisateur cite explicitement. Chaque entrée : code + heure_debut + heure_fin ("HH:MM") + offset_jours_fin (0 = la garde finit le jour même, 1 = le lendemain, 2 = le surlendemain, 3 = trois jours après).
   Les 4 types de garde dont tu peux changer l'horaire :
   - semaine_soir : le soir en semaine (lundi à jeudi)
   - vendredi_soir : le vendredi soir
   - weekend : le week-end (samedi/dimanche)
   - ferie : les jours fériés
   ⚠️ Un horaire appartient au SOCLE : le changer vaut pour TOUTES les périodes types, pas seulement celle qu'on crée. Ne remplis "horaires" que si l'utilisateur le demande explicitement ; sinon laisse null.

PÉRIMÈTRE — tu ne peux PAS ici : inventer un nouveau type de garde, changer les jours couverts, le maximum de places ou les rôles.
⚠️ Le NOMBRE DE VÉTÉRINAIRES par garde (« 2 le week-end », « un seul le soir en semaine », « pas de garde le vendredi ») ne se règle PAS ici : il se règle garde par garde, une fois la période type créée. Si la demande porte là-dessus, propose quand même la création avec son nom, et dis que les nombres se règlent ensuite.
Si la demande sort de tout ça, faisable=false et explique simplement qu'on ne peut pas encore le faire ici.`

/**
 * proposerProfilIA — appelle Claude pour traduire `phrase` en proposition de profil.
 * @throws si ANTHROPIC_API_KEY absente, ou si la réponse ne parse pas.
 */
export async function proposerProfilIA(
  phrase: string,
  profils: ProfilResolu[],
): Promise<PropositionProfil> {
  if (!cleIA()) {
    throw new Error('Assistant IA non configuré (clé API manquante).')
  }

  const client = new Anthropic({ apiKey: cleIA() })
  const listeProfils =
    profils.map((p) => `« ${p.nom} »${p.est_defaut ? ' (par défaut)' : ''}`).join(', ')
    || '(aucun profil pour l’instant)'

  const system = `Tu es l'assistant de configuration de GuardVeto, un logiciel de planning de gardes vétérinaires. Ton rôle : traduire une demande en langage naturel en UN profil de planning structuré que l'application sait créer. Tu PROPOSES seulement — un humain validera avant création.

Profils déjà existants dans le cabinet (utilise EXACTEMENT ces noms si l'utilisateur veut dupliquer l'un d'eux) : ${listeProfils}.

${STRUCTURE_PROMPT}

Règles de comportement :
- Réponds toujours en français. Dans "comprehension" reformule la demande ; dans "message" explique brièvement ta proposition (ou la précision qui manque).
- Si la demande est composable : faisable=true, remplis nom + les réglages pertinents, et laisse à null tout ce qui n'est pas mentionné.
- Si la demande est ambiguë (nom du profil manquant, source imprécise…) OU hors périmètre : faisable=false, et explique dans "message".
- IMPORTANT — ton du "message" : parle comme à un vétérinaire, AVEC SES MOTS. Ne mentionne JAMAIS de terme technique interne (« code », « offset », « creneau_modele », « profil source »…). Si c'est ambigu, demande simplement la précision manquante ; si c'est hors périmètre, dis-le simplement et invite à reformuler — sans lister de catalogue.
- N'invente jamais un nom de profil source hors de la liste ci-dessus.`

  const response = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: phrase }],
    output_config: { format: zodOutputFormat(PropositionProfilSchema) },
  })

  const proposition = response.parsed_output
  if (!proposition) {
    throw new Error("L'assistant n'a pas pu structurer sa réponse. Reformule ta demande.")
  }
  return proposition
}
