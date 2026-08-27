// ============================================================
// GUARDVETO — Dans quel ordre lire une liste de congés (B-067)
// ============================================================
// Demande de MiKL le 2026-08-27 : « un filtre sur les congés pour les trier
// soit par ordre d'apparition, soit par ordre chronologique ou autre ».
//
// ⚠️ CE QUE ÇA CORRIGE, AU-DELÀ D'AJOUTER UN CHOIX. L'ordre était figé ET
// incohérent entre les deux blocs du MÊME écran : les souhaits en attente
// étaient triés par date d'arrivée croissante, les congés traités par date de
// congé DÉCROISSANTE. Deux logiques opposées côte à côte, et rien ne le disait
// — on ne pouvait ni comparer les deux listes, ni savoir laquelle on lisait.
//
// Un seul sélecteur commande désormais les deux : l'incohérence disparaît par
// construction, il n'y a plus qu'un ordre à l'écran et il est nommé.
// ============================================================

import type { Conge } from '@/types'

export type TriConges = 'chrono' | 'chrono-inverse' | 'arrivee' | 'vet'

export const LIBELLE_TRI_CONGES: Record<TriConges, string> = {
  chrono: 'Congé le plus proche',
  'chrono-inverse': 'Congé le plus lointain',
  arrivee: "Ordre d'arrivée des demandes",
  vet: 'Par vétérinaire',
}

/**
 * Compare deux congés selon l'ordre demandé.
 *
 * ⚠️ TOUJOURS un départage stable en dernier critère (`id`). Sans lui, deux
 * congés qui s'égalent sur le critère principal — même vétérinaire, ou deux
 * demandes enregistrées à la même seconde — peuvent changer de place d'un
 * rendu à l'autre. La liste bougerait alors sous les yeux sans qu'on ait rien
 * touché, et on chercherait la ligne qu'on venait de lire.
 *
 * `prenomDe` est injecté plutôt que résolu ici : le prénom vit dans la table
 * des vétérinaires, pas dans le congé. Il doit rendre une valeur non vide même
 * pour un identifiant inconnu — un tri ne doit pas dépendre du succès d'une
 * jointure.
 */
export function comparerConges(
  tri: TriConges,
  a: Conge,
  b: Conge,
  prenomDe: (id: string) => string,
): number {
  switch (tri) {
    case 'chrono':
      return a.date_debut.localeCompare(b.date_debut) || a.id.localeCompare(b.id)

    case 'chrono-inverse':
      return b.date_debut.localeCompare(a.date_debut) || a.id.localeCompare(b.id)

    case 'arrivee':
      // Une ligne sans `created_at` part à la FIN. Sans ce repli, la chaîne
      // vide se compare comme « plus petite que tout » et la donnée la moins
      // renseignée remonterait en tête de liste — exactement l'inverse de ce
      // qu'on veut voir en premier.
      return (
        (a.created_at || '9999').localeCompare(b.created_at || '9999') ||
        a.id.localeCompare(b.id)
      )

    case 'vet':
      // `'fr'` explicite : sans lui, « Élodie » se range après « Zoé ».
      return (
        prenomDe(a.veterinaire_id).localeCompare(prenomDe(b.veterinaire_id), 'fr') ||
        a.date_debut.localeCompare(b.date_debut) ||
        a.id.localeCompare(b.id)
      )
  }
}
