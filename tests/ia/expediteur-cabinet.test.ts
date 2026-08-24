// ============================================================
// GUARDVETO — L'expéditeur du cabinet est revalidé AU MOMENT D'ÉCRIRE
// ============================================================
// La `charge` d'un outil d'écriture fait l'aller-retour par le NAVIGATEUR. Le
// contrat de `outils/types.ts` le dit : ne rien y mettre qui ne soit revalidé
// côté serveur au moment d'écrire. L'action Filou ne revalide que les `params`.
//
// Sur ce champ-là, ce n'était pas une revalidation de principe : une adresse
// d'expéditeur bancale fait tomber les SEPT chemins d'envoi du cabinet
// (planning publié, rappels, échanges, congés…), silencieusement. Le cabinet
// l'a payé le 21 août.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { configurerPartages } = vi.hoisted(() => ({ configurerPartages: vi.fn() }))

vi.mock('@/app/(protected)/admin/structure/actions', () => ({
  proposerProfilDepuisTexte: vi.fn(),
  proposerRelationDepuisTexte: vi.fn(),
  creerProfilComplet: vi.fn(),
  creerRelationCreneau: vi.fn(),
  setCreneauActif: vi.fn(),
  supprimerCreneauSurMesure: vi.fn(),
  setRelationActive: vi.fn(),
  supprimerRelation: vi.fn(),
  supprimerProfil: vi.fn(),
  setHorairesProfilCreneau: vi.fn(),
  setAffinagePeriodeType: vi.fn(),
  creerCreneauSurMesure: vi.fn(),
  configurerAdresseCabinet: vi.fn(),
  configurerPartagesCabinet: configurerPartages,
}))

const { configurerPartagesDepuisPhrase } = await import('@/lib/ia/outils/structure')
const CTX = {} as Parameters<typeof configurerPartagesDepuisPhrase.executer>[1]
const PARAMS = {} as Parameters<typeof configurerPartagesDepuisPhrase.executer>[0]

beforeEach(() => {
  vi.clearAllMocks()
  configurerPartages.mockResolvedValue({ success: true })
})

describe('configurer_partages_cabinet — l’adresse est revérifiée avant la RPC', () => {
  it('enregistre une adresse bien formée', async () => {
    const r = await configurerPartagesDepuisPhrase.executer(PARAMS, CTX, {
      googleCalendarId: 'agenda@cabinet.fr',
      brevoFromEmail: 'contact@cabinet.fr',
      brevoFromName: 'Cabinet du Val',
    })

    expect(r).toEqual({})
    expect(configurerPartages).toHaveBeenCalledWith({
      googleCalendarId: 'agenda@cabinet.fr',
      brevoFromEmail: 'contact@cabinet.fr',
      brevoFromName: 'Cabinet du Val',
    })
  })

  it('REFUSE une charge trafiquée et n’appelle jamais la RPC', async () => {
    const r = await configurerPartagesDepuisPhrase.executer(PARAMS, CTX, {
      googleCalendarId: '',
      brevoFromEmail: 'pas une adresse',
      brevoFromName: 'Cabinet',
    })

    expect(r.error).toContain('pas une adresse e-mail valide')
    expect(configurerPartages).not.toHaveBeenCalled()
  })

  it('refuse aussi une adresse sans domaine — le cas qui passe le plus facilement', async () => {
    const r = await configurerPartagesDepuisPhrase.executer(PARAMS, CTX, {
      googleCalendarId: '',
      brevoFromEmail: 'contact@cabinet',
      brevoFromName: '',
    })

    expect(r.error).toBeTruthy()
    expect(configurerPartages).not.toHaveBeenCalled()
  })

  it('laisse passer le VIDE : c’est le retour explicite au réglage du serveur', async () => {
    const r = await configurerPartagesDepuisPhrase.executer(PARAMS, CTX, {
      googleCalendarId: '',
      brevoFromEmail: '   ',
      brevoFromName: '',
    })

    expect(r).toEqual({})
    expect(configurerPartages).toHaveBeenCalledWith({
      googleCalendarId: '',
      brevoFromEmail: '',
      brevoFromName: '',
    })
  })

  it('remonte l’erreur de la RPC telle quelle — Supabase la RETOURNE, il ne la lève pas', async () => {
    configurerPartages.mockResolvedValue({ error: 'function configurer_partages_cabinet does not exist' })

    const r = await configurerPartagesDepuisPhrase.executer(PARAMS, CTX, {
      googleCalendarId: '',
      brevoFromEmail: 'contact@cabinet.fr',
      brevoFromName: '',
    })

    expect(r).toEqual({ error: 'function configurer_partages_cabinet does not exist' })
  })
})
