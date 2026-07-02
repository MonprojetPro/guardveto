'use client'

// ============================================================
// GUARDVETO — Gestionnaire de profils de planning (P5 slice 4a)
// ============================================================
// Un cabinet compose des profils nommés (« Hiver », « Été »…) réutilisables,
// sélectionnés à la génération d'une période (slice 3). Cet écran permet de les
// créer (par duplication d'un profil source), renommer, régler leur saison
// suggérée + effectif, et les supprimer. Le profil DÉFAUT est intangible.
//
// Périmètre : on compose à partir des types de garde existants. Inventer des
// types inédits / >2 places viendra avec P3b/P6 (l'aval ne sait pas encore les
// persister). Admin seul édite ; le véto voit la liste en lecture.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  creerProfil, renommerProfil, setProfilMeta, supprimerProfil,
} from '@/app/(protected)/admin/structure/actions'

// Radix Select interdit la valeur vide → sentinelle pour « aucune valeur ».
const NULL_SENT = '__none__'

export interface ProfilLigne {
  id: string
  nom: string
  est_defaut: boolean
  saison_suggeree: 'ete' | 'hiver' | null
  nb_vetos_semaine_soir: number | null
  nb_types: number
}

type ActionResult = { error?: string; success?: boolean } | undefined

function saisonLabel(s: 'ete' | 'hiver' | null): string {
  return s === 'ete' ? 'Été' : s === 'hiver' ? 'Hiver' : 'Aucune'
}
function effectifLabel(n: number | null): string {
  return n === 1 ? '1 véto' : n === 2 ? '2 vétos' : 'Selon la période'
}

export function ProfilsManager({ profils, isAdmin }: { profils: ProfilLigne[]; isAdmin: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [creation, setCreation] = useState(false)
  const [editionId, setEditionId] = useState<string | null>(null)
  const [nomEdite, setNomEdite] = useState('')

  const run = (action: () => Promise<ActionResult>, okMsg: string) => {
    startTransition(async () => {
      const res = await action()
      if (res?.error) toast.error(res.error)
      else {
        toast.success(okMsg)
        setEditionId(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setCreation(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + Créer un profil
          </button>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden bg-card divide-y">
        {profils.map((p) => (
          <div key={p.id} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            {/* Nom (+ édition inline) */}
            <div className="flex-1 min-w-[180px]">
              {editionId === p.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nomEdite}
                    onChange={(e) => setNomEdite(e.target.value)}
                    className="rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={() => run(() => renommerProfil(p.id, nomEdite), 'Profil renommé.')}
                    disabled={isPending}
                    className="text-xs rounded-md bg-primary px-2.5 py-1.5 text-primary-foreground disabled:opacity-50"
                  >
                    Enregistrer
                  </button>
                  <button
                    onClick={() => setEditionId(null)}
                    className="text-xs rounded-md border px-2.5 py-1.5 hover:bg-muted"
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.nom}</span>
                  {p.est_defaut && (
                    <Badge variant="secondary" className="font-normal">Par défaut</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {p.nb_types} type{p.nb_types > 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>

            {isAdmin ? (
              <>
                {/* Saison suggérée */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Saison</span>
                  <Select
                    value={p.saison_suggeree ?? NULL_SENT}
                    onValueChange={(v) =>
                      v && run(
                        () => setProfilMeta(p.id, {
                          saison_suggeree: v === NULL_SENT ? null : (v as 'ete' | 'hiver'),
                        }),
                        'Saison suggérée mise à jour.',
                      )
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      {saisonLabel(p.saison_suggeree)}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NULL_SENT}>Aucune</SelectItem>
                      <SelectItem value="ete">Été</SelectItem>
                      <SelectItem value="hiver">Hiver</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Effectif */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Effectif</span>
                  <Select
                    value={p.nb_vetos_semaine_soir ? String(p.nb_vetos_semaine_soir) : NULL_SENT}
                    onValueChange={(v) =>
                      v && run(
                        () => setProfilMeta(p.id, {
                          nb_vetos_semaine_soir: v === NULL_SENT ? null : Number(v),
                        }),
                        'Effectif du profil mis à jour.',
                      )
                    }
                    disabled={isPending}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      {effectifLabel(p.nb_vetos_semaine_soir)}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NULL_SENT}>Selon la période</SelectItem>
                      <SelectItem value="1">1 véto</SelectItem>
                      <SelectItem value="2">2 vétos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditionId(p.id); setNomEdite(p.nom) }}
                    className="text-xs rounded-md border px-2.5 py-1.5 hover:bg-muted"
                  >
                    Renommer
                  </button>
                  {!p.est_defaut && (
                    <button
                      onClick={() => {
                        if (confirm(`Supprimer le profil « ${p.nom} » ? Les périodes qui l'utilisent repasseront au profil par défaut.`)) {
                          run(() => supprimerProfil(p.id), 'Profil supprimé.')
                        }
                      }}
                      className="text-xs rounded-md border border-red-200 text-red-600 px-2.5 py-1.5 hover:bg-red-50"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </>
            ) : (
              // Lecture seule (véto) : on montre les réglages sans les éditer.
              <div className="text-xs text-muted-foreground flex items-center gap-4">
                <span>Saison : {saisonLabel(p.saison_suggeree)}</span>
                <span>Effectif : {effectifLabel(p.nb_vetos_semaine_soir)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {creation && (
        <CreerProfilDialog
          profils={profils}
          isPending={isPending}
          onClose={() => setCreation(false)}
          onSubmit={(payload) =>
            run(async () => {
              const res = await creerProfil(payload)
              if (!res?.error) setCreation(false)
              return res
            }, 'Profil créé.')
          }
        />
      )}
    </div>
  )
}

// ── Dialog de création (form natif → FormData simple) ────────
function CreerProfilDialog({
  profils, isPending, onClose, onSubmit,
}: {
  profils: ProfilLigne[]
  isPending: boolean
  onClose: () => void
  onSubmit: (payload: {
    nom: string
    source_profil_id: string | null
    saison_suggeree: 'ete' | 'hiver' | null
    nb_vetos_semaine_soir: number | null
  }) => void
}) {
  const defaut = profils.find((p) => p.est_defaut) ?? profils[0]

  const handle = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const saison = (f.get('saison') as string) || ''
    const eff = (f.get('effectif') as string) || ''
    onSubmit({
      nom: (f.get('nom') as string)?.trim() ?? '',
      source_profil_id: (f.get('source') as string) || null,
      saison_suggeree: saison === 'ete' || saison === 'hiver' ? saison : null,
      nb_vetos_semaine_soir: eff === '1' || eff === '2' ? Number(eff) : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border bg-card shadow-lg mx-4">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Nouveau profil de planning</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Le nouveau profil reprend les types de garde du profil source ; vous pourrez ensuite ajuster sa saison et son effectif.
          </p>

          <form onSubmit={handle} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Nom</label>
              <input
                type="text"
                name="nom"
                placeholder="ex. Hiver, Été, Vacances…"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Dupliquer depuis</label>
              <select
                name="source"
                defaultValue={defaut?.id ?? ''}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {profils.map((p) => (
                  <option key={p.id} value={p.id}>{p.nom}{p.est_defaut ? ' (par défaut)' : ''}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Saison suggérée</label>
                <select
                  name="saison"
                  defaultValue=""
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Aucune</option>
                  <option value="ete">Été</option>
                  <option value="hiver">Hiver</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Effectif</label>
                <select
                  name="effectif"
                  defaultValue=""
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Selon la période</option>
                  <option value="1">1 véto</option>
                  <option value="2">2 vétos</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isPending ? 'Création...' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
