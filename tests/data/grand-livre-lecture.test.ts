// ============================================================
// GUARDVETO — La LECTURE du grand livre d'équité (B-196, lot 0)
// ============================================================
// `engine/grand-livre-equite.ts` fait le calcul (prouvé ailleurs, sur les
// vrais bilans). Ici on prouve la REQUÊTE : ce qu'elle filtre, ce qu'elle
// cumule, et surtout ce qu'elle fait quand la base ne répond pas.
//
// Trois pièges du projet sont visés nommément :
//   • « une erreur Supabase avalée devient zéro ligne » ;
//   • la période de JOURNÉES prise pour la période de gardes précédente ;
//   • la lecture non scopée au cabinet.
// ============================================================

import { describe, it, expect } from 'vitest'
import { chargerGrandLivre } from '@/data/grandLivreEquite'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Un faux client qui ENREGISTRE ce qu'on lui demande ───

interface Appel {
  table: string
  filtres: string[]
}

function faireClient(opts: {
  periodes?: { id: string }[]
  bilans?: Record<string, unknown>[]
  erreurPeriodes?: string
  erreurBilans?: string
}): { client: SupabaseClient; appels: Appel[] } {
  const appels: Appel[] = []

  function builder(table: string) {
    const appel: Appel = { table, filtres: [] }
    appels.push(appel)

    const b: Record<string, unknown> = {}
    const note = (quoi: string) => { appel.filtres.push(quoi); return b }

    b.select = () => b
    b.lt = (col: string, val: unknown) => note(`lt:${col}=${String(val)}`)
    b.or = (expr: string) => note(`or:${expr}`)
    b.eq = (col: string, val: unknown) => note(`eq:${col}=${String(val)}`)
    b.in = (col: string, vals: unknown[]) => note(`in:${col}=${(vals as string[]).join(',')}`)
    b.then = (resoudre: (v: { data: unknown; error: { message: string } | null }) => unknown) => {
      if (table === 'periodes') {
        return resoudre(
          opts.erreurPeriodes
            ? { data: null, error: { message: opts.erreurPeriodes } }
            : { data: opts.periodes ?? [], error: null },
        )
      }
      return resoudre(
        opts.erreurBilans
          ? { data: null, error: { message: opts.erreurBilans } }
          : { data: opts.bilans ?? [], error: null },
      )
    }
    return b
  }

  return { client: { from: builder } as unknown as SupabaseClient, appels }
}

const ligne = (vet: string, periode: string, we: number, sem: number, fer: number) => ({
  periode_id: periode, veterinaire_id: vet,
  ecart_we: we, ecart_semaine: sem, ecart_feries: fer,
})

// ============================================================

describe('chargerGrandLivre — ce qu’il demande à la base', () => {
  it('ne retient que les périodes de GARDES antérieures', async () => {
    const { client, appels } = faireClient({ periodes: [] })
    await chargerGrandLivre(client, '2026-11-30', ['v1'])

    const periodes = appels.find((a) => a.table === 'periodes')!
    expect(periodes.filtres).toContain('lt:date_fin=2026-11-30')
    // Une période de JOURNÉES n'a pas de bilan de gardes : la prendre pour
    // « la période précédente » annulait le rattrapage, en silence.
    expect(periodes.filtres.some((f) => f.startsWith('or:') && f.includes('gardes'))).toBe(true)
    // `usage` est absent sur les lignes d'avant B-162 : elles doivent rester.
    expect(periodes.filtres.some((f) => f.includes('usage.is.null'))).toBe(true)
  })

  it('isole le cabinet quand on le lui donne', async () => {
    const { client, appels } = faireClient({ periodes: [] })
    await chargerGrandLivre(client, '2026-11-30', ['v1'], 'cab-1')
    expect(appels.find((a) => a.table === 'periodes')!.filtres).toContain('eq:cabinet_id=cab-1')
  })

  it('sans cabinet, aucun filtre inventé (la RLS fait foi sur ce chemin)', async () => {
    const { client, appels } = faireClient({ periodes: [] })
    await chargerGrandLivre(client, '2026-11-30', ['v1'])
    expect(appels.find((a) => a.table === 'periodes')!.filtres.some((f) => f.startsWith('eq:cabinet_id')))
      .toBe(false)
  })

  it('ne lit les bilans que des périodes trouvées, en une seule requête', async () => {
    const { client, appels } = faireClient({
      periodes: [{ id: 'p1' }, { id: 'p2' }],
      bilans: [ligne('v1', 'p1', 1, 0, 0)],
    })
    await chargerGrandLivre(client, '2026-11-30', ['v1'])
    const bm = appels.filter((a) => a.table === 'bonus_malus')
    expect(bm).toHaveLength(1)
    expect(bm[0].filtres).toContain('in:periode_id=p1,p2')
  })

  it('aucune période antérieure → aucune requête de bilan du tout', async () => {
    const { client, appels } = faireClient({ periodes: [] })
    const livre = await chargerGrandLivre(client, '2026-11-30', ['v1'])
    expect(appels.some((a) => a.table === 'bonus_malus')).toBe(false)
    expect(livre).toEqual({ cumul: {}, report: {}, nbPeriodes: 0, erreur: null })
  })
})

describe('chargerGrandLivre — ce qu’il rend', () => {
  it('cumule les périodes et plafonne le rattrapage', async () => {
    const { client } = faireClient({
      periodes: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      bilans: [
        ligne('victor', 'p1', 1, 0, 0),
        ligne('victor', 'p2', 1, -1, 0),
        ligne('victor', 'p3', 1, 3, 1),
      ],
    })
    const livre = await chargerGrandLivre(client, '2026-11-30', ['victor'])
    expect(livre.cumul['victor']).toEqual({ we: 3, semaine: 2, feries: 1 })
    expect(livre.report['victor']).toEqual({ we: -1, semaine: -2, feries: -1 })
  })

  it('compte les périodes QUI ONT un bilan, pas les périodes closes', async () => {
    // Au Val d'Allier : 4 périodes passées, 3 seulement ont été clôturées.
    // Annoncer « sur 4 périodes » ferait croire à un historique complet.
    const { client } = faireClient({
      periodes: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
      bilans: [ligne('v1', 'p1', 1, 0, 0), ligne('v1', 'p2', 0, 1, 0)],
    })
    const livre = await chargerGrandLivre(client, '2026-11-30', ['v1'])
    expect(livre.nbPeriodes).toBe(2)
  })

  it('cumule TOUT LE MONDE mais ne donne un report qu’à l’effectif', async () => {
    const { client } = faireClient({
      periodes: [{ id: 'p1' }],
      bilans: [ligne('v1', 'p1', 2, 0, 0), ligne('dernier-recours', 'p1', -3, -6, 0)],
    })
    const livre = await chargerGrandLivre(client, '2026-11-30', ['v1'])
    // Le cumul le montre (l'écran peut vouloir l'afficher)…
    expect(livre.cumul['dernier-recours']).toBeDefined()
    // …mais le moteur ne lui promet aucun rattrapage : il n'est pas candidat.
    expect(livre.report['dernier-recours']).toBeUndefined()
    expect(livre.report['v1']).toBeDefined()
  })
})

describe('chargerGrandLivre — une erreur n’est JAMAIS « zéro ligne »', () => {
  it('erreur sur les périodes : elle remonte, et le livre est vide', async () => {
    const { client } = faireClient({ erreurPeriodes: 'connexion perdue' })
    const livre = await chargerGrandLivre(client, '2026-11-30', ['v1'])
    expect(livre.erreur).toBe('connexion perdue')
    expect(livre.report).toEqual({})
  })

  it('erreur sur les bilans : elle remonte aussi', async () => {
    const { client } = faireClient({
      periodes: [{ id: 'p1' }],
      erreurBilans: 'timeout',
    })
    const livre = await chargerGrandLivre(client, '2026-11-30', ['v1'])
    expect(livre.erreur).toBe('timeout')
    expect(livre.cumul).toEqual({})
  })

  it('un livre VIDE et un livre EN PANNE ne se confondent pas', async () => {
    // C'est tout l'enjeu : sans le champ `erreur`, les deux rendraient
    // `{cumul:{}, report:{}}` — « personne ne traîne rien », qu'on l'ait
    // vérifié ou non.
    const { client: sain } = faireClient({ periodes: [] })
    const { client: casse } = faireClient({ erreurPeriodes: 'base muette' })
    const a = await chargerGrandLivre(sain, '2026-11-30', ['v1'])
    const b = await chargerGrandLivre(casse, '2026-11-30', ['v1'])
    expect(a.report).toEqual(b.report)
    expect(a.erreur).toBeNull()
    expect(b.erreur).not.toBeNull()
  })
})
