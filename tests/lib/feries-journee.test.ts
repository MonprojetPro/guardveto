// ============================================================
// Les jours fériés en journée — B-210 (13/11)
// ============================================================
// Proposition de la cliente (Val d'Allier), relayée par MiKL : « le logiciel
// devrait considérer que personne ne travaille en journée lors d'un jour
// férié ». Puis : « une option dans les réglages journées […] et par défaut on
// part du principe que non ».
//
// ⚠️ LE CAS QUI COMPTE LE PLUS N'EST PAS « LE 25 DÉCEMBRE EST SAUTÉ ».
//
// C'est le COMPTE de ce qui a été sauté. Un remplissage qui pose 3 présences
// là où l'admin en attendait 4, sans une ligne pour dire laquelle manque et
// pourquoi, se lit comme une panne — c'est la leçon B-148, déjà payée sur les
// absences. Le chiffre doit être juste, et il doit sortir du même calcul que
// l'écriture.
//
// ⚠️ LE SECOND CAS QUI COMPTE EST LE DÉFAUT DU PARAMÈTRE.
//
// `projeterPresences` saute les fériés quand on ne lui dit rien. Ce n'est pas
// un confort d'écriture : c'est le défaut PRODUIT. Un appelant futur qui
// oublie le réglage se comportera comme le produit l'annonce, au lieu de poser
// des présences un jour férié en silence — l'erreur exacte que ce lot corrige.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  presencesVoulues,
  projeterPresences,
  resumeApplication,
  type TramePourProjection,
} from '@/lib/journee/presences'
import { estJourFerie } from '@/engine/utils'
import { chantierOuvert } from '@/lib/produit/chantiers'

const blocs = [
  { id: 'b-matin', nom: 'Matin', actif: true },
  { id: 'b-am', nom: 'Après-midi', actif: true },
]

/** Novembre 2026 : du dimanche 1er au lundi 30. Le 11 (mercredi) est férié. */
const novembre = { id: 'p-nov', date_debut: '2026-11-01', date_fin: '2026-11-30' }

function trame(o: Partial<TramePourProjection> = {}): TramePourProjection {
  return {
    id: 't-1',
    veterinaire_id: 'v-anneso',
    bloc_id: 'b-matin',
    jour: 'mercredi',
    semaine: 'toutes',
    actif: true,
    ...o,
  }
}

// Les dates sur lesquelles tout le fichier repose. Vérifiées ICI plutôt que
// supposées : un test bâti sur une date qu'on croit fériée et qui ne l'est pas
// passe au vert sans rien prouver.
describe('les dates de référence sont bien ce qu’on croit', () => {
  it('le 11 novembre 2026 est un mercredi férié', () => {
    expect(estJourFerie('2026-11-11')).toBe(true)
    expect(new Date('2026-11-11T12:00:00Z').getUTCDay()).toBe(3)
  })

  it('les quatre autres mercredis de novembre 2026 ne le sont pas', () => {
    for (const d of ['2026-11-04', '2026-11-18', '2026-11-25']) {
      expect(estJourFerie(d), `${d} ne devrait pas être férié`).toBe(false)
    }
  })

  // Un férié MOBILE, et pas seulement les huit dates fixes : c'est la moitié du
  // calendrier, et celle qu'une implémentation pressée oublie.
  it('le lundi de Pentecôte 2026 (25 mai) est férié', () => {
    expect(estJourFerie('2026-05-25')).toBe(true)
    expect(new Date('2026-05-25T12:00:00Z').getUTCDay()).toBe(1)
  })
})

describe('un jour férié ne reçoit aucune présence', () => {
  it('saute le mercredi férié et garde les trois autres', () => {
    const p = projeterPresences([trame()], blocs, novembre)

    expect(p.voulues.map((v) => v.date)).toEqual([
      '2026-11-04',
      '2026-11-18',
      '2026-11-25',
    ])
    expect(p.ecarteesPourFerie).toBe(1)
    expect(p.ecarteesPourAbsence).toBe(0)
  })

  it('saute aussi un férié mobile', () => {
    const mai = { id: 'p-mai', date_debut: '2026-05-01', date_fin: '2026-05-31' }
    const p = projeterPresences([trame({ jour: 'lundi' })], blocs, mai)

    expect(p.voulues.map((v) => v.date)).not.toContain('2026-05-25')
    expect(p.ecarteesPourFerie).toBe(1)
  })

  // 🔑 LE DÉFAUT DU PARAMÈTRE EST LE DÉFAUT DU PRODUIT.
  it('saute les fériés quand on ne dit rien du réglage', () => {
    // Le même appel que ci-dessus, mais par la vue historique et sans le
    // cinquième argument : c'est la forme qu'ont tous les appels écrits avant
    // ce lot.
    expect(presencesVoulues([trame()], blocs, novembre).map((v) => v.date)).not.toContain(
      '2026-11-11',
    )
  })
})

describe('un cabinet qui ouvre les jours fériés', () => {
  it('pose la présence du 11 novembre comme un mercredi ordinaire', () => {
    const p = projeterPresences([trame()], blocs, novembre, [], true)

    expect(p.voulues.map((v) => v.date)).toEqual([
      '2026-11-04',
      '2026-11-11',
      '2026-11-18',
      '2026-11-25',
    ])
    expect(p.ecarteesPourFerie).toBe(0)
  })
})

describe('le compte des écartées est juste', () => {
  // 🔴 LE CAS QUI A FAIT REMONTER LE DÉDOUBLONNAGE DANS LA BOUCLE.
  //
  // Deux trames peuvent viser la même case : « toutes les semaines » et
  // « semaines impaires » sur le même jour et la même tranche. Tant que les
  // écarts étaient obtenus en soustrayant deux listes déjà dédoublonnées, le
  // défaut était impossible. En comptant au fil de la boucle, un 11 novembre
  // visé deux fois aurait annoncé 2 présences non posées là où le planning
  // n'en montre qu'une — un chiffre que personne n'aurait pu retrouver.
  it('ne compte qu’une fois une case visée par deux trames', () => {
    const p = projeterPresences(
      [trame({ id: 't-toutes' }), trame({ id: 't-impaires', semaine: 'impaire' })],
      blocs,
      novembre,
    )

    expect(p.ecarteesPourFerie).toBe(1)
  })

  // Une case écartée pour les deux motifs à la fois ne doit pas être comptée
  // deux fois, et le motif retenu est le plus englobant : le cabinet est fermé,
  // la question de savoir qui est en congé ne se pose plus.
  it('attribue au férié une case que l’absence écartait aussi', () => {
    const p = projeterPresences([trame()], blocs, novembre, [
      {
        veterinaire_id: 'v-anneso',
        date_debut: '2026-11-09',
        date_fin: '2026-11-13',
      },
    ])

    expect(p.ecarteesPourFerie).toBe(1)
    expect(p.ecarteesPourAbsence).toBe(0)
    expect(p.voulues.map((v) => v.date)).toEqual(['2026-11-04', '2026-11-18', '2026-11-25'])
  })

  it('compte séparément une absence hors jour férié', () => {
    const p = projeterPresences([trame()], blocs, novembre, [
      {
        veterinaire_id: 'v-anneso',
        date_debut: '2026-11-18',
        date_fin: '2026-11-18',
      },
    ])

    expect(p.ecarteesPourFerie).toBe(1)
    expect(p.ecarteesPourAbsence).toBe(1)
    expect(p.voulues.map((v) => v.date)).toEqual(['2026-11-04', '2026-11-25'])
  })
})

describe('les bords de la période et les lignes inactives', () => {
  // Une période qui COMMENCE ou FINIT un jour férié : les bornes sont incluses
  // dans `datesDeLaPeriode`, donc elles doivent être écartées comme les autres.
  it('écarte un férié placé sur la première date de la période', () => {
    const p = projeterPresences([trame()], blocs, {
      id: 'p',
      date_debut: '2026-11-11',
      date_fin: '2026-11-30',
    })
    expect(p.voulues.map((v) => v.date)).toEqual(['2026-11-18', '2026-11-25'])
    expect(p.ecarteesPourFerie).toBe(1)
  })

  it('écarte un férié placé sur la dernière date de la période', () => {
    const p = projeterPresences([trame()], blocs, {
      id: 'p',
      date_debut: '2026-11-01',
      date_fin: '2026-11-11',
    })
    // Le mercredi 4 est dans la fenêtre et n'est pas férié : il reste.
    expect(p.voulues.map((v) => v.date)).toEqual(['2026-11-04'])
    expect(p.ecarteesPourFerie).toBe(1)
  })

  // 🔑 L'ORDRE DES FILTRES COMPTE POUR LE CHIFFRE. Les trames et tranches
  //    inactives sont retirées AVANT la boucle : une trame éteinte ne doit donc
  //    pas gonfler le compte des « non posées pour cause de férié ». Annoncer
  //    une présence non posée pour une règle que l'admin a elle-même retirée
  //    l'enverrait chercher un problème qui n'existe pas.
  it('ne compte pas une trame inactive un jour férié', () => {
    const p = projeterPresences([trame({ actif: false })], blocs, novembre)
    expect(p.ecarteesPourFerie).toBe(0)
    expect(p.voulues).toEqual([])
  })

  it('ne compte pas une trame posée sur une tranche retirée', () => {
    const p = projeterPresences(
      [trame({ bloc_id: 'b-retire' })],
      [...blocs, { id: 'b-retire', nom: 'Visites', actif: false }],
      novembre,
    )
    expect(p.ecarteesPourFerie).toBe(0)
  })
})

describe('la vue `presencesVoulues` ne recalcule rien', () => {
  // Elle délègue à `projeterPresences`. Le test le prouve par l'égalité des
  // deux sorties sur un cas où les écarts jouent : une mesure vit dans le CORPS
  // d'une fonction, jamais dans sa signature (leçon du 16/10).
  it('rend exactement les `voulues` de la projection', () => {
    const absences = [
      { veterinaire_id: 'v-anneso', date_debut: '2026-11-18', date_fin: '2026-11-18' },
    ]
    expect(presencesVoulues([trame()], blocs, novembre, absences)).toEqual(
      projeterPresences([trame()], blocs, novembre, absences).voulues,
    )
  })
})

describe('la porte de chantier ne borne QUE l’écran', () => {
  // 🔑 LE POINT LE PLUS FACILE À CASSER DE TOUT CE CHANTIER.
  //
  // MiKL, 13/11 : « je veux juste que le bac a sable affiche tjrs les dernieres
  // versions et la vetovaldalier affiche une autre version d organisation ». La
  // CARTE de réglage est donc derrière `feries-journees`, bac à sable seul.
  //
  // 🔴 MAIS LE COMPORTEMENT NE DOIT PAS SUIVRE LA PORTE. C'est la cliente du
  //    Val d'Allier qui a demandé que personne ne travaille les jours fériés :
  //    brancher la projection sur ce chantier lui retirerait exactement ce
  //    qu'elle a demandé, et le ferait en silence. Quelqu'un qui « nettoie » en
  //    passant la porte à la projection casserait la demande d'origine sans
  //    qu'aucun autre test ne bronche — d'où ce cas-ci.
  it('la projection saute les fériés sans connaître aucun chantier', () => {
    // Aucun contexte de cabinet, aucun drapeau : la fonction pure n'en reçoit
    // pas, et c'est la preuve qu'elle n'en dépend pas.
    const p = projeterPresences([trame()], blocs, novembre)
    expect(p.voulues.map((v) => v.date)).not.toContain('2026-11-11')
    expect(p.ecarteesPourFerie).toBe(1)
  })

  it('le chantier existe, et il est bac à sable seulement', () => {
    // Si quelqu'un le bascule à tous les cabinets, ce test tombe : la bascule
    // est une décision de MiKL, elle doit être un geste écrit.
    expect(chantierOuvert('feries-journees', { estBacASable: true })).toBe(true)
    expect(chantierOuvert('feries-journees', { estBacASable: false })).toBe(false)
  })
})

describe('le chiffre des fériés est DIT, pas tu', () => {
  it('nomme le motif et dit où se change le réglage', () => {
    const r = resumeApplication([{ veterinaire_id: 'v', bloc_id: 'b', date: '2026-11-04', trame_id: 't' }], [{ veterinaire_id: 'v', bloc_id: 'b', date: '2026-11-04', trame_id: 't' }], 0, 1)

    expect(r.ecarteesPourFerie).toBe(1)
    expect(r.phrase).toContain('ce jour est férié')
    expect(r.phrase).toContain('Organisation › Journées')
  })

  it('accorde la phrase au pluriel', () => {
    const r = resumeApplication([], [], 0, 3)
    expect(r.phrase).toContain('3 présences non posées')
    expect(r.phrase).toContain('ces jours sont fériés')
  })

  // Sans ce cas, « rien à poser » et « rien à faire parce que tout est férié »
  // se confondraient — et l'admin irait corriger des semaines types justes.
  it('ne prétend pas qu’aucune trame ne s’applique quand tout est férié', () => {
    const r = resumeApplication([], [], 0, 2)
    expect(r.phrase).not.toContain('Aucune trame')
    expect(r.phrase).toContain('Rien à poser')
  })

  it('dit les deux motifs quand les deux jouent', () => {
    const r = resumeApplication([], [], 1, 1)
    expect(r.phrase).toContain('ce jour est férié')
    expect(r.phrase).toContain('absente')
  })

  it('se tait sur les fériés quand il n’y en a pas', () => {
    const r = resumeApplication([], [], 0, 0)
    expect(r.phrase).not.toContain('férié')
  })
})
