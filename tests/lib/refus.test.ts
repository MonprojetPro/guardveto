// ============================================================
// Le décodeur de refus — test de COHÉRENCE avec le serveur
// ============================================================
// Ce test ne vérifie pas que le décodeur « marche » : il vérifie qu'il parle
// encore la même langue que `app/(protected)/regles/actions.ts`. C'est le
// scénario qui l'a rendu nécessaire : le jour où quelqu'un reformule un message
// serveur, le décodeur retombe SILENCIEUSEMENT sur le cas générique — la modale
// s'affiche toujours, mais sans explication ni porte de sortie. Rien ne casse,
// et personne ne le voit.
//
// Les messages ci-dessous sont donc recopiés à l'identique depuis les actions.
// Ils doivent le rester.
// ============================================================

import { describe, expect, it } from 'vitest'
import { decoderRefus } from '@/lib/regles/refus'

describe('decoderRefus — les messages réels du serveur sont reconnus', () => {
  it('l’étiquette sans porteur mène à la page Équipe', () => {
    const r = decoderRefus(
      "Aucun vétérinaire actif ne porte l'étiquette « junior ». Ajoute-la d'abord sur les fiches concernées (page Équipe).",
    )
    expect(r.titre).toBe('Personne ne porte cette étiquette')
    expect(r.explication).toBeTruthy()
    expect(r.action).toEqual({
      genre: 'aller',
      label: 'Ouvrir la page Équipe',
      href: '/equipe',
    })
  })

  it('reconnaît aussi la variante à apostrophe typographique', () => {
    // Le serveur écrit l'apostrophe droite, les messages fabriqués côté écran
    // l'écrivent courbe. Les deux doivent tomber sur le même motif.
    const r = decoderRefus('Personne ne porte encore l’étiquette « senior ».')
    expect(r.titre).toBe('Personne ne porte cette étiquette')
  })

  it('le refus admin explique la lecture seule, sans porte de sortie', () => {
    const r = decoderRefus("Action réservée à l'administrateur du cabinet.")
    expect(r.titre).toBe('Réglage réservé à l’administrateur')
    expect(r.action).toBeUndefined()
  })

  it('la session perdue propose la reconnexion', () => {
    const r = decoderRefus('Non authentifié.')
    expect(r.action).toEqual({ genre: 'aller', label: 'Se reconnecter', href: '/login' })
  })

  it('le doublon dit de régler la règle existante', () => {
    const r = decoderRefus('Une règle de composition identique existe déjà.')
    expect(r.titre).toBe('Cette règle existe déjà')
  })

  it.each([
    'Cabinet introuvable.',
    'Aucun vétérinaire actif ne correspond à cette sélection.',
    'Dimension d’équité inconnue : « weekend_bis ».',
    'Type(s) de créneau inconnu(s) pour ce cabinet : nuit_bis.',
    'Rôle inconnu pour ce cabinet : « troisieme ».',
  ])('« %s » propose de recharger', (message) => {
    const r = decoderRefus(message)
    expect(r.action).toEqual({ genre: 'recharger', label: 'Recharger la page' })
  })

  it.each([
    'Étiquette invalide (1 à 30 caractères).',
    'Niveau de force invalide.',
    'Mode de composition invalide.',
    'État (activé/désactivé) invalide.',
  ])('« %s » est rangé dans les saisies refusées', (message) => {
    expect(decoderRefus(message).titre).toBe('Cette saisie n’est pas acceptée')
  })
})

describe('decoderRefus — le repli', () => {
  it('un message inconnu reste affiché, sous un titre neutre', () => {
    const r = decoderRefus('duplicate key value violates unique constraint "regles_pkey"')
    expect(r.titre).toBe('Ce réglage n’a pas pu être enregistré')
    expect(r.explication).toBeUndefined()
    expect(r.action).toBeUndefined()
  })

  it('ne casse pas sur une chaîne vide', () => {
    expect(decoderRefus('').titre).toBe('Ce réglage n’a pas pu être enregistré')
  })
})
