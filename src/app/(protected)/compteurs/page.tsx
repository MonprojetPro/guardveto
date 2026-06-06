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
  queryCompteursPlage,
  queryTotalWE,
  queryBonusMalusHeritage,
  queryBonusMalusCourant,
  queryVetsInfo,
  type CompteursRow,
} from '@/hooks/useCompteurs'
import type { Periode } from '@/types'

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/

// ── Page ─────────────────────────────────────────────────

export default async function CompteursPage({
  searchParams,
}: {
  searchParams: Promise<{
    periodeId?: string
    mode?: string
    debut?: string
    fin?: string
    perimetre?: string
  }>
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

  // ── Lecture des filtres ──────────────────────────────────
  const params = await searchParams
  const mode = params.mode === 'plage' ? 'plage' : 'periode'
  const perimetre = params.perimetre === 'valide' ? 'valide' : 'tout'

  const today = new Date().toISOString().split('T')[0]
  // periodes est en DESC — on inverse pour trouver la plus proche chronologiquement
  const periodesAsc = [...periodes].reverse()
  const periodeCourante =
    periodes.find(p => p.date_debut <= today && p.date_fin >= today) ??  // période en cours
    periodesAsc.find(p => p.date_debut >= today) ??                       // prochaine à venir (la plus proche)
    periodes[0]                                                            // fallback : la plus récente
  const periodeSelectionnee =
    periodes.find((p) => p.id === params.periodeId) ?? periodeCourante

  // Plage de dates valide ? (mode plage)
  const plageValide =
    mode === 'plage' &&
    !!params.debut && RE_DATE.test(params.debut) &&
    !!params.fin && RE_DATE.test(params.fin) &&
    params.debut <= params.fin

  // Dates affichées dans les champs (défaut = période sélectionnée)
  const debut = plageValide ? params.debut! : (params.debut && RE_DATE.test(params.debut) ? params.debut : periodeSelectionnee.date_debut)
  const fin = plageValide ? params.fin! : (params.fin && RE_DATE.test(params.fin) ? params.fin : periodeSelectionnee.date_fin)

  // ── Chargement des compteurs selon le mode ───────────────
  let compteurs: CompteursRow[]
  let totalWE: number
  if (plageValide) {
    const res = await queryCompteursPlage(supabase, debut, fin, perimetre === 'valide')
    compteurs = res.compteurs
    totalWE = res.totalWE
  } else {
    ;[compteurs, totalWE] = await Promise.all([
      queryCompteurs(supabase, periodeSelectionnee.id),
      queryTotalWE(supabase, periodeSelectionnee.id),
    ])
  }

  // Bilan bonus/malus : pertinent uniquement en mode période (mécanisme par période)
  const afficherBilan = isAdmin && mode === 'periode' && periodeSelectionnee.statut !== 'brouillon'
  const [bonusMalusHeritage, bonusMalusCourant, vetsInfo] = await Promise.all([
    isAdmin && mode === 'periode'
      ? queryBonusMalusHeritage(supabase, periodeSelectionnee, periodes)
      : Promise.resolve([]),
    afficherBilan
      ? queryBonusMalusCourant(supabase, periodeSelectionnee.id)
      : Promise.resolve([]),
    afficherBilan
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
        mode={mode}
        perimetre={perimetre}
        debut={debut}
        fin={fin}
        statutPeriode={periodeSelectionnee.statut}
      />

      {/* Bilan bonus/malus — admin, mode période, périodes publiées ou verrouillées */}
      {afficherBilan && (
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
