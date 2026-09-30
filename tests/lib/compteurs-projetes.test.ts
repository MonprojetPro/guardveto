// ============================================================
// B-122 lot 1 — « Antoine 27 → 25 », avant d'appliquer
// ============================================================
// LA DEMANDE DE MiKL, le 2026-09-15 :
//
//   « Ça doit apparaître AU COMPTEUR également, AVANT qu'il fasse le
//    changement, comme ça elle sait ce que ça implique de tout faire.
//    C'est visuel, c'est clair, c'est ergonomique. »
//
// C'est le cœur du chantier : ce chiffre remplace les paragraphes d'explication
// de Filou. Un rapport met six lignes à dire ce que « 27 → 25 » dit d'un coup
// d'œil.
//
// ⚠️ ET C'EST EXACTEMENT POUR ÇA QU'IL DOIT ÊTRE JUSTE. Un compteur projeté faux
//    est pire que pas de compteur du tout : l'admin déciderait dessus, et ne
//    verrait l'écart qu'après avoir appliqué — quand il est trop tard.
//
// ── LE PIÈGE, TROUVÉ AVANT DE CODER ─────────────────────────────────────────
//
// La vue `compteurs_gardes` compte sur la table `gardes`, qui ne connaît que
// TROIS types : 'weekend', 'semaine', 'ferie'. Le moteur, lui, en manipule
// quatre — et `vendredi_soir` n'est JAMAIS écrit en base : il est fusionné dans
// le week-end (`ecrirePlanningV1.ts:202`, vérifié en base : 0 garde un vendredi
// sur 120).
//
// Or les propositions de Filou couplent presque toujours le vendredi et le
// samedi (le couple vendredi↔week-end est imposé par les règles du cabinet).
// Compter les deux afficherait « Antoine −2 » là où la réalité est « −1 ».
//
// C'est la quatrième occurrence sur ce projet du même défaut de fond : deux
// mondes qui ne nomment pas les choses pareil ne se rapprochent jamais par
// égalité de chaîne. D'où l'usage de `mapTypeGardeEnDb` — LA traduction du
// projet — et jamais d'une table de correspondance écrite ici.
// ============================================================

import { describe, expect, it } from 'vitest'
import { projeterCompteurs, type AffectationProjetee } from '@/lib/planning/compteursProjetes'
import type { CompteursRow } from '@/hooks/useCompteurs'

function ligne(id: string, prenom: string, p: Partial<CompteursRow> = {}): CompteursRow {
  return {
    veterinaire_id: id,
    prenom,
    nom: prenom,
    statut: 'associe',
    couleur: '#000000',
    we_premier: 0, we_second: 0, we_total: 0,
    sem_premier: 0, sem_second: 0, sem_total: 0,
    feries_premier: 0, feries_second: 0, feries_total: 0,
    total_gardes: 0,
    jours_1er_we_exceptionnels: 0,
    jours_exceptionnels_pris: 0,
    ...p,
  } as CompteursRow
}

/** Antoine est chargé, Fanny est en retrait — le cas réel du 15/09. */
function equipe(): CompteursRow[] {
  return [
    ligne('antoine', 'Antoine', {
      we_premier: 3, we_second: 2, we_total: 5,
      sem_premier: 12, sem_second: 10, sem_total: 22,
      total_gardes: 27,
    }),
    ligne('fanny', 'Fanny', {
      we_premier: 1, we_second: 2, we_total: 3,
      sem_premier: 8, sem_second: 9, sem_total: 17,
      total_gardes: 20,
    }),
  ]
}

const par = (rows: CompteursRow[], id: string) =>
  rows.find((r) => r.veterinaire_id === id)!

describe('projeterCompteurs — une nuit de semaine', () => {
  const mouvement: AffectationProjetee[] = [
    {
      date: '2026-11-30', type: 'semaine_soir', role: 'premier',
      vetId: 'fanny', avantVetId: 'antoine',
    },
  ]

  it('retire la garde à celui qui la quitte et la donne à celui qui la prend', () => {
    const r = projeterCompteurs(equipe(), mouvement)

    expect(par(r, 'antoine').sem_premier).toBe(11)
    expect(par(r, 'antoine').sem_total).toBe(21)
    expect(par(r, 'antoine').total_gardes).toBe(26)

    expect(par(r, 'fanny').sem_premier).toBe(9)
    expect(par(r, 'fanny').sem_total).toBe(18)
    expect(par(r, 'fanny').total_gardes).toBe(21)
  })

  it('ne touche à AUCUN compteur de week-end', () => {
    const r = projeterCompteurs(equipe(), mouvement)
    expect(par(r, 'antoine').we_total).toBe(5)
    expect(par(r, 'fanny').we_total).toBe(3)
  })

  it('ne modifie pas les compteurs qu’on lui a passés', () => {
    // Muter l'entrée ferait diverger l'affichage projeté de l'affichage réel
    // dès que l'admin ferme l'aperçu sans appliquer.
    const avant = equipe()
    projeterCompteurs(avant, mouvement)
    expect(par(avant, 'antoine').total_gardes).toBe(27)
  })
})

describe('projeterCompteurs — un week-end', () => {
  it('suit le rôle : premier et second ne comptent pas pareil', () => {
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-12-05', type: 'weekend', role: 'premier',
        vetId: 'fanny', avantVetId: 'antoine',
      },
    ])

    expect(par(r, 'antoine').we_premier).toBe(2)
    expect(par(r, 'antoine').we_total).toBe(4)
    expect(par(r, 'fanny').we_premier).toBe(2)
    expect(par(r, 'fanny').we_total).toBe(4)
  })

  // B-137 — un week-end n'est plus UN soir de garde, il en vaut DEUX : le
  // samedi-dimanche, et le vendredi qui le précède. La vue `compteurs_gardes`
  // les compte tous les deux ; la projection doit dire la même chose.
  it('emporte AUSSI le vendredi qui le précède, en soir de semaine', () => {
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-12-05', type: 'weekend', role: 'premier',
        vetId: 'fanny', avantVetId: 'antoine',
      },
    ])

    // Le week-end lui-même.
    expect(par(r, 'antoine').we_total).toBe(4)
    // Le vendredi, rangé en soir de SEMAINE — et en rôle INVERSÉ : Antoine
    // était 1er du week-end, il était donc 2nd du vendredi.
    expect(par(r, 'antoine').sem_second).toBe(9)
    expect(par(r, 'antoine').sem_premier).toBe(12) // intact
    expect(par(r, 'antoine').sem_total).toBe(21)
    expect(par(r, 'fanny').sem_second).toBe(10)
    expect(par(r, 'fanny').sem_total).toBe(18)
    // Total : −2 pour Antoine (le week-end ET son vendredi), +2 pour Fanny.
    expect(par(r, 'antoine').total_gardes).toBe(25)
    expect(par(r, 'fanny').total_gardes).toBe(22)
  })

  it('ne compte PAS le vendredi quand le cabinet a découplé ses créneaux', () => {
    // Sans `meme_binome`, le vendredi n'est pas dérivable du week-end : la vue
    // ne le matérialise pas, la projection non plus. Le paramètre `relations`
    // n'est donc pas décoratif — il change le chiffre affiché.
    const r = projeterCompteurs(
      equipe(),
      [{
        date: '2026-12-05', type: 'weekend', role: 'premier',
        vetId: 'fanny', avantVetId: 'antoine',
      }],
      undefined,
      [], // aucune relation : créneaux découplés
    )

    expect(par(r, 'antoine').we_total).toBe(4)
    expect(par(r, 'antoine').sem_total).toBe(22) // intact
    expect(par(r, 'antoine').total_gardes).toBe(26) // −1 seulement
  })
})

describe('projeterCompteurs — le vendredi soir n’a toujours pas de ligne à lui', () => {
  // ⚠️ CETTE MOITIÉ DU PIÈGE N'A PAS BOUGÉ AVEC B-137. Le vendredi est COMPTÉ
  // depuis le 30/09, mais toujours pas STOCKÉ : il n'existe que porté par son
  // week-end. Une affectation qui le vise en propre reste donc sans effet.
  it('IGNORE une affectation du vendredi soir : elle n’est pas écrite en base', () => {
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-12-04', type: 'vendredi_soir', role: 'second',
        vetId: 'fanny', avantVetId: 'antoine',
      },
    ])

    expect(par(r, 'antoine').total_gardes).toBe(27)
    expect(par(r, 'fanny').total_gardes).toBe(20)
  })

  it('le couple vendredi + samedi de Filou pèse 2, porté par le SEUL samedi', () => {
    // Le cas réel du 15/09, relu après B-137. Les deux lignes voyagent
    // ensemble et représentent DEUX soirs de garde. Le compte est bien −2 —
    // mais il vient entièrement du samedi, qui emporte son vendredi ; la ligne
    // `vendredi_soir`, elle, reste ignorée. Compter les deux lignes donnerait
    // −3, pour deux soirs perdus.
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-12-04', type: 'vendredi_soir', role: 'second',
        vetId: 'fanny', avantVetId: 'antoine',
      },
      {
        date: '2026-12-05', type: 'weekend', role: 'premier',
        vetId: 'fanny', avantVetId: 'antoine',
      },
    ])

    expect(par(r, 'antoine').total_gardes).toBe(25) // −2, jamais −3
    expect(par(r, 'fanny').total_gardes).toBe(22)
  })
})

describe('projeterCompteurs — les cas qui débordent', () => {
  it('range une nuit de semaine tombant un jour férié dans les FÉRIÉS', () => {
    // `mapTypeGardeEnDb` reclasse semaine_soir → 'ferie' un jour férié. La
    // projection doit suivre la MÊME règle, sans quoi elle annoncerait une
    // nuit de semaine là où la base comptera un férié.
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-12-25', type: 'semaine_soir', role: 'premier',
        vetId: 'fanny', avantVetId: 'antoine',
      },
    ])

    expect(par(r, 'antoine').feries_premier).toBe(-1)
    expect(par(r, 'antoine').sem_premier).toBe(12) // inchangé
    expect(par(r, 'fanny').feries_premier).toBe(1)
  })

  it('vider une place retire sans rien donner à personne', () => {
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-11-30', type: 'semaine_soir', role: 'premier',
        vetId: null, avantVetId: 'antoine',
      },
    ])

    expect(par(r, 'antoine').total_gardes).toBe(26)
    expect(par(r, 'fanny').total_gardes).toBe(20)
  })

  it('pourvoir une place vide donne sans rien retirer à personne', () => {
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-11-30', type: 'semaine_soir', role: 'second',
        vetId: 'fanny', avantVetId: null,
      },
    ])

    expect(par(r, 'fanny').sem_second).toBe(10)
    expect(par(r, 'antoine').total_gardes).toBe(27)
  })

  it('ignore une personne absente du tableau plutôt que d’inventer une ligne', () => {
    // Un vétérinaire désactivé sort de la vue. Lui fabriquer une ligne le
    // ferait réapparaître à l'écran — une personne de plus dans l'équipe.
    const r = projeterCompteurs(equipe(), [
      {
        date: '2026-11-30', type: 'semaine_soir', role: 'premier',
        vetId: 'inconnu', avantVetId: 'antoine',
      },
    ])

    expect(r).toHaveLength(2)
    expect(par(r, 'antoine').total_gardes).toBe(26)
  })

  it('rend les compteurs inchangés quand il n’y a aucun mouvement', () => {
    const r = projeterCompteurs(equipe(), [])
    expect(par(r, 'antoine').total_gardes).toBe(27)
    expect(par(r, 'fanny').total_gardes).toBe(20)
  })
})
