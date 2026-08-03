// ============================================================
// GUARDVETO — Le contrôle d'impact : « qu'est-ce que ça casse ? »
// ============================================================
// PRINCIPE FONDAMENTAL DU PROJET, celui dont tout le reste découle :
//
//   « Chaque règle, chaque élément de structure doit TOUJOURS être vérifié
//     avec ce qui existe déjà, et les conséquences signalées à l'utilisateur. »
//
// Ce module en est le moteur. Il ne juge rien lui-même : il rejoue le pré-vol
// (`engine/pre-vol.ts`, onze familles d'incohérences) DEUX FOIS — le monde tel
// qu'il est, puis le monde tel qu'il serait après la modification — et renvoie
// la différence. Aucun appel d'IA, aucune invention possible : le moteur
// trouve, Filou met en français.
//
// POURQUOI ICI, ET PAS DANS L'ÉCRAN (audit du 2026-08-03)
//
// Le gardien existait déjà, mais il vivait dans le composant React de l'écran
// Règles. Conséquence mesurée : Filou écrivait des règles sans aucun contrôle
// croisé, et les dix-sept actions de l'écran Organisation n'en avaient jamais
// eu. Un principe appliqué par discipline dans chaque écran finit toujours par
// être oublié dans le suivant. Ici, il est au niveau du SERVEUR, sur le chemin
// obligatoire de toute écriture — quelle que soit la porte d'entrée.
//
// LE DELTA EST LE CŒUR DU TRUC. Un cabinet qui traîne déjà trois avertissements
// les reverrait à chaque enregistrement, y compris quand la modification n'y
// est pour rien. Un avertissement qui se déclenche toujours n'avertit plus de
// rien : on apprend à cliquer « quand même » sans lire, et le gardien devient
// un péage. On ne montre donc QUE ce que cette modification-ci apporte.
//
// ON MONTRE AUSSI CE QU'ELLE RÉPARE. Une modification qui fait DISPARAÎTRE un
// avertissement est une bonne nouvelle, et la taire prive l'utilisateur du seul
// retour positif du système.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreContexte } from '@/data/resoudreContexte'
import {
  mapperReglesCabinet,
  extraireStructureConfig,
  extraireEquityRules,
  type RegleCabinetRow,
} from '@/data/mapReglesCabinet'
import { buildEquityWeights } from '@/engine/equity-weights'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import {
  preVolRegles,
  type AvertissementPreVol,
  type VetAnnuaire,
} from '@/engine/pre-vol'
import type { VetEngine } from '@/engine/types'

// ── Ce qu'on sait simuler ────────────────────────────────────

/**
 * Une modification du monde, décrite AVANT d'être appliquée.
 *
 * Chaque variante correspond à une porte d'entrée réelle du produit. En
 * ajouter une, c'est étendre le principe à un nouvel écran — et le compilateur
 * force alors à dire comment elle s'applique (`appliquerMutation`).
 */
export type Mutation =
  /** Une règle qu'on crée ou qu'on modifie (l'`id` existant = remplacement). */
  | { genre: 'regle_ajout'; row: RegleCabinetRow }
  /** Une règle qu'on met en pause ou qu'on supprime. */
  | { genre: 'regle_retrait'; regleId: string }
  /** Un vétérinaire qui quitte l'effectif de garde. */
  | { genre: 'veto_retire'; vetId: string }
  /** Les étiquettes d'un vétérinaire (composition d'équipe, rôles interdits). */
  | { genre: 'veto_tags'; vetId: string; tags: string[] }
  /** Un congé qu'on s'apprête à valider. */
  | { genre: 'conge_ajoute'; vetId: string; dateDebut: string; dateFin: string }
  /** L'effectif de garde des nuits de semaine. */
  | { genre: 'effectif_nuit'; nb: number }

/** Le verdict rendu à l'écran, quelle que soit la porte d'entrée. */
export interface Impact {
  /**
   * `false` quand le contrôle n'a PAS pu tourner (aucune période en base,
   * chargement en échec). L'écran doit alors enregistrer sans prétendre que
   * la modification a été vérifiée — un gardien muet qui passe pour un gardien
   * satisfait est pire que pas de gardien du tout.
   */
  verifie: boolean
  /** Ce que la modification APPORTE comme problème (delta). */
  nouveaux: AvertissementPreVol[]
  /**
   * Parmi eux, ceux qui rendent la génération IMPOSSIBLE. C'est la seule
   * catégorie qui barre la route (décision MiKL du 2026-08-03) : le reste
   * avertit et laisse passer sous la responsabilité de l'admin.
   */
  bloquants: AvertissementPreVol[]
  /** Ce que la modification RÉPARE — la bonne nouvelle, elle compte aussi. */
  repares: AvertissementPreVol[]
  /** Période sur laquelle le contrôle a tourné, pour pouvoir le dire. */
  periodeTestee?: string
  /**
   * Pourquoi le contrôle n'a pas pu tourner, quand c'est une panne et non une
   * absence de période. Remonté jusqu'à l'écran À DESSEIN : les logs runtime de
   * l'hébergeur ne se lisent pas depuis le poste de développement, et une panne
   * muette se corrige au hasard. Jamais affiché quand tout va bien.
   */
  diagnostic?: string
}

/** Les colonnes de `regles_cabinet` que le mapper attend. */
const COLONNES_REGLES =
  'id, cabinet_id, periode_id, brique_id, params_json, force, validite_json, version, actif'

// ── Le monde simulé ──────────────────────────────────────────

interface Monde {
  rows: RegleCabinetRow[]
  vets: VetEngine[]
  annuaire: VetAnnuaire[]
  nbVetosSemaineSoir?: number
}

/**
 * Applique une mutation sur une COPIE du monde. Rien n'est écrit en base : on
 * fabrique l'état qui existerait, on le donne au pré-vol, et on jette.
 *
 * Chaque cas explique ce qu'il touche, parce que se tromper de champ donne un
 * monde plausible mais faux — et un gardien qui se trompe est pire qu'absent.
 */
function appliquerMutation(monde: Monde, m: Mutation): Monde {
  switch (m.genre) {
    case 'regle_ajout':
      // En ÉDITION, la candidate REMPLACE la version enregistrée : sans ce
      // filtre, on jugerait un monde où la règle existe en double.
      return {
        ...monde,
        rows: [...monde.rows.filter((r) => r.id !== m.row.id), m.row],
      }

    case 'regle_retrait':
      return { ...monde, rows: monde.rows.filter((r) => r.id !== m.regleId) }

    case 'veto_retire':
      // Le véto quitte l'effectif MAIS reste dans l'annuaire, en inactif :
      // c'est ce qui permet au pré-vol de dire « une règle vise Machin, qui ne
      // fait plus partie de l'équipe » au lieu d'afficher un identifiant.
      return {
        ...monde,
        vets: monde.vets.filter((v) => v.id !== m.vetId),
        annuaire: monde.annuaire.map((a) =>
          a.id === m.vetId ? { ...a, actif: false } : a,
        ),
      }

    case 'veto_tags':
      // Tags normalisés comme à la source (minuscules, épurés) : tous les
      // consommateurs comparent des étiquettes déjà normalisées.
      return {
        ...monde,
        vets: monde.vets.map((v) =>
          v.id === m.vetId
            ? { ...v, tags: m.tags.map((t) => t.trim().toLowerCase()).filter(Boolean) }
            : v,
        ),
      }

    case 'conge_ajoute':
      return {
        ...monde,
        vets: monde.vets.map((v) =>
          v.id === m.vetId
            ? { ...v, conges: [...v.conges, { date_debut: m.dateDebut, date_fin: m.dateFin }] }
            : v,
        ),
      }

    case 'effectif_nuit':
      return { ...monde, nbVetosSemaineSoir: m.nb }
  }
}

/**
 * Clé d'identité d'un avertissement — deux avertissements identiques ne
 * doivent pas compter comme « nouveau » parce que l'ordre a bougé.
 */
function cle(a: AvertissementPreVol): string {
  return `${a.code}::${[...a.regles].sort().join('|')}::${a.message}`
}

/**
 * La période sur laquelle simuler.
 *
 * ORDRE DE PRÉFÉRENCE — et il n'est pas arbitraire : ce qu'on écrit
 * aujourd'hui s'appliquera à la PROCHAINE génération. On cherche donc d'abord
 * un planning pas encore publié (c'est lui qui subira la modification), puis la
 * période en cours, puis la plus récente comme terrain d'essai par défaut.
 *
 * Les périodes VERROUILLÉES sont exclues : leur planning est figé, une
 * modification ne les concernera jamais — les compter fabriquerait des
 * avertissements sans objet.
 *
 * ⚠️ La colonne du nom lisible est `libelle`, PAS `nom`. Demander une colonne
 *    inexistante ne lève pas d'exception côté client Supabase : la requête
 *    renvoie `data: null` et une `error`. Ignorer cette `error` se traduit par
 *    « aucune période », donc par un gardien MUET (bug du 2026-08-02).
 */
async function periodeDeReference(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
): Promise<{ id: string; label: string } | null> {
  const { data, error } = await supabase
    .from('periodes')
    .select('id, libelle, date_debut, date_fin, statut')
    .eq('cabinet_id', cabinetId)
    .neq('statut', 'verrouille')
    .order('date_debut', { ascending: false })

  if (error) throw new Error(`lecture des périodes impossible : ${error.message}`)

  const rows = (data ?? []) as Array<{
    id: string; libelle: string | null; date_debut: string; date_fin: string; statut: string
  }>
  if (rows.length === 0) return null

  const label = (r: { id: string; libelle: string | null }) => ({
    id: r.id,
    label: r.libelle ?? 'la période en cours',
  })

  const aujourdhui = new Date().toISOString().slice(0, 10)

  const aGenerer = rows.filter((r) => r.statut !== 'publie' && r.date_fin >= aujourdhui)
  if (aGenerer.length > 0) return label(aGenerer[aGenerer.length - 1])

  const enCours = rows.find((r) => r.date_debut <= aujourdhui && aujourdhui <= r.date_fin)
  if (enCours) return label(enCours)

  return label(rows[0])
}

// ── Le point d'entrée ────────────────────────────────────────

/**
 * Mesure ce qu'une modification changerait, SANS l'appliquer.
 *
 * Appelé par les actions serveur AVANT d'écrire. Ne lève jamais : un contrôle
 * en panne s'annonce comme n'ayant pas tourné (`verifie: false`) et laisse
 * l'écriture se faire — bloquer une modification légitime parce que le
 * gardien est cassé serait le pire des deux mondes.
 */
export async function mesurerImpact(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  mutation: Mutation,
): Promise<Impact> {
  const vide: Impact = { verifie: false, nouveaux: [], bloquants: [], repares: [] }
  try {
    // DANS le try : une lecture en échec doit ressortir comme une panne
    // annoncée, pas comme un « aucune période » silencieux.
    const periode = await periodeDeReference(supabase, cabinetId)
    if (!periode) return vide

    const contexte = await resoudreContexte(periode.id, cabinetId)

    // Les règles telles qu'elles sont en base — mêmes colonnes, même filtre
    // « permanente OU de cette période » que le loader du moteur. Un filtre
    // différent ici comparerait deux mondes, et le delta ne voudrait rien dire.
    // ⚠️ Chaque `error` est levée, jamais avalée : une requête qui échoue et
    //    qu'on traite comme « zéro ligne » fabrique un monde simulé FAUX.
    const { data: reglesDb, error: errRegles } = await supabase
      .from('regles_cabinet')
      .select(COLONNES_REGLES)
      .eq('cabinet_id', cabinetId)
      .or(`periode_id.is.null,periode_id.eq.${periode.id}`)
      .order('id')
    if (errRegles) throw new Error(`lecture des règles impossible : ${errRegles.message}`)
    const rows = ((reglesDb ?? []) as RegleCabinetRow[]).filter((r) => r.actif)

    const { data: briquesDb, error: errBriques } = await supabase
      .from('briques_regles')
      .select('id')
    if (errBriques) throw new Error(`lecture du catalogue impossible : ${errBriques.message}`)
    const briquesConnues = new Set(
      ((briquesDb ?? []) as Array<{ id: string }>).map((b) => b.id),
    )

    // L'annuaire COMPLET (actifs + sortis) : c'est ce qui permet au pré-vol de
    // nommer un véto qui n'est plus dans l'effectif au lieu d'un identifiant.
    const { data: vetsDb, error: errVets } = await supabase
      .from('veterinaires')
      .select('id, prenom, nom, actif')
      .eq('cabinet_id', cabinetId)
    if (errVets) throw new Error(`lecture de l'équipe impossible : ${errVets.message}`)
    const annuaire = (vetsDb ?? []) as VetAnnuaire[]

    const avantMonde: Monde = {
      rows,
      vets: contexte.vets,
      annuaire,
      nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
    }
    const apresMonde = appliquerMutation(avantMonde, mutation)

    const avant = lancerPreVol(contexte, avantMonde, briquesConnues)
    const apres = lancerPreVol(contexte, apresMonde, briquesConnues)

    const dejaLa = new Set(avant.map(cle))
    const resteApres = new Set(apres.map(cle))
    const nouveaux = apres.filter((a) => !dejaLa.has(cle(a)))

    return {
      verifie: true,
      nouveaux,
      bloquants: nouveaux.filter((a) => a.gravite === 'bloquant'),
      repares: avant.filter((a) => !resteApres.has(cle(a))),
      periodeTestee: periode.label,
    }
  } catch (e) {
    // Un contrôle qui échoue ne doit JAMAIS empêcher d'enregistrer : il
    // s'annonce simplement comme n'ayant pas tourné, en disant pourquoi.
    console.error('[controle-impact] pré-vol impossible :', e)
    return { ...vide, diagnostic: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Rejoue le pré-vol sur un monde donné, en refaisant les trois extractions du
 * loader (contraintes par véto, structure, équité). Les refaire n'est pas du
 * zèle : une règle de composition ou une cohorte d'équité ne voyage PAS dans
 * les contraintes des vétos, elle vit dans `structureConfig` et
 * `equityWeights`. Ne remplacer que les contraintes rendrait le contrôle
 * aveugle à toutes les règles par étiquette — c'est-à-dire à celles qui posent
 * le plus souvent problème.
 */
function lancerPreVol(
  contexte: Awaited<ReturnType<typeof resoudreContexte>>,
  monde: Monde,
  briquesConnues: ReadonlySet<string>,
): AvertissementPreVol[] {
  const { contraintesParVet } = mapperReglesCabinet(monde.rows, briquesConnues)
  const structureConfig = extraireStructureConfig(monde.rows)
  const equityWeights = buildEquityWeights(extraireEquityRules(monde.rows))

  // Les vétos du monde portent les contraintes de CE monde : on les remplace
  // puis on renormalise — le pré-vol lit des règles dépliées (parade à la
  // cécité « params »).
  const vets = normaliserContraintesVets(
    monde.vets.map((v) => ({ ...v, contraintes: contraintesParVet.get(v.id) ?? [] })),
  )

  return preVolRegles({
    vets,
    dateDebut: contexte.dateDebut,
    dateFin: contexte.dateFin,
    saison: contexte.saison,
    calendrier: contexte.calendrier,
    structureConfig,
    creneaux: contexte.creneaux,
    nbVetosSemaineSoir: monde.nbVetosSemaineSoir,
    annuaire: monde.annuaire,
    contraintesParVet,
    cohortesEquite: equityWeights.cohortes,
  })
}

// ── Le refus, formulé pour l'écran ───────────────────────────

/** Ce qu'une action serveur renvoie quand elle refuse à cause de l'impact. */
export interface RefusImpact {
  error: string
  /** Le détail, pour que l'écran propose les gestes de correction. */
  impact: Impact
}

/**
 * Le passage obligé avant toute écriture qui touche à ce que le moteur lit.
 *
 * Renvoie `null` quand on peut écrire, ou un refus formulé quand la
 * modification rendrait la génération IMPOSSIBLE — et seulement dans ce cas
 * (décision MiKL du 2026-08-03 : avertir toujours, bloquer seulement
 * l'impossible). Tout le reste passe et sera signalé à l'écran.
 *
 * `confirme` est la porte de sortie : l'admin à qui l'écran a montré les
 * conséquences peut décider d'écrire quand même. Filou, lui, ne confirme
 * jamais tout seul — il rapporte le refus et laisse l'humain trancher.
 */
export async function refusSiBloquant(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  mutation: Mutation,
  confirme = false,
): Promise<RefusImpact | null> {
  const impact = await mesurerImpact(supabase, cabinetId, mutation)

  // Contrôle en panne ou impossible à mener : on laisse écrire. Bloquer une
  // modification légitime parce que le gardien est cassé serait le pire des
  // deux mondes — et l'écran, lui, saura dire que rien n'a été vérifié.
  if (!impact.verifie) return null
  if (confirme) return null
  if (impact.bloquants.length === 0) return null

  const n = impact.bloquants.length
  return {
    error:
      `Cette modification rend le planning impossible à générer `
      + `(${n} point${n > 1 ? 's' : ''} bloquant${n > 1 ? 's' : ''}). `
      + impact.bloquants[0].message,
    impact,
  }
}
