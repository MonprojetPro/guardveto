// ============================================================
// B-138 — LES DEUX CRITÈRES NE PEUVENT PAS CRIER FAUX
// ============================================================
// Un critère de relecture est du texte. Rien ne le compile, rien ne l'exécute :
// il part dans un prompt et on ne sait qu'il était faux que lorsque Filou
// signale un défaut qui n'existe pas. C'est la pire des issues sur ce produit —
// un faux positif répété fait cesser de lire le rapport entier, et les neuf
// autres critères partent avec.
//
// Les DEUX bornes verrouillées ici ne viennent pas d'une intuition mais d'une
// mesure en base, le 30/09 :
//
//   ① `periode_type_creneau.nb_vetos` vaut 1 pour `semaine_soir` sur le profil
//      Été — chez Val d'Allier COMME sur la Démo. En été il n'existe aucun
//      second de semaine : sans la borne, `rotation_roles_semaine` annoncerait
//      « personne n'est jamais second » sur TOUTE période d'été.
//
//   ② `relation_creneau` porte `vendredi_soir → weekend` en `meme_binome` et
//      `inversion_role`, actif sur tous les profils. Le vendredi appartient au
//      week-end par construction : proposer de décharger quelqu'un de son
//      vendredi casse le binôme, et le mouvement se fait refuser. Filou aurait
//      produit une proposition inapplicable, ce que B-096 a déjà payé.
//
// Et le SENS de `decharge_avant_weekend` — la semaine EN COURS, pas la
// suivante — est verrouillé parce qu'il a été compris à l'envers une première
// fois, avant que MiKL ne le corrige. À l'envers, le critère ne rate pas
// seulement les vrais cas : il en invente.
// ============================================================

import { describe, it, expect } from 'vitest'
import { CRITERES_HUMAINS, critereParCle } from '@/lib/planning/criteres-humains'

const decharge = () => critereParCle('decharge_avant_weekend')!
const rotation = () => critereParCle('rotation_roles_semaine')!

describe('B-138 — les deux critères existent et sont servis à Filou', () => {
  it('les deux clés sont dans la liste, avec un titre et une origine', () => {
    for (const c of [decharge(), rotation()]) {
      expect(c).toBeDefined()
      expect(c.titre.length).toBeGreaterThan(0)
      // L'origine n'est pas décorative : le jour où un critère devient inutile,
      // c'est elle qui dit ce qu'il servait à attraper.
      expect(c.origine).toContain('B-138')
    }
  })

  it('aucune clé en doublon — deux critères de même clé, et le rapport en perd un', () => {
    const cles = CRITERES_HUMAINS.map((c) => c.cle)
    expect(new Set(cles).size).toBe(cles.length)
  })
})

describe('decharge_avant_weekend — le sens et les bornes', () => {
  it('dit la MÊME semaine, et exclut explicitement la suivante', () => {
    // Compris à l'envers au premier jet. À l'envers, Filou cherche le défaut
    // dans la mauvaise semaine : il rate tous les vrais cas et en signale des faux.
    const c = decharge().consigne
    expect(c).toContain('MÊME SEMAINE')
    expect(c).toContain('PRÉCÈDENT')
    expect(c).toMatch(/pas celles d'après/)
  })

  it('ne parle que des nuits lundi → jeudi', () => {
    expect(decharge().consigne).toContain('lundi au jeudi')
  })

  it('INTERDIT de toucher au vendredi soir, et dit pourquoi', () => {
    const c = decharge().consigne
    expect(c).toContain('JAMAIS')
    expect(c).toContain('vendredi soir')
    // Sans la raison, la consigne se lit comme un caprice et un remaniement
    // futur la retirera.
    expect(c).toMatch(/binôme/)
  })

  it('exige un remplaçant réel avant de signaler — sinon c’est une contrainte, pas un défaut', () => {
    const c = decharge().consigne
    expect(c).toContain('peuvent aussi')
    expect(c).toContain('bruit')
  })

  it('renvoie au nombre de disponibles fourni, au lieu de le faire recalculer', () => {
    // C'est tout l'objet du calcul de `effectifSemaine.ts` : s'il n'est pas
    // cité ici, Filou déduira l'effectif de tête, et le critère reposera sur
    // le raisonnement où il se trompe.
    expect(decharge().consigne).toMatch(/ne le recalcule pas/i)
  })
})

describe('rotation_roles_semaine — la borne qui l’empêche de crier en été', () => {
  it('se TAIT quand les nuits n’ont qu’une seule place', () => {
    const c = rotation().consigne
    expect(c).toContain('NE DIS RIEN')
    expect(c).toContain("qu'une seule place")
  })

  it('se tait aussi pour quelqu’un qui n’a qu’une seule nuit', () => {
    expect(rotation().consigne).toMatch(/une seule nuit/)
  })

  it('nomme les rôles dans le vocabulaire des DONNÉES, jamais celui de l’affichage', () => {
    // Deux vocabulaires cohabitent dans ce produit : « premier »/« second »
    // (données, ce que le dossier porte) et « 1er »/« 2e » (affichage). Les
    // confondre ne provoque aucune erreur : ça rend la comparaison toujours
    // fausse — payé le 04/09 sur le cadenas de B-111.
    const c = rotation().consigne
    expect(c).toContain('premier')
    expect(c).toContain('second')
    expect(c).not.toMatch(/«\s*1er\s*»/)
    expect(c).not.toMatch(/«\s*2e\s*»/)
  })

  it('dit « en semaine » DANS SON TITRE — c’est ce que l’admin lit dans le rapport', () => {
    // Le titre s'affiche juste à côté de « Le rôle qui rapporte doit tourner »,
    // qui porte sur le premier du WEEK-END. Sans la précision dans le titre
    // lui-même, les deux constats se confondent à la lecture — et l'admin
    // croira lire deux fois le même.
    expect(rotation().titre).toContain('en semaine')
  })

  it('se distingue de role_avantage dans son origine — sinon les deux se confondront', () => {
    // `role_avantage` porte sur le PREMIER DU WEEK-END et son avantage
    // financier (B-061). Celui-ci porte sur la rotation en semaine, sans enjeu
    // d'argent. Sans la mise en garde écrite, un futur nettoyage fusionnera
    // les deux et l'un des deux constats disparaîtra.
    expect(rotation().origine).toContain('role_avantage')
    expect(critereParCle('role_avantage')).toBeDefined()
  })
})
