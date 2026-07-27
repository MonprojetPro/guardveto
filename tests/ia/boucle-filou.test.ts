// ============================================================
// GUARDVETO — La boucle de Filou : la frontière lecture/écriture tenue
// ============================================================
// Ce que ces tests prouvent, et RIEN d'autre : `agentFilou.ts` dit dans ses
// propres commentaires que la frontière proposer/agir n'est décidée qu'à cet
// endroit, pour qu'elle ne puisse pas être contournée outil par outil.
// Jusqu'ici cette promesse ne tenait qu'à la lecture du code. Ici on la fige
// en comportement observable : un outil d'ÉCRITURE ne s'exécute JAMAIS
// pendant que le modèle réfléchit — seul `resumer()` tourne, `executer()`
// n'est appelé qu'après un clic humain que cette boucle ne simule jamais.
//
// Le SDK Anthropic est simulé : on pilote nous-mêmes ce que « le modèle »
// répond, tour par tour, et on observe avec des espions ce que la boucle fait
// des outils — sans jamais appeler le vrai Claude ni la vraie base.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { ContexteOutil, Outil, OutilEcriture, OutilLecture } from '@/lib/ia/outils/types'

// `vi.mock` est hissé au-dessus des imports : la fabrique ne peut référencer
// que des variables déclarées via `vi.hoisted`, jamais un `const` du haut de
// fichier — sinon « Cannot access before initialization ».
const { creerReponse } = vi.hoisted(() => ({ creerReponse: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  // `new Anthropic(...)` exige un constructeur : une fonction classique, pas
  // une flèche — sinon « is not a constructor ».
  default: vi.fn().mockImplementation(function AnthropicSimule() {
    return { messages: { create: creerReponse } }
  }),
}))

// Importé APRÈS le mock : c'est ce module qui construit `new Anthropic(...)`
// et doit donc voir la version simulée.
const { faireTravaillerFilou } = await import('@/lib/ia/agentFilou')

// ── Fabriques de réponses « modèle » ─────────────────────────

function blocTexte(text: string) {
  return { type: 'text', text } as Anthropic.TextBlock
}

function blocOutil(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input } as unknown as Anthropic.ToolUseBlock
}

/** Le modèle appelle un ou plusieurs outils, avec un mot d'accompagnement
 *  optionnel avant l'appel — exactement ce que la boucle sait recueillir. */
function reponseAvecOutils(blocs: ReturnType<typeof blocOutil>[], texte?: string) {
  return {
    content: texte ? [blocTexte(texte), ...blocs] : blocs,
    stop_reason: 'tool_use',
  } as unknown as Anthropic.Message
}

/** Le modèle conclut sans rien appeler. */
function reponseFinale(texte: string) {
  return { content: [blocTexte(texte)], stop_reason: 'end_turn' } as unknown as Anthropic.Message
}

// ── Fabriques d'outils factices ──────────────────────────────

const ParamsLecture = z.object({ question: z.string() })
const ParamsEcriture = z.object({ cible: z.string() })

function creerOutilLecture(
  overrides: Partial<OutilLecture<typeof ParamsLecture>> = {},
): OutilLecture<typeof ParamsLecture> {
  return {
    genre: 'lecture',
    nom: 'lecture_test',
    description: 'Outil de lecture factice, pour la boucle uniquement.',
    params: ParamsLecture,
    executer: vi.fn(async () => ({ reponse: 'donnée lue' })),
    ...overrides,
  }
}

function creerOutilEcriture(
  overrides: Partial<OutilEcriture<typeof ParamsEcriture>> = {},
): OutilEcriture<typeof ParamsEcriture> {
  return {
    genre: 'ecriture',
    nom: 'ecriture_test',
    description: 'Outil d’écriture factice, pour la boucle uniquement.',
    params: ParamsEcriture,
    resumer: vi.fn(async () => ({
      ok: true as const,
      proposition: { titre: 'Titre', phrase: 'Voici ce que je changerais.', action: 'Appliquer' },
      charge: { note: 'charge de test' },
    })),
    executer: vi.fn(async () => ({})),
    ...overrides,
  }
}

const CTX: ContexteOutil = {
  supabase: {} as ContexteOutil['supabase'],
  vetoId: 'veto-1',
  estAdmin: true,
  cabinetId: 'cabinet-1',
}

beforeEach(() => {
  creerReponse.mockReset()
})

describe('la boucle de Filou — frontière lecture/écriture', () => {
  it('un outil d’écriture n’est JAMAIS exécuté pendant la réflexion : seul resumer() tourne', async () => {
    const ecriture = creerOutilEcriture()
    creerReponse.mockResolvedValueOnce(
      reponseAvecOutils([blocOutil('appel-1', 'ecriture_test', { cible: 'Manon' })]),
    )

    const issue = await faireTravaillerFilou('fais X', [ecriture] as Outil[], CTX, '2026-07-27')

    expect(ecriture.resumer).toHaveBeenCalledTimes(1)
    expect(ecriture.executer).not.toHaveBeenCalled()
    expect(issue.genre).toBe('proposition')
    if (issue.genre === 'proposition') {
      expect(issue.outil).toBe('ecriture_test')
      expect(issue.params).toEqual({ cible: 'Manon' })
      expect(issue.charge).toEqual({ note: 'charge de test' })
    }
  })

  it('un outil de lecture s’exécute et son résultat repart vers le modèle, qui continue', async () => {
    const lecture = creerOutilLecture({
      executer: vi.fn(async () => ({ reponse: 'Manon est de garde mardi' })),
    })
    creerReponse
      .mockResolvedValueOnce(reponseAvecOutils([blocOutil('appel-1', 'lecture_test', { question: 'qui ?' })]))
      .mockResolvedValueOnce(reponseFinale('Manon est de garde mardi.'))

    const issue = await faireTravaillerFilou('qui est de garde ?', [lecture] as Outil[], CTX, '2026-07-27')

    expect(lecture.executer).toHaveBeenCalledTimes(1)
    expect(lecture.executer).toHaveBeenCalledWith({ question: 'qui ?' }, CTX)
    expect(creerReponse).toHaveBeenCalledTimes(2)

    // Le tour suivant doit bien contenir le résultat de la lecture, adressé
    // au bon appel d'outil — sinon le modèle répondrait à l'aveugle.
    const messagesDuTourSuivant = creerReponse.mock.calls[1][0].messages
    const dernierMessage = messagesDuTourSuivant.at(-1)
    expect(dernierMessage.role).toBe('user')
    expect(dernierMessage.content).toEqual([
      { type: 'tool_result', tool_use_id: 'appel-1', content: JSON.stringify({ reponse: 'Manon est de garde mardi' }) },
    ])

    expect(issue.genre).toBe('message')
    if (issue.genre === 'message') expect(issue.texte).toBe('Manon est de garde mardi.')
  })

  it('un outil inexistant ne fait pas planter la boucle : une erreur repart vers le modèle', async () => {
    creerReponse
      .mockResolvedValueOnce(reponseAvecOutils([blocOutil('appel-1', 'outil_qui_n_existe_pas', {})]))
      .mockResolvedValueOnce(reponseFinale('Je n’ai pas cette capacité.'))

    const issue = await faireTravaillerFilou('fais un truc impossible', [] as Outil[], CTX, '2026-07-27')

    expect(issue.genre).toBe('message')
    const messagesDuTourSuivant = creerReponse.mock.calls[1][0].messages
    const dernierMessage = messagesDuTourSuivant.at(-1)
    expect(dernierMessage.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'appel-1',
      is_error: true,
    })
    expect(dernierMessage.content[0].content).toContain("n'existe pas")
  })

  it('des paramètres qui ne respectent pas le schéma empêchent l’outil de s’exécuter', async () => {
    const lecture = creerOutilLecture()
    // `question` est requis par le schéma — le modèle l'omet.
    creerReponse
      .mockResolvedValueOnce(reponseAvecOutils([blocOutil('appel-1', 'lecture_test', {})]))
      .mockResolvedValueOnce(reponseFinale('Reformule ta question.'))

    const issue = await faireTravaillerFilou('?', [lecture] as Outil[], CTX, '2026-07-27')

    expect(lecture.executer).not.toHaveBeenCalled()
    expect(issue.genre).toBe('message')
    const messagesDuTourSuivant = creerReponse.mock.calls[1][0].messages
    const dernierMessage = messagesDuTourSuivant.at(-1)
    expect(dernierMessage.content[0].is_error).toBe(true)
    expect(dernierMessage.content[0].content).toContain('Paramètres invalides')
  })

  it('une lecture suivie d’une écriture : l’écriture arrête la boucle, et la lecture a bien eu lieu avant', async () => {
    const ordre: string[] = []
    const lecture = creerOutilLecture({
      executer: vi.fn(async () => {
        ordre.push('lecture')
        return { reponse: 'donnée lue' }
      }),
    })
    const ecriture = creerOutilEcriture({
      resumer: vi.fn(async () => {
        ordre.push('ecriture')
        return {
          ok: true as const,
          proposition: { titre: 'Titre', phrase: 'phrase', action: 'Appliquer' },
        }
      }),
    })

    creerReponse
      .mockResolvedValueOnce(reponseAvecOutils([blocOutil('appel-1', 'lecture_test', { question: 'q' })]))
      .mockResolvedValueOnce(reponseAvecOutils([blocOutil('appel-2', 'ecriture_test', { cible: 'Manon' })]))

    const issue = await faireTravaillerFilou('lis puis change', [lecture, ecriture] as Outil[], CTX, '2026-07-27')

    expect(ordre).toEqual(['lecture', 'ecriture'])
    expect(ecriture.executer).not.toHaveBeenCalled()
    expect(issue.genre).toBe('proposition')
    // La boucle s'est arrêtée dès l'écriture : pas de 3e tour.
    expect(creerReponse).toHaveBeenCalledTimes(2)
  })

  it('une boucle qui ne conclut jamais s’arrête d’elle-même au plafond de tours', async () => {
    // Le modèle rappelle indéfiniment le même outil de lecture, sans jamais
    // s'arrêter tout seul — le pire cas que le plafond doit couvrir.
    const lecture = creerOutilLecture()
    creerReponse.mockResolvedValue(
      reponseAvecOutils([blocOutil('appel-boucle', 'lecture_test', { question: 'encore' })]),
    )

    const issue = await faireTravaillerFilou('cherche indéfiniment', [lecture] as Outil[], CTX, '2026-07-27')

    expect(issue.genre).toBe('message')
    if (issue.genre === 'message') {
      expect(issue.texte.length).toBeGreaterThan(0)
    }
    // Le nombre d'appels au modèle doit être BORNÉ : c'est la preuve qu'il
    // n'y a pas de boucle infinie, pas un chiffre magique à préserver pour
    // lui-même.
    expect(creerReponse.mock.calls.length).toBeGreaterThan(0)
    expect(creerReponse.mock.calls.length).toBeLessThan(50)
    const appelsAuTour = creerReponse.mock.calls.length
    expect(lecture.executer).toHaveBeenCalledTimes(appelsAuTour)
  })

  it('un resumer() qui refuse ne propose pas de bouton mort : la raison repart vers le modèle, qui continue', async () => {
    const ecriture = creerOutilEcriture({
      resumer: vi.fn(async () => ({ ok: false as const, raison: 'Cette fiche est déjà dans cet état.' })),
    })
    creerReponse
      .mockResolvedValueOnce(reponseAvecOutils([blocOutil('appel-1', 'ecriture_test', { cible: 'Manon' })]))
      .mockResolvedValueOnce(reponseFinale('Rien à changer, en effet.'))

    const issue = await faireTravaillerFilou('change ça', [ecriture] as Outil[], CTX, '2026-07-27')

    expect(ecriture.executer).not.toHaveBeenCalled()
    expect(issue.genre).toBe('message')

    const messagesDuTourSuivant = creerReponse.mock.calls[1][0].messages
    const dernierMessage = messagesDuTourSuivant.at(-1)
    expect(dernierMessage.content[0]).toMatchObject({
      is_error: true,
      content: 'Cette fiche est déjà dans cet état.',
    })
  })

  it('le mot d’accompagnement écrit avant de proposer est bien remonté dans l’issue', async () => {
    const ecriture = creerOutilEcriture()
    creerReponse.mockResolvedValueOnce(
      reponseAvecOutils(
        [blocOutil('appel-1', 'ecriture_test', { cible: 'Manon' })],
        'Je vais préparer ce changement pour toi.',
      ),
    )

    const issue = await faireTravaillerFilou('change ça', [ecriture] as Outil[], CTX, '2026-07-27')

    expect(issue.genre).toBe('proposition')
    if (issue.genre === 'proposition') {
      expect(issue.texte).toBe('Je vais préparer ce changement pour toi.')
    }
  })
})
