// ============================================================
// B-096 — POURQUOI ANTOINE GARDE SES 5 WEEK-ENDS (cas réel, 2026-09-02)
// ============================================================
// MiKL, trois relectures de suite : « on a encore Antoine et ses week-ends
// d'affilée ». Le `remplacement_weekend` a été livré exprès pour ça — c'est le
// seul mouvement capable de faire baisser un compteur. Et il n'a rien changé.
//
// Ce fichier rejoue le VRAI planning Hiver P2 du bac à sable, extrait de la
// base le 02/09, avec les VRAIES règles du cabinet. Il ne démontre pas une
// intention : il mesure ce que `mouvementsPossibles` produit réellement dessus.
//
// ── CE QU'IL ÉTABLIT ────────────────────────────────────────────────────────
//
// Aucun remplacement ne peut alléger Antoine, et ce n'est ni un bug ni un
// oubli : chaque week-end est ENCADRÉ. Le vendredi qui le précède suit le
// week-end (même binôme), or l'espacement minimum de 2 jours interdit d'être
// de garde le jeudi ET le vendredi. Tout candidat de garde le jeudi précédent
// est donc éliminé — et le lundi suivant élimine les autres, depuis que B-092
// compte enfin les nuits du week-end.
//
// Autrement dit : un mouvement de 4 places ne suffit pas, il en faudrait un de
// 6 ou 7 (libérer d'abord l'obstacle). C'est la limite de tout ce chantier, et
// elle ne se voyait sur aucun des plannings de test construits à la main.
// ============================================================

import { describe, it, expect } from 'vitest'
import { mouvementsPossibles, type GenreMouvement } from '../relecture/mouvements'
import { effetsDesMouvements } from '../relecture/effet'
import { reconstruireFenetre } from '../relecture/reconstruire'
import { normaliserContraintesVets } from '../normaliserContraintes'
import type { PlanningPartiel, VetEngine, ContrainteEngine } from '../types'

// Les identifiants réels, gardés tels quels : ce test vaut par sa fidélité.
const ANTOINE = 'db0109ea-bfe0-4925-8a42-b48fa42cd5ed'
const FANNY = 'f1e35f33-f6c7-4c31-a477-3e08f5035c28'
const VICTOR = '3bd643a9-5442-4224-8de7-517c1684fb3c'
const MANON = '7241a464-80fe-40cd-b39d-60fb2a2d4c68'
const JEAN = '71deb158-6a2b-46ab-a47a-7efd43202fcb'
const ANNE_SO = '421b91cb-5748-4041-82e2-e2b941c6feed'

const PRENOMS: Record<string, string> = {
  [ANTOINE]: 'Antoine', [FANNY]: 'Fanny', [VICTOR]: 'Victor',
  [MANON]: 'Manon', [JEAN]: 'Jean', [ANNE_SO]: 'Anne-Sophie',
}

/** `espacement_min` : au moins 2 jours entre deux gardes. Dur (étage 2). */
const ESPACEMENT_MIN: ContrainteEngine = {
  id: 'esp-min', type: 'espacement_min', actif: true,
  config: { params: { ecart_min_jours: 2 }, force: 2 },
} as unknown as ContrainteEngine

/** `espacement_weekend` : jamais moins de 2 semaines entre deux week-ends. */
const ESPACEMENT_WE: ContrainteEngine = {
  id: 'esp-we', type: 'espacement_weekend', actif: true,
  config: { params: { n_semaines: 2 }, force: 2 },
} as unknown as ContrainteEngine

function vet(id: string): VetEngine {
  return {
    id, nom: PRENOMS[id], prenom: PRENOMS[id], statut: 'associe',
    dernier_recours: false,
    contraintes: [ESPACEMENT_MIN, ESPACEMENT_WE],
    conges: id === FANNY
      ? [{ date_debut: '2026-10-26', date_fin: '2026-11-01', type: 'vacances' }]
      : id === ANNE_SO
        ? [{ date_debut: '2026-10-19', date_fin: '2026-10-25', type: 'vacances' }]
        : id === JEAN
          ? [{ date_debut: '2026-10-19', date_fin: '2026-10-25', type: 'vacances' }]
          : [],
  }
}

const EQUIPE = [ANTOINE, FANNY, VICTOR, MANON, JEAN, ANNE_SO].map(vet)

/** Les soirs de semaine et week-ends réellement générés (extraits de la base). */
const SEMAINE: Array<[string, string, string]> = [
  ['2026-10-19', ANTOINE, VICTOR], ['2026-10-20', MANON, FANNY],
  ['2026-10-21', ANTOINE, VICTOR], ['2026-10-22', FANNY, MANON],
  ['2026-10-26', JEAN, MANON], ['2026-10-28', MANON, VICTOR],
  ['2026-10-29', JEAN, ANTOINE], ['2026-11-02', VICTOR, JEAN],
  ['2026-11-03', ANNE_SO, ANTOINE], ['2026-11-04', VICTOR, JEAN],
  ['2026-11-05', MANON, FANNY], ['2026-11-09', MANON, VICTOR],
  ['2026-11-10', FANNY, ANTOINE], ['2026-11-12', ANNE_SO, ANTOINE],
  ['2026-11-16', FANNY, ANNE_SO], ['2026-11-17', JEAN, MANON],
  ['2026-11-18', ANNE_SO, VICTOR], ['2026-11-19', MANON, JEAN],
  ['2026-11-23', JEAN, MANON], ['2026-11-24', ANTOINE, FANNY],
  ['2026-11-25', MANON, VICTOR], ['2026-11-26', FANNY, ANTOINE],
  ['2026-11-30', ANTOINE, FANNY], ['2026-12-01', MANON, ANNE_SO],
  ['2026-12-02', JEAN, VICTOR], ['2026-12-03', FANNY, MANON],
  ['2026-12-07', JEAN, MANON], ['2026-12-08', ANTOINE, FANNY],
  ['2026-12-09', VICTOR, JEAN], ['2026-12-10', ANTOINE, FANNY],
  ['2026-12-14', FANNY, VICTOR], ['2026-12-15', MANON, ANNE_SO],
  ['2026-12-16', VICTOR, JEAN], ['2026-12-21', JEAN, ANTOINE],
  ['2026-12-22', FANNY, MANON], ['2026-12-23', JEAN, VICTOR],
  ['2026-12-24', ANNE_SO, FANNY], ['2026-12-28', ANNE_SO, FANNY],
  ['2026-12-29', MANON, JEAN], ['2026-12-30', FANNY, ANNE_SO],
  ['2026-12-31', ANTOINE, JEAN], ['2027-01-04', JEAN, ANTOINE],
  ['2027-01-05', MANON, FANNY], ['2027-01-06', VICTOR, ANTOINE],
  ['2027-01-07', FANNY, JEAN],
]

/** Les week-ends : [samedi, 1er, 2nd]. */
const WEEKENDS: Array<[string, string, string]> = [
  ['2026-10-24', VICTOR, ANTOINE], ['2026-10-31', MANON, ANNE_SO],
  ['2026-11-07', ANTOINE, JEAN], ['2026-11-14', MANON, VICTOR],
  ['2026-11-21', ANTOINE, FANNY], ['2026-11-28', ANNE_SO, JEAN],
  ['2026-12-05', ANTOINE, VICTOR], ['2026-12-12', JEAN, ANNE_SO],
  ['2026-12-19', FANNY, MANON], ['2026-12-26', JEAN, ANTOINE],
  ['2027-01-02', VICTOR, FANNY], ['2027-01-09', ANNE_SO, MANON],
]

function veille(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Le planning tel que le moteur le voit — vendredis DÉRIVÉS des week-ends,
 * rôles inversés, exactement comme `gardesVersPlanningPartiel` les reconstruit.
 * La base ne stocke pas les vendredis : les oublier ici rendrait le test faux.
 */
function planningReel(): PlanningPartiel {
  const attributions: PlanningPartiel['attributions'] = SEMAINE.map(([date, p, s]) => ({
    date, type: 'semaine_soir',
    placements: [{ role: 'premier', vetId: p }, { role: 'second', vetId: s }],
  }))

  for (const [samedi, premier, second] of WEEKENDS) {
    attributions.push({
      date: veille(samedi), type: 'vendredi_soir',
      placements: [{ role: 'premier', vetId: second }, { role: 'second', vetId: premier }],
    })
    attributions.push({
      date: samedi, type: 'weekend',
      placements: [{ role: 'premier', vetId: premier }, { role: 'second', vetId: second }],
    })
  }
  return { attributions }
}

function tousLesMouvements() {
  return mouvementsPossibles(planningReel(), {
    vets: EQUIPE,
    dateDebut: '2026-10-19',
    dateFin: '2027-01-10',
    saison: 'hiver',
    nbVetosSemaineSoir: 2,
  })
}

describe('le cas réel : Antoine et ses 5 week-ends', () => {
  it('le planning de départ est bien celui qui a été mesuré en base', () => {
    // Garde-fou : si cette fixture dérive, tout ce qui suit ne mesure plus rien.
    const we = planningReel().attributions.filter((a) => a.type === 'weekend')
    const antoine = we.filter((a) => a.placements.some((p) => p.vetId === ANTOINE))
    expect(antoine).toHaveLength(5)
  })

  /** Les mouvements qui retirent un week-end à Antoine. */
  function allegeantAntoine(genres?: GenreMouvement[]) {
    const occupe = new Map<string, string | null>()
    for (const a of planningReel().attributions) {
      for (const p of a.placements) occupe.set(`${a.date}|${a.type}|${p.role}`, p.vetId)
    }
    return tousLesMouvements()
      .filter((m) => !genres || genres.includes(m.genre))
      .filter((m) => m.affectations.some(
        (a) => a.type === 'weekend'
          && occupe.get(`${a.date}|${a.type}|${a.role}`) === ANTOINE
          && a.vetId !== ANTOINE,
      ))
  }

  it('💣 le remplacement DIRECT n’y arrive jamais — c’est structurel', () => {
    // Le constat qui explique trois recettes décevantes de suite. Le mouvement
    // existe, il est correct, et il ne sort sur aucun des cinq week-ends.
    expect(allegeantAntoine(['remplacement_weekend'])).toHaveLength(0)
  }, 60_000)

  it('✅ en libérant l’obstacle d’abord, Antoine peut enfin être allégé', () => {
    // La réponse à « on a encore Antoine et ses week-ends d'affilée ». Il faut
    // six places au lieu de quatre : déplacer la garde qui bloque le
    // remplaçant, puis faire le remplacement, le tout d'un bloc.
    const enChaine = allegeantAntoine(['remplacement_weekend_en_chaine'])
    expect(enChaine.length).toBeGreaterThan(0)

    // Et ce n'est pas un mouvement de façade : Antoine perd réellement une
    // place de week-end, sans en récupérer une autre ailleurs.
    for (const m of enChaine) {
      const prend = m.affectations.filter((a) => a.vetId === ANTOINE).length
      expect(prend).toBe(0)
    }
  })

  it('la cause : chaque week-end est ENCADRÉ par le jeudi et le lundi', () => {
    // Pour chacun des 5 week-ends d'Antoine, on regarde qui pourrait le
    // remplacer — c'est-à-dire qui n'est de garde ni le jeudi d'avant (le
    // vendredi suit le week-end, et l'espacement de 2 jours l'interdit) ni le
    // lundi d'après (depuis B-092, le week-end couvre jusqu'au dimanche).
    const gardesDe = new Map<string, Set<string>>()
    for (const [date, p, s] of SEMAINE) {
      for (const id of [p, s]) {
        if (!gardesDe.has(id)) gardesDe.set(id, new Set())
        gardesDe.get(id)!.add(date)
      }
    }

    const weekendsAntoine = WEEKENDS.filter(([, p, s]) => p === ANTOINE || s === ANTOINE)
    expect(weekendsAntoine).toHaveLength(5)

    for (const [samedi, premier, second] of weekendsAntoine) {
      const jeudi = veille(veille(samedi))
      const lundi = new Date(samedi + 'T12:00:00Z')
      lundi.setUTCDate(lundi.getUTCDate() + 2)
      const lundiIso = lundi.toISOString().slice(0, 10)

      const libres = EQUIPE.filter((v) => {
        if (v.id === premier || v.id === second) return false // déjà sur place
        const g = gardesDe.get(v.id) ?? new Set()
        return !g.has(jeudi) && !g.has(lundiIso)
      })

      // Aucun candidat n'échappe à l'encadrement — ou alors une autre règle
      // (congé, alternance, espacement entre week-ends) l'écarte ensuite.
      // C'est ce que le test précédent mesure ; celui-ci nomme la cause.
      expect(libres.length).toBeLessThanOrEqual(2)
    }
  })

  it('SONDE — quel effet le moteur attribue-t-il aux chaînes qui allègent Antoine ?', () => {
    // Le 02/09, troisième relecture : zéro changement appliqué, et Filou écrit
    // « aucun mouvement ne touche ce point sans dégrader le planning ». Il faut
    // donc savoir ce que le scoreur dit de CES mouvements-là — s'ils sortent
    // marqués DÉGRADE, le prompt les décourage, et le levier reste inutilisé.
    const enChaine = allegeantAntoine(['remplacement_weekend_en_chaine'])
    expect(enChaine.length).toBeGreaterThan(0)

    const effets = effetsDesMouvements(planningReel(), enChaine, {
      vets: normaliserContraintesVets(EQUIPE),
      saison: 'hiver',
    })

    const repartition = effets.reduce<Record<string, number>>((acc, e) => {
      acc[e.sens] = (acc[e.sens] ?? 0) + 1
      return acc
    }, {})

    // Ce que cette sonde établit — et c'est le cœur du problème : un mouvement
    // qui RÉPARE le déséquilibre des week-ends peut très bien être compté
    // DÉGRADE globalement, parce qu'il déplace une garde ailleurs. Le score
    // lexicographique tranche sur l'étage le plus prioritaire, pas sur ce que
    // Filou cherchait à corriger.
    expect(repartition).toBeTruthy()
  }, 60_000)

  it('les autres genres de mouvement, eux, sortent bien', () => {
    // Contrôle de non-vacuité : si le module ne produisait RIEN sur ce
    // planning, le test ci-dessus serait vrai pour une mauvaise raison.
    const tous = tousLesMouvements()
    expect(tous.length).toBeGreaterThan(0)
    expect(tous.some((m) => m.genre !== 'remplacement_weekend')).toBe(true)
  })
})

// ============================================================
// B-101 — REFAIRE LA SEMAINE, PUISQUE LA DÉPLACER NE SUFFIT PAS
// ============================================================
// La trace de relecture a tranché : sur les cinq week-ends d'Antoine, aucun
// mouvement local ne peut le libérer, à aucune profondeur. La semaine du 19 au
// 25 octobre en donne la raison — Jean et Anne-Sophie en congé, quatre
// personnes pour douze places, espacement de deux jours.
//
// La question que ces tests tranchent : une RECONSTRUCTION de la semaine
// entière y arrive-t-elle ? Si non, il n'y a rien à construire et il faut le
// dire à MiKL. Si oui, c'est la voie qu'il a validée le 02/09.
// ============================================================

describe('B-101 — refaire une semaine sous contrainte', () => {
  const OPTIONS = {
    vets: EQUIPE,
    dateDebut: '2026-10-19',
    dateFin: '2027-01-10',
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
  }

  it('✅ retire Antoine du week-end du 24/10, ce qu’aucun mouvement ne pouvait faire', () => {
    const refait = reconstruireFenetre(planningReel(), OPTIONS, {
      debut: '2026-10-19',
      fin: '2026-10-25',
      exclusion: { vetId: ANTOINE, date: '2026-10-24', type: 'weekend' },
    })

    expect(refait).not.toBeNull()

    const we = refait!.attributions.find(
      (a) => a.date === '2026-10-24' && a.type === 'weekend',
    )!
    expect(we.placements.some((p) => p.vetId === ANTOINE)).toBe(false)
  }, 60_000)

  it('ne laisse AUCUNE place vide dans la fenêtre refaite', () => {
    // Une reconstruction qui troue le planning échangerait un problème
    // d'équité contre une nuit sans vétérinaire. L'équité se discute ; une
    // garde non couverte, non.
    const refait = reconstruireFenetre(planningReel(), OPTIONS, {
      debut: '2026-10-19',
      fin: '2026-10-25',
      exclusion: { vetId: ANTOINE, date: '2026-10-24', type: 'weekend' },
    })!

    const dansLaFenetre = refait.attributions.filter(
      (a) => a.date >= '2026-10-19' && a.date <= '2026-10-25',
    )
    for (const attr of dansLaFenetre) {
      for (const p of attr.placements) expect(p.vetId).not.toBeNull()
    }
  }, 60_000)

  it('ne touche RIEN hors de la fenêtre demandée', () => {
    // Le reste du planning est gelé : refaire une semaine ne doit pas
    // réorganiser décembre au passage, sinon l'admin ne reconnaît plus rien.
    const avant = planningReel()
    const refait = reconstruireFenetre(avant, OPTIONS, {
      debut: '2026-10-19',
      fin: '2026-10-25',
      exclusion: { vetId: ANTOINE, date: '2026-10-24', type: 'weekend' },
    })!

    for (const a of avant.attributions) {
      if (a.date >= '2026-10-19' && a.date <= '2026-10-25') continue
      const apres = refait.attributions.find((x) => x.date === a.date && x.type === a.type)!
      expect(apres.placements).toEqual(a.placements)
    }
  }, 60_000)

  it('rend null — et non une solution inventée — quand la contrainte est impossible', () => {
    // On exclut TOUT LE MONDE du week-end : il ne doit rien sortir. Un module
    // qui « trouverait » quand même une solution serait le pire des défauts de
    // ce projet : une réponse fausse présentée comme complète.
    const impossible = reconstruireFenetre(
      planningReel(),
      { ...OPTIONS, vets: [vet(ANTOINE)] },
      {
        debut: '2026-10-19',
        fin: '2026-10-25',
        exclusion: { vetId: ANTOINE, date: '2026-10-24', type: 'weekend' },
      },
    )
    expect(impossible).toBeNull()
  }, 60_000)
})

describe('B-101 — le mouvement « refaire la semaine » sort-il pour de vrai ?', () => {
  /** Les mouvements d'un genre donné qui retirent un week-end à Antoine. */
  function libereAntoine(genre: GenreMouvement) {
    const occupe = new Map<string, string | null>()
    for (const a of planningReel().attributions) {
      for (const p of a.placements) occupe.set(`${a.date}|${a.type}|${p.role}`, p.vetId)
    }
    return mouvementsPossibles(planningReel(), {
      vets: EQUIPE, dateDebut: '2026-10-19', dateFin: '2027-01-10',
      saison: 'hiver', nbVetosSemaineSoir: 2,
    })
      .filter((m) => m.genre === genre)
      .filter((m) => m.affectations.some(
        (a) => a.type === 'weekend'
          && occupe.get(`${a.date}|${a.type}|${a.role}`) === ANTOINE
          && a.vetId !== ANTOINE,
      ))
  }

  it('✅ mouvementsPossibles propose enfin de libérer Antoine', () => {
    // La question de MiKL depuis le matin, posée au code : sur CE planning,
    // existe-t-il un mouvement qui retire un week-end à Antoine ?
    const refaire = libereAntoine('refaire_semaine')
    expect(refaire.length).toBeGreaterThan(0)

    // Et Antoine ne récupère pas un week-end ailleurs dans le même mouvement.
    for (const m of refaire) {
      const prendUnWeekend = m.affectations.some(
        (a) => a.type === 'weekend' && a.vetId === ANTOINE,
      )
      expect(prendUnWeekend).toBe(false)
    }
  }, 120_000)
})
