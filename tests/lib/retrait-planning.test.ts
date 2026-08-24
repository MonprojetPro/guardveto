// ============================================================
// GARDE-FOU — l'agenda d'abord, la base ensuite, et rien si ça résiste
// ============================================================
// LE 2026-08-21, il a fallu supprimer une période à la main : trente événements
// Google effacés un par un, vérifiés, puis la ligne retirée. Le script
// (`scripts/nettoyer-periode-agenda.mjs`) porte cette phrase en commentaire :
// « supprimer les lignes maintenant laisserait ces événements orphelins ».
//
// C'est LA règle. Les `google_event_id` vivent sur les lignes `gardes` :
// effacer la base en premier, c'est jeter les seules poignées qui permettent de
// retirer les rendez-vous de l'agenda du cabinet. Le client se retrouve alors
// avec des gardes fantômes chez sept personnes, et le logiciel n'a plus aucun
// moyen de savoir lesquelles.
//
// Ce test est écrit pour l'étape la plus difficile à provoquer en vrai : la
// panne Google au milieu du travail. Il ne teste pas « la fonction renvoie une
// erreur » — il prouve que l'écriture en base n'a JAMAIS ÉTÉ APPELÉE.
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import {
  executerRetraitPlanning,
  type BilanAgenda,
  type EtapesRetrait,
} from '@/lib/planning/retrait-planning'

const AGENDA_PROPRE: BilanAgenda = { effaces: 3, dejaAbsents: 0, echecs: [] }

/** Un jeu d'étapes qui réussit partout — chaque test n'écrase que ce qu'il teste. */
function etapes(surcharge: Partial<EtapesRetrait> = {}): {
  etapes: EtapesRetrait
  ecrireEnBase: ReturnType<typeof vi.fn>
  retirerDeLAgenda: ReturnType<typeof vi.fn>
  tracer: ReturnType<typeof vi.fn>
} {
  const ecrireEnBase = vi.fn(async () => ({ error: null }))
  const retirerDeLAgenda = vi.fn(async () => AGENDA_PROPRE)
  const tracer = vi.fn(async () => {})

  return {
    ecrireEnBase,
    retirerDeLAgenda,
    tracer,
    etapes: {
      lireEventIds: async () => ['ev-1', 'ev-2', 'ev-3'],
      agendaJoignable: async () => true,
      retirerDeLAgenda,
      ecrireEnBase,
      tracer,
      ...surcharge,
    },
  }
}

describe('retrait d’un planning — l’ordre des opérations', () => {
  it('un seul événement en échec ⇒ LA BASE N’EST PAS TOUCHÉE', async () => {
    const { etapes: e, ecrireEnBase, tracer } = etapes({
      retirerDeLAgenda: vi.fn(async () => ({
        effaces: 2,
        dejaAbsents: 0,
        echecs: [{ eventId: 'ev-3', code: 500, message: 'Backend Error' }],
      })),
    })

    const res = await executerRetraitPlanning(e)

    expect(res.ok).toBe(false)
    // Le point du test. Pas « le résultat est une erreur » : l'écriture n'a
    // pas eu lieu du tout.
    expect(ecrireEnBase).not.toHaveBeenCalled()
    expect(tracer).not.toHaveBeenCalled()
    if (!res.ok) {
      expect(res.error).toMatch(/agenda/i)
      // Le message doit rassurer sur l'état réel, sinon l'admin réessaie en
      // croyant avoir à moitié cassé quelque chose.
      expect(res.error).toMatch(/n’a PAS été touché|Rien n’a été touché/i)
    }
  })

  it('agenda injoignable alors qu’il porte des rendez-vous ⇒ on s’arrête AVANT tout', async () => {
    const { etapes: e, ecrireEnBase, retirerDeLAgenda } = etapes({
      agendaJoignable: async () => false,
    })

    const res = await executerRetraitPlanning(e)

    expect(res.ok).toBe(false)
    // On ne tente même pas : un agenda muet n'est pas un agenda vide.
    expect(retirerDeLAgenda).not.toHaveBeenCalled()
    expect(ecrireEnBase).not.toHaveBeenCalled()
  })

  it('aucun rendez-vous à retirer ⇒ un agenda injoignable n’empêche rien', async () => {
    // Le cas d'un brouillon jamais diffusé : rien dans l'agenda, donc rien à
    // protéger. Exiger Google ici bloquerait le ménage courant sans raison.
    const { etapes: e, ecrireEnBase, retirerDeLAgenda } = etapes({
      lireEventIds: async () => [],
      agendaJoignable: async () => false,
    })

    const res = await executerRetraitPlanning(e)

    expect(res.ok).toBe(true)
    expect(retirerDeLAgenda).not.toHaveBeenCalled()
    expect(ecrireEnBase).toHaveBeenCalledOnce()
  })

  it('un rendez-vous déjà absent chez Google n’est pas un échec', async () => {
    const { etapes: e, ecrireEnBase } = etapes({
      retirerDeLAgenda: vi.fn(async () => ({ effaces: 1, dejaAbsents: 2, echecs: [] })),
    })

    const res = await executerRetraitPlanning(e)

    expect(res.ok).toBe(true)
    expect(ecrireEnBase).toHaveBeenCalledOnce()
    if (res.ok) expect(res.agenda.dejaAbsents).toBe(2)
  })

  it('les identifiants sont lus AVANT l’écriture en base', async () => {
    const ordre: string[] = []
    const res = await executerRetraitPlanning({
      lireEventIds: async () => { ordre.push('lecture'); return ['ev-1'] },
      agendaJoignable: async () => true,
      retirerDeLAgenda: async () => { ordre.push('agenda'); return AGENDA_PROPRE },
      ecrireEnBase: async () => { ordre.push('base'); return { error: null } },
      tracer: async () => { ordre.push('trace') },
    })

    expect(res.ok).toBe(true)
    expect(ordre).toEqual(['lecture', 'agenda', 'base', 'trace'])
  })

  it('l’écriture en base échoue ⇒ le refus remonte tel quel', async () => {
    const { etapes: e, tracer } = etapes({
      ecrireEnBase: async () => ({ error: 'update or delete on table "periodes" violates…' }),
    })

    const res = await executerRetraitPlanning(e)

    expect(res.ok).toBe(false)
    expect(tracer).not.toHaveBeenCalled()
  })

  it('une trace qui échoue ne remet pas le geste en cause', async () => {
    // La trace est un journal, pas une condition. L'agenda est vidé et les
    // lignes sont parties : annoncer un échec ferait recommencer pour rien.
    const { etapes: e } = etapes({
      tracer: async () => { throw new Error('audit_log indisponible') },
    })

    const res = await executerRetraitPlanning(e)
    expect(res.ok).toBe(true)
  })
})
