// ============================================================
// GUARDVETO — Page /compteurs
// ============================================================
// Affiche les compteurs individuels de gardes par période.
// La ligne du véto connecté est mise en avant.
// L'admin voit en plus : colonne BM hérité + carte bilan.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import { CompteursClient } from '@/components/compteurs/CompteursClient'
import { BonusMalusCard } from '@/components/compteurs/BonusMalusCard'
import {
  queryCompteurs,
  queryTotalWE,
  queryBonusMalusHeritage,
  queryBonusMalusCourant,
  queryVetsInfo,
} from '@/hooks/useCompteurs'
import type { Periode } from '@/types'

// ── Page ─────────────────────────────────────────────────

export default async function CompteursPage({
  searchParams,
}: {
  searchParams: Promise<{ periodeId?: string }>
}) {
  const supabase = await createClient()

  // ── Auth ─────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentVet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()

  const isAdmin = currentVet?.role_app === 'admin'
  const currentVetId = currentVet?.id ?? null

  // ── Chargement des périodes ──────────────────────────────
  const { data: periodesDb } = await supabase
    .from('periodes')
    .select('*')
    .order('date_debut', { ascending: false })
    .limit(20)

  const periodes = (periodesDb as Periode[] | null) ?? []

  if (periodes.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Compteurs</h1>
          <p className="text-muted-foreground text-sm mt-1">Suivi des gardes et bilan d&apos;équité</p>
        </div>
        <p className="text-sm text-muted-foreground">Aucune période de planification trouvée.</p>
      </div>
    )
  }

  // ── Sélection de la période ──────────────────────────────
  const { periodeId: periodeIdParam } = await searchParams
  const today = new Date().toISOString().split('T')[0]
  // periodes est en DESC — on inverse pour trouver la plus proche chronologiquement
  const periodesAsc = [...periodes].reverse()
  const periodeCourante =
    periodes.find(p => p.date_debut <= today && p.date_fin >= today) ??  // période en cours
    periodesAsc.find(p => p.date_debut >= today) ??                       // prochaine à venir (la plus proche)
    periodes[0]                                                            // fallback : la plus récente
  const periodeSelectionnee =
    periodes.find((p) => p.id === periodeIdParam) ?? periodeCourante

  // ── Chargement parallèle ─────────────────────────────────
  const [compteurs, totalWE, bonusMalusHeritage, bonusMalusCourant, vetsInfo] =
    await Promise.all([
      queryCompteurs(supabase, periodeSelectionnee.id),
      queryTotalWE(supabase, periodeSelectionnee.id),
      isAdmin
        ? queryBonusMalusHeritage(supabase, periodeSelectionnee, periodes)
        : Promise.resolve([]),
      isAdmin
        ? queryBonusMalusCourant(supabase, periodeSelectionnee.id)
        : Promise.resolve([]),
      isAdmin
        ? queryVetsInfo(supabase)
        : Promise.resolve([]),
    ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Compteurs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Suivi des gardes et bilan d&apos;équité
          </p>
        </div>
        {!isAdmin && currentVetId && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            Votre ligne est surlignée
          </p>
        )}
      </div>

      {/* Compteurs par catégorie */}
      <CompteursClient
        periodes={periodes}
        periodeId={periodeSelectionnee.id}
        compteurs={compteurs}
        totalWE={totalWE}
        isAdmin={isAdmin}
        currentVetId={currentVetId}
        bonusMalusHeritage={bonusMalusHeritage}
      />

      {/* Bilan bonus/malus — admin, périodes publiées ou verrouillées */}
      {isAdmin && periodeSelectionnee.statut !== 'brouillon' && (
        <BonusMalusCard
          periodeId={periodeSelectionnee.id}
          periodeStatut={periodeSelectionnee.statut}
          existingBilan={bonusMalusCourant}
          heritage={bonusMalusHeritage}
          vetsInfo={vetsInfo}
        />
      )}
    </div>
  )
}
