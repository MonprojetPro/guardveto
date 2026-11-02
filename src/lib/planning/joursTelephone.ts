// ============================================================
// GUARDVETO — Le planning sur téléphone, jour par jour (B-179a)
// ============================================================
// Sous 640 px, la grille de 7 colonnes donnait des cases de 18 px. Le téléphone
// reçoit une LISTE : une carte par jour. Cette fonction compose ces cartes.
//
// ⚠️ ELLE NE LIT RIEN D'AUTRE QUE LES GRILLES. Mêmes gardes (déjà triées par la
//    diffusion : un véto ne reçoit pas de brouillon), mêmes manques
//    (`calculerManques`), mêmes présences (`composerPresencesParJour`), mêmes
//    congés et absences. Une deuxième source pour le même planning serait le
//    chemin qu'on oublie le jour où l'une change — et celui qui se met à mentir.
//
// Pure, sans React ni base : testée par `tests/lib/jours-telephone.test.ts`.
// ============================================================

import { placesDeGarde } from '@/lib/gardes/places'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import { lirePerimetre, phrasePerimetreCourte } from '@/lib/absences/perimetre'
import type { GardeDenormalisee } from '@/types'
import type { JourneeAffichee } from '@/lib/planning/presencesDuJour'

export interface PersonneTel {
  vetId: string | null
  prenom: string
  couleur: string | null
}

export interface GardeTel {
  id: string
  libelle: string
  places: PersonneTel[]
  /** Places attendues mais vides (catalogue + effectif de la période). */
  manque: number
  /** La personne connectée tient une place de cette garde. */
  moi: boolean
}

export interface PresenceTel extends PersonneTel {
  tranche: string
  heures: string
}

export interface AbsenceTel extends PersonneTel {
  /** `souhait` n'apparaît que pour la personne connectée : c'est SA demande. */
  nature: 'conge' | 'souhait' | 'absence'
  /** « le matin », « 8h–12h »… ; `null` = toute la journée. */
  precision: string | null
}

export interface JourTel {
  date: string
  horsMois: boolean
  aujourdhui: boolean
  passe: boolean
  gardes: GardeTel[]
  presences: PresenceTel[]
  /** Personnes DISTINCTES au cabinet (pas le nombre de tranches). */
  personnesPresentes: number
  absences: AbsenceTel[]
  /** Quelque chose concerne la personne connectée ce jour-là. */
  pourMoi: boolean
}

export interface SemaineTel {
  debut: string
  fin: string
  jours: JourTel[]
}

/** Congé tel que la page le passe déjà aux grilles. */
export interface CongeEntree {
  vetId: string
  prenom: string
  couleur: string | null
  dateDebut: string
  dateFin: string
  statut: string
  perimetre?: string | null
  heureDebut?: string | null
  heureFin?: string | null
}

/** Absence déclarée (table `absences`, statut actif). */
export interface AbsenceEntree {
  vetId: string
  prenom: string
  dateDebut: string
  dateFin: string
  perimetre?: string | null
  heureDebut?: string | null
  heureFin?: string | null
}

function decaler(iso: string, jours: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + jours)
  return d.toISOString().slice(0, 10)
}

function precisionDe(perimetre: string | null | undefined, debut?: string | null, fin?: string | null) {
  const heures = debut && fin ? { heure_debut: debut, heure_fin: fin } : null
  return phrasePerimetreCourte(lirePerimetre(perimetre), heures)
}

export function composerSemainesTelephone(entree: {
  /** Bornes de la grille du mois (lundi → dimanche), `bornesGrille`. */
  debut: string
  fin: string
  /** « AAAA-MM » du mois affiché. */
  anneeMois: string
  aujourdhui: string
  moiVetId: string
  gardes: readonly GardeDenormalisee[]
  manquesParGarde: Record<string, number>
  nomsTypes: Record<string, string>
  presencesParJour: Record<string, JourneeAffichee>
  conges: readonly CongeEntree[]
  absences: readonly AbsenceEntree[]
}): SemaineTel[] {
  const { moiVetId } = entree

  const gardesParDate = new Map<string, GardeDenormalisee[]>()
  for (const g of entree.gardes) {
    const liste = gardesParDate.get(g.date) ?? []
    liste.push(g)
    gardesParDate.set(g.date, liste)
  }

  const semaines: SemaineTel[] = []
  let courante: JourTel[] = []

  for (let date = entree.debut; date <= entree.fin; date = decaler(date, 1)) {
    const gardes: GardeTel[] = (gardesParDate.get(date) ?? []).map((g) => {
      const places = placesDeGarde(g).map((p) => ({
        vetId: p.vetId,
        prenom: p.prenom ?? 'Vétérinaire',
        couleur: p.couleur,
      }))
      return {
        id: g.id,
        libelle: libelleTypeGardeDb(g.type, entree.nomsTypes),
        places,
        manque: Math.max(0, entree.manquesParGarde[g.id] ?? 0),
        moi: Boolean(moiVetId) && places.some((p) => p.vetId === moiVetId),
      }
    })

    const journee = entree.presencesParJour[date]
    const presences: PresenceTel[] = (journee?.presences ?? []).map((p) => ({
      vetId: p.vetId,
      prenom: p.prenom,
      couleur: p.couleur,
      tranche: p.tranche,
      heures: p.heures,
    }))

    const absences: AbsenceTel[] = []
    for (const c of entree.conges) {
      if (c.dateDebut > date || c.dateFin < date) continue
      // Un congé refusé n'est pas une absence. Un souhait ne regarde que celui
      // qui l'a demandé : l'afficher à toute l'équipe annoncerait comme acquis
      // un congé que personne n'a encore accordé.
      if (c.statut === 'refuse') continue
      if (c.statut === 'souhait' && c.vetId !== moiVetId) continue
      absences.push({
        vetId: c.vetId,
        prenom: c.prenom,
        couleur: c.couleur,
        nature: c.statut === 'souhait' ? 'souhait' : 'conge',
        precision: precisionDe(c.perimetre, c.heureDebut, c.heureFin),
      })
    }
    for (const a of entree.absences) {
      if (a.dateDebut > date || a.dateFin < date) continue
      absences.push({
        vetId: a.vetId,
        prenom: a.prenom,
        couleur: null,
        nature: 'absence',
        precision: precisionDe(a.perimetre, a.heureDebut, a.heureFin),
      })
    }

    const pourMoi =
      Boolean(moiVetId) &&
      (gardes.some((g) => g.moi) ||
        presences.some((p) => p.vetId === moiVetId) ||
        absences.some((a) => a.vetId === moiVetId))

    courante.push({
      date,
      horsMois: date.slice(0, 7) !== entree.anneeMois,
      aujourdhui: date === entree.aujourdhui,
      passe: date < entree.aujourdhui,
      gardes,
      presences,
      personnesPresentes: journee?.personnes ?? 0,
      absences,
      pourMoi,
    })

    if (courante.length === 7) {
      semaines.push({ debut: courante[0].date, fin: date, jours: courante })
      courante = []
    }
  }
  if (courante.length > 0) {
    semaines.push({ debut: courante[0].date, fin: courante[courante.length - 1].date, jours: courante })
  }
  return semaines
}

/** Le résumé de la semaine d'une personne : « 1 garde, 3 jours au cabinet ». */
export function bilanSemaine(semaine: SemaineTel, moiVetId: string): {
  gardes: number
  joursAuCabinet: number
  absences: number
} {
  let gardes = 0
  let joursAuCabinet = 0
  let absences = 0
  for (const j of semaine.jours) {
    gardes += j.gardes.filter((g) => g.moi).length
    if (j.presences.some((p) => p.vetId === moiVetId)) joursAuCabinet++
    if (j.absences.some((a) => a.vetId === moiVetId)) absences++
  }
  return { gardes, joursAuCabinet, absences }
}
