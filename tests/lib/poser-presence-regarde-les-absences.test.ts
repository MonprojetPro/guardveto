// ============================================================
// GUARDVETO — Poser une presence a la main regarde enfin les absences (B-165b)
// ============================================================
// MiKL, 16/10, devant le tableau de bord journalier :
//
//   « j'ai pu mettre Anne-Sophie le matin alors qu'elle est notee absente,
//    je n'ai aucune info qui me le signalait »
//
// 🔴 LA CAUSE N'ETAIT PAS DANS L'ECRAN. `absencesDeLaPeriode()` vit dans
//    `presences-actions.ts` depuis B-148 et repond deja a la question produit
//    « quelles absences bloquent ». Elle etait appelee par
//    `apercuApplicationTrames` et par `appliquerTrames` — donc **l'application
//    des recurrences respectait les absences** — et **`poserPresence` ne
//    l'appelait pas**.
//
// 🔑 DEUX CHEMINS D'ECRITURE, UN SEUL GARDIEN. C'est le defaut du 22/08, et il
//    s'est reproduit ici **alors que les deux chemins vivent dans le MEME
//    FICHIER**, a 150 lignes l'un de l'autre. La proximite ne protege de rien :
//    ce qui protege, c'est qu'un seul endroit reponde a la question.
//
// ⚠️ ON N'INTERDIT PAS, ON INFORME. Quelqu'un peut revenir avant la fin de son
//    arret, et l'administratrice est la seule a le savoir. La presence est
//    posee ; l'action rend un `avertissement` en plus de son `message`.
//
// ── CE QUE CE FICHIER PEUT PROUVER, ET CE QU'IL NE PEUT PAS ─────────────────
//
// ✅ Il prouve que `estAbsentSurCeBloc` repond juste sur le cas reel de MiKL,
//    y compris les trois pieges de bord (journee complete, apres-midi, nuit).
// ⚠️ Il NE PEUT PAS executer `poserPresence` : c'est une action serveur qui
//    ouvre une porte Supabase. Le second `describe` lit donc le SOURCE pour
//    verifier que l'appel est la — c'est faible, et c'est assume : un grep
//    prouve qu'un code est ecrit, **jamais qu'il produit le bon resultat**.
//    Il attrape neanmoins le seul scenario qui s'est reellement produit : le
//    controle qu'on oublie de brancher.
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estAbsentSurCeBloc, type AbsencePourPresences } from '@/lib/journee/presences'

/** Le cas exact de la recette : Anne-Sophie, absente « le matin » du 19/10. */
const ANNE_SOPHIE_LE_MATIN: AbsencePourPresences = {
  veterinaire_id: 'anne-sophie',
  date_debut: '2026-10-19',
  date_fin: '2026-10-19',
  perimetre: 'matin',
}

describe('Le cas de la recette du 16/10 — Anne-Sophie, absente le matin', () => {
  it('🔴 le bloc MATIN est bien couvert — c’est ce qui n’etait pas dit', () => {
    expect(
      estAbsentSurCeBloc([ANNE_SOPHIE_LE_MATIN], 'anne-sophie', '2026-10-19', 'matin'),
    ).toBe(true)
  })

  it('l’APRES-MIDI ne l’est pas : elle travaille', () => {
    expect(
      estAbsentSurCeBloc([ANNE_SOPHIE_LE_MATIN], 'anne-sophie', '2026-10-19', 'apres-midi'),
    ).toBe(false)
  })

  it('⚠️ « Journee complete » NON PLUS — une absence du matin ne libere pas 8h-18h', () => {
    // Arbitrage de MiKL du 13/10, option A : quelqu'un d'absent le matin et
    // pose sur « Journee complete » est bel et bien la de 14h a 18h. Avertir
    // ici ferait crier le produit sur une presence parfaitement legitime, et
    // un avertissement qui crie tout le temps cesse d'etre lu.
    expect(
      estAbsentSurCeBloc([ANNE_SOPHIE_LE_MATIN], 'anne-sophie', '2026-10-19', 'journee'),
    ).toBe(false)
  })

  it('quelqu’un d’autre n’est pas concerne', () => {
    expect(
      estAbsentSurCeBloc([ANNE_SOPHIE_LE_MATIN], 'fanny', '2026-10-19', 'matin'),
    ).toBe(false)
  })

  it('un autre jour n’est pas concerne', () => {
    expect(
      estAbsentSurCeBloc([ANNE_SOPHIE_LE_MATIN], 'anne-sophie', '2026-10-20', 'matin'),
    ).toBe(false)
  })
})

describe('Les perimetres qui ne retirent RIEN ne doivent jamais avertir', () => {
  // Un perimetre `ponctuel` a ete defini le 13/10 comme n'ayant par
  // construction aucun effet sur le planning. Avertir dessus rendrait le
  // message faux : rien n'est retire, la personne est la.
  const cas: { perimetre: AbsencePourPresences['perimetre']; attendu: boolean }[] = [
    { perimetre: 'ponctuel', attendu: false },
    { perimetre: 'nuit', attendu: false },
    { perimetre: 'journee', attendu: true },
    { perimetre: 'journee-et-nuit', attendu: true },
  ]

  for (const { perimetre, attendu } of cas) {
    it(`« ${perimetre} » sur un bloc du matin → ${attendu}`, () => {
      expect(
        estAbsentSurCeBloc(
          [{ ...ANNE_SOPHIE_LE_MATIN, perimetre }],
          'anne-sophie',
          '2026-10-19',
          'matin',
        ),
      ).toBe(attendu)
    })
  }
})

describe('🔦 Le controle est reellement BRANCHE dans poserPresence', () => {
  /**
   * ⚠️ CE TEST LIT LE SOURCE, et c'est une faiblesse assumee. Il ne prouve pas
   *    que le resultat est juste — le premier `describe` s'en charge. Il prouve
   *    que l'appel existe DANS CETTE FONCTION, ce qui est exactement ce qui
   *    manquait : la brique etait ecrite, testee, et personne ne l'appelait sur
   *    ce chemin-la.
   */
  function corpsDe(nom: string): string {
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', '(v2)', 'journee', 'presences-actions.ts'),
      'utf8',
    )
    const debut = source.indexOf(`export async function ${nom}(`)
    expect(debut, `${nom} doit exister`).toBeGreaterThan(-1)
    // Jusqu'a la fonction exportee suivante, ou la fin du fichier.
    const suite = source.indexOf('\nexport ', debut + 10)
    return source.slice(debut, suite === -1 ? undefined : suite)
  }

  it('🔦 contre-epreuve — l’extraction isole bien UNE fonction', () => {
    // Sans ceci, les trois assertions suivantes seraient crédules : si
    // `corpsDe` rendait le fichier entier, elles passeraient quel que soit
    // l'endroit ou l'appel se trouve — y compris la ou il etait deja, dans
    // `appliquerTrames`, c'est-a-dire exactement le bug qu'on repare.
    expect(corpsDe('retirerPresence')).not.toContain('estAbsentSurCeBloc')
    expect(corpsDe('retirerPresence')).toContain('retirerPresence')
  })

  it('poserPresence lit les absences de la periode', () => {
    expect(corpsDe('poserPresence')).toContain('absencesDeLaPeriode')
  })

  it('poserPresence interroge estAbsentSurCeBloc', () => {
    expect(corpsDe('poserPresence')).toContain('estAbsentSurCeBloc')
  })

  it('⚠️ et il POSE quand meme — on informe, on n’interdit pas', () => {
    const corps = corpsDe('poserPresence')
    // L'insertion doit venir APRES le controle : si le controle refusait, il
    // n'y aurait pas d'insertion a sa suite.
    //
    // ⚠️ On cherche `.insert(` et pas la chaine complete avec son saut de ligne
    //    et son indentation : le fichier est en CRLF sur ce poste, et une
    //    assertion qui depend de la mise en forme casse au premier reformatage
    //    — un test rouge pour une raison qui n'interesse personne finit par
    //    etre neutralise, et c'est le controle qu'on perd.
    const posePosition = corps.indexOf('.insert(')
    expect(posePosition, 'l’insertion doit exister').toBeGreaterThan(-1)
    expect(corps.indexOf('estAbsentSurCeBloc')).toBeLessThan(posePosition)
    expect(corps).toContain('avertissement')
  })
})
