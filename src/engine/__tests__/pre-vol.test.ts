// ============================================================
// Tests — Pré-vol de cohérence des règles (backlog n°23)
// ============================================================
// Contrat testé :
//   • cas SAIN → tableau vide (silence absolu, aucun bruit) ;
//   • règle d'un véto SORTI → détectée (règle fantôme) ;
//   • duo interdit dont le partenaire est sorti → détecté ;
//   • contradiction arithmétique (« au plus 0 garde ») → véto jamais disponible ;
//   • congé couvrant toute la période → véto jamais disponible (flavor congé) ;
//   • espacement week-end impossible vu le nombre de week-ends/vétos → détecté ;
//   • limites de charge < places à pourvoir → détecté ;
//   • créneau exigeant N vétos distincts avec < N candidats → détecté.
// Mêmes fixtures/période que diagnostic-impasse.test.ts (vocabulaire commun).

import { describe, it, expect } from 'vitest'
import { preVolRegles, type PreVolInput, type VetAnnuaire } from '../pre-vol'
import type { VetEngine, ContrainteEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-30'   // dimanche (4 semaines pleines, 4 week-ends)

function vet(id: string, prenom: string, extra?: Partial<VetEngine>): VetEngine {
  return {
    id,
    nom: prenom.toUpperCase(),
    prenom,
    statut: 'associe',
    dernier_recours: false,
    contraintes: [],
    conges: [],
    ...extra,
  }
}

/** Contrainte au format V2 (params sous config.params, force à la racine). */
function contrainte(
  id: string,
  type: ContrainteEngine['type'],
  brique: string,
  params: Record<string, unknown>,
  force = 2, // dur par défaut
): ContrainteEngine {
  return { id, type, config: { force, brique, params }, actif: true }
}

function baseInput(vets: VetEngine[], extra?: Partial<PreVolInput>): PreVolInput {
  return {
    vets,
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver',
    ...extra,
  }
}

describe('preVolRegles — silence sur configuration saine', () => {
  it('ne détecte RIEN pour un effectif sain sans règle contradictoire', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Chloé'), vet('v4', 'David')]
    expect(preVolRegles(baseInput(vets))).toEqual([])
  })

  it('reste silencieux avec des règles de charge LARGES (pas de faux positif)', () => {
    const vets = [
      vet('v1', 'Alice', {
        contraintes: [contrainte('c1', 'au_plus_n', 'au_plus_n', { n: 3, fenetre: 'semaine_civile' })],
      }),
      vet('v2', 'Bob'),
      vet('v3', 'Chloé'),
      vet('v4', 'David'),
    ]
    expect(preVolRegles(baseInput(vets))).toEqual([])
  })
})

describe('preVolRegles — (b) règles fantômes (véto sorti)', () => {
  it('détecte une règle active dont le propriétaire est SORTI de l’effectif', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Chloé'), vet('v4', 'David')]
    const annuaire: VetAnnuaire[] = [
      { id: 'v1', prenom: 'Alice', nom: 'ALICE', actif: true },
      { id: 'v2', prenom: 'Bob', nom: 'BOB', actif: true },
      { id: 'v3', prenom: 'Chloé', nom: 'CHLOÉ', actif: true },
      { id: 'v4', prenom: 'David', nom: 'DAVID', actif: true },
      { id: 'v-sortie', prenom: 'Léa', nom: 'MARTIN', actif: false },
    ]
    const contraintesParVet = new Map([
      ['v-sortie', [contrainte('c9', 'jour_repos_fixe', 'interdire_creneau', { jour: 'mercredi' })]],
    ])

    const out = preVolRegles(baseInput(vets, { annuaire, contraintesParVet }))
    const fantome = out.find((a) => a.code === 'regle_veto_sorti')
    expect(fantome).toBeDefined()
    expect(fantome!.message).toContain('Léa')
    expect(fantome!.message).toContain('ne fait plus partie')
    // Le nom de la règle en clair (formulation catalogue), pas du jargon.
    expect(fantome!.regles[0]).toContain('Léa')
    expect(fantome!.regles[0]).toContain('mercredi')
    // Et RIEN d'autre : les vétos actifs sains ne déclenchent rien.
    expect(out).toHaveLength(1)
  })

  it('ignore les règles fantômes INACTIVES (pas de bruit)', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Chloé')]
    const c = contrainte('c9', 'jour_repos_fixe', 'interdire_creneau', { jour: 'mercredi' })
    c.actif = false
    const contraintesParVet = new Map([['v-sortie', [c]]])
    const out = preVolRegles(baseInput(vets, { contraintesParVet }))
    expect(out.filter((a) => a.code === 'regle_veto_sorti')).toEqual([])
  })

  it('détecte un duo interdit dont le PARTENAIRE est sorti', () => {
    const vets = [
      vet('v1', 'Alice', {
        contraintes: [contrainte('c6', 'duo_interdit', 'duo_interdit', { avec_veterinaire_id: 'v-sortie' })],
      }),
      vet('v2', 'Bob'),
      vet('v3', 'Chloé'),
    ]
    const annuaire: VetAnnuaire[] = [
      { id: 'v1', prenom: 'Alice', nom: 'ALICE', actif: true },
      { id: 'v2', prenom: 'Bob', nom: 'BOB', actif: true },
      { id: 'v3', prenom: 'Chloé', nom: 'CHLOÉ', actif: true },
      { id: 'v-sortie', prenom: 'Léa', nom: 'MARTIN', actif: false },
    ]
    const out = preVolRegles(baseInput(vets, { annuaire }))
    const duo = out.find((a) => a.code === 'duo_veto_sorti')
    expect(duo).toBeDefined()
    expect(duo!.message).toContain('Alice')
    expect(duo!.message).toContain('Léa')
    expect(duo!.message).toContain('plus aucun effet')
  })
})

describe('preVolRegles — (a) contradictions arithmétiques certaines', () => {
  it('« au plus 0 garde » (dur) → le véto ne peut recevoir AUCUNE garde', () => {
    const vets = [
      vet('v1', 'Alice', {
        contraintes: [contrainte('c0', 'au_plus_n', 'au_plus_n', { n: 0, fenetre: 'semaine_civile' })],
      }),
      vet('v2', 'Bob'),
      vet('v3', 'Chloé'),
      vet('v4', 'David'),
    ]
    const out = preVolRegles(baseInput(vets))
    const jamais = out.find((a) => a.code === 'veto_jamais_disponible')
    expect(jamais).toBeDefined()
    expect(jamais!.message).toContain('Alice')
    // La règle en cause est nommée en clair (formulation catalogue).
    expect(jamais!.regles.some((r) => r.includes('au plus 0'))).toBe(true)
  })

  it('congé couvrant toute la période → véto jamais disponible (message congé)', () => {
    const vets = [
      vet('v1', 'Alice'),
      vet('v2', 'Bob', {
        conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }],
      }),
      vet('v3', 'Chloé'),
      vet('v4', 'David'),
    ]
    const out = preVolRegles(baseInput(vets))
    const jamais = out.find((a) => a.code === 'veto_jamais_disponible')
    expect(jamais).toBeDefined()
    expect(jamais!.message).toContain('Bob')
    expect(jamais!.message).toContain('congé')
  })

  it('espacement week-end impossible (tous « 1 WE sur 4 », 4 WE à 2 places, 2 vétos)', () => {
    const espacement = () =>
      contrainte('cwe', 'espacement_weekend', 'espacement_weekend', { n_semaines: 4 })
    const vets = [
      vet('v1', 'Alice', { contraintes: [espacement()] }),
      vet('v2', 'Bob', { contraintes: [espacement()] }),
    ]
    const out = preVolRegles(baseInput(vets))
    const we = out.find((a) => a.code === 'weekends_insuffisants')
    expect(we).toBeDefined()
    // 4 WE × 2 places = 8 à pourvoir ; caps ceil(4/4) = 1 chacun → 2 au total.
    expect(we!.message).toContain('8')
    expect(we!.message).toContain('2')
    expect(we!.regles.some((r) => r.includes('week-end sur 4'))).toBe(true)
  })

  it('limites de charge globales < places à pourvoir → détecté', () => {
    // 1 semaine (12 places en hiver), 2 vétos limités à 1 garde/semaine → 2 < 12.
    const limite = () =>
      contrainte('cn', 'au_plus_n', 'au_plus_n', { n: 1, fenetre: 'semaine_civile' })
    const vets = [
      vet('v1', 'Alice', { contraintes: [limite()] }),
      vet('v2', 'Bob', { contraintes: [limite()] }),
    ]
    const out = preVolRegles(baseInput(vets, { dateFin: '2025-11-09' }))
    const charge = out.find((a) => a.code === 'charge_globale_insuffisante')
    expect(charge).toBeDefined()
    expect(charge!.message).toContain('12')
    expect(charge!.regles.length).toBeGreaterThan(0)
  })

  it('créneau à 2 vétos distincts avec un seul candidat → créneau impossible', () => {
    // Le scénario du diagnostic d'impasse, détecté AVANT génération : 2 vétos
    // dont 1 en congé toute la période → week-end/vendredi soir infaisables.
    const vets = [
      vet('v1', 'Alice'),
      vet('v2', 'Bob', {
        conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }],
      }),
    ]
    const out = preVolRegles(baseInput(vets))
    const impossibles = out.filter((a) => a.code === 'creneau_impossible')
    expect(impossibles.length).toBeGreaterThan(0)
    // Le week-end (2 vétos distincts requis) est forcément dedans.
    expect(impossibles.some((a) => a.message.includes('week-end'))).toBe(true)
    // Message compréhensible : dates en français, pas de code technique.
    expect(impossibles[0].message).toMatch(/novembre/)
    expect(impossibles[0].message).not.toMatch(/R\d+ :/)
  })

  it('les règles MOLLES (étage ≥ 3) ne déclenchent AUCUN avertissement de charge', () => {
    const vets = [
      vet('v1', 'Alice', {
        contraintes: [contrainte('c0', 'au_plus_n', 'au_plus_n', { n: 0, fenetre: 'semaine_civile' }, 4)],
      }),
      vet('v2', 'Bob'),
      vet('v3', 'Chloé'),
      vet('v4', 'David'),
    ]
    expect(preVolRegles(baseInput(vets))).toEqual([])
  })
})
