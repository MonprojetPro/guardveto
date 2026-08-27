// ============================================================
// GUARDVETO — Une date, écrite pour un humain
// ============================================================
// L'INCIDENT — retour MiKL du 2026-08-21 : « y a encore cet affichage anglais
// des dates, supprime toutes les dates comme ça de l'application ».
//
// Ce n'est pas de l'anglais, c'est pire : c'est le format de STOCKAGE
// (`2026-10-03`, norme ISO 8601) servi tel quel à un vétérinaire. Il apparaissait
// au milieu de phrases par ailleurs écrites en français :
//
//   « R16 : Anne-Sophie est en congé (2026-10-03→2026-10-03) mais de garde
//     le 2026-10-03 »
//
// Trois fois la même date, dans une notation que personne ne lit à voix haute.
// Le pire : elle est illisible là où elle compte le plus — dans la fenêtre de
// publication, au moment de décider si on diffuse un planning aux sept
// vétérinaires du cabinet.
//
// RÈGLE : aucune date `AAAA-MM-JJ` ne doit atteindre un écran, un e-mail ou un
// PDF. Elle passe par ce module, sans exception. Le format ISO reste la vérité
// en base et dans les échanges techniques — il n'est simplement jamais montré.
//
// ⚠️ `T12:00:00Z` et non `T00:00:00` : minuit UTC bascule à la veille dans les
// fuseaux à l'ouest, et le cabinet aurait lu « vendredi 2 » pour une garde du
// samedi 3. Midi laisse 12 heures de marge de chaque côté.
// ============================================================

/** Une date ISO (`2026-10-03`) devient un objet Date calé à midi UTC. */
function aMidi(iso: string): Date | null {
  const t = (iso ?? '').trim()
  if (!t) return null
  // On accepte aussi un horodatage complet : on ne garde que la partie date.
  const jour = t.slice(0, 10)
  const d = new Date(`${jour}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * « samedi 3 octobre 2026 » — la forme longue, pour un message isolé.
 *
 * Une date qu'on ne sait pas lire est rendue telle quelle plutôt qu'effacée :
 * un fragment technique reste plus utile qu'un vide, et signale le défaut au
 * lieu de le masquer (même principe que `lib/emails/echec.ts`).
 */
export function dateFr(iso: string): string {
  const d = aMidi(iso)
  if (!d) return iso
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** « sam. 3 oct. » — la forme courte, pour une énumération ou un tableau. */
export function dateFrCourte(iso: string): string {
  const d = aMidi(iso)
  if (!d) return iso
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** « 3 octobre 2026 » — sans le jour de la semaine. */
export function dateFrSansJour(iso: string): string {
  const d = aMidi(iso)
  if (!d) return iso
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * « du 3 au 7 octobre 2026 », et « le 3 octobre 2026 » quand c'est un seul jour.
 *
 * Le cas d'un seul jour n'est pas un détail de style : « en congé du 3 octobre
 * au 3 octobre » se lisait comme une erreur d'affichage, et faisait douter du
 * reste du message.
 */
export function periodeFr(debut: string, fin: string): string {
  if (!debut) return ''
  if (!fin || debut.slice(0, 10) === fin.slice(0, 10)) {
    return `le ${dateFrSansJour(debut)}`
  }
  return `du ${dateFrSansJour(debut)} au ${dateFrSansJour(fin)}`
}

/**
 * « 12 août à 14:32 » — un INSTANT, pas un jour.
 *
 * Les autres fonctions de ce module tronquent volontairement à la date et
 * calent à midi UTC : elles décrivent des JOURS de garde ou de congé, où
 * l'heure n'existe pas. Un horodatage est autre chose — « quand cette demande
 * est-elle arrivée », « quand a-t-elle été tranchée » — et l'heure y compte :
 * deux demandes du même jour ne se départagent que par elle.
 *
 * ⚠️ Fuseau `Europe/Paris` explicite, jamais celui du navigateur. Le cabinet
 * et son serveur ne sont pas au même endroit, et une décision prise à 00:30 à
 * Paris s'afficherait la veille pour qui consulte depuis un autre fuseau.
 *
 * L'année n'apparaît que si l'instant ne tombe pas dans l'année en cours :
 * « 12 août à 14:32 » se lit d'un coup d'œil, « 12 août 2026 à 14:32 » ajoute
 * du bruit onze mois sur douze — mais l'omettre sur une demande de l'an
 * dernier laisserait croire qu'elle est récente.
 */
export function horodatageFr(iso: string, maintenant: Date = new Date()): string {
  const t = (iso ?? '').trim()
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return iso

  const anneeCourante = new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(maintenant)
  const anneeCible = new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(d)

  const jour = d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    ...(anneeCible === anneeCourante ? {} : { year: 'numeric' }),
    timeZone: 'Europe/Paris',
  })
  const heure = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  })
  return `${jour} à ${heure}`
}
