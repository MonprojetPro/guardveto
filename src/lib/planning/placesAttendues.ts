// ============================================================
// GUARDVETO — Combien de personnes une garde attend-elle ?
// ============================================================
// Fonction PURE, sans base et sans appel réseau : elle prend des faits déjà lus
// et rend un nombre. C'est ce qui la rend testable gratuitement, autant de fois
// qu'on veut — et c'est tout l'objet de ce fichier.
//
// POURQUOI ELLE EXISTE (MiKL, 2026-07-29 : « tes tests me coûtent à chaque
// fois, trouve un autre moyen »). Le raisonnement tient en deux constats :
//
//   • Le banc payant est passé 5/5 sur un système qui avait deux trous.
//   • Ces deux trous ont été trouvés par des REQUÊTES, pas par le modèle.
//
// La règle qui suit est donc sortie de la boucle de Filou pour devenir une
// fonction qu'un test vérifie à chaque build, sans dépenser un centime. Le
// modèle ne décide de rien ici : il ne fait que lire le nombre qu'on lui donne.
//
// DEUX PIÈGES, tous deux payés en production le 29 juillet :
//
//   ① Deux vocabulaires de créneaux qui ne se parlent pas. Le planning stocke
//      'semaine' / 'weekend' / 'ferie' ; le catalogue déclare 'semaine_soir' /
//      'vendredi_soir' / 'weekend' / 'ferie'. Les rapprocher par égalité de code
//      laisse toutes les nuits de semaine sans réponse.
//
//   ② Le catalogue déclare 2 places pour « semaine_soir », mais une nuit de
//      semaine suit en réalité l'effectif de sa PÉRIODE (1 en été, 2 en hiver,
//      sauf réglage). Se fier au catalogue ferait annoncer un manque chaque nuit.
// ============================================================

/** Une période, réduite à ce qui décide de l'effectif d'une nuit de semaine. */
export interface PeriodeEffectif {
  date_debut: string
  date_fin: string
  saison: 'ete' | 'hiver'
  /** Surcharge portée par la période elle-même. */
  nb_vetos_semaine_soir: number | null
  profil_id?: string | null
}

/** Un profil de planning, même réduction. */
export interface ProfilEffectif {
  id: string
  nb_vetos_semaine_soir: number | null
}

/** Le catalogue : combien de places par code de créneau. `null` = indéterminé
 *  (plusieurs profils en désaccord sur ce code). */
export type PlacesParCode = Map<string, number | null>

/**
 * Traduit le vocabulaire du PLANNING vers celui du CATALOGUE.
 *
 * Miroir volontaire de `mapDbTypeToEngine` (lib/crise/contexte.ts), qui sert au
 * moteur et aux absences. La duplication est assumée : ce module doit pouvoir
 * être testé sans traîner le moteur derrière lui. Si la correspondance change
 * là-bas, le test `placesAttendues` tombe — c'est le but.
 */
export function codeCatalogue(typePlanning: string): string {
  // ⚠️ 'ferie' suit 'semaine_soir', et ce n'est pas une erreur de recopie : le
  // moteur traite un jour férié comme un soir de semaine, donc un férié en été
  // n'attend qu'UNE personne même si le catalogue déclare 2 places pour son
  // créneau. Aligner Filou sur le catalogue le ferait crier au manque sur
  // chaque férié d'été — le bug d'origine, transposé.
  //
  // Le catalogue et le moteur se contredisent donc sur ce point précis. Filou
  // dit ce QUI EST (le moteur a produit le planning) ; le contrôle de cohérence,
  // lui, signale le désaccord pour qu'une décision soit prise.
  if (typePlanning === 'semaine' || typePlanning === 'ferie') return 'semaine_soir'
  return typePlanning
}

/**
 * L'effectif exigé une nuit de semaine, avec la précédence du solveur :
 * période > profil > saison. Toute autre précédence produirait un planning jugé
 * faux par le validateur alors que le moteur l'a construit juste.
 */
export function effectifNuitSemaine(
  periode: PeriodeEffectif,
  profils: ReadonlyMap<string, ProfilEffectif>,
): number {
  if (typeof periode.nb_vetos_semaine_soir === 'number') return periode.nb_vetos_semaine_soir
  const profil = periode.profil_id ? profils.get(periode.profil_id) : undefined
  if (profil && typeof profil.nb_vetos_semaine_soir === 'number') return profil.nb_vetos_semaine_soir
  return periode.saison === 'hiver' ? 2 : 1
}

/**
 * Combien de personnes cette garde attend-elle ? `null` quand on ne peut pas le
 * savoir — et c'est une réponse à part entière : mieux vaut se taire que
 * d'annoncer un trou imaginaire.
 */
export function placesAttendues(args: {
  /** Type tel que stocké dans le planning. */
  typePlanning: string
  date: string
  catalogue: PlacesParCode
  periodes: readonly PeriodeEffectif[]
  profils: ReadonlyMap<string, ProfilEffectif>
}): number | null {
  const code = codeCatalogue(args.typePlanning)

  // Une nuit de semaine est le SEUL créneau à deux maîtres : son catalogue et
  // l'effectif de sa période. Le moteur retient le plus petit des deux
  // (`Math.min(nbPlaces, effectif)` dans `solver.ts`) — il faut retenir le même
  // ici, sinon l'écran annonce un manque que le moteur n'avait jamais eu
  // l'intention de pourvoir : un cabinet réglé à 2 le soir mais dont le
  // créneau ne déclare qu'une place verrait un trou imaginaire sur chaque nuit.
  if (code === 'semaine_soir') {
    const periode = args.periodes.find((p) => p.date_debut <= args.date && args.date <= p.date_fin)
    if (!periode) return null
    const effectif = effectifNuitSemaine(periode, args.profils)
    const duCatalogue = args.catalogue.get(code)
    return typeof duCatalogue === 'number' ? Math.min(duCatalogue, effectif) : effectif
  }

  // Tout le reste suit le nombre de places de son créneau. On tente le code brut
  // d'abord : un créneau sur-mesure porte le même code des deux côtés.
  const direct = args.catalogue.get(args.typePlanning)
  if (typeof direct === 'number') return direct
  const traduit = args.catalogue.get(code)
  return typeof traduit === 'number' ? traduit : null
}

/** Le manque réel sur une garde. `null` quand l'attendu est indéterminé. */
export function manqueSurGarde(attendues: number | null, pourvues: number): number | null {
  return attendues === null ? null : Math.max(0, attendues - pourvues)
}
