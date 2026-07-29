// ============================================================
// GUARDVETO — Banc de recette de Filou : répond-il JUSTE ?
// ============================================================
// SERVER-ONLY, et FACTURÉ : chaque exécution fait de vrais appels à l'API.
//
// POURQUOI CE BANC EXISTE (MiKL, 2026-07-29) : « ça montre qu'il y a encore des
// trous dans la raquette concernant ce que Filou peut voir, alors que je t'ai
// demandé de boucher tous les trous ».
//
// Il avait raison, et la nuance compte : les 50 outils ont bouché les trous de
// COUVERTURE — ce que Filou peut voir et faire. Le défaut du 29 juillet était
// d'une autre nature : il voyait bien le planning, mais l'outil lui racontait
// une structure fausse (« il faut toujours un 2ᵉ ») au lieu de lire le réglage
// réel du cabinet. C'est un trou de JUSTESSE, et aucun audit de code ne le
// rattrape durablement : il se reforme au prochain commit.
//
// Ce banc pose donc les vraies questions du cabinet et vérifie les réponses.
//
// DEUX PRINCIPES, tenus strictement :
//
// ① IL EST INDÉPENDANT DE CE QU'IL TESTE. Il lit la vérité DIRECTEMENT en base
//    — jamais à travers les outils de Filou. Un banc qui jugerait avec le même
//    code que celui qu'il contrôle validerait l'erreur en même temps qu'elle.
//    C'est le principe du validateur de planning, indépendant du moteur.
//
// ② IL NE JUGE QUE SUR DES FAITS, jamais sur le style. On ne compare pas des
//    phrases : on vérifie qu'un prénom réellement programmé est cité, qu'un
//    bouton est proposé quand un changement est demandé, et qu'aucun manque
//    n'est annoncé sur une garde complète. Un banc qui note la tournure sanctionne
//    le hasard.
//
// Les cas sont CONSTRUITS DEPUIS LA BASE, jamais écrits en dur : sur un cabinet
// où personne n'est en dernier recours, le cas correspondant est retiré plutôt
// que compté faux. La leçon vient du banc précédent, qui pénalisait les modèles
// quand ils avaient raison.
// ============================================================

import { faireTravaillerFilou } from './agentFilou'
import { outilsPour } from './outils/registre'
import type { ContexteOutil } from './outils/types'

/** Ce qu'un cas exige de la réponse. Tout est vérifiable mécaniquement. */
interface Cas {
  /** Ce qu'on tape dans la tablette. */
  question: string
  /** Ce que le cas contrôle, en français — affiché dans le rapport. */
  quoi: string
  /** Nom de l'outil dont une proposition est attendue. `null` = AUCUNE action
   *  ne doit être proposée (une question d'information n'appelle pas un bouton). */
  action: string | null
  /** Fragments qui DOIVENT apparaître dans la réponse (comparaison insensible à
   *  la casse et aux accents). Un prénom réellement programmé, par exemple. */
  attendus?: string[]
  /** Fragments qui ne doivent PAS apparaître. C'est ici que vivent les défauts
   *  déjà rencontrés : « second manquant » sur une garde complète. */
  interdits?: string[]
}

export interface VerdictCas {
  question: string
  quoi: string
  /** Vrai quand toutes les exigences du cas sont tenues. */
  ok: boolean
  /** Ce qui a échoué, en clair. Vide si le cas passe. */
  reproches: string[]
  /** Ce que Filou a répondu, pour pouvoir juger sur pièces. */
  reponse: string
  actionProposee: string | null
  actionAttendue: string | null
  outilsAppeles: string[]
  ms: number
  tours: number
}

export interface ResultatRecette {
  modele: string
  cas: VerdictCas[]
  reussis: number
  total: number
  msTotal: number
  /** Les cas écartés faute de données pour les construire, avec la raison. */
  ecartes: string[]
}

// ── Comparaison de texte : on juge le fond, pas l'orthographe ──

function aplatir(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function contient(texte: string, fragment: string): boolean {
  return aplatir(texte).includes(aplatir(fragment))
}

// ── La vérité, lue en base et NON à travers les outils de Filou ──

interface Faits {
  /** Une date où une garde est COMPLÈTE : autant de personnes que de places. */
  gardeComplete?: { date: string; prenoms: string[] }
  /** Une date où il manque réellement quelqu'un. */
  gardeIncomplete?: { date: string; manque: number }
  /** Quelqu'un actuellement marqué « dernier recours ». */
  dernierRecours?: string
  /** Un vétérinaire actif quelconque, pour les cas qui ont besoin d'un prénom. */
  unVeto?: string
}

/**
 * Photographie du cabinet, prise SANS passer par les outils de Filou.
 *
 * C'est le point le plus important du fichier : ces chiffres servent à juger ses
 * réponses. Les obtenir via `lire_gardes` reviendrait à lui demander de corriger
 * sa propre copie.
 */
async function releverLesFaits(ctx: ContexteOutil): Promise<Faits> {
  const faits: Faits = {}
  const aujourdhui = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date())

  const [{ data: vetsDb }, { data: gardesDb }, { data: creneauxDb }] = await Promise.all([
    ctx.supabase
      .from('veterinaires')
      .select('prenom, actif, dernier_recours')
      .eq('actif', true)
      .order('prenom'),
    ctx.supabase
      .from('planning_semaine')
      .select('date, type, premier_prenom, second_prenom')
      .gte('date', aujourdhui)
      .order('date')
      .limit(60),
    ctx.supabase.from('creneau_modele').select('code, nb_places').eq('cabinet_id', ctx.cabinetId),
  ])

  const vets = (vetsDb as Array<{ prenom: string; dernier_recours: boolean }> | null) ?? []
  faits.unVeto = vets[0]?.prenom
  faits.dernierRecours = vets.find((v) => v.dernier_recours)?.prenom

  // Places attendues par code de créneau. Un code porté par plusieurs profils
  // avec des nombres différents est ignoré : on ne sait pas lequel s'applique,
  // et un cas de test ambigu ne prouve rien.
  const places = new Map<string, number | null>()
  for (const c of (creneauxDb as Array<{ code: string | null; nb_places: number | null }> | null) ?? []) {
    if (!c.code) continue
    const n = typeof c.nb_places === 'number' ? c.nb_places : null
    if (!places.has(c.code)) places.set(c.code, n)
    else if (places.get(c.code) !== n) places.set(c.code, null)
  }

  for (const g of (gardesDb as Array<{
    date: string
    type: string
    premier_prenom: string | null
    second_prenom: string | null
  }> | null) ?? []) {
    const attendues = places.get(g.type)
    if (typeof attendues !== 'number') continue
    const prenoms = [g.premier_prenom, g.second_prenom].filter((p): p is string => Boolean(p))
    if (!faits.gardeComplete && prenoms.length > 0 && prenoms.length >= attendues) {
      faits.gardeComplete = { date: g.date, prenoms }
    }
    if (!faits.gardeIncomplete && prenoms.length < attendues) {
      faits.gardeIncomplete = { date: g.date, manque: attendues - prenoms.length }
    }
  }

  return faits
}

/** Une date ISO en toutes lettres, comme on la taperait dans la tablette. */
function enFrancais(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso + 'T12:00:00Z'))
}

/**
 * Les cas, construits sur les faits du jour.
 *
 * Chacun correspond à un défaut RÉELLEMENT rencontré en recette, pas à un
 * scénario imaginé : c'est ce qui rend le banc utile plutôt que rassurant.
 */
function construireCas(faits: Faits): { cas: Cas[]; ecartes: string[] } {
  const cas: Cas[] = []
  const ecartes: string[] = []

  // ① Le défaut du 29 juillet : un « second manquant » annoncé sur une garde
  //    pourtant complète, parce que l'outil supposait deux places partout.
  if (faits.gardeComplete) {
    cas.push({
      question: `Qui est de garde le ${enFrancais(faits.gardeComplete.date)} ?`,
      quoi: 'Garde COMPLÈTE : cite les bonnes personnes, et n’invente aucun manque',
      action: null,
      attendus: [faits.gardeComplete.prenoms[0]],
      interdits: ['manqu', 'trou', 'personne en second', 'second absent'],
    })
  } else {
    ecartes.push('Aucune garde complète à venir : le cas « pas de faux manque » est sans objet.')
  }

  // ② Le pendant du précédent : sur un vrai manque, il doit le dire. Sans ce
  //    cas, on pourrait « réussir » le banc en ne signalant plus jamais rien.
  if (faits.gardeIncomplete) {
    cas.push({
      question: `Est-ce qu’il manque quelqu’un le ${enFrancais(faits.gardeIncomplete.date)} ?`,
      quoi: 'Garde INCOMPLÈTE : le manque réel doit être signalé',
      action: null,
      attendus: ['manqu'],
    })
  } else {
    ecartes.push('Aucun trou de planning à venir : le cas « signale un vrai manque » est sans objet.')
  }

  // ③ Le défaut qui nous a fait tourner en rond : une demande de changement qui
  //    reste sans bouton. La phrase est celle de MiKL, mot pour mot.
  if (faits.dernierRecours) {
    cas.push({
      question: `${faits.dernierRecours} peut désormais travailler le mardi soir`,
      quoi: 'Demande de changement : un bouton doit être proposé (dernier recours)',
      action: 'modifier_veterinaire',
    })
  } else {
    ecartes.push('Personne n’est en dernier recours : le cas « lever le dernier recours » est sans objet.')
  }

  // ④ Création de règle : la capacité historique de Filou.
  if (faits.unVeto) {
    cas.push({
      question: `${faits.unVeto} ne fait jamais de garde le mercredi`,
      quoi: 'Nouvelle contrainte : une règle doit être proposée',
      action: 'creer_regle',
    })
  }

  // ⑤ Le zèle inverse : une question d'information ne doit JAMAIS déboucher sur
  //    un bouton. C'est le garde-fou du second gardien, qui pourrait sinon
  //    proposer une action à tout propos.
  cas.push({
    question: 'Combien de gardes de week-end ont été faites cette période ?',
    quoi: 'Simple question : aucune action ne doit être proposée',
    action: null,
  })

  // ⑥ L'aveu d'ignorance. Un assistant qui invente sur un planning de gardes est
  //    plus dangereux qu'un assistant qui dit non.
  cas.push({
    question: 'Commande trente kilos de croquettes pour le cabinet',
    quoi: 'Hors périmètre : il doit le dire, sans rien inventer ni proposer',
    action: null,
  })

  return { cas, ecartes }
}

/** Confronte une réponse à ce que le cas exige. */
function juger(
  cas: Cas,
  reponse: string,
  actionProposee: string | null,
): string[] {
  const reproches: string[] = []

  if (cas.action && actionProposee !== cas.action) {
    reproches.push(
      actionProposee
        ? `propose « ${actionProposee} » au lieu de « ${cas.action} »`
        : `ne propose aucune action alors que « ${cas.action} » était attendue`,
    )
  }
  if (!cas.action && actionProposee) {
    reproches.push(`propose « ${actionProposee} » alors qu’aucune action n’était attendue`)
  }
  for (const attendu of cas.attendus ?? []) {
    if (!contient(reponse, attendu)) reproches.push(`ne mentionne pas « ${attendu} »`)
  }
  for (const interdit of cas.interdits ?? []) {
    if (contient(reponse, interdit)) reproches.push(`annonce « ${interdit} » à tort`)
  }
  return reproches
}

/**
 * Joue tous les cas, l'un après l'autre.
 *
 * En SÉRIE et non en parallèle : ces appels partagent les limites de débit du
 * cabinet, et une salve de six requêtes simultanées ferait échouer des cas pour
 * une raison qui n'a rien à voir avec la justesse des réponses.
 */
export async function lancerBancRecette(ctx: ContexteOutil): Promise<ResultatRecette> {
  const faits = await releverLesFaits(ctx)
  const { cas, ecartes } = construireCas(faits)
  const outils = outilsPour(ctx)
  const aujourdhui = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date())

  const verdicts: VerdictCas[] = []
  const depart = Date.now()
  let modele = ''

  for (const c of cas) {
    const issue = await faireTravaillerFilou(c.question, outils, ctx, aujourdhui)
    modele = issue.mesure?.modele ?? modele

    if (issue.erreur) {
      verdicts.push({
        question: c.question,
        quoi: c.quoi,
        ok: false,
        reproches: [`l’appel a échoué : ${issue.erreur}`],
        reponse: '',
        actionProposee: null,
        actionAttendue: c.action,
        outilsAppeles: issue.outilsAppeles,
        ms: issue.mesure?.ms ?? 0,
        tours: issue.mesure?.tours ?? 0,
      })
      continue
    }

    // On juge sur TOUT ce que la personne lit : le mot de la tablette, la
    // réponse du tableau et le détail. Un défaut caché dans une ligne compte
    // autant qu'un défaut en titre.
    const reponse = [issue.mot, issue.introduction, ...issue.lignes].filter(Boolean).join('\n')
    const actionProposee = issue.action?.outil ?? null
    const reproches = juger(c, reponse, actionProposee)

    verdicts.push({
      question: c.question,
      quoi: c.quoi,
      ok: reproches.length === 0,
      reproches,
      reponse,
      actionProposee,
      actionAttendue: c.action,
      outilsAppeles: issue.outilsAppeles,
      ms: issue.mesure?.ms ?? 0,
      tours: issue.mesure?.tours ?? 0,
    })
  }

  return {
    modele,
    cas: verdicts,
    reussis: verdicts.filter((v) => v.ok).length,
    total: verdicts.length,
    msTotal: Date.now() - depart,
    ecartes,
  }
}
