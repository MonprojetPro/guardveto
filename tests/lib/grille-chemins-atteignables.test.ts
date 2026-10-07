// ============================================================
// Aucune fenêtre de la grille ne doit devenir inatteignable
// ============================================================
// B-145 lots 2b+2c. Ce fichier existe à cause d'un défaut RÉEL, trouvé pendant
// le portage du 07/10 et qui serait passé en production sans lui.
//
// CE QUI S'EST PASSÉ. Le matin, le lot 2a livrait une fenêtre « Au cabinet »,
// ouverte par un bouton « N présents » posé dans la case du planning. L'après-
// midi, la refonte a remplacé la case par la grille en semaines — et le bouton
// est parti avec. La fenêtre restait montée dans l'arbre, ses données chargées,
// son composant compilé : simplement, PLUS AUCUN CLIC N'Y MENAIT.
//
// POURQUOI RIEN NE L'AURAIT VU :
//
//   • `tsc` est content : le composant est bien monté, ses props sont justes.
//   • Le lint est content : aucune variable inutilisée.
//   • Le gardien du code mort est content : il raisonne par FICHIER, et le
//     fichier est importé. C'est exactement la limite déjà payée sur B-145a,
//     où deux actions serveur écrites et testées n'avaient aucun appelant.
//   • Aucun test ne monte un composant sur ce projet (B-144b).
//
// ⚠️ CE QUE CE TEST VÉRIFIE, ET CE QU'IL NE PEUT PAS VÉRIFIER.
//    Il vérifie qu'un CHEMIN existe dans le code — pas qu'il est cliquable à
//    l'écran, ni qu'il est visible. C'est un garde-fou contre la disparition
//    silencieuse, pas une recette. La recette reste à faire par MiKL.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(__dirname, '..', '..')
const lire = (...p: string[]) => readFileSync(join(RACINE, ...p), 'utf8')

const planning = lire('src', 'components', 'v2', 'PlanningV2.tsx')
const grille = lire('src', 'components', 'v2', 'GrilleSemaines.tsx')

describe('Toute fenêtre montée a un geste qui l’ouvre', () => {
  it('« Au cabinet » (lot 2a) est ouvrable depuis la grille', () => {
    // Le défaut exact du 07/10 : la fenêtre était montée, et `setJourneeOuverte`
    // n'avait plus aucun appelant.
    expect(planning).toContain('<JourneeDuJourModale')
    expect(planning).toContain('onOuvrirJournee={journeeVisible ? setJourneeOuverte : undefined}')
    // Et le bout de chaîne côté grille : la prop doit être REÇUE et APPELÉE,
    // pas seulement déclarée — une prop déclarée et jamais lue est le même
    // défaut, un cran plus bas.
    expect(grille).toContain('onOuvrirJournee?.(jour.date)')
  })

  it('la fenêtre « poser / retirer une présence » est ouvrable (B-145a)', () => {
    // Les deux actions existaient depuis le 06/10 sans aucun appelant. Si la
    // grille cesse un jour d'ouvrir cette fenêtre, elles y retombent.
    expect(planning).toContain('<CellulePresenceModale')
    expect(planning).toContain('setCellule({ date, vetId })')
    expect(grille).toContain('onOuvrirCellule(jour.date, ligne.vetId)')
  })

  it('les compteurs et les absences ont chacun leur bouton', () => {
    // Déplacer un panneau dans une fenêtre sans livrer le bouton, c'est rendre
    // l'information inatteignable tout en la chargeant.
    expect(planning).toContain('<CompteursModale')
    expect(planning).toContain('setCompteursOuverts(true)')
    expect(planning).toContain('<AbsencesModale')
    expect(planning).toContain('setAbsencesOuvertes(true)')
  })

  it('le détail d’une garde reste ouvrable — la réattribution passe par lui', () => {
    expect(planning).toContain('<GardeDetailModal')
    expect(grille).toContain('onOuvrirGarde(')
  })
})

describe('La refonte n’a pas emporté les gestes de B-111', () => {
  it('le cadenas se POSE, et pas seulement s’affiche', () => {
    // 🔴 Premier jet du portage : la grille dessinait l'anneau du cadenas sans
    //    offrir de le poser. Un verrou qu'on voit et qu'on ne peut plus tourner
    //    — alors que MiKL avait tranché le 06/10, « on rajoute évidemment les
    //    cadenas pour les gardes ».
    expect(planning).toContain('<BoutonCadenas')
    expect(planning).toContain('rendreCadenas={')
    expect(grille).toContain('rendreCadenas?.(garde, ligne.vetId, figee)')
  })

  it('le pré-remplissage d’un jour sans garde survit', () => {
    // Avant génération, une période n'a aucune garde : sans ce bouton, il
    // n'existe aucun endroit où cliquer pour fixer une date à l'avance.
    expect(planning).toContain('<PoserSurJourVide')
    expect(planning).toContain('rendrePoseJourVide={')
    expect(grille).toContain('rendrePoseJourVide?.(jour.date)')
  })
})

describe('Ce que la grille montre reste lisible', () => {
  it('l’en-tête des jours existe — sinon on compte les colonnes', () => {
    // Elle avait disparu au premier jet : la seule façon de savoir qu'une
    // colonne est le mercredi devenait de lire le numéro du jour et de compter.
    expect(grille).toContain('sem-entete')
    expect(grille).toMatch(/JOURS\.map/)
  })

  it('Filou reste monté, et reste refusé au secrétariat', () => {
    // MiKL, 06/10 : « faudra prévoir aussi Filou avec son animation comme
    // c'est déjà le cas maintenant ». Rien à inventer — tout à ne pas perdre.
    expect(planning).toContain('{!lectureSeule && <FilouEdge')
  })

  it('le bandeau de re-validation est conservé', () => {
    // « on garde le bandeau » (MiKL, 06/10).
    expect(planning).toContain('{alertes}')
  })
})
