// ============================================================
// B-133 — « il reste des gens à inviter » doit pouvoir S'ÉTEINDRE
// ============================================================
// Le 26/09, retour de réunion client : le premier cabinet abonné n'avait jamais
// vu le bouton « Inviter » des fiches véto. Des fiches créées, zéro invitation
// partie, donc zéro vétérinaire capable d'entrer dans l'app — et rien, nulle
// part, ne disait qu'il restait un geste à faire. MiKL : « le client ne les
// avait pas vus ».
//
// La réparation est un signal (halo sur le bouton + rappel en haut d'écran).
// Un signal n'a de valeur que s'il S'ÉTEINT : celui qui reste allumé quoi qu'on
// fasse est celui qu'on cesse de lire, et on aurait alors reconstruit exactement
// l'angle mort qu'on prétend fermer. C'est ce que ce fichier protège.
//
// Trois preuves, sans base de données ni rendu :
//   ① une invitation DÉJÀ PARTIE n'est plus comptée (sinon rappel permanent) ;
//   ② une fiche sans adresse est comptée À PART (geste différent : saisir
//      l'e-mail, pas cliquer sur un bouton que le serveur refusera) ;
//   ③ une fiche désactivée n'est jamais réclamée.
// ============================================================

import { describe, expect, it } from 'vitest'
import { fichesAInviter, type FicheInvitable } from '@/lib/emails/destinataire'

/** Une fiche minimale — seuls les champs que le tri lit sont renseignés. */
function fiche(p: Partial<FicheInvitable> & { prenom: string }): FicheInvitable {
  return { actif: true, email: `${p.prenom.toLowerCase()}@cabinet.fr`, ...p }
}

describe('fichesAInviter — qui reste-t-il à inviter', () => {
  it('compte une fiche active sans compte et avec une adresse', () => {
    const { pretes, sansAdresse } = fichesAInviter([fiche({ prenom: 'Fanny' })])
    expect(pretes.map((f) => f.prenom)).toEqual(['Fanny'])
    expect(sansAdresse).toEqual([])
  })

  // ⚠️ LA preuve qui compte. Le critère est `!user_id`, jamais `invite_pending` :
  // si une invitation déjà partie restait comptée, le rappel ne s'éteindrait
  // qu'au moment où la personne se connecte — donc il resterait allumé des
  // jours, et plus personne ne le lirait.
  it('ne compte PLUS une fiche dont le compte existe déjà', () => {
    const { pretes, sansAdresse } = fichesAInviter([
      fiche({ prenom: 'Jean', user_id: 'u-1' }),
    ])
    expect(pretes).toEqual([])
    expect(sansAdresse).toEqual([])
  })

  it('range à part la fiche sans adresse — le geste à faire est différent', () => {
    const { pretes, sansAdresse } = fichesAInviter([
      fiche({ prenom: 'Manon', email: null }),
      fiche({ prenom: 'Victor', email: '   ' }),
      fiche({ prenom: 'Antoine' }),
    ])
    expect(pretes.map((f) => f.prenom)).toEqual(['Antoine'])
    expect(sansAdresse.map((f) => f.prenom)).toEqual(['Manon', 'Victor'])
  })

  it('ignore une fiche désactivée, avec ou sans adresse', () => {
    const { pretes, sansAdresse } = fichesAInviter([
      fiche({ prenom: 'Partie', actif: false }),
      fiche({ prenom: 'PartieSansMail', actif: false, email: null }),
    ])
    expect(pretes).toEqual([])
    expect(sansAdresse).toEqual([])
  })

  it('rend deux listes vides quand toute l’équipe a son compte', () => {
    const { pretes, sansAdresse } = fichesAInviter([
      fiche({ prenom: 'Jean', user_id: 'u-1' }),
      fiche({ prenom: 'Fanny', user_id: 'u-2' }),
      fiche({ prenom: 'Sortie', actif: false }),
    ])
    expect(pretes).toEqual([])
    expect(sansAdresse).toEqual([])
  })

  it('ne casse pas sur une équipe vide', () => {
    expect(fichesAInviter([])).toEqual({ pretes: [], sansAdresse: [] })
  })
})

// ============================================================
// B-133a — la fiche qu'on ne VEUT pas inviter
// ============================================================
// Angle mort trouvé en livrant B-133 : Anne-Catherine, dernier recours, n'a
// peut-être jamais besoin d'entrer dans l'app. Sans échappatoire, son rappel
// resterait allumé pour toujours — donc plus personne ne le lirait, et l'angle
// mort serait reconstruit à l'identique. MiKL, le 26/09 : « tu peux rajouter un
// bouton arrêter de signaler l'invitation nécessaire pour ce véto ».
// ============================================================

describe('fichesAInviter — mise en sourdine (B-133a)', () => {
  it('ne réclame plus une fiche mise en sourdine', () => {
    const { pretes, sansAdresse } = fichesAInviter([
      fiche({ prenom: 'AnneCat', invitation_en_sourdine: true }),
    ])
    expect(pretes).toEqual([])
    expect(sansAdresse).toEqual([])
  })

  // Les deux listes, pas seulement « prêtes » : une fiche en sourdine ET sans
  // adresse ne doit pas reparaître par la porte de service du second compteur.
  it('la sourdine sort la fiche des DEUX listes, adresse ou pas', () => {
    const { pretes, sansAdresse } = fichesAInviter([
      fiche({ prenom: 'Muette', email: null, invitation_en_sourdine: true }),
    ])
    expect(pretes).toEqual([])
    expect(sansAdresse).toEqual([])
  })

  it('rétablir la sourdine remet la fiche dans les gens à inviter', () => {
    const { pretes } = fichesAInviter([
      fiche({ prenom: 'AnneCat', invitation_en_sourdine: false }),
    ])
    expect(pretes.map((f) => f.prenom)).toEqual(['AnneCat'])
  })

  // Un appelant qui ne connaît pas encore la colonne (ancien `select` nommé)
  // doit se comporter exactement comme avant : absent ≠ en sourdine.
  it('un champ absent vaut « signalée », jamais « en sourdine »', () => {
    const { pretes } = fichesAInviter([{ actif: true, email: 'x@cabinet.fr', prenom: 'Sans' }])
    expect(pretes).toHaveLength(1)
  })

  it('ne masque pas les autres fiches au passage', () => {
    const { pretes } = fichesAInviter([
      fiche({ prenom: 'AnneCat', invitation_en_sourdine: true }),
      fiche({ prenom: 'Fanny' }),
    ])
    expect(pretes.map((f) => f.prenom)).toEqual(['Fanny'])
  })
})
