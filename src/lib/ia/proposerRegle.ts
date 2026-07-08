// ============================================================
// GUARDVETO — Assistant IA : appel Claude (Palier 3, slice 1)
// ============================================================
// SERVER-ONLY. Traduit une phrase FR → proposition de règle structurée
// (sortie structurée Zod). Un seul appel (Tier 1). L'IA ne calcule jamais de
// planning et ne touche jamais la base : elle PROPOSE, l'humain crée ensuite
// via upsertRegle. Modèle : claude-opus-4-8 (défaut maison), thinking adaptatif.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  PropositionRegleSchema,
  type PropositionRegle,
  type VetoResolu,
} from './regleSchema'

/** L'assistant est-il configuré (clé API présente) ? */
export function assistantIaDisponible(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Un type de créneau du cabinet, injecté dynamiquement dans le prompt (n°19). */
export interface TypeCreneauIA {
  /** Code EXACT (celui que le moteur compare aux gardes du planning). */
  code: string
  /** Nom lisible pour aider l'IA à comprendre la demande. */
  nom: string
}

/** Décrit les briques disponibles pour guider l'IA (jours = lundi→vendredi). */
const CATALOGUE_PROMPT = `Tu peux proposer UNIQUEMENT l'un de ces 16 types de règle :

1. interdire_creneau — un vétérinaire ne fait pas de garde un jour fixe de la semaine.
   params: jour (lundi|mardi|mercredi|jeudi|vendredi), exception_vacances_scolaires (true/false).
2. repos_conditionnel — jour de repos différent selon la garde du week-end.
   params: si_garde_we (jour si de garde le WE), sinon (jour de repos par défaut).
3. alternance_ancre — indisponible certains créneaux une semaine sur deux.
   params: semaines (paires|impaires|toutes), periodes (sous-ensemble de [soir_semaine, weekend]).
4. duo_interdit — deux vétérinaires ne sont jamais de garde seuls ensemble.
   params: veterinaire = le premier, partenaire = le second (deux prénoms différents).
5. au_plus_n — au plus N gardes sur une fenêtre.
   params: n (entier ≥ 1), fenetre (semaine_civile|glissante_7_jours|glissante_14_jours|glissante_30_jours),
   creneaux (optionnel : liste de CODES de créneaux du cabinet — voir la liste fournie — pour ne compter QUE ces types de garde ; null = toutes les gardes).
   Ex. « Manon fait au plus 2 week-ends par mois » → au_plus_n, n=2, fenetre=glissante_30_jours, creneaux=["weekend"].
6. espacement_min — au moins X jours entre deux gardes du même vétérinaire.
   params: ecart_min_jours (entier ≥ 1).
   ⚠️ C'est AUSSI le type à utiliser pour un REPOS entre gardes : « au moins N jours de repos entre mes gardes » = espacement_min avec ecart_min_jours = N+1 (2 jours de repos = 3 jours d'écart minimum).
7. espacement_weekend — au plus 1 garde de WEEK-END toutes les N semaines (« un week-end sur N », limite la fréquence des week-ends d'un véto).
   params: n_semaines (entier ≥ 2 ; « un week-end sur 3 » → n_semaines = 3).
   ⚠️ N'utilise ce type QUE si la demande est une FRÉQUENCE de week-ends (« un WE sur N »). Un PLAFOND de week-ends (« au plus 2 WE par mois ») → au_plus_n avec creneaux=["weekend"]. Force par défaut conseillée : si_possible (préférence).
8. composition_equipe — règle GLOBALE d'équipe basée sur une ÉTIQUETTE (pas un vétérinaire nominal → laisse veterinaire=null).
   params: mode_composition ('au_moins_un' = chaque créneau ciblé doit compter au moins un véto portant l'étiquette ; 'pas_seuls' = les porteurs de l'étiquette ne sont jamais seuls sur un créneau), tag (une étiquette de la liste fournie), creneaux (optionnel : codes de créneaux ciblés ; null = tous).
   Ex. « un junior n'est jamais seul de garde » → mode_composition=pas_seuls, tag="junior".
   Ex. « toujours un senior le week-end » → mode_composition=au_moins_un, tag="senior", creneaux=["weekend"].
   Force par défaut conseillée : jamais (exigence de sécurité).
   ⚠️ Si la demande vise une étiquette QUE PERSONNE ne porte (hors liste fournie), faisable=false : demande d'abord de poser l'étiquette sur les fiches (page Équipe).
9. role_interdit_tag — règle GLOBALE : les vétérinaires portant une ÉTIQUETTE ne tiennent jamais un RÔLE donné (laisse veterinaire=null).
   params: tag (une étiquette de la liste fournie), role_interdit (un rôle de la liste des rôles fournie, ex. 'premier' pour « 1er de garde »), creneaux (optionnel : codes ciblés ; null = tous).
   Ex. « un junior n'est jamais 1er de garde » → role_interdit_tag, tag="junior", role_interdit="premier".
   Force par défaut conseillée : jamais. Même règle que le type 8 pour les étiquettes inconnues.

Les types 10 à 12 sont des DESIDERATA : des préférences POSITIVES d'un vétérinaire (« préfère », « aimerait », « veut plus »). Elles ne bloquent JAMAIS la génération → force TOUJOURS souple (si_possible ou evitee, JAMAIS "jamais").
10. preferer_creneau — un vétérinaire PRÉFÈRE certains jours et/ou certains créneaux (le moteur y concentre ses gardes).
   params: jours (liste parmi lundi..dimanche, optionnel), creneaux (codes du cabinet, optionnel) — au moins l'un des deux.
   Ex. « Manon préfère être de garde le mardi » → preferer_creneau, jours=["mardi"].
   Ex. « Victor préfère les week-ends » → preferer_creneau, creneaux=["weekend"].
11. preferer_avec — un vétérinaire PRÉFÈRE être de garde avec un co-équipier donné (dans UN sens).
   params: veterinaire = qui préfère, partenaire = le co-équipier préféré (deux prénoms différents).
12. volume_gardes — un vétérinaire souhaite faire PLUS ou MOINS de gardes que la moyenne.
   params: sens ('plus' | 'moins').
   Ex. « Antoine veut faire plus de gardes » → volume_gardes, sens="plus".

Les types 13 à 15 sont des règles de RYTHME (successions et repos entre gardes) d'un vétérinaire.
13. succession_interdite — un vétérinaire ne fait jamais un type de garde le LENDEMAIN d'un autre type.
   params: type_avant (code du créneau la veille), type_apres (code du créneau interdit le lendemain) — deux CODES de créneaux du cabinet (voir la liste fournie).
   ⚠️ « lendemain » au sens JOUR CIVIL : le week-end couvre samedi+dimanche, donc son lendemain est le lundi.
   Ex. « pas de garde de semaine juste après un week-end » → succession_interdite, type_avant="weekend", type_apres="semaine_soir".
14. serie_max — jamais plus de N JOURS de garde d'affilée (jours consécutifs).
   params: n_jours (entier ≥ 1), creneaux (optionnel : ne compter que ces CODES de créneaux ; null = tous).
   Ex. « jamais plus de 3 jours de garde d'affilée » → serie_max, n_jours=3.
15. repos_apres_serie — après N jours de garde d'affilée, imposer M jours SANS garde.
   params: n_jours (longueur de série, entier ≥ 1), repos_jours (jours de repos imposés, entier ≥ 1).
   Ex. « après 2 jours de garde d'affilée, au moins 2 jours de repos » → repos_apres_serie, n_jours=2, repos_jours=2.
16. cadencement_weekend — CADENCEMENT FIXE des week-ends d'un vétérinaire, calé sur un cycle « 1 week-end sur N » ancré à une date de référence. Cas type : un pompier volontaire de garde 1 week-end sur 3 à dates FIXES, qui ne peut donc JAMAIS prendre de garde véto ces week-ends-là ; ou au contraire un véto qui VEUT ses gardes week-end calées sur un cycle régulier.
   params: n_semaines (entier ≥ 2 ; « un week-end sur 3 » → 3), ancre (date ISO yyyy-MM-dd d'un week-end de RÉFÉRENCE qui fixe la phase du cycle — souvent un samedi), sens_cadence :
     - 'interdit' : les week-ends du cycle sont INTERDITS de garde (le véto est déjà pris ailleurs) ; les autres week-ends restent libres.
     - 'impose' : les gardes week-end du véto DOIVENT tomber sur ce cycle (hors cycle = interdit). ⚠️ Cela n'OBLIGE PAS le moteur à le mettre de garde à CHAQUE week-end du cycle : c'est seulement un filtre de POSITION.
   ⚠️ NE PAS confondre avec espacement_weekend (type 7) qui limite juste la FRÉQUENCE (« au plus 1 WE sur N ») sans dates fixes. Ici les week-ends sont ANCRÉS à des DATES PRÉCISES. Cycle calendaire strict (indépendant des vacances).
   Ex. « Victor est pompier volontaire, il est pris un week-end sur 3 à partir du samedi 5 septembre 2026 » → cadencement_weekend, veterinaire="Victor", n_semaines=3, ancre="2026-09-05", sens_cadence="interdit", force="jamais".

Niveau d'importance (force) :
- jamais = interdiction ferme
- sauf_crise = à éviter, sauf situation de crise
- evitee = simple préférence (évitée)
- si_possible = simple préférence (si possible)`

/**
 * proposerRegleIA — appelle Claude pour traduire `phrase` en proposition.
 * @throws si ANTHROPIC_API_KEY absente, ou si la réponse ne parse pas.
 */
export async function proposerRegleIA(
  phrase: string,
  vets: VetoResolu[],
  typesCreneaux: TypeCreneauIA[] = [],
  // Étiquettes réellement portées par l'équipe (composition_equipe, n°6).
  tagsEquipe: string[] = [],
  // Labels de rôles du catalogue du cabinet (role_interdit_tag, n°22).
  rolesCabinet: string[] = [],
): Promise<PropositionRegle> {
  if (!assistantIaDisponible()) {
    throw new Error('Assistant IA non configuré (clé API manquante).')
  }

  const client = new Anthropic()
  const prenoms = vets.map((v) => v.prenom).join(', ')
  // Référentiel DYNAMIQUE des créneaux du cabinet (verrou 8 : jamais d'enum
  // figé) — l'IA doit utiliser ces CODES exacts dans `creneaux` (au_plus_n).
  const lignesCreneaux = typesCreneaux
    .map((t) => `- ${t.code} (${t.nom})`)
    .join('\n')
  const blocCreneaux = typesCreneaux.length > 0
    ? `\nTypes de créneaux de garde DE CE CABINET (codes EXACTS à utiliser dans "creneaux") :\n${lignesCreneaux}\n`
    : ''
  // Référentiel DYNAMIQUE des étiquettes d'équipe (composition_equipe).
  const blocTags = tagsEquipe.length > 0
    ? `\nÉtiquettes d'équipe DE CE CABINET (les seules utilisables dans "tag") : ${tagsEquipe.join(', ')}.\n`
    : `\nAucune étiquette d'équipe n'est posée dans ce cabinet pour l'instant : toute règle composition_equipe ou role_interdit_tag est donc infaisable (faisable=false, invite à poser les étiquettes sur la page Équipe d'abord).\n`
  // Référentiel DYNAMIQUE des rôles de place (role_interdit_tag).
  const blocRoles = rolesCabinet.length > 0
    ? `Rôles de garde DE CE CABINET (les seuls utilisables dans "role_interdit") : ${rolesCabinet.map((r) => `${r}${r === 'premier' ? ' (1er)' : r === 'second' ? ' (2nd)' : ''}`).join(', ')}.\n`
    : ''

  const system = `Tu es l'assistant de configuration de GuardVeto, un logiciel de planning de gardes vétérinaires. Ton rôle : traduire une demande en langage naturel en UNE règle structurée que le moteur sait appliquer. Tu PROPOSES seulement — un humain validera avant création.

Vétérinaires du cabinet (utilise EXACTEMENT ces prénoms) : ${prenoms}.
${blocCreneaux}${blocTags}${blocRoles}
${CATALOGUE_PROMPT}

Règles de comportement :
- Réponds toujours en français, dans "comprehension" reformule la demande, dans "message" explique brièvement ta proposition.
- Si la demande correspond à un des types ci-dessus : faisable=true, remplis brique_id, veterinaire, force et SEULEMENT les params du type choisi (laisse les autres à null).
- Si la demande est ambiguë (jour manquant, véto non précisé, etc.) OU n'est pas réalisable : faisable=false, brique_id=null, et explique dans "message".
- IMPORTANT — ton du "message" quand faisable=false : parle comme à un vétérinaire, AVEC SES MOTS. Ne mentionne JAMAIS « les 6 types de règles », « brique », ni aucun terme technique ou interne. Si c'est ambigu, demande simplement la précision manquante. Si la demande sort du périmètre (ce n'est pas une règle de planning de gardes), dis-le simplement et invite à reformuler autrement — sans lister de catalogue.
- Choisis une force par défaut raisonnable si l'utilisateur ne la précise pas (souvent sauf_crise, ou jamais pour une interdiction nette).
- N'invente jamais un prénom hors de la liste.
- N'invente jamais un code de créneau : "creneaux" n'accepte QUE les codes listés ci-dessus (sinon laisse creneaux=null).`

  const response = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: phrase }],
    output_config: { format: zodOutputFormat(PropositionRegleSchema) },
  })

  const proposition = response.parsed_output
  if (!proposition) {
    throw new Error("L'assistant n'a pas pu structurer sa réponse. Reformule ta demande.")
  }
  return proposition
}
