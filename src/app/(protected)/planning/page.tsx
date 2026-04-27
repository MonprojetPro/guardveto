import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ActionBar } from '@/components/planning/ActionBar'
import { AlerteBandeau } from '@/components/planning/AlerteBandeau'
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
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  const isAdmin = currentVeto?.role_app === 'admin'
  const isSecretaire = currentVeto?.role_app === 'secretaire'

  // Mois à afficher (searchParam ou mois courant)
  const { mois: moisParam } = await searchParams
  const anneeMois = moisParam && /^\d{4}-\d{2}$/.test(moisParam)
    ? moisParam
    : moisCourantISO()

  const { debut, fin } = debutFinMois(anneeMois)

  // Chargement parallèle : gardes du mois + toutes les périodes + périodes avec gardes (admin)
  const [{ data: gardesDb }, { data: periodesDb }, periodesAvecGardesDb] = await Promise.all([
    supabase
      .from('planning_semaine')
      .select('*')
      .gte('date', debut)
      .lte('date', fin)
      .order('date'),
    supabase
      .from('periodes')
      .select('*')
      .order('date_debut', { ascending: false })
      .limit(20),
    // Pour l'admin : quelles périodes ont déjà des gardes générées
    isAdmin
      ? supabase.from('gardes').select('periode_id').limit(500)
      : Promise.resolve({ data: null }),
  ])

  // Période active du mois affiché (pour le bouton export secrétaire)
  const periodesMois = (periodesDb as Periode[] ?? []).filter((p) => {
    return p.date_debut <= fin && p.date_fin >= debut
  })

  // Périodes disponibles pour ActionBar (toutes, admin uniquement)
  const toutesLesPeriodes = isAdmin ? ((periodesDb as Periode[]) ?? []) : []

  // Liste dédupliquée des periode_ids qui ont au moins une garde
  const periodesAvecGardes = isAdmin
    ? [...new Set((periodesAvecGardesDb.data ?? []).map((g: { periode_id: string }) => g.periode_id))]
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Planning</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Vue mensuelle des gardes
        </p>
      </div>

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
        />
      )}

      {/* Bouton export PDF — secrétaire */}
      {isSecretaire && periodesMois.length > 0 && (
        <ExportPdfButton periodeId={periodesMois[0].id} />
      )}

      {/* Calendrier mensuel */}
      <MonthView
        gardes={(gardesDb as GardeDenormalisee[]) ?? []}
        periodes={(periodesDb as Periode[]) ?? []}
        anneeMois={anneeMois}
        isAdmin={isAdmin}
      />
    </div>
  )
}
