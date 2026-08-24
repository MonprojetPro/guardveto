// ============================================================
// Personne au bout : aucun envoi, aucune invitation
// ============================================================
// Depuis le 2026-08-22, `veterinaires.email` est facultatif — une fiche existe
// avant que la personne soit invitée. C'est la vérité métier, mais elle ouvre
// le mode de panne le plus coûteux de ce projet : l'action qui part vers rien
// et échoue SANS QUE PERSONNE NE LE SACHE.
//
// Deux preuves sont exigées ici, et elles doivent tenir sans base de données :
//   ① aucun e-mail ne part vers une adresse absente ;
//   ② on ne peut pas inviter une fiche qui n'a pas d'adresse.
// ============================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  adresseBienFormee,
  adresseUtilisable,
  motifInvitationImpossible,
  normaliserAdresse,
  trierDestinataires,
} from '@/lib/emails/destinataire'
import { sendBrevoEmail } from '@/lib/brevo'

const RACINE = process.cwd()

afterEach(() => {
  vi.restoreAllMocks()
})

// ── ① Aucun envoi vers une adresse absente ──────────────────────────────────

describe('aucun e-mail ne part vers une adresse absente', () => {
  it('refuse l’envoi AVANT tout appel réseau', async () => {
    const reseau = vi.spyOn(globalThis, 'fetch')

    const resultat = await sendBrevoEmail({
      to: '',
      toName: 'Manon Dupuis',
      subject: 'Nouveau planning',
      htmlContent: '<p>bonjour</p>',
      fromEmail: 'cabinet@exemple.fr',
    })

    // Le fait qui compte : rien n'est parti. Un envoi refusé PAR Brevo aurait
    // laissé une ligne « erreur » dans le journal, et fait passer une fiche
    // pas encore invitée pour une panne d'envoi.
    expect(reseau).not.toHaveBeenCalled()
    expect(resultat).toEqual({ error: 'Destinataire sans adresse' })
  })

  it('refuse aussi une adresse qui n’est que des espaces', async () => {
    const reseau = vi.spyOn(globalThis, 'fetch')
    const resultat = await sendBrevoEmail({
      to: '   ',
      toName: 'Manon Dupuis',
      subject: 'Nouveau planning',
      htmlContent: '<p>bonjour</p>',
      fromEmail: 'cabinet@exemple.fr',
    })
    expect(reseau).not.toHaveBeenCalled()
    expect('error' in resultat).toBe(true)
  })

  it('le refus passe AVANT le contrôle de la clé d’envoi', async () => {
    // Ordre volontaire : si la clé était contrôlée en premier, un cabinet
    // correctement configuré verrait « Config email manquante » là où le vrai
    // problème est une fiche sans adresse. Le message doit désigner la cause.
    const cle = process.env.BREVO_API_KEY
    delete process.env.BREVO_API_KEY
    try {
      const resultat = await sendBrevoEmail({
        to: '',
        toName: 'Manon Dupuis',
        subject: 'Test',
        htmlContent: '<p>x</p>',
      })
      expect(resultat).toEqual({ error: 'Destinataire sans adresse' })
    } finally {
      if (cle !== undefined) process.env.BREVO_API_KEY = cle
    }
  })

  it('trie les destinataires sans jamais faire échouer l’envoi aux autres', () => {
    const equipe = [
      { id: '1', prenom: 'Anne-Sophie', nom: 'B.', email: 'as@cabinet.fr' },
      { id: '2', prenom: 'Manon', nom: 'D.', email: null },
      { id: '3', prenom: 'Victor', nom: 'L.', email: '  ' },
      { id: '4', prenom: 'Jean', nom: 'M.', email: 'jean@cabinet.fr' },
    ]
    const { joignables, sansAdresse } = trierDestinataires(equipe)

    // Le point entier de la règle : deux fiches incomplètes ne privent pas les
    // deux autres de leur planning.
    expect(joignables.map((v) => v.id)).toEqual(['1', '4'])
    expect(sansAdresse.map((v) => v.prenom)).toEqual(['Manon', 'Victor'])
  })

  it('les cinq envois de notifications.ts passent par une adresse déjà vérifiée', () => {
    // Garde-fou de source : `notifications.ts` construit ses destinataires à la
    // main, boucle par boucle. Le jour où un sixième envoi sera ajouté, ce test
    // exige qu'il reprenne la variable locale `adresse` — celle qui n'existe
    // que dans la branche `adresseUtilisable(...)`. Un `vet.email` brut y
    // recompilerait sans bruit.
    const source = readFileSync(join(RACINE, 'src/lib/notifications.ts'), 'utf8')
    const destinataires = [...source.matchAll(/to:\s*\[\{\s*email:\s*([A-Za-z0-9_.]+)/g)].map(
      (m) => m[1],
    )
    expect(destinataires.length).toBeGreaterThanOrEqual(5)
    for (const nom of destinataires) {
      expect(nom).toBe('adresse')
    }
  })
})

// ── ② Pas d'adresse, pas d'invitation ───────────────────────────────────────

describe('on ne peut pas inviter une fiche sans adresse', () => {
  it('refuse et dit quoi faire, en français', () => {
    const motif = motifInvitationImpossible({ prenom: 'Manon', nom: 'Dupuis', email: null })
    expect(motif).toBe("Ajoute d'abord l'adresse e-mail de Manon pour pouvoir l'inviter.")
  })

  it('refuse aussi une chaîne vide — elle n’est pas une adresse', () => {
    expect(motifInvitationImpossible({ prenom: 'Manon', email: '' })).not.toBeNull()
    expect(motifInvitationImpossible({ prenom: 'Manon', email: '   ' })).not.toBeNull()
  })

  it('se passe du prénom sans produire une phrase bancale', () => {
    const motif = motifInvitationImpossible({ email: null })
    expect(motif).toBe("Ajoute d'abord une adresse e-mail sur cette fiche pour pouvoir l'inviter.")
  })

  it('laisse passer une fiche qui a une adresse', () => {
    expect(motifInvitationImpossible({ prenom: 'Anne-Sophie', email: 'as@cabinet.fr' })).toBeNull()
  })

  it('le serveur pose ce refus AVANT de basculer en service_role', () => {
    // L'écran désactive le bouton, mais c'est le serveur qui décide. Et l'ordre
    // compte : plus bas, `listUsers().find(u => u.email === …)` comparerait deux
    // `null` et prendrait un compte auth sans adresse pour celui de ce
    // vétérinaire — un compte qui serait alors SUPPRIMÉ.
    const source = readFileSync(
      join(RACINE, 'src/app/(protected)/admin/veterinaires/actions.ts'),
      'utf8',
    )
    const posRefus = source.indexOf('motifInvitationImpossible')
    const posServiceRole = source.indexOf('SUPABASE_SERVICE_ROLE_KEY')
    expect(posRefus).toBeGreaterThan(0)
    expect(posRefus).toBeLessThan(posServiceRole)
  })
})

// ── Les briques de base ─────────────────────────────────────────────────────

describe('adresseUtilisable / normaliserAdresse', () => {
  it('ne prend pas une chaîne vide pour une adresse', () => {
    expect(adresseUtilisable('')).toBe(false)
    expect(adresseUtilisable('   ')).toBe(false)
    expect(adresseUtilisable(null)).toBe(false)
    expect(adresseUtilisable(undefined)).toBe(false)
    expect(adresseUtilisable('as@cabinet.fr')).toBe(true)
  })

  it('enregistre NULL et jamais une chaîne vide', () => {
    // `''` en base repasserait tous les contrôles ET bloquerait la deuxième
    // fiche sans adresse du cabinet (index unique cabinet_id + email).
    expect(normaliserAdresse('')).toBeNull()
    expect(normaliserAdresse('   ')).toBeNull()
    expect(normaliserAdresse(null)).toBeNull()
    expect(normaliserAdresse('  AS@Cabinet.FR ')).toBe('as@cabinet.fr')
  })

  it('accepte une adresse plausible, refuse une adresse à moitié tapée', () => {
    expect(adresseBienFormee('as@cabinet.fr')).toBe(true)
    expect(adresseBienFormee('as@cabinet')).toBe(false)
    expect(adresseBienFormee('as.cabinet.fr')).toBe(false)
  })
})
