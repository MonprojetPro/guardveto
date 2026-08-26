// ============================================================
// GUARDVETO — Outils de Filou : les règles du cabinet
// ============================================================
// SERVER-ONLY. Filou savait déjà CRÉER une règle et agir sur celles qui
// existent ; il ne savait pas les LIRE pour répondre à une question. C'est ce
// que cet outil ajoute — et c'est ce qui lui permet de dire « aucune règle ne
// l'empêche » en l'ayant vraiment vérifié.
//
// Les règles sont nommées par la source unique `phraseRegle`, la même que
// l'écran Règles : Filou doit désigner une règle exactement comme l'écran
// l'affiche, sinon on ne parle pas de la même chose.
// ============================================================

import { z } from 'zod'
import {
  phraseRegle,
  fusionnerDuos,
  reglesVisees,
  type RegleNommable,
} from '@/lib/regles/libelle'
import {
  proposerRegleDepuisTexte,
  appliquerActionRegles,
  setRegleActif,
} from '@/app/(protected)/regles/actions'
import type { ForceFormulaire } from '@/lib/regles/paramsRegle'
import {
  creerRegleProposee,
  estCreable,
  sansErreur,
  forceProposee,
  FORCE_LABEL,
  FORCES_ORDRE,
} from '@/components/ia/creerRegleProposee'
import { lignesLues } from './lecture'
import type { ContexteOutil, OutilEcriture, OutilLecture } from './types'

/** Familles de règles qui ne visent personne en particulier : elles règlent le
 *  planning dans son ensemble (équité, structure du week-end, composition). */
const GLOBALES = new Set([
  'equilibrer', 'liaison_creneaux', 'inversion_role',
  'composition_equipe', 'role_interdit_tag',
  'eviter_we_consecutifs', 'eviter_we_avant_vacances',
  'eviter_fete_fin_annee', 'inversion_role_ferie',
])

const FORCE_HUMAINE: Record<string, string> = {
  invariant: 'invariant (jamais contournable)',
  reglementaire: 'réglementaire',
  jamais: 'interdiction ferme',
  sauf_crise: 'à éviter sauf crise',
  evitee: 'à éviter',
  si_possible: 'préférence',
}

type RegleRow = RegleNommable & { force: string; actif: boolean; periode_id: string | null }

const ParamsLister = z.object({
  prenom: z
    .string()
    .optional()
    .describe(
      'Pour ne garder que les règles qui visent ce vétérinaire. Laisse vide pour tout voir.',
    ),
})

export const listerRegles: OutilLecture<typeof ParamsLister> = {
  genre: 'lecture',
  nom: 'lister_regles',
  description: `Donne les règles du cabinet, en français, avec leur puissance (interdiction ferme, à éviter, préférence…) et si elles sont actives ou en pause.

Appelle-le pour toute question sur ce qui contraint le planning : « quelles règles concernent Antoine ? », « pourquoi Manon n'a-t-elle jamais le mercredi ? », « qu'est-ce qui empêche X ? ».

La réponse contient aussi un champ « reglages_hors_regles » : ce sont des réglages de fiche qui pèsent sur le planning SANS être des règles (dernier recours, retrait du planning). Quand il n'est pas vide, tu DOIS en parler dans ta réponse — sinon tu dis vrai sur les règles et tu induis en erreur sur le fond. Un congé ou la structure des créneaux jouent aussi : va les lire avant de conclure « rien ne l'empêche ».`,
  params: ParamsLister,

  async executer(params, ctx) {
    // ⚠️ MÊME lecture que `agir_sur_regles` — c'est ce qui donne son sens au
    // numéro (B-036, 2026-08-26).
    //
    // Cette lecture-ci triait par `brique_id` SEUL, l'autre par `brique_id` puis
    // `id`. Deux tris pour une seule numérotation : Postgres ne garantit aucun
    // ordre entre lignes de même `brique_id`, donc « la n°13 » n'y désignait pas
    // la même règle. Mesure sur les donnees reelles du cabinet de demonstration :
    // 13 regles sur 22 changeaient de place, et les QUATRE `interdire_creneau`
    // etaient integralement inversees. Filou lisait « n°13 = Victor, repos du
    // lundi », demandait d'agir sur la 13, et l'action visait « Anne-Catherine,
    // mercredi apres-midi ». Vu a l'ecran par MiKL, devant la cliente.
    //
    // Le correctif n'est donc pas d'ajouter le tri manquant ici — c'est de
    // n'avoir qu'UNE lecture. Deux tris qu'il faut penser a garder identiques
    // finissent toujours par diverger ; le commentaire de `resoudreNumeros`
    // affirmait d'ailleurs qu'ils l'étaient déjà.
    const [rows, repVets] = await Promise.all([
      chargerReglesCabinet(ctx),
      ctx.supabase.from('veterinaires').select('id, prenom'),
    ])

    // « Aucune règle ne concerne Antoine » est une affirmation catégorique : une
    // lecture en panne ne doit jamais la produire.
    const vets = lignesLues<{ id: string; prenom: string }>(repVets, "la liste de l'équipe")
    const prenoms = new Map(vets.map((v) => [v.id, v.prenom]))
    const nomVeto = (id: string) => prenoms.get(id) ?? 'un vétérinaire'

    // Le filtre par prénom se fait sur la PHRASE rendue, pas sur les
    // identifiants : une règle peut viser plusieurs personnes, et le nom
    // apparaît alors dans le sujet comme dans le prédicat (duo, « seulement
    // avec »…). Chercher dans la phrase les attrape toutes.
    const cible = params.prenom?.trim().toLowerCase()

    // Le numéro est attribué AVANT le filtre, sur la liste complète : il désigne
    // donc toujours la même règle, qu'on ait filtré ou non. Sans ça, « la n°3 »
    // d'une liste filtrée et « la n°3 » de la liste entière seraient deux règles
    // différentes — et l'action porterait sur la mauvaise.
    const rendues = rows.map((r, i) => ({
      numero: i + 1,
      regle: phraseRegle(r, nomVeto),
      puissance: FORCE_HUMAINE[r.force] ?? r.force,
      active: r.actif,
      portee: r.periode_id ? 'limitée à une période' : 'permanente',
      globale: GLOBALES.has(r.brique_id),
    }))

    const filtrees = cible
      ? rendues.filter((r) => r.regle.toLowerCase().includes(cible))
      : rendues

    // CE QUI CONTRAINT SANS ÊTRE UNE RÈGLE.
    // Une question sur « les règles de X » attend en réalité « ce qui contraint
    // X ». Or le statut de dernier recours et le retrait du planning vivent sur
    // la fiche du vétérinaire, pas dans les règles — et Filou répondait la
    // liste des règles sans les mentionner : exact, et trompeur.
    // On porte donc l'information DANS LA DONNÉE plutôt que d'espérer qu'il
    // pense à consulter l'équipe : une consigne dans un prompt n'est pas un
    // garde-fou, elle repose sur sa mémoire.
    const horsRegles = await reglagesQuiContraignent(ctx, params.prenom)

    return {
      nombre: filtrees.length,
      regles: filtrees,
      reglages_hors_regles: horsRegles,
      note: cible
        ? `Règles dont le texte mentionne « ${params.prenom} ». Les numéros restent ceux de la liste complète, tu peux donc les réutiliser tels quels. Les règles globales (équité, structure du week-end) ne nomment personne et n'apparaissent pas ici — demande la liste complète pour les voir.`
        : 'Les règles marquées « globale » règlent le planning dans son ensemble et ne visent personne en particulier.',
    }
  },
}

// ── Écriture : créer une règle ──────────────────────────────
//
// L'outil DÉLÈGUE la traduction à l'assistant règles existant, qui est recetté
// et connaît les 26 briques du moteur. On ne redemande pas au modèle de remplir
// lui-même une règle structurée : c'est ce schéma-là qui a mis l'assistant à
// terre en production le 2026-07-26 en dépassant les plafonds de l'API.
//
// Ce que l'aperçu a obtenu voyage en `charge` jusqu'à l'exécution : refaire
// l'appel au moment d'écrire produirait peut-être une AUTRE règle que celle
// affichée — on montrerait A et on créerait B.

const ParamsCreer = z.object({
  demande: z
    .string()
    .describe(
      'La contrainte à créer, formulée en une phrase complète et autonome, à la troisième personne. Ex. « Manon ne fait jamais de garde le mercredi ».',
    ),
  puissance: z
    .enum(['jamais', 'sauf_crise', 'evitee', 'si_possible'])
    .optional()
    .describe(
      'jamais = interdiction ferme ; sauf_crise = à éviter sauf crise ; evitee / si_possible = simple préférence. Ne le précise que si la personne a exprimé une nuance ; sinon laisse l’assistant décider.',
    ),
})

export const creerRegle: OutilEcriture<typeof ParamsCreer> = {
  genre: 'ecriture',
  nom: 'creer_regle',
  description: `Prépare la création d'une NOUVELLE règle du cabinet à partir d'une phrase en français.

Appelle-le quand la demande ajoute une contrainte qui n'existe pas encore : « Manon ne fait jamais de garde le mercredi », « au moins 3 jours entre deux gardes pour Antoine », « un junior n'est jamais seul de garde ».

Avant d'appeler, vérifie avec lister_regles qu'une règle équivalente n'existe pas déjà — sinon tu créerais un doublon. Si la demande LÈVE une contrainte existante, ce n'est pas cet outil : c'est agir_sur_regles.

Rien n'est enregistré tant que la personne n'a pas validé.`,
  params: ParamsCreer,
  adminSeulement: true,

  async resumer(params) {
    const res = await proposerRegleDepuisTexte(params.demande)
    if (!sansErreur(res)) return { ok: false, raison: res.error }
    if (!estCreable(res)) {
      return {
        ok: false,
        raison:
          res.proposition.message ||
          "Je n'arrive pas à traduire cette demande en règle du cabinet.",
      }
    }

    const force = (params.puissance as ForceFormulaire | undefined) ?? forceProposee(res)
    return {
      ok: true,
      proposition: {
        titre: 'Créer une règle',
        phrase: res.apercu,
        lignes: force ? [`Puissance : ${FORCE_LABEL[force]}`] : undefined,
        action: 'Créer cette règle',
        avertissement:
          'Une règle ne réécrit pas le planning déjà posé : elle s’applique à la prochaine génération.',
      },
      charge: { res, force },
    }
  },

  async executer(_params, _ctx, charge) {
    const c = charge as { res?: Parameters<typeof creerRegleProposee>[0]; force?: ForceFormulaire } | undefined
    if (!c?.res) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    // `creerRegleProposee` aiguille vers la bonne action serveur, laquelle
    // reconstruit le params_json côté serveur : la charge venue du navigateur
    // ne peut pas fabriquer une règle que le formulaire n'aurait pas pu créer.
    const force = c.force && FORCES_ORDRE.includes(c.force) ? c.force : null
    return creerRegleProposee(c.res, force)
  },
}

// ── Écriture : agir sur les règles existantes ───────────────

const ParamsAgir = z.object({
  numeros: z
    .array(z.number().int())
    .min(1)
    .describe(
      'Les numéros des règles concernées, tels que lister_regles les a donnés (la 1re règle = 1).',
    ),
  action: z
    .enum(['desactiver', 'supprimer', 'activer'])
    .describe(
      'desactiver = mettre en pause (réversible) ; supprimer = effacer définitivement, seulement si la demande le dit clairement ; activer = remettre en service une règle en pause.',
    ),
})

export const agirSurRegles: OutilEcriture<typeof ParamsAgir> = {
  genre: 'ecriture',
  nom: 'agir_sur_regles',
  description: `Prépare la mise en pause, la suppression ou la remise en service de règles qui EXISTENT DÉJÀ.

Appelle-le quand la demande lève une contrainte posée — « Anne-Catherine peut désormais travailler le jeudi soir », « enlève la règle du mercredi », « remets la règle sur les week-ends ».

Appelle TOUJOURS lister_regles juste avant et prends les numéros dans sa réponse : ils restent valables même si tu as filtré par prénom.

Préfère la mise en pause à la suppression : la pause se rattrape, l'effacement non.`,
  params: ParamsAgir,
  adminSeulement: true,

  async resumer(params, ctx) {
    const cibles = await resoudreNumeros(params.numeros, ctx)
    if (!cibles.ok) return { ok: false, raison: cibles.raison }

    const n = cibles.regles.length
    const verbe =
      params.action === 'supprimer'
        ? 'supprimer définitivement'
        : params.action === 'desactiver'
          ? 'mettre en pause'
          : 'remettre en service'

    return {
      ok: true,
      proposition: {
        titre: `${n > 1 ? `${n} règles` : 'Une règle'} à ${verbe}`,
        phrase: `Je vais ${verbe} ${n > 1 ? 'ces règles' : 'cette règle'} :`,
        lignes: cibles.regles.map((r) => `${r.actif ? '🔴' : '⏸'} ${r.libelle}`),
        action:
          params.action === 'supprimer'
            ? 'Supprimer définitivement'
            : params.action === 'desactiver'
              ? 'Mettre en pause'
              : 'Remettre en service',
        avertissement:
          params.action === 'supprimer'
            ? 'La suppression ne se rattrape pas. Le planning déjà publié ne bouge pas.'
            : 'Le planning déjà publié ne bouge pas : le changement vaut pour la prochaine génération.',
      },
      charge: { ids: cibles.regles.map((r) => r.id) },
    }
  },

  async executer(params, ctx, charge) {
    // Les identifiants retenus à l'aperçu font foi. On les revérifie quand même
    // contre la liste du cabinet : le navigateur a pu les altérer entre-temps.
    const ids = (charge as { ids?: unknown })?.ids
    const demandes = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : []
    if (demandes.length === 0) {
      return { error: 'La proposition a été perdue — redemande-la à Filou.' }
    }
    const connues = await chargerReglesCabinet(ctx)
    const legitimes = demandes.filter((id) => connues.some((r) => r.id === id))
    if (legitimes.length !== demandes.length) {
      return { error: 'Certaines règles visées n’existent plus. Redemande la liste à Filou.' }
    }
    // Une seule règle en pause/reprise passe par le même chemin que le bouton
    // de l'écran Règles ; le lot repasse par l'action de lot, elle-même bâtie
    // sur ces mêmes actions.
    if (legitimes.length === 1 && params.action !== 'supprimer') {
      const r = await setRegleActif(legitimes[0], params.action === 'activer')
      return 'error' in r ? { error: r.error } : {}
    }
    const r = await appliquerActionRegles(legitimes, params.action)
    return 'error' in r ? { error: r.error } : {}
  },
}

// ── Fragments partagés ──────────────────────────────────────

/**
 * Les réglages de fiche qui pèsent sur le planning sans être des règles :
 * le dernier recours et le retrait du planning. Renvoyés AVEC la liste des
 * règles pour qu'une réponse sur « ce qui contraint quelqu'un » ne puisse pas
 * les oublier.
 *
 * Rendu en phrases toutes faites plutôt qu'en booléens : c'est ce qui doit
 * arriver à l'écran, et une paire `dernier_recours: true` se reformule mal.
 */
async function reglagesQuiContraignent(
  ctx: ContexteOutil,
  prenom?: string,
): Promise<string[]> {
  const vets = lignesLues<{ id: string; prenom: string; actif: boolean; dernier_recours: boolean }>(
    await ctx.supabase
      .from('veterinaires')
      .select('id, prenom, actif, dernier_recours')
      .order('prenom'),
    "la liste de l'équipe",
  )
  const cible = prenom?.trim().toLowerCase()
  let concernes = cible
    ? vets.filter((v) => v.prenom.toLowerCase() === cible)
    : vets

  // ⛔ MEME DONNEE QUE lire_equipe, PAR UNE AUTRE BOUCHE.
  //
  // Sans prenom precis, cette fonction enumerait toute l'equipe et poussait une
  // phrase nominative pour chaque personne marquee DERNIER RECOURS. Restreindre
  // lire_equipe sans restreindre ceci n'aurait servi a rien.
  //
  // Un veterinaire garde le droit de savoir que LUI est en dernier recours —
  // c'est meme la reponse la plus utile qu'il puisse recevoir, celle qui
  // explique pourquoi il n'a presque jamais de garde.
  if (!ctx.estAdmin) concernes = concernes.filter((v) => v.id === ctx.vetoId)

  const phrases: string[] = []
  for (const v of concernes) {
    if (v.dernier_recours) {
      phrases.push(
        `${v.prenom} est marqué DERNIER RECOURS sur sa fiche : ce n'est pas une règle, mais la génération ne le programme JAMAIS, même s'il ne reste personne d'autre — elle annonce alors qu'elle est bloquée. Il reste proposé quand on modifie une garde à la main, et il reçoit les appels aux volontaires. C'est la vraie raison quand quelqu'un n'a jamais de garde alors qu'aucune règle ne l'en empêche.`,
      )
    }
    if (!v.actif) {
      phrases.push(
        `${v.prenom} est RETIRÉ DU PLANNING sur sa fiche : aucune garde ne lui sera attribuée, quelles que soient les règles.`,
      )
    }
  }
  return phrases
}

/**
 * LA lecture des règles du cabinet — la seule. `lister_regles` (qui numérote) et
 * `agir_sur_regles` (qui résout le numéro) passent tous les deux par ici.
 *
 * ⚠️ `.order('id')` n'est PAS un détail de confort : c'est lui qui rend l'ordre
 * déterministe. Postgres ne garantit aucun ordre entre lignes de même
 * `brique_id`, et ce cabinet en a quatre `interdire_creneau`, six `equilibrer`,
 * trois `repos_conditionnel`. Sans ce second critère, deux lectures successives
 * peuvent rendre des ordres différents — et le numéro, qui n'a de sens que par
 * la position, désigne alors une autre règle. Ne jamais retirer ce tri, et ne
 * jamais recopier cette requête ailleurs : c'est la duplication qui a causé
 * B-036.
 */
async function chargerReglesCabinet(ctx: ContexteOutil): Promise<Array<RegleRow>> {
  return fusionnerDuos(
    lignesLues<RegleRow>(
      await ctx.supabase
        .from('regles_cabinet')
        .select('id, brique_id, params_json, force, actif, periode_id')
        .order('brique_id')
        .order('id'),
      'les règles du cabinet',
    ),
  )
}

/** Traduit les numéros donnés par le modèle en règles réelles, sur la liste
 *  COMPLÈTE et dans le même ordre que `lister_regles` — c'est ce qui garantit
 *  qu'un « R3 » désigne bien la règle que Filou a lue.
 *
 *  Cette phrase était FAUSSE jusqu'au 2026-08-26 : les deux passaient par des
 *  requêtes distinctes, aux tris différents. Elle n'est vraie que depuis qu'il
 *  n'y a plus qu'une lecture (`chargerReglesCabinet`), et le test
 *  `tests/lib/regles-numerotation-stable.test.ts` la maintient vraie. */
async function resoudreNumeros(
  numeros: number[],
  ctx: ContexteOutil,
): Promise<
  | { ok: true; regles: Array<{ id: string; libelle: string; actif: boolean }> }
  | { ok: false; raison: string }
> {
  const rows = await chargerReglesCabinet(ctx)
  const prenoms = new Map(
    lignesLues<{ id: string; prenom: string }>(
      await ctx.supabase.from('veterinaires').select('id, prenom'),
      "la liste de l'équipe",
    ).map((v) => [v.id, v.prenom]),
  )
  const libelles = rows.map((r) => phraseRegle(r, (id) => prenoms.get(id) ?? 'un vétérinaire'))

  const regles = reglesVisees(rows, libelles, numeros)
  if (regles.length === 0) {
    return {
      ok: false,
      raison:
        'Aucun de ces numéros ne correspond à une règle du cabinet. Redemande la liste complète avant d’agir.',
    }
  }
  return { ok: true, regles }
}
