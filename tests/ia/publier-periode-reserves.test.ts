// ============================================================
// GUARDVETO — Publier : ce qui est MONTRÉ est ce qui est publié
// ============================================================
// Publier est l'action la plus lourde du produit : toute l'équipe est notifiée
// et Google Agenda est réécrit. Elle ne se rattrape pas.
//
// L'outil de Filou envoyait `confirmAvecReserves: true` EN DUR. L'aperçu
// montrait donc les réserves, puis l'exécution confirmait quoi qu'il arrive —
// y compris une réserve apparue entre l'affichage et le clic, que personne
// n'avait vue.
//
// Ce que ces tests figent, et rien d'autre :
//   • rien de nouveau → la publication a bien lieu (le système informe, il
//     n'interdit pas : publier AVEC des réserves reste permis) ;
//   • une réserve apparue APRÈS l'aperçu → on n'écrit pas, et on le dit ;
//   • le premier appel à la route ne confirme JAMAIS — c'est elle qui
//     recalcule et qui tranche, pas Filou.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// `vi.mock` est hissé : la fabrique ne peut voir que des variables `vi.hoisted`.
const { publishPOST, revalider, compterSouhaits } = vi.hoisted(() => ({
  publishPOST: vi.fn(),
  revalider: vi.fn(),
  compterSouhaits: vi.fn(),
}))

vi.mock('@/app/api/publish/route', () => ({ POST: publishPOST }))
vi.mock('@/app/api/generate/pre-vol/route', () => ({ GET: vi.fn() }))
vi.mock('@/app/(protected)/admin/periodes/actions', () => ({
  creerPeriode: vi.fn(),
  setProfilPeriode: vi.fn(),
  setEffectifPeriode: vi.fn(),
}))
vi.mock('@/data/revaliderPlanning', () => ({ revaliderPlanningPublie: revalider }))
vi.mock('@/data/souhaitsCongesEnAttente', () => ({ compterSouhaitsCongesEnAttente: compterSouhaits }))

const { publierPeriode } = await import('@/lib/ia/outils/planning')
const CTX = {} as Parameters<typeof publierPeriode.executer>[1]

/** Ce que la route répond, tour par tour. */
function routeRepond(...reponses: unknown[]) {
  for (const r of reponses) {
    publishPOST.mockResolvedValueOnce({ json: async () => r })
  }
}

/** Le corps JSON envoyé à la route au i-ème appel. Le corps d'une `Request` est
 *  un flux : on le lit ici, jamais dans le faux `POST` — il ne se lit qu'une fois. */
async function corpsDuAppel(i: number): Promise<{ periodeId: string; confirmAvecReserves: boolean }> {
  return (publishPOST.mock.calls[i][0] as Request).json()
}

const RESERVE_VUE = 'Manon enchaîne deux week-ends d’affilée.'
const RESERVE_SURVENUE = 'Antoine n’a aucun jour de repos après sa série.'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('publier_periode — la charge scelle ce qui a été montré', () => {
  it('publie quand la route ne remonte rien : un seul appel, sans confirmation', async () => {
    routeRepond({ success: true })

    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [],
      souhaitsMontres: 0,
      controleEchoue: false,
    })

    expect(r).toEqual({})
    expect(publishPOST).toHaveBeenCalledTimes(1)
    expect((await corpsDuAppel(0)).confirmAvecReserves).toBe(false)
  })

  it('confirme les réserves DÉJÀ montrées — publier en connaissance de cause reste permis', async () => {
    routeRepond(
      { requiresConfirmation: true, violations: [{ detail: RESERVE_VUE }], souhaitsEnAttente: 2 },
      { success: true },
    )

    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [RESERVE_VUE],
      souhaitsMontres: 2,
      controleEchoue: false,
    })

    expect(r).toEqual({})
    expect(publishPOST).toHaveBeenCalledTimes(2)
    expect((await corpsDuAppel(0)).confirmAvecReserves).toBe(false)
    expect((await corpsDuAppel(1)).confirmAvecReserves).toBe(true)
  })

  it('REFUSE de publier une réserve apparue APRÈS l’aperçu, et ne confirme jamais', async () => {
    routeRepond({
      requiresConfirmation: true,
      violations: [{ detail: RESERVE_VUE }, { detail: RESERVE_SURVENUE }],
      souhaitsEnAttente: 0,
    })

    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [RESERVE_VUE],
      souhaitsMontres: 0,
      controleEchoue: false,
    })

    expect(r.error).toContain('a changé depuis ma proposition')
    expect(r.error).toContain(RESERVE_SURVENUE)
    // Le point qui compte : AUCUN second appel, donc aucune écriture.
    expect(publishPOST).toHaveBeenCalledTimes(1)
    expect((await corpsDuAppel(0)).confirmAvecReserves).toBe(false)
  })

  it('refuse aussi sur une demande de congé de plus, arrivée entre-temps', async () => {
    routeRepond({ requiresConfirmation: true, violations: [], souhaitsEnAttente: 3 })

    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [],
      souhaitsMontres: 1,
      controleEchoue: false,
    })

    expect(r.error).toContain('2 demandes de congé de plus')
    expect(publishPOST).toHaveBeenCalledTimes(1)
  })

  it('une réserve DISPARUE entre-temps ne bloque rien', async () => {
    routeRepond({ requiresConfirmation: true, violations: [], souhaitsEnAttente: 1 }, { success: true })

    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [RESERVE_VUE, RESERVE_SURVENUE],
      souhaitsMontres: 4,
      controleEchoue: false,
    })

    expect(r).toEqual({})
    expect(publishPOST).toHaveBeenCalledTimes(2)
  })

  it('ne publie pas sur un contrôle qui a échoué à l’aperçu : rien à comparer', async () => {
    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [],
      souhaitsMontres: 0,
      controleEchoue: true,
    })

    expect(r.error).toContain('contrôle absent')
    expect(publishPOST).not.toHaveBeenCalled()
  })

  it('remonte l’erreur de la route sans jamais réessayer avec confirmation', async () => {
    routeRepond({ error: 'Accès réservé aux administrateurs.' })

    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, {
      periodeId: 'p1',
      violationsMontrees: [],
      souhaitsMontres: 0,
      controleEchoue: false,
    })

    expect(r).toEqual({ error: 'Accès réservé aux administrateurs.' })
    expect(publishPOST).toHaveBeenCalledTimes(1)
  })

  it('sans charge, ne tente rien', async () => {
    const r = await publierPeriode.executer({ periode: 'Hiver P2' }, CTX, undefined)
    expect(r.error).toContain('proposition a été perdue')
    expect(publishPOST).not.toHaveBeenCalled()
  })
})
