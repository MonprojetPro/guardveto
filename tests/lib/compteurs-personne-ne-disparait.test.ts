// ============================================================
// GUARDVETO — Personne ne disparaît du tableau des compteurs
// ============================================================
// Un vétérinaire sans aucune garde sur le filtre courant n'a PAS de ligne
// dans la vue `compteurs_gardes` : il ne s'affiche pas à zéro, il DISPARAÎT.
// Le cas tombe d'abord sur le vétérinaire de dernier recours, dont le rôle
// est justement de n'avoir aucune garde tant que tout va bien — il se
// retrouvait absent d'un écran qui prétend montrer la répartition de toute
// l'équipe, devant la personne concernée.
//
// Ce test verrouille les deux moitiés de la garantie :
//   ① il apparaît, à zéro ;
//   ② le complément ne touche PAS au calcul d'équité — c'est ce qui rend le
//     correctif sûr pour les trois chemins qui écrivent `bonus_malus`.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  completerCompteursPourAffichage,
  ligneVide,
  type CompteursRow,
  type VetoPourCompteurs,
} from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'

const EQUIPE: VetoPourCompteurs[] = [
  { id: 'v-fanny', prenom: 'Fanny', nom: 'Altieri', statut: 'associe', couleur: '#a1' },
  { id: 'v-ac', prenom: 'Anne-Catherine', nom: 'Bernard', statut: 'associe', couleur: '#b2' },
  { id: 'v-as', prenom: 'Anne-Sophie', nom: 'Blanchard', statut: 'associe', couleur: '#c3' },
  { id: 'v-victor', prenom: 'Victor', nom: 'Coelho', statut: 'salarie', couleur: '#d4' },
]

/** Ce que la vue rend : uniquement les vétérinaires qui ont des gardes. */
function ligneAvec(v: VetoPourCompteurs, we: number): CompteursRow {
  return { ...ligneVide(v), we_premier: we, we_total: we, total_gardes: we }
}

describe('completerCompteursPourAffichage', () => {
  it('fait réapparaître un vétérinaire sans aucune garde, à zéro', () => {
    // La vue n'a rien rendu pour Anne-Catherine (dernier recours, 0 garde).
    const vue = [ligneAvec(EQUIPE[0], 2), ligneAvec(EQUIPE[2], 2), ligneAvec(EQUIPE[3], 2)]
    expect(vue.map((l) => l.prenom)).not.toContain('Anne-Catherine')

    const affiche = completerCompteursPourAffichage(vue, EQUIPE)

    expect(affiche).toHaveLength(4)
    const ac = affiche.find((l) => l.veterinaire_id === 'v-ac')
    expect(ac).toBeDefined()
    expect(ac!.prenom).toBe('Anne-Catherine')
    expect(ac!.we_total).toBe(0)
    expect(ac!.sem_total).toBe(0)
    expect(ac!.feries_total).toBe(0)
    expect(ac!.total_gardes).toBe(0)
  })

  it('garde le tri par nom des deux chemins de lecture', () => {
    const vue = [ligneAvec(EQUIPE[0], 2), ligneAvec(EQUIPE[2], 2), ligneAvec(EQUIPE[3], 2)]
    const affiche = completerCompteursPourAffichage(vue, EQUIPE)
    expect(affiche.map((l) => l.nom)).toEqual(['Altieri', 'Bernard', 'Blanchard', 'Coelho'])
  })

  it('ne touche à rien quand toute l’équipe a des gardes', () => {
    const vue = EQUIPE.map((v) => ligneAvec(v, 2))
    const affiche = completerCompteursPourAffichage(vue, EQUIPE)
    // Identité référentielle : aucun tri, aucune copie, aucun risque.
    expect(affiche).toBe(vue)
  })

  it('n’invente personne : un véto inactif absent de la liste reste absent', () => {
    const vue = [ligneAvec(EQUIPE[0], 2)]
    const equipeSansAC = EQUIPE.filter((v) => v.id !== 'v-ac')
    const affiche = completerCompteursPourAffichage(vue, equipeSansAC)
    expect(affiche.find((l) => l.veterinaire_id === 'v-ac')).toBeUndefined()
    expect(affiche).toHaveLength(3)
  })

  it('ne fausse PAS l’équité : le complément vient après calculerBilans', () => {
    // 6 week-ends répartis sur 3 vétérinaires ; le 4e n'a rien.
    const vue = [ligneAvec(EQUIPE[0], 2), ligneAvec(EQUIPE[2], 2), ligneAvec(EQUIPE[3], 2)]

    // L'ordre réel des pages : bilans D'ABORD, complément ENSUITE.
    const bilans = calculerBilans(vue, 6)
    const affiche = completerCompteursPourAffichage(vue, EQUIPE)

    // La quote-part reste calculée sur les 3 participants : 6/3 = 2 chacun,
    // donc écart nul. Si le complément avait été appliqué avant, la moyenne
    // serait tombée à 6/4 = 1,5 et TOUT LE MONDE aurait été déclaré en avance.
    expect(bilans).toHaveLength(3)
    for (const b of bilans) expect(b.ecart_we).toBe(0)

    // Et le véto rajouté n'a pas de bilan : c'est ce que `CompteursPanel`
    // traduit par « hors répartition » plutôt que par un écart chiffré.
    expect(bilans.find((b) => b.veterinaire_id === 'v-ac')).toBeUndefined()
    expect(affiche.find((l) => l.veterinaire_id === 'v-ac')).toBeDefined()
  })

  it('ne transforme PAS « aucune garde sur ce filtre » en grille de zéros', () => {
    // Régression trouvée le 2026-08-15. Les écrans distinguent trois choses :
    // « je n'ai pas pu lire », « aucune garde sur ce filtre » et « voici les
    // compteurs ». Compléter une liste VIDE écrasait le deuxième cas par une
    // grille de zéros, et la phrase qui explique quoi faire (« le planning est
    // peut-être encore en brouillon, passe le périmètre sur Tout ») ne
    // s'affichait plus.
    expect(completerCompteursPourAffichage([], EQUIPE)).toEqual([])
  })

  it('laisse `compteurs.length` utilisable comme garde « aucune garde »', () => {
    // Les deux écrivains de bonus_malus (cron/lock-gardes, appliquer-changement)
    // testent `compteurs.length` pour savoir s'il y a quelque chose à écrire.
    // Le complément étant réservé à l'affichage, ce que ces chemins lisent
    // reste vide quand la période n'a aucune garde.
    expect(calculerBilans([], 0)).toHaveLength(0)
  })
})
