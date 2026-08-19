// ============================================================
// GUARDVETO — La pastille d'écart (V2)
// ============================================================
// SOURCE UNIQUE de l'affichage d'un écart à la juste part. Elle sert aux
// compteurs de l'historique ET au bilan de période : les deux montrent la
// MÊME donnée (`bonus_malus.ecart_*`), ils doivent donc la montrer de la
// même façon. Deux pastilles différentes pour un même chiffre, c'est deux
// vocabulaires visuels — le piège déjà payé sur les modales.
//
// Les écarts arrivent déjà arrondis par `calculerBilans` (c'est la valeur
// qui part en base pour le rattrapage), donc on colore sur l'entier :
// 0 = dans la juste part, ±1 = surveillé, au-delà = à rattraper.
// ============================================================

export function Ecart({
  valeur,
  horsRepartition = false,
}: {
  valeur: number
  /** Dernier recours : il ne participe pas à la répartition, l'écart n'a pas de sens. */
  horsRepartition?: boolean
}) {
  if (horsRepartition) {
    return (
      <span className="ecart none" title="Dernier recours : hors répartition">
        —
      </span>
    )
  }
  const abs = Math.abs(valeur)
  const classe = abs === 0 ? 'ok' : abs === 1 ? 'warn' : 'bad'
  const titre =
    abs === 0
      ? 'Dans la juste part'
      : valeur > 0
        ? abs === 1
          ? 'A fait un peu plus que sa part : il en aura moins au prochain tour'
          : 'A fait nettement plus que sa part : à rattraper'
        : abs === 1
          ? 'A fait un peu moins que sa part : il en aura plus au prochain tour'
          : 'A fait nettement moins que sa part : à rattraper'
  const texte = valeur === 0 ? '=' : valeur > 0 ? `+${valeur}` : `−${abs}`
  return (
    <span className={`ecart ${classe}`} title={titre}>
      {texte}
    </span>
  )
}
