// ============================================================
// GUARDVETO V2 — L'écran planning
// ============================================================
// Deuxième écran de la bascule (maquette M1). Il REMPLACE le planning V1 :
// même route, même données, même moteur — nouveau look et nouvelle mise en
// scène. Les garde-fous de génération et de publication sont repris tels
// quels de la V1 dans `components/v2/outils-planning.tsx` : ils portent des
// règles métier, on ne les réécrit pas pour un changement d'habillage.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { redirect } from 'next/navigation'
import '@/styles/v2-planning.css'
import '@/styles/v2-filou-edge.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { PlanningV2, type CongeAffiche, type PlageVacances } from '@/components/v2/PlanningV2'
import { RealtimeRefresh } from '@/components/planning/RealtimeRefresh'
import { RevalidationRealtime } from '@/components/planning/RevalidationRealtime'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import { chargerDock } from '@/data/v2/dock'
import {
  queryCompteurs,
  queryTotalWE,
  completerCompteursPourAffichage,
  type VetoPourCompteurs,
} from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'
import { normaliserColonnes } from '@/lib/planning/colonnesCompteurs'
import type { VetCrise } from '@/components/planning/CriseModal'
import type { CompteursRow } from '@/hooks/useCompteurs'
import type { GardeDenormalisee, Periode, ProfilPlanning, Veterinaire } from '@/types'

export const metadata = { title: 'GuardVeto — Planning' }

/** Mois courant au format « YYYY-MM », dans le fuseau du cabinet. */
function moisCourant(): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7)
}

/** Décale une date ISO de N jours (N peut être négatif). */
function decalerJours(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function bornesMois(anneeMois: string): { debut: string; fin: string } {
  const [annee, mois] = anneeMois.split('-').map(Number)
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const mm = String(mois).padStart(2, '0')
  return { debut: `${annee}-${mm}-01`, fin: `${annee}-${mm}-${String(dernier).padStart(2, '0')}` }
}

interface LigneConge {
  id: string
  date_debut: string
  date_fin: string
  statut: string
  veterinaires?: { prenom: string; couleur: string } | { prenom: string; couleur: string }[] | null
}

export default async function PlanningPageV2({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: veterinaire } = await supabase
    .from('veterinaires')
    .select('*')
    .eq('user_id', user.id)
    .eq('actif', true)
    .single()

  if (!veterinaire) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  const vet = veterinaire as Veterinaire
  const isAdmin = vet.role_app === 'admin'

  const { mois: moisParam } = await searchParams
  const anneeMois = moisParam && /^\d{4}-\d{2}$/.test(moisParam) ? moisParam : moisCourant()
  const { debut, fin } = bornesMois(anneeMois)

  // VACANCES SCOLAIRES — la grille déborde du mois (elle commence au lundi de
  // la 1re semaine et finit au dimanche de la dernière) : on élargit la fenêtre
  // de 7 jours de chaque côté, sinon les cases débordantes seraient les seules
  // à ne pas être marquées.
  const fenetreVac = {
    debut: decalerJours(debut, -7),
    fin: decalerJours(fin, 7),
  }

  const [gardesRes, periodesRes, vetsRes, typesRes, congesRes, gardesPeriodesRes, cabinetRes] =
    await Promise.all([
      supabase.from('planning_semaine').select('*').gte('date', debut).lte('date', fin).order('date'),
      supabase.from('periodes').select('*').order('date_debut', { ascending: false }).limit(20),
      isAdmin
        ? supabase
            .from('veterinaires')
            .select('id, prenom, nom, couleur')
            .eq('actif', true)
            .order('nom')
        : Promise.resolve({ data: null }),
      supabase.from('creneau_modele').select('code, nom').not('code', 'is', null),
      // Congés et souhaits qui chevauchent le mois : ils s'affichent dans la
      // case du jour, à côté des gardes — c'est ce qui explique un trou.
      supabase
        .from('conges')
        .select('id, date_debut, date_fin, statut, veterinaires(prenom, couleur)')
        .lte('date_debut', fin)
        .gte('date_fin', debut),
      // Chargé pour TOUS : le bouton PDF en dépend, pas seulement la publication.
      supabase.from('gardes').select('periode_id').limit(500),
      // La ZONE du cabinet — indispensable pour les vacances scolaires. Ne
      // JAMAIS retomber sur la constante `VACANCES_SCOLAIRES` de engine/utils :
      // elle est figée sur la zone C, et ce cabinet-ci est en zone A. C'est
      // exactement le bug « zone-aware » déjà corrigé côté moteur.
      // `cabinet_id` vient du JETON (source de vérité du projet), pas de la
      // fiche véto. Le try/catch est délibéré : une zone introuvable ne doit
      // jamais faire tomber l'écran planning pour un simple repère visuel.
      resoudreCabinetId(supabase)
        .then((id) => supabase.from('cabinets').select('zone_scolaire').eq('id', id).maybeSingle())
        .catch(() => ({ data: null })),
    ])

  // Vacances de CETTE zone qui chevauchent la fenêtre affichée. Une zone
  // absente (donnée cabinet incomplète) → aucune plage : la grille s'affiche
  // sans marquage plutôt que de mentir avec la zone d'un autre cabinet.
  const zone = (cabinetRes?.data as { zone_scolaire: string | null } | null)?.zone_scolaire ?? null
  const vacancesRes = zone
    ? await supabase
        .from('vacances_scolaires')
        .select('debut, fin, label')
        .eq('zone', zone)
        .lte('debut', fenetreVac.fin)
        .gte('fin', fenetreVac.debut)
    : { data: [] }

  const vacances: PlageVacances[] = (
    (vacancesRes?.data ?? []) as { debut: string; fin: string; label: string | null }[]
  ).map((v) => ({ debut: v.debut, fin: v.fin, label: v.label ?? 'Vacances scolaires' }))

  const gardes = ((gardesRes?.data ?? []) as GardeDenormalisee[])
  const periodes = ((periodesRes?.data ?? []) as Periode[])

  const nomsTypes: Record<string, string> = {}
  for (const r of (typesRes?.data ?? []) as { code: string; nom: string }[]) {
    nomsTypes[r.code] = r.nom
  }

  const conges: CongeAffiche[] = ((congesRes?.data ?? []) as LigneConge[]).map((c) => {
    const v = Array.isArray(c.veterinaires) ? c.veterinaires[0] : c.veterinaires
    return {
      id: c.id,
      prenom: v?.prenom ?? 'Vétérinaire',
      couleur: v?.couleur ?? '#7C6A55',
      dateDebut: c.date_debut,
      dateFin: c.date_fin,
      statut: c.statut,
    }
  })

  // La période dont relève le mois affiché : celle qui le chevauche.
  const periodeAffichee =
    periodes.find((p) => p.date_debut <= fin && p.date_fin >= debut) ?? null

  const [dock, profilRes, compteursRes, totalWERes, prefsRes, typesRes2, equipeRes] = await Promise.all([
    chargerDock(supabase, vet, periodes),
    periodeAffichee?.profil_id
      ? supabase.from('profils_planning').select('nom').eq('id', periodeAffichee.profil_id).maybeSingle()
      : Promise.resolve({ data: null }),
    periodeAffichee
      ? queryCompteurs(supabase, periodeAffichee.id)
      : Promise.resolve({ compteurs: [] as CompteursRow[], erreur: null }),
    // Total de week-ends de la période : `calculerBilans` en a besoin pour
    // établir la juste part. Sans lui, la colonne « écart » comparerait à une
    // moyenne fausse — pire qu'une colonne absente.
    periodeAffichee
      ? queryTotalWE(supabase, periodeAffichee.id)
      : Promise.resolve({ totalWE: 0, erreur: null }),
    // Les colonnes choisies par la personne connectée. Absente = les colonnes
    // par défaut ; jamais bloquant (l'encart doit s'afficher quoi qu'il arrive).
    supabase
      .from('preferences_affichage')
      .select('colonnes_compteurs')
      .eq('veterinaire_id', vet.id)
      .maybeSingle(),
    // Les périodes types, proposées quand l'admin crée un planning depuis
    // « Générer ». Chargées pour lui seul : un véto ne génère rien.
    isAdmin
      ? supabase
          .from('profils_planning')
          .select('id, nom, est_defaut, saison_suggeree, nb_vetos_semaine_soir')
          .eq('actif', true)
          .order('ordre')
      : Promise.resolve({ data: null }),
    // L'équipe active, pour que personne ne disparaisse de l'encart compteurs
    // (cf. plus bas). Chargée pour TOUS, véto compris : l'encart s'affiche pour
    // tout le monde, et c'est justement à un véto qu'on ne peut pas expliquer
    // pourquoi un collègue manque du tableau.
    supabase
      .from('veterinaires')
      .select('id, prenom, nom, statut, couleur')
      .eq('actif', true)
      .order('nom'),
  ])

  const profil = (profilRes as { data?: { nom: string } | null })?.data?.nom ?? null
  const periodesTypes = ((typesRes2?.data ?? []) as ProfilPlanning[])

  // ── CE QUE CONTIENT CHAQUE PÉRIODE TYPE ─────────────────────────────────
  // Retour MiKL du 2026-08-04 : « pourquoi ce n'est pas juste indiqué :
  // période type = hiver = telles caractéristiques ». Confirmer un NOM ne
  // confirme rien — on ne sait pas ce qu'on valide. On descend donc les
  // gardes qu'elle fait couvrir, pour que la confirmation porte sur du réel.
  // Une seule requête pour toutes les périodes types, groupée ensuite.
  // Le SOCLE du cabinet, puis ce que chaque période type en retient — même
  // règle que le moteur (`appliquerAffinage`) : absence de choix = le créneau
  // tel quel, 0 = la garde n'existe pas sur cette période.
  const idsTypes = periodesTypes.map((p) => p.id)
  const [socleRes, affinagesRes] = await Promise.all([
    supabase
      .from('creneau_modele')
      .select('id, nom, nb_places, actif, ordre')
      .is('profil_id', null)
      .eq('actif', true)
      .order('ordre'),
    idsTypes.length > 0
      ? supabase
          .from('periode_type_creneau')
          .select('profil_id, creneau_id, nb_vetos')
          .in('profil_id', idsTypes)
      : Promise.resolve({ data: null }),
  ])

  const socleCreneaux = (socleRes?.data ?? []) as {
    id: string; nom: string; nb_places: number
  }[]
  const affinages = (affinagesRes?.data ?? []) as {
    profil_id: string; creneau_id: string; nb_vetos: number
  }[]

  const gardesParType: Record<string, string[]> = {}
  for (const t of periodesTypes) {
    const choix = new Map(
      affinages.filter((a) => a.profil_id === t.id).map((a) => [a.creneau_id, a.nb_vetos]),
    )
    gardesParType[t.id] = socleCreneaux.flatMap((c) => {
      const n = Math.min(choix.get(c.id) ?? c.nb_places, c.nb_places)
      if (n <= 0) return [] // pas de garde de ce type sur cette période
      // Le nombre est TOUJOURS écrit, même à 1 : c'est le réglage que la
      // période type porte, donc ce que la confirmation doit montrer.
      return [`${c.nom} — ${n} véto${n > 1 ? 's' : ''}`]
    })
  }
  // L'encart compteurs du planning. Les deux `as` qui traînaient ici (« as
  // CompteursRow[] », « as number ») ont masqué à `tsc` un changement de forme
  // de `queryCompteurs` : le cast compilait, et la page tombait à l'exécution
  // sur `compteurs.reduce is not a function` dès qu'un mois chevauchait une
  // période. Un cast n'est pas une vérification — on destructure.
  const { compteurs, erreur: erreurCompteurs } = compteursRes
  const { totalWE, erreur: erreurTotalWE } = totalWERes
  if (erreurCompteurs ?? erreurTotalWE) {
    // Best-effort assumé : l'encart compteurs n'est PAS la raison d'être de
    // l'écran planning, il ne doit pas l'empêcher de s'afficher. Mais on ne
    // fait pas passer un échec de lecture pour « personne n'a de garde » en
    // silence — la trace serveur dit lequel des deux a échoué.
    console.error(
      `[planning] encart compteurs indisponible pour la periode ${periodeAffichee?.id} : ${erreurCompteurs ?? erreurTotalWE}`,
    )
  }
  const bilans = calculerBilans(compteurs, totalWE)

  // ── Personne ne disparaît de l'encart ──────────────────────────────────
  // La vue `compteurs_gardes` n'émet aucune ligne pour un vétérinaire sans
  // garde sur la période : il ne s'affiche pas à zéro, il DISPARAÎT. C'est
  // d'abord le vétérinaire de dernier recours que ça frappe — celui dont le
  // rôle EST de n'avoir aucune garde tant que tout va bien.
  //
  // APRÈS `calculerBilans`, volontairement : la juste part reste calculée sur
  // les seuls vétérinaires qui participent à la rotation, donc aucun écart
  // affiché ne bouge. Les lignes ajoutées n'ont pas de bilan, ce que
  // `CompteursPanel` rend déjà « hors répartition ». Même geste que l'écran
  // Historique — les deux encarts doivent raconter la même chose.
  const compteursAffiches = completerCompteursPourAffichage(
    compteurs,
    (equipeRes?.data ?? []) as VetoPourCompteurs[],
  )

  const colonnesCompteurs = normaliserColonnes(
    (prefsRes as { data?: { colonnes_compteurs?: string[] | null } | null })?.data?.colonnes_compteurs,
  )

  const vets: VetCrise[] = isAdmin ? ((vetsRes?.data as VetCrise[] | null) ?? []) : []

  // Re-validation continue : périodes publiées qui chevauchent le mois affiché
  // ET qui ont des gardes. Identique à la V1 — c'est un garde-fou, pas du décor.
  const periodesAvecGardes = [
    ...new Set(((gardesPeriodesRes?.data ?? []) as { periode_id: string }[]).map((g) => g.periode_id)),
  ]
  // Les périodes PUBLIÉES restent contrôlées, y compris après une retouche à
  // la main : l'admin doit savoir quelle règle ou quel congé entre en conflit
  // — et reste libre de programmer quand même (MiKL, 2026-08-19). Le système
  // informe, il n'interdit pas.
  //
  // Les périodes VERROUILLÉES, elles, sortent du contrôle : elles ne se
  // modifient plus (api/generate les refuse, chaque garde est verrouillée),
  // donc signaler une règle enfreinte n'ouvre aucune décision — c'est du bruit
  // devant une porte fermée. Le cas se voit dès qu'on reprend l'historique d'un
  // cabinet : un extrait de passé n'a jamais tous ses créneaux couverts, et la
  // page criait « 32 créneaux non couverts » sur un planning d'archive.
  const periodeIdsARevalider = isAdmin
    ? periodes
        .filter(
          (p) =>
            p.statut === 'publie' &&
            p.date_debut <= fin &&
            p.date_fin >= debut &&
            periodesAvecGardes.includes(p.id),
        )
        .map((p) => p.id)
    : []
  const violationsInitiales =
    periodeIdsARevalider.length > 0 ? await revaliderPlanningPublie(periodeIdsARevalider) : []

  return (
    <>
      <Satin />
      <RealtimeRefresh />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={isAdmin} dock={dock} />

        {isAdmin && periodeIdsARevalider.length > 0 && (
          <div className="v2-alertes">
            <RevalidationRealtime
              periodeIds={periodeIdsARevalider}
              initialViolations={violationsInitiales}
            />
          </div>
        )}

        <PlanningV2
          gardes={gardes}
          periodes={periodes}
          periodeAffichee={periodeAffichee}
          anneeMois={anneeMois}
          isAdmin={isAdmin}
          vets={vets}
          moiVetId={vet.id}
          nomsTypes={nomsTypes}
          compteurs={compteursAffiches}
          conges={conges}
          profil={profil}
          periodesAvecGardes={periodesAvecGardes}
          periodesTypes={periodesTypes}
          gardesParType={gardesParType}
          bilans={bilans}
          colonnesCompteurs={colonnesCompteurs}
          vacances={vacances}
        />
      </div>
    </>
  )
}
