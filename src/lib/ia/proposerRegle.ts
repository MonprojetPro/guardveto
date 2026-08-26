// ============================================================
// GUARDVETO — Assistant IA : appel Claude (Palier 3, slice 1)
// ============================================================
// SERVER-ONLY. Traduit une phrase FR → proposition de règle structurée
// (sortie structurée Zod). Un seul appel (Tier 1). L'IA ne calcule jamais de
// planning et ne touche jamais la base : elle PROPOSE, l'humain crée ensuite
// via upsertRegle. Modèle : claude-sonnet-5 par défaut, thinking adaptatif.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  SortieIaSchema,
  normaliserProposition,
  type PropositionRegle,
  type VetoResolu,
} from './regleSchema'

/** L'assistant est-il configuré (clé API présente) ? */
export function assistantIaDisponible(): boolean {
  return Boolean(cleIA())
}

/**
 * La clé API, nettoyée. Le SDK la lirait tout seul dans l'environnement, mais
 * SANS la trimmer : une valeur collée dans l'interface Vercel embarque souvent
 * un retour à la ligne invisible, qui rend l'en-tête d'authentification
 * invalide. On la passe donc explicitement à chaque client.
 */
export function cleIA(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim()
}

/**
 * Le modèle qui fait la traduction. Réglable SANS TOUCHER AU CODE, par la
 * variable d'environnement `GUARDVETO_IA_MODELE`.
 *
 * Pourquoi : le coût varie d'un facteur 5 entre les paliers (Opus 5 $/25 $ le
 * million de tokens, Haiku 1 $/5 $) pour une tâche — traduire une phrase en
 * règle structurée — que les petits modèles font peut-être aussi bien. Sans ce
 * réglage, en mesurer un demandait un déploiement.
 *
 * Défaut : SONNET, décidé par MiKL. Le banc du 2026-07-26 avait mesuré les
 * trois paliers sur le même jeu — tous 4/4, mais Haiku dit le jargon interne
 * (« je propose une règle "Interdire un créneau" ») et Opus mélange le tu et le
 * vous ; Sonnet était le seul régulier. La décision était restée « ouverte » et
 * le défaut, lui, était resté Opus : un mois durant, Filou a donc tourné sur le
 * palier le plus cher alors que le choix était fait. Le défaut porte désormais
 * la décision, au lieu d'une variable que personne ne pose.
 *
 * L'enjeu n'est pas la création de règles (ponctuelle, 2-3 $ par cabinet à vie)
 * mais l'usage quotidien : 7 vétos × 3 questions/jour ≈ 630 appels par mois et
 * par cabinet, et chaque question peut coûter jusqu'à 6 tours plus le second
 * gardien.
 *
 * Relu à CHAQUE appel, pas figé au chargement du module : sinon un banc d'essai
 * ne pourrait pas comparer deux modèles dans un même processus.
 */
export function modeleIA(): string {
  // `trim()` obligatoire : un copier-coller dans l'interface Vercel colle
  // facilement un retour à la ligne invisible en fin de valeur. L'API reçoit
  // alors « claude-sonnet-5\n », qui n'est pas un modèle connu → 404
  // not_found_error (incident 2026-07-27).
  return process.env.GUARDVETO_IA_MODELE?.trim() || 'claude-sonnet-5'
}

/** Le prompt système exact, exposé pour pouvoir en COMPTER les tokens sans
 *  refaire un appel facturé (cf. bancs d'essai). */
export function construireSystemIA(
  vets: VetoResolu[],
  typesCreneaux: TypeCreneauIA[],
  tagsEquipe: string[],
  rolesCabinet: string[],
): string {
  return systemPour(vets, typesCreneaux, tagsEquipe, rolesCabinet)
}

/** Un type de créneau du cabinet, injecté dynamiquement dans le prompt (n°19). */
export interface TypeCreneauIA {
  /** Code EXACT (celui que le moteur compare aux gardes du planning). */
  code: string
  /** Nom lisible pour aider l'IA à comprendre la demande. */
  nom: string
}

/** Décrit les briques disponibles pour guider l'IA (jours = lundi→vendredi). */
const CATALOGUE_PROMPT = `CONVENTIONS (valables pour TOUS les types ci-dessous) :
- "creneaux" = liste de CODES de créneaux du cabinet (ceux listés plus haut, jamais d'autres) ; omets-le pour viser tous les créneaux.
- Types 8, 9 et 18 : règles GLOBALES d'équipe → laisse veterinaire vide.
- Types 10 à 12 : DESIDERATA, préférences POSITIVES d'un véto (« préfère », « aimerait », « veut plus »). Ils ne bloquent JAMAIS la génération → force TOUJOURS souple (si_possible ou evitee), JAMAIS "jamais".
- Étiquette ("tag") demandée mais absente de la liste fournie → faisable=false, et invite à la poser d'abord sur les fiches (page Équipe).
- "déf." = force par défaut conseillée si l'utilisateur ne précise rien.
- Jours utilisables : lundi à vendredi (sauf mention contraire).

LES 19 TYPES — tu ne peux en proposer qu'UN SEUL :

1. interdire_creneau — pas de garde un jour fixe de la semaine.
   jours (LISTE — « pas de garde le lundi et le mardi » est UNE seule regle), exception_vacances_scolaires (true/false), semaine (toutes|paire|impaire).
   « semaine » sert à « repos le jeudi une semaine sur deux ». Absent = toutes les
   semaines. Avec paire ou impaire, exception_vacances_scolaires est refusé.
   Ne pas confondre avec le type 3 : ici on vise UN JOUR, là-bas des CRÉNEAUX.
2. repos_conditionnel — jour de repos différent selon la garde du week-end.
   si_garde_we (jour si de garde le WE), sinon (jour de repos sinon).
3. alternance_ancre — indisponible certains créneaux une semaine sur deux.
   semaines (paires|impaires|toutes), periodes (parmi soir_semaine, weekend).
4. duo_interdit — deux vétos jamais de garde SEULS ensemble.
   veterinaire = le premier, partenaire = le second (deux prénoms différents).
5. au_plus_n — PLAFOND : au plus N gardes sur une fenêtre.
   n (≥1), fenetre (semaine_civile|glissante_7_jours|glissante_14_jours|glissante_30_jours), creneaux.
   Ex. « au plus 2 week-ends par mois » → n=2, fenetre=glissante_30_jours, creneaux=["weekend"].
6. espacement_min — au moins X jours entre deux gardes du même véto.
   ecart_min_jours (≥1).
7. espacement_weekend — FRÉQUENCE : au plus 1 week-end toutes les N semaines.
   n_semaines (≥2 ; « un WE sur 3 » → 3). déf. si_possible.
8. composition_equipe — chaque créneau ciblé doit respecter une règle d'ÉTIQUETTE.
   mode_composition (au_moins_un = au moins un porteur de l'étiquette sur le créneau | pas_seuls = les porteurs ne sont jamais seuls), tag, creneaux. déf. jamais.
   Ex. « un junior jamais seul » → pas_seuls, tag="junior". « toujours un senior le week-end » → au_moins_un, tag="senior", creneaux=["weekend"].
9. role_interdit_tag — les porteurs d'une étiquette ne tiennent jamais un RÔLE.
   tag, role_interdit (un rôle de la liste fournie, ex. "premier" = 1er de garde), creneaux. déf. jamais.
10. preferer_creneau — un véto PRÉFÈRE certains jours et/ou créneaux.
   jours (lundi..dimanche) et/ou creneaux — au moins l'un des deux.
11. preferer_avec — un véto PRÉFÈRE (souhait souple) être avec un co-équipier.
   veterinaire = qui préfère, partenaire = le co-équipier (prénoms différents).
12. volume_gardes — un véto veut PLUS ou MOINS de gardes que la moyenne.
   sens (plus|moins).
13. succession_interdite — jamais tel type de garde le LENDEMAIN de tel autre.
   type_avant, type_apres (deux codes de créneaux).
   Ex. « pas de garde de semaine juste après un week-end » → type_avant="weekend", type_apres="semaine_soir".
14. serie_max — jamais plus de N JOURS de garde d'affilée.
   n_jours (≥1), creneaux.
15. repos_apres_serie — après N jours d'affilée, imposer M jours SANS garde.
   n_jours (longueur de série, ≥1), repos_jours (≥1).
16. cadencement_weekend — week-ends calés sur un cycle « 1 sur N » ANCRÉ à une date fixe. Cas type : un pompier volontaire pris 1 week-end sur 3 à dates fixes, donc indisponible ces week-ends-là.
   n_semaines (≥2), ancre (date ISO yyyy-MM-dd d'un week-end de référence qui fixe la phase, souvent un samedi), sens_cadence :
     interdit = les week-ends du cycle sont interdits de garde, les autres restent libres ;
     impose = les gardes week-end DOIVENT tomber sur ce cycle (c'est un filtre de position, ça n'oblige pas à être de garde à chaque fois).
   Ex. « pompier volontaire, pris un week-end sur 3 à partir du samedi 5 septembre 2026 » → n_semaines=3, ancre="2026-09-05", sens_cadence="interdit", force="jamais".
17. exclusion_dates — jamais de garde aux DEUX dates à la fois (l'une OUI, les deux NON — on n'oblige personne à en faire une). Renseigne UNE SEULE des deux formes :
   fetes = ["noel","nouvel_an"] → dès que la demande parle de Noël, Nouvel An, réveillons ou fêtes de fin d'année (se reconduit chaque année) ;
   dates = deux dates ISO yyyy-MM-dd → tout autre cas de deux dates à ne pas cumuler.
   déf. sauf_crise.
   Ex. « pas le 24 ET le 31 décembre » → fetes=["noel","nouvel_an"]. « pas le 14 juillet ET le 15 août 2026 » → dates=["2026-07-14","2026-08-15"].
18. equilibrer — ÉQUITÉ répartie entre les porteurs d'une étiquette seulement.
   dimension_equite (weekend | weekend_premier = rôle de 1er le WE | ferie | semaine_premier | semaine_second | grands_weekend), tag, importance_equite (peu_important|normal|important|essentiel). Ce type n'a PAS de force.
   Ex. « répartis équitablement les week-ends entre les juniors » → dimension_equite="weekend", tag="junior", importance_equite="important".
19. seulement_avec — A n'est de garde QUE si B l'est SUR LE MÊME CRÉNEAU (même date + même type). Sens UNIQUE : A dépend de B, jamais l'inverse.
   veterinaire = A (celui qui a la condition), partenaire = B (le binôme requis), creneaux. déf. jamais.
   Ex. « Antoine n'est de garde que si Victor est de garde avec lui » → veterinaire="Antoine", partenaire="Victor".

PIÈGES — vérifie ces distinctions AVANT de choisir :
- PLAFOND (5) ou FRÉQUENCE (7) ? « au plus 2 WE par mois » = plafond → 5 avec creneaux=["weekend"]. « un WE sur 3 » = fréquence → 7.
- FRÉQUENCE (7) ou CADENCEMENT (16) ? 7 limite la fréquence sans dates. 16 ancre le cycle à des DATES PRÉCISES (calendaire strict, indépendant des vacances).
- PRÉFÉRENCE (11) ou CONDITION (19) ? « je préfère être avec X » = souple → 11. « seulement si X », « jamais sans X », « uniquement accompagné de X » = ferme → 19.
- REPOS entre gardes = espacement (6), pas un type à part : « au moins N jours de repos entre mes gardes » → ecart_min_jours = N+1 (2 jours de repos = 3 jours d'écart).
- « LENDEMAIN » (13) au sens JOUR CIVIL : le week-end couvre samedi+dimanche, son lendemain est donc le lundi.
- ÉQUITÉ (18) : uniquement si la demande vise une ÉTIQUETTE. L'équilibrage de TOUTE l'équipe se règle dans les menus de l'application → faisable=false, invite à utiliser les réglages d'équité.
- Créneau à UNE seule place : il ne peut accueillir ni un duo (4) ni un accompagnement (19) — vise plutôt les créneaux à plusieurs places.

Niveau d'importance (force) :
- jamais = interdiction ferme
- sauf_crise = à éviter, sauf situation de crise
- evitee = simple préférence (évitée)
- si_possible = simple préférence (si possible)`

/** Le prompt système, construit à part pour être TESTABLE et COMPTABLE en
 *  tokens sans passer par un appel facturé. */
function systemPour(
  vets: VetoResolu[],
  typesCreneaux: TypeCreneauIA[],
  tagsEquipe: string[],
  rolesCabinet: string[],
): string {
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

  return `Tu es l'assistant de configuration de GuardVeto, un logiciel de planning de gardes vétérinaires. Ton rôle : traduire une demande en langage naturel en UNE règle structurée que le moteur sait appliquer. Tu PROPOSES seulement — un humain validera avant création.

Vétérinaires du cabinet (utilise EXACTEMENT ces prénoms) : ${prenoms}.
${blocCreneaux}${blocTags}${blocRoles}
${CATALOGUE_PROMPT}

Règles de comportement :
- Réponds toujours en français, dans "comprehension" reformule la demande, dans "message" explique brièvement ta proposition.
- Si la demande correspond à un des types ci-dessus : faisable=true, remplis brique_id, veterinaire, force, et mets les paramètres DE CE TYPE dans "params_json".
- "params_json" est une CHAÎNE contenant un objet JSON valide, avec EXACTEMENT les noms de paramètres listés pour le type choisi, et RIEN d'autre. Exemples : {"jour":"mercredi","exception_vacances_scolaires":false} · {"n":2,"fenetre":"glissante_30_jours","creneaux":["weekend"]} · {"mode_composition":"pas_seuls","tag":"junior"}. N'y mets jamais les paramètres d'un autre type.
- Respecte le TYPE de chaque paramètre : un nombre s'écrit 3 et non "3", un booléen true et non "true", une liste ["weekend"] et non "weekend".
- Si la demande est ambiguë (jour manquant, véto non précisé, etc.) OU n'est pas réalisable : faisable=false, omets brique_id et params_json, et explique dans "message".
- IMPORTANT — ton du "message" quand faisable=false : parle comme à un vétérinaire, AVEC SES MOTS. Ne mentionne JAMAIS « les 6 types de règles », « brique », ni aucun terme technique ou interne. Si c'est ambigu, demande simplement la précision manquante. Si la demande sort du périmètre (ce n'est pas une règle de planning de gardes), dis-le simplement et invite à reformuler autrement — sans lister de catalogue.
- Choisis une force par défaut raisonnable si l'utilisateur ne la précise pas (souvent sauf_crise, ou jamais pour une interdiction nette).
- N'invente jamais un prénom hors de la liste.
- N'invente jamais un code de créneau : "creneaux" n'accepte QUE les codes listés ci-dessus (sinon laisse creneaux=null).`
}

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

  const client = new Anthropic({ apiKey: cleIA() })
  const system = systemPour(vets, typesCreneaux, tagsEquipe, rolesCabinet)

  const response = await client.messages.parse({
    model: modeleIA(),
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    // MISE EN CACHE DU PROMPT. Mesuré le 2026-07-26 : le prompt pèse 6 225
    // tokens contre 150-350 de réponse, soit ~80 % du coût de chaque demande.
    // Comme il est identique d'une demande à l'autre (même cabinet, mêmes
    // créneaux), l'API peut le garder en mémoire et ne le refacturer qu'au
    // dixième du prix. Sur un admin qui enchaîne plusieurs règles, la demande
    // passe d'environ 3,9 ¢ à 1 ¢ — sans changer de modèle ni rien perdre.
    //
    // Le prompt doit rester IDENTIQUE À L'OCTET pour que le cache serve : c'est
    // pour ça qu'il ne contient ni date, ni horodatage, ni identifiant de
    // session. Ne jamais en ajouter.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: phrase }],
    output_config: { format: zodOutputFormat(SortieIaSchema) },
  })

  const brut = response.parsed_output
  if (!brut) {
    throw new Error("L'assistant n'a pas pu structurer sa réponse. Reformule ta demande.")
  }
  // Les params omis reviennent `undefined` (schéma `optional`) : on les remet à
  // `null` pour que l'aval n'ait qu'une seule forme d'absence à gérer.
  return normaliserProposition(brut)
}
