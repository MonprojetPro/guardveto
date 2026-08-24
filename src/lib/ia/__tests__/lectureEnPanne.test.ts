// ============================================================
// Une lecture en panne ne doit JAMAIS devenir une affirmation
// ============================================================
// « Filou est un consumer comme un autre : son échec est silencieux et poli. »
//
// Le symptôme n'était pas une erreur à l'écran — c'était une phrase parfaitement
// rédigée, catégorique, et fausse : « Aucun vétérinaire ne s'appelle "Camille"
// dans ce cabinet. Les vétérinaires sont : » suivie d'un vide. Elle sortait
// d'un `?? []` posé sur une lecture dont personne ne lisait l'`error`.
//
// Ce fichier fige la seule chose qui compte : la base qui ne répond pas et la
// base qui répond « rien » ne produisent PAS le même résultat.
// ============================================================

import { describe, it, expect } from 'vitest'
import { lignesLues, ligneLue, PanneLecture } from '../outils/lecture'

const PANNE = { data: null, error: { message: 'connection terminated' } }
const VRAI_VIDE = { data: [], error: null }

describe('lignesLues — distinguer le vide de la panne', () => {
  it('rend les lignes quand la base a répondu', () => {
    expect(
      lignesLues<{ prenom: string }>({ data: [{ prenom: 'Camille' }], error: null }, "la liste de l'équipe"),
    ).toEqual([{ prenom: 'Camille' }])
  })

  it('rend un tableau vide quand la base répond « aucune ligne »', () => {
    expect(lignesLues(VRAI_VIDE, "la liste de l'équipe")).toEqual([])
  })

  it('LÈVE au lieu de rendre un vide de consolation quand la base n’a pas répondu', () => {
    expect(() => lignesLues(PANNE, "la liste de l'équipe")).toThrow(PanneLecture)
  })

  it('la phrase de la panne interdit explicitement de conclure au vide', () => {
    // C'est ce texte-là qui part vers le modèle comme résultat d'outil en
    // erreur : s'il ne dit pas « ce n'est pas un résultat vide », un modèle
    // pressé enchaîne « aucun résultat » et on est revenu au point de départ.
    let message = ''
    try {
      lignesLues(PANNE, "la liste de l'équipe")
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain("la liste de l'équipe")
    expect(message).toContain("n'est PAS un résultat vide")
    expect(message).toContain('échoué')
    // Aucune date technique ni jargon : ce texte peut finir sous les yeux d'une
    // vétérinaire.
    expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('ligneLue — un .single() sans résultat n’est pas une panne', () => {
  it('rend null quand PostgREST dit « aucune ligne » (PGRST116)', () => {
    expect(
      ligneLue({ data: null, error: { message: 'no rows', code: 'PGRST116' } }, 'cette absence'),
    ).toBeNull()
  })

  it('rend null quand maybeSingle() ne trouve rien, sans erreur', () => {
    expect(ligneLue({ data: null, error: null }, 'cette absence')).toBeNull()
  })

  it('lève sur toute autre erreur', () => {
    expect(() => ligneLue(PANNE, 'cette absence')).toThrow(PanneLecture)
  })

  it('rend la ligne quand elle existe', () => {
    expect(ligneLue<{ id: string }>({ data: { id: 'a' }, error: null }, 'cette absence')).toEqual({ id: 'a' })
  })
})

// ── Le comportement de bout en bout, sur le cas fondateur ──────
//
// On rejoue `resoudrePrenom` tel qu'il est écrit dans les cinq fichiers
// d'outils : sur une équipe VIDE, il rend une affirmation catégorique. Ce test
// prouve que cette affirmation ne peut plus naître d'une panne, parce que la
// panne s'arrête avant.

function chargerEquipe(reponse: { data: unknown; error: { message: string } | null }) {
  return lignesLues<{ prenom: string }>(reponse, "la liste de l'équipe")
}

function resoudrePrenom(equipe: { prenom: string }[], prenom: string) {
  const trouve = equipe.find((v) => v.prenom === prenom)
  if (trouve) return { ok: true as const, veto: trouve }
  return {
    ok: false as const,
    raison: `Aucun vétérinaire ne s'appelle « ${prenom} » dans ce cabinet. Les vétérinaires sont : ${equipe
      .map((v) => v.prenom)
      .join(', ')}.`,
  }
}

describe('le cas fondateur — « Aucun vétérinaire ne s’appelle Camille »', () => {
  it('une base en panne ne produit plus cette phrase', () => {
    expect(() => resoudrePrenom(chargerEquipe(PANNE), 'Camille')).toThrow(PanneLecture)
  })

  it('la phrase reste possible quand la base a VRAIMENT répondu', () => {
    const r = resoudrePrenom(chargerEquipe({ data: [{ prenom: 'Fanny' }], error: null }), 'Camille')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.raison).toContain('Fanny')
  })

  it('ne finit jamais sur un « Les vétérinaires sont : » vide', () => {
    // Le symptôme exact rapporté : la phrase se terminait sur le vide.
    const r = resoudrePrenom(chargerEquipe({ data: [{ prenom: 'Fanny' }], error: null }), 'Camille')
    expect(r.ok === false && r.raison).not.toMatch(/sont : \.$/)
  })
})
