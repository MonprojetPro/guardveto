// ============================================================
// GUARDVETO V2 — Données de l'accueil « épicentre »
// ============================================================
// L'accueil V2 (maquette M6) affiche une barre de navigation à pastilles et
// « le coup d'œil du matin » : quatre fiches qui résument la journée. La
// maquette les remplissait de texte écrit à la main ; ici tout vient de la
// base. Rien n'est simulé — une fiche qui annonce « planning cohérent » doit
// avoir réellement interrogé le validateur, sinon elle ment (doc v2/11 §2).
//
// TOUT est best-effort : l'accueil ne doit jamais tomber en panne parce qu'un
// compteur secondaire n'a pas pu être calculé. Un bloc absent s'affiche en
// creux, il ne casse pas la page.
// ============================================================

import type { createClient } from '@/lib/supabase/server'
import type { Periode, StatutPeriode, Veterinaire } from '@/types'
import { phraseRegle } from '@/lib/regles/libelle'
import { lignesDesPeriodes, periodesVisibles } from '@/lib/planning/diffusion'
import { MATIERE_VIDE, type MatiereFilou } from '@/lib/v2/filou-origine'
import {
  catalogueDuProfil,
  chargerHorairesCabinet,
  horaireLisible,
  natureCreneau,
  type CatalogueHoraires,
} from './horairesCreneaux'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Date du jour au format ISO, dans le fuseau du cabinet (pas en UTC :
 *  entre minuit et 2 h du matin, l'UTC est encore la veille). */
export function aujourdhuiISO(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export interface GardeDuSoir {
  date: string
  type: string
  premier: { prenom: string; couleur: string } | null
  second: { prenom: string; couleur: string } | null
  /** Horaire RÉEL du créneau, lu en base — `null` si le catalogue est muet.
   *  Calculé ici et pas dans le composant : l'écran n'a pas à redécouvrir que
   *  le vendredi rangé sous « weekend » est en fait le créneau du vendredi. */
  horaire: string | null
  /** « nuit de semaine », « vendredi soir », « week-end », « jour férié ». */
  nature: string
}

/** Les pastilles de la barre — partagées par tous les écrans V2.
 *
 * Le dock a longtemps porté `nbReglesFermes` / `nbReglesSouples`, affichés sur
 * l'entrée « Organisation » (« · 10 règles fermes, 8 souples »). MiKL :
 * « ça n'a aucune valeur » — et il a raison : un compteur de règles ne dit ni
 * si le planning sortira, ni ce qu'il faut faire. Retirés le 2026-08-01, avec
 * la requête `regles_cabinet` qu'ils coûtaient sur CHAQUE écran V2.
 * (L'Épicentre garde les siens : là-bas ils décrivent une période précise
 * qu'on s'apprête à générer — cf. `RecapPeriode`.) */
export interface DonneesDock {
  nbSouhaits: number
  nbEchanges: number
  nbVetos: number
  agendaConnecte: boolean
  libellePlanning: string
  statutPlanning: StatutPeriode | null
}

export interface SouhaitEnAttente {
  id: string
  prenom: string
  couleur: string
  dateDebut: string
  dateFin: string
  depose: string
}

/** Ce qui est déjà en place pour la prochaine période à générer/publier. */
export interface RecapPeriode {
  libelle: string
  saison: 'ete' | 'hiver'
  dateDebut: string
  dateFin: string
  nbSemaines: number
  profil: string | null
  effectifNuitSemaine: number | null
  nbVetos: number
  nbReglesFermes: number
  nbReglesSouples: number
  nbCongesValides: number
  /** Date limite pour publier en respectant le préavis d'un mois. */
  limitePublication: string
  statut: StatutPeriode
}

export interface DonneesAccueil {
  veterinaire: Veterinaire
  estAdmin: boolean
  /** Période qui couvre aujourd'hui (ou la plus proche à venir). */
  periodeCourante: Periode | null
  /** Prochaine période encore en brouillon — celle qu'il reste à publier. */
  periodeAPublier: Periode | null
  /** Jours restants avant la date limite de publication (préavis d'un mois). */
  joursAvantPublication: number | null
  dock: DonneesDock
  ceSoir: GardeDuSoir | null
  demain: GardeDuSoir | null
  /** Souhaits de congé en attente de décision, du plus ancien au plus récent. */
  souhaits: SouhaitEnAttente[]
  /** Récap de la prochaine période à préparer (null si tout est publié). */
  recapPeriode: RecapPeriode | null
  /** Périodes publiées à re-vérifier côté client (fiche « cohérence »). */
  periodesPubliees: string[]
  /** De quoi écrire les exemples de Filou avec la VRAIE matière du cabinet —
   *  jamais un prénom ou une date de fantaisie (cf. `filou-origine.ts`).
   *  `null` hors administrateur : lui seul a le champ de saisie. */
  matiereFilou: MatiereFilou | null
}

/** Préavis dû à l'équipe avant le début d'une période, en jours. */
const PREAVIS_JOURS = 30

/** Force du seuil : au-delà, la règle n'est plus « ferme » (cf. mapReglesCabinet). */
const FORCES_FERMES = ['invariant', 'reglementaire', 'jamais']

function ecartEnJours(depuis: string, jusqua: string): number {
  const a = Date.parse(depuis + 'T00:00:00Z')
  const b = Date.parse(jusqua + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

/** Retire n jours à une date ISO (calcul en UTC pur : pas de dérive DST). */
function moinsJours(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function plusJours(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Ligne brute de `conges` jointe au vétérinaire demandeur. */
interface LigneSouhait {
  id: string
  created_at: string
  date_debut: string
  date_fin: string
  // Supabase renvoie l'objet joint, ou un tableau selon la cardinalité inférée.
  veterinaires?: { prenom: string; couleur: string } | { prenom: string; couleur: string }[] | null
}

/** Un joint Supabase arrive en objet ou en tableau selon la cardinalité que
 *  PostgREST infère. On ne veut jamais avoir à s'en soucier plus haut. */
function unSeul<T>(joint: T | T[] | null | undefined): T | null {
  return (Array.isArray(joint) ? joint[0] : joint) ?? null
}

/** Ligne brute d'`echanges_gardes`, jointe aux deux vétérinaires concernés. */
interface LigneEchange {
  id: string
  demandeur?: { prenom: string } | { prenom: string }[] | null
  cible?: { prenom: string } | { prenom: string }[] | null
}

/** Ligne brute d'`absences`, jointe au vétérinaire absent. */
interface LigneAbsence {
  id: string
  date_fin: string
  veto?: { prenom: string } | { prenom: string }[] | null
}

/** Une règle du cabinet, telle qu'il faut la lire pour la NOMMER exactement
 *  comme l'écran Règles la nomme (source unique : `phraseRegle`). */
interface LigneRegle {
  id: string
  brique_id: string
  params_json: unknown
  force: string
}

/** Les codes de créneau du catalogue, dits en français dans une phrase.
 *  Un code hors de cette liste (créneau sur mesure du cabinet) n'est PAS
 *  traduit à la volée : on préfère ne rien proposer qu'inventer un libellé. */
const CRENEAUX_EN_FRANCAIS: Record<string, string> = {
  semaine_soir: 'la garde de nuit en semaine',
  vendredi_soir: 'la garde du vendredi soir',
  weekend: 'la garde de week-end',
  ferie: 'la garde de jour férié',
}

/** Longueur au-delà de laquelle un libellé de règle ne tient plus dans un
 *  bouton d'exemple. Le tronquer produirait une consigne incomplète — donc
 *  une demande qui part au modèle sans pouvoir aboutir : on saute l'exemple. */
const LIBELLE_REGLE_MAX = 70

/** Une ligne de la vue `planning_semaine` → la forme attendue par l'accueil. */
function versGarde(
  row: Record<string, unknown> | undefined,
  catalogue: CatalogueHoraires,
): GardeDuSoir | null {
  if (!row) return null
  const premier = row.premier_prenom
    ? { prenom: String(row.premier_prenom), couleur: String(row.premier_couleur ?? '#7C6A55') }
    : null
  const second = row.second_prenom
    ? { prenom: String(row.second_prenom), couleur: String(row.second_couleur ?? '#7C6A55') }
    : null
  if (!premier && !second) return null
  const date = String(row.date)
  const type = String(row.type ?? 'semaine')
  return {
    date,
    type,
    premier,
    second,
    horaire: horaireLisible(catalogue, type, date),
    nature: natureCreneau(type, date),
  }
}

/**
 * Charge tout ce que l'accueil affiche, en une passe parallèle.
 *
 * @param supabase  client serveur RLS-aware (le scope cabinet vient de la RLS)
 * @param veterinaire  le véto connecté, déjà résolu par le layout
 */
export async function chargerAccueil(
  supabase: SupabaseServerClient,
  veterinaire: Veterinaire,
): Promise<DonneesAccueil> {
  const estAdmin = veterinaire.role_app === 'admin'
  const today = aujourdhuiISO()
  const demainISO = plusJours(today, 1)

  const [
    periodesRes,
    gardesRes,
    vetosRes,
    reglesRes,
    souhaitsRes,
    echangesRes,
    cabinetRes,
    horairesCabinet,
    absencesRes,
    dettesRes,
    profilsRes,
  ] = await Promise.all([
    supabase
      .from('periodes')
      .select('*')
      .order('date_debut', { ascending: false })
      .limit(20),
    // « Ce soir » et « demain » en une seule requête sur la vue d'affichage :
    // c'est elle qui porte la synthèse du vendredi soir (migration 014).
    supabase
      .from('planning_semaine')
      .select('*')
      .gte('date', today)
      .lte('date', demainISO)
      .order('date'),
    // L'équipe en entier, et plus seulement son décompte : Filou a besoin d'un
    // VRAI prénom pour proposer une phrase d'exemple, et d'une table id →
    // prénom pour nommer une règle comme l'écran Règles la nomme. Les inactifs
    // sont chargés aussi (une règle peut encore citer un ancien) mais ne
    // comptent pas dans l'effectif. Sept lignes : ça ne coûte rien.
    supabase.from('veterinaires').select('id, prenom, actif').order('prenom'),
    // De quoi compter les forces ET nommer une règle réelle (`phraseRegle`).
    supabase
      .from('regles_cabinet')
      .select('id, brique_id, params_json, force')
      .eq('actif', true)
      .order('brique_id'),
    estAdmin
      ? supabase
          .from('conges')
          .select('id, created_at, date_debut, date_fin, veterinaires(prenom, couleur)')
          .eq('statut', 'souhait')
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as LigneSouhait[] }),
    // Les deux prénoms de l'échange en plus du décompte : « valide l'échange
    // entre X et Y » ne vaut que si X et Y ont vraiment quelque chose en cours.
    supabase
      .from('echanges_gardes')
      .select('id, demandeur:demandeur_id(prenom), cible:cible_id(prenom)')
      .eq('statut', 'proposee')
      .order('created_at', { ascending: true }),
    supabase.from('cabinets').select('google_calendar_id').limit(1).maybeSingle(),
    // Les horaires REELS des creneaux, tous profils confondus : on ne saura
    // qu'apres quel profil s'applique a quelle date.
    chargerHorairesCabinet(supabase),
    // ── Les trois requêtes suivantes ne servent QU'aux exemples de Filou ──
    // Elles ne sont donc lancées que pour un administrateur (lui seul a le
    // champ de saisie), et chacune ramène au plus quelques lignes.
    estAdmin
      ? supabase
          .from('absences')
          .select('id, date_fin, veto:veterinaire_id(prenom)')
          .eq('statut', 'active')
          .gte('date_fin', today)
          .order('date_debut', { ascending: true })
          .limit(1)
      : Promise.resolve({ data: [] as LigneAbsence[] }),
    estAdmin
      ? supabase
          .from('compensations')
          .select('id', { count: 'exact', head: true })
          .eq('statut', 'a_compenser')
      : Promise.resolve({ count: 0 }),
    estAdmin
      ? supabase.from('profils_planning').select('id, nom')
      : Promise.resolve({ data: [] as { id: string; nom: string }[] }),
  ] as const)

  // ⚠️ MÊME RÈGLE QUE L'ÉCRAN PLANNING ET QUE L'AGENDA GOOGLE : un brouillon
  // ne sort pas du logiciel. « Ce soir » et « demain » sont l'information la
  // plus engageante de l'accueil — annoncer un binôme de garde tiré d'un
  // planning non publié, c'est faire venir quelqu'un sur une promesse que
  // personne n'a faite. Le critère est `publie_at`, pas le statut (une période
  // verrouillée peut n'avoir jamais été diffusée). Source unique du test :
  // `lib/planning/diffusion.ts`.
  const periodes = periodesVisibles((periodesRes?.data ?? []) as Periode[], estAdmin)

  // La période « courante » est celle qui couvre aujourd'hui ; à défaut la
  // prochaine à démarrer ; à défaut la plus récente connue.
  const periodeCourante =
    periodes.find((p) => p.date_debut <= today && p.date_fin >= today) ??
    [...periodes].reverse().find((p) => p.date_debut > today) ??
    periodes[0] ??
    null

  // Celle qu'il reste à publier : le brouillon qui démarre le plus tôt.
  const periodeAPublier =
    [...periodes]
      .filter((p) => p.statut === 'brouillon' && p.date_fin >= today)
      .sort((a, b) => a.date_debut.localeCompare(b.date_debut))[0] ?? null

  const joursAvantPublication = periodeAPublier
    ? ecartEnJours(today, moinsJours(periodeAPublier.date_debut, PREAVIS_JOURS))
    : null

  // Les gardes du soir suivent le même tri, par `periode_id` : la vue
  // `planning_semaine` n'expose pas `publie_at`, et relire son `periode_statut`
  // reviendrait à laisser passer le verrouillé-jamais-diffusé.
  const toutesLignes = (gardesRes?.data ?? []) as (Record<string, unknown> & {
    periode_id: string
  })[]
  // ⚠️ LE FILTRE S'APPLIQUE AUSSI À L'ADMINISTRATRICE, et c'est nouveau.
  //
  // La vue `planning_semaine` n'a AUCUNE RLS : sans borne, « ce soir » et
  // « demain » annonceraient les gardes de TOUS les cabinets. La liste
  // `periodes`, elle, vient de la table `periodes`, dont l'isolation par
  // cabinet est RESTRICTIVE — la borner par elle borne donc au cabinet.
  //
  // On ne perd rien au passage : l'accueil ne regarde que deux jours, qui
  // relèvent forcément d'une période récente. C'est l'écran planning, qui
  // remonte des mois en arrière, qui avait besoin d'un traitement à part.
  // `periodes` est déjà borné plus haut par `periodesVisibles(…, estAdmin)` :
  // il porte donc les deux filtres à la fois, le cabinet et la diffusion.
  const lignes = lignesDesPeriodes(toutesLignes, periodes)
  /** Le catalogue d'horaires de la période qui couvre CETTE date. Deux dates
   *  voisines peuvent relever de deux périodes — donc de deux profils — deux
   *  fois par an. */
  const catalogueDu = (dateISO: string): CatalogueHoraires => {
    const periode = periodes.find((p) => p.date_debut <= dateISO && p.date_fin >= dateISO)
    return catalogueDuProfil(horairesCabinet, periode?.profil_id ?? null)
  }
  const ceSoir = versGarde(
    lignes.find((r) => String(r.date) === today),
    catalogueDu(today),
  )
  const demain = versGarde(
    lignes.find((r) => String(r.date) === demainISO),
    catalogueDu(demainISO),
  )

  const regles = (reglesRes?.data ?? []) as unknown as LigneRegle[]
  const nbReglesFermes = regles.filter((r) => FORCES_FERMES.includes(r.force)).length

  // L'équipe : l'effectif ne compte que les actifs, la table id → prénom garde
  // tout le monde (une règle active peut encore citer quelqu'un de parti, et
  // « ??? jamais de garde le mercredi » ne veut plus rien dire).
  const equipe = (vetosRes?.data ?? []) as { id: string; prenom: string; actif: boolean }[]
  const equipeActive = equipe.filter((v) => v.actif)
  const nbVetos = equipeActive.length

  const echangesEnAttente = (echangesRes?.data ?? []) as unknown as LigneEchange[]

  const lignesSouhaits = (souhaitsRes?.data ?? []) as LigneSouhait[]
  const souhaits: SouhaitEnAttente[] = lignesSouhaits.map((l) => {
    const vet = Array.isArray(l.veterinaires) ? l.veterinaires[0] : l.veterinaires
    return {
      id: l.id,
      prenom: vet?.prenom ?? 'Vétérinaire',
      couleur: vet?.couleur ?? '#7C6A55',
      dateDebut: l.date_debut,
      dateFin: l.date_fin,
      depose: l.created_at,
    }
  })

  // Récap de la période à préparer : uniquement des faits déjà en base. Un
  // récap qui annonce « tout est prêt » sans avoir compté ne vaut rien.
  let recapPeriode: RecapPeriode | null = null
  if (estAdmin && periodeAPublier) {
    const [profilRes, congesRes] = await Promise.all([
      periodeAPublier.profil_id
        ? supabase
            .from('profils_planning')
            .select('nom, nb_vetos_semaine_soir')
            .eq('id', periodeAPublier.profil_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('conges')
        .select('id', { count: 'exact', head: true })
        .eq('statut', 'valide')
        .lte('date_debut', periodeAPublier.date_fin)
        .gte('date_fin', periodeAPublier.date_debut),
    ])
    const profil = (profilRes as { data?: { nom: string; nb_vetos_semaine_soir: number | null } | null })?.data
    recapPeriode = {
      libelle:
        periodeAPublier.libelle ??
        `${periodeAPublier.saison === 'ete' ? 'Été' : 'Hiver'} ${periodeAPublier.date_debut.slice(0, 4)}`,
      saison: periodeAPublier.saison,
      dateDebut: periodeAPublier.date_debut,
      dateFin: periodeAPublier.date_fin,
      nbSemaines: Math.round(
        (ecartEnJours(periodeAPublier.date_debut, periodeAPublier.date_fin) + 1) / 7,
      ),
      profil: profil?.nom ?? null,
      effectifNuitSemaine:
        periodeAPublier.nb_vetos_semaine_soir ?? profil?.nb_vetos_semaine_soir ?? null,
      nbVetos,
      nbReglesFermes,
      nbReglesSouples: regles.length - nbReglesFermes,
      nbCongesValides: (congesRes as { count?: number | null })?.count ?? 0,
      limitePublication: moinsJours(periodeAPublier.date_debut, PREAVIS_JOURS),
      statut: periodeAPublier.statut,
    }
  }

  const calendarId = (cabinetRes as { data?: { google_calendar_id?: string | null } } | null)
    ?.data?.google_calendar_id

  const periodesPubliees = periodes
    .filter((p) => p.statut === 'publie' && p.date_fin >= today)
    .map((p) => p.id)

  return {
    veterinaire,
    estAdmin,
    periodeCourante,
    periodeAPublier,
    joursAvantPublication,
    dock: {
      nbSouhaits: souhaits.length,
      nbEchanges: echangesEnAttente.length,
      nbVetos,
      agendaConnecte: Boolean(calendarId),
      libellePlanning: periodeCourante
        ? (periodeCourante.libelle ?? `${periodeCourante.saison === 'ete' ? 'Été' : 'Hiver'} ${periodeCourante.date_debut.slice(0, 4)}`)
        : 'Aucune période',
      statutPlanning: periodeCourante?.statut ?? null,
    },
    ceSoir,
    demain,
    souhaits,
    recapPeriode,
    // Seules les périodes publiées ENCORE EN COURS sont re-vérifiées : re-valider
    // le passé coûterait cher pour un verdict que plus personne ne peut changer.
    periodesPubliees,
    matiereFilou: estAdmin
      ? matiereFilou({
          equipe,
          equipeActive,
          regles,
          souhaits,
          echangesEnAttente,
          absence: unSeul((absencesRes as { data?: LigneAbsence[] | null })?.data ?? []),
          nbDettes: (dettesRes as { count?: number | null })?.count ?? 0,
          profils: ((profilsRes as { data?: { id: string; nom: string }[] | null })?.data ??
            []) as { id: string; nom: string }[],
          periodeCourante,
          catalogueCourant: catalogueDu(today),
          profilDefaut: horairesCabinet.profilDefaut,
          aUnPlanningPublie: periodesPubliees.length > 0,
          gardeCeSoir: ceSoir !== null,
        })
      : null,
  }
}

/**
 * Met en forme la matière brute pour les exemples de Filou.
 *
 * Une seule règle ici, et elle est plus importante que l'exhaustivité : ce qui
 * n'existe pas reste `null`. `filou-origine.ts` retire alors l'exemple au lieu
 * de le remplir avec un prénom ou une date de fantaisie — une suggestion
 * inventée coûte un aller-retour à la personne ET un appel facturé au modèle,
 * pour une question qui ne pouvait de toute façon pas aboutir.
 */
function matiereFilou(brut: {
  equipe: { id: string; prenom: string; actif: boolean }[]
  equipeActive: { id: string; prenom: string }[]
  regles: LigneRegle[]
  souhaits: SouhaitEnAttente[]
  echangesEnAttente: LigneEchange[]
  absence: LigneAbsence | null
  nbDettes: number
  profils: { id: string; nom: string }[]
  periodeCourante: Periode | null
  catalogueCourant: CatalogueHoraires
  profilDefaut: string | null
  aUnPlanningPublie: boolean
  gardeCeSoir: boolean
}): MatiereFilou {
  const nomVeto = (id: string) => brut.equipe.find((v) => v.id === id)?.prenom ?? '?'

  // Le libellé EXACT de l'écran Règles (source unique `phraseRegle`) : Filou
  // doit pouvoir retrouver la règle dont on lui parle. Une règle trop longue
  // pour un bouton est sautée plutôt que tronquée.
  const regleActive =
    brut.regles
      .map((r) => {
        try {
          return phraseRegle(r, nomVeto)
        } catch {
          // Une brique inconnue du catalogue ne doit pas empêcher l'accueil de
          // s'afficher : on renonce à cet exemple, c'est tout.
          return ''
        }
      })
      .find((libelle) => libelle.length > 0 && libelle.length <= LIBELLE_REGLE_MAX) ?? null

  const souhait = brut.souhaits[0]
  const echange = brut.echangesEnAttente[0]
  const demandeur = unSeul(echange?.demandeur)?.prenom
  const cible = unSeul(echange?.cible)?.prenom
  const absent = unSeul(brut.absence?.veto)?.prenom

  const profilVise = brut.periodeCourante?.profil_id ?? brut.profilDefaut
  // On parcourt les codes CONNUS dans leur ordre de déclaration, et pas les
  // clés du catalogue : l'ordre de PostgREST changerait l'exemple d'un
  // chargement à l'autre sans raison.
  const codeCreneau = Object.keys(CRENEAUX_EN_FRANCAIS).find(
    (code) => brut.catalogueCourant[code],
  )
  const creneau = codeCreneau ? CRENEAUX_EN_FRANCAIS[codeCreneau] : null

  return {
    ...MATIERE_VIDE,
    prenomVeto: brut.equipeActive[0]?.prenom ?? null,
    souhait: souhait
      ? { prenom: souhait.prenom, dateDebut: souhait.dateDebut, dateFin: souhait.dateFin }
      : null,
    // Les deux prénoms sont exigés : « valide l'échange entre X et ? » ne
    // ressemble à rien, et Filou ne saurait pas quoi en faire.
    echange: demandeur && cible ? { demandeur, cible } : null,
    absence: absent ? { prenom: absent } : null,
    aDesDettes: brut.nbDettes > 0,
    regleActive,
    profil: profilVise ? (brut.profils.find((p) => p.id === profilVise)?.nom ?? null) : null,
    creneau,
    aUnPlanning: brut.periodeCourante !== null,
    planningPublie: brut.aUnPlanningPublie,
    gardeCeSoir: brut.gardeCeSoir,
  }
}
