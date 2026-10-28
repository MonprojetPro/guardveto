// ============================================================
// B-175a — un cabinet « journées seules » (gardes éteintes)
// ============================================================
// MiKL, 28/10 : « pourquoi je ne peux pas décocher les gardes ? », puis
// « lance B-175a ».
//
// Ce que ces cas prouvent :
//   • l'écran et la base portent la MÊME liste de modules réglables (la base
//     fait autorité ; un écart afficherait une case que la base refuse) ;
//   • la base refuse d'éteindre le dernier planning, en français ;
//   • Filou est prévenu qu'il n'y a pas de gardes — sinon « qui est de garde
//     ce soir ? » recevrait « personne », une réponse fausse présentée comme
//     vérifiée ;
//   • le refus serveur d'un module que l'admin règle elle-même l'envoie au bon
//     endroit, pas chez MonProjetPro.
// ============================================================

import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let modulesEnBase: string[] | Error = ['gardes', 'planning-journee']

vi.mock('@/lib/supabase/cabinet', () => ({
  resoudreCabinetId: async () => {
    if (modulesEnBase instanceof Error) throw modulesEnBase
    return 'cab-1'
  },
  CabinetIntrouvableError: class extends Error {},
}))

const fauxSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { modules_actifs: modulesEnBase }, error: null }),
      }),
    }),
  }),
} as never

const { MODULES_REGLABLES_PAR_ADMIN, MODULES } = await import('@/lib/produit/modules')
const { exigerModule } = await import('@/lib/produit/modules-serveur')
const { blocPlannings } = await import('@/lib/ia/agentFilou')

/** La dernière migration qui (re)définit `basculer_module_cabinet`. */
function derniereFonctionEnBase(): string {
  const dossier = join(__dirname, '..', '..', 'supabase', 'migrations')
  const fichiers = readdirSync(dossier)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(dossier, f), 'utf8').includes('FUNCTION public.basculer_module_cabinet'))
  return readFileSync(join(dossier, fichiers[fichiers.length - 1]), 'utf8')
}

describe('Les gardes s’éteignent, mais jamais le dernier planning', () => {
  it('la base et l’écran règlent exactement les mêmes modules', () => {
    const sql = derniereFonctionEnBase()
    const liste = sql.match(/p_module NOT IN \(([^)]*)\)/u)?.[1] ?? ''
    const enBase = [...liste.matchAll(/'([^']+)'/gu)].map((m) => m[1]).sort()
    expect(enBase).toEqual([...MODULES_REGLABLES_PAR_ADMIN].sort())
    expect(enBase).toContain('gardes')
  })

  it('la base refuse d’éteindre le dernier planning, avec une phrase lisible', () => {
    expect(derniereFonctionEnBase()).toContain('Gardez au moins un planning allumé.')
  })

  it('chaque module réglable est déclaré éteignable au catalogue', () => {
    for (const m of MODULES_REGLABLES_PAR_ADMIN) expect(MODULES[m].eteignable).toBe(true)
  })
})

describe('Filou sait quand il n’y a pas de gardes', () => {
  it('le dit quand les gardes sont éteintes', async () => {
    modulesEnBase = ['planning-journee']
    const bloc = await blocPlannings({ supabase: fauxSupabase })
    expect(bloc).toContain("CE CABINET N'A PAS DE GARDES")
    expect(bloc).toContain('ne réponds jamais « personne n\'est de garde »')
  })

  it('ne dit rien quand le cabinet a ses gardes', async () => {
    modulesEnBase = ['gardes']
    expect(await blocPlannings({ supabase: fauxSupabase })).toBeNull()
  })

  it('une lecture qui échoue ne prétend pas que les gardes sont éteintes', async () => {
    modulesEnBase = new Error('réseau')
    expect(await blocPlannings({ supabase: fauxSupabase })).toBeNull()
  })
})

describe('Le refus serveur d’un module éteint', () => {
  it('renvoie l’admin vers « Vos plannings » pour les gardes', async () => {
    modulesEnBase = ['planning-journee']
    await expect(exigerModule(fauxSupabase, 'gardes')).rejects.toThrow(/Vos plannings/u)
  })

  it('laisse passer un module allumé', async () => {
    modulesEnBase = ['gardes']
    await expect(exigerModule(fauxSupabase, 'gardes')).resolves.toBeUndefined()
  })
})
