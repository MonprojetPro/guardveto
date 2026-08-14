// ============================================================
// GUARDVETO — /compteurs : redirection vers /historique
// ============================================================
// L'écran V1 vivait ici. Il a été entièrement repris par `/historique`
// (V2), qui répond à la même question — qui a fait quoi, sur quelle
// période — en y ajoutant les dépannages, le cumul inter-périodes et la
// gestion des périodes elles-mêmes.
//
// Les deux ont coexisté : deux écrans pour les mêmes chiffres, dans deux
// habillages différents, et la barre latérale menait encore ICI. Rien ne
// disait lequel faisait foi.
//
// On ne supprime pas l'URL pour autant : elle est dans les favoris de
// l'équipe et dans d'anciens e-mails. Elle redirige, en gardant les
// filtres — un lien « compteurs de la période X » reste un lien valide.
// ============================================================

import { redirect } from 'next/navigation'

export default async function CompteursRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  // `mode`, `periodeId`, `debut`, `fin`, `perimetre` portent exactement le même
  // sens des deux côtés : `/historique` a repris la grammaire d'URL de la V1.
  const query = new URLSearchParams()
  for (const [cle, valeur] of Object.entries(params)) {
    if (typeof valeur === 'string') query.set(cle, valeur)
    else if (Array.isArray(valeur) && valeur[0]) query.set(cle, valeur[0])
  }

  const suffixe = query.size > 0 ? `?${query.toString()}` : ''
  redirect(`/historique${suffixe}`)
}
