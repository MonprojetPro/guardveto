// ============================================================
// Les présences de la journée — B-120 chantier 3, lot 2
// ============================================================
// Ces cas portent sur `src/lib/journee/presences.ts`. Ils ne touchent ni la
// base ni le réseau.
//
// ⚠️ LE GROUPE QUI COMPTE LE PLUS EST « LA RÈGLE ADDITIVE ».
//
// C'est elle qui remplace le cadenas que MiKL a écarté pour la journée le 06/10
// (« les cadenas pour les gardes seulement »). Si l'application de la trame
// écrasait une retouche manuelle, l'administratrice perdrait son travail en
// cliquant sur un bouton présenté comme inoffensif — et rien ne le lui dirait.
// Aucun test existant ne le verrait : les présences seraient bien en base, juste
// pas les bonnes.
//
// ⚠️ LE SECOND GROUPE QUI COMPTE EST « CE QUE LA BASE NE PEUT PAS GARDER ».
//
// Trois refus ne sont tenus QUE par le code : une tranche retirée (la clé
// étrangère ignore `actif`), une date hors des bornes de la période (un CHECK ne
// peut pas lire une autre table), et une date qui n'existe pas. Le second est le
// plus vicieux : la présence serait écrite, rattachée à la période, et INVISIBLE
// sur une grille qui ne dessine que ses bornes — comptée dans les totaux sans
// apparaître nulle part.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  aPoser,
  clePresence,
  datesDeLaPeriode,
  presenceDejaPosee,
  presencesVoulues,
  resumeApplication,
  validerPresence,
  type TramePourProjection,
} from '@/lib/journee/presences'
import { estSemaineImpaire, jourDeLaSemaine } from '@/engine/utils'

const blocs = [
  { id: 'b-matin', nom: 'Matin', actif: true },
  { id: 'b-am', nom: 'Après-midi', actif: true },
  { id: 'b-retire', nom: 'Visites du soir', actif: false },
]

/** Octobre 2026 : du jeudi 1er au samedi 31. */
const periode = { id: 'p-oct', date_debut: '2026-10-01', date_fin: '2026-10-31' }

function trame(o: Partial<TramePourProjection> = {}): TramePourProjection {
  return {
    id: 't-1',
    veterinaire_id: 'v-anneso',
    bloc_id: 'b-matin',
    jour: 'mardi',
    semaine: 'toutes',
    actif: true,
    ...o,
  }
}

// ── Les dates d'une période ──────────────────────────────────────────────────

describe('datesDeLaPeriode', () => {
  it('rend toutes les dates, bornes comprises', () => {
    const d = datesDeLaPeriode('2026-10-01', '2026-10-31')
    expect(d).toHaveLength(31)
    expect(d[0]).toBe('2026-10-01')
    expect(d[30]).toBe('2026-10-31')
  })

  it('accepte une période d’un seul jour', () => {
    expect(datesDeLaPeriode('2026-10-05', '2026-10-05')).toEqual(['2026-10-05'])
  })

  it('rend un tableau vide sur des bornes renversées, au lieu de boucler', () => {
    expect(datesDeLaPeriode('2026-10-31', '2026-10-01')).toEqual([])
    expect(datesDeLaPeriode('', '2026-10-01')).toEqual([])
  })

  // Le piège du projet : construire une date locale à minuit fait sauter ou
  // doubler un jour au passage à l'heure d'hiver. En 2026 il tombe le dimanche
  // 25 octobre — une période de 12 semaines en traverse toujours un.
  it('ne perd ni ne double aucun jour au changement d’heure', () => {
    const d = datesDeLaPeriode('2026-10-20', '2026-10-30')
    expect(d).toHaveLength(11)
    expect(d).toContain('2026-10-25')
    expect(new Set(d).size).toBe(d.length)
    // Chaque date est le lendemain de la précédente, sans trou.
    for (let i = 1; i < d.length; i++) {
      const veille = new Date(`${d[i - 1]}T12:00:00Z`)
      veille.setUTCDate(veille.getUTCDate() + 1)
      expect(d[i]).toBe(veille.toISOString().slice(0, 10))
    }
  })
})

// ── La projection des trames ─────────────────────────────────────────────────

describe('presencesVoulues', () => {
  it('pose une présence sur chaque jour visé par la trame', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    // Les mardis d'octobre 2026 : 6, 13, 20, 27.
    expect(v.map((p) => p.date)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'])
    expect(v.every((p) => p.trame_id === 't-1')).toBe(true)
    expect(v.every((p) => p.veterinaire_id === 'v-anneso')).toBe(true)
  })

  it('ignore une trame désactivée', () => {
    expect(presencesVoulues([trame({ actif: false })], blocs, periode)).toEqual([])
  })

  // ⚠️ CE FILTRE N'EST PAS REDONDANT avec la validation du lot 1. Celui-ci
  //    refuse de CRÉER une trame sur une tranche retirée ; il n'empêche pas de
  //    retirer la tranche APRÈS. Sans ce filtre-ci, l'application poserait des
  //    présences sur une tranche que plus aucun formulaire ne propose — donc
  //    invisibles à la saisie et pourtant comptées dans l'effectif du jour.
  it('ignore une trame bâtie sur une tranche retirée depuis', () => {
    expect(presencesVoulues([trame({ bloc_id: 'b-retire' })], blocs, periode)).toEqual([])
  })

  it('ignore une trame dont la tranche n’existe plus du tout', () => {
    expect(presencesVoulues([trame({ bloc_id: 'b-inconnu' })], blocs, periode)).toEqual([])
  })

  // Deux trames peuvent viser la même case (« toutes les semaines » et
  // « semaines impaires », même jour, même tranche). Le lot 1 les autorise :
  // leurs quatre colonnes d'unicité diffèrent. L'index unique des PRÉSENCES,
  // lui, les refuserait — d'où le dédoublonnage avant écriture.
  it('dédoublonne deux trames qui visent la même case', () => {
    const v = presencesVoulues(
      [trame({ id: 't-a', semaine: 'toutes' }), trame({ id: 't-b', semaine: 'impaire' })],
      blocs,
      periode,
    )
    const cles = v.map(clePresence)
    expect(new Set(cles).size).toBe(cles.length)
    expect(v.map((p) => p.date)).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'])
  })

  // ⚠️ VÉRIFICATION CROISÉE, PAS TAUTOLOGIQUE. On ne recopie pas les dates
  //    attendues : on vérifie que chaque date projetée tombe bien sur le bon
  //    jour ET la bonne parité, en interrogeant les fonctions DU MOTEUR
  //    (`jourDeLaSemaine`, `estSemaineImpaire`) comme référence indépendante.
  //    C'est la convention « numéro de semaine ISO sans ancre », piège n°1 du
  //    cadrage V3 : un décalage d'une semaine ne lève aucune erreur et se
  //    découvre quand quelqu'un se présente le mauvais jour.
  it('respecte la convention de parité du moteur', () => {
    const annee = { id: 'p-an', date_debut: '2026-01-01', date_fin: '2026-12-31' }

    const impaires = presencesVoulues([trame({ semaine: 'impaire' })], blocs, annee)
    expect(impaires.length).toBeGreaterThan(20)
    for (const p of impaires) {
      expect(jourDeLaSemaine(p.date)).toBe('mardi')
      expect(estSemaineImpaire(p.date)).toBe(true)
    }

    const paires = presencesVoulues([trame({ semaine: 'paire' })], blocs, annee)
    expect(paires.length).toBeGreaterThan(20)
    for (const p of paires) {
      expect(jourDeLaSemaine(p.date)).toBe('mardi')
      expect(estSemaineImpaire(p.date)).toBe(false)
    }

    // Les deux ensembles sont disjoints et couvrent tous les mardis de l'année.
    const toutes = presencesVoulues([trame({ semaine: 'toutes' })], blocs, annee)
    expect(impaires.length + paires.length).toBe(toutes.length)
  })

  it('pose une présence le samedi — une permanence du samedi matin est courante', () => {
    const v = presencesVoulues([trame({ jour: 'samedi' })], blocs, periode)
    expect(v.map((p) => p.date)).toEqual(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'])
  })
})

// ── La règle additive : le groupe qui protège le travail manuel ──────────────

describe('aPoser — additive et idempotente', () => {
  it('ne repropose pas une présence déjà posée par la trame', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    const deja = [{ veterinaire_id: 'v-anneso', bloc_id: 'b-matin', date: '2026-10-13' }]
    expect(aPoser(v, deja).map((p) => p.date)).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-10-27',
    ])
  })

  it('appliquer deux fois de suite ne propose plus rien la seconde fois', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    const premiere = aPoser(v, [])
    expect(premiere).toHaveLength(4)
    // Ce que la première application a écrit devient l'existant de la seconde.
    expect(aPoser(v, premiere)).toEqual([])
  })

  // 🔴 LE CAS LE PLUS IMPORTANT DU FICHIER. L'administratrice a posé Anne-Sophie
  //    à la main le 13 (`trame_id: null`). La trame la veut aussi ce jour-là. Si
  //    `aPoser` la reproposait, l'index unique de la base refuserait l'insert —
  //    et l'admin lirait une erreur Postgres au lieu d'un « rien à faire ».
  //    C'est la clé d'identité qui garantit ça : elle ne porte PAS `trame_id`.
  it('une présence posée À LA MAIN bloque la trame sur la même case', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    const manuelle = [{ veterinaire_id: 'v-anneso', bloc_id: 'b-matin', date: '2026-10-13' }]
    const reste = aPoser(v, manuelle)
    expect(reste.map((p) => p.date)).not.toContain('2026-10-13')
    expect(reste).toHaveLength(3)
  })

  it('une présence sur une AUTRE tranche le même jour ne bloque rien', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    const ailleurs = [{ veterinaire_id: 'v-anneso', bloc_id: 'b-am', date: '2026-10-13' }]
    expect(aPoser(v, ailleurs)).toHaveLength(4)
  })

  it('la présence de QUELQU’UN D’AUTRE sur la même case ne bloque rien', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    const autre = [{ veterinaire_id: 'v-manon', bloc_id: 'b-matin', date: '2026-10-13' }]
    expect(aPoser(v, autre)).toHaveLength(4)
  })
})

// ⚠️ VERROU ANTI-DIVERGENCE avec l'index `presences_journee_sans_doublon`. Si
//    l'index change de colonnes un jour, ce test ne rougira pas tout seul —
//    mais il dit noir sur blanc ce que la clé doit porter, et c'est ce qu'on
//    relit quand l'application se met à échouer sur des doublons imprévus.
describe('clePresence', () => {
  it('porte la personne, la tranche et la date — et RIEN d’autre', () => {
    expect(clePresence({ veterinaire_id: 'v', bloc_id: 'b', date: '2026-10-06' })).toBe(
      'v|b|2026-10-06',
    )
  })

  it('ignore la période : deux périodes ne posent pas deux fois la même case', () => {
    const a = { veterinaire_id: 'v', bloc_id: 'b', date: '2026-10-06', periode_id: 'p-1' }
    const b = { veterinaire_id: 'v', bloc_id: 'b', date: '2026-10-06', periode_id: 'p-2' }
    expect(clePresence(a)).toBe(clePresence(b))
  })

  it('ignore la trame : une présence manuelle et une présence de trame se confondent', () => {
    const main = { veterinaire_id: 'v', bloc_id: 'b', date: '2026-10-06', trame_id: null }
    const auto = { veterinaire_id: 'v', bloc_id: 'b', date: '2026-10-06', trame_id: 't-1' }
    expect(clePresence(main)).toBe(clePresence(auto))
  })
})

// ── Le résumé annoncé avant d'écrire ────────────────────────────────────────

describe('resumeApplication', () => {
  it('dit quoi faire quand aucune trame ne s’applique', () => {
    const r = resumeApplication([], [])
    expect(r.aPoser).toBe(0)
    expect(r.phrase).toContain('Aucune trame')
    expect(r.phrase).toContain('Journée')
  })

  // Sans ce chiffre, une seconde application se lit comme un bouton cassé.
  it('distingue « rien à faire » de « rien à appliquer »', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    const r = resumeApplication(v, [])
    expect(r.phrase).toContain('Tout est déjà en place')
    expect(r.phrase).toContain('4')
    expect(r.inchangees).toBe(4)
  })

  it('annonce le nombre exact et les personnes concernées', () => {
    const v = presencesVoulues(
      [trame({ id: 't-a' }), trame({ id: 't-b', veterinaire_id: 'v-manon' })],
      blocs,
      periode,
    )
    const r = resumeApplication(v, v)
    expect(r.aPoser).toBe(8)
    expect(r.personnes).toBe(2)
    expect(r.phrase).toContain('8 présences')
    expect(r.phrase).toContain('2 personnes')
  })

  it('accorde le singulier', () => {
    const une = [{ veterinaire_id: 'v', bloc_id: 'b', date: '2026-10-06', trame_id: null }]
    const r = resumeApplication(une, une)
    expect(r.phrase).toContain('1 présence à poser')
    expect(r.phrase).not.toContain('présences')
    expect(r.phrase).toContain('1 personne')
  })
})

// ── Ce que la base ne peut pas garder ───────────────────────────────────────

describe('validerPresence — les refus que seul le code tient', () => {
  const saisie = {
    veterinaire_id: 'v-anneso',
    bloc_id: 'b-matin',
    date: '2026-10-13',
    periode_id: 'p-oct',
  }

  it('accepte une saisie correcte, et force `trame_id` à null', () => {
    const r = validerPresence(saisie, blocs, periode)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valeur.trame_id).toBeNull()
      expect(r.valeur.date).toBe('2026-10-13')
    }
  })

  // La clé étrangère ne regarde que l'existence de la ligne, jamais son `actif`.
  it('refuse une tranche retirée, en nommant la tranche', () => {
    const r = validerPresence({ ...saisie, bloc_id: 'b-retire' }, blocs, periode)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.probleme).toContain('Visites du soir')
      expect(r.probleme).toContain('retirée')
    }
  })

  // 🔴 Un CHECK ne peut pas lire une autre table : rien en base ne lie `date` à
  //    `periode_id`. Sans ce refus, la présence serait écrite, rattachée à la
  //    période, et invisible sur une grille qui ne dessine que ses bornes.
  it('refuse une date hors des bornes de la période, en donnant les bornes', () => {
    const avant = validerPresence({ ...saisie, date: '2026-09-30' }, blocs, periode)
    expect(avant.ok).toBe(false)
    if (!avant.ok) {
      expect(avant.probleme).toContain('2026-10-01')
      expect(avant.probleme).toContain('2026-10-31')
    }
    expect(validerPresence({ ...saisie, date: '2026-11-01' }, blocs, periode).ok).toBe(false)
  })

  it('accepte les bornes elles-mêmes', () => {
    expect(validerPresence({ ...saisie, date: '2026-10-01' }, blocs, periode).ok).toBe(true)
    expect(validerPresence({ ...saisie, date: '2026-10-31' }, blocs, periode).ok).toBe(true)
  })

  it('refuse une date qui n’existe pas', () => {
    expect(validerPresence({ ...saisie, date: '2026-02-31' }, blocs, periode).ok).toBe(false)
    expect(validerPresence({ ...saisie, date: '13/10/2026' }, blocs, periode).ok).toBe(false)
    expect(validerPresence({ ...saisie, date: '' }, blocs, periode).ok).toBe(false)
  })

  // Si l'écran envoie une autre période que celle qu'il affiche, on ne devine
  // pas : on demande de recharger. Deviner écrirait sur un planning que
  // l'utilisateur ne regarde pas.
  it('refuse une période qui n’est pas celle visée', () => {
    const r = validerPresence({ ...saisie, periode_id: 'p-autre' }, blocs, periode)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.probleme).toContain('Rechargez')
  })

  it('refuse une saisie sans personne et sans tranche', () => {
    expect(validerPresence({ ...saisie, veterinaire_id: '  ' }, blocs, periode).ok).toBe(false)
    expect(validerPresence({ ...saisie, bloc_id: '' }, blocs, periode).ok).toBe(false)
  })
})

// ── Le doublon, et son origine ──────────────────────────────────────────────

describe('presenceDejaPosee', () => {
  const existantes = [
    { veterinaire_id: 'v-anneso', bloc_id: 'b-matin', date: '2026-10-13', trame_id: 't-1' },
    { veterinaire_id: 'v-manon', bloc_id: 'b-am', date: '2026-10-13', trame_id: null },
  ]

  // Les deux cas ne se disent pas pareil : une présence venue de la trame
  // s'explique, une présence manuelle est simplement déjà là. Sans la
  // distinction, l'admin cherche pourquoi elle aurait posé quelqu'un qu'elle
  // n'a jamais posé.
  it('dit quand la présence vient d’une trame', () => {
    const r = presenceDejaPosee(
      { veterinaire_id: 'v-anneso', bloc_id: 'b-matin', date: '2026-10-13' },
      existantes,
    )
    expect(r).toEqual({ presente: true, deLaTrame: true })
  })

  it('dit quand elle a été posée à la main', () => {
    const r = presenceDejaPosee(
      { veterinaire_id: 'v-manon', bloc_id: 'b-am', date: '2026-10-13' },
      existantes,
    )
    expect(r).toEqual({ presente: true, deLaTrame: false })
  })

  it('ne confond pas deux tranches du même jour', () => {
    const r = presenceDejaPosee(
      { veterinaire_id: 'v-anneso', bloc_id: 'b-am', date: '2026-10-13' },
      existantes,
    )
    expect(r).toEqual({ presente: false })
  })
})

// ── Les absences bloquent la pose (B-148) ────────────────────────────────────
//
// Demande de MiKL le 06/10 : le geste doit appliquer « les recurrences, ET les
// absences programmees ». Le lot 1 ne regardait AUCUN conge — il aurait pose une
// presence sur quelqu'un en vacances, sans un mot. Ce n'etait pas un oubli
// d'ecran, c'etait un trou dans la logique livree.
//
// ⚠️ LA FONCTION PURE NE CONNAIT NI STATUT NI MOTIF. « Quelles absences
//    bloquent » est une question PRODUIT, repondue une seule fois dans l'action
//    serveur (conges valides + absences actives). Ici on verifie seulement que
//    l'absence l'emporte sur l'habitude.

describe('presencesVoulues — les absences écartent la présence', () => {
  const t = [trame()] // Anne-So, mardi, Matin, toutes les semaines

  it('ne pose pas de présence sur un jour couvert par une absence', () => {
    const v = presencesVoulues(t, blocs, periode, [
      { veterinaire_id: 'v-anneso', date_debut: '2026-10-12', date_fin: '2026-10-16' },
    ])
    // Les mardis d'octobre : 6, 13, 20, 27. Le 13 tombe dans l'absence.
    expect(v.map((p) => p.date)).toEqual(['2026-10-06', '2026-10-20', '2026-10-27'])
  })

  it('traite les bornes de l’absence comme incluses', () => {
    const v = presencesVoulues(t, blocs, periode, [
      { veterinaire_id: 'v-anneso', date_debut: '2026-10-06', date_fin: '2026-10-06' },
    ])
    expect(v.map((p) => p.date)).not.toContain('2026-10-06')
    expect(v).toHaveLength(3)
  })

  // Une absence ne vaut QUE pour celui qu'elle concerne : sans ce test, un
  // filtre trop large viderait le planning de toute l'équipe sur les vacances
  // d'une seule personne.
  it('n’écarte que la personne absente, jamais ses collègues', () => {
    const v = presencesVoulues(t, blocs, periode, [
      { veterinaire_id: 'v-manon', date_debut: '2026-10-01', date_fin: '2026-10-31' },
    ])
    expect(v).toHaveLength(4)
  })

  it('une absence hors de la période ne change rien', () => {
    const v = presencesVoulues(t, blocs, periode, [
      { veterinaire_id: 'v-anneso', date_debut: '2026-11-01', date_fin: '2026-11-30' },
    ])
    expect(v).toHaveLength(4)
  })

  it('plusieurs absences se cumulent', () => {
    const v = presencesVoulues(t, blocs, periode, [
      { veterinaire_id: 'v-anneso', date_debut: '2026-10-05', date_fin: '2026-10-07' },
      { veterinaire_id: 'v-anneso', date_debut: '2026-10-26', date_fin: '2026-10-28' },
    ])
    expect(v.map((p) => p.date)).toEqual(['2026-10-13', '2026-10-20'])
  })

  // ⚠️ L'appel SANS absences reste permis pour les appelants existants — mais
  //    il pose sur tout le monde. C'est ce que ce test fige, pour que personne
  //    ne prenne le défaut pour le comportement voulu.
  it('sans absences fournies, ne filtre rien — c’est le piège à connaître', () => {
    expect(presencesVoulues(t, blocs, periode)).toHaveLength(4)
  })
})

describe('resumeApplication — le nombre écarté est DIT, jamais tu', () => {
  it('annonce les présences non posées pour absence', () => {
    const v = presencesVoulues([trame()], blocs, periode, [
      { veterinaire_id: 'v-anneso', date_debut: '2026-10-12', date_fin: '2026-10-16' },
    ])
    const r = resumeApplication(v, v, 1)
    expect(r.ecarteesPourAbsence).toBe(1)
    expect(r.phrase).toContain('1 présence non posée')
    expect(r.phrase).toContain('absente')
  })

  it('accorde le pluriel des écartées', () => {
    const r = resumeApplication([], [], 3)
    expect(r.phrase).toContain('3 présences non posées')
  })

  // Sans ce cas, une période où tout le monde est en congé afficherait
  // « aucune trame ne s'applique » — et enverrait l'admin corriger des règles
  // parfaitement justes.
  it('distingue « aucune trame » de « tout le monde est absent »', () => {
    expect(resumeApplication([], [], 0).phrase).toContain('Aucune trame')
    const toutAbsent = resumeApplication([], [], 12)
    expect(toutAbsent.phrase).not.toContain('Aucune trame')
    expect(toutAbsent.phrase).toContain('Rien à poser')
    expect(toutAbsent.phrase).toContain('12 présences non posées')
  })

  it('ne parle pas d’absence quand il n’y en a aucune', () => {
    const v = presencesVoulues([trame()], blocs, periode)
    expect(resumeApplication(v, v).phrase).not.toContain('absente')
  })
})
