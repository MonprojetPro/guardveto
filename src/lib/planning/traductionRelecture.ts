// ============================================================
// GUARDVETO — Traduire un message du validateur en français lisible
// ============================================================
// Extrait de `app/api/planning/relecture/route.ts` (B-122 lot 2) pour être
// réemployé par le panneau d'aperçu du planning : les deux affichent les
// mêmes violations, elles doivent les traduire de la même façon — une
// seconde traduction ailleurs finirait par diverger de celle-ci sans qu'on
// s'en aperçoive.
//
// ── POURQUOI CETTE TRADUCTION EXISTE ────────────────────────────────────────
//
// Les messages du validateur sont écrits pour un développeur : ils citent les
// vétérinaires par leur identifiant. Affichés tels quels, ils donnaient « le
// duo WE [00000000-0000-0000-0000-000000000006] diffère du duo vendredi soir »
// — vu par MiKL le 27/08. C'est le défaut B-023, déjà payé le 26/08 sur
// l'écran des règles. La traduction se fait à la FRONTIÈRE entre le moteur et
// l'écran : le validateur reste lisible par un développeur qui débogue.
// ============================================================

/**
 * Remplace tout identifiant technique par le prénom qu'il désigne.
 *
 * Un identifiant qui n'appartient à personne de l'équipe (véto retiré, donnée
 * orpheline) ne reste pas à l'écran non plus.
 */
export function enFrancais(texte: string, prenomParId: Map<string, string>): string {
  let sortie = texte
  for (const [id, prenom] of prenomParId) {
    // Avec et sans crochets : le validateur emploie les deux formes.
    sortie = sortie.split(`[${id}]`).join(prenom).split(id).join(prenom)
  }
  return sortie.replace(
    /\[?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]?/gi,
    'quelqu’un qui n’est plus dans l’équipe',
  )
}
