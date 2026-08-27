// ============================================================
// GUARDVETO — L'ordre de lecture d'une liste de congés (B-067)
// ============================================================
// Ce que ce test protège n'est pas « le tri trie » — c'est qu'il trie de la
// MÊME façon à chaque rendu, et qu'il ne remonte pas en tête la donnée la
// moins renseignée.
// ============================================================

import { describe, it, expect } from 'vitest'
import { comparerConges, LIBELLE_TRI_CONGES, type TriConges } from '@/lib/conges/tri'
import type { Conge } from '@/types'

function conge(over: Partial<Conge> & { id: string }): Conge {
  return {
    veterinaire_id: 'v1',
    date_debut: '2026-09-10',
    date_fin: '2026-09-12',
    type: 'vacances',
    creneau: null,
    statut: 'valide',
    commentaire: null,
    raison_refus: null,
    saisi_par: null,
    valide_par: null,
    created_at: '2026-08-01T10:00:00Z',
    decide_le: null,
    ...over,
  }
}

const PRENOMS: Record<string, string> = { v1: 'Manon', v2: 'Antoine', v3: 'Élodie', v4: 'Zoé' }
const prenomDe = (id: string) => PRENOMS[id] ?? 'zzz'

function trier(tri: TriConges, liste: Conge[]): string[] {
  return [...liste].sort((a, b) => comparerConges(tri, a, b, prenomDe)).map((c) => c.id)
}

describe('tri des congés', () => {
  const LISTE = [
    conge({ id: 'c', date_debut: '2026-09-20', created_at: '2026-08-03T10:00:00Z' }),
    conge({ id: 'a', date_debut: '2026-09-05', created_at: '2026-08-10T10:00:00Z' }),
    conge({ id: 'b', date_debut: '2026-09-12', created_at: '2026-08-01T10:00:00Z' }),
  ]

  it('« congé le plus proche » va du plus tôt au plus tard', () => {
    expect(trier('chrono', LISTE)).toEqual(['a', 'b', 'c'])
  })

  it('« congé le plus lointain » est exactement l’inverse', () => {
    expect(trier('chrono-inverse', LISTE)).toEqual(['c', 'b', 'a'])
  })

  it('« ordre d’arrivée » suit la DEMANDE, pas la date de congé', () => {
    // C'est tout l'intérêt du tri : « depuis quand celle-ci attend-elle ? »
    // ne se lit pas dans les dates du congé lui-même.
    expect(trier('arrivee', LISTE)).toEqual(['b', 'c', 'a'])
  })

  it('une demande sans date d’arrivée part à la FIN, jamais en tête', () => {
    // ⚠️ Le piège : une chaîne vide se compare comme « plus petite que tout ».
    // Sans repli, la ligne la MOINS renseignée serait la première affichée —
    // exactement l'inverse de ce qu'on veut voir en premier.
    const avecTrou = [...LISTE, conge({ id: 'trou', created_at: '' })]
    expect(trier('arrivee', avecTrou).at(-1)).toBe('trou')
  })

  it('« par vétérinaire » range les accents à leur place', () => {
    // ⚠️ CE CAS NE MORD PAS ICI, et il faut le savoir. Vérifié par sabotage le
    // 2026-08-27 : en retirant la locale « fr » du code, ce test passe QUAND
    // MÊME — l'environnement Node de la machine range déjà correctement. Il
    // documente donc l'intention et couvrirait un runtime à locale différente,
    // mais il ne prouve rien sur celle-ci. Mieux vaut l'écrire que de croire
    // le contraire en le lisant vert.
    const parVet = [
      conge({ id: 'zoe', veterinaire_id: 'v4' }),
      conge({ id: 'elodie', veterinaire_id: 'v3' }),
      conge({ id: 'antoine', veterinaire_id: 'v2' }),
    ]
    expect(trier('vet', parVet)).toEqual(['antoine', 'elodie', 'zoe'])
  })

  it('l’ordre est STABLE quand le critère principal est à égalité', () => {
    // Sans départage, deux congés identiques sur le critère peuvent changer de
    // place d'un rendu à l'autre : la liste bougerait sous les yeux sans qu'on
    // ait rien touché, et on chercherait la ligne qu'on venait de lire.
    const exAequo = [
      conge({ id: 'z', date_debut: '2026-09-10' }),
      conge({ id: 'a', date_debut: '2026-09-10' }),
      conge({ id: 'm', date_debut: '2026-09-10' }),
    ]
    const attendu = ['a', 'm', 'z']
    for (const tri of Object.keys(LIBELLE_TRI_CONGES) as TriConges[]) {
      expect(trier(tri, exAequo), `tri « ${tri} »`).toEqual(attendu)
      // Deux passes sur des entrées mélangées différemment donnent le même
      // résultat : c'est ça, « stable ».
      expect(trier(tri, [...exAequo].reverse()), `tri « ${tri} », entrée inversée`).toEqual(attendu)
    }
  })

  it('chaque ordre proposé porte un libellé lisible', () => {
    // Une option de menu sans libellé s'afficherait vide : le sélecteur
    // proposerait un choix que personne ne peut nommer.
    for (const [cle, libelle] of Object.entries(LIBELLE_TRI_CONGES)) {
      expect(libelle.trim().length, `libellé de « ${cle} »`).toBeGreaterThan(0)
    }
  })
})
