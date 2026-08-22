// ============================================================
// GUARDVETO — Le garde-fou du chemin MANUEL : logique PURE
// ============================================================
// Il existait trois chemins d'écriture d'une garde et seulement deux gardiens :
// le solver (à la génération) et le validateur (à la publication). La
// modification manuelle — `PATCH /api/gardes/[id]` — n'en avait aucun. L'admin
// a pu se placer elle-même sur trois week-ends consécutifs, en violation d'une
// règle DURE, sans que personne ne dise quoi que ce soit.
//
// CE QUE FAIT CE MODULE, ET SURTOUT CE QU'IL NE FAIT PAS
//
// Il ne contient AUCUNE règle métier. Écrire un contrôle « léger » dans la route
// aurait créé un troisième gardien, qui aurait dérivé des deux autres — c'est
// exactement le mécanisme qui a produit le bug. Le juge reste `validerPlanning`,
// et rien d'autre. Ce fichier ne fait que deux choses, toutes deux pures :
//
//   ① fabriquer le jeu de gardes « APRÈS » (le changement demandé, appliqué en
//      mémoire, sans toucher la base) ;
//   ② soustraire les violations qui existaient DÉJÀ.
//
// POURQUOI LE DELTA, ET PAS LA LISTE COMPLÈTE
//
// Un planning publié porte souvent des violations préexistantes (historique
// importé, congé validé après coup, retouche antérieure). Servir la liste
// entière à chaque geste ferait payer à l'admin les fautes des autres, à chaque
// clic — et le vrai avertissement, celui que SON geste vient de créer, serait
// noyé au milieu. On ne lui montre donc que ce que SON changement ajoute.
// C'est le même principe que le pré-vol de Filou : le contrôle est rejoué avec
// et sans, seul le DELTA s'affiche.
//
// DOCTRINE : le système INFORME, il n'interdit pas. Ce module ne bloque rien.
// Il produit une liste de phrases ; la route les renvoie, l'écran les montre,
// l'admin confirme et l'écriture se fait. Une confirmation forcée laisse une
// trace dans `audit_log`.
// ============================================================

import type { Violation } from '@/engine/validation/validerPlanning'
import type { GardeRow } from '@/engine/validation/gardesVersPlanning'
import type { PlanningPartiel } from '@/engine/types'
import type { RelationStructure } from '@/engine/structure-config'
import type { CreneauModele } from '@/engine/creneau-modele'
import { resoudrePlanningAffichage } from '@/engine/aval/resoudrePlanningAffichage'

/**
 * Rejoue le changement demandé sur un jeu de gardes, EN MÉMOIRE. Rien n'est
 * écrit : c'est la photo de ce que la base contiendrait si on appliquait.
 *
 * Le jeu d'origine n'est pas modifié (l'appelant a besoin des deux états).
 * Garde introuvable → jeu rendu tel quel : c'est `appliquerChangementGarde` qui
 * fait autorité sur l'existence de la garde (404), pas ce contrôle.
 */
export function simulerChangementGarde(
  gardes: readonly GardeRow[],
  gardeId: string,
  premier_id: string | null,
  second_id: string | null,
): GardeRow[] {
  return gardes.map((g) =>
    g.id === gardeId ? { ...g, premier_id, second_id } : g,
  )
}

// ── Maille JOUR : le remplacement d'un seul jour ─────────────
//
// L'autre mécanisme d'écriture de la route est `appliquerExceptionJour` : une
// garde de week-end occupe vendredi, samedi et dimanche, et on veut pouvoir
// remplacer quelqu'un sur UN de ces jours sans découper le bloc. L'exception
// s'écrit dans `gardes_exceptions` — la table `gardes`, elle, ne bouge pas.
// Le validateur, qui lit `gardes`, ne voit donc RIEN de ce chemin.
//
// POURQUOI ON NE SIMULE PAS UN BLOC
//
// L'unité du validateur est le BLOC, pas le jour : « deux week-ends à 7 jours
// d'écart » compte des week-ends entiers. Or la règle du projet est qu'un jour
// exceptionnel n'est PAS une garde : il ne bouge aucun compteur d'équité
// (`appliquer-exception.ts`, en-tête). Faire compter au remplaçant un week-end
// entier parce qu'il dépanne un dimanche produirait un avertissement FAUX — et
// on sait déjà, sur ce projet, qu'un faux positif de rythme noie les vraies
// alertes (`bb180d4`, l'espacement qui criait sur chaque week-end).
//
// CE QU'ON CONTRÔLE À LA PLACE
//
// Le MÊME juge, sur une période réduite à ce seul jour. Les règles qui se
// jugent sur l'occupant d'un créneau (congé validé, indisponibilité, jour de
// repos, duo interdit, rôle interdit) répondent exactement ; les règles de
// rythme se taisent d'elles-mêmes, sans qu'on ait à les désactiver — un seul
// créneau ne forme ni paire, ni série, ni fenêtre. C'est la propriété qui rend
// ce découpage honnête plutôt que bricolé.
//
// TROUVER LE CRÉNEAU D'UN JOUR — on ne le recalcule pas, on le DEMANDE
//
// Un jour donné n'a pas forcément de ligne à lui dans `gardes`. Un week-end est
// une ligne unique posée le samedi qui occupe aussi le dimanche ; le vendredi,
// lui, est une dérivation. C'est exactement le problème que l'aval d'affichage
// résout déjà pour la vue `planning_semaine` : `resoudrePlanningAffichage` rend,
// pour chaque jour, la cellule qui le porte — native (samedi, soir de semaine),
// liée (vendredi) ou continuation (dimanche). On lui pose donc la question au
// lieu d'ajouter un « + 1 jour » de notre cru quelque part.
//
// Le bénéfice n'est pas cosmétique : la portée d'un créneau y est dérivée du
// CATALOGUE du cabinet (`offsetJoursFin`), pas figée sur « le week-end couvre le
// dimanche ». Un cabinet dont les créneaux couvrent d'autres jours sera jugé sur
// ses jours à lui, sans qu'on retouche ce fichier. Et l'écran, la vue et le
// gardien répondent tous les trois sur la même résolution — c'est précisément
// l'écart entre deux résolutions concurrentes qui a créé le bug d'origine.

/**
 * Le créneau qui porte ce jour, réduit à une attribution unique (ou aucune).
 *
 * L'attribution est datée du JOUR CONTRÔLÉ, pas du jour de début du créneau :
 * pour un dimanche, on rend le créneau `weekend` daté du dimanche. C'est ce qui
 * fait que les règles indexées sur le jour (congé ce jour-là, jour de repos,
 * indisponibilité) répondent sur le BON jour, tout en gardant le type de
 * créneau — donc les règles de composition (rôles, duo, qui peut tenir un
 * week-end) restent celles du week-end. Sans cette date, on jugerait le
 * dimanche avec le calendrier du samedi : un gardien à moitié juste, c'est-à-dire
 * pire qu'un gardien absent.
 */
export function planningDuJour(
  gardes: readonly GardeRow[],
  jour: string,
  options?: { relations?: readonly RelationStructure[]; creneaux?: CreneauModele[] },
): PlanningPartiel {
  const cellule = resoudrePlanningAffichage(gardes, {
    relations: options?.relations,
    creneaux: options?.creneaux,
  }).find((c) => c.date === jour)

  return cellule
    ? { attributions: [{ date: jour, type: cellule.type, placements: cellule.placements }] }
    : { attributions: [] }
}

/**
 * Remplace les occupants du créneau de ce jour. Les rôles `premier` / `second`
 * sont ceux que l'écran AFFICHE — pour un vendredi reconstruit, l'inversion a
 * déjà été appliquée en amont, donc le vocabulaire coïncide avec celui du corps
 * de la requête. Les places d'autres rôles (créneaux sur-mesure) sont laissées
 * intactes : la route n'en pilote que deux.
 */
export function remplacerOccupantsDuJour(
  planning: PlanningPartiel,
  jour: string,
  premier_id: string | null,
  second_id: string | null,
): PlanningPartiel {
  return {
    attributions: planning.attributions.map((a) =>
      a.date !== jour
        ? a
        : {
            ...a,
            placements: a.placements.map((p) =>
              p.role === 'premier'
                ? { ...p, vetId: premier_id }
                : p.role === 'second'
                  ? { ...p, vetId: second_id }
                  : p,
            ),
          },
    ),
  }
}

/** Identité d'une violation, indépendante de sa formulation. */
function cleViolation(v: Violation): string {
  return `${v.regle}|${v.date}|${v.type}|${v.role ?? ''}|${v.vetId ?? ''}`
}

/**
 * Ce que le changement AJOUTE : les violations présentes après et absentes
 * avant. Les violations disparues ne sont pas remontées — corriger sans le
 * savoir n'a jamais besoin d'être confirmé.
 */
export function violationsIntroduites(
  avant: readonly Violation[],
  apres: readonly Violation[],
): Violation[] {
  const dejaLa = new Set(avant.map(cleViolation))
  const vues = new Set<string>()
  const out: Violation[] = []
  for (const v of apres) {
    const cle = cleViolation(v)
    if (dejaLa.has(cle) || vues.has(cle)) continue
    vues.add(cle)
    out.push(v)
  }
  return out
}

/**
 * Met une violation en phrase d'avertissement pour la modale de confirmation.
 *
 * Le `detail` du validateur est déjà rédigé en français, dates comprises
 * (`lib/dates-fr`) : il est repris MOT POUR MOT, jamais reformulé — même
 * principe que `lib/regles/refus.ts`, on ajoute autour, on ne réécrit pas.
 * On préfixe seulement ce que la phrase seule ne dit pas : que c'est une règle
 * dure, et — le cas échéant — que le problème vient de l'historique.
 */
export function phraseAvertissement(v: Violation): string {
  const heritee =
    v.origine === 'anterieure'
      ? ' (règle enfreinte avec une garde d’une période précédente)'
      : ''
  return `Règle enfreinte — ${v.detail}${heritee}`
}
