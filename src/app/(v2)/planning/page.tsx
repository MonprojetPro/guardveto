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
import { redirect } from 'next/navigation'
import '@/styles/v2-planning.css'
import '@/styles/v2-filou-edge.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { PlanningV2, type CongeAffiche } from '@/components/v2/PlanningV2'
import { RealtimeRefresh } from '@/components/planning/RealtimeRefresh'
import { RevalidationRealtime } from '@/components/planning/RevalidationRealtime'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import { chargerDock } from '@/data/v2/dock'
import { queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
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

  const [gardesRes, periodesRes, vetsRes, typesRes, congesRes, gardesPeriodesRes] =
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
    ])

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

  const [dock, profilRes, compteurs, totalWE, prefsRes, typesRes2] = await Promise.all([
    chargerDock(supabase, vet, periodes),
    periodeAffichee?.profil_id
      ? supabase.from('profils_planning').select('nom').eq('id', periodeAffichee.profil_id).maybeSingle()
      : Promise.resolve({ data: null }),
    periodeAffichee
      ? queryCompteurs(supabase, periodeAffichee.id)
      : Promise.resolve([] as CompteursRow[]),
    // Total de week-ends de la période : `calculerBilans` en a besoin pour
    // établir la juste part. Sans lui, la colonne « écart » comparerait à une
    // moyenne fausse — pire qu'une colonne absente.
    periodeAffichee
      ? queryTotalWE(supabase, periodeAffichee.id)
      : Promise.resolve(0),
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
  ])

  const profil = (profilRes as { data?: { nom: string } | null })?.data?.nom ?? null
  const periodesTypes = ((typesRes2?.data ?? []) as ProfilPlanning[])

  // ── CE QUE CONTIENT CHAQUE PÉRIODE TYPE ─────────────────────────────────
  // Retour MiKL du 2026-08-04 : « pourquoi ce n'est pas juste indiqué :
  // période type = hiver = telles caractéristiques ». Confirmer un NOM ne
  // confirme rien — on ne sait pas ce qu'on valide. On descend donc les
  // gardes qu'elle fait couvrir, pour que la confirmation porte sur du réel.
  // Une seule requête pour toutes les périodes types, groupée ensuite.
  const idsTypes = periodesTypes.map((p) => p.id)
  const { data: creneauxTypes } = idsTypes.length > 0
    ? await supabase
        .from('creneau_modele')
        .select('profil_id, nom, nb_places, actif, ordre')
        .in('profil_id', idsTypes)
        .eq('actif', true)
        .order('ordre')
    : { data: null }

  const gardesParType: Record<string, string[]> = {}
  for (const c of (creneauxTypes ?? []) as {
    profil_id: string; nom: string; nb_places: number
  }[]) {
    // Le nombre est TOUJOURS écrit, même à 1 : depuis le 2026-08-04 c'est le
    // seul endroit où l'effectif d'une garde se règle, donc le seul endroit où
    // il se lit. Le taire à 1 obligerait à deviner.
    ;(gardesParType[c.profil_id] ??= []).push(
      `${c.nom} — ${c.nb_places} véto${c.nb_places > 1 ? 's' : ''}`,
    )
  }
  const bilans = calculerBilans(compteurs as CompteursRow[], totalWE as number)
  const colonnesCompteurs = normaliserColonnes(
    (prefsRes as { data?: { colonnes_compteurs?: string[] | null } | null })?.data?.colonnes_compteurs,
  )

  const vets: VetCrise[] = isAdmin ? ((vetsRes?.data as VetCrise[] | null) ?? []) : []

  // Re-validation continue : périodes publiées qui chevauchent le mois affiché
  // ET qui ont des gardes. Identique à la V1 — c'est un garde-fou, pas du décor.
  const periodesAvecGardes = [
    ...new Set(((gardesPeriodesRes?.data ?? []) as { periode_id: string }[]).map((g) => g.periode_id)),
  ]
  const periodeIdsARevalider = isAdmin
    ? periodes
        .filter(
          (p) =>
            (p.statut === 'publie' || p.statut === 'verrouille') &&
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
          compteurs={compteurs as CompteursRow[]}
          conges={conges}
          profil={profil}
          periodesAvecGardes={periodesAvecGardes}
          periodesTypes={periodesTypes}
          gardesParType={gardesParType}
          bilans={bilans}
          colonnesCompteurs={colonnesCompteurs}
        />
      </div>
    </>
  )
}
