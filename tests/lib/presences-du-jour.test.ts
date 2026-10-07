// ============================================================
// Les présences telles que la grille les dessine — B-150 / B-145 lot 2a
// ============================================================
// Ces cas portent sur `src/lib/planning/presencesDuJour.ts`. Ni base ni réseau.
//
// ⚠️ LE GROUPE QUI COMPTE LE PLUS EST « RIEN NE DISPARAÎT EN SILENCE ».
//
// Le défaut qu'on vient de payer (B-150) n'était pas une présence mal dessinée,
// c'était une présence QUE PERSONNE NE DESSINAIT — écrite en base, invisible
// partout, et découverte par MiKL. Les trois cas qui pourraient reproduire ce
// défaut à l'échelle d'une ligne sont ici : tranche retirée, tranche effacée,
// personne sortie de l'équipe active. Dans les trois, la ligne doit sortir, avec
// sa phrase d'anomalie.
//
// ⚠️ LE SECOND GROUPE QUI COMPTE EST « LE COMPTE EST EN PERSONNES ».
//
// Une personne inscrite le matin ET l'après-midi fait deux lignes et une seule
// personne. Compter les lignes afficherait « 8 présents » pour 5 présents — un
// chiffre faux sur l'écran dont c'est la raison d'être, du genre qu'on ne
// soupçonne pas en le lisant.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  composerPresencesParJour,
  heureCourte,
  plageCourte,
  resumePresences,
  type PersonnePourGrille,
  type PresenceLue,
  type TranchePourGrille,
} from '@/lib/planning/presencesDuJour'

const MATIN: TranchePourGrille = {
  id: 'b-matin',
  nom: 'Matin',
  debut: '08:00:00',
  fin: '13:00:00',
  ordre: 1,
}
const APREM: TranchePourGrille = {
  id: 'b-aprem',
  nom: 'Après-midi',
  debut: '14:00:00',
  fin: '18:30:00',
  ordre: 2,
}

const ANNE: PersonnePourGrille = { id: 'v-anne', prenom: 'Anne-Sophie', couleur: '#0B7D6C' }
const FANNY: PersonnePourGrille = { id: 'v-fanny', prenom: 'Fanny', couleur: '#3B6FD1' }

function presence(p: Partial<PresenceLue> & { id: string }): PresenceLue {
  return {
    periode_id: 'p-1',
    veterinaire_id: ANNE.id,
    bloc_id: MATIN.id,
    date: '2026-10-12',
    trame_id: null,
    ...p,
  }
}

describe('heures lisibles', () => {
  it('rend une heure pleine sans les minutes', () => {
    expect(heureCourte('08:00:00')).toBe('8h')
  })

  it('garde les minutes quand il y en a', () => {
    expect(heureCourte('18:30:00')).toBe('18h30')
  })

  it('rend une chaîne vide sur une valeur illisible plutôt que « NaNh »', () => {
    expect(heureCourte('')).toBe('')
    expect(heureCourte('midi')).toBe('')
  })

  it('compose la plage, et se tait si une borne manque', () => {
    expect(plageCourte('08:00:00', '13:00:00')).toBe('8h–13h')
    expect(plageCourte('08:00:00', '')).toBe('')
  })
})

describe('le compte est en PERSONNES, jamais en lignes', () => {
  it('matin + après-midi pour la même personne = 1 présent', () => {
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'x1', bloc_id: MATIN.id }),
        presence({ id: 'x2', bloc_id: APREM.id }),
      ],
      [MATIN, APREM],
      [ANNE],
    )
    const jour = parJour.get('2026-10-12')
    expect(jour?.presences).toHaveLength(2)
    expect(jour?.personnes).toBe(1)
    expect(resumePresences(jour)).toBe('1 présent')
  })

  it('deux personnes distinctes = 2 présents, au pluriel', () => {
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'x1', veterinaire_id: ANNE.id }),
        presence({ id: 'x2', veterinaire_id: FANNY.id }),
      ],
      [MATIN],
      [ANNE, FANNY],
    )
    expect(resumePresences(parJour.get('2026-10-12'))).toBe('2 présents')
  })

  it('un jour sans présence ne dit rien — pas « 0 présent »', () => {
    expect(resumePresences(undefined)).toBe('')
    const parJour = composerPresencesParJour([], [MATIN], [ANNE])
    expect(parJour.size).toBe(0)
  })
})

describe('rien ne disparaît en silence', () => {
  it('une tranche RETIRÉE reste dessinée, et le dit', () => {
    const parJour = composerPresencesParJour(
      [presence({ id: 'x1' })],
      [MATIN],
      [ANNE],
      new Set([MATIN.id]),
    )
    const ligne = parJour.get('2026-10-12')?.presences[0]
    expect(ligne?.tranche).toBe('Matin')
    expect(ligne?.anomalie).toContain('retirée')
  })

  it('une tranche INTROUVABLE reste dessinée, en dernier, et le dit', () => {
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'fantome', bloc_id: 'b-efface' }),
        presence({ id: 'normale', bloc_id: MATIN.id }),
      ],
      [MATIN],
      [ANNE],
    )
    const lignes = parJour.get('2026-10-12')?.presences ?? []
    expect(lignes).toHaveLength(2)
    // La ligne saine d'abord : l'anomalie ne se hisse pas en tête de case.
    expect(lignes[0].id).toBe('normale')
    expect(lignes[1].tranche).toBe('Tranche inconnue')
    expect(lignes[1].heures).toBe('')
    expect(lignes[1].anomalie).toContain('introuvable')
  })

  it('une personne sortie de l’équipe active reste dessinée, et le dit', () => {
    const parJour = composerPresencesParJour(
      [presence({ id: 'x1', veterinaire_id: 'v-partie' })],
      [MATIN],
      [ANNE],
    )
    const ligne = parJour.get('2026-10-12')?.presences[0]
    expect(ligne?.prenom).toBe('Personne retirée')
    expect(ligne?.anomalie).toContain('équipe active')
    // ⚠️ Elle COMPTE toujours dans l'effectif : l'écarter rendrait le chiffre
    // du jour faux sans qu'une ligne l'explique.
    expect(parJour.get('2026-10-12')?.personnes).toBe(1)
  })

  it('une ligne saine ne porte AUCUNE anomalie — sinon l’avertissement devient du bruit', () => {
    const parJour = composerPresencesParJour([presence({ id: 'x1' })], [MATIN], [ANNE])
    expect(parJour.get('2026-10-12')?.presences[0].anomalie).toBeNull()
  })
})

describe('ce que la grille doit pouvoir dessiner', () => {
  it('porte l’identifiant de LIGNE, celui que le retrait attend', () => {
    const parJour = composerPresencesParJour([presence({ id: 'ligne-42' })], [MATIN], [ANNE])
    expect(parJour.get('2026-10-12')?.presences[0].id).toBe('ligne-42')
  })

  it('distingue ce qui vient d’une trame de ce qui est posé à la main', () => {
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'auto', trame_id: 't-1', bloc_id: MATIN.id }),
        presence({ id: 'main', trame_id: null, bloc_id: APREM.id }),
      ],
      [MATIN, APREM],
      [ANNE],
    )
    const lignes = parJour.get('2026-10-12')?.presences ?? []
    expect(lignes.find((l) => l.id === 'auto')?.deLaTrame).toBe(true)
    expect(lignes.find((l) => l.id === 'main')?.deLaTrame).toBe(false)
  })

  it('range par ORDRE de tranche, pas par alphabet', () => {
    // « Après-midi » passerait avant « Matin » en alphabétique — c'est l'ordre
    // voulu par l'admin qui commande (`blocs_journee.ordre`).
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'ap', bloc_id: APREM.id }),
        presence({ id: 'ma', bloc_id: MATIN.id }),
      ],
      [MATIN, APREM],
      [ANNE],
    )
    expect((parJour.get('2026-10-12')?.presences ?? []).map((l) => l.id)).toEqual(['ma', 'ap'])
  })

  it('à tranche égale, range par prénom', () => {
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'f', veterinaire_id: FANNY.id }),
        presence({ id: 'a', veterinaire_id: ANNE.id }),
      ],
      [MATIN],
      [ANNE, FANNY],
    )
    expect((parJour.get('2026-10-12')?.presences ?? []).map((l) => l.prenom)).toEqual([
      'Anne-Sophie',
      'Fanny',
    ])
  })

  it('sépare les jours, et ne mélange pas deux dates', () => {
    const parJour = composerPresencesParJour(
      [
        presence({ id: 'lundi', date: '2026-10-12' }),
        presence({ id: 'mardi', date: '2026-10-13' }),
      ],
      [MATIN],
      [ANNE],
    )
    expect(parJour.get('2026-10-12')?.presences.map((l) => l.id)).toEqual(['lundi'])
    expect(parJour.get('2026-10-13')?.presences.map((l) => l.id)).toEqual(['mardi'])
  })
})
