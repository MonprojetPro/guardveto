// ============================================================
// Une règle ne montre JAMAIS un identifiant technique au cabinet
// ============================================================
// L'INCIDENT — 2026-08-26. MiKL envoie une capture du pré-vol :
//
//     « n'est jamais de garde en même temps que
//       00000000-0000-0000-0000-000000000005 »
//
// Six endroits fabriquaient chacun leur repli quand une règle désigne un
// vétérinaire retiré de l'équipe. Cinq rendaient l'identifiant (`?? id`), un
// rendait `'?'`. Six copies d'un même choix, déjà divergentes.
//
// CE QUI REND CE DÉFAUT PARTICULIER : la phrase juste au-dessus, dans le MÊME
// bandeau, disait déjà la bonne chose — « Une règle concerne un vétérinaire qui
// a été retiré de l'équipe ». L'application expliquait le problème en français,
// puis le renommait en code machine trois lignes plus bas. Ce n'est pas un
// oubli de traduction, c'est deux vocabulaires pour une même situation.
//
// CE QUE CE TEST GARDE : le rendu en langage naturel de toute brique qui nomme
// un vétérinaire. On lui donne un identifiant que rien ne résout, et on exige
// que la phrase produite n'en contienne aucune trace.
//
// Aucune connexion réseau, aucun accès base : on appelle le catalogue.
// ============================================================

import { describe, expect, it } from 'vitest'
import { rendreRegle, CATALOGUE_BRIQUES } from '@/engine/briques/catalogue'
import { VETO_RETIRE, nomVetoOuRetire } from '@/lib/regles/veto-absent'

/** Un identifiant plausible que personne ne résoudra. */
const ID_FANTOME = '00000000-0000-0000-0000-000000000005'

/** Les briques qui nomment un ou plusieurs vétérinaires dans leur phrase. */
const BRIQUES_QUI_NOMMENT: { id: string; params: Record<string, unknown> }[] = [
  { id: 'duo_interdit', params: { avec_veterinaire_id: ID_FANTOME } },
  { id: 'preferer_avec', params: { avec_veterinaire_id: ID_FANTOME } },
  { id: 'seulement_avec', params: { avec_veterinaire_id: ID_FANTOME } },
]

describe('Aucune règle ne montre un identifiant technique', () => {
  it('le test ne passe pas à vide : les briques visées existent', () => {
    for (const { id } of BRIQUES_QUI_NOMMENT) {
      expect(CATALOGUE_BRIQUES[id], `la brique « ${id} » a disparu du catalogue`).toBeDefined()
    }
  })

  it('un vétérinaire introuvable est nommé en français, jamais par son id', () => {
    // Le contexte est celui d'une équipe où ce vétérinaire n'est plus : c'est
    // exactement l'état du cabinet après un départ.
    const ctx = { nomVeto: nomVetoOuRetire([]) }

    for (const { id, params } of BRIQUES_QUI_NOMMENT) {
      const phrase = rendreRegle(id, params, ctx)

      expect(
        phrase,
        `La brique « ${id} » affiche un identifiant technique au cabinet :\n  ${phrase}\n` +
          `Utilise le repli commun de \`lib/regles/veto-absent.ts\` plutôt que \`?? id\`.`,
      ).not.toContain(ID_FANTOME)

      // Et pas seulement « pas d'identifiant » : on exige la BONNE phrase.
      // Sans ça, un `?? ''` passerait le test en produisant « en même temps
      // que  » — un blanc, qui se lit comme un bug plutôt que comme un départ.
      expect(
        phrase,
        `La brique « ${id} » ne nomme pas le vétérinaire absent :\n  ${phrase}`,
      ).toContain(VETO_RETIRE)
    }
  })

  it('un vétérinaire présent est bien nommé par son prénom', () => {
    // Le garde-fou ne doit pas être obtenu en cessant de résoudre les noms.
    const ctx = { nomVeto: nomVetoOuRetire([{ id: ID_FANTOME, prenom: 'Manon' }]) }
    const phrase = rendreRegle('duo_interdit', { avec_veterinaire_id: ID_FANTOME }, ctx)
    expect(phrase).toContain('Manon')
    expect(phrase).not.toContain(VETO_RETIRE)
  })
})
