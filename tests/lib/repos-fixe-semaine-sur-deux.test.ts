// ============================================================
// Un repos « une semaine sur deux » saisi à l'écran est-il APPLIQUÉ ?
// ============================================================
// LA DEMANDE — MiKL, le 2026-08-26 : pouvoir poser « repos le jeudi, mais une
// semaine sur deux ». L'écran savait dire « repos le jeudi » (toutes les
// semaines) ou « indisponible les semaines impaires » (tous les soirs), jamais
// le croisement des deux.
//
// CE QUE CE TEST GARDE — le raccord, et rien d'autre. L'évaluation existait
// déjà des deux côtés : `violeReposFixe` (moteur) et `validerPlanning`
// (validateur) lisent la forme « tableau de règles » depuis l'origine, parce
// que c'est sous cette forme qu'est stockée la règle héritée du cabinet
// pilote. Ce qui manquait, c'était uniquement de pouvoir l'ÉCRIRE.
//
// Le risque est donc précis : que le formulaire enregistre une forme que les
// gardiens ne reconnaissent pas. La règle s'afficherait proprement dans la
// liste, l'admin la croirait posée, et le planning l'ignorerait — sans une
// seule erreur nulle part. C'est le défaut que ce projet connaît par cœur :
// `periode: 'apres_midi'` a été affiché des mois durant sans jamais être
// évalué.
//
// On part donc de la SORTIE RÉELLE du constructeur du formulaire
// (`construireParams`), jamais d'un objet écrit à la main pour l'occasion : un
// test qui fabrique lui-même la forme attendue ne prouve que sa propre
// cohérence.
//
// Aucune connexion réseau : tout est pur.
// ============================================================

import { describe, expect, it } from 'vitest'
import { construireParams } from '@/lib/regles/paramsRegle'
import { rendreRegle } from '@/engine/briques/catalogue'
import { isValid } from '@/engine/rules/hard-constraints'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine } from '@/engine/types'

/** Ce que le formulaire envoie quand on choisit « jeudi, semaines impaires ». */
function paramsDepuisEcran(semaine: string, exVac = false) {
  return construireParams(
    {
      brique_id: 'interdire_creneau',
      owner_id: 'vet-1',
      force: 'jamais',
      jour: 'jeudi',
      semaine,
      exception_vacances_scolaires: exVac,
    },
    new Set(['semaine', 'weekend']),
  )
}

describe('Repos fixe une semaine sur deux (B-038)', () => {
  it('écrit la forme que les gardiens savent lire', () => {
    const sortie = paramsDepuisEcran('impaire')
    expect('error' in sortie, `construireParams a refusé : ${JSON.stringify(sortie)}`).toBe(false)
    if ('error' in sortie) return

    // La forme « tableau de règles » — la SEULE que `violeReposFixe` et
    // `validerPlanning` évaluent avec une parité. Une forme simple portant un
    // champ `semaine` s'enregistrerait sans erreur et ne serait jamais appliquée.
    const regles = sortie.params.regles as Array<Record<string, unknown>>
    expect(Array.isArray(regles), 'La parité doit produire un tableau `regles`.').toBe(true)
    expect(regles).toHaveLength(1)
    expect(regles[0].jour).toBe('jeudi')
    // Au SINGULIER. `semaines: 'impaires'` appartient à une autre règle et ne
    // serait lu par personne ici.
    expect(regles[0].semaine).toBe('impaire')
  })

  it('laisse « toutes les semaines » strictement inchangé', () => {
    // Non-régression : les règles existantes ne doivent pas changer de forme.
    // Un basculement silencieux vers le tableau ferait perdre l'exception
    // vacances, que seule la forme simple porte.
    const sortie = paramsDepuisEcran('toutes', true)
    if ('error' in sortie) throw new Error(sortie.error)
    expect(sortie.params.jour).toBe('jeudi')
    expect(sortie.params.regles).toBeUndefined()
    expect(sortie.params.exception_vacances_scolaires).toBe(true)
  })

  it('refuse « sauf vacances » avec une parité, au lieu de l’ignorer', () => {
    // Les gardiens ne lisent l'exception vacances que sur la forme simple.
    // L'accepter ici afficherait un assouplissement jamais appliqué. Un refus
    // se lit ; une case sans effet ne se voit pas.
    const sortie = paramsDepuisEcran('impaire', true)
    expect('error' in sortie).toBe(true)
  })

  it('refuse une parité inventée', () => {
    const sortie = paramsDepuisEcran('impaires') // pluriel = l'autre règle
    expect(
      'error' in sortie,
      'Le pluriel « impaires » appartient à l’alternance : accepté ici, il ' +
        'produirait une règle que personne n’applique.',
    ).toBe(true)
  })

  it('se dit en français, au singulier', () => {
    const sortie = paramsDepuisEcran('impaire')
    if ('error' in sortie) throw new Error(sortie.error)
    const phrase = rendreRegle('interdire_creneau', sortie.params)
    // Ce que l'admin lit dans la liste des règles. « a des repos fixes : jeudi
    // (semaines impaires) » se lisait comme une énumération amputée.
    expect(phrase).toContain('jeudi')
    expect(phrase).toContain('impaire')
    expect(phrase).not.toContain('a des repos fixes')
  })
})

// ── L'effet, pas seulement la forme ──────────────────────────────────────
// Les quatre épreuves ci-dessus prouvent que le formulaire écrit la bonne
// structure. Elles ne prouvent PAS que le planning la respecte — et c'est la
// seule chose qui intéresse le cabinet. On rejoue donc la règle telle qu'elle
// sort de l'écran contre le gardien du moteur, sur deux jeudis consécutifs.
//
// 2026-01-08 est un jeudi en semaine ISO 2 (paire) ;
// 2026-01-15 est un jeudi en semaine ISO 3 (impaire).
// Aucune ancre n'est posée par le formulaire : la parité est celle du numéro
// de semaine du calendrier, vérifiable sur n'importe quel agenda.
const JEUDI_PAIRE = '2026-01-08'
const JEUDI_IMPAIRE = '2026-01-15'

function vetAvecReposSaisi(semaine: string) {
  const sortie = construireParams(
    {
      brique_id: 'interdire_creneau',
      owner_id: 'v',
      force: 'jamais',
      jour: 'jeudi',
      semaine,
      exception_vacances_scolaires: false,
    },
    new Set(['semaine', 'weekend']),
  )
  if ('error' in sortie) throw new Error(sortie.error)

  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [
      {
        id: 'r1',
        type: 'jour_repos_fixe',
        actif: true,
        // `force: 2` = interdiction ferme, l'étage que le formulaire pose pour
        // « jamais ». Les params sont ceux que l'écran vient de produire, pas
        // une reconstitution.
        config: { brique: 'interdire_creneau', force: 2, params: sortie.params, ...sortie.params },
      } as ContrainteEngine,
    ],
  }
  return normaliserContraintesVets([v])[0]
}

const slotJeudi = (date: string): SlotGarde => ({
  date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false,
})
const planningVide: PlanningPartiel = { attributions: [] }

describe('Repos une semaine sur deux — ce que le MOTEUR en fait', () => {
  it('refuse le jeudi d’une semaine impaire', () => {
    const v = vetAvecReposSaisi('impaire')
    const r = isValid(slotJeudi(JEUDI_IMPAIRE), v, 'premier', [v], planningVide)
    expect(
      r.valid,
      'La règle est saisie « jeudi, semaines impaires » et le moteur accepte ' +
        'quand même : elle serait affichée dans la liste sans jamais agir.',
    ).toBe(false)
  })

  it('accepte le jeudi d’une semaine paire — c’est tout l’intérêt', () => {
    const v = vetAvecReposSaisi('impaire')
    expect(
      isValid(slotJeudi(JEUDI_PAIRE), v, 'premier', [v], planningVide).valid,
      'Le moteur refuse aussi les semaines paires : la parité est ignoree et ' +
        'la regle se comporte comme un repos de toutes les semaines.',
    ).toBe(true)
  })

  it('sans parité, refuse les DEUX jeudis (non-régression)', () => {
    const v = vetAvecReposSaisi('toutes')
    expect(isValid(slotJeudi(JEUDI_PAIRE), v, 'premier', [v], planningVide).valid).toBe(false)
    expect(isValid(slotJeudi(JEUDI_IMPAIRE), v, 'premier', [v], planningVide).valid).toBe(false)
  })
})

// ── Plusieurs jours dans une seule regle (B-041) ─────────────────────────
// « lundi ET mardi, semaines paires ». Filou n'en avait retenu qu'un, et sans
// le dire — parce qu'il ne peut proposer qu'une regle par reponse et qu'une
// regle ne portait qu'un jour. Les gardiens, eux, bouclent sur les entrees
// depuis l'origine : la limite etait dans la SAISIE, nulle part ailleurs.
describe('Plusieurs jours de repos dans une seule regle (B-041)', () => {
  function paramsMulti(jours: string[], semaine = 'toutes') {
    return construireParams(
      {
        brique_id: 'interdire_creneau',
        owner_id: 'v',
        force: 'jamais',
        jours,
        semaine,
        exception_vacances_scolaires: false,
      },
      new Set(['semaine', 'weekend']),
    )
  }

  it('ecrit une entree par jour demande', () => {
    const sortie = paramsMulti(['lundi', 'mardi'], 'paire')
    if ('error' in sortie) throw new Error(sortie.error)
    const regles = sortie.params.regles as Array<Record<string, unknown>>
    expect(regles).toHaveLength(2)
    expect(regles.map((r) => r.jour)).toEqual(['lundi', 'mardi'])
    expect(regles.every((r) => r.semaine === 'paire')).toBe(true)
  })

  it('passe en tableau meme SANS parite des lors qu il y a deux jours', () => {
    // Sinon le second jour serait perdu : la forme simple ne porte qu'un `jour`.
    const sortie = paramsMulti(['lundi', 'mardi'])
    if ('error' in sortie) throw new Error(sortie.error)
    const regles = sortie.params.regles as Array<Record<string, unknown>>
    expect(regles).toHaveLength(2)
    // Pas de cle `semaine` parasite : elle laisserait croire, en relisant la
    // base, qu'une parite a ete choisie.
    expect(regles.every((r) => r.semaine === undefined)).toBe(true)
  })

  it('refuse une liste vide plutot que de deviner un jour', () => {
    const sortie = paramsMulti([])
    expect('error' in sortie).toBe(true)
  })

  it('le MOTEUR refuse les deux jours, pas seulement le premier', () => {
    // L'epreuve qui compte. Un bug qui ne garderait que la premiere entree
    // passerait toutes les verifications de forme ci-dessus.
    const sortie = paramsMulti(['lundi', 'mardi'], 'paire')
    if ('error' in sortie) throw new Error(sortie.error)

    const v: VetEngine = {
      id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
      conges: [],
      contraintes: [
        {
          id: 'r1', type: 'jour_repos_fixe', actif: true,
          config: { brique: 'interdire_creneau', force: 2, params: sortie.params, ...sortie.params },
        } as ContrainteEngine,
      ],
    }
    const vet = normaliserContraintesVets([v])[0]
    const planning: PlanningPartiel = { attributions: [] }

    // 2026-01-05 lundi et 2026-01-06 mardi — semaine ISO 2, paire.
    const lundiPair = { date: '2026-01-05', type: 'semaine_soir', saison: 'hiver', besoinSecond: false } as SlotGarde
    const mardiPair = { date: '2026-01-06', type: 'semaine_soir', saison: 'hiver', besoinSecond: false } as SlotGarde

    expect(isValid(lundiPair, vet, 'premier', [vet], planning).valid).toBe(false)
    expect(
      isValid(mardiPair, vet, 'premier', [vet], planning).valid,
      'Le mardi passe : seule la premiere entree de la regle est evaluee — ' +
        'exactement le defaut que B-041 corrige.',
    ).toBe(false)
  })

  it('se dit en francais sans repeter la parite derriere chaque jour', () => {
    const sortie = paramsMulti(['lundi', 'mardi'], 'paire')
    if ('error' in sortie) throw new Error(sortie.error)
    const phrase = rendreRegle('interdire_creneau', sortie.params)
    // « la nuit du lundi et du mardi » depuis B-044 : une garde de semaine est
    // une nuit, pas un jour. C'est ce qui prete a confusion sur ce metier — la
    // garde du lundi court jusqu'au mardi matin.
    expect(phrase).toContain('nuit du lundi et du mardi')
    // Une seule mention de la parite, factorisee.
    expect(phrase.match(/semaines paires/g)).toHaveLength(1)
  })
})
