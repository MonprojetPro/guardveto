// ============================================================
// GUARDVETO — L'outil qui pose une réponse sur le tableau
// ============================================================
// SERVER-ONLY (comme les autres outils), mais celui-ci ne touche à rien : il
// sert uniquement à décider OÙ la réponse s'affiche.
//
// Le partage voulu par MiKL : la tablette porte la conversation, le tableau
// porte ce qu'on vient chercher. Une liste de règles, un tableau de compteurs
// ou un planning de la semaine dans la colonne étroite de la tablette, c'est
// illisible — et ça disparaît au message suivant.
//
// On ne devine pas « cette réponse est longue, donc elle va à droite » : une
// heuristique de longueur se trompe dans les deux sens. C'est Filou qui
// décide, en appelant cet outil, parce que le geste peut lui être décrit.
// ============================================================

import { z } from 'zod'
import type { OutilAffichage } from './types'

const ParamsAfficher = z.object({
  titre: z
    .string()
    .describe(
      'Le titre de la fenêtre, court et concret. Ex. « Les règles d’Anne-Catherine », « Compteurs de l’été 2026 ».',
    ),
  introduction: z
    .string()
    .describe(
      'Une ou deux phrases qui répondent à la question. C’est ce qui se lit en premier, en gros.',
    ),
  lignes: z
    .array(z.string())
    .describe(
      'Le détail, un élément par ligne, déjà rédigé en français. Liste vide si l’introduction suffit.',
    ),
  mot_dans_la_conversation: z
    .string()
    .describe(
      'La phrase courte qui restera dans la tablette pour dire ce que tu affiches. Une ligne, pas plus.',
    ),
})

export const afficherSurLeTableau: OutilAffichage<typeof ParamsAfficher> = {
  genre: 'affichage',
  nom: 'afficher_sur_le_tableau',
  description: `Affiche ta réponse sur le grand tableau du cabinet, à côté de la conversation.

Appelle-le CHAQUE FOIS que ta réponse est autre chose qu'une phrase : une liste, plusieurs éléments, des chiffres, un planning, un état des lieux. La tablette est étroite — tout ce qui dépasse deux phrases y devient illisible et disparaît au message suivant.

Reste dans la conversation seulement pour : une réponse d'une phrase, une question de précision, un refus expliqué.

Rédige entièrement les lignes en français avant d'appeler l'outil : ce que tu écris ici s'affiche tel quel, personne ne le retouche.`,
  params: ParamsAfficher,
}
