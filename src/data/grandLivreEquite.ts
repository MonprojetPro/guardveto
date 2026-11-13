// ============================================================
// GUARDVETO — Lecture du grand livre d'équité (B-196, lot 0)
// ============================================================
// LA source de lecture du report d'équité inter-périodes. Le calcul, lui,
// est pur et vit dans `engine/grand-livre-equite.ts`.
//
// ⚠️ POURQUOI UNE SOURCE PARTAGÉE, ET PAS UNE REQUÊTE PAR ÉCRAN
//
// Avant ce lot, trois endroits parlaient d'équité inter-périodes et
// disaient trois choses différentes :
//   • le moteur reportait `ecart_we` de la seule période précédente ;
//   • l'écran Historique affichait, sous le libellé « ce que le moteur
//     traînait déjà », ce même écart de week-ends — donc une part de la
//     vérité présentée comme la vérité entière ;
//   • Filou, lui, lisait les quatre écarts de la période, sans aucun
//     cumul, et répondait encore autre chose.
//
// Trois vues divergentes d'un même chiffre, dont deux affirmaient quelque
// chose de faux sans que rien ne le signale. Ils lisent maintenant tous
// cette fonction. C'est la même parade que « un registre recense les
// fichiers, pas les endroits » : la cohérence vient de la source unique,
// jamais de la discipline de chaque appelant.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { chantierOuvert } from '@/lib/produit/chantiers'
import { cabinetEstBacASable } from '@/lib/produit/chantiers-serveur'
import {
  construireReport,
  cumulerEcarts,
  type CumulEcarts,
  type LigneBilan,
  type ReportEquiteMap,
} from '@/engine/grand-livre-equite'

/** Ce que le grand livre rend : la dette réelle, et ce que le moteur en applique. */
export interface GrandLivre {
  /** Cumul BRUT par véto (`> 0` = a fait plus que sa part). Tous les vétos lus. */
  cumul: Record<string, CumulEcarts>
  /** Report appliqué par le moteur : cumul inversé puis PLAFONNÉ, effectif seul. */
  report: ReportEquiteMap
  /** Periodes closes qui ont VRAIMENT un bilan — celles qui nourrissent le cumul. */
  nbPeriodes: number
  /**
   * Periodes closes AVANT celle-ci, bilan ou pas.
   *
   * ⚠️ DIFFERENT de `nbPeriodes`, et la difference porte un message. Un
   * bilan n'existe que si quelqu'un a clique « Calculer le bilan » ou que
   * le cron a verrouille la periode. Le cas courant — periode precedente
   * publiee, bilan jamais calcule — donne donc `nbPeriodes: 0` avec des
   * periodes closes bien reelles. Sans ce second compteur, l'ecran disait
   * « aucune periode close avant celle-ci : rien a rattraper » : une bonne
   * nouvelle fausse, qui masquait en plus le geste qui debloque tout.
   */
  nbPeriodesCloses: number
  /**
   * Les vetos qui ont un ecart mais AUCUN rattrapage possible : le dernier
   * recours, hors de l'effectif de generation.
   *
   * ⚠️ DONNE EXPLICITEMENT, JAMAIS DEDUIT. L'ecran le deduisait d'un
   * `cumul` sans `report` — or `construireReport` n'enregistre pas un
   * report entierement nul, donc tout veto dont les ecarts s'annulent
   * (+1 une periode, -1 la suivante : cas banal) tombait dans le meme
   * sac. Anne-So lisait alors, nommement, qu'un de ses titulaires
   * « n'est pas candidat aux gardes ». Releve par la revue du 13/11.
   */
  horsRotation: string[]
  /**
   * Le chantier `equite-grand-livre` est-il ouvert a ce cabinet ?
   *
   * ⚠️ DECISIF POUR CE QUE L'ECRAN A LE DROIT D'AFFIRMER. Porte fermee, le
   * report rendu vient de `chargerReportDAvant` : les week-ends de la SEULE
   * periode precedente, SANS plafond. Une carte qui parlerait alors de
   * « rattrapage etale, au plus un week-end par periode » decrirait un
   * mecanisme que ce cabinet n'a pas. Verifie en base le 2026-11-13 : le
   * Val d'Allier n'est PAS bac a sable, la porte y est donc fermee.
   */
  chantierOuvert: boolean
  /**
   * Erreur de lecture, jamais avalée (règle de maison n°1 de useCompteurs) :
   * un `?? []` transformerait « je n'ai pas pu lire l'historique » en
   * « personne ne traîne rien », et l'écran afficherait sereinement une
   * équité parfaite qui serait un mensonge.
   */
  erreur: string | null
}

const VIDE: GrandLivre = {
  cumul: {}, report: {}, nbPeriodes: 0, nbPeriodesCloses: 0,
  horsRotation: [], chantierOuvert: false, erreur: null,
}

/**
 * chargerGrandLivre — cumule les bilans de toutes les périodes de GARDES
 * closes avant `avantLe`, pour le cabinet donné.
 *
 * @param avantLe   Date de début de la période à juger (exclusive).
 * @param vetIds    Périmètre d'équité : l'EFFECTIF, dernier recours exclu.
 *                  Un véto hors de cette liste est cumulé (il apparaît dans
 *                  `cumul`, pour l'affichage) mais n'obtient AUCUN report.
 * @param cabinetId Isolation explicite. La RLS protège déjà les chemins
 *                  utilisateur, mais elle ne protège rien sous la clé de
 *                  service — et cumuler les écarts de tous les cabinets ne
 *                  se verrait nulle part dans le résultat.
 */
export async function chargerGrandLivre(
  supabase: SupabaseClient,
  avantLe: string,
  vetIds: string[],
  cabinetId?: string,
): Promise<GrandLivre> {
  // ⚠️ `usage` : une période de JOURNÉES n'a pas de bilan de gardes. Sans ce
  // filtre, la « période précédente » pouvait être une période de journées,
  // et le rattrapage était annulé par le calendrier, en silence. `usage` est
  // absent sur les lignes antérieures à B-162 : `is null` les garde.
  let requete = supabase
    .from('periodes')
    .select('id')
    .lt('date_fin', avantLe)
    .or('usage.is.null,usage.eq.gardes,usage.eq.les-deux')
  if (cabinetId) requete = requete.eq('cabinet_id', cabinetId)

  const { data: periodes, error: errPeriodes } = await requete
  if (errPeriodes) return { ...VIDE, erreur: errPeriodes.message }

  const ids = ((periodes as { id: string }[] | null) ?? []).map((p) => p.id)
  if (ids.length === 0) return { ...VIDE, chantierOuvert: true }

  const { data: bilans, error: errBilans } = await supabase
    .from('bonus_malus')
    .select('periode_id, veterinaire_id, ecart_we, ecart_semaine, ecart_feries')
    .in('periode_id', ids)

  if (errBilans) return { ...VIDE, erreur: errBilans.message }

  const lignes = (bilans as (LigneBilan & { periode_id: string })[] | null) ?? []

  // Qui a un ecart mais n'est pas dans l'effectif d'equite : le dernier
  // recours. Calcule ICI, ou l'on connait les deux ensembles, et non
  // devine a l'ecran depuis une absence de report.
  const perimetre = new Set(vetIds)
  const cumul = cumulerEcarts(lignes)

  return {
    // Cette fonction n'est appelee QUE porte ouverte : `chargerGrandLivre-
    // PourAffichage` et `engine/loader.ts` arbitrent tous deux en amont.
    chantierOuvert: true,
    cumul,
    report: construireReport(lignes, vetIds),
    horsRotation: Object.keys(cumul).filter((id) => !perimetre.has(id)),
    nbPeriodesCloses: ids.length,
    // Les périodes qui ont RÉELLEMENT un bilan, pas celles qui sont closes :
    // une période jamais clôturée n'apporte rien au cumul, et annoncer
    // « sur 4 périodes » ferait croire à un historique plus complet qu'il
    // n'est. Au Val d'Allier : 4 périodes passées, 3 avec un bilan.
    nbPeriodes: new Set(lignes.map((l) => l.periode_id)).size,
    erreur: null,
  }
}

/**
 * chargerGrandLivrePourAffichage — le grand livre SI le chantier est ouvert
 * à ce cabinet, et le comportement d'avant sinon.
 *
 * ⚠️ L'ÉCRAN ET FILOU DOIVENT PASSER PAR ICI, JAMAIS PAR `chargerGrandLivre`
 * EN DIRECT. Sans cette porte, un cabinet dont le chantier est fermé verrait
 * un rattrapage de trois dimensions que son moteur ne fait pas — l'écran
 * annoncerait une chose, la génération en ferait une autre. C'est le défaut
 * qu'on répare, repris par l'autre bout.
 *
 * Le moteur (`engine/loader.ts`) fait le même arbitrage, avec le même
 * chantier et le même repli.
 */
export async function chargerGrandLivrePourAffichage(
  supabase: SupabaseClient,
  avantLe: string,
  vetIds: string[],
  cabinetId?: string,
): Promise<GrandLivre> {
  const ouvert = cabinetId
    ? chantierOuvert('equite-grand-livre', {
        estBacASable: await cabinetEstBacASable(supabase, cabinetId),
      })
    : false

  return ouvert
    ? chargerGrandLivre(supabase, avantLe, vetIds, cabinetId)
    : chargerReportDAvant(supabase, avantLe, cabinetId)
}

/**
 * chargerReportDAvant — LE COMPORTEMENT D'AVANT LE GRAND LIVRE, conservé
 * tel quel derrière la porte de chantier `equite-grand-livre`.
 *
 * ⚠️ CE CODE EST UNE DETTE VOLONTAIRE, ET IL DOIT DISPARAÎTRE À LA BASCULE.
 *
 * Il ne lit que `ecart_we`, et seulement celui de la période précédente —
 * c'est-à-dire tout ce que le moteur savait faire jusqu'au 2026-11-13. On
 * le garde parce que le repli d'un chantier fermé doit être CE QUI EST DÉJÀ
 * RECETTÉ, jamais « rien » : rendre un report vide retirerait au Val
 * d'Allier le rattrapage de week-ends dont il bénéficie aujourd'hui, et
 * fermer le chantier deviendrait une régression au lieu d'une marche
 * arrière sûre.
 *
 * Il ne filtre volontairement PAS sur `usage` : reproduire le comportement
 * d'avant, c'est aussi reproduire ses défauts, sinon le repli n'est plus un
 * repli mais une troisième version à tester.
 */
export async function chargerReportDAvant(
  supabase: SupabaseClient,
  avantLe: string,
  cabinetId?: string,
): Promise<GrandLivre> {
  let requete = supabase
    .from('periodes')
    .select('id')
    .lt('date_fin', avantLe)
    .order('date_fin', { ascending: false })
    .limit(1)
  if (cabinetId) requete = requete.eq('cabinet_id', cabinetId)

  const { data: precedente, error: errPeriode } = await requete.maybeSingle()
  if (errPeriode) return { ...VIDE, erreur: errPeriode.message }
  if (!precedente) return VIDE

  const { data: bilans, error: errBilans } = await supabase
    .from('bonus_malus')
    .select('veterinaire_id, ecart_we')
    .eq('periode_id', (precedente as { id: string }).id)

  if (errBilans) return { ...VIDE, erreur: errBilans.message }

  const report: ReportEquiteMap = {}
  const cumul: Record<string, CumulEcarts> = {}
  for (const b of (bilans as { veterinaire_id: string; ecart_we: number }[] | null) ?? []) {
    // Signe inversé : `ecart > 0` (a fait plus) → report négatif (doit
    // faire moins). Aucun plafond — il n'y en avait pas non plus avant.
    report[b.veterinaire_id] = { we: -(b.ecart_we ?? 0), semaine: 0, feries: 0 }
    cumul[b.veterinaire_id] = { we: b.ecart_we ?? 0, semaine: 0, feries: 0 }
  }

  return {
    cumul, report, nbPeriodes: 1, nbPeriodesCloses: 1,
    // L'ancien chemin ne connait pas l'effectif : il ne peut rien dire du
    // hors-rotation, et ne doit donc rien en dire.
    horsRotation: [],
    chantierOuvert: false,
    erreur: null,
  }
}
