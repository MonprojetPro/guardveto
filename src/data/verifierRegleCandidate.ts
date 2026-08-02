// ============================================================
// GUARDVETO — Le gardien : ce que cette règle-là casserait
// ============================================================
// PRINCIPE DU PROJET (rappel, parce que tout ce fichier en découle) :
// le MOTEUR et ses garde-fous décident, Filou n'est que le porte-parole. Ce
// module est donc du calcul pur côté serveur — aucun appel d'IA, aucune
// invention possible, aucun coût par validation. Filou met en français ce que
// ce calcul a trouvé, et propose de corriger ou d'annuler.
//
// CE QUE ÇA FAIT
//
// `pre-vol.ts` sait déjà détecter onze familles d'incohérences (un véto que ses
// règles écartent de tout, un créneau que plus personne ne peut pourvoir, une
// étiquette sans porteur, une règle qui vise quelqu'un sorti de l'effectif…).
// Mais il ne tournait qu'AU MOMENT DE GÉNÉRER — c'est-à-dire des jours après
// la saisie, quand plus personne ne se souvient de la règle en cause.
//
// Ici, on le lance DEUX FOIS : une fois sur les règles telles qu'elles sont,
// une fois avec la règle candidate ajoutée. La différence entre les deux, c'est
// exactement ce que CETTE règle apporte comme problème.
//
// LE DELTA EST LE CŒUR DU TRUC. Sans lui, un cabinet qui traîne déjà trois
// avertissements les reverrait à chaque enregistrement de règle, y compris
// quand la règle qu'on vient d'écrire n'y est pour rien. Un avertissement qui
// se déclenche toujours n'avertit plus de rien : on apprend à cliquer
// « Enregistrer quand même » sans lire, et le gardien devient un péage.
//
// SUR QUELLE PÉRIODE ?
//
// Une règle est presque toujours PERMANENTE (aucune des règles du cabinet
// n'est scopée à une période, cf. l'audit du 2026-08-01). Mais le pré-vol a
// besoin d'un calendrier concret pour compter des places et des week-ends. On
// prend donc une période de référence : celle en cours, sinon la prochaine,
// sinon la plus récente. Aucune période en base → on ne peut rien simuler, et
// on le DIT (`indisponible`) au lieu de laisser croire que tout va bien.
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

/** Le verdict rendu à l'écran. */
export interface VerdictGardien {
  /**
   * `false` quand le contrôle n'a PAS pu tourner (aucune période en base,
   * chargement en échec). L'écran doit alors enregistrer sans prétendre que
   * la règle a été vérifiée — un gardien muet qui passe pour un gardien
   * satisfait est pire que pas de gardien du tout.
   */
  verifie: boolean
  /** Ce que LA RÈGLE CANDIDATE apporte comme problème (delta). */
  avertissements: AvertissementPreVol[]
  /** Libellé de la période sur laquelle le contrôle a tourné (pour le dire). */
  periodeTestee?: string
}

/** Les colonnes de `regles_cabinet` que le mapper attend. */
const COLONNES_REGLES =
  'id, cabinet_id, periode_id, brique_id, params_json, force, validite_json, version, actif'

/**
 * La période sur laquelle simuler : celle qui court aujourd'hui, sinon la
 * prochaine à venir, sinon la plus récente. On ne prend pas les périodes
 * VERROUILLÉES : leur planning est figé, une règle nouvelle ne les concernera
 * jamais — les compter fabriquerait des avertissements sans objet.
 */
async function periodeDeReference(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
): Promise<{ id: string; label: string } | null> {
  const { data } = await supabase
    .from('periodes')
    .select('id, nom, date_debut, date_fin, statut')
    .eq('cabinet_id', cabinetId)
    .neq('statut', 'verrouille')
    .order('date_debut', { ascending: false })
  const rows = (data ?? []) as Array<{
    id: string; nom: string | null; date_debut: string; date_fin: string
  }>
  if (rows.length === 0) return null

  const label = (r: { id: string; nom: string | null }) => ({
    id: r.id,
    label: r.nom ?? 'la période en cours',
  })

  const aujourdhui = new Date().toISOString().slice(0, 10)
  const enCours = rows.find((r) => r.date_debut <= aujourdhui && aujourdhui <= r.date_fin)
  if (enCours) return label(enCours)

  // `rows` est trié du plus récent au plus ancien : la prochaine à venir est
  // donc la DERNIÈRE de celles qui commencent après aujourd'hui.
  const aVenir = rows.filter((r) => r.date_debut > aujourdhui)
  if (aVenir.length > 0) return label(aVenir[aVenir.length - 1])

  return label(rows[0])
}

/** Clé d'identité d'un avertissement — deux avertissements identiques ne
 *  doivent pas compter comme « nouveau » parce que l'ordre a bougé. */
function cle(a: AvertissementPreVol): string {
  return `${a.code}::${[...a.regles].sort().join('|')}::${a.message}`
}

/**
 * Lance le pré-vol avec et sans la règle candidate, et renvoie ce que la règle
 * ajoute.
 *
 * @param rowCandidate  la règle en cours de saisie, sous la forme EXACTE qu'elle
 *                      aura en base (cf. `lib/regles/paramsRegle.ts`). En
 *                      édition, son `id` est celui de la règle éditée : elle
 *                      REMPLACE alors l'ancienne version au lieu de s'y ajouter.
 */
export async function verifierRegleCandidate(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  rowCandidate: RegleCabinetRow,
): Promise<VerdictGardien> {
  const periode = await periodeDeReference(supabase, cabinetId)
  if (!periode) return { verifie: false, avertissements: [] }

  try {
    const contexte = await resoudreContexte(periode.id, cabinetId)

    // Les règles telles qu'elles sont en base — mêmes colonnes, même filtre
    // « permanente OU de cette période » que le loader du moteur. Un filtre
    // différent ici comparerait deux mondes, et le delta ne voudrait rien dire.
    const { data: reglesDb } = await supabase
      .from('regles_cabinet')
      .select(COLONNES_REGLES)
      .eq('cabinet_id', cabinetId)
      .or(`periode_id.is.null,periode_id.eq.${periode.id}`)
      .order('id')
    const rows = ((reglesDb ?? []) as RegleCabinetRow[]).filter((r) => r.actif)

    const { data: briquesDb } = await supabase.from('briques_regles').select('id')
    const briquesConnues = new Set(
      ((briquesDb ?? []) as Array<{ id: string }>).map((b) => b.id),
    )

    // L'annuaire COMPLET (actifs + sortis) : c'est ce qui permet au pré-vol de
    // nommer un véto qui n'est plus dans l'effectif au lieu d'afficher un UUID.
    const { data: vetsDb } = await supabase
      .from('veterinaires')
      .select('id, prenom, nom, actif')
      .eq('cabinet_id', cabinetId)
    const annuaire = (vetsDb ?? []) as VetAnnuaire[]

    // En ÉDITION, la candidate remplace la version enregistrée : sans ce
    // filtre, on jugerait un monde où la règle existe deux fois.
    const rowsApres = [...rows.filter((r) => r.id !== rowCandidate.id), rowCandidate]

    const avant = lancerPreVol(contexte, rows, briquesConnues, annuaire)
    const apres = lancerPreVol(contexte, rowsApres, briquesConnues, annuaire)

    const dejaLa = new Set(avant.map(cle))
    return {
      verifie: true,
      avertissements: apres.filter((a) => !dejaLa.has(cle(a))),
      periodeTestee: periode.label,
    }
  } catch {
    // Un contrôle qui échoue ne doit JAMAIS empêcher d'enregistrer une règle :
    // il s'annonce simplement comme n'ayant pas tourné.
    return { verifie: false, avertissements: [] }
  }
}

/**
 * Rejoue le pré-vol sur un jeu de règles donné, en refaisant les trois
 * extractions du loader (contraintes par véto, structure, équité). Les refaire
 * n'est pas du zèle : une règle de composition ou une cohorte d'équité ne
 * voyage PAS dans les contraintes des vétos, elle vit dans `structureConfig` et
 * `equityWeights`. Ne remplacer que les contraintes rendrait le gardien aveugle
 * à toutes les règles par étiquette — c'est-à-dire à celles qui posent le plus
 * souvent problème.
 */
function lancerPreVol(
  contexte: Awaited<ReturnType<typeof resoudreContexte>>,
  rows: RegleCabinetRow[],
  briquesConnues: ReadonlySet<string>,
  annuaire: VetAnnuaire[],
): AvertissementPreVol[] {
  const { contraintesParVet } = mapperReglesCabinet(rows, briquesConnues)
  const structureConfig = extraireStructureConfig(rows)
  const equityWeights = buildEquityWeights(extraireEquityRules(rows))

  // Les vétos du contexte portent les contraintes du monde RÉEL : on les
  // remplace par celles du monde simulé, puis on renormalise — le pré-vol lit
  // des règles dépliées (parade à la cécité « params »).
  const vets = normaliserContraintesVets(
    contexte.vets.map((v) => ({ ...v, contraintes: contraintesParVet.get(v.id) ?? [] })),
  )

  return preVolRegles({
    vets,
    dateDebut: contexte.dateDebut,
    dateFin: contexte.dateFin,
    saison: contexte.saison,
    calendrier: contexte.calendrier,
    structureConfig,
    creneaux: contexte.creneaux,
    nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
    annuaire,
    contraintesParVet,
    cohortesEquite: equityWeights.cohortes,
  })
}
