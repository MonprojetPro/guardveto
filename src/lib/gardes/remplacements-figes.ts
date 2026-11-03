// ============================================================
// GUARDVETO — Remettre en place les remplacements d'un jour FIXÉS (B-187)
// ============================================================
// Une génération efface les gardes du brouillon puis les réécrit
// (`ecrirePlanningV1`). Un remplacement d'un jour est attaché à sa garde par
// `gardes_exceptions.garde_id`, en `ON DELETE CASCADE` : il disparaissait avec
// elle, cadenas ou pas. Le 25/12 et le 01/01 d'Hiver P3 au Val d'Allier, posés
// à la main par Anne-Sophie, seraient repartis à zéro au prochain « Générer ».
//
// Décision de MiKL (03/11) : un remplacement FIXÉ survit à la génération, un
// remplacement libre est laissé au moteur.
//
// Ce fichier est PUR : il dit quoi réinsérer à partir de ce qui a été lu avant
// l'effacement et de ce que la génération a écrit. Les lectures et l'écriture
// vivent dans `ecrirePlanningV1`.
// ============================================================

/** Un remplacement fixé, lu AVANT l'effacement des gardes. */
export interface RemplacementFige {
  /** La garde qui le portait, désignée par sa clé — son id va changer. */
  gardeDate: string
  gardeType: string
  /** Le jour remplacé. */
  date: string
  /** Rôle dans le vocabulaire de la LIGNE du jour (vendredi inversé compris). */
  role: 'premier' | 'second'
  veterinaire_id: string
  motif: string
  compte_1er_we: boolean
  absence_id: string | null
  cree_par: string | null
  cabinet_id: string
}

/** Une ligne de `planning_semaine` APRÈS la réécriture, avant tout remplacement. */
export interface LigneJourEcrite {
  id: string
  date: string
  premier_id: string | null
  second_id: string | null
}

export interface LigneRemplacementAInserer {
  garde_id: string
  date: string
  role: 'premier' | 'second'
  veterinaire_id: string
  remplace_id: string | null
  motif: string
  compte_1er_we: boolean
  absence_id: string | null
  cree_par: string | null
  cabinet_id: string
  fige: true
}

export interface PlanReposeRemplacements {
  aInserer: LigneRemplacementAInserer[]
  /** La génération a mis cette personne à cette place : plus rien à remplacer. */
  dejaEnPlace: RemplacementFige[]
  /** La garde de ce jour n'existe plus après la génération. */
  sansGarde: RemplacementFige[]
  /**
   * La génération a mis cette personne sur L'AUTRE place de ce jour : la
   * remettre ici la ferait tenir les deux places. Non réinséré, à signaler.
   */
  enConflit: RemplacementFige[]
}

export function planReposeRemplacements(
  figes: readonly RemplacementFige[],
  idParCle: ReadonlyMap<string, string>,
  lignes: readonly LigneJourEcrite[],
): PlanReposeRemplacements {
  const plan: PlanReposeRemplacements = { aInserer: [], dejaEnPlace: [], sansGarde: [], enConflit: [] }

  for (const r of figes) {
    const gardeId = idParCle.get(`${r.gardeDate}|${r.gardeType}`)
    const ligne = gardeId ? lignes.find((l) => l.id === gardeId && l.date === r.date) : undefined
    if (!gardeId || !ligne) {
      plan.sansGarde.push(r)
      continue
    }

    // Le titulaire que la génération a mis sur cette place, CE jour-là.
    const titulaire = r.role === 'premier' ? ligne.premier_id : ligne.second_id
    if (titulaire === r.veterinaire_id) {
      plan.dejaEnPlace.push(r)
      continue
    }

    // L'autre place de ce jour : son titulaire, sauf si elle est elle-même
    // remplacée par un remplacement fixé (le 25/12 : les deux le sont).
    const autreRole = r.role === 'premier' ? 'second' : 'premier'
    const autreRemplacee = figes.some(
      (x) => x !== r && x.gardeDate === r.gardeDate && x.gardeType === r.gardeType
        && x.date === r.date && x.role === autreRole,
    )
    const autreTitulaire = autreRole === 'premier' ? ligne.premier_id : ligne.second_id
    if (!autreRemplacee && autreTitulaire === r.veterinaire_id) {
      plan.enConflit.push(r)
      continue
    }

    plan.aInserer.push({
      garde_id: gardeId,
      date: r.date,
      role: r.role,
      veterinaire_id: r.veterinaire_id,
      remplace_id: titulaire,
      motif: r.motif,
      // La base refuse l'avantage financier hors de la 1re place.
      compte_1er_we: r.role === 'premier' ? r.compte_1er_we : false,
      absence_id: r.absence_id,
      cree_par: r.cree_par,
      cabinet_id: r.cabinet_id,
      fige: true,
    })
  }

  return plan
}
