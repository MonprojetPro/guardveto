// ============================================================
// Le planning journée appelle-t-il VRAIMENT la garde des modules ?
// ============================================================
// B-120a ① — et c'est le seul test de ce lot qui prouve quelque chose qu'un
// humain ne pouvait pas vérifier à l'œil.
//
// LA SITUATION QU'IL CLÔT : `exigerModule()` a été écrite et testée le 11/09,
// avec 6 cas qui passaient, et elle n'avait AUCUN APPELANT pendant trois
// semaines. Le dispositif anti-module-éteint était intégralement du code mort,
// et rien ne le disait. C'est la leçon du 26/08 mot pour mot — « un grep prouve
// qu'un code est ÉCRIT, jamais qu'il est EXÉCUTÉ ».
//
// Ce que ces cas vérifient donc, ce n'est pas que la garde fonctionne (c'est
// le travail de `modules-serveur.test.ts`), c'est QU'ELLE EST APPELÉE, et
// appelée AVANT TOUT LE RESTE. Sur un module éteint, aucune lecture et aucune
// écriture ne doivent avoir eu lieu — pas même la lecture du rôle.
//
// ⚠️ UN TEST QUI PASSERAIT SANS RIEN PROUVER serait facile à écrire ici : il
//    suffirait de vérifier que l'action rend `{ error }`. Elle en rend aussi
//    pour un non-admin et pour une saisie invalide. On regarde donc l'ORDRE
//    des appels, pas seulement le résultat.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Ce que le faux Supabase a réellement fait, dans l'ordre. */
let journal: string[] = []
/** Les modules allumés pour le cabinet du test. */
let modules: string[] = ['gardes', 'planning-journee']
/** Le rôle de la personne connectée. */
let role = 'admin'
/** La dernière ligne envoyée en insertion, pour inspecter `cabinet_id`. */
let dernierInsert: Record<string, unknown> | null = null
/** Les tranches déjà en base, pour les cas de doublon. */
let blocsEnBase: { id: string; nom: string; actif: boolean }[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/supabase/cabinet', () => ({
  resoudreCabinetId: async () => 'cab-1',
  CabinetIntrouvableError: class extends Error {},
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        journal.push('auth')
        return { data: { user: { id: 'u-1' } } }
      },
    },
    from: (table: string) => {
      journal.push(`from:${table}`)
      const chaine: Record<string, unknown> = {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        limit: () => chaine,
        maybeSingle: async () => {
          if (table === 'cabinets') return { data: { modules_actifs: modules }, error: null }
          if (table === 'veterinaires') return { data: { role_app: role }, error: null }
          // `blocs_journee` : le dernier rang, pour calculer `ordre`.
          return { data: { ordre: 2 }, error: null }
        },
        insert: async (ligne: Record<string, unknown>) => {
          journal.push(`insert:${table}`)
          dernierInsert = ligne
          return { error: null }
        },
        update: () => {
          journal.push(`update:${table}`)
          return { eq: async () => ({ error: null }) }
        },
        then: undefined,
      }
      // Le `select()` sans `maybeSingle` (liste des noms existants) est attendu
      // par `await` : on le rend résoluble.
      ;(chaine as { then?: unknown }).then = (resoudre: (v: unknown) => void) =>
        resoudre({ data: table === 'blocs_journee' ? blocsEnBase : [], error: null })
      return chaine
    },
  }),
}))

const { creerBloc, modifierBloc, basculerBloc } = await import('@/app/(v2)/journee/actions')

const bon = { nom: 'Matin', debut: '08:00', fin: '12:00', creneau: 'matin' }

beforeEach(() => {
  journal = []
  modules = ['gardes', 'planning-journee']
  role = 'admin'
  dernierInsert = null
  blocsEnBase = []
})

describe('Les trois actions exigent le module AVANT tout le reste', () => {
  for (const [nom, lancer] of [
    ['creerBloc', () => creerBloc(bon)],
    ['modifierBloc', () => modifierBloc('b-1', bon)],
    ['basculerBloc', () => basculerBloc('b-1', false)],
  ] as const) {
    it(`${nom} refuse quand le planning journée est éteint`, async () => {
      modules = ['gardes']
      const r = await lancer()
      expect(r).toHaveProperty('error')
      if ('error' in r) expect(r.error).toMatch(/Planning de la journee|n’est pas activé/)
    })

    it(`${nom} n’écrit RIEN quand le module est éteint`, async () => {
      modules = ['gardes']
      await lancer()
      expect(journal.filter((e) => e.startsWith('insert:') || e.startsWith('update:'))).toEqual([])
    })

    it(`${nom} ne lit même pas le rôle quand le module est éteint`, async () => {
      // La garde du module passe EN PREMIER : sur un cabinet qui n'a pas la
      // capacité, cet écran n'a pas à exister, pas même pour vérifier qui
      // demande. Si ce cas tombe, c'est que l'ordre des gardes a été inversé.
      modules = ['gardes']
      await lancer()
      expect(journal).toContain('from:cabinets')
      expect(journal).not.toContain('from:veterinaires')
    })
  }
})

describe('Les trois actions exigent l’admin', () => {
  it('refuse un vétérinaire, module allumé', async () => {
    role = 'veto'
    const r = await creerBloc(bon)
    expect(r).toHaveProperty('error')
    expect(journal.filter((e) => e.startsWith('insert:'))).toEqual([])
  })
})

describe('creerBloc, quand la porte est ouverte', () => {
  it('écrit la tranche, avec le cabinet résolu côté SERVEUR', async () => {
    const r = await creerBloc(bon)
    expect(r).toEqual({ success: true })
    // Jamais un `cabinet_id` venu du client : ce serait un formulaire pour
    // écrire chez le voisin.
    expect(dernierInsert).toMatchObject({
      nom: 'Matin',
      debut: '08:00',
      fin: '12:00',
      creneau: 'matin',
      cabinet_id: 'cab-1',
    })
  })

  it('place la nouvelle tranche après la dernière', async () => {
    await creerBloc(bon)
    expect(dernierInsert).toMatchObject({ ordre: 3 })
  })

  it('refuse un doublon de nom', async () => {
    blocsEnBase = [{ id: 'b-1', nom: 'Matin', actif: true }]
    const r = await creerBloc(bon)
    expect(r).toHaveProperty('error')
    expect(journal.filter((e) => e.startsWith('insert:'))).toEqual([])
  })

  it('dit OÙ est la tranche qui bloque quand elle a été RETIRÉE', async () => {
    // Le cas qui envoie chercher un bug qui n'existe pas : l'index unique de
    // la base ne distingue pas les tranches retirées, donc le refus est exact
    // — mais l'admin regarde une liste où aucun « Matin » n'apparaît. Il est
    // plus bas, dans la section « Tranches retirées ».
    blocsEnBase = [{ id: 'b-1', nom: 'Matin', actif: false }]
    const r = await creerBloc(bon)
    expect(r).toHaveProperty('error')
    if ('error' in r) expect(r.error).toMatch(/retirée/)
  })

  it('refuse une saisie invalide SANS rien écrire', async () => {
    const r = await creerBloc({ ...bon, fin: '07:00' })
    expect(r).toHaveProperty('error')
    expect(journal.filter((e) => e.startsWith('insert:'))).toEqual([])
  })
})

describe('basculerBloc', () => {
  it('désactive au lieu de supprimer — le passé posé dessus doit survivre', async () => {
    const r = await basculerBloc('b-1', false)
    expect(r).toEqual({ success: true })
    expect(journal).toContain('update:blocs_journee')
    // Aucune suppression nulle part : si un `delete` apparaît un jour ici,
    // c'est la décision 6 du KIT COMPLET qui a été perdue.
    expect(journal.some((e) => e.startsWith('delete:'))).toBe(false)
  })
})
