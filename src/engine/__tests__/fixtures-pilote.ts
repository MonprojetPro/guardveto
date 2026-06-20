// ============================================================
// GUARDVETO — Fixtures du cabinet pilote (vetovaldallie)
// ============================================================
// Snapshot FIDÈLE des 7 vétos + 10 contraintes réelles du pilote,
// lues depuis la base MPP (cabinet 00000000-...-0001) le 2026-06-19.
//
// Rôle : socle du golden test (golden-pilote.test.ts) et base du test
// d'équivalence de P1A-004 (mapping regles_cabinet → ContrainteEngine
// doit reproduire EXACTEMENT ces ContrainteEngine).
//
// Le `config` de chaque contrainte est au format brique v2 produit par
// F4-002 ({ axes, force, brique, params }), càd EXACTEMENT ce que le
// loader fournit aujourd'hui au solver depuis contraintes_veto.
// ============================================================

import type { VetEngine, ContrainteEngine, CalendrierResolu } from '../types'

// ── Identifiants vétos (pilote) ──────────────────────────
export const VET = {
  anneSophie: '00000000-0000-0000-0000-000000000001', // Blanchard — associée
  fanny: '00000000-0000-0000-0000-000000000002',      // Altieri — associée
  jean: '00000000-0000-0000-0000-000000000003',       // De Thoisy — associé
  anneCat: '00000000-0000-0000-0000-000000000004',    // Bernard — associée, DERNIER RECOURS
  manon: '00000000-0000-0000-0000-000000000005',      // Renaud — salariée
  antoine: '00000000-0000-0000-0000-000000000006',    // Lafarge — salarié
  victor: '00000000-0000-0000-0000-000000000007',     // Coelho — salarié
} as const

// ── Les 10 contraintes réelles (format brique v2) ────────
// P1-B (2026-06-20) : toutes en `force: 2` (DUR). La migration P1A avait
// hérité d'étages 3/4 (« préférence ») pour les repos, mais le métier
// (docs/regles-metier-gardes.md) dit que ce sont de VRAIS jours off → durs.
// Correction appliquée aussi en base (migration p1b_corriger_forces).
const C = {
  // Antoine ↔ Manon : duo interdit (R6, force 2 = jamais)
  antoineDuoManon: {
    id: 'cdbe6498-44d8-4a11-bbcf-7a522bc3f937',
    type: 'duo_interdit' as const,
    actif: true,
    config: { axes: {}, force: 2, brique: 'duo_interdit',
      params: { description: 'Antoine et Manon ne peuvent pas etre seuls', avec_veterinaire_id: VET.manon } },
  },
  manonDuoAntoine: {
    id: '412726e2-3b00-41ed-bd45-adff3c052118',
    type: 'duo_interdit' as const,
    actif: true,
    config: { axes: {}, force: 2, brique: 'duo_interdit',
      params: { description: 'Manon et Antoine ne peuvent pas etre seuls', avec_veterinaire_id: VET.antoine } },
  },
  // Anne-Sophie : indispo cyclique semaines impaires (R2, force 3)
  anneSoCyclique: {
    id: '95c6f138-2835-4bc6-8d76-bb91c6b11894',
    type: 'indisponibilite_cyclique' as const,
    actif: true,
    config: { axes: { quand: 'soir_semaine' }, force: 2, brique: 'alternance_ancre',
      params: { ancre: '2026-09-01', periodes: ['soir_semaine', 'weekend'], semaines: 'impaires',
        description: 'Pas de garde soir semaine + weekend les semaines impaires' } },
  },
  // Repos conditionnels (R3/R5, force 3)
  manonReposCond: {
    id: '804cd035-7f51-44e2-9f56-0d6829e74f8f',
    type: 'jour_repos_conditionnel' as const,
    actif: true,
    config: { axes: {}, force: 2, brique: 'repos_conditionnel',
      params: { sinon: 'vendredi', description: 'Jeudi si garde WE, Vendredi sinon', si_garde_we: 'jeudi' } },
  },
  jeanReposCond: {
    id: 'ad1dba16-060b-45d5-937c-040d1c645474',
    type: 'jour_repos_conditionnel' as const,
    actif: true,
    config: { axes: {}, force: 2, brique: 'repos_conditionnel',
      params: { sinon: 'vendredi', description: 'Vendredi repos sauf si garde WE alors mardi', si_garde_we: 'mardi' } },
  },
  antoineReposCond: {
    id: 'f1983ea7-569d-4d03-acb2-159b6a0f64a0',
    type: 'jour_repos_conditionnel' as const,
    actif: true,
    config: { axes: {}, force: 2, brique: 'repos_conditionnel',
      params: { sinon: 'vendredi', description: 'Jeudi si garde WE, Vendredi sinon', si_garde_we: 'jeudi' } },
  },
  victorReposCond: {
    id: '76352224-bc81-4996-b435-8fee694468e9',
    type: 'jour_repos_conditionnel' as const,
    actif: true,
    config: { axes: {}, force: 2, brique: 'repos_conditionnel',
      params: { sinon: 'vendredi', description: 'Jeudi si garde WE, Vendredi sinon', si_garde_we: 'jeudi' } },
  },
  // Repos fixes mercredi (R1, force 4 = evitee)
  fannyReposFixe: {
    id: 'af88fac6-0404-431f-9ea1-65c3ceceac0a',
    type: 'jour_repos_fixe' as const,
    actif: true,
    config: { axes: { quand: 'mercredi' }, force: 2, brique: 'interdire_creneau',
      params: { jour: 'mercredi', description: 'Mercredi repos fixe sauf vacances scolaires', exception_vacances_scolaires: true } },
  },
  anneCatReposFixe: {
    id: '5ada4d5f-17fd-4211-9f98-e64891aee7cb',
    type: 'jour_repos_fixe' as const,
    actif: true,
    config: { axes: { quand: 'mercredi' }, force: 2, brique: 'interdire_creneau',
      params: { jour: 'mercredi', periode: 'apres_midi', description: 'Mercredi apres-midi fixe + un autre demi-journee variable', repos_supplementaire_variable: true } },
  },
  anneSoReposFixe: {
    id: 'f961c313-1c9d-490e-891e-f7d6195a095f',
    type: 'jour_repos_fixe' as const,
    actif: true,
    config: { axes: { quand: null }, force: 2, brique: 'interdire_creneau',
      params: { regles: [
        { jour: 'jeudi', periode: 'apres_midi', semaine: 'impaire' },
        { jour: 'lundi', periode: 'apres_midi', semaine: 'paire' },
        { jour: 'mercredi', periode: 'journee', semaine: 'paire' },
      ], description: 'Jeudi AP semaines impaires + Lundi AP semaines paires + Mercredi semaines paires' } },
  },
} satisfies Record<string, ContrainteEngine>

/** Les 7 vétos du pilote avec leurs contraintes (congés vides). */
export const VETS_PILOTE: VetEngine[] = [
  { id: VET.fanny, nom: 'Altieri', prenom: 'Fanny', statut: 'associe', dernier_recours: false,
    contraintes: [C.fannyReposFixe], conges: [] },
  { id: VET.anneCat, nom: 'Bernard', prenom: 'Anne-Catherine', statut: 'associe', dernier_recours: true,
    contraintes: [C.anneCatReposFixe], conges: [] },
  { id: VET.anneSophie, nom: 'Blanchard', prenom: 'Anne-Sophie', statut: 'associe', dernier_recours: false,
    contraintes: [C.anneSoCyclique, C.anneSoReposFixe], conges: [] },
  { id: VET.victor, nom: 'Coelho', prenom: 'Victor', statut: 'salarie', dernier_recours: false,
    contraintes: [C.victorReposCond], conges: [] },
  { id: VET.jean, nom: 'De Thoisy', prenom: 'Jean', statut: 'associe', dernier_recours: false,
    contraintes: [C.jeanReposCond], conges: [] },
  { id: VET.antoine, nom: 'Lafarge', prenom: 'Antoine', statut: 'salarie', dernier_recours: false,
    contraintes: [C.antoineDuoManon, C.antoineReposCond], conges: [] },
  { id: VET.manon, nom: 'Renaud', prenom: 'Manon', statut: 'salarie', dernier_recours: false,
    contraintes: [C.manonDuoAntoine, C.manonReposCond], conges: [] },
]

/** Toutes les contraintes à plat (pour les comptages / tests d'équivalence). */
export const CONTRAINTES_PILOTE: ContrainteEngine[] = VETS_PILOTE.flatMap((v) => v.contraintes)

// ── Période de référence (hiver, 12 semaines) ────────────
export const PERIODE_PILOTE = {
  dateDebut: '2026-01-05', // lundi
  dateFin: '2026-03-29',   // dimanche (12 semaines)
  saison: 'hiver' as const,
}

/**
 * Calendrier EXPLICITE pour la reproductibilité du golden test (indépendant
 * des listes en dur de utils.ts). Vacances d'hiver zone A (plausibles) pour
 * détendre la contrainte « mercredi sauf vacances » de Fanny ; aucun férié
 * sur la fenêtre jan→mars 2026.
 */
export const CALENDRIER_PILOTE: CalendrierResolu = {
  feries: new Set<string>(),
  vacancesScolaires: [{ debut: '2026-02-07', fin: '2026-02-23' }],
}
