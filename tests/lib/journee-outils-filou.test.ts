// ============================================================
// Filou et le planning de la journée — B-120, ouvert le 02/10
// ============================================================
// Décision de MiKL : « Filou doit savoir tout du projet, de A à Z. »
//
// ⚠️ CE QUE CES CAS ATTRAPENT, ET QUI N'EST PAS LA LOGIQUE DES OUTILS.
//
// Un outil Filou se vérifie mal en test unitaire : son `resumer` lit la base, et
// son `executer` délègue à une action serveur `'use server'`. Ce qui se vérifie
// SANS base, et qui casse en silence, c'est le RACCORDEMENT :
//
//   · un outil absent du catalogue n'existe pas pour le modèle ;
//   · une lecture absente de la table des sources s'affiche sans dire d'où elle
//     vient (`sources.test.ts` le garde déjà, on le double ici par le compte) ;
//   · une liste de jours ou de cadences exposée au modèle qui DIVERGE de celle
//     du produit : Filou proposerait un jour que la base refuse, ou ignorerait
//     un jour que l'écran propose. Rien ne le signalerait.
//
// Ce dernier point est le vrai sujet de ce fichier. C'est le défaut « convention
// recopiée trois fois, appliquée deux fois » (30/09), appliqué à un schéma Zod.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  CADENCES_EXPOSEES_A_FILOU,
  CRENEAUX_EXPOSES_A_FILOU,
  JOURS_EXPOSES_A_FILOU,
  agirSurPresenceRecurrente,
  agirSurTrancheJournee,
  creerPresenceRecurrente,
  creerTrancheJournee,
  lirePresencesRecurrentes,
  lireTranchesJournee,
  modifierPresenceRecurrente,
  modifierTrancheJournee,
} from '@/lib/ia/outils/journee'
import { JOURS_TRAME, PARITES_TRAME } from '@/lib/journee/trames'
import { CRENEAUX_BLOC } from '@/lib/journee/blocs'
import { CATALOGUE } from '@/lib/ia/outils/registre'
import { COUVERTURE_FILOU } from '@/lib/ia/couverture-produit'

const OUTILS_JOURNEE = [
  lireTranchesJournee,
  lirePresencesRecurrentes,
  creerTrancheJournee,
  modifierTrancheJournee,
  agirSurTrancheJournee,
  creerPresenceRecurrente,
  modifierPresenceRecurrente,
  agirSurPresenceRecurrente,
]

describe('Ce que Filou expose au modèle ne DIVERGE PAS du produit', () => {
  it('les jours proposés sont EXACTEMENT ceux des trames', () => {
    // Si `trames.ts` gagnait un jour sans que le schéma Zod le gagne, Filou ne
    // saurait pas le proposer — et l'écran, lui, l'afficherait. Dans l'autre
    // sens, Filou proposerait un jour que la base refuse par son CHECK.
    expect([...JOURS_EXPOSES_A_FILOU].sort()).toEqual([...JOURS_TRAME].sort())
  })

  it('les cadences proposées sont EXACTEMENT celles des trames, au singulier', () => {
    expect([...CADENCES_EXPOSEES_A_FILOU].sort()).toEqual([...PARITES_TRAME].sort())
    // Le pluriel est l'orthographe de l'autre règle du produit : l'exposer au
    // modèle le ferait écrire une valeur que la base rejette.
    expect(CADENCES_EXPOSEES_A_FILOU).not.toContain('impaires')
  })

  it('les rattachements proposés sont EXACTEMENT ceux des tranches — et jamais la soirée', () => {
    expect([...CRENEAUX_EXPOSES_A_FILOU].sort()).toEqual([...CRENEAUX_BLOC].sort())
    // Le soir appartient au module des gardes (décision ⑦ du cadrage V3).
    expect(CRENEAUX_EXPOSES_A_FILOU).not.toContain('soiree')
  })
})

describe('Les huit outils sont réellement RACCORDÉS', () => {
  it('chacun est dans le catalogue — sinon il n’existe pas pour le modèle', () => {
    // ⚠️ Écrire un outil et oublier de l'ajouter au registre est le défaut le
    //    plus facile à commettre ici, et le plus invisible : le fichier compile,
    //    les tests passent, et Filou ne le voit jamais. C'est « un grep prouve
    //    qu'un code est ÉCRIT, jamais qu'il est EXÉCUTÉ » (26/08).
    const nomsDuCatalogue = new Set(CATALOGUE.map((o) => o.nom))
    for (const o of OUTILS_JOURNEE) {
      expect(nomsDuCatalogue.has(o.nom), `${o.nom} n’est pas dans le CATALOGUE`).toBe(true)
    }
  })

  it('aucun nom en double dans le catalogue', () => {
    // Deux outils de même nom : le modèle en appelle un, `trouverOutil` rend
    // l'autre. Silencieux et indébogable.
    const noms = CATALOGUE.map((o) => o.nom)
    expect(noms.length).toBe(new Set(noms).size)
  })

  it('les six écritures sont réservées à l’administrateur', () => {
    // La configuration du cabinet n'est pas réglable par un vétérinaire. Et un
    // outil visible qui répond « accès refusé » est une coquille vide : le
    // registre le retire du catalogue, à condition que le drapeau soit posé.
    for (const o of OUTILS_JOURNEE.filter((x) => x.genre === 'ecriture')) {
      expect(o.adminSeulement, `${o.nom} devrait être réservé à l’admin`).toBe(true)
    }
  })

  it('les deux lectures sont ouvertes à tous — le secrétariat doit pouvoir lire', () => {
    // Décision de MiKL du 01/10 : « comme pour les vétos, les secrétaires
    // doivent avoir accès au planning journée comme pour les gardes ».
    expect(lireTranchesJournee.adminSeulement).toBeFalsy()
    expect(lirePresencesRecurrentes.adminSeulement).toBeFalsy()
  })
})

describe('Les descriptions disent QUAND appeler, pas seulement ce que ça fait', () => {
  it('chaque outil porte une description substantielle', () => {
    // La seconde moitié d'une description (« appelle-le quand… ») est ce qui
    // décide si Filou y pense au bon moment. Une description d'une ligne est un
    // outil que le modèle n'appellera jamais.
    for (const o of OUTILS_JOURNEE) {
      expect(o.description.length, `${o.nom} : description trop courte`).toBeGreaterThan(120)
    }
  })

  it('la lecture des présences PRÉVIENT que ce ne sont pas des faits du jour', () => {
    // C'est le garde-fou central de ces outils. Sans cette mise en garde, Filou
    // présenterait une habitude comme le planning réel — en ignorant les congés
    // validés. C'est le défaut du 25/08 (« qui a accès au planning ? » répondu
    // sans le secrétariat) transposé à la journée.
    const d = lirePresencesRecurrentes.description
    expect(d).toMatch(/congé/i)
    expect(d).toMatch(/habitude/i)
  })

  it('les deux « retirer » disent que ce n’est PAS une suppression', () => {
    // Sans ça, l'administratrice croit avoir défait le planning.
    expect(agirSurTrancheJournee.description).toMatch(/pas supprimer/i)
    expect(agirSurPresenceRecurrente.description).toMatch(/pas supprimer/i)
  })

  it('la création d’une tranche REFUSE de deviner le rattachement', () => {
    // B-144 : déduire le rattachement des horaires casserait le cas voulu de la
    // garde de midi 12h-14h rattachée à l'après-midi.
    expect(creerTrancheJournee.description).toMatch(/ne devine pas|pas déduit/i)
  })

  it('la création d’une présence dit qu’elle NE REMPLIT PAS le planning', () => {
    expect(creerPresenceRecurrente.description).toMatch(/ne remplit pas/i)
  })
})

describe('Les six capacités du produit pointent vers ces outils', () => {
  it('chaque action serveur du planning journée cite un outil qui existe', () => {
    const nomsDuCatalogue = new Set(CATALOGUE.map((o) => o.nom))
    const attendues = [
      'v2/journee#creerBloc',
      'v2/journee#modifierBloc',
      'v2/journee#basculerBloc',
      'v2/journee/trames-actions#creerTrame',
      'v2/journee/trames-actions#modifierTrame',
      'v2/journee/trames-actions#basculerTrame',
    ]
    for (const cle of attendues) {
      const decision = COUVERTURE_FILOU[cle]
      expect(decision, `${cle} n’a aucune décision`).toBeTruthy()
      expect('outil' in decision, `${cle} n’est plus couverte par un outil`).toBe(true)
      if ('outil' in decision) {
        expect(nomsDuCatalogue.has(decision.outil), `${cle} → « ${decision.outil} » inconnu`).toBe(
          true,
        )
      }
    }
  })
})
