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
  sens = 'charge',
}: {
  valeur: number
  /**
   * B-200 — `repos` : la valeur compte du REPOS (week-ends libres d'un
   * salarié), pas une charge. « +2 » y veut dire « a eu plus de repos que les
   * autres », jamais « a fait plus que sa part ».
   */
  sens?: 'charge' | 'repos'
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
    sens === 'repos'
      ? abs === 0
        ? 'Autant de week-ends libres que la moyenne des salariés'
        : valeur > 0
          ? `${abs} week-end${abs > 1 ? 's' : ''} libre${abs > 1 ? 's' : ''} de plus que la moyenne des salariés`
          : `${abs} week-end${abs > 1 ? 's' : ''} libre${abs > 1 ? 's' : ''} de moins que la moyenne des salariés : à rattraper`
      : abs === 0
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
