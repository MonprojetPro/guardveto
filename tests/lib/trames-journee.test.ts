// ============================================================
// Les trames de présence de la journée — B-120 chantier 3, lot 1
// ============================================================
// Ces cas portent sur `src/lib/journee/trames.ts`. Ils ne touchent ni la base
// ni le réseau.
//
// ⚠️ LE GROUPE QUI COMPTE LE PLUS N'EST PAS LA VALIDATION, C'EST LA PARITÉ.
//
// Le cadrage V3 l'écrit comme le piège n°1 du chantier : « si la trame de
// journée pose une ancre, la même phrase produira deux plannings différents
// selon l'écran qui la lit ». Un décalage d'une semaine entre les règles de
// garde et la trame de journée ne lève aucune erreur, ne casse aucun test
// existant, et se découvre quand quelqu'un se présente le mauvais jour.
//
// D'où le groupe « MÊME CONVENTION QUE LE MOTEUR », qui ne teste pas un
// résultat attendu écrit à la main : il COMPARE les deux implémentations sur un
// an de dates. Un test qui recopierait les valeurs attendues ne verrait pas le
// moteur changer d'avis.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  JOURS_TRAME,
  LIBELLE_JOUR,
  LIBELLE_PARITE,
  PARITES_TRAME,
  phraseTrame,
  semaineImpairePourTrame,
  trameDejaPresente,
  trameViseCetteDate,
  validerTrame,
  validerTrames,
} from '@/lib/journee/trames'
import { estSemaineImpaire, jourDeLaSemaine } from '@/engine/utils'

const blocs = [
  { id: 'b-matin', nom: 'Matin', actif: true },
  { id: 'b-am', nom: 'Après-midi', actif: true },
  { id: 'b-vieux', nom: 'Visites du soir', actif: false },
]

const bonne = { veterinaire_id: 'v-1', bloc_id: 'b-matin', jour: 'lundi', semaine: 'impaire' }

describe('Le vocabulaire des trames', () => {
  it('couvre les sept jours, samedi et dimanche compris', () => {
    // Le repos fixe des gardes se limite au lundi-vendredi (`JOURS_VALIDES`).
    // Une permanence du samedi matin est un cas de cabinet courant : restreindre
    // ici aurait créé une limite que personne n'a demandée.
    expect(JOURS_TRAME).toHaveLength(7)
    expect(JOURS_TRAME).toContain('samedi')
    expect(JOURS_TRAME).toContain('dimanche')
  })

  it('n’admet que trois cadences, AU SINGULIER', () => {
    // Le pluriel est l'orthographe de `alternance_ancre`, et les confondre
    // n'applique jamais la règle. Ce test fige le singulier.
    expect([...PARITES_TRAME]).toEqual(['toutes', 'paire', 'impaire'])
    expect(PARITES_TRAME).not.toContain('paires')
    expect(PARITES_TRAME).not.toContain('impaires')
  })

  it('donne un libellé lisible à chaque jour et à chaque cadence', () => {
    for (const j of JOURS_TRAME) expect(LIBELLE_JOUR[j], `${j} sans libellé`).toBeTruthy()
    for (const p of PARITES_TRAME) expect(LIBELLE_PARITE[p], `${p} sans libellé`).toBeTruthy()
  })
})

describe('MÊME CONVENTION DE PARITÉ QUE LE MOTEUR — le piège n°1 du cadrage', () => {
  it('rend EXACTEMENT ce que rend le moteur, sur 400 jours consécutifs', () => {
    // ⚠️ On compare les deux implémentations, on ne recopie pas des valeurs
    //    attendues. Si le moteur change de convention, ce test rougit — c'est
    //    précisément son travail : forcer les deux mondes à bouger ensemble.
    //
    //    400 jours, pas 365 : la fenêtre doit traverser DEUX changements d'année,
    //    parce que c'est là que la semaine ISO 53 produit son décalage.
    const depart = Date.UTC(2026, 0, 1)
    let compares = 0
    for (let i = 0; i < 400; i++) {
      const d = new Date(depart + i * 86400000).toISOString().slice(0, 10)
      expect(semaineImpairePourTrame(d), `écart sur ${d}`).toBe(estSemaineImpaire(d))
      compares++
    }
    expect(compares).toBe(400)
  })

  it('n’utilise AUCUNE ancre — la même date donne toujours le même résultat', () => {
    // Si une ancre s'était glissée dans l'implémentation, le résultat dépendrait
    // d'un contexte. La signature à un seul argument est la garantie, et ce test
    // la rend visible : il échouerait si quelqu'un ajoutait un paramètre requis.
    expect(semaineImpairePourTrame.length).toBe(1)
    const a = semaineImpairePourTrame('2026-03-16')
    const b = semaineImpairePourTrame('2026-03-16')
    expect(a).toBe(b)
  })

  it('traverse la semaine ISO 53 de 2026 sans se taire', () => {
    // Contrepartie ASSUMÉE de l'absence d'ancre, documentée dans la migration et
    // dans `paramsRegle.ts` : au passage d'une année à 53 semaines, deux semaines
    // impaires se suivent une fois. Ce test ne corrige rien — il PROUVE que le
    // comportement est celui du moteur, pour que personne ne le « répare » d'un
    // côté seulement.
    const fin2026 = '2026-12-28' // lundi de la semaine ISO 53
    const debut2027 = '2027-01-04' // lundi de la semaine ISO 1
    expect(semaineImpairePourTrame(fin2026)).toBe(estSemaineImpaire(fin2026))
    expect(semaineImpairePourTrame(debut2027)).toBe(estSemaineImpaire(debut2027))
  })
})

describe('trameViseCetteDate — appliquer une trame, c’est répondre à cette question', () => {
  it('ne vise pas un autre jour de la semaine', () => {
    // 2026-03-16 est un lundi, 2026-03-17 un mardi.
    expect(jourDeLaSemaine('2026-03-16')).toBe('lundi')
    expect(trameViseCetteDate({ jour: 'lundi', semaine: 'toutes' }, '2026-03-16')).toBe(true)
    expect(trameViseCetteDate({ jour: 'lundi', semaine: 'toutes' }, '2026-03-17')).toBe(false)
  })

  it('« toutes les semaines » ne regarde jamais la parité', () => {
    // Deux lundis consécutifs, donc de parités opposées : les deux doivent
    // passer. Sans ce cas, un `&&` mal placé aurait divisé la trame par deux
    // sans que personne ne sache pourquoi.
    expect(trameViseCetteDate({ jour: 'lundi', semaine: 'toutes' }, '2026-03-16')).toBe(true)
    expect(trameViseCetteDate({ jour: 'lundi', semaine: 'toutes' }, '2026-03-23')).toBe(true)
  })

  it('« impaire » et « paire » sont exclusives sur une même date', () => {
    const date = '2026-03-16'
    const impaire = trameViseCetteDate({ jour: 'lundi', semaine: 'impaire' }, date)
    const paire = trameViseCetteDate({ jour: 'lundi', semaine: 'paire' }, date)
    expect(impaire).not.toBe(paire)
    // Et c'est bien la parité du moteur qui tranche, pas une table interne.
    expect(impaire).toBe(estSemaineImpaire(date))
  })

  it('alterne vraiment d’une semaine sur l’autre', () => {
    // Quatre lundis d'affilée : le motif doit être vrai-faux-vrai-faux, dans un
    // sens ou dans l'autre. Un test sur une seule date ne verrait pas une parité
    // figée sur une constante.
    const lundis = ['2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06']
    const vus = lundis.map((d) => trameViseCetteDate({ jour: 'lundi', semaine: 'impaire' }, d))
    expect(vus[0]).not.toBe(vus[1])
    expect(vus[1]).not.toBe(vus[2])
    expect(vus[2]).not.toBe(vus[3])
  })

  it('sait viser un samedi', () => {
    expect(jourDeLaSemaine('2026-03-21')).toBe('samedi')
    expect(trameViseCetteDate({ jour: 'samedi', semaine: 'toutes' }, '2026-03-21')).toBe(true)
  })
})

describe('validerTrame — les refus', () => {
  it('refuse une saisie sans personne', () => {
    const r = validerTrame({ ...bonne, veterinaire_id: '  ' }, blocs)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.probleme).toContain('de qui')
  })

  it('refuse une saisie sans tranche', () => {
    const r = validerTrame({ ...bonne, bloc_id: '' }, blocs)
    expect(r.ok).toBe(false)
  })

  it('refuse une tranche qui n’existe pas dans le cabinet', () => {
    const r = validerTrame({ ...bonne, bloc_id: 'b-inconnu' }, blocs)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.probleme).toContain('n’existe pas')
  })

  it('REFUSE une tranche RETIRÉE, en la nommant — le contrôle que la base ne peut pas faire', () => {
    // La clé étrangère ne regarde que l'existence de la ligne, jamais son
    // `actif`. Sans ce refus, la trame s'enregistrerait et ne poserait jamais
    // rien de visible, sans aucune erreur. C'est LE cas d'échec silencieux de
    // cette fonction.
    const r = validerTrame({ ...bonne, bloc_id: 'b-vieux' }, blocs)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.probleme).toContain('Visites du soir')
    expect(r.ok === false && r.probleme).toContain('retirée')
  })

  it('refuse un jour inventé', () => {
    const r = validerTrame({ ...bonne, jour: 'lundredi' }, blocs)
    expect(r.ok).toBe(false)
  })

  it('refuse le PLURIEL en expliquant pourquoi — c’est l’erreur la plus probable', () => {
    // « impaires » est l'orthographe de `alternance_ancre`. En base, elle
    // passerait le CHECK ? Non — mais surtout, sans message, l'admin chercherait
    // un bug là où il n'y a qu'une lettre.
    const r = validerTrame({ ...bonne, semaine: 'impaires' }, blocs)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.probleme).toContain('singulier')
  })

  it('refuse une cadence inventée', () => {
    const r = validerTrame({ ...bonne, semaine: 'une semaine sur trois' }, blocs)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.probleme).toContain('cadence')
  })
})

describe('validerTrame — ce qu’on accepte', () => {
  it('accepte une saisie complète et la normalise', () => {
    const r = validerTrame({ ...bonne, veterinaire_id: '  v-1  ' }, blocs)
    expect(r.ok).toBe(true)
    expect(r.ok === true && r.valeur).toEqual({
      veterinaire_id: 'v-1',
      bloc_id: 'b-matin',
      jour: 'lundi',
      semaine: 'impaire',
    })
  })

  it('accepte « toutes les semaines »', () => {
    expect(validerTrame({ ...bonne, semaine: 'toutes' }, blocs).ok).toBe(true)
  })

  it('accepte la MÊME personne sur DEUX tranches le même jour', () => {
    // Présente le matin ET l'après-midi du lundi : ce sont deux lignes, et c'est
    // le cas normal. Si la validation l'avait refusé, impossible de décrire une
    // journée complète en deux demi-journées.
    expect(validerTrame({ ...bonne, bloc_id: 'b-matin' }, blocs).ok).toBe(true)
    expect(validerTrame({ ...bonne, bloc_id: 'b-am' }, blocs).ok).toBe(true)
  })
})

describe('trameDejaPresente', () => {
  const existantes = [
    { id: 't-1', veterinaire_id: 'v-1', bloc_id: 'b-matin', jour: 'lundi', semaine: 'impaire', actif: true },
    { id: 't-2', veterinaire_id: 'v-1', bloc_id: 'b-am', jour: 'mardi', semaine: 'toutes', actif: false },
  ]
  const valeur = { veterinaire_id: 'v-1', bloc_id: 'b-matin', jour: 'lundi' as const, semaine: 'impaire' as const }

  it('voit le doublon exact', () => {
    expect(trameDejaPresente(valeur, existantes)).toEqual({ presente: true, actif: true })
  })

  it('distingue le doublon RETIRÉ — il appelle un autre message', () => {
    // Sans cette distinction, l'admin lirait « déjà dans la trame » en regardant
    // une liste où la ligne n'apparaît pas : elle est plus bas, dans les
    // retirées. Exactement le correctif que le chantier 2 a dû ajouter pour les
    // tranches.
    const retiree = { ...valeur, bloc_id: 'b-am', jour: 'mardi' as const, semaine: 'toutes' as const }
    expect(trameDejaPresente(retiree, existantes)).toEqual({ presente: true, actif: false })
  })

  it('ne se prend PAS elle-même pour son doublon quand on la modifie', () => {
    expect(trameDejaPresente(valeur, existantes, 't-1')).toEqual({ presente: false })
  })

  it('laisse passer une cadence différente sur le même jour', () => {
    // « lundi impaire » et « lundi paire » sont deux lignes légitimes : ensemble
    // elles valent « tous les lundis », et l'admin peut les saisir comme ça.
    expect(trameDejaPresente({ ...valeur, semaine: 'paire' }, existantes)).toEqual({ presente: false })
  })

  it('laisse passer une autre personne', () => {
    expect(trameDejaPresente({ ...valeur, veterinaire_id: 'v-2' }, existantes)).toEqual({
      presente: false,
    })
  })
})

describe('phraseTrame — une seule formulation pour toute l’application', () => {
  it('écrit « toutes les semaines » sans parler de parité', () => {
    expect(phraseTrame({ jour: 'lundi', semaine: 'toutes' }, 'Matin')).toBe(
      'Lundi, toutes les semaines — Matin',
    )
  })

  it('dit la cadence en français, pas en numéro ISO', () => {
    expect(phraseTrame({ jour: 'jeudi', semaine: 'impaire' }, 'Après-midi')).toBe(
      'Jeudi des semaines impaires — Après-midi',
    )
    expect(phraseTrame({ jour: 'samedi', semaine: 'paire' }, 'Visites')).toBe(
      'Samedi des semaines paires — Visites',
    )
  })
})

// ── Plusieurs jours d'un coup (B-147) ────────────────────────────────────────
//
// Demande de MiKL le 06/10, capture a l'appui : « on ne peut pas selectionner
// plusieurs jours ». Decrire « lundi + mardi + jeudi, matin » obligeait a
// saisir trois fois la meme phrase.
//
// ⚠️ CE QUI COMPTE ICI N'EST PAS LE CONFORT DE SAISIE, c'est que les refus de
//    `validerTrame` continuent TOUS de s'appliquer. Une validation multi-jours
//    qui reimplementerait ses propres controles aurait cree un second jeu de
//    regles, divergeant au premier correctif — « trois chemins d'ecriture, deux
//    gardiens ».

describe('validerTrames — plusieurs jours en une saisie', () => {
  const base = { veterinaire_id: 'v-1', bloc_id: 'b-matin', semaine: 'toutes' }

  it('rend une valeur par jour coche', () => {
    const r = validerTrames({ ...base, jours: ['lundi', 'mardi', 'jeudi'] }, blocs)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valeurs).toHaveLength(3)
      expect(r.valeurs.map((v) => v.jour)).toEqual(['lundi', 'mardi', 'jeudi'])
      expect(r.valeurs.every((v) => v.bloc_id === 'b-matin')).toBe(true)
      expect(r.valeurs.every((v) => v.veterinaire_id === 'v-1')).toBe(true)
    }
  })

  // La liste relue doit se lire comme un calendrier : « lundi, jeudi, mardi »
  // donne l'impression d'une saisie en desordre.
  it('range les jours dans l’ordre de la semaine, pas dans l’ordre de clic', () => {
    const r = validerTrames({ ...base, jours: ['jeudi', 'lundi', 'samedi', 'mardi'] }, blocs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valeurs.map((v) => v.jour)).toEqual(['lundi', 'mardi', 'jeudi', 'samedi'])
  })

  // Un formulaire ne devrait pas pouvoir envoyer deux fois « lundi », mais
  // l'URL le peut — et deux lignes identiques feraient echouer l'insertion
  // entiere sur l'index unique, avec un message de contrainte illisible.
  it('absorbe un jour repete au lieu de le refuser', () => {
    const r = validerTrames({ ...base, jours: ['lundi', 'lundi', 'mardi'] }, blocs)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valeurs.map((v) => v.jour)).toEqual(['lundi', 'mardi'])
  })

  it('refuse une liste vide, en disant quoi faire', () => {
    const r = validerTrames({ ...base, jours: [] }, blocs)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.probleme).toContain('au moins un jour')
  })

  // 🔑 LE GROUPE QUI COMPTE : les refus de `validerTrame` valent toujours.
  it('refuse toute la saisie si UN jour est inconnu', () => {
    const r = validerTrames({ ...base, jours: ['lundi', 'lundredi'] }, blocs)
    expect(r.ok).toBe(false)
  })

  it('refuse une tranche retiree, en nommant la tranche', () => {
    const r = validerTrames({ ...base, bloc_id: 'b-vieux', jours: ['lundi', 'mardi'] }, blocs)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.probleme).toContain('Visites du soir')
      expect(r.probleme).toContain('retirée')
    }
  })

  it('refuse le PLURIEL de la cadence, avec son message', () => {
    const r = validerTrames({ ...base, semaine: 'impaires', jours: ['lundi'] }, blocs)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.probleme).toContain('singulier')
  })

  it('refuse une saisie sans personne', () => {
    expect(validerTrames({ ...base, veterinaire_id: '  ', jours: ['lundi'] }, blocs).ok).toBe(false)
  })
})
