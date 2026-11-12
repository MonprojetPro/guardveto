// ============================================================
// B-207 — Le guichet du Hub MPP : la serrure et la lecture d'un envoi
// ============================================================
// Ce que ces tests figent :
//   • pas de secret configuré (ou trop court) → personne n'entre, en 503 ;
//   • un mauvais secret, un en-tête absent ou mal formé → 401 ;
//   • une demande d'envoi mal formée est refusée en français AVANT la base ;
//   • le fil éditeur s'affiche « MonProjetPro ».
// ============================================================

import { describe, it, expect } from 'vitest'
import { LONGUEUR_SECRET_MIN, verifierAcces } from '@/lib/guichet-hub/acces'
import { DESTINATAIRES_MAX, lireDemandeEnvoi } from '@/lib/guichet-hub/envoi-editeur'
import { LONGUEUR_MESSAGE_MAX, NOM_EDITEUR, nomConversation } from '@/lib/messagerie/regles'

const SECRET = 'x'.repeat(LONGUEUR_SECRET_MIN) + '-secret-de-test'
const CAB = '3f1a2062-0512-4a83-b097-1801a8b90e5e'
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

describe('verifierAcces — la serrure', () => {
  it('laisse entrer avec le bon secret', () => {
    expect(verifierAcces(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true })
  })

  it('ferme le guichet (503) quand aucun secret n’est configuré', () => {
    const v = verifierAcces(`Bearer ${SECRET}`, null)
    expect(v).toMatchObject({ ok: false, statut: 503 })
  })

  it('ferme le guichet (503) quand le secret configuré est trop court', () => {
    const court = 'a'.repeat(LONGUEUR_SECRET_MIN - 1)
    expect(verifierAcces(`Bearer ${court}`, court)).toMatchObject({ ok: false, statut: 503 })
  })

  it('refuse (401) un mauvais secret, même de même longueur', () => {
    const faux = SECRET.slice(0, -1) + (SECRET.endsWith('t') ? 'u' : 't')
    expect(verifierAcces(`Bearer ${faux}`, SECRET)).toMatchObject({ ok: false, statut: 401 })
  })

  it('refuse (401) sans en-tête, ou sans le préfixe Bearer', () => {
    expect(verifierAcces(null, SECRET)).toMatchObject({ ok: false, statut: 401 })
    expect(verifierAcces(SECRET, SECRET)).toMatchObject({ ok: false, statut: 401 })
    expect(verifierAcces('Bearer ', SECRET)).toMatchObject({ ok: false, statut: 401 })
  })
})

describe('lireDemandeEnvoi — premier filtre avant la base', () => {
  it('accepte une demande correcte et dédoublonne les destinataires', () => {
    const r = lireDemandeEnvoi({ cabinetId: CAB, destinataires: [U1, U2, U1], corps: 'Bonjour' })
    expect(r).toEqual({ ok: true, demande: { cabinetId: CAB, destinataires: [U1, U2], corps: 'Bonjour' } })
  })

  it('refuse un corps de requête qui n’est pas un objet', () => {
    expect(lireDemandeEnvoi(null)).toMatchObject({ ok: false })
    expect(lireDemandeEnvoi('texte')).toMatchObject({ ok: false })
  })

  it('refuse un cabinet mal formé', () => {
    expect(lireDemandeEnvoi({ cabinetId: 'abc', destinataires: [U1], corps: 'x' })).toEqual({
      ok: false,
      error: 'Cabinet introuvable.',
    })
  })

  it('refuse une liste de destinataires vide, absente ou avec un identifiant mal formé', () => {
    expect(lireDemandeEnvoi({ cabinetId: CAB, destinataires: [], corps: 'x' })).toMatchObject({ ok: false })
    expect(lireDemandeEnvoi({ cabinetId: CAB, corps: 'x' })).toMatchObject({ ok: false })
    expect(lireDemandeEnvoi({ cabinetId: CAB, destinataires: [U1, 'pas-un-uuid'], corps: 'x' })).toEqual({
      ok: false,
      error: 'Un destinataire est mal formé.',
    })
  })

  it(`refuse plus de ${DESTINATAIRES_MAX} destinataires distincts`, () => {
    const beaucoup = Array.from({ length: DESTINATAIRES_MAX + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    )
    expect(lireDemandeEnvoi({ cabinetId: CAB, destinataires: beaucoup, corps: 'x' })).toMatchObject({ ok: false })
  })

  it('refuse un message vide ou fait d’espaces', () => {
    expect(lireDemandeEnvoi({ cabinetId: CAB, destinataires: [U1], corps: '   ' })).toEqual({
      ok: false,
      error: 'Le message est vide.',
    })
  })

  it('refuse un message plus long que la borne de la base', () => {
    const long = 'a'.repeat(LONGUEUR_MESSAGE_MAX + 1)
    expect(lireDemandeEnvoi({ cabinetId: CAB, destinataires: [U1], corps: long })).toMatchObject({ ok: false })
    const pile = 'a'.repeat(LONGUEUR_MESSAGE_MAX)
    expect(lireDemandeEnvoi({ cabinetId: CAB, destinataires: [U1], corps: pile })).toMatchObject({ ok: true })
  })
})

describe('le fil éditeur à l’écran', () => {
  it('s’appelle MonProjetPro, quel que soit autreNom', () => {
    expect(nomConversation({ genre: 'editeur', autreNom: null })).toBe(NOM_EDITEUR)
    expect(nomConversation({ genre: 'editeur', autreNom: 'Quelqu’un' })).toBe('MonProjetPro')
  })
})
