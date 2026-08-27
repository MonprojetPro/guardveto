// ============================================================
// GUARDVETO — La bascule vers un événement par personne et par jour (B-079)
// ============================================================
// ⚠️ AUCUN APPEL RÉEL À GOOGLE. La cliente (Val d'Allier) est en production sur
// cet agenda et n'a rien recetté : un test qui parlerait vraiment à Google
// écrirait dans son agenda. Google est simulé par une petite mémoire ci-dessous,
// et c'est ELLE qu'on inspecte.
//
// Ce que ces tests protègent :
//   ① L'IDEMPOTENCE. Relancer la synchronisation ne doit JAMAIS doubler
//      l'agenda. C'est le risque numéro un d'une bascule : deux fois la même
//      garde, et personne ne sait laquelle fait foi.
//   ② LA BASCULE. Un événement de bloc ne peut pas « devenir » six : il est
//      supprimé, puis les nouveaux sont créés, puis l'ancien identifiant est
//      effacé — et l'interruption entre deux étapes doit se rattraper seule.
//   ③ LE GARDE-FOU « un brouillon ne sort pas du logiciel ». Il a été payé par
//      38 événements de brouillon déversés chez cette même cliente.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Google, simulé ───────────────────────────────────────────
const google = {
  evenements: new Map<string, { titre: string; jour: string }>(),
  sequence: 0,
  /** Événements que la suppression doit refuser (panne, droit retiré). */
  indelebiles: new Set<string>(),
}

vi.mock('../google-calendar', async (importActual) => {
  const reel = await importActual<typeof import('../google-calendar')>()
  return {
    ...reel,
    isGoogleCalendarConfigured: () => true,
    creerEvenementPlanifie: vi.fn(async (ev: { titre: string; jour: string }) => {
      const id = `ev-${++google.sequence}`
      google.evenements.set(id, { titre: ev.titre, jour: ev.jour })
      return id
    }),
    majEvenementPlanifie: vi.fn(async (id: string, ev: { titre: string; jour: string }) => {
      google.evenements.set(id, { titre: ev.titre, jour: ev.jour })
    }),
    deleteGardeEvent: vi.fn(async (id: string) => {
      if (google.indelebiles.has(id)) throw new Error('Accès refusé par Google')
      if (!google.evenements.has(id)) {
        // Google répond 404 quand l'événement n'existe déjà plus : ce n'est pas
        // un échec, l'état visé est atteint. `retirerEvenementsAvecBilan` le sait.
        throw Object.assign(new Error('Not Found'), { code: 404 })
      }
      google.evenements.delete(id)
    }),
  }
})

// Ces deux chargeurs interrogent la base pour des réglages hors sujet ici : la
// structure par défaut et le couple historique suffisent.
vi.mock('@/data/chargerStructureCabinet', () => ({
  chargerStructureProfilPeriode: async () => undefined,
}))
vi.mock('@/data/chargerRelationsAffichage', () => ({
  chargerRelationsAffichagePeriode: async () => undefined,
}))

import { syncCalendrier, idsEvenementsDePeriode } from '../sync-calendrier'

// ── Supabase, simulé ─────────────────────────────────────────
// Assez de builder pour les requêtes que la synchronisation passe réellement.
// Volontairement minimal : un faux client trop complaisant laisserait passer
// une requête que la vraie base refuserait.

type Ligne = Record<string, unknown>

function creerSupabase(tables: Record<string, Ligne[]>) {
  const correspond = (l: Ligne, filtres: Array<[string, unknown, 'eq' | 'in']>) =>
    filtres.every(([col, val, op]) =>
      op === 'in' ? (val as unknown[]).includes(l[col]) : l[col] === val)

  function requete(nom: string) {
    const filtres: Array<[string, unknown, 'eq' | 'in']> = []
    let mode: 'select' | 'update' | 'delete' | 'upsert' = 'select'
    let charge: Ligne = {}
    let conflit: string[] = []

    const executer = () => {
      const lignes = tables[nom] ?? (tables[nom] = [])
      if (mode === 'select') {
        return { data: lignes.filter((l) => correspond(l, filtres)).map((l) => ({ ...l })), error: null }
      }
      if (mode === 'update') {
        for (const l of lignes) if (correspond(l, filtres)) Object.assign(l, charge)
        return { data: null, error: null }
      }
      if (mode === 'delete') {
        const restantes = lignes.filter((l) => !correspond(l, filtres))
        tables[nom] = restantes
        return { data: null, error: null }
      }
      // upsert — la contrainte UNIQUE de `garde_evenements`, reproduite ici :
      // sans elle, le test ne pourrait pas distinguer un doublon d'une reprise.
      const existante = lignes.find((l) => conflit.every((c) => l[c] === charge[c]))
      if (existante) Object.assign(existante, charge)
      else lignes.push({ ...charge })
      return { data: null, error: null }
    }

    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => { filtres.push([col, val, 'eq']); return api },
      in: (col: string, vals: unknown[]) => { filtres.push([col, vals, 'in']); return api },
      order: () => api,
      update: (c: Ligne) => { mode = 'update'; charge = c; return api },
      delete: () => { mode = 'delete'; return api },
      upsert: (c: Ligne, o?: { onConflict?: string }) => {
        mode = 'upsert'; charge = c; conflit = (o?.onConflict ?? '').split(',').filter(Boolean)
        return api
      },
      maybeSingle: async () => {
        const r = executer()
        return { data: (r.data as Ligne[] | null)?.[0] ?? null, error: null }
      },
      single: async () => {
        const r = executer()
        return { data: (r.data as Ligne[] | null)?.[0] ?? null, error: null }
      },
      then: (resoudre: (v: unknown) => unknown) => Promise.resolve(executer()).then(resoudre),
    }
    return api
  }

  return { from: (nom: string) => requete(nom) } as never
}

const PERIODE = 'per-1'
const CABINET = 'cab-1'

/** Un cabinet publié, deux vétos, une garde de semaine et un week-end. */
function baseDeDepart(options?: { publie?: boolean; ancienEventId?: string | null }) {
  return {
    periodes: [{ id: PERIODE, cabinet_id: CABINET, publie_at: options?.publie === false ? null : '2026-08-27T10:00:00Z' }],
    cabinets: [{
      id: CABINET,
      google_calendar_id: 'agenda-val-dallier',
      agenda_journee_entiere: true,
      agenda_afficher_horaires: false,
    }],
    veterinaires: [
      { id: 'v-anne', cabinet_id: CABINET, prenom: 'Anne-Sophie', nom: 'Bernard', libelle_agenda: null, couleur_google: '7' },
      { id: 'v-antoine', cabinet_id: CABINET, prenom: 'Antoine', nom: 'Duval', libelle_agenda: null, couleur_google: '6' },
    ],
    creneau_modele: [
      { cabinet_id: CABINET, code: 'semaine_soir', nom: 'Soir de semaine', libelle_agenda: 'garde', roles: null },
      { cabinet_id: CABINET, code: 'vendredi_soir', nom: 'Vendredi soir', libelle_agenda: 'garde', roles: null },
      { cabinet_id: CABINET, code: 'weekend', nom: 'Week-end', libelle_agenda: 'garde', roles: null },
    ],
    gardes: [
      {
        id: 'g-semaine', periode_id: PERIODE, cabinet_id: CABINET,
        date: '2026-09-29', type: 'semaine',
        google_event_id: options?.ancienEventId ?? null,
        premier_id: 'v-anne', second_id: 'v-antoine',
      },
      {
        id: 'g-weekend', periode_id: PERIODE, cabinet_id: CABINET,
        date: '2026-10-03', type: 'weekend',
        google_event_id: null,
        premier_id: 'v-anne', second_id: 'v-antoine',
      },
    ],
    gardes_exceptions: [] as Ligne[],
    garde_evenements: [] as Ligne[],
  }
}

beforeEach(() => {
  google.evenements.clear()
  google.indelebiles.clear()
  google.sequence = 0
})

describe('B-079 — l’agenda est RAPPROCHÉ, pas recréé', () => {
  it('première synchronisation : 2 + 6 événements, un par personne et par jour', async () => {
    const tables = baseDeDepart()
    const r = await syncCalendrier(creerSupabase(tables), PERIODE)

    expect(r.errors).toEqual([])
    // Semaine : 1 jour × 2 places. Week-end : 3 jours × 2 places.
    expect(google.evenements.size).toBe(8)
    expect(tables.garde_evenements).toHaveLength(8)
    expect(r.synced).toBe(8)

    // Le vendredi existe bien, avec les rôles inversés.
    const titres = [...google.evenements.values()].map((e) => `${e.jour} ${e.titre}`)
    expect(titres).toContain('2026-10-02 garde-AD-1er')
    expect(titres).toContain('2026-10-03 garde-ASB-1er')
  })

  it('⚠️ RELANCÉE DEUX FOIS, elle ne double RIEN', async () => {
    const tables = baseDeDepart()
    const supabase = creerSupabase(tables)

    await syncCalendrier(supabase, PERIODE)
    const apresUn = new Set(google.evenements.keys())

    await syncCalendrier(supabase, PERIODE)

    // Mêmes identifiants, même compte : la seconde passe a mis à jour, pas créé.
    expect(google.evenements.size).toBe(8)
    expect(new Set(google.evenements.keys())).toEqual(apresUn)
    expect(tables.garde_evenements).toHaveLength(8)
  })

  it('une place devenue vacante retire son événement, sans toucher aux autres', async () => {
    const tables = baseDeDepart()
    const supabase = creerSupabase(tables)
    await syncCalendrier(supabase, PERIODE)
    expect(google.evenements.size).toBe(8)

    // Le dimanche, la 2nde place n'est plus tenue par personne.
    tables.gardes_exceptions.push({
      garde_id: 'g-weekend', date: '2026-10-04', role: 'second', veterinaire_id: null,
    })
    await syncCalendrier(supabase, PERIODE)

    expect(google.evenements.size).toBe(7)
    expect(tables.garde_evenements).toHaveLength(7)
    // L'agenda ne garde pas le nom de quelqu'un qui ne sera pas là.
    const dimanche = [...google.evenements.values()].filter((e) => e.jour === '2026-10-04')
    expect(dimanche.map((e) => e.titre)).toEqual(['garde-ASB-1er'])
  })
})

describe('B-079 — la bascule des anciens événements de bloc', () => {
  it('l’ancien événement est supprimé, les nouveaux créés, l’identifiant effacé', async () => {
    const tables = baseDeDepart({ ancienEventId: 'ancien-bloc' })
    google.evenements.set('ancien-bloc', { titre: 'Garde — Anne-Sophie (1er) + Antoine (2nd)', jour: '2026-09-29' })

    await syncCalendrier(creerSupabase(tables), PERIODE)

    // Un événement ne peut pas « devenir » six : l'ancien disparaît.
    expect(google.evenements.has('ancien-bloc')).toBe(false)
    expect(google.evenements.size).toBe(8)
    // L'identifiant est effacé : la prochaine passe n'a plus rien à basculer.
    expect(tables.gardes.find((g) => g.id === 'g-semaine')?.google_event_id).toBeNull()
  })

  it('bascule + relance : toujours 8 événements, jamais 16', async () => {
    const tables = baseDeDepart({ ancienEventId: 'ancien-bloc' })
    google.evenements.set('ancien-bloc', { titre: 'bloc', jour: '2026-09-29' })
    const supabase = creerSupabase(tables)

    await syncCalendrier(supabase, PERIODE)
    await syncCalendrier(supabase, PERIODE)

    expect(google.evenements.size).toBe(8)
  })

  it('interruption après la suppression : la relance se rattrape (404 = déjà fait)', async () => {
    // Google ne connaît PLUS l'événement, mais la base porte encore son id —
    // exactement l'état laissé par un processus coupé entre les deux étapes.
    const tables = baseDeDepart({ ancienEventId: 'deja-supprime' })

    const r = await syncCalendrier(creerSupabase(tables), PERIODE)

    // 404 n'est pas un échec : l'état visé est atteint.
    expect(r.errors).toEqual([])
    expect(tables.gardes.find((g) => g.id === 'g-semaine')?.google_event_id).toBeNull()
    expect(google.evenements.size).toBe(8)
  })

  it('un ancien événement qui RÉSISTE garde son identifiant, pour être retenté', async () => {
    const tables = baseDeDepart({ ancienEventId: 'ancien-bloque' })
    google.evenements.set('ancien-bloque', { titre: 'bloc', jour: '2026-09-29' })
    google.indelebiles.add('ancien-bloque')

    const r = await syncCalendrier(creerSupabase(tables), PERIODE)

    // Effacer l'identifiant abandonnerait l'événement dans l'agenda de la
    // cliente, sans plus aucun moyen de le retrouver depuis le logiciel.
    expect(tables.gardes.find((g) => g.id === 'g-semaine')?.google_event_id).toBe('ancien-bloque')
    expect(r.errors.join(' ')).toContain('ancien-bloque')
  })
})

describe('B-079 — les garde-fous qui ne doivent pas bouger', () => {
  it('⚠️ UN BROUILLON NE SORT PAS DU LOGICIEL (38 événements chez la cliente)', async () => {
    const tables = baseDeDepart({ publie: false })
    const r = await syncCalendrier(creerSupabase(tables), PERIODE)

    expect(r.skipped).toBe(true)
    expect(r.raison).toContain('publié')
    // Le critère est `publie_at`, et rien n'est écrit nulle part.
    expect(google.evenements.size).toBe(0)
    expect(tables.garde_evenements).toHaveLength(0)
  })

  it('les deux sources d’identifiants sont rendues : sinon, des orphelins', async () => {
    const tables = baseDeDepart({ ancienEventId: 'ancien-bloc' })
    google.evenements.set('ancien-bloc', { titre: 'bloc', jour: '2026-09-29' })
    const supabase = creerSupabase(tables)

    // Avant synchro : seul l'ancien format existe.
    expect(await idsEvenementsDePeriode(supabase, PERIODE)).toEqual(['ancien-bloc'])

    await syncCalendrier(supabase, PERIODE)

    // Après : les 8 nouveaux. N'en lire qu'une source laisserait dans l'agenda
    // des gardes que plus rien dans le logiciel ne peut retirer.
    const ids = await idsEvenementsDePeriode(supabase, PERIODE)
    expect(ids).toHaveLength(8)
    expect(new Set(ids)).toEqual(new Set(google.evenements.keys()))
  })
})
