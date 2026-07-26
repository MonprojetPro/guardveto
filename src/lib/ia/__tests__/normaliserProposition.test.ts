// ============================================================
// normaliserProposition — le pont entre l'IA et le moteur
// ============================================================
// Depuis le correctif du 400 « too many optional parameters », l'IA ne renvoie
// plus un champ par paramètre : elle met les paramètres du type choisi dans une
// CHAÎNE JSON (`params_json`), que cette fonction déplie.
//
// C'est donc elle qui décide de ce qui atteint le moteur de planning. Un
// dépliage silencieusement faux produirait une règle plausible mais fausse —
// exactement le genre d'erreur qu'on ne voit qu'une fois le planning publié.
// ============================================================

import { describe, it, expect } from 'vitest'
import { normaliserProposition, type SortieIa } from '../regleSchema'

/** Une sortie d'IA minimale et valide, à personnaliser par test. */
function sortie(extra: Partial<SortieIa> = {}): SortieIa {
  return {
    comprehension: 'Manon ne veut pas de garde le mercredi',
    faisable: true,
    message: 'Je propose une interdiction ferme.',
    veterinaire: 'Manon',
    brique_id: 'interdire_creneau',
    force: 'jamais',
    ...extra,
  }
}

describe('normaliserProposition', () => {
  it('déplie les paramètres de params_json vers les champs à plat', () => {
    const p = normaliserProposition(
      sortie({ params_json: '{"jour":"mercredi","exception_vacances_scolaires":false}' }),
    )
    expect(p.jour).toBe('mercredi')
    expect(p.exception_vacances_scolaires).toBe(false)
    expect(p.veterinaire).toBe('Manon')
    expect(p.brique_id).toBe('interdire_creneau')
  })

  it('met à null tout paramètre non fourni', () => {
    const p = normaliserProposition(sortie({ params_json: '{"jour":"mercredi"}' }))
    expect(p.n).toBeNull()
    expect(p.tag).toBeNull()
    expect(p.creneaux).toBeNull()
    // Jamais `undefined` : l'aval n'a qu'une seule forme d'absence à gérer.
    expect(p.n).not.toBeUndefined()
  })

  it('survit à un params_json illisible sans emporter la proposition', () => {
    const p = normaliserProposition(sortie({ params_json: '{"jour": mercredi,,}' }))
    expect(p.jour).toBeNull()
    // Le message et la compréhension restent lisibles : l'utilisateur saura
    // quoi reformuler plutôt que de voir l'assistant tomber.
    expect(p.message).toBe('Je propose une interdiction ferme.')
    expect(p.comprehension).toContain('mercredi')
  })

  it('ignore un params_json qui n’est pas un objet', () => {
    expect(normaliserProposition(sortie({ params_json: '["mercredi"]' })).jour).toBeNull()
    expect(normaliserProposition(sortie({ params_json: '"mercredi"' })).jour).toBeNull()
    expect(normaliserProposition(sortie({ params_json: 'null' })).jour).toBeNull()
  })

  it('écarte UN paramètre mal typé sans perdre ses voisins corrects', () => {
    // L'IA écrit le nombre entre guillemets — erreur classique.
    const p = normaliserProposition(
      sortie({
        brique_id: 'au_plus_n',
        params_json: '{"n":"2","fenetre":"glissante_30_jours","creneaux":["weekend"]}',
      }),
    )
    expect(p.n).toBeNull() // rejeté : ce n'est pas un entier
    expect(p.fenetre).toBe('glissante_30_jours') // conservé
    expect(p.creneaux).toEqual(['weekend']) // conservé
  })

  it('ignore un paramètre inventé qui ne fait pas partie du schéma', () => {
    const p = normaliserProposition(
      sortie({ params_json: '{"jour":"mercredi","couleur_du_mur":"bleu"}' }),
    )
    expect(p.jour).toBe('mercredi')
    expect('couleur_du_mur' in p).toBe(false)
  })

  it('rejette une valeur hors d’une énumération, mais laisse passer un champ libre', () => {
    // `fenetre` EST une énumération : une valeur inventée est écartée ici.
    expect(
      normaliserProposition(sortie({ params_json: '{"fenetre":"tous_les_mardis"}' })).fenetre,
    ).toBeNull()

    // `jour` est une chaîne LIBRE dans le schéma : la validation des jours
    // réels appartient à `construireParams`, côté serveur — c'est la doctrine
    // du projet (l'IA propose, le serveur valide). Ce test fige ce partage :
    // si `jour` devenait une énumération un jour, il faudra le savoir.
    expect(normaliserProposition(sortie({ params_json: '{"jour":"caturday"}' })).jour).toBe(
      'caturday',
    )
  })

  it('gère une demande jugée infaisable, sans paramètres du tout', () => {
    const p = normaliserProposition({
      comprehension: 'Repeindre la salle d’attente',
      faisable: false,
      message: 'Ce n’est pas une règle de planning de gardes.',
    })
    expect(p.faisable).toBe(false)
    expect(p.brique_id).toBeNull()
    expect(p.veterinaire).toBeNull()
    expect(p.message).toContain('planning')
  })
})
