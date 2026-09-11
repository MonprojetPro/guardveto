// ============================================================
// Le serveur refuse-t-il vraiment un module eteint ?
// ============================================================
// Cacher une entree de menu n'a JAMAIS ferme une URL. Ce test regarde la
// seule chose qui fait autorite : le refus cote serveur.
//
// ⚠️ Il verifie aussi le SENS DU REPLI. Une lecture qui echoue doit rendre
//    le socle, jamais « tout allume » : un repli permissif transformerait
//    une panne de lecture en ouverture generale, sans un seul message.
// ============================================================

import { describe, expect, it, vi } from 'vitest'
import { ModuleEteintError, exigerModule, modulesDuCabinet } from '@/lib/produit/modules-serveur'

/** Un faux client Supabase qui rend la liste demandee pour le cabinet. */
function fauxSupabase(modules: string[] | null, erreur = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: modules === null ? null : { modules_actifs: modules },
            error: erreur ? { message: 'lecture impossible' } : null,
          }),
        }),
      }),
    }),
  } as never
}

vi.mock('@/lib/supabase/cabinet', () => ({
  resoudreCabinetId: async () => 'cab-1',
  CabinetIntrouvableError: class extends Error {},
}))

describe('modulesDuCabinet', () => {
  it('rend les modules allumes du cabinet', async () => {
    expect(await modulesDuCabinet(fauxSupabase(['gardes', 'chat']))).toEqual(['gardes', 'chat'])
  })

  it('replie sur le socle si le cabinet est introuvable — jamais sur « tout allume »', async () => {
    expect(await modulesDuCabinet(fauxSupabase(null))).toEqual(['gardes'])
  })

  it('replie sur le socle si la lecture echoue — le produit se degrade en FERMANT', async () => {
    expect(await modulesDuCabinet(fauxSupabase(['gardes', 'chat'], true))).toEqual(['gardes'])
  })
})

describe('exigerModule', () => {
  it('laisse passer un module allume', async () => {
    await expect(exigerModule(fauxSupabase(['gardes', 'chat']), 'chat')).resolves.toBeUndefined()
  })

  it('REFUSE un module eteint, avec un message que l’admin peut lire', async () => {
    await expect(exigerModule(fauxSupabase(['gardes']), 'chat')).rejects.toThrow(ModuleEteintError)
    await expect(exigerModule(fauxSupabase(['gardes']), 'chat')).rejects.toThrow(
      /Messagerie de l’equipe/,
    )
  })

  it('REFUSE un module inconnu plutot que de le laisser passer', async () => {
    // Une faute de frappe dans l'appelant ne doit pas ouvrir la porte en silence.
    await expect(exigerModule(fauxSupabase(['gardes', 'chat']), 'chatt')).rejects.toThrow(
      ModuleEteintError,
    )
  })
})
