// ============================================================
// GUARDVETO — Le gardien des RÈGLES DURES, pour TOUS les chemins d'écriture
// ============================================================
// Le lot 1 a équipé UN chemin d'écriture d'une garde — `PATCH /api/gardes/[id]`,
// celui par lequel le bug est passé. Il en restait trois sans le moindre
// contrôle de rythme : le dépannage volontaire, les échanges de gardes et
// l'outil de réparation de Filou. Tous les trois appellent
// `appliquerChangementGarde`, qui par contrat ne fait AUCUN contrôle métier.
//
// POURQUOI CE FICHIER, ET PAS UN CONTRÔLE PAR CHEMIN
//
// Le bug d'origine vient exactement de là : plusieurs gardiens qui finissent par
// diverger. Écrire un contrôle « adapté » dans chacune des trois routes en
// aurait créé trois de plus. On extrait donc ici le gardien du chemin manuel,
// TEL QUEL, et les quatre chemins l'appellent. Le juge reste `validerPlanning`,
// unique, et la soustraction du delta reste `lib/gardes/controle-regles.ts`,
// pure et testée.
//
// CE QUE CE MODULE AJOUTE PAR RAPPORT À LA ROUTE PATCH
//
// Un seul élargissement : le contrôle accepte PLUSIEURS changements à la fois.
// Un échange déplace deux gardes d'un même geste ; les juger l'une après l'autre
// donnerait deux verdicts faux — le premier ignorerait le second mouvement, et
// le second compterait le premier comme s'il était déjà acquis. On simule donc
// l'état final complet, une seule fois, et on soustrait une seule fois.
//
// DOCTRINE : le système INFORME, il n'interdit pas. Ce module ne bloque rien et
// ne renvoie jamais d'erreur : il rend des phrases. C'est l'appelant qui décide
// de les faire confirmer, et qui laisse la trace dans `audit_log`.
//
// ACCÈS : ce module ne contrôle NI l'auth NI le rôle — l'appelant doit avoir
// validé « cette personne a le droit d'écrire cette garde » avant.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { monterValidationPeriode } from '@/data/monterValidationPeriode'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import {
  simulerChangementGarde,
  violationsIntroduites,
  phraseAvertissement,
  planningDuJour,
  remplacerOccupantsDuJour,
} from '@/lib/gardes/controle-regles'

/** Un mouvement d'attribution qui VA être écrit sur une garde. */
export interface ChangementGarde {
  gardeId: string
  premier_id: string | null
  second_id: string | null
}

/** Le même mouvement, quand l'appelant brasse plusieurs périodes d'un coup. */
export interface ChangementGardeSitue extends ChangementGarde {
  periodeId: string
}

/**
 * Empile plusieurs remplacements de RÔLE sur les changements de garde qu'ils
 * forment réellement. Pure.
 *
 * Une réparation d'absence peut viser les DEUX rôles d'un même créneau. Traités
 * séparément, le second effacerait le premier et on jugerait un état qui
 * n'existera jamais — le contraire de ce que le contrôle promet.
 *
 * `base` donne l'état actuel de chaque garde (les deux occupants), `remplacements`
 * dit qui prend quel rôle. Une garde absente de `base` est ignorée : c'est un
 * contrôle informatif, il n'a pas à faire échouer ce que l'écriture saura
 * refuser proprement.
 *
 * SEULS `premier` et `second` sont pilotés — comme partout où ce contrôle passe
 * (`gardes` ne porte que ces deux colonnes). Un rôle sur-mesure est laissé de
 * côté plutôt que rangé d'office en 2nd : mieux vaut ne rien dire que dire faux.
 */
export function fusionnerChangementsParGarde(
  base: readonly ChangementGardeSitue[],
  remplacements: readonly { gardeId: string; role: string; remplacant_id: string }[],
): ChangementGardeSitue[] {
  const parGarde = new Map<string, ChangementGardeSitue>()
  for (const b of base) parGarde.set(b.gardeId, { ...b })

  const touchees = new Map<string, ChangementGardeSitue>()
  for (const r of remplacements) {
    const courant = parGarde.get(r.gardeId)
    if (!courant) continue
    if (r.role === 'premier') courant.premier_id = r.remplacant_id
    else if (r.role === 'second') courant.second_id = r.remplacant_id
    else continue
    touchees.set(r.gardeId, courant)
  }
  return [...touchees.values()]
}

/**
 * Confronte un ou plusieurs changements aux RÈGLES DURES du cabinet, sans rien
 * écrire. Tous les changements doivent appartenir à LA MÊME période — c'est ce
 * qui permet de les juger ensemble, sur un seul état final.
 *
 * Le montage (`monterValidationPeriode`) et le juge (`validerPlanning`) sont
 * EXACTEMENT ceux de la re-validation continue et de la publication : aucune
 * règle n'est réimplémentée ici.
 *
 * Best-effort ASSUMÉ : période introuvable, contexte illisible, exception
 * inattendue → tableau vide, l'écriture passe. Un contrôle informatif qui
 * empêcherait de travailler quand il tombe en panne serait pire que son absence,
 * et la re-validation continue rattrapera l'écart de toute façon.
 */
export async function avertissementsReglesDures(
  supabase: SupabaseClient,
  changements: readonly ChangementGarde[],
  periodeId: string,
  cabinetId: string,
): Promise<string[]> {
  if (changements.length === 0) return []
  try {
    const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
    if (!montage) return []

    // Les gardes touchées n'ont plus le miroir `garde_placements` à jour (il
    // porte encore l'ANCIENNE paire) : on les reconstruit depuis
    // premier_id/second_id, sinon la simulation validerait l'ancien état.
    const touchees = changements.map((c) => c.gardeId)

    let apresGardes = montage.gardes
    for (const c of changements) {
      apresGardes = simulerChangementGarde(apresGardes, c.gardeId, c.premier_id, c.second_id)
    }

    const avant = validerPlanning(
      montage.construirePlanning(montage.gardes, touchees),
      montage.input,
    )
    const apres = validerPlanning(
      montage.construirePlanning(apresGardes, touchees),
      montage.input,
    )

    return violationsIntroduites(avant, apres).map(phraseAvertissement)
  } catch (e) {
    console.error(
      '[avertissementsReglesDures] contrôle des règles dures indisponible (écriture laissée passer):',
      e instanceof Error ? e.message : String(e),
    )
    return []
  }
}

/**
 * Même gardien, quand les changements s'étalent sur PLUSIEURS périodes — le cas
 * d'un échange dont les deux gardes ne tombent pas dans le même planning, ou
 * d'une réparation d'absence à cheval sur une jonction.
 *
 * On regroupe par période et on juge chaque groupe entier : deux périodes ne
 * peuvent pas être confrontées d'un seul tenant (le validateur travaille sur un
 * intervalle et une structure donnés), mais chaque période, elle, voit bien tous
 * les mouvements qui la concernent.
 */
export async function avertissementsReglesDuresMultiPeriodes(
  supabase: SupabaseClient,
  cabinetId: string,
  changements: readonly ChangementGardeSitue[],
): Promise<string[]> {
  const parPeriode = new Map<string, ChangementGarde[]>()
  for (const c of changements) {
    const liste = parPeriode.get(c.periodeId) ?? []
    liste.push({ gardeId: c.gardeId, premier_id: c.premier_id, second_id: c.second_id })
    parPeriode.set(c.periodeId, liste)
  }

  const out: string[] = []
  const vues = new Set<string>()
  for (const [periodeId, liste] of parPeriode) {
    for (const phrase of await avertissementsReglesDures(supabase, liste, periodeId, cabinetId)) {
      // Deux périodes voisines peuvent formuler la même violation de jonction
      // (le lookback inter-périodes les fait se regarder). On ne la dit qu'une
      // fois : lire deux fois la même phrase fait douter de la première.
      if (vues.has(phrase)) continue
      vues.add(phrase)
      out.push(phrase)
    }
  }
  return out
}

/**
 * Même gardien, mais pour l'écriture à la maille JOUR (`appliquerExceptionJour`).
 *
 * L'exception s'écrit dans `gardes_exceptions` ; la table `gardes` ne bouge pas,
 * donc le validateur ne verrait rien si on lui donnait la période telle quelle.
 * On lui soumet donc une période RÉDUITE À CE JOUR : les règles qui jugent
 * l'occupant d'un créneau répondent exactement, les règles de rythme se taisent
 * d'elles-mêmes (un seul créneau ne forme ni paire ni série) — ce qui est le
 * comportement VOULU, un jour exceptionnel n'étant pas une garde au sens de
 * l'équité. Raisonnement complet dans `lib/gardes/controle-regles.ts`.
 *
 * L'état « avant » est lu sur la VUE, pas sur `gardes` : elle applique déjà les
 * exceptions posées précédemment, donc corriger deux fois le même jour compare
 * bien au remplaçant en place, et non au titulaire d'origine.
 */
export async function avertissementsReglesDuresJour(
  supabase: SupabaseClient,
  gardeId: string,
  jour: string,
  periodeId: string,
  cabinetId: string,
  premier_id: string | null,
  second_id: string | null,
): Promise<string[]> {
  try {
    const montage = await monterValidationPeriode(supabase, periodeId, cabinetId)
    if (!montage) return []

    // Le créneau qui PORTE ce jour, seul — résolu par l'aval d'affichage, donc
    // exactement comme la vue le présente : samedi natif, vendredi lié, DIMANCHE
    // en continuation du week-end. Vide = ce jour ne porte aucun créneau.
    const duJour = planningDuJour(montage.gardes, jour, {
      relations: montage.input.structureConfig?.relations,
      creneaux: montage.input.creneaux,
    })
    if (duJour.attributions.length === 0) return []

    const { data: vue } = await supabase
      .from('planning_semaine')
      .select('premier_id, second_id')
      .eq('id', gardeId)
      .eq('date', jour)
      .maybeSingle()
    const occupants = vue as { premier_id: string | null; second_id: string | null } | null

    const input = {
      ...montage.input,
      dateDebut: jour,
      dateFin: jour,
      // Pas de lookback : on ne juge pas le rythme sur un jour isolé.
      contexteAnterieur: undefined,
    }

    const avant = validerPlanning(
      occupants
        ? remplacerOccupantsDuJour(duJour, jour, occupants.premier_id, occupants.second_id)
        : duJour,
      input,
    )
    const apres = validerPlanning(
      remplacerOccupantsDuJour(duJour, jour, premier_id, second_id),
      input,
    )

    return violationsIntroduites(avant, apres).map(phraseAvertissement)
  } catch (e) {
    console.error(
      '[avertissementsReglesDuresJour] contrôle des règles dures (jour) indisponible (écriture laissée passer):',
      e instanceof Error ? e.message : String(e),
    )
    return []
  }
}

/**
 * La trace d'une écriture faite MALGRÉ un avertissement de règle dure.
 *
 * Un avertissement qu'on décide d'ignorer doit rester retrouvable, sinon
 * « informer sans interdire » revient à ne rien dire du tout. On note QUI a
 * confirmé, sur quelle garde, et CE QUI avait été montré — sans ça, six mois
 * plus tard, on relit un changement sans savoir qu'il a été fait en connaissance
 * de cause.
 *
 * Best-effort ASSUMÉ : la garde est déjà écrite quand on arrive ici ; un échec
 * d'audit ne doit jamais faire croire que le geste a échoué.
 */
export async function tracerConfirmationMalgreAvertissement(
  supabase: SupabaseClient,
  params: {
    gardeId: string
    chemin: string
    auteurVetId: string
    avertissements: readonly string[]
    avant: { premier_id: string | null; second_id: string | null }
    apres: { premier_id: string | null; second_id: string | null }
    /** Contexte propre au chemin (id d'échange, d'absence…). */
    contexte?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    table_name: 'gardes',
    record_id: params.gardeId,
    action: 'update',
    old_data: {
      ...params.avant,
      confirmation_malgre_avertissement: true,
      chemin: params.chemin,
      avertissements: params.avertissements,
      ...(params.contexte ?? {}),
    },
    new_data: { ...params.apres, modifie_manuellement: true },
    user_id: params.auteurVetId,
  })
  if (error) {
    console.error(
      `[${params.chemin}] trace de confirmation non écrite dans audit_log:`,
      error.message,
    )
  }
}
