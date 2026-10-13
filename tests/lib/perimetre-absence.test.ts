// ============================================================
// Ce qu'une absence couvre — et ce qu'elle ne couvre pas (B-163)
// ============================================================
// L'EXIGENCE — MiKL, le 13/10, en trois temps :
//
//   « il est possible qu'un véto soit absent la journée mais pas la nuit, ou
//    juste la nuit, ou juste le matin mais pas l'après-midi »
//   « il est possible qu'un véto soit absent pour une réunion parent-prof de 2h
//    un après-midi mais qu'il soit là le reste du temps »
//   « la journée ça n'est pas la nuit, ce sont 2 choses distinctes »
//
// 🔴 POURQUOI CE FICHIER EXISTE : CE CHAMP A DÉJÀ MENTI UNE FOIS.
//    `conges.creneau` offrait « Matin / Après-midi / Journée / Soirée » jusqu'au
//    26/08, et `checkR16Conge` ne l'a jamais lu — une matinée posée retirait la
//    garde du soir. Le champ a été supprimé plutôt que corrigé (B-043).
//
//    Les tests ci-dessous verrouillent donc les deux faces de la décision : ce
//    qu'un périmètre retire, et ce qu'il NE retire PAS. La seconde face est la
//    plus importante : c'est elle qui manquait.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  PERIMETRES,
  PERIMETRE_PAR_DEFAUT,
  LIBELLE_PERIMETRE,
  AIDE_PERIMETRE,
  blocsPartiels,
  blocsRetires,
  estPerimetre,
  estPonctuel,
  lirePerimetre,
  perimetresOfferts,
  phrasePerimetre,
  toucheLaJournee,
  toucheLesGardes,
  validerPerimetre,
  vautRepos,
} from '../../src/lib/absences/perimetre'

describe('La décision de MiKL, verrouillée', () => {
  it('« la journée ça n’est pas la nuit » — une absence de journée laisse la garde', () => {
    // C'EST LE CŒUR DU LOT. Jusqu'au 13/10, tout congé bloquait la garde du
    // soir. Si ce test tombe, le produit est revenu à ce comportement et la
    // demande du 13/10 est annulée sans que personne ne l'ait décidé.
    expect(toucheLesGardes('journee')).toBe(false)
    expect(toucheLaJournee('journee')).toBe(true)
  })

  it('« juste la nuit » — la garde tombe, la journée au cabinet reste', () => {
    expect(toucheLesGardes('nuit')).toBe(true)
    expect(toucheLaJournee('nuit')).toBe(false)
    expect(blocsRetires('nuit')).toEqual([])
  })

  it('la réunion parent-prof de 2h ne retire RIEN — ni présence, ni garde', () => {
    // L'option A, choisie explicitement contre l'option B (« retirer le bloc »)
    // et l'option C (« amputer le bloc »). Un ponctuel qui retirerait quelque
    // chose ferait disparaître quelqu'un d'un après-midi qu'il travaille.
    expect(toucheLesGardes('ponctuel')).toBe(false)
    expect(toucheLaJournee('ponctuel')).toBe(false)
    expect(blocsRetires('ponctuel')).toEqual([])
    expect(estPonctuel('ponctuel')).toBe(true)
  })

  it('journée + nuit retire tout — et c’est le comportement historique', () => {
    expect(toucheLesGardes('journee-et-nuit')).toBe(true)
    expect(toucheLaJournee('journee-et-nuit')).toBe(true)
  })
})

describe('Les blocs retirés, et ceux qui sont seulement entamés', () => {
  it('une absence du matin ne retire PAS un bloc « journée complète »', () => {
    // Les blocs du premier cabinet sont Matin 08-12, Après-midi 14-18 et
    // Journée complète 08-18 (mesurés en base le 13/10). Retirer le bloc
    // « journée » sur une absence du matin ferait disparaître quelqu'un d'un
    // après-midi qu'il travaille — le défaut que l'option A écarte.
    expect(blocsRetires('matin')).toEqual(['matin'])
    expect(blocsPartiels('matin')).toContain('journee')
  })

  it('l’après-midi se comporte en miroir du matin', () => {
    expect(blocsRetires('apres-midi')).toEqual(['apres-midi'])
    expect(blocsPartiels('apres-midi')).toContain('journee')
  })

  it('une absence de journée retire les trois créneaux, sans rien d’entamé', () => {
    expect(blocsRetires('journee').sort()).toEqual(['apres-midi', 'journee', 'matin'])
    expect(blocsPartiels('journee')).toEqual([])
  })

  it('un ponctuel n’entame que l’affichage, jamais la donnée', () => {
    expect(blocsRetires('ponctuel')).toEqual([])
    expect(blocsPartiels('ponctuel').length).toBeGreaterThan(0)
  })

  it('aucun créneau n’est à la fois retiré et entamé', () => {
    // Deux listes qui se recoupent voudraient dire « retiré et quand même
    // affiché » — soit deux écrans qui se contredisent sur la même présence.
    for (const p of PERIMETRES) {
      const chevauche = blocsRetires(p).filter((c) => blocsPartiels(p).includes(c))
      expect(chevauche, `le périmètre « ${p} » dit deux choses sur ${chevauche}`).toEqual([])
    }
  })
})

describe('Le repli, qui protège les données déjà acceptées', () => {
  it('rien, null, ou une valeur inconnue valent « journée et nuit »', () => {
    // 🔴 JAMAIS « ponctuel ». Les 32 congés posés avant ce lot ont été acceptés
    //    sous le comportement « un congé bloque tout ». Les relire plus
    //    permissivement rendrait disponibles des gardes que personne n'a
    //    acceptées — le produit inventerait du consentement.
    expect(lirePerimetre(null)).toBe('journee-et-nuit')
    expect(lirePerimetre(undefined)).toBe('journee-et-nuit')
    expect(lirePerimetre('soiree')).toBe('journee-et-nuit') // l'ancien vocabulaire de B-043
    expect(lirePerimetre(42)).toBe('journee-et-nuit')
    expect(PERIMETRE_PAR_DEFAUT).toBe('journee-et-nuit')
  })

  it('le repli retire toujours au moins autant que la valeur qu’il remplace', () => {
    // Formulation générale de la règle ci-dessus : aucun périmètre ne peut être
    // plus permissif que le repli, sinon un défaut de lecture libérerait.
    expect(toucheLesGardes(PERIMETRE_PAR_DEFAUT)).toBe(true)
    expect(toucheLaJournee(PERIMETRE_PAR_DEFAUT)).toBe(true)
  })

  it('reconnaît les six valeurs, et refuse tout le reste', () => {
    for (const p of PERIMETRES) expect(estPerimetre(p)).toBe(true)
    expect(estPerimetre('soiree')).toBe(false)
    expect(estPerimetre('')).toBe(false)
  })
})

describe('Ce que le moteur appelle un repos', () => {
  it('deux heures de réunion ne sont pas un repos', () => {
    // `estVeilleDeRepos` refuse une garde à quelqu'un qui enchaîne. Compter un
    // ponctuel comme repos fonderait ce refus sur rien.
    expect(vautRepos('ponctuel')).toBe(false)
  })

  it('les cinq autres périmètres valent repos', () => {
    for (const p of PERIMETRES.filter((x) => x !== 'ponctuel')) {
      expect(vautRepos(p), `« ${p} » devrait valoir repos`).toBe(true)
    }
  })
})

describe('Ce que la fenêtre propose, selon ce que le cabinet a acheté', () => {
  it('sans le module journée, aucun créneau de journée n’apparaît', () => {
    // Exigence de MiKL : « s'il n'a pas déclenché le planning journée, cette
    // option n'apparaît pas ». Un cabinet sans journée n'a pas de matin dans le
    // produit — lui en proposer un serait offrir un réglage sans effet.
    const offerts = perimetresOfferts(false)
    expect(offerts).not.toContain('matin')
    expect(offerts).not.toContain('apres-midi')
    expect(offerts).not.toContain('journee')
    expect(offerts).toContain('journee-et-nuit')
    expect(offerts).toContain('nuit')
  })

  it('avec le module, les six sont offerts', () => {
    expect(perimetresOfferts(true)).toHaveLength(PERIMETRES.length)
  })

  it('le comportement historique reste atteignable dans les deux cas', () => {
    // Sinon un cabinet sans module journée ne pourrait plus poser l'absence
    // totale qu'il pose depuis le premier jour.
    expect(perimetresOfferts(false)).toContain(PERIMETRE_PAR_DEFAUT)
    expect(perimetresOfferts(true)).toContain(PERIMETRE_PAR_DEFAUT)
  })
})

describe('Les heures du ponctuel', () => {
  it('un ponctuel sans heures est refusé', () => {
    const r = validerPerimetre('ponctuel', null, null)
    expect(r.ok).toBe(false)
  })

  it('une fin avant le début est refusée', () => {
    const r = validerPerimetre('ponctuel', '16:00', '14:00')
    expect(r.ok).toBe(false)
  })

  it('un ponctuel valide rend ses heures normalisées en HH:MM', () => {
    // Postgres rend « 14:00:00 », un <input type="time"> envoie « 14:00 ».
    // Comparer les deux formes produirait de faux écarts à l'affichage.
    const r = validerPerimetre('ponctuel', '14:00:00', '16:00')
    expect(r.ok && r.heures).toEqual({ heure_debut: '14:00', heure_fin: '16:00' })
  })

  it('les heures sont ÉCARTÉES sur un périmètre qui n’est pas ponctuel', () => {
    // Garder « 14h-16h » sur une absence devenue « toute la journée »
    // laisserait deux vérités dans la même ligne, et c'est la plus précise que
    // les écrans afficheraient — en annonçant une présence qui n'existe pas.
    const r = validerPerimetre('journee', '14:00', '16:00')
    expect(r.ok && r.heures).toBe(null)
  })

  it('un périmètre inconnu est refusé avec un message lisible', () => {
    const r = validerPerimetre('soiree')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.probleme).toMatch(/périmètre/i)
  })
})

describe('Ce que l’écran dit — sans quoi le choix serait un décor', () => {
  it('le ponctuel annonce ses heures ET qu’il ne change rien', () => {
    const phrase = phrasePerimetre('ponctuel', { heure_debut: '14:00', heure_fin: '16:00' })
    expect(phrase).toContain('14h')
    expect(phrase).toContain('16h')
    expect(phrase).toMatch(/reste du temps/i)
  })

  it('le cas général ne dit rien — un message permanent cesse d’être lu', () => {
    expect(phrasePerimetre('journee-et-nuit')).toBe(null)
  })

  it('les quatre autres périmètres se nomment', () => {
    for (const p of ['matin', 'apres-midi', 'journee', 'nuit'] as const) {
      expect(phrasePerimetre(p)).toBe(LIBELLE_PERIMETRE[p])
    }
  })

  it('chaque périmètre porte un libellé ET une aide — aucun silence', () => {
    // Une liste de six choix dont un seul est expliqué force l'admin à deviner,
    // et c'est exactement la question posée le 13/10 : « où est-ce que je mets
    // que ça concerne les gardes, les journées ou les 2 ? ».
    for (const p of PERIMETRES) {
      expect(LIBELLE_PERIMETRE[p]?.length, `libellé manquant pour ${p}`).toBeGreaterThan(0)
      expect(AIDE_PERIMETRE[p]?.length, `aide manquante pour ${p}`).toBeGreaterThan(0)
    }
  })
})
