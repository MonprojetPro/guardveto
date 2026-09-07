// ============================================================
// B-118 — « CONCERNÉ » N'EST PAS « ALLÉGÉ OU CHARGÉ »
// ============================================================
// Le 07/09, sur un planning de test de MiKL, les trois points d'Antoine
// portaient tous la mention « Filou a dit pouvoir corriger ce point, mais n'a
// proposé aucun changement pour lui » — alors que le SEUL mouvement appliqué
// était pour Antoine, et le libérait du week-end du 5 décembre.
//
// Le garde-fou de B-109 comparait par CRITÈRE, et il avait raison de le faire :
// Filou avait bien promis une correction sur ces trois critères-là sans rien
// proposer dessus. C'est la PHRASE qui était fausse — elle parlait de la
// personne quand le calcul parlait du critère.
//
// Pour distinguer les deux cas, l'écran a besoin de savoir qui un mouvement a
// réellement touché. Et c'est là qu'un piège attendait : `effetSurLesPersonnes`
// compte le NET, donc quelqu'un déplacé sans gain ni perte en DISPARAÎT. Sur ce
// rapport, c'était le cas de Jean — deux soirs de semaine échangés, invisible
// au bilan, bel et bien déplacé.
//
// Ce test verrouille la différence entre les deux fonctions. Les gestes sont
// ceux du rapport réel du 07/09, copiés tels quels.
// ============================================================

import { describe, it, expect } from 'vitest'
import { personnesTouchees, effetSurLesPersonnes, resumerEffet } from '@/lib/relecture/resume'

/** Les 6 gestes du mouvement appliqué le 07/09, dans l'ordre du rapport. */
const GESTES_DU_07_09 = [
  'vendredi 4 décembre 2026 · Soir du vendredi · second : Fanny à la place de Antoine',
  'samedi 5 décembre 2026 · Week-end (sam+dim) · premier : Fanny à la place de Antoine',
  'lundi 30 novembre 2026 · Soir de semaine (lun-jeu) · premier : Fanny à la place de Antoine',
  'lundi 30 novembre 2026 · Soir de semaine (lun-jeu) · second : Antoine à la place de Fanny',
  'mercredi 2 décembre 2026 · Soir de semaine (lun-jeu) · premier : Antoine à la place de Jean',
  'jeudi 3 décembre 2026 · Soir de semaine (lun-jeu) · premier : Jean à la place de Fanny',
]

describe('qui ce mouvement concerne-t-il ?', () => {
  it('Antoine est concerné — c’était le cœur du défaut du 07/09', () => {
    expect(personnesTouchees(GESTES_DU_07_09).has('Antoine')).toBe(true)
  })

  it('les TROIS personnes déplacées sont concernées, y compris Jean', () => {
    expect(personnesTouchees(GESTES_DU_07_09)).toEqual(new Set(['Antoine', 'Fanny', 'Jean']))
  })

  it('💣 LE PIÈGE : le bilan net PERD Jean, qui est pourtant déplacé', () => {
    // Jean quitte le mercredi et prend le jeudi : ni allégé ni chargé, donc
    // absent du bilan. Se servir du bilan pour répondre « est-il concerné ? »
    // aurait laissé une accusation fausse sur ses constats à lui.
    const { allege, charge } = effetSurLesPersonnes(GESTES_DU_07_09)
    expect(allege.has('Jean')).toBe(false)
    expect(charge.has('Jean')).toBe(false)
    expect(resumerEffet(GESTES_DU_07_09)).toBe('Antoine −1 · Fanny +1')

    // La fonction dédiée, elle, le voit.
    expect(personnesTouchees(GESTES_DU_07_09).has('Jean')).toBe(true)
  })

  it('quelqu’un qui n’apparaît nulle part n’est pas concerné', () => {
    // Sans cette épreuve, une fonction qui rendrait « tout le monde » passerait
    // les trois tests précédents — et la mention ne s’afficherait plus jamais.
    const qui = personnesTouchees(GESTES_DU_07_09)
    expect(qui.has('Victor')).toBe(false)
    expect(qui.has('Anne-Sophie')).toBe(false)
  })

  it('aucun mouvement, personne de concerné', () => {
    expect(personnesTouchees([])).toEqual(new Set())
  })

  it('un geste au format inattendu est ignoré, jamais deviné', () => {
    const qui = personnesTouchees(['un texte qui ne suit pas le format', ...GESTES_DU_07_09])
    expect(qui).toEqual(new Set(['Antoine', 'Fanny', 'Jean']))
  })
})
