// ============================================================
// GUARDVETO — Dire le rattrapage d'équité en français (B-196 / B-211)
// ============================================================
// Les phrases que l'écran montre à l'admin, et LEUR SEULE SOURCE.
//
// POURQUOI UN MODULE ET PAS DES FONCTIONS DANS LA CARTE
//
// Deux cartes montrent maintenant le rattrapage : « Bilan de la période »
// quand la période est close, et « Ce que le moteur va rattraper » quand
// elle est encore en préparation (B-211). Laisser chacune écrire ses
// propres phrases, c'est la garantie qu'elles finiront par dire deux
// choses différentes du même chiffre — le défaut exact que le lot 0 vient
// de corriger côté moteur, où trois juges avaient trois vues de l'équité.
//
// Ce fichier est PUR : aucun React, aucune lecture de base. Il se teste
// seul, et les deux cartes n'ont rien à décider.
// ============================================================

import type { CumulEcarts, ReportEquite } from '@/engine/grand-livre-equite'

/** « 2 week-ends », « 1 nuit de semaine » — au bon nombre, en français. */
export function enClair(n: number, singulier: string, pluriel: string): string {
  const abs = Math.abs(n)
  return `${abs} ${abs > 1 ? pluriel : singulier}`
}

/**
 * Ce que le moteur rattrape SUR LA PÉRIODE AFFICHÉE, dit en français.
 *
 * ⚠️ « au tour suivant » était FAUX et la colonne s'est appelée ainsi
 * quelques heures le 2026-11-13 : le grand livre est chargé à la date de
 * début de la période SÉLECTIONNÉE, et le sélecteur permet d'ouvrir
 * n'importe laquelle des périodes passées. Anne-So consultant « Hiver P1 »
 * aurait lu l'état d'il y a deux périodes en croyant voir la prochaine
 * génération. « Sur cette période » est vrai dans les deux cas : pour une
 * période close, c'est ce qui a été appliqué ; pour celle en préparation,
 * c'est ce qui le sera.
 *
 * Le signe du report suit la convention du moteur (`> 0` = doit faire
 * PLUS). On ne montre JAMAIS ce signe tel quel : « +1 » ne veut rien dire
 * pour l'admin, « une garde de week-end en plus » si.
 */
export function phraseRattrapage(r: ReportEquite | undefined): string | null {
  if (!r) return null
  const bouts: string[] = []
  if (r.we !== 0) bouts.push(`${enClair(r.we, 'week-end', 'week-ends')} ${r.we > 0 ? 'en plus' : 'en moins'}`)
  if (r.semaine !== 0) bouts.push(`${enClair(r.semaine, 'nuit de semaine', 'nuits de semaine')} ${r.semaine > 0 ? 'en plus' : 'en moins'}`)
  if (r.feries !== 0) bouts.push(`${enClair(r.feries, 'jour férié', 'jours fériés')} ${r.feries > 0 ? 'en plus' : 'en moins'}`)
  return bouts.length > 0 ? bouts.join(', ') : null
}

/** Le cumul réel, pour l'infobulle — c'est lui qui dit si le rattrapage est partiel. */
export function phraseCumul(
  c: CumulEcarts | undefined,
  nbPeriodes: number,
  horsRotation: boolean,
  chantierOuvert = false,
): string {
  if (!c) return 'Aucun écart sur les périodes passées.'

  // ⚠️ Le grand livre cumule TOUT LE MONDE mais ne donne un report qu'à
  // l'effectif : un vétérinaire de dernier recours a un cumul et aucun
  // rattrapage. Sans cette phrase, l'infobulle lui promettait de rendre ses
  // douze gardes période après période — ce qui n'arrivera jamais, puisqu'il
  // est retiré de l'effectif avant même d'être candidat. Une promesse
  // rassurante que personne ne va vérifier : exactement ce que la règle
  // « le tableau ne peut pas se taire » interdit, pris par l'autre bout.
  if (horsRotation) {
    return (
      'Hors rotation (dernier recours) : cet écart est réel, mais il ne sera ' +
      'pas rattrapé — ce vétérinaire n’est pas candidat aux gardes.'
    )
  }
  const bouts: string[] = []
  if (c.we !== 0) bouts.push(`${enClair(c.we, 'week-end', 'week-ends')} ${c.we > 0 ? 'de plus' : 'de moins'}`)
  if (c.semaine !== 0) bouts.push(`${enClair(c.semaine, 'nuit de semaine', 'nuits de semaine')} ${c.semaine > 0 ? 'de plus' : 'de moins'}`)
  if (c.feries !== 0) bouts.push(`${enClair(c.feries, 'jour férié', 'jours fériés')} ${c.feries > 0 ? 'de plus' : 'de moins'}`)
  if (bouts.length === 0) return `À sa juste part sur ${enClair(nbPeriodes, 'période close', 'périodes closes')}.`

  const debut =
    `Avant cette période, sur ${enClair(nbPeriodes, 'période close', 'périodes closes')} : ` +
    `${bouts.join(', ')} que sa part.`

  // ⚠️ LA PHRASE SUR LE PLAFOND NE VAUT QUE PORTE OUVERTE. Sans ce test,
  // un cabinet hors chantier lisait « rattrapage étalé, au plus un week-end
  // par période » alors que son moteur applique l'ancien calcul, qui n'a
  // AUCUN plafond et ne regarde que la période précédente. Décrire un
  // mécanisme que le cabinet n'a pas, c'est la même faute que la colonne
  // « Report du tour d'avant » qui montrait un tiers de la dette.
  return chantierOuvert
    ? debut + ' Le rattrapage est volontairement étalé — au plus un week-end, ' +
      'un jour férié et deux nuits de semaine par période.'
    : debut
}

/**
 * Ce que le grand livre transmet aux écrans (sérialisable : pas de fonctions).
 *
 * Vit ici et non dans une carte : les deux cartes le reçoivent, et la page
 * qui le construit n'a pas à importer un composant client pour un type.
 */
export interface GrandLivreAffiche {
  cumul: Record<string, CumulEcarts>
  report: Record<string, ReportEquite>
  /** Combien de périodes closes ont vraiment un bilan — on le DIT à l'écran. */
  nbPeriodes: number
  /** Periodes closes avant celle-ci, bilan ou pas (cf. `GrandLivre`). */
  nbPeriodesCloses?: number
  /** Les vetos hors effectif d'equite — DONNE, jamais deduit. */
  horsRotation?: string[]
  /**
   * La porte de chantier `equite-grand-livre` est-elle ouverte ici ?
   *
   * Fermée, les chiffres viennent de l'ancien calcul (week-ends de la seule
   * période précédente, SANS plafond) : l'écran n'a alors pas le droit de
   * parler de rattrapage étalé. Absent → traité comme fermé, le défaut sûr.
   */
  chantierOuvert?: boolean
  /**
   * Lecture impossible. Sans ce champ, un historique illisible s'afficherait
   * comme un historique VIDE : la colonne de rattrapage disparaîtrait, et
   * l'admin lirait « personne ne traîne rien » — une bonne nouvelle que
   * personne ne va vérifier. C'est la règle « le tableau ne peut pas se
   * taire » : un vide dû à une panne doit se dire.
   */
  erreur?: string | null
}

/**
 * Ce véto est-il hors de l'effectif d'équité (dernier recours) ?
 *
 * ⚠️ ON LIT LA LISTE, ON NE DEDUIT PLUS RIEN. La version precedente
 * concluait « hors rotation » d'un cumul sans report — or un report
 * entierement nul n'est pas enregistre, donc tout veto dont les ecarts
 * s'annulent (+1 une periode, -1 la suivante) etait declare hors
 * rotation. Anne-So lisait, nommement, qu'un de ses titulaires n'etait
 * pas candidat aux gardes : faux, et dans l'ecran dont le metier est
 * l'equite. Releve par la revue du 2026-11-13.
 */
export function horsRotation(livre: GrandLivreAffiche, vetId: string): boolean {
  return (livre.horsRotation ?? []).includes(vetId)
}

/**
 * Pourquoi il n'y a rien a rattraper — en distinguant les TROIS cas.
 *
 * Les deux premiers se ressemblent et n'ont pas le meme remede : sans
 * periode close il n'y a rien a faire, mais une periode close dont le
 * bilan n'a jamais ete calcule se debloque en un clic. Les confondre,
 * c'est afficher une bonne nouvelle a la place d'une action a faire.
 */
export function phraseRienARattraper(livre: GrandLivreAffiche): string {
  const closes = livre.nbPeriodesCloses ?? livre.nbPeriodes
  if (closes === 0) {
    return 'Aucune période close avant celle-ci : il n’y a encore rien à rattraper.'
  }
  if (livre.nbPeriodes === 0) {
    return (
      `${enClair(closes, 'période close', 'périodes closes')} avant celle-ci, mais ` +
      'aucune n’a de bilan calculé : le rattrapage ne peut pas être établi. ' +
      'Ouvrez la période concernée et cliquez « Calculer le bilan ».'
    )
  }
  // ⚠️ `enClair` prefixe le nombre : lui passer « la periode close »
  // produisait « sur 3 les periodes closes ». L'article se decide ici.
  const closesDites =
    livre.nbPeriodes === 1
      ? 'la période close'
      : `les ${livre.nbPeriodes} périodes closes`
  return `Tout le monde est à sa juste part sur ${closesDites} : rien à rattraper.`
}

/** Ce que le moteur de CE cabinet sait rattraper — la porte change la portee. */
export function phrasePortee(livre: GrandLivreAffiche): string {
  return livre.chantierOuvert
    ? 'Ce tableau ne vient pas de cette période : il vient des périodes déjà ' +
      'closes, et dit ce que la prochaine génération va corriger. Le rattrapage ' +
      'est volontairement étalé — au plus un week-end, un jour férié et deux ' +
      'nuits de semaine par période.'
    : 'Sur ce cabinet, le moteur ne rattrape que les WEEK-ENDS, et seulement ' +
      'ceux de la période précédente — ni les nuits de semaine, ni les jours ' +
      'fériés, ni les périodes plus anciennes. Le rattrapage complet est en ' +
      'cours de mise au point et n’est pas encore diffusé ici.'
}
