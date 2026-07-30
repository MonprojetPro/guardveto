'use client'

import { useState, useRef } from 'react'
import { creerPeriode } from '@/app/(protected)/admin/periodes/actions'
import type { ProfilPlanning } from '@/types'

interface CreerPeriodeDialogProps {
  /** Profils nommés du cabinet (hors défaut) proposés à la création. */
  profils?: ProfilPlanning[]
}

export function CreerPeriodeDialog({ profils = [] }: CreerPeriodeDialogProps) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const data = new FormData(e.currentTarget)
    const result = await creerPeriode(data)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      setOpen(false)
      formRef.current?.reset()
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        + Créer une période
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Cette modale est écrite à la main (pas de composant `Dialog`), elle
              échappait donc à tout l'habillage V2 et sortait en palette V1 au
              milieu du terrier. Les `data-slot` sont le point d'accroche que
              la feuille `v2-terrier.css` utilise pour toutes les autres : les
              poser ici suffit à lui donner voile brun, surface crème, arrondis
              et champs à 42 px, sans dupliquer une ligne de style.
              Le padding vient désormais de la feuille, d'où la disparition du
              `p-6` qui ferait doublon. */}
          <div
            data-slot="dialog-overlay"
            className="absolute inset-0"
            onClick={() => setOpen(false)}
          />

          <div data-slot="dialog-content" className="relative z-10 w-full max-w-md mx-4">
            <div>
              <h2 data-slot="dialog-title" className="mb-4">Nouvelle période</h2>

              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                {/* Titre */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Titre</label>
                  <input
                    type="text"
                    name="libelle"
                    placeholder="ex. Été 2027, Hiver P1 2027-2028…"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                {/* Date début */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Date de début <span className="text-muted-foreground font-normal">(doit être un lundi)</span>
                  </label>
                  <input
                    type="date"
                    name="date_debut"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                {/* Date fin */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Date de fin</label>
                  <input
                    type="date"
                    name="date_fin"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                {/* Profil de planning (P5) — seulement s'il existe des profils nommés.
                    Vide = automatique selon la saison, sinon profil défaut du cabinet. */}
                {profils.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Profil de planning <span className="text-muted-foreground font-normal">(structure des gardes)</span>
                    </label>
                    <select
                      name="profil_id"
                      defaultValue=""
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Automatique (selon la saison)</option>
                      {profils.map((p) => (
                        <option key={p.id} value={p.id}>{p.nom}</option>
                      ))}
                    </select>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
