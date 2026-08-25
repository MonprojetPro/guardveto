// ============================================================
// GUARDVETO V2 — Absences & échanges (écran fusionné)
// ============================================================
// Troisième écran de la bascule (maquette M3). Il RÉUNIT ce qui était éclaté
// sur quatre entrées de menu — /conges, /echanges, /admin/depannages et la
// gestion de crise — parce que c'est une seule question : qui n'est pas là,
// et qu'est-ce qu'on fait.
//
// Les anciennes routes restent en place et continuent de fonctionner : elles
// seront retirées quand cet écran aura été recetté.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerVeterinaire } from '@/lib/identite'
import '@/styles/v2-absences.css'
import '@/styles/v2-echanges.css'
import '@/styles/v2-filou-edge.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { AbsencesV2 } from '@/components/v2/AbsencesV2'
import { chargerDock } from '@/data/v2/dock'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import {
  detecterConflitsPourDecision,
  type VerdictSouhait,
} from '@/lib/conges/detection-conflit'
import type { EchangeRow, GardeLite, VetLite } from '@/components/echanges/EchangesClient'
import type { CompensationLigne } from '@/components/admin/DepannagesClient'
import type { VetCrise } from '@/components/planning/CriseModal'
import type { Conge, StatutCompensation, RoleCompensation, TypeGarde, Veterinaire } from '@/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Absences & échanges' }

/** Forme brute d'une compensation avec ses jointures (cf. /admin/depannages). */
interface LigneCompensation {
  id: string
  role: RoleCompensation | null
  statut: StatutCompensation
  created_at: string
  garde: { date: string; type: TypeGarde } | null
  remplacant: { prenom: string } | null
  remplace: { prenom: string } | null
  absence: { date_debut: string; motif: 'maladie' | 'urgence' | 'autre' } | null
}

export default async function AbsencesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Le secretariat n'a pas de fiche veterinaire : `exigerVeterinaire` le
  // renvoie vers le planning au lieu de le deconnecter (B-017, 2026-08-25).
  // C'est ce refus SERVEUR qui ferme la porte -- le dock reduit n'est qu'un
  // confort d'affichage.
  const { veto: moi } = await exigerVeterinaire(supabase)

  const vet = moi as Veterinaire
  const isAdmin = vet.role_app === 'admin'
  const aujourdHui = new Date().toISOString().slice(0, 10)

  const [vetsRes, congesRes, echangesRes, gardesRes, depannagesRes] = await Promise.all([
    supabase.from('veterinaires').select('*').order('nom'),
    supabase.from('conges').select('*').order('date_debut'),
    supabase
      .from('echanges_gardes')
      .select(
        `id, statut, message, motif_refus, role_demandeur, role_contrepartie,
         demandeur_id, cible_id, created_at,
         garde:garde_id(id, date, type),
         gardeContrepartie:garde_contrepartie_id(id, date, type)`,
      )
      .order('created_at', { ascending: false })
      .limit(100),
    // Gardes futures des plannings publiés non verrouillés : la matière du
    // formulaire d'échange (mes gardes à céder, celles du confrère à reprendre).
    supabase
      .from('gardes')
      .select('id, date, type, premier_id, second_id, periodes!inner(statut)')
      .gt('date', aujourdHui)
      .eq('periodes.statut', 'publie')
      .eq('verrouille', false)
      .order('date'),
    isAdmin
      ? supabase
          .from('compensations')
          .select(
            `id, role, statut, created_at,
             garde:gardes ( date, type ),
             remplacant:veterinaires!compensations_remplacant_id_fkey ( prenom ),
             remplace:veterinaires!compensations_remplace_id_fkey ( prenom ),
             absence:absences ( date_debut, motif )`,
          )
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: null }),
  ])

  const vets = ((vetsRes?.data ?? []) as Veterinaire[])
  const conges = ((congesRes?.data ?? []) as Conge[])

  // ── Verdict de conflit sur les souhaits en attente (admin) ──
  // Calculé en amont pour que la ligne l'affiche sans clic. Couvre les
  // plannings PUBLIÉS et les BROUILLONS : l'écran n'annonçait que le publié,
  // et affichait donc « aucun conflit » à un cabinet qui n'avait aucun planning
  // publié — pendant que six souhaits percutaient un brouillon (retour MiKL du
  // 2026-08-20).
  // Fail-open : un détecteur muet n'empêche jamais l'écran de vivre — la clé
  // reste alors absente, et la ligne n'affirme rien plutôt que de rassurer à tort.
  const verdicts: Record<string, VerdictSouhait> = {}
  if (isAdmin) {
    const souhaits = conges.filter((c) => c.statut === 'souhait')
    if (souhaits.length > 0) {
      let cabinetId: string | null = null
      try {
        cabinetId = await resoudreCabinetId(supabase)
      } catch {
        cabinetId = null
      }
      if (cabinetId) {
        const cid = cabinetId
        const resultats = await Promise.all(
          souhaits.map(async (c) => ({
            id: c.id,
            verdict: await detecterConflitsPourDecision({
              supabase,
              cabinetId: cid,
              veterinaireId: c.veterinaire_id,
              dateDebut: c.date_debut,
              dateFin: c.date_fin,
            }),
          })),
        )
        for (const r of resultats) verdicts[r.id] = r.verdict
      }
    }
  }

  const lignesDepannages: CompensationLigne[] = (
    ((depannagesRes?.data ?? []) as LigneCompensation[]) ?? []
  )
    .map((r) => ({
      id: r.id,
      statut: r.statut,
      role: r.role,
      gardeDate: r.garde?.date ?? null,
      gardeType: r.garde?.type ?? null,
      remplacantPrenom: r.remplacant?.prenom ?? null,
      remplacePrenom: r.remplace?.prenom ?? null,
      absenceMotif: r.absence?.motif ?? null,
      absenceDateDebut: r.absence?.date_debut ?? null,
    }))
    .sort((a, b) => (b.gardeDate ?? '').localeCompare(a.gardeDate ?? ''))

  const statsDepannages = {
    ouvertes: lignesDepannages.filter((l) => l.statut === 'a_compenser').length,
    compensees: lignesDepannages.filter((l) => l.statut === 'compensee').length,
  }

  const vetsCrise: VetCrise[] = isAdmin
    ? vets
        .filter((v) => v.actif)
        .map((v) => ({ id: v.id, prenom: v.prenom, nom: v.nom, couleur: v.couleur }))
    : []

  const dock = await chargerDock(supabase, vet)

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={isAdmin} dock={dock} />
        <AbsencesV2
          conges={conges}
          vets={vets}
          moiId={vet.id}
          isAdmin={isAdmin}
          verdicts={verdicts}
          echanges={(echangesRes?.data ?? []) as unknown as EchangeRow[]}
          gardesFutures={(gardesRes?.data ?? []) as unknown as GardeLite[]}
          vetsEchange={
            vets
              .filter((v) => v.actif)
              .map((v) => ({ id: v.id, prenom: v.prenom, nom: v.nom, couleur: v.couleur })) as VetLite[]
          }
          vetsCrise={vetsCrise}
          depannages={lignesDepannages}
          statsDepannages={statsDepannages}
        />
      </div>
    </>
  )
}
