// ============================================================
// GUARDVETO — Page /admin/periodes
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { CreerPeriodeDialog } from '@/components/admin/CreerPeriodeDialog'
import { SupprimerPeriodeButton } from '@/components/admin/SupprimerPeriodeButton'
import { EffectifPeriodeSelect } from '@/components/admin/EffectifPeriodeSelect'
import { ProfilPeriodeSelect } from '@/components/admin/ProfilPeriodeSelect'
import type { Periode, ProfilPlanning } from '@/types'

/**
 * Effectif RÉELLEMENT appliqué par le moteur — MÊME précédence que le loader
 * (engine/loader.ts) : période (surcharge) > profil > saison. L'ancienne
 * version ignorait le profil : la colonne affichait une valeur fausse pour
 * toute période sans surcharge rattachée à un profil portant un effectif.
 */
function effectifResolu(
  p: Periode,
  profilParId: Map<string, ProfilPlanning>,
): { valeur: number; provenance: string | null } {
  if (typeof p.nb_vetos_semaine_soir === 'number') {
    return { valeur: p.nb_vetos_semaine_soir, provenance: null } // réglé sur la période
  }
  const profil = p.profil_id ? profilParId.get(p.profil_id) : undefined
  if (profil && typeof profil.nb_vetos_semaine_soir === 'number') {
    return {
      valeur: profil.nb_vetos_semaine_soir,
      provenance: `hérité du profil « ${profil.nom} »`,
    }
  }
  return {
    valeur: p.saison === 'hiver' ? 2 : 1,
    provenance: `selon la saison (${p.saison === 'hiver' ? 'hiver' : 'été'})`,
  }
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function periodLabel(p: Periode) {
  if (p.libelle) return p.libelle
  if (p.saison === 'ete') return 'Été'
  return `Hiver P${p.numero ?? ''}`
}

function StatutBadge({ statut }: { statut: Periode['statut'] }) {
  if (statut === 'publie')
    return <Badge className="bg-green-100 text-green-800 border border-green-200">Publié</Badge>
  if (statut === 'verrouille') return <Badge variant="secondary">Verrouillé</Badge>
  return <Badge variant="outline">Brouillon</Badge>
}

export default async function PeriodesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: vet } = await supabase
    .from('veterinaires').select('role_app').eq('user_id', user.id).single()
  if (vet?.role_app !== 'admin') redirect('/planning')

  const { data: periodes } = await supabase
    .from('periodes').select('*').order('date_debut', { ascending: false })

  // Profils de planning du cabinet (RLS restrictive → déjà scopés au cabinet).
  // nb_vetos_semaine_soir : nécessaire pour afficher l'effectif RÉSOLU
  // (précédence période > profil > saison, comme le moteur).
  const { data: profilsDb } = await supabase
    .from('profils_planning')
    .select('id, nom, est_defaut, saison_suggeree, nb_vetos_semaine_soir')
    .eq('actif', true)
    .order('ordre')
  const profils = (profilsDb as ProfilPlanning[]) ?? []
  const profilParId = new Map(profils.map((p) => [p.id, p]))
  // Le profil défaut est représenté par « Par défaut » (valeur nulle) : on
  // normalise un profil_id pointant dessus vers null pour un affichage propre.
  const defautId = profils.find((p) => p.est_defaut)?.id ?? null
  const profilsNommes = profils.filter((p) => !p.est_defaut)

  const liste = (periodes as Periode[]) ?? []
  const stats = {
    total:      liste.length,
    publie:     liste.filter(p => p.statut === 'publie').length,
    brouillon:  liste.filter(p => p.statut === 'brouillon').length,
    verrouille: liste.filter(p => p.statut === 'verrouille').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Périodes</h1>
          <p className="text-muted-foreground text-sm mt-1">Toutes les périodes de planification</p>
        </div>
        <CreerPeriodeDialog profils={profilsNommes} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',        value: stats.total,      color: 'text-foreground' },
          { label: 'Publiées',     value: stats.publie,     color: 'text-green-600' },
          { label: 'Brouillons',   value: stats.brouillon,  color: 'text-muted-foreground' },
          { label: 'Verrouillées', value: stats.verrouille, color: 'text-muted-foreground' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tableau — overflow-x-auto : 9 colonnes, illisible sinon sur mobile */}
      <div className="rounded-xl border overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Titre</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Début</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fin</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Durée</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Effectif semaine</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Profil</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Statut</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Publié le</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {liste.map(p => {
              const nbJours = Math.round(
                (new Date(p.date_fin).getTime() - new Date(p.date_debut).getTime()) / (1000 * 60 * 60 * 24) + 1
              )
              return (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{periodLabel(p)}</td>
                  <td className="px-4 py-3">{formatDate(p.date_debut)}</td>
                  <td className="px-4 py-3">{formatDate(p.date_fin)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{Math.round(nbJours / 7)} sem.</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const eff = effectifResolu(p, profilParId)
                      return (
                        <div className="space-y-0.5">
                          <EffectifPeriodeSelect
                            periodeId={p.id}
                            valeur={eff.valeur}
                            disabled={p.statut === 'verrouille'}
                          />
                          {eff.provenance && (
                            <p className="text-[11px] text-muted-foreground">{eff.provenance}</p>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <ProfilPeriodeSelect
                      periodeId={p.id}
                      valeur={p.profil_id && p.profil_id !== defautId ? p.profil_id : null}
                      profils={profilsNommes}
                      disabled={p.statut === 'verrouille'}
                    />
                  </td>
                  <td className="px-4 py-3"><StatutBadge statut={p.statut} /></td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.publie_at ? formatDate(p.publie_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.statut === 'brouillon' && (
                      <SupprimerPeriodeButton periodeId={p.id} label={periodLabel(p)} />
                    )}
                  </td>
                </tr>
              )
            })}
            {liste.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  Aucune période créée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <a href="/planning" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← Retour au planning
      </a>
    </div>
  )
}
