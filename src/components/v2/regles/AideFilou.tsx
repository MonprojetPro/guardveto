'use client'

// ============================================================
// GUARDVETO V2 — Le bouton « Filou » d'une section sans bouton d'ajout
// ============================================================
// Certaines cartes de cet écran n'ont PAS de « + Ajouter » : l'équilibrage des
// charges a ses six lignes câblées dans le moteur, les préférences du planning
// leurs quatre égards. On ne pose pas une septième charge ni un cinquième égard
// depuis un formulaire.
//
// Ces cartes se retrouvaient donc muettes en haut à droite, à l'endroit précis
// où l'œil va chercher quoi faire. La V1 répondait par un encart en PIED de
// carte — un pavé de texte gris, tout en bas, qu'on ne lit qu'après avoir
// renoncé. MiKL : « cet encart Filou est vraiment nul, elle est tout en bas,
// discrète visuellement, alors que le client pourrait en avoir besoin ».
//
// D'où ce bouton, posé À LA PLACE du « + Ajouter » manquant : même position,
// même poids visuel, même promesse — « voilà par où on agit sur cette
// section ». Il dit aussi, sans le formuler, que l'assistant du cabinet
// s'appelle Filou.
//
// Il NAVIGUE, rien de plus : c'est le trajet de Filou au rebord
// (`#filou=regles`), et l'accueil accroche la conversation sur le bon sujet.
// Aucun état, aucun appel — un bouton qui promettrait plus mentirait.
// ============================================================

import { useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'

interface Props {
  /**
   * Ce que Filou peut faire ICI, en une poignée de mots — repris dans
   * l'infobulle et le libellé accessible. « Demander à Filou » tout court ne
   * dit pas ce qu'on peut lui demander ; sur une carte d'équilibrage, la
   * question n'est pas la même que sur une carte de préférences.
   */
  sujet: string
}

export function AideFilou({ sujet }: Props) {
  const router = useRouter()

  return (
    <button
      type="button"
      className="btn btn-filou btn-sm"
      onClick={() => router.push('/accueil#filou=regles')}
      title={sujet}
      aria-label={`Demander à Filou — ${sujet}`}
    >
      <MessageCircle size={15} aria-hidden="true" />
      Demander à Filou
    </button>
  )
}
