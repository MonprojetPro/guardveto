// ============================================================
// GUARDVETO — La meme absence deux fois, refusee (B-163a ④)
// ============================================================
// MiKL, le 14/10, apres avoir pose DEUX FOIS la meme indisponibilite ponctuelle
// (Jean, 26/10, 14h→16h) : « ca ne m'a pas signale qu'il y avait deja une
// absence de ce genre posee au meme moment », puis « on empeche de mettre 2
// fois la meme absence pour la meme personne, ca n'a pas de sens ».
//
// Ce que ce fichier verifie, dans l'ordre d'importance :
//   ① LA REGLE — ce qui se recouvre, et surtout ce qui NE SE RECOUVRE PAS.
//      Un refus trop large serait pire que pas de refus : il interdirait de
//      declarer « absent le matin » ET « absent la nuit », que B-163 vient
//      justement de rendre possible.
//   ② LA COUVERTURE DES CHEMINS — les DEUX endroits qui ecrivent dans
//      `absences` appellent la brique. C'est le defaut paye quatre fois sur ce
//      produit, et le premier jet de ce lot etait en train de le repayer : le
//      controle vivait dans la route, avec un commentaire affirmant qu'il
//      « tenait pour tous les appelants ». Filou ecrit en direct.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  perimetresSeRecouvrent,
  phrasePerimetreCourte,
  tranchesCouvertes,
  type PerimetreAbsence,
} from '../../src/lib/absences/perimetre'
import { phraseDoublon } from '../../src/lib/absences/doublon'

const RACINE = join(process.cwd(), 'src')

describe('① Ce qui se recouvre', () => {
  it('refuse deux fois le MEME perimetre', () => {
    for (const p of ['matin', 'apres-midi', 'journee', 'nuit', 'journee-et-nuit'] as const) {
      expect(perimetresSeRecouvrent(p, p), p).toBe(true)
    }
  })

  it('refuse un perimetre CONTENU dans un autre', () => {
    // « Le matin » est deja dit par « toute la journee ».
    expect(perimetresSeRecouvrent('matin', 'journee')).toBe(true)
    expect(perimetresSeRecouvrent('journee', 'matin')).toBe(true)
    expect(perimetresSeRecouvrent('nuit', 'journee-et-nuit')).toBe(true)
    expect(perimetresSeRecouvrent('apres-midi', 'journee-et-nuit')).toBe(true)
  })

  it('🔴 LAISSE PASSER deux perimetres DISJOINTS — le cas qu’un refus trop large casserait', () => {
    // Absent le matin ET de garde indisponible la nuit : deux faits vrais
    // ensemble, et deux lignes legitimes. Les refuser reprendrait d'une main
    // ce que B-163 a donne de l'autre.
    expect(perimetresSeRecouvrent('matin', 'nuit')).toBe(false)
    expect(perimetresSeRecouvrent('apres-midi', 'nuit')).toBe(false)
    expect(perimetresSeRecouvrent('journee', 'nuit')).toBe(false)
    // Matin et apres-midi ne se touchent pas non plus.
    expect(perimetresSeRecouvrent('matin', 'apres-midi')).toBe(false)
  })

  it('le ponctuel ne se compare QU’A un autre ponctuel', () => {
    const h = { heure_debut: '14:00', heure_fin: '16:00' }
    // Un rendez-vous de 15h un jour ou la personne est deja absente le matin :
    // deux informations distinctes, toutes deux utiles.
    for (const p of ['matin', 'apres-midi', 'journee', 'nuit', 'journee-et-nuit'] as const) {
      expect(perimetresSeRecouvrent('ponctuel', p, h, null), p).toBe(false)
      expect(perimetresSeRecouvrent(p, 'ponctuel', null, h), p).toBe(false)
    }
  })

  it('deux ponctuels se refusent si leurs HEURES se croisent', () => {
    const a = { heure_debut: '14:00', heure_fin: '16:00' }
    // Le doublon exact de MiKL.
    expect(perimetresSeRecouvrent('ponctuel', 'ponctuel', a, a)).toBe(true)
    // Croisement partiel.
    expect(
      perimetresSeRecouvrent('ponctuel', 'ponctuel', a, { heure_debut: '15:00', heure_fin: '17:00' }),
    ).toBe(true)
    // ⚠️ BORNES EXCLUES : 14h-16h et 16h-18h SE SUIVENT, elles ne se
    //    chevauchent pas. Les refuser interdirait deux rendez-vous d'affilee.
    expect(
      perimetresSeRecouvrent('ponctuel', 'ponctuel', a, { heure_debut: '16:00', heure_fin: '18:00' }),
    ).toBe(false)
    expect(
      perimetresSeRecouvrent('ponctuel', 'ponctuel', a, { heure_debut: '09:00', heure_fin: '11:00' }),
    ).toBe(false)
  })

  it('sans heures des deux cotes, le doute profite a l’ecriture', () => {
    // On n'invente pas un conflit pour refuser une saisie.
    expect(perimetresSeRecouvrent('ponctuel', 'ponctuel', null, null)).toBe(false)
    expect(
      perimetresSeRecouvrent('ponctuel', 'ponctuel', { heure_debut: '14:00', heure_fin: '16:00' }, null),
    ).toBe(false)
  })

  it('la relation est SYMETRIQUE — sur les 36 paires', () => {
    const tous: PerimetreAbsence[] = ['ponctuel', 'matin', 'apres-midi', 'journee', 'nuit', 'journee-et-nuit']
    const h = { heure_debut: '14:00', heure_fin: '16:00' }
    for (const a of tous) {
      for (const b of tous) {
        expect(
          perimetresSeRecouvrent(a, b, h, h),
          `${a} / ${b}`,
        ).toBe(perimetresSeRecouvrent(b, a, h, h))
      }
    }
  })

  it('tranchesCouvertes couvre les 6 valeurs, et le ponctuel n’occupe rien', () => {
    expect(tranchesCouvertes('ponctuel')).toEqual([])
    expect(tranchesCouvertes('journee-et-nuit')).toEqual(['matin', 'apres-midi', 'nuit'])
    expect(tranchesCouvertes('journee')).toEqual(['matin', 'apres-midi'])
  })
})

describe('② La couverture des chemins d’ecriture', () => {
  // ⚠️ CE TEST EST LA RAISON D'ETRE DU FICHIER. Il ne juge pas un resultat, il
  //    verifie qu'AUCUN chemin d'ecriture n'a ete oublie. Un grep ne prouve pas
  //    qu'un code est APPELE — mais il prouve qu'un fichier qui ecrit dans
  //    `absences` sans citer la brique est, lui, certainement en faute.
  const CHEMINS_QUI_ECRIVENT = [
    'app/api/absences/route.ts',
    'lib/ia/outils/absences.ts',
  ]

  it('les deux chemins connus appellent `trouverAbsenceEnDoublon`', () => {
    for (const chemin of CHEMINS_QUI_ECRIVENT) {
      const source = readFileSync(join(RACINE, chemin), 'utf8')
      expect(source.includes('trouverAbsenceEnDoublon'), chemin).toBe(true)
    }
  })

  it('🔦 AUCUN AUTRE fichier n’insere dans `absences` sans citer la brique', () => {
    // La liste ci-dessus pourrait vieillir en silence : on la confronte a la
    // realite du code. Un troisieme chemin apparaitrait ici, pas dans six mois
    // devant une capture d'ecran.
    const fautifs = fichiersQuiInserentDansAbsences().filter(
      (f) => !readFileSync(join(RACINE, f), 'utf8').includes('trouverAbsenceEnDoublon'),
    )
    expect(
      fautifs,
      'Ces fichiers ecrivent dans `absences` sans verifier le doublon :\n  '
        + fautifs.join('\n  '),
    ).toEqual([])
  })

  it('la liste ci-dessus n’a pas vieilli : elle cite TOUS les chemins trouves', () => {
    for (const f of fichiersQuiInserentDansAbsences()) {
      expect(CHEMINS_QUI_ECRIVENT, `${f} ecrit dans absences`).toContain(f)
    }
  })
})

describe('③ Ce que le refus DIT', () => {
  it('nomme le perimetre et les dates — jamais « doublon detecte »', () => {
    const p = phraseDoublon('matin', '2026-10-26', '2026-10-26')
    expect(p).toContain('Le matin')
    expect(p).toContain('26 octobre 2026')
    expect(p).not.toContain('undefined')
  })

  it('dit « du … au … » sur plusieurs jours', () => {
    expect(phraseDoublon('nuit', '2026-10-26', '2026-10-28'))
      .toContain('du 26 octobre 2026 au 28 octobre 2026')
  })

  // 🔴 B-163d ④ — LE GARDIEN DU FORMAT, demande par MiKL le 15/10 : « il faut
  //    que tu mettes les dates au format europeen, c'est pas la 1ere fois, y en
  //    a plein des comme ca ». Une phrase lue par l'administratrice ne doit
  //    JAMAIS contenir une date ISO. Ce test l'interdit sur ce message-ci ;
  //    les deux tests ci-dessus verifient la forme attendue. Les deux sont
  //    necessaires : interdire l'ISO ne dit pas que le francais est juste.
  it('⛔ aucune date ISO ne survit dans une phrase lue par un humain', () => {
    const phrases = [
      phraseDoublon('matin', '2026-10-26', '2026-10-26'),
      phraseDoublon('nuit', '2026-10-26', '2026-10-28'),
      phraseDoublon('ponctuel', '2026-01-02', '2026-12-31'),
    ]
    for (const p of phrases) {
      expect(/\d{4}-\d{2}-\d{2}/.test(p), `date ISO dans : ${p}`).toBe(false)
    }
  })
})

describe('④ La mention courte, pour une case de grille', () => {
  it('rend `null` pour le cas general — une mention permanente cesse d’etre lue', () => {
    expect(phrasePerimetreCourte('journee-et-nuit')).toBeNull()
  })

  it('rend les heures pour un ponctuel, et un repli quand elles manquent', () => {
    expect(phrasePerimetreCourte('ponctuel', { heure_debut: '14:00', heure_fin: '16:00' }))
      .toContain('14')
    expect(phrasePerimetreCourte('ponctuel', null)).toBe('quelques heures')
  })

  it('nomme les quatre autres', () => {
    expect(phrasePerimetreCourte('matin')).toBe('absent matin')
    expect(phrasePerimetreCourte('apres-midi')).toBe('absent après-midi')
    expect(phrasePerimetreCourte('journee')).toBe('absent journée')
    expect(phrasePerimetreCourte('nuit')).toBe('absent nuit')
  })
})

/**
 * Les fichiers de `src/` qui INSERENT dans `absences`.
 *
 * Volontairement grossier : on cherche `from('absences')` suivi, dans le meme
 * fichier, d'un `.insert(`. Un faux positif coute une ligne dans la liste ; un
 * faux negatif coute un chemin d'ecriture non protege.
 */
function fichiersQuiInserentDansAbsences(): string[] {
  const out: string[] = []
  for (const chemin of fichiersSources(RACINE)) {
    const source = readFileSync(join(RACINE, chemin), 'utf8')
    if (!source.includes("from('absences')")) continue
    // L'insertion peut etre sur la ligne suivante : on regarde le fichier.
    if (!/from\('absences'\)\s*\n?\s*\.?\s*insert\(/.test(source)) continue
    out.push(chemin.replace(/\\/g, '/'))
  }
  return out
}

function fichiersSources(racine: string, prefixe = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(racine, prefixe), { withFileTypes: true })) {
    const suivant = prefixe ? `${prefixe}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...fichiersSources(racine, suivant))
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(suivant)
  }
  return out
}
