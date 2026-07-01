// ============================================================
// GUARDVETO — Structure des créneaux : SOURCE UNIQUE DE VÉRITÉ (A0)
// ============================================================
// Avant ce module, les horaires/libellés/durées des créneaux de garde
// étaient RECOPIÉS EN DUR dans ~7 endroits indépendants (moteur,
// validateur, persistance, agenda Google, PDF, modale…) — avec déjà
// des valeurs qui se contredisaient (18h30 en base vs 18h00 dans l'agenda).
//
// Désormais, TOUT consommateur qui a besoin de connaître la structure
// d'un créneau (heures, durée, week-end ou non) lit ICI. Un seul endroit
// à modifier → plus de désynchronisation possible.
//
// ⚠️ Module FEUILLE : aucune dépendance runtime (que des constantes + des
// fonctions pures + un import de TYPE effacé à la compilation). Il peut
// donc être importé partout — moteur, couche data, lib agenda, composants
// UI — sans risque de cycle ni de gonfler le bundle client.
//
// Étape A0 de l'epic « structure configurable + roulement ordonné »
// (cf. docs/v2/07-epic-structure-roulement.md). Aujourd'hui ces valeurs
// sont STATIQUES (mêmes 4 types pour tous les cabinets). En A1/A2, ce
// module deviendra la couture qui lit la config PAR CABINET : seul son
// intérieur changera, les ~7 consommateurs resteront branchés ici.
// ============================================================

import type { TypeGardeEngine, Saison } from './types'

/** Horaires résolus d'un créneau (heure locale Europe/Paris). */
export interface HorairesCreneau {
  /** Heure de prise de garde, format 'HH:MM' (locale Europe/Paris). */
  heureDebut: string
  /** Heure de fin de garde, format 'HH:MM' (peut être le lendemain). */
  heureFin: string
  /** Nombre de jours entre la date de début et la date de fin. */
  offsetJoursFin: number
}

/** Définition complète d'un type de créneau. */
export interface CreneauDef extends HorairesCreneau {
  code: TypeGardeEngine
  libelle: string
  /** Vrai si le créneau tombe en week-end (samedi/dimanche). */
  estWeekend: boolean
  /** Vrai si le créneau couvre une nuit (chevauche 2 jours calendaires). */
  estNuit: boolean
  /** Durée totale en heures (précalculée). */
  dureeHeures: number
}

// ============================================================
// LA SOURCE — miroir EXACT du seed `creneaux_catalogue`
// (migration 20260616160002_attributions_v2.sql, lignes 44-50).
// Le test structure-creneaux.test.ts garantit l'alignement et
// empêche toute dérive entre ce miroir et la base.
// ============================================================
export const CRENEAUX: Record<TypeGardeEngine, CreneauDef> = {
  semaine_soir: {
    code: 'semaine_soir',
    libelle: 'Soir de semaine (lun-jeu)',
    heureDebut: '18:30',
    heureFin: '08:30',
    offsetJoursFin: 1,
    estWeekend: false,
    estNuit: true,
    dureeHeures: 14,
  },
  vendredi_soir: {
    code: 'vendredi_soir',
    libelle: 'Soir du vendredi',
    heureDebut: '18:30',
    heureFin: '08:30',
    offsetJoursFin: 1,
    estWeekend: false,
    estNuit: true,
    dureeHeures: 14,
  },
  weekend: {
    code: 'weekend',
    libelle: 'Week-end (sam+dim)',
    heureDebut: '08:30',
    heureFin: '08:30',
    offsetJoursFin: 2,
    estWeekend: true,
    estNuit: false,
    dureeHeures: 48,
  },
  ferie: {
    code: 'ferie',
    libelle: 'Jour férié',
    heureDebut: '08:30',
    heureFin: '08:30',
    offsetJoursFin: 1,
    estWeekend: false,
    estNuit: false,
    dureeHeures: 24,
  },
}

/** Horaires d'un type de créneau (la fonction à appeler partout). */
export function horairesCreneau(type: TypeGardeEngine): HorairesCreneau {
  const c = CRENEAUX[type]
  return { heureDebut: c.heureDebut, heureFin: c.heureFin, offsetJoursFin: c.offsetJoursFin }
}

/** Libellé humain d'un type de créneau. */
export function libelleCreneau(type: TypeGardeEngine): string {
  return CRENEAUX[type].libelle
}

// ============================================================
// Mapping JOUR → type de créneau (primitive de structure)
// Convention jourIndex / getDay : 0 = dimanche … 6 = samedi.
// ============================================================

/**
 * Type de créneau « propre » porté par un jour de la semaine.
 *  - vendredi (5) → vendredi_soir
 *  - samedi   (6) → weekend (couvre samedi + dimanche)
 *  - lun-jeu (1-4)→ semaine_soir
 *  - dimanche (0) → null (aucun créneau propre : couvert par le weekend du samedi)
 *
 * ⚠️ Le validateur INDÉPENDANT (validerPlanning) NE consomme PAS cette fonction,
 * À DESSEIN : il ré-implémente sa propre dérivation pour rester un contrôle croisé
 * indépendant du moteur (cf. l'en-tête de validerPlanning.ts). Ne pas l'y brancher.
 */
export function typeGardePourJour(jourIdx: number): TypeGardeEngine | null {
  if (jourIdx === 5) return 'vendredi_soir'
  if (jourIdx === 6) return 'weekend'
  if (jourIdx >= 1 && jourIdx <= 4) return 'semaine_soir'
  return null
}

/** Effectif semaine par défaut quand non configuré par le cabinet (hiver = 2, été = 1). */
export function effectifSemaineParDefaut(saison: Saison): number {
  return saison === 'hiver' ? 2 : 1
}

// ============================================================
// STRUCTURE RÉSOLUE — horaires effectifs (défaut + surcharge cabinet)
// ============================================================
// A1 : un cabinet peut personnaliser ses horaires (table creneaux_cabinet).
// On matérialise la structure « résolue » = horaires par type après fusion
// { défaut ⟵ surcharge cabinet }. Le loader (src/data/chargerStructureCabinet)
// la construit ; les consommateurs d'horaires (persistance, agenda…) la
// reçoivent en paramètre et retombent sur le défaut quand elle est absente.

/** Horaires effectifs par type de créneau, après application de la config cabinet. */
export type StructureCreneauxResolue = Record<TypeGardeEngine, HorairesCreneau>

/** Structure résolue par défaut = les horaires du référentiel partagé. */
export function structureParDefaut(): StructureCreneauxResolue {
  return {
    semaine_soir: horairesCreneau('semaine_soir'),
    vendredi_soir: horairesCreneau('vendredi_soir'),
    weekend: horairesCreneau('weekend'),
    ferie: horairesCreneau('ferie'),
  }
}

/** Applique des surcharges PARTIELLES (cabinet) sur la structure par défaut. */
export function resoudreStructure(
  overrides?: Partial<Record<TypeGardeEngine, Partial<HorairesCreneau>>>,
): StructureCreneauxResolue {
  const base = structureParDefaut()
  if (!overrides) return base
  for (const code of Object.keys(base) as TypeGardeEngine[]) {
    const o = overrides[code]
    if (o) base[code] = { ...base[code], ...o }
  }
  return base
}

/**
 * Horaires d'un type dans une structure résolue, avec repli sur le défaut si
 * la structure est absente (contextes legacy / hors-cabinet). Point d'accès
 * unique pour les consommateurs d'horaires.
 */
export function horairesResolus(
  structure: StructureCreneauxResolue | undefined,
  type: TypeGardeEngine,
): HorairesCreneau {
  return structure?.[type] ?? horairesCreneau(type)
}
