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
  dock: {
    nbSouhaits: number
    nbEchanges: number
    nbVetos: number
    nbReglesFermes: number
    nbReglesSouples: number
    agendaConnecte: boolean
    libellePlanning: string
    statutPlanning: StatutPeriode | null
  }
  ceSoir: GardeDuSoir | null
  demain: GardeDuSoir | null
  /** Souhaits de congé en attente de décision, du plus ancien au plus récent. */
  souhaits: SouhaitEnAttente[]
  /** Récap de la prochaine période à préparer (null si tout est publié). */
  recapPeriode: RecapPeriode | null
  /** Périodes publiées à re-vérifier côté client (fiche « cohérence »). */
  periodesPubliees: string[]
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

/** Une ligne de la vue `planning_semaine` → la forme attendue par l'accueil. */
function versGarde(row: Record<string, unknown> | undefined): GardeDuSoir | null {
  if (!row) return null
  const premier = row.premier_prenom
    ? { prenom: String(row.premier_prenom), couleur: String(row.premier_couleur ?? '#7C6A55') }
    : null
  const second = row.second_prenom
    ? { prenom: String(row.second_prenom), couleur: String(row.second_couleur ?? '#7C6A55') }
    : null
  if (!premier && !second) return null
  return { date: String(row.date), type: String(row.type ?? 'semaine'), premier, second }
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
    supabase
      .from('veterinaires')
      .select('id', { count: 'exact', head: true })
      .eq('actif', true),
    supabase.from('regles_cabinet').select('force').eq('actif', true),
    estAdmin
      ? supabase
          .from('conges')
          .select('id, created_at, date_debut, date_fin, veterinaires(prenom, couleur)')
          .eq('statut', 'souhait')
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as LigneSouhait[] }),
    supabase
      .from('echanges_gardes')
      .select('id', { count: 'exact', head: true })
      .eq('statut', 'proposee'),
    supabase.from('cabinets').select('google_calendar_id').limit(1).maybeSingle(),
  ] as const)

  const periodes = (periodesRes?.data ?? []) as Periode[]

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

  const lignes = (gardesRes?.data ?? []) as Record<string, unknown>[]
  const ceSoir = versGarde(lignes.find((r) => String(r.date) === today))
  const demain = versGarde(lignes.find((r) => String(r.date) === demainISO))

  const regles = (reglesRes?.data ?? []) as { force: string }[]
  const nbReglesFermes = regles.filter((r) => FORCES_FERMES.includes(r.force)).length

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
      nbVetos: (vetosRes as { count?: number | null })?.count ?? 0,
      nbReglesFermes,
      nbReglesSouples: regles.length - nbReglesFermes,
      nbCongesValides: (congesRes as { count?: number | null })?.count ?? 0,
      limitePublication: moinsJours(periodeAPublier.date_debut, PREAVIS_JOURS),
      statut: periodeAPublier.statut,
    }
  }

  const calendarId = (cabinetRes as { data?: { google_calendar_id?: string | null } } | null)
    ?.data?.google_calendar_id

  return {
    veterinaire,
    estAdmin,
    periodeCourante,
    periodeAPublier,
    joursAvantPublication,
    dock: {
      nbSouhaits: souhaits.length,
      nbEchanges: (echangesRes as { count?: number | null })?.count ?? 0,
      nbVetos: (vetosRes as { count?: number | null })?.count ?? 0,
      nbReglesFermes,
      nbReglesSouples: regles.length - nbReglesFermes,
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
    periodesPubliees: periodes
      .filter((p) => p.statut === 'publie' && p.date_fin >= today)
      .map((p) => p.id),
  }
}
