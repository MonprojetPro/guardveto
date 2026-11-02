// B-179a — le planning sur téléphone, jour par jour.
// La vue lit les MÊMES données que les grilles ; ce test verrouille ce qu'elle
// en fait : semaines de 7 jours, « pour moi », places à pourvoir, et surtout ce
// qu'elle ne doit PAS montrer (un souhait de congé d'un collègue, un refus).
import { describe, expect, it } from 'vitest'
import { bilanSemaine, composerSemainesTelephone } from '@/lib/planning/joursTelephone'
import type { GardeDenormalisee } from '@/types'

const MOI = 'vet-fanny'

function garde(partiel: Partial<GardeDenormalisee> & { id: string; date: string }): GardeDenormalisee {
  return {
    periode_id: 'p1', type: 'semaine',
    premier_id: null, second_id: null, verrouille: false, modifie_manuellement: false,
    created_at: '', updated_at: '',
    premier_prenom: null, premier_nom: null, premier_couleur: null,
    second_prenom: null, second_nom: null, second_couleur: null,
    saison: 'hiver', periode_statut: 'publie',
    ...partiel,
  } as GardeDenormalisee
}

function composer(extra: Partial<Parameters<typeof composerSemainesTelephone>[0]> = {}) {
  return composerSemainesTelephone({
    debut: '2026-10-26', fin: '2026-11-08', anneeMois: '2026-11', aujourdhui: '2026-11-02',
    moiVetId: MOI, gardes: [], manquesParGarde: {}, nomsTypes: {}, presencesParJour: {},
    conges: [], absences: [],
    ...extra,
  })
}

describe('composerSemainesTelephone', () => {
  it('découpe la grille en semaines de 7 jours, lundi → dimanche', () => {
    const s = composer()
    expect(s).toHaveLength(2)
    expect(s.map((x) => [x.debut, x.fin])).toEqual([['2026-10-26', '2026-11-01'], ['2026-11-02', '2026-11-08']])
    expect(s.every((x) => x.jours.length === 7)).toBe(true)
  })

  it('marque aujourd’hui, le passé et les jours hors du mois', () => {
    const jours = composer().flatMap((x) => x.jours)
    expect(jours.find((j) => j.date === '2026-11-02')?.aujourdhui).toBe(true)
    expect(jours.find((j) => j.date === '2026-10-31')).toMatchObject({ passe: true, horsMois: true })
    expect(jours.find((j) => j.date === '2026-11-03')).toMatchObject({ passe: false, horsMois: false })
  })

  it('une garde que je tiens est « pour moi », avec son libellé et ses places', () => {
    const s = composer({
      gardes: [garde({ id: 'g1', date: '2026-11-03', premier_id: MOI, premier_prenom: 'Fanny', second_id: 'v2', second_prenom: 'Manon' })],
    })
    const j = s[1].jours[1]
    expect(j.pourMoi).toBe(true)
    expect(j.gardes[0]).toMatchObject({ libelle: 'Nuit de semaine', moi: true, manque: 0 })
    expect(j.gardes[0].places.map((p) => p.prenom)).toEqual(['Fanny', 'Manon'])
  })

  it('reprend le manque calculé pour la grille, sans le réinventer', () => {
    const s = composer({
      gardes: [garde({ id: 'g2', date: '2026-11-04', premier_id: 'v3', premier_prenom: 'Camille' })],
      manquesParGarde: { g2: 1 },
    })
    expect(s[1].jours[2].gardes[0].manque).toBe(1)
    expect(s[1].jours[2].pourMoi).toBe(false)
  })

  it('montre mon souhait de congé, jamais celui d’un collègue ; ignore un refus', () => {
    const s = composer({
      conges: [
        { vetId: MOI, prenom: 'Fanny', couleur: null, dateDebut: '2026-11-05', dateFin: '2026-11-05', statut: 'souhait' },
        { vetId: 'v2', prenom: 'Manon', couleur: null, dateDebut: '2026-11-05', dateFin: '2026-11-05', statut: 'souhait' },
        { vetId: 'v3', prenom: 'Julie', couleur: null, dateDebut: '2026-11-05', dateFin: '2026-11-05', statut: 'refuse' },
        { vetId: 'v4', prenom: 'Jean', couleur: null, dateDebut: '2026-11-04', dateFin: '2026-11-06', statut: 'valide' },
      ],
    })
    const jeudi = s[1].jours[3]
    expect(jeudi.absences.map((a) => `${a.prenom}:${a.nature}`)).toEqual(['Fanny:souhait', 'Jean:conge'])
    expect(jeudi.pourMoi).toBe(true)
  })

  it('compte une absence déclarée, sur chaque jour qu’elle couvre', () => {
    const s = composer({
      absences: [{ vetId: 'v5', prenom: 'Victor', dateDebut: '2026-11-06', dateFin: '2026-11-07' }],
    })
    expect(s[1].jours[4].absences[0]).toMatchObject({ prenom: 'Victor', nature: 'absence' })
    expect(s[1].jours[5].absences).toHaveLength(1)
    expect(s[1].jours[6].absences).toHaveLength(0)
  })

  it('le bilan de ma semaine compte mes gardes et mes jours au cabinet', () => {
    const s = composer({
      gardes: [garde({ id: 'g1', date: '2026-11-03', premier_id: MOI, premier_prenom: 'Fanny' })],
      presencesParJour: {
        '2026-11-02': {
          personnes: 2,
          presences: [
            { id: 'a', vetId: MOI, prenom: 'Fanny', couleur: null, tranche: 'Matin', heures: '8h–12h30', debut: null, fin: null, ordre: 0, deLaTrame: true, anomalie: null },
            { id: 'b', vetId: MOI, prenom: 'Fanny', couleur: null, tranche: 'Après-midi', heures: '14h–19h', debut: null, fin: null, ordre: 1, deLaTrame: true, anomalie: null },
          ],
        },
      },
    })
    // Deux tranches le même jour = UN jour au cabinet.
    expect(bilanSemaine(s[1], MOI)).toEqual({ gardes: 1, joursAuCabinet: 1, absences: 0 })
    expect(s[1].jours[0].personnesPresentes).toBe(2)
  })

  it('sans fiche vétérinaire (secrétariat), rien n’est jamais « pour moi »', () => {
    const s = composer({
      moiVetId: '',
      gardes: [garde({ id: 'g1', date: '2026-11-03', premier_id: 'v2', premier_prenom: 'Manon' })],
    })
    expect(s.flatMap((x) => x.jours).some((j) => j.pourMoi)).toBe(false)
    expect(s[1].jours[1].gardes[0].moi).toBe(false)
  })
})
