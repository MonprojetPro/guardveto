// ============================================================
// Ce qui fait une tranche horaire valide — B-120 chantier 2
// ============================================================
// Ces cas portent sur `src/lib/journee/blocs.ts`, la validation pure. Ils ne
// touchent ni la base ni le réseau : c'est précisément pour ça que la
// validation a été sortie de l'action serveur. Une règle qui n'est testable
// qu'en cliquant n'est jamais testée.
//
// ⚠️ Deux groupes de cas comptent plus que les autres, et ce ne sont pas les
//    refus évidents :
//    · ce qu'on ACCEPTE délibérément (chevauchement, bloc à cheval) — sans
//      ces cas, quelqu'un « corrigerait » un jour un faux défaut en ajoutant
//      une contrainte qui casserait le cas d'usage principal ;
//    · la NORMALISATION des heures — `08:00:00` de Postgres contre `08:00`
//      d'un champ de formulaire. C'est le genre d'écart qui fait dire « ça
//      n'a pas enregistré » alors que tout est en place.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  avertissementsBloc,
  CRENEAUX_BLOC,
  LIBELLE_CRENEAU,
  normaliserHeure,
  nomDejaPris,
  plageLisible,
  validerBloc,
} from '@/lib/journee/blocs'

const bon = { nom: 'Matin', debut: '08:00', fin: '12:00', creneau: 'matin' }

describe('Le vocabulaire des créneaux', () => {
  it('ne connaît que les trois moments de la JOURNÉE', () => {
    expect([...CRENEAUX_BLOC].sort()).toEqual(['apres-midi', 'journee', 'matin'])
  })

  it('n’inclut PAS la soirée — elle appartient au module des gardes', () => {
    // Décision ⑦ du cadrage V3 : les deux mondes ne se parlent pas. Un bloc de
    // journée posé le soir ferait tenir le même fait par deux modules.
    expect(CRENEAUX_BLOC).not.toContain('soiree')
  })

  it('donne un libellé lisible à chacun', () => {
    for (const c of CRENEAUX_BLOC) {
      expect(LIBELLE_CRENEAU[c], `${c} n’a pas de libellé`).toBeTruthy()
    }
  })
})

describe('normaliserHeure', () => {
  it('ramène la forme Postgres à la forme du formulaire', () => {
    // Sans ça, l'écran réaffiche `08:00:00` dans un champ `time` qui l'ignore,
    // et le champ paraît vide.
    expect(normaliserHeure('08:00:00')).toBe('08:00')
    expect(normaliserHeure('14:30')).toBe('14:30')
  })

  it('tolère les espaces de bord', () => {
    expect(normaliserHeure(' 09:15 ')).toBe('09:15')
  })

  it('refuse ce qui n’est pas une heure', () => {
    expect(normaliserHeure('25:00')).toBeNull()
    expect(normaliserHeure('08:60')).toBeNull()
    expect(normaliserHeure('8h')).toBeNull()
    expect(normaliserHeure('')).toBeNull()
  })
})

describe('validerBloc — les refus', () => {
  it('refuse un nom vide, ou qui n’est que des espaces', () => {
    expect(validerBloc({ ...bon, nom: '' }).ok).toBe(false)
    expect(validerBloc({ ...bon, nom: '   ' }).ok).toBe(false)
  })

  it('refuse un nom trop long pour la grille', () => {
    const r = validerBloc({ ...bon, nom: 'x'.repeat(41) })
    expect(r.ok).toBe(false)
  })

  it('refuse une fin avant le début', () => {
    const r = validerBloc({ ...bon, debut: '12:00', fin: '08:00' })
    expect(r.ok).toBe(false)
    // Le message cite les deux heures : « la fin doit être après le début »
    // tout seul oblige à rouvrir les champs pour comprendre lequel corriger.
    if (!r.ok) expect(r.probleme).toContain('08:00')
  })

  it('refuse une tranche de durée nulle', () => {
    expect(validerBloc({ ...bon, debut: '08:00', fin: '08:00' }).ok).toBe(false)
  })

  it('refuse la soirée EN EXPLIQUANT pourquoi', () => {
    // Un refus muet renverrait l'admin essayer autrement, indéfiniment.
    const r = validerBloc({ ...bon, creneau: 'soiree' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.probleme).toMatch(/gardes/)
  })

  it('refuse un créneau inventé', () => {
    expect(validerBloc({ ...bon, creneau: 'nuit' }).ok).toBe(false)
    expect(validerBloc({ ...bon, creneau: '' }).ok).toBe(false)
  })
})

describe('validerBloc — ce qu’on accepte DÉLIBÉRÉMENT', () => {
  it('accepte une tranche qui en recouvre d’autres', () => {
    // « Journée complète » 8h→18h contient « Matin » et « Après-midi ». C'est
    // le cas d'usage décrit par MiKL, pas une erreur de saisie : les blocs
    // sont un vocabulaire, jamais un découpage exclusif.
    const r = validerBloc({
      nom: 'Journée complète',
      debut: '08:00',
      fin: '18:00',
      creneau: 'journee',
    })
    expect(r.ok).toBe(true)
  })

  it('accepte une tranche à cheval, et laisse l’admin choisir son rattachement', () => {
    // Une garde de midi 12h→14h n'est ni franchement matin ni franchement
    // après-midi. Deviner à sa place aurait inventé une règle que personne
    // n'a demandée.
    const r = validerBloc({
      nom: 'Midi',
      debut: '12:00',
      fin: '14:00',
      creneau: 'apres-midi',
    })
    expect(r.ok).toBe(true)
  })

  it('accepte une tranche qui finit à minuit moins le quart', () => {
    expect(validerBloc({ ...bon, debut: '08:00', fin: '23:45' }).ok).toBe(true)
  })

  it('normalise au passage : nom élagué, heures en HH:MM', () => {
    const r = validerBloc({
      nom: '  Visites  ',
      debut: '09:00:00',
      fin: '11:30:00',
      creneau: 'matin',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valeur).toEqual({
        nom: 'Visites',
        debut: '09:00',
        fin: '11:30',
        creneau: 'matin',
      })
    }
  })
})

describe('nomDejaPris', () => {
  const existants = [
    { id: 'a', nom: 'Matin' },
    { id: 'b', nom: ' Après-midi ' },
  ]

  it('voit un doublon malgré la casse et les espaces', () => {
    expect(nomDejaPris('matin', existants)).toBe(true)
    expect(nomDejaPris('  MATIN', existants)).toBe(true)
    expect(nomDejaPris('après-midi', existants)).toBe(true)
  })

  it('laisse passer un nom neuf', () => {
    expect(nomDejaPris('Visites', existants)).toBe(false)
  })

  it('ne se prend PAS lui-même pour un doublon quand on le modifie', () => {
    // Sans `sauf`, changer l'horaire de « Matin » sans toucher son nom aurait
    // été refusé comme doublon de lui-même.
    expect(nomDejaPris('Matin', existants, 'a')).toBe(false)
    // Mais renommer « Après-midi » en « Matin » reste un vrai doublon.
    expect(nomDejaPris('Matin', existants, 'b')).toBe(true)
  })
})

describe('plageLisible', () => {
  it('écrit les heures rondes sans minutes', () => {
    expect(plageLisible('08:00:00', '12:00:00')).toBe('8h → 12h')
  })

  it('garde les minutes quand il y en a', () => {
    expect(plageLisible('08:30', '12:15')).toBe('8h30 → 12h15')
  })
})

// ============================================================
// B-144 — ce qu'une tranche tait sur elle-même
// ============================================================
// Le cas fondateur est le geste exact de MiKL le 01/10 : passer « Matin » de
// 8h-12h à 8h-18h. C'est le premier test ci-dessous, et il échouait avant.
//
// ⚠️ LES CAS QUI COMPTENT LE PLUS SONT LES SILENCES, pas les cris. Un
//    avertissement qui se déclenche trop souvent est un avertissement qu'on
//    apprend à ignorer : la garde de midi 12h→14h rattachée à l'après-midi est
//    EXPLICITEMENT voulue, et crier dessus aurait tué le cas d'usage.
// ============================================================

describe('avertissementsBloc — le silence que MiKL a trouvé le 01/10', () => {
  const codes = (b: Parameters<typeof avertissementsBloc>[0]) =>
    avertissementsBloc(b).map((a) => a.code)

  it('signale « Matin » passé de 8h-12h à 8h-18h — LE cas fondateur', () => {
    const avis = avertissementsBloc({ debut: '08:00', fin: '18:00', creneau: 'matin' })
    expect(avis).toHaveLength(1)
    expect(avis[0].code).toBe('couvre-plus')
    // Le texte dit la CONSÉQUENCE, pas la règle enfreinte : l'admin n'a pas à
    // deviner ce que « incohérent » voudrait dire pour son planning.
    expect(avis[0].texte).toContain('un congé du matin la retirera en entier')
  })

  it('se taît sur un matin qui finit à midi', () => {
    expect(codes({ debut: '08:00', fin: '12:00', creneau: 'matin' })).toEqual([])
  })

  it('se taît à 13h PILE — le seuil est une borne, pas un à-peu-près', () => {
    // Sans ce cas, un `>=` au lieu d'un `>` aurait crié sur un matin 8h-13h
    // parfaitement ordinaire, et personne n'aurait su pourquoi.
    expect(codes({ debut: '08:00', fin: '13:00', creneau: 'matin' })).toEqual([])
    expect(codes({ debut: '08:00', fin: '13:01', creneau: 'matin' })).toEqual(['couvre-plus'])
  })

  it('signale l’après-midi qui commence le matin', () => {
    const avis = avertissementsBloc({ debut: '08:00', fin: '18:00', creneau: 'apres-midi' })
    expect(avis.map((a) => a.code)).toEqual(['couvre-plus'])
    expect(avis[0].texte).toContain('matin compris')
  })

  it('LAISSE PASSER la garde de midi 12h→14h rattachée à l’après-midi', () => {
    // Cas explicitement voulu par MiKL le 01/10. S'il criait, l'avertissement
    // deviendrait du bruit et on cesserait de le lire — et c'est le seul mode de
    // défaillance réel d'un avertissement non bloquant.
    expect(codes({ debut: '12:00', fin: '14:00', creneau: 'apres-midi' })).toEqual([])
  })

  it('se taît à 12h PILE sur un après-midi', () => {
    expect(codes({ debut: '12:00', fin: '18:00', creneau: 'apres-midi' })).toEqual([])
    expect(codes({ debut: '11:59', fin: '18:00', creneau: 'apres-midi' })).toEqual(['couvre-plus'])
  })

  it('signale le cas SYMÉTRIQUE — une « journée entière » qui ne fait qu’une matinée', () => {
    // Celui-là n'est pas dans le board : un congé du matin ne retirera PAS
    // cette tranche, alors qu'elle ne contient que du matin. Même silence que le
    // cas fondateur, dans l'autre sens.
    const avis = avertissementsBloc({ debut: '08:00', fin: '12:00', creneau: 'journee' })
    expect(avis.map((a) => a.code)).toEqual(['couvre-moins'])
    expect(avis[0].texte).toContain('ne couvre qu’une partie de la journée')
  })

  it('se taît sur une vraie journée entière', () => {
    expect(codes({ debut: '08:00', fin: '18:00', creneau: 'journee' })).toEqual([])
  })

  it('ne dit rien quand les heures ne sont pas encore lisibles', () => {
    // Pendant la frappe, et sur une saisie que `validerBloc` refusera de toute
    // façon. Deux messages pour un seul défaut se contredisent à l'écran.
    expect(codes({ debut: '', fin: '12:00', creneau: 'matin' })).toEqual([])
    expect(codes({ debut: '18:00', fin: '08:00', creneau: 'matin' })).toEqual([])
    expect(codes({ debut: '08:00', fin: '18:00', creneau: 'soiree' })).toEqual([])
  })
})

describe('avertissementsBloc — deux tranches aux mêmes horaires', () => {
  const existantes = [
    { id: 'a', nom: 'Journée complète', debut: '08:00:00', fin: '18:00:00', actif: true },
    { id: 'b', nom: 'Vieux créneau', debut: '09:00:00', fin: '17:00:00', actif: false },
  ]

  it('signale le doublon d’horaires, en NOMMANT la tranche qui occupe déjà la place', () => {
    const avis = avertissementsBloc(
      { debut: '08:00', fin: '18:00', creneau: 'journee' },
      existantes,
    )
    expect(avis.map((a) => a.code)).toEqual(['memes-horaires'])
    // Dire « doublon » sans dire LAQUELLE obligerait à relire la liste entière.
    expect(avis[0].texte).toContain('Journée complète')
    expect(avis[0].texte).toContain('8h → 18h')
  })

  it('compare malgré la forme de Postgres — `08:00:00` contre `08:00`', () => {
    // Sans normalisation des deux côtés, le doublon le plus évident passait.
    expect(
      avertissementsBloc({ debut: '08:00:00', fin: '18:00:00', creneau: 'journee' }, existantes)
        .length,
    ).toBe(1)
  })

  it('ne crie PAS sur une tranche retirée — elle n’est plus proposée', () => {
    expect(
      avertissementsBloc({ debut: '09:00', fin: '17:00', creneau: 'journee' }, existantes).map(
        (a) => a.code,
      ),
    ).toEqual([])
  })

  it('ne se prend PAS elle-même pour son doublon quand on la modifie', () => {
    // Sans `sauf`, rouvrir « Journée complète » pour la renommer aurait affiché
    // « Journée complète couvre déjà exactement 8h → 18h ».
    expect(
      avertissementsBloc({ debut: '08:00', fin: '18:00', creneau: 'journee' }, existantes, 'a'),
    ).toEqual([])
  })

  it('cumule les deux reproches quand ils sont tous les deux vrais', () => {
    // C'est l'état exact de l'écran de MiKL le 01/10 : « Matin » 8h-18h à côté
    // de « Journée complète » 8h-18h. Deux anomalies distinctes, un seul geste.
    expect(
      avertissementsBloc({ debut: '08:00', fin: '18:00', creneau: 'matin' }, existantes).map(
        (a) => a.code,
      ),
    ).toEqual(['couvre-plus', 'memes-horaires'])
  })

  it('se taît quand il n’y a aucune autre tranche', () => {
    expect(avertissementsBloc({ debut: '08:00', fin: '12:00', creneau: 'matin' }, [])).toEqual([])
  })
})
