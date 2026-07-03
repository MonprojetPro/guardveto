import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ActionBar } from '@/components/planning/ActionBar'
import type { VetCrise } from '@/components/planning/CriseModal'
import { AlerteBandeau } from '@/components/planning/AlerteBandeau'
import { RevalidationRealtime } from '@/components/planning/RevalidationRealtime'
import { RealtimeRefresh } from '@/components/planning/RealtimeRefresh'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import { MonthView } from '@/components/calendar/MonthView'
import { ExportPdfButton } from '@/components/planning/ExportPdfButton'
import type { GardeDenormalisee, Periode } from '@/types'

// ── Helpers ──────────────────────────────────────────────

function moisCourantISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function debutFinMois(anneeMois: string): { debut: string; fin: string } {
  const [annee, mois] = anneeMois.split('-').map(Number)
  const debut = `${annee}-${String(mois).padStart(2, '0')}-01`
  // Dernier jour du mois
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const fin = `${annee}-${String(mois).padStart(2, '0')}-${String(dernierJour).padStart(2, '0')}`
  return { debut, fin }
}

// ── Page ─────────────────────────────────────────────────

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string }>
}) {
  const supabase = await createClient()

  // Authentification
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVeto } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()

  const isAdmin = currentVeto?.role_app === 'admin'
  const moiVetId = currentVeto?.id as string | undefined

  // Mois à afficher (searchParam ou mois courant)
  const { mois: moisParam } = await searchParams
  const anneeMois = moisParam && /^\d{4}-\d{2}$/.test(moisParam)
    ? moisParam
    : moisCourantISO()

  const { debut, fin } = debutFinMois(anneeMois)

  // Chargement parallèle : gardes du mois + toutes les périodes + périodes avec gardes (admin)
   
  const [gardesResult, periodesResult, periodesGardesResult, vetsResult] = await Promise.all([
    supabase.from('planning_semaine').select('*').gte('date', debut).lte('date', fin).order('date'),
    supabase.from('periodes').select('*').order('date_debut', { ascending: false }).limit(20),
    isAdmin ? supabase.from('gardes').select('periode_id').limit(500) : Promise.resolve({ data: null }),
    isAdmin
      ? supabase.from('veterinaires').select('id, prenom, nom, couleur').eq('actif', true).order('nom')
      : Promise.resolve({ data: null }),

  ]) as any[]

  const gardesDb = gardesResult?.data
  const periodesDb = periodesResult?.data

  // Période du mois affiché (pour le bouton export PDF des vétos).
  // Côté véto, la RLS ne renvoie que les périodes publiées.
  const periodesMois = ((periodesDb as Periode[]) ?? []).filter((p) => {
    return p.date_debut <= fin && p.date_fin >= debut
  })

  // Périodes disponibles pour ActionBar (toutes, admin uniquement)
  const toutesLesPeriodes: Periode[] = isAdmin ? ((periodesDb as Periode[]) ?? []) : []

  // Vétos actifs (admin) — pour le signalement d'absence (gestion de crise).
  const vetsCrise: VetCrise[] = isAdmin
    ? ((vetsResult?.data as VetCrise[] | null) ?? [])
    : []

  // Liste dédupliquée des periode_ids qui ont au moins une garde
  const periodesAvecGardes: string[] = isAdmin
    ? [...new Set(((periodesGardesResult?.data ?? []) as { periode_id: string }[]).map((g) => g.periode_id))]
    : []

  // ── Rappel de publication (admin) ─────────────────────
  // Si une période brouillon commence dans moins de 15 jours → bandeau orange
  const rappelPublication = isAdmin
    ? (() => {
        const today = new Date()
        const limite = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000)
        return toutesLesPeriodes.find((p) => {
          if (p.statut !== 'brouillon') return false
          const debut = new Date(p.date_debut + 'T12:00:00')
          return debut >= today && debut <= limite
        }) ?? null
      })()
    : null

  // ── Re-validation continue du planning publié (Chantier B) ────
  // Périodes PUBLIÉES (ou verrouillées) qui chevauchent le mois affiché et qui
  // ont des gardes : ce sont celles à re-vérifier en continu.
  const periodeIdsARevalider: string[] = isAdmin
    ? toutesLesPeriodes
        .filter(
          (p) =>
            (p.statut === 'publie' || p.statut === 'verrouille') &&
            p.date_debut <= fin &&
            p.date_fin >= debut &&
            periodesAvecGardes.includes(p.id)
        )
        .map((p) => p.id)
    : []

  // Violations calculées en SSR (admin) → évite un flash vide ; le composant
  // client prend ensuite le relais en temps réel.
  const violationsInitiales =
    periodeIdsARevalider.length > 0
      ? await revaliderPlanningPublie(periodeIdsARevalider)
      : []

  return (
    <div className="space-y-6">
      {/* Rafraîchissement temps réel de la vue (tous les utilisateurs) */}
      <RealtimeRefresh />

      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Planning</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Vue mensuelle des gardes
        </p>
      </div>

      {/* Re-validation continue du planning publié — admin, temps réel */}
      {isAdmin && periodeIdsARevalider.length > 0 && (
        <RevalidationRealtime
          periodeIds={periodeIdsARevalider}
          initialViolations={violationsInitiales}
        />
      )}

      {/* Rappel de publication — période brouillon < 15 jours */}
      {rappelPublication && (
        <AlerteBandeau
          variante="warning"
          titre="Rappel : publication à venir"
          description={`La période ${rappelPublication.saison === 'ete' ? 'Été' : 'Hiver'}${rappelPublication.numero ? ` — Période ${rappelPublication.numero}` : ''} commence le ${new Date(rappelPublication.date_debut + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} et est encore en brouillon.`}
          actions={[
            { label: 'Voir les périodes', href: '/admin/periodes' },
          ]}
        />
      )}

      {/* Barre d'actions — admin uniquement */}
      {isAdmin && (
        <ActionBar
          periodes={toutesLesPeriodes}
          periodesAvecGardes={periodesAvecGardes}
          vets={vetsCrise}
        />
      )}

      {/* Bouton export PDF — vétos (planning publié du mois) */}
      {!isAdmin && periodesMois.length > 0 && (
        <ExportPdfButton periodeId={periodesMois[0].id} />
      )}

      {/* Calendrier mensuel */}
      <MonthView
        gardes={(gardesDb as GardeDenormalisee[]) ?? []}
        periodes={(periodesDb as Periode[]) ?? []}
        anneeMois={anneeMois}
        isAdmin={isAdmin}
        vets={vetsCrise}
        moiVetId={moiVetId}
      />
    </div>
  )
}
