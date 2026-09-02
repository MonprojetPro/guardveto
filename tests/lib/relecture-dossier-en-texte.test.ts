// ============================================================
// B-096 — CE QUE FILOU LIT VRAIMENT
// ============================================================
// Tous les autres tests de ce chantier vérifient qu'on CALCULE les bonnes
// choses : les mouvements légaux, leur effet, les préférences enfreintes.
// Aucun ne vérifie qu'elles arrivent jusqu'au texte que le modèle reçoit.
//
// C'est pourtant le seul endroit où le chantier peut échouer en silence. Un
// champ ajouté au dossier mais oublié dans `dossierEnTexte` compile, passe le
// lint, et ne change RIEN au comportement de Filou — on croirait avoir livré.
// C'est la forme exacte du défaut B-022a : un correctif écrit dans un code que
// rien n'atteint, qui a traversé tout le pipeline sans déclencher une alarme.
// ============================================================

import { describe, it, expect } from 'vitest'
import { dossierEnTexte, type DossierRelecture } from '@/lib/ia/relecturePlanning'

function dossier(partiel: Partial<DossierRelecture> = {}): DossierRelecture {
  return {
    periode: 'du 19 octobre au 10 janvier',
    saison: 'hiver',
    places: [
      {
        date: '2026-10-24', jour: 'samedi 24 octobre', creneau: 'week-end',
        type: 'weekend', role: 'premier', prenom: 'Victor', vetId: 'v-victor',
        remplacants: [],
      },
    ],
    equipe: [
      {
        vetId: 'v-victor', prenom: 'Victor',
        gardesPeriode: { total: 23, weekends: 4, premierWeekend: 2 },
        absences: [], regles: [],
      },
    ],
    reglesCabinet: [],
    roleAvantageFinancier: 'premier',
    preferencesEnfreintes: [],
    mouvements: [],
    mouvementsEcartes: 0,
    ...partiel,
  }
}

describe('dossierEnTexte — les préférences enfreintes', () => {
  it('les écrit, avec leur phrase telle quelle', () => {
    const texte = dossierEnTexte(dossier({
      preferencesEnfreintes: [
        'Antoine fait un week-end le 21/11, à 14 jours du précédent (07/11) — moins de 3 semaines',
      ],
    }))
    expect(texte).toContain('Antoine fait un week-end le 21/11')
    expect(texte).toContain('PRÉFÉRENCES')
  })

  it('dit explicitement « aucune » quand il n’y en a pas', () => {
    // Le silence est le piège de ce produit : une section absente se lirait
    // « rien à signaler », et personne ne va vérifier une bonne nouvelle.
    expect(dossierEnTexte(dossier())).toContain('Aucune')
  })
})

describe('dossierEnTexte — les mouvements et leur effet', () => {
  const mouvement = (effet: 'ameliore' | 'egal' | 'degrade', resume: string) => ({
    resume,
    lignes: ['samedi 24 octobre · week-end · premier : Victor → Antoine'],
    effet,
    surQuoi: effet === 'egal' ? undefined : 'un déséquilibre important entre les personnes',
    affectations: [
      { date: '2026-10-24', type: 'weekend', role: 'premier', vetId: 'v-antoine' },
    ],
  })

  it('écrit l’effet de chaque mouvement, en toutes lettres', () => {
    const texte = dossierEnTexte(dossier({
      mouvements: [mouvement('ameliore', 'Victor et Antoine échangent leurs rôles')],
    }))
    expect(texte).toContain('AMÉLIORE')
    expect(texte).toContain('un déséquilibre important entre les personnes')
  })

  it('met les mouvements qui AMÉLIORENT en premier', () => {
    // Sans ce tri, Filou pioche au hasard dans une liste où tout se ressemble.
    // L'ordre n'est pas cosmétique : c'est la moitié de l'information.
    const texte = dossierEnTexte(dossier({
      mouvements: [
        mouvement('degrade', 'Un mouvement qui aggrave'),
        mouvement('egal', 'Un mouvement neutre'),
        mouvement('ameliore', 'Un mouvement qui répare'),
      ],
    }))
    expect(texte.indexOf('Un mouvement qui répare'))
      .toBeLessThan(texte.indexOf('Un mouvement neutre'))
    expect(texte.indexOf('Un mouvement neutre'))
      .toBeLessThan(texte.indexOf('Un mouvement qui aggrave'))
  })

  it('donne les coordonnées machine de CHAQUE place du mouvement', () => {
    // Un mouvement est un tout : si Filou en recopie une place sur deux,
    // l'arbitrage refuse et on retombe sur « pas de correction automatique ».
    const texte = dossierEnTexte(dossier({
      mouvements: [{
        resume: 'Victor et Antoine échangent leurs week-ends',
        lignes: [],
        effet: 'ameliore',
        affectations: [
          { date: '2026-10-24', type: 'weekend', role: 'premier', vetId: 'v-antoine' },
          { date: '2026-10-23', type: 'vendredi_soir', role: 'second', vetId: 'v-antoine' },
        ],
      }],
    }))
    expect(texte).toContain('date=2026-10-24 type=weekend role=premier vetId=v-antoine')
    expect(texte).toContain('date=2026-10-23 type=vendredi_soir role=second vetId=v-antoine')
    expect(texte).toContain('en omettre une place le fait refuser')
  })

  it('DIT combien de mouvements ont été écartés de la liste', () => {
    // La liste est bornée (3012 mouvements bruts mesurés sur une période
    // d'hiver complète). Une troncature silencieuse se lirait « voilà tout ce
    // qui est possible », et Filou conclurait qu'il n'y a rien d'autre à faire
    // — exactement le silence que tout ce dossier existe pour empêcher.
    const texte = dossierEnTexte(dossier({
      mouvements: [mouvement('ameliore', 'A')],
      mouvementsEcartes: 2612,
    }))
    expect(texte).toContain('2612 autres mouvements légaux ne sont PAS listés')
    expect(texte).toContain('je n’ai pas trouvé')
  })

  it('n’en parle pas quand rien n’a été écarté', () => {
    const texte = dossierEnTexte(dossier({ mouvements: [mouvement('ameliore', 'A')] }))
    expect(texte).not.toContain('ne sont PAS listés')
  })

  it('annonce combien de mouvements améliorent, ou dit qu’il n’y en a aucun', () => {
    const avec = dossierEnTexte(dossier({
      mouvements: [mouvement('ameliore', 'A'), mouvement('degrade', 'B')],
    }))
    expect(avec).toContain('1 mouvement(s) AMÉLIORENT')

    const sans = dossierEnTexte(dossier({ mouvements: [mouvement('degrade', 'B')] }))
    expect(sans).toContain('Aucun mouvement n’améliore')
  })
})
