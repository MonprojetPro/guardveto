'use client'

import { useState, useRef } from 'react'
import { creerPeriode } from '@/app/(protected)/admin/periodes/actions'

export function CreerPeriodeDialog() {
  const [open, setOpen]       = useState(false)
  const [saison, setSaison]   = useState<'ete' | 'hiver'>('ete')
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
      setSaison('ete')
    }
  }

  return (
    <>
      {/* Bouton déclencheur */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        + Créer une période
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Contenu */}
          <div className="relative z-10 w-full max-w-md rounded-xl border bg-card shadow-lg mx-4">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Nouvelle période
              </h2>

              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                {/* Saison */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Saison
                  </label>
                  <select
                    name="saison"
                    value={saison}
                    onChange={(e) => setSaison(e.target.value as 'ete' | 'hiver')}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="ete">Été</option>
                    <option value="hiver">Hiver</option>
                  </select>
                </div>

                {/* Numéro (hiver uniquement) */}
                {saison === 'hiver' && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Numéro de période
                    </label>
                    <select
                      name="numero"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    >
                      <option value="1">Période 1</option>
                      <option value="2">Période 2</option>
                      <option value="3">Période 3</option>
                    </select>
                  </div>
                )}

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
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Date de fin
                  </label>
                  <input
                    type="date"
                    name="date_fin"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {error}
                  </p>
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
