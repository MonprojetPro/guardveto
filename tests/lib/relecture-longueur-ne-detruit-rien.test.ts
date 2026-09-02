// ============================================================
// B-089 — une consigne de MISE EN FORME ne peut plus détruire un CONTENU juste
// ============================================================
// MESURÉ le 31/08, au banc, sur les vraies données de Val d'Allier.
//
// Sonnet 5 à `low` a rendu une relecture COMPLÈTE et correcte : neuf critères
// traités, des constats justes. Elle a été **entièrement jetée** par notre
// propre code, parce que la synthèse dépassait 320 caractères et que quatre
// `detail` — un champ FACULTATIF — dépassaient 400. L'écran a affiché
// « Filou n'a pas pu relire » pour une question de longueur de texte.
//
// ── LA CAUSE, ET POURQUOI ELLE ÉTAIT INVISIBLE ──────────────────────────────
//
// L'API n'accepte pas les contraintes de longueur dans une sortie structurée :
// le SDK les RETIRE du schéma envoyé au modèle, puis les valide lui-même à la
// réception. Le modèle n'a donc jamais su qu'une limite existait — il ne
// pouvait pas la respecter, et nous rejetions tout quand il la dépassait.
//
// Le défaut était armé sur TOUS les modèles. Opus ne l'avait simplement pas
// encore déclenché : c'est un coup de dé sur la longueur d'une phrase, pas une
// propriété du modèle. Le corriger n'était donc pas un préalable au choix de
// Sonnet 5 — c'était une bombe à retirer de toute façon.
//
// ── CE QUE CES TESTS PROTÈGENT ──────────────────────────────────────────────
//
// C'est le pendant exact de `relecture-silence-impossible` : celui-là empêche
// un silence de passer pour une bonne nouvelle, celui-ci empêche un contenu
// juste d'être détruit et de RESSORTIR EN SILENCE. Même défaut, deux bouts.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  normaliserRelecture,
  SortieRelectureSchema,
  type DossierRelecture,
  type SortieRelecture,
} from '@/lib/ia/relecturePlanning'
import { CRITERES_HUMAINS } from '@/lib/planning/criteres-humains'

const DOSSIER: DossierRelecture = {
  // B-093 : ce test porte sur la LONGUEUR de la réponse, pas sur les mouvements.
  // Liste vide = le dossier reste celui d'origine, le test mesure la même chose.
  // (B-096 : `echanges` est devenu `mouvements` — même rôle, N places et effet.)
  mouvements: [],
  // B-096 : ce test ne porte pas sur les preferences enfreintes.
  preferencesEnfreintes: [],
  periode: 'du 21 septembre au 18 octobre',
  saison: 'hiver',
  places: [
    {
      date: '2026-10-03', jour: 'samedi 3 octobre', creneau: 'week-end',
      type: 'weekend', role: 'premier', prenom: 'Antoine', vetId: 'v-antoine',
      remplacants: ['v-anne-so'],
    },
    {
      date: '2026-10-03', jour: 'samedi 3 octobre', creneau: 'week-end',
      type: 'weekend', role: 'second', prenom: null, vetId: null,
      remplacants: ['v-anne-so'],
    },
  ],
  equipe: [
    {
      vetId: 'v-antoine', prenom: 'Antoine',
      gardesPeriode: { total: 7, weekends: 2, premierWeekend: 1 },
      absences: [], regles: [],
    },
    {
      vetId: 'v-anne-so', prenom: 'Anne-Sophie',
      gardesPeriode: { total: 8, weekends: 1, premierWeekend: 0 },
      absences: [], regles: [],
    },
  ],
  reglesCabinet: [],
  roleAvantageFinancier: 'premier',
}

/** Un texte trop long, mais fait de vrais mots — pour vérifier la coupe. */
const TROP_LONG =
  'Anne-Sophie assure huit gardes sur la période sans jamais tenir le rôle de première du week-end, '.repeat(
    12,
  )

function revueComplete(detailLong = false): SortieRelecture['revue'] {
  return CRITERES_HUMAINS.map((c) => ({
    critere: c.cle,
    verdict: 'rien_a_signaler' as const,
    constat: detailLong ? TROP_LONG : `Vérifié pour ${c.titre} : rien à signaler.`,
    detail: detailLong ? TROP_LONG : undefined,
    corrigeable: false,
  }))
}

function sortie(partiel: Partial<SortieRelecture> = {}): SortieRelecture {
  return {
    synthese: 'Ce planning tient globalement, avec deux points de vigilance.',
    revue: revueComplete(),
    changements: [],
    ...partiel,
  }
}

describe('le SCHÉMA ne refuse plus un texte long', () => {
  // ⚠️ CE TEST EST LE VRAI GARDE-FOU DE B-089.
  //
  // Les tests de normalisation ci-dessous ne verraient PAS la régression : si
  // quelqu'un remet un `.max()` dans le schéma, l'échec se produit à la
  // lecture de la réponse — bien avant `normaliserRelecture`, qui ne serait
  // jamais appelée. Le reste de la suite resterait vert pendant que la
  // relecture serait de nouveau cassée en production.
  it('accepte une synthèse et des détails plus longs que ce qu’on affiche', () => {
    const r = SortieRelectureSchema.safeParse({
      synthese: TROP_LONG,
      revue: revueComplete(true),
      changements: [
        {
          motif: TROP_LONG,
          critere: 'role_avantage',
          affectations: Array.from({ length: 12 }, () => ({
            date: '2026-10-03', type: 'weekend', role: 'premier', vetId: 'v-anne-so',
          })),
        },
      ],
    })

    expect(r.success).toBe(true)
  })

  it('accepte une revue vide — c’est la NORMALISATION qui dit ce qui manque', () => {
    // Un `.min(1)` ici transformerait un silence en panne, et on perdrait le
    // « voici les critères qu'il n'a pas traités » de B-071.
    expect(
      SortieRelectureSchema.safeParse({ synthese: 'Court.', revue: [], changements: [] })
        .success,
    ).toBe(true)
  })
})

describe('une clé de critère approximative ne fait plus disparaître un constat', () => {
  // MESURÉ le 31/08 : Sonnet 5 à `medium` a rendu une synthèse juste et une
  // proposition… et 0 critère sur 9. La comparaison de clés était stricte :
  // tout ce qui ne tombait pas à l'octet près était jeté EN SILENCE.
  const VARIANTES = ['Role_Avantage', 'role-avantage', 'rôle_avantage', 'ROLE AVANTAGE']

  it.each(VARIANTES)('rattache « %s » au bon critère', (ecriture) => {
    const r = normaliserRelecture(
      sortie({
        revue: [
          { critere: ecriture, verdict: 'probleme', constat: 'Fanny n’est jamais première.', corrigeable: false },
        ],
      }),
      DOSSIER,
    )

    expect(r.revue).toHaveLength(1)
    expect(r.revue[0].critere).toBe('role_avantage')
    expect(r.entreesNonRattachees).toBe(0)
  })

  it('COMPTE ce qui reste vraiment inconnu au lieu de l’avaler', () => {
    // Le compteur est ce qui distingue « il n'a rien dit » de « il a parlé et
    // on n'a pas su l'entendre ». Sans lui, les deux s'affichent « 0/9 ».
    const r = normaliserRelecture(
      sortie({
        revue: [
          { critere: 'critere_invente', verdict: 'probleme', constat: 'Quelque chose.', corrigeable: false },
          { critere: 'encore_un_autre', verdict: 'probleme', constat: 'Autre chose.', corrigeable: false },
        ],
      }),
      DOSSIER,
    )

    expect(r.revue).toEqual([])
    expect(r.entreesNonRattachees).toBe(2)
    expect(r.criteresNonTraites).toHaveLength(CRITERES_HUMAINS.length)
  })
})

describe('normaliserRelecture — la longueur ne détruit plus rien', () => {
  it('garde les 9 critères quand TOUS les textes dépassent les limites', () => {
    // Le cas exact du 31/08. Avant le correctif, cette réponse ne parvenait
    // même pas jusqu'ici : le SDK levait, et l'écran disait « Filou n'a pas pu
    // relire ». Le contenu était pourtant juste.
    const r = normaliserRelecture(
      sortie({ synthese: TROP_LONG, revue: revueComplete(true) }),
      DOSSIER,
    )

    expect(r.revue).toHaveLength(CRITERES_HUMAINS.length)
    expect(r.criteresNonTraites).toEqual([])
  })

  it('coupe au lieu de rejeter, et le dit à l’œil', () => {
    const r = normaliserRelecture(
      sortie({ synthese: TROP_LONG, revue: revueComplete(true) }),
      DOSSIER,
    )

    expect(r.synthese.length).toBeLessThanOrEqual(320)
    expect(r.synthese.endsWith('…')).toBe(true)

    // Coupé sur un MOT ENTIER : le texte gardé doit être un début exact de
    // l'original, et le caractère qui suit dans l'original doit être une
    // espace. (Pas de vérification sur la fin du texte gardé : `trimEnd()`
    // retire l'espace à dessein, pour ne pas écrire « mot  … ».)
    const garde = r.synthese.slice(0, -1)
    expect(TROP_LONG.startsWith(garde)).toBe(true)
    expect(TROP_LONG[garde.length]).toBe(' ')

    for (const ligne of r.revue) {
      expect(ligne.constat.length).toBeLessThanOrEqual(160)
      expect((ligne.detail ?? '').length).toBeLessThanOrEqual(400)
    }
  })

  it('ne touche PAS à un texte qui tient déjà dans la limite', () => {
    // Une coupe qui s'appliquerait à tout ajouterait « … » partout et ferait
    // croire à une troncature qui n'a pas eu lieu.
    const r = normaliserRelecture(sortie(), DOSSIER)

    expect(r.synthese).toBe('Ce planning tient globalement, avec deux points de vigilance.')
    expect(r.synthese).not.toContain('…')
    expect(r.revue.every((l) => !l.constat.endsWith('…'))).toBe(true)
  })

  it('plafonne le nombre de propositions sans faire échouer la relecture', () => {
    const changement = {
      motif: 'Rééquilibrer le week-end.',
      critere: 'role_avantage',
      affectations: [
        { date: '2026-10-03', type: 'weekend', role: 'premier', vetId: 'v-anne-so' },
      ],
    }
    const r = normaliserRelecture(
      sortie({ changements: Array.from({ length: 20 }, () => ({ ...changement })) }),
      DOSSIER,
    )

    expect(r.changements).toHaveLength(8)
    // Et la revue est intacte : le plafond ne coûte rien au reste.
    expect(r.revue).toHaveLength(CRITERES_HUMAINS.length)
  })

  it('plafonne les places d’une proposition sans la jeter', () => {
    // Une proposition à 12 places était refusée en bloc par l'ancien `.max(6)`.
    // Elle est maintenant ramenée à 6 : un geste tronqué que le moteur pourra
    // refuser en le disant, plutôt qu'une relecture entière perdue.
    const r = normaliserRelecture(
      sortie({
        changements: [
          {
            motif: 'Échange large.',
            critere: 'concentration',
            affectations: Array.from({ length: 12 }, () => ({
              date: '2026-10-03', type: 'weekend', role: 'premier', vetId: 'v-anne-so',
            })),
          },
        ],
      }),
      DOSSIER,
    )

    expect(r.changements).toHaveLength(1)
    expect(r.changements[0].affectations).toHaveLength(6)
  })

  it('écarte une proposition SANS aucune place — elle serait un geste vide', () => {
    const r = normaliserRelecture(
      sortie({
        changements: [
          { motif: 'Rien de concret.', critere: 'epuisement', affectations: [] },
        ],
      }),
      DOSSIER,
    )

    expect(r.changements).toEqual([])
    // Ce qui est écarté ne doit pas emporter la revue avec lui.
    expect(r.revue).toHaveLength(CRITERES_HUMAINS.length)
  })
})
