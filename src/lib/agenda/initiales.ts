// ============================================================
// GUARDVETO — Initiales d'un vétérinaire pour l'agenda Google
// ============================================================
// Quand le véto n'a pas renseigné de `libelle_agenda` personnalisé, le titre
// de l'événement retombe sur ses initiales. Elles doivent identifier la
// personne à l'œil, dans un titre déjà chargé (base + rôle + horaires) — donc
// courtes, stables d'un jour sur l'autre, et jamais ambiguës entre deux vétos
// du même cabinet.
// ============================================================

/**
 * Toutes les initiales du prénom (y compris composé, séparé par tiret ou
 * espace) + la première lettre du NOM ENTIER — pas de chaque mot du nom.
 *
 * « Jean De Thoisy » → JD, pas JDT : un nom composé désigne une seule
 * personne, ses mots ne sont pas des prénoms qu'on énumère. Le prénom
 * composé, lui, EST fait de deux prénoms distincts (« Anne-Catherine » =
 * Anne + Catherine) : chacun mérite son initiale.
 *
 * Casse et accents : la sortie est toujours en majuscules, accents compris
 * (« Élodie » → É, pas E). Le titre d'événement affiché à l'écran doit
 * rester fidèle à l'orthographe du prénom — tronquer l'accent ferait lire
 * « E » comme si le prénom commençait autrement.
 */
export function initialesVeto(prenom: string, nom: string): string {
  const initialesPrenom = prenom
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((mot) => mot[0]?.toUpperCase() ?? '')
    .join('')

  const nomTrim = nom.trim()
  const initialeNom = nomTrim ? nomTrim[0].toUpperCase() : ''

  return `${initialesPrenom}${initialeNom}`
}

/** Une personne, telle que reçue par `initialesUniques`. */
export interface PersonnePourInitiales {
  prenom: string
  nom: string
  /** Identifiant stable (id véto) — sert de départage déterministe. */
  id: string
}

/**
 * Calcule les initiales de toute une liste, en départageant les collisions
 * de façon STABLE : jamais un suffixe aléatoire, jamais un ordre qui dépend
 * de la façon dont la base a renvoyé les lignes.
 *
 * Règle de départage : à initiales égales, on ajoute des lettres du NOM
 * (2e, puis 3e lettre, etc.) jusqu'à distinguer les personnes. Si le nom ne
 * suffit toujours pas (homonymes stricts), le départage final se fait sur
 * l'`id` trié par ordre alphabétique — donc toujours le même résultat, pour
 * la même liste, quel que soit l'ordre d'entrée ou le moment du calcul.
 *
 * Le tri d'entrée n'a AUCUNE influence sur le résultat : la fonction trie
 * elle-même par `id` avant de calculer, pour que deux appels avec la même
 * liste dans un ordre différent produisent exactement les mêmes initiales.
 */
export function initialesUniques(
  personnes: PersonnePourInitiales[],
): Map<string, string> {
  const resultat = new Map<string, string>()
  const parId = [...personnes].sort((a, b) => a.id.localeCompare(b.id))

  // Regroupe par initiales de base pour ne départager que les vraies collisions.
  const groupes = new Map<string, PersonnePourInitiales[]>()
  for (const p of parId) {
    const base = initialesVeto(p.prenom, p.nom)
    const groupe = groupes.get(base)
    if (groupe) groupe.push(p)
    else groupes.set(base, [p])
  }

  for (const [base, groupe] of groupes) {
    if (groupe.length === 1) {
      resultat.set(groupe[0].id, base)
      continue
    }
    // Collision : on rallonge avec les lettres suivantes du nom, une à une,
    // jusqu'à ce que chaque personne du groupe ait une valeur distincte.
    for (let longueur = 2; ; longueur++) {
      const vues = new Map<string, PersonnePourInitiales[]>()
      for (const p of groupe) {
        const nomTrim = p.nom.trim()
        const suffixe = nomTrim.slice(0, longueur).toUpperCase()
        const initialesPrenom = p.prenom
          .trim()
          .split(/[\s-]+/)
          .filter(Boolean)
          .map((mot) => mot[0]?.toUpperCase() ?? '')
          .join('')
        const candidate = `${initialesPrenom}${suffixe}`
        const liste = vues.get(candidate)
        if (liste) liste.push(p)
        else vues.set(candidate, [p])
      }
      const toutesUniques = [...vues.values()].every((l) => l.length === 1)
      // Le nom entier ne suffit pas à séparer tout le monde (homonymes
      // stricts) → dernier recours : l'id, dans l'ordre alphabétique déjà
      // fixé plus haut, donc déterministe.
      const nomEpuise = longueur > Math.max(...groupe.map((p) => p.nom.trim().length))
      if (toutesUniques || nomEpuise) {
        if (toutesUniques) {
          for (const [candidate, liste] of vues) {
            resultat.set(liste[0].id, candidate)
          }
        } else {
          groupe.forEach((p, index) => {
            resultat.set(p.id, `${base}${index + 1}`)
          })
        }
        break
      }
    }
  }

  return resultat
}
