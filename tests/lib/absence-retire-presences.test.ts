// ============================================================
// Une absence accordée retire les présences de journée — et aucun chemin
// ne peut l'oublier (B-160)
// ============================================================
// L'EXIGENCE — MiKL, le 11/10, décrivant ce qu'il croyait déjà acquis :
//
//   « quand l'admin accepte des absences ça s'applique automatiquement aux
//    journées comme aux gardes »
//
// Ce n'était pas le cas. `grep presences_journee` dans `conges/actions.ts` → 0,
// dans `api/absences/route.ts` → 0. L'application des trames écartait bien les
// congés AU MOMENT DE LA POSE, mais rien ne repassait quand l'absence arrivait
// APRÈS : le planning montrait quelqu'un au cabinet un jour où il était en
// congé, et aucun écran ne le signalait.
//
// CE QUE CE FICHIER FAIT, EN DEUX TEMPS
//
//  ① Il vérifie la RÈGLE : quelles présences sont couvertes par une fenêtre
//     d'absence. Fonction pure, donc les bornes se vérifient vraiment.
//  ② Il vérifie la COUVERTURE : tout chemin serveur qui rend quelqu'un
//     indisponible appelle la brique. C'est ce second test qui fait la
//     différence — le premier dit que la règle est juste, le second qu'elle est
//     APPELÉE. « Un grep prouve qu'un code est écrit, jamais qu'il est appelé »
//     est la leçon la plus chère de ce projet.
//
// ⚠️ CE QU'IL NE PEUT PAS FAIRE : juger que l'appel est au BON endroit du flux
//    (avant ou après tel contrôle), ni qu'il reçoit les bonnes dates. Comme
//    toute gate structurelle, il force le geste — donc la relecture — pas la
//    justesse. C'est la même limite que `couverture-juges.test.ts`.
//
// Aucune connexion réseau : on lit les fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  presencesARetirer,
  phraseRetrait,
  type PresencePourRetrait,
} from '../../src/lib/journee/absence-retire-presences'

const SRC = join(__dirname, '..', '..', 'src')
const LA_BRIQUE = 'retirerPresencesCouvertes'

/**
 * Les chemins serveur qui rendent quelqu'un INDISPONIBLE.
 *
 * ⚠️ AJOUTER UNE LIGNE ICI quand un nouveau chemin apparaît — c'est le seul
 *    entretien que ce test demande, et c'est volontaire : la liste dit ce que
 *    le produit sait faire, et une liste qui se remplit toute seule ne protège
 *    de rien.
 */
const CHEMINS_QUI_RENDENT_INDISPONIBLE: { fichier: string; quoi: string }[] = [
  {
    fichier: "app/(protected)/conges/actions.ts",
    // ⚠️ CE FICHIER PORTE TROIS CHEMINS, pas un. B-160 n'avait branché que le
    //    deuxième, et c'est le PREMIER que l'administratrice utilise — trou
    //    mesuré en base le 13/10 (B-160a). Le gardien ne peut pas distinguer
    //    trois appels dans un même fichier : c'est la limite assumée de toute
    //    gate structurelle, et la raison pour laquelle le commentaire les
    //    nomme.
    quoi:
      "l'admin pose un congé (`createConge`, né validé), l'accorde (`validerConge`) " +
      'ou le déplace (`updateConge`)',
  },
  {
    fichier: 'app/api/absences/route.ts',
    quoi: "l'admin déclare une absence (POST /api/absences)",
  },
  {
    fichier: 'lib/ia/outils/absences.ts',
    // 🔴 QUATRIÈME OCCURRENCE DU MÊME DÉFAUT, trouvée le 13/10 en balayant les
    //    chemins et NON en recette. Cet outil n'insère pas par la route : il
    //    écrit en direct dans `absences`. Une absence déclarée par Filou
    //    laissait donc la personne affichée au cabinet, exactement comme le
    //    défaut d'origine de B-160.
    //
    // 🔑 POURQUOI PERSONNE NE L'AVAIT VU : on cherchait du côté des écrans. Un
    //    chemin d'écriture peut vivre dans l'assistant, dans un import, dans un
    //    script — « recenser les consumers » veut dire recenser les ÉCRITURES,
    //    pas les pages.
    quoi: 'Filou déclare une absence (`declarer_absence`)',
  },
]

describe('La règle : quelles présences une absence couvre', () => {
  const presences: PresencePourRetrait[] = [
    { id: 'a', veterinaire_id: 'v1', date: '2026-10-18' }, // la veille
    { id: 'b', veterinaire_id: 'v1', date: '2026-10-19' }, // premier jour
    { id: 'c', veterinaire_id: 'v1', date: '2026-10-21' }, // milieu
    { id: 'd', veterinaire_id: 'v1', date: '2026-10-23' }, // dernier jour
    { id: 'e', veterinaire_id: 'v1', date: '2026-10-24' }, // le lendemain
    { id: 'f', veterinaire_id: 'v2', date: '2026-10-21' }, // quelqu'un d'autre
  ]
  const fenetre = { veterinaire_id: 'v1', date_debut: '2026-10-19', date_fin: '2026-10-23' }

  it('prend les bornes, les deux', () => {
    // Le piège classique : une borne exclue retire un jour de trop ou de trop
    // peu, et personne ne s'en aperçoit avant qu'un véto soit posé le jour de
    // son retour de vacances.
    expect(presencesARetirer(presences, fenetre)).toEqual(['b', 'c', 'd'])
  })

  it('ne touche jamais quelqu’un d’autre', () => {
    const ids = presencesARetirer(presences, fenetre)
    expect(ids).not.toContain('f')
  })

  it('ne rend rien quand la fenêtre ne couvre aucune présence', () => {
    expect(
      presencesARetirer(presences, {
        veterinaire_id: 'v1',
        date_debut: '2026-12-01',
        date_fin: '2026-12-31',
      }),
    ).toEqual([])
  })

  it('tient sur une absence d’un seul jour', () => {
    expect(
      presencesARetirer(presences, {
        veterinaire_id: 'v1',
        date_debut: '2026-10-21',
        date_fin: '2026-10-21',
      }),
    ).toEqual(['c'])
  })
})

describe('Ce que l’écran dit du retrait', () => {
  it('se tait quand il n’y a rien à dire', () => {
    // « 0 présence retirée » est du bruit, et un message permanent cesse d'être
    // lu — c'est la raison d'être du `null`.
    expect(phraseRetrait(0, 'Manon')).toBeNull()
  })

  it('accorde le singulier et le pluriel', () => {
    expect(phraseRetrait(1, 'Manon')).toContain('1 présence de journée a été retirée')
    expect(phraseRetrait(3, 'Manon')).toContain('3 présences de journée ont été retirées')
  })

  it('nomme la personne — un retrait anonyme n’est pas vérifiable', () => {
    expect(phraseRetrait(2, 'Anne-Sophie')).toContain('Anne-Sophie')
  })
})

describe('Aucun chemin ne peut rendre quelqu’un indisponible sans retirer ses présences', () => {
  it('le test ne passe pas à vide : les chemins existent', () => {
    expect(CHEMINS_QUI_RENDENT_INDISPONIBLE.length).toBeGreaterThan(0)
    for (const c of CHEMINS_QUI_RENDENT_INDISPONIBLE) {
      expect(() => readFileSync(join(SRC, c.fichier), 'utf8')).not.toThrow()
    }
  })

  it('chaque chemin appelle la brique', () => {
    const fautifs = CHEMINS_QUI_RENDENT_INDISPONIBLE.filter(
      (c) => !readFileSync(join(SRC, c.fichier), 'utf8').includes(LA_BRIQUE),
    )
    expect(
      fautifs.map((c) => `${c.fichier} — ${c.quoi}`),
      'Ce chemin rend quelqu’un indisponible sans retirer ses présences de\n'
        + 'journée. Le planning affichera cette personne au cabinet un jour où\n'
        + 'elle est absente, et aucun écran ne le signalera (B-160).\n\n'
        + `➜ Appeler \`${LA_BRIQUE}\` depuis \`lib/journee/absence-retire-presences\`,\n`
        + '  avec les dates EFFECTIVES de l’absence accordée.\n',
    ).toEqual([])
  })

  /**
   * La sonde : un gardien muet et un gardien sain sont indiscernables de
   * l'extérieur. On lui donne un faux chemin fautif et on exige qu'il le voie.
   */
  it('le gardien n’est pas muet — sondé sur un faux chemin', () => {
    const sourceSansLaBrique = "export async function validerQuelqueChose() { return true }"
    expect(sourceSansLaBrique.includes(LA_BRIQUE)).toBe(false)
  })
})

// ============================================================
// B-163 — LE RETRAIT SUIT LE PÉRIMÈTRE, ET NE RETIRE QUE CE QU'IL NOMME
// ============================================================
// MiKL, le 13/10 : « il est possible qu'un véto soit absent la journée mais pas
// la nuit, ou juste le matin mais pas l'après-midi », et sur la réunion de 2h :
// « on part sur le A quand ça reste une indisponibilité ponctuelle qui ne change
// rien à sa présence du jour ».
//
// 🔴 CE QUE CES CAS PROTÈGENT : jusqu'au 13/10, la brique retirait TOUTES les
//    présences du jour. Appliquée à une absence du matin, elle aurait fait
//    disparaître quelqu'un d'un après-midi qu'il travaille — soit l'option B,
//    explicitement écartée.
describe('Le retrait suit le périmètre (B-163)', () => {
  // Les tranches réelles du premier cabinet, mesurées en base le 13/10 :
  // Matin 08-12, Après-midi 14-18, Journée complète 08-18.
  const duJour: PresencePourRetrait[] = [
    { id: 'm', veterinaire_id: 'v1', date: '2026-11-02', creneau: 'matin' },
    { id: 'a', veterinaire_id: 'v1', date: '2026-11-02', creneau: 'apres-midi' },
    { id: 'j', veterinaire_id: 'v1', date: '2026-11-02', creneau: 'journee' },
  ]
  const jour = { veterinaire_id: 'v1', date_debut: '2026-11-02', date_fin: '2026-11-02' }

  it('une absence du matin ne retire QUE le matin', () => {
    // Et surtout : elle ne retire PAS la tranche « journée complète », parce que
    // la personne y est présente de 14h à 18h.
    expect(presencesARetirer(duJour, { ...jour, perimetre: 'matin' })).toEqual(['m'])
  })

  it('une absence de l’après-midi ne retire que l’après-midi', () => {
    expect(presencesARetirer(duJour, { ...jour, perimetre: 'apres-midi' })).toEqual(['a'])
  })

  it('une absence de journée retire les trois tranches', () => {
    expect(presencesARetirer(duJour, { ...jour, perimetre: 'journee' })).toEqual(['m', 'a', 'j'])
  })

  it('une absence de NUIT ne retire aucune présence de journée', () => {
    // La garde tombe, la journée au cabinet ne change pas. Retirer ici
    // effacerait du planning quelqu'un qui vient travailler.
    expect(presencesARetirer(duJour, { ...jour, perimetre: 'nuit' })).toEqual([])
  })

  it('un ponctuel de deux heures ne retire RIEN — l’option A, mot pour mot', () => {
    expect(presencesARetirer(duJour, { ...jour, perimetre: 'ponctuel' })).toEqual([])
  })

  it('sans périmètre, tout est retiré — le comportement d’avant ce lot', () => {
    // Le repli ne doit jamais conserver à tort : les 50 congés en base ont été
    // acceptés sous « une absence retire tout ».
    expect(presencesARetirer(duJour, jour)).toEqual(['m', 'a', 'j'])
  })

  it('une présence sans créneau connu est traitée comme « journée »', () => {
    // Donc retirée par une absence de journée, et conservée par une absence du
    // matin. Le repli le plus large est le seul qui ne libère rien par erreur.
    const sansCreneau: PresencePourRetrait[] = [
      { id: 'x', veterinaire_id: 'v1', date: '2026-11-02' },
    ]
    expect(presencesARetirer(sansCreneau, { ...jour, perimetre: 'journee' })).toEqual(['x'])
    expect(presencesARetirer(sansCreneau, { ...jour, perimetre: 'matin' })).toEqual([])
  })
})
