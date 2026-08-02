// ============================================================
// GUARDVETO — Nommer une violation en français
// ============================================================
// Le validateur étiquette chaque violation d'un CODE (`ROLE_TAG`, `R8`,
// `COMPOSITION`…). Ces codes servent à grouper et à déboguer — ils n'ont
// jamais rien eu à faire sous les yeux du cabinet. Le bandeau de re-validation
// les affichait pourtant tels quels, en `font-mono`, au milieu de la phrase :
// « ROLE_TAG · ROLE_TAG : Victor porte le tag "toutes"… » (retour MiKL du
// 2026-08-02 : « c'est quoi ce truc ? »).
//
// Ce module fait deux choses :
//   • il traduit le code en intitulé lisible ;
//   • il permet de REGROUPER, ce qui change tout : « 64 incohérences » est en
//     réalité deux causes répétées sur 64 dates. Une cause tient en une ligne,
//     64 lignes tiennent un écran entier.
//
// Un code inconnu ne casse rien : il retombe sur un intitulé générique. Le
// jour où le moteur en ajoute un, l'écran reste lisible en attendant qu'on
// l'ajoute ici.
// ============================================================

const INTITULES: Record<string, string> = {
  COUVERTURE:     'Créneau non couvert',
  COMPOSITION:    'Composition de l’équipe de garde',
  ROLE_TAG:       'Rôle interdit par une étiquette',
  SEULEMENT_AVEC: 'Binôme imposé',
  AU_PLUS_N:      'Nombre maximum de gardes dépassé',
  SERIE_MAX:      'Trop de gardes d’affilée',
  REPOS_SERIE:    'Repos après une série de gardes',
  SUCCESSION:     'Enchaînement de créneaux interdit',
  ESPACEMENT:     'Espacement entre deux gardes',
  CADENCE_WE:     'Cadence des week-ends',
  FREQ_WE:        'Fréquence des week-ends',
  XOR_DATES:      'Dates qui s’excluent',
  R1:             'Jour de repos fixe',
  R2:             'Enchaînement de gardes',
  R3:             'Espacement entre deux gardes',
  R6:             'Congé ou indisponibilité',
  R8:             'Répartition des week-ends',
  R9:             'Répartition des nuits',
  R16:            'Vétérinaire de dernier recours',
  R17:            'Effectif de garde',
  R21:            'Rôle de premier de garde',
  R22:            'Composition imposée du binôme',
}

/** Intitulé lisible d'un code de violation. Jamais le code brut à l'écran. */
export function intituleViolation(code: string): string {
  return INTITULES[code] ?? 'Règle non respectée'
}

export interface ViolationGroupee<T> {
  code: string
  intitule: string
  /** Les violations de cette cause, dans l'ordre où elles sont arrivées. */
  items: T[]
}

/**
 * Regroupe des violations par code, causes les plus nombreuses en tête.
 *
 * L'ordre importe : une cause qui touche 50 dates est le problème à régler en
 * premier, et c'est aussi celle qui noyait tout le reste quand la liste était
 * affichée à plat.
 */
export function grouperViolations<T extends { regle: string }>(
  violations: T[],
): ViolationGroupee<T>[] {
  const par = new Map<string, T[]>()
  for (const v of violations) {
    const liste = par.get(v.regle)
    if (liste) liste.push(v)
    else par.set(v.regle, [v])
  }
  return [...par.entries()]
    .map(([code, items]) => ({ code, intitule: intituleViolation(code), items }))
    .sort((a, b) => b.items.length - a.items.length)
}
