// B-179c — un vétérinaire prend lui-même une place vide.
// Ce qui BLOQUE (le geste n'a pas de sens) est ici ; ce qui AVERTIT (les
// règles) est à la route, qui ne bloque jamais sur une règle (MiKL, 02/11).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { controlerPrisePlace, placeAPrendre } from '@/lib/gardes/prendrePlace'

const MOI = 'vet-fanny'
const base = {
  aujourdhui: '2026-11-02',
  date: '2026-11-04',
  periodePubliee: true,
  placeIndex: 1,
  attendues: 2,
  occupants: new Map<number, string>([[0, 'vet-camille']]),
  moiVetId: MOI,
}

describe('controlerPrisePlace — ce qui bloque', () => {
  it('laisse prendre une place prévue, vide, d’une garde publiée à venir', () => {
    expect(controlerPrisePlace(base)).toBeNull()
  })

  it('refuse un planning pas encore diffusé', () => {
    expect(controlerPrisePlace({ ...base, periodePubliee: false })?.status).toBe(403)
  })

  it('refuse la garde du jour et celles d’avant (« à partir de demain »)', () => {
    expect(controlerPrisePlace({ ...base, date: '2026-11-02' })?.status).toBe(422)
    expect(controlerPrisePlace({ ...base, date: '2026-10-30' })?.status).toBe(422)
    expect(controlerPrisePlace({ ...base, date: '2026-11-03' })).toBeNull()
  })

  it('refuse une place que le cabinet n’a pas prévue', () => {
    expect(controlerPrisePlace({ ...base, placeIndex: 2 })?.status).toBe(422)
    expect(controlerPrisePlace({ ...base, placeIndex: -1 })?.status).toBe(400)
  })

  it('ouvre la 3e et la 4e place quand le cabinet les a configurées', () => {
    const occupants = new Map<number, string>([[0, 'a'], [1, 'b']])
    expect(controlerPrisePlace({ ...base, attendues: 4, placeIndex: 2, occupants })).toBeNull()
    expect(controlerPrisePlace({ ...base, attendues: 4, placeIndex: 3, occupants })).toBeNull()
  })

  it('se tait plutôt que de laisser prendre une place dont on ne connaît pas l’existence', () => {
    expect(controlerPrisePlace({ ...base, attendues: null })?.status).toBe(422)
  })

  it('refuse une place déjà prise, et un véto déjà sur le créneau', () => {
    expect(controlerPrisePlace({ ...base, placeIndex: 0 })?.status).toBe(409)
    const dejaLa = new Map<number, string>([[0, MOI]])
    expect(controlerPrisePlace({ ...base, occupants: dejaLa })?.status).toBe(409)
  })
})

describe('placeAPrendre — ce que l’écran offre', () => {
  const ecran = {
    indicesOccupes: [0], vetIdsOccupants: ['vet-camille'], manque: 1,
    moiVetId: MOI, date: '2026-11-04', aujourdhui: '2026-11-02', publie: true,
  }

  it('désigne la première place vide', () => {
    expect(placeAPrendre(ecran)).toBe(1)
    expect(placeAPrendre({ ...ecran, indicesOccupes: [1], vetIdsOccupants: ['x'] })).toBe(0)
  })

  it('va jusqu’à la 3e place sur un créneau qui en prévoit trois', () => {
    expect(placeAPrendre({ ...ecran, indicesOccupes: [0, 1], vetIdsOccupants: ['a', 'b'], manque: 1 })).toBe(2)
  })

  it('n’offre rien sans place vide, sans fiche véto, hors publication, le jour même, ou si je suis déjà de garde', () => {
    expect(placeAPrendre({ ...ecran, manque: 0 })).toBeNull()
    expect(placeAPrendre({ ...ecran, moiVetId: '' })).toBeNull()
    expect(placeAPrendre({ ...ecran, publie: false })).toBeNull()
    expect(placeAPrendre({ ...ecran, date: '2026-11-02' })).toBeNull()
    expect(placeAPrendre({ ...ecran, vetIdsOccupants: [MOI] })).toBeNull()
  })
})

// La route elle-même : on verrouille par lecture les deux promesses que MiKL a
// tranchées, pour qu'une retouche ne les retourne pas en silence.
const route = readFileSync(join(process.cwd(), 'src/app/api/gardes/[id]/prendre-place/route.ts'), 'utf8')

describe('la route prendre-place', () => {
  it('ne bloque jamais sur une règle : elle avertit, et accepte sur confirmation', () => {
    expect(route).toContain('needsConfirmation: true')
    expect(route).toContain('confirmerAvertissements !== true')
    // Le jugement du moteur n'est PAS un refus : il alimente les avertissements.
    expect(route).not.toMatch(/candidats\.some[^\n]*\)\s*\)\s*\{\s*return NextResponse/)
  })

  it('place TOUJOURS la session connectée, jamais un identifiant venu du client', () => {
    expect(route).not.toMatch(/corps\.(vetId|veterinaireId|veterinaire_id)/)
    expect(route).toContain("user.app_metadata?.cabinet_id")
  })

  it('n’écrit la place que si elle est ENCORE vide à l’instant de l’écriture (deux prises simultanées)', () => {
    expect(route).toContain("siVide: index === 0 ? 'premier_id' : index === 1 ? 'second_id' : undefined")
    const source = readFileSync(join(process.cwd(), 'src/lib/gardes/appliquer-changement.ts'), 'utf8')
    expect(source).toContain('requete.is(params.siVide, null)')
    expect(source).toContain("status: 409, error: 'Cette place vient d’être prise par quelqu’un d’autre.'")
  })

  it('laisse une trace pour l’administratrice et la prévient', () => {
    expect(route).toContain("chemin: 'prise-place-libre'")
    expect(route).toContain("type: 'garde_modifiee'")
  })
})

// Le défaut trouvé en chemin : réécrire la 1re ou la 2e place effaçait la 3e et
// la 4e (le `delete` portait sur toute la garde).
describe('appliquerChangementGarde — les places 3 et 4 survivent', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/gardes/appliquer-changement.ts'), 'utf8')
  it('ne supprime que les places 0 et 1 avant de réécrire la paire', () => {
    expect(source).toContain(".delete().eq('garde_id', gardeId).in('place_index', [0, 1])")
    expect(source).not.toMatch(/\.delete\(\)\.eq\('garde_id', gardeId\)\s*\n/)
  })
})
