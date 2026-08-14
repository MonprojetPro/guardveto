// ============================================================
// Ce qu'un échec d'envoi d'e-mail dit à l'écran
// ============================================================
// Le journal des réglages affichait la réponse HTTP brute du service d'envoi.
// `raisonEchec` la traduit — et comme toute traduction, elle doit être vérifiée
// sur les messages RÉELS, pas sur des exemples inventés.
//
// Le cas de référence ci-dessous est le message exact relevé en production le
// 2026-08-03, dans `email_log.erreur` : c'est lui qui a fait découvrir que plus
// aucun e-mail ne partait depuis 11 jours.
// ============================================================

import { describe, expect, it } from 'vitest'
import { raisonEchec } from '@/lib/emails/echec'

/** Le message réellement stocké en base le 2026-08-03 (3 occurrences). */
const BREVO_IP_REELLE =
  'Brevo HTTP 401: {"message":"We have detected you are using an unrecognised IP address 52.54.57.16. If you performed this action make sure to add the new IP address in this link: https://app.brevo.com/security/authorised_ips","code":"unauthorized"}\n'

describe('raisonEchec', () => {
  it('reconnaît la restriction d’adresse IP — le cas de production du 2026-08-03', () => {
    const dit = raisonEchec(BREVO_IP_REELLE)
    expect(dit).toContain("n’est pas autorisée")
    // La phrase doit désigner le geste à faire, pas seulement constater.
    expect(dit).toContain('restriction')
    // Et surtout : plus aucune trace du JSON ni de l'URL de dashboard.
    expect(dit).not.toContain('http')
    expect(dit).not.toContain('{')
  })

  it('distingue la clé invalide de la restriction d’IP', () => {
    expect(raisonEchec('Brevo HTTP 401: {"code":"unauthorized"}')).toContain('clé d’envoi')
  })

  it('reconnaît nos propres refus, posés avant tout appel réseau', () => {
    // Les deux messages que `lib/brevo.ts` renvoie sans contacter personne.
    expect(raisonEchec('Config email manquante')).toContain('BREVO_API_KEY')
    expect(raisonEchec('Expéditeur email manquant')).toContain('expéditeur')
  })

  it('reconnaît la limite de débit et le destinataire refusé', () => {
    expect(raisonEchec('HTTP 429 Too Many Requests')).toContain('attente')
    expect(raisonEchec('{"message":"Invalid recipient email"}')).toContain('destinataire')
  })

  it('tronque un message inconnu au lieu de l’effacer', () => {
    const inconnu = `Une panne jamais vue ${'x'.repeat(300)}`
    const dit = raisonEchec(inconnu)
    expect(dit.length).toBeLessThanOrEqual(120)
    // On dégrade vers « moins riche », jamais vers « invisible ».
    expect(dit).toContain('Une panne jamais vue')
  })

  it('ne rend jamais une chaîne vide', () => {
    expect(raisonEchec('')).not.toBe('')
    expect(raisonEchec('   ')).toContain('sans que le serveur')
  })

  it('ne garde qu’une seule ligne d’un message multiligne', () => {
    expect(raisonEchec('Première ligne\nSeconde ligne')).toBe('Première ligne')
  })
})
