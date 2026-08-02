import { describe, it, expect } from 'vitest'
import { graviteAvertissement, type CodeAvertissementPreVol } from '@/engine/pre-vol'

// Les codes qui BARRENT la route : le moteur échouera à coup sûr, lancer la
// génération est une perte de temps garantie (décision MiKL du 2026-08-02).
const BLOQUANTS: CodeAvertissementPreVol[] = [
  'creneau_impossible',
  'charge_globale_insuffisante',
  'weekends_insuffisants',
  'composition_sans_porteur',
  'role_interdit_intenable',
  'seulement_avec_partenaire_sorti',
]

// Les codes qui laissent passer : la règle est inerte ou mal réglée, le
// planning sortira — simplement sans l'effet attendu.
const A_SURVEILLER: CodeAvertissementPreVol[] = [
  'regle_veto_sorti',
  'duo_veto_sorti',
  'veto_jamais_disponible',
  'sequence_inerte',
  'cohorte_equite_sans_porteur',
]

describe('graviteAvertissement', () => {
  it.each(BLOQUANTS)('« %s » barre la route', (code) => {
    expect(graviteAvertissement(code)).toBe('bloquant')
  })

  it.each(A_SURVEILLER)('« %s » laisse passer', (code) => {
    expect(graviteAvertissement(code)).toBe('surveiller')
  })

  it('couvre TOUS les codes existants — un code oublié doit se voir ici', () => {
    // Si le moteur ajoute un code sans le classer, il retomberait sur
    // « surveiller » en silence : une impasse certaine deviendrait un simple
    // avertissement, et l'admin lancerait une génération perdue d'avance.
    expect(new Set([...BLOQUANTS, ...A_SURVEILLER]).size).toBe(11)
  })

  it('classe un code inconnu du côté PRUDENT pour l’utilisateur', () => {
    // Prudent = on ne barre pas la route sur un code qu'on ne connaît pas :
    // bloquer à tort empêcherait de générer un planning parfaitement valide.
    expect(graviteAvertissement('code_qui_nexiste_pas' as CodeAvertissementPreVol))
      .toBe('surveiller')
  })
})
