'use client'

// ============================================================
// GUARDVETO — Assistant IA (Palier 3, slice 1) — UI BASIQUE
// ============================================================
// Décris une règle en langage naturel → l'IA propose une règle structurée →
// tu valides → création via le upsertRegle existant. Visuel volontairement
// minimal (la refonte design viendra en phase finale). L'IA PROPOSE, l'humain
// DÉCIDE : aucune écriture en base tant que l'admin n'a pas cliqué « Créer ».
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  proposerRegleDepuisTexte,
  upsertRegle,
  type PropositionIaResultat,
} from '@/app/(protected)/regles/actions'

const FORCE_LABEL: Record<string, string> = {
  jamais: '🔴 Interdiction ferme',
  sauf_crise: '🟠 À éviter sauf crise',
  evitee: '🟡 Préférence (évitée)',
  si_possible: '🟡 Préférence (si possible)',
}

const EXEMPLES = [
  'Manon ne fait jamais de garde le mercredi',
  'Victor au plus 2 gardes par semaine',
  'Au moins 3 jours entre deux gardes pour Antoine',
]

export function AssistantIA() {
  const router = useRouter()
  const [phrase, setPhrase] = useState('')
  const [resultat, setResultat] = useState<PropositionIaResultat | null>(null)
  const [isAsking, startAsk] = useTransition()
  const [isCreating, startCreate] = useTransition()

  const demander = () => {
    if (phrase.trim().length < 3) {
      toast.error('Décris ta règle en quelques mots.')
      return
    }
    startAsk(async () => {
      const res = await proposerRegleDepuisTexte(phrase)
      setResultat(res)
      if ('error' in res) toast.error(res.error)
    })
  }

  const creer = () => {
    if (!resultat || 'error' in resultat || !resultat.payload) return
    startCreate(async () => {
      const res = await upsertRegle(resultat.payload!)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Règle créée.')
      setPhrase('')
      setResultat(null)
      router.refresh()
    })
  }

  const proposition = resultat && !('error' in resultat) ? resultat.proposition : null
  const apercu = resultat && !('error' in resultat) ? resultat.apercu : ''
  const payload = resultat && !('error' in resultat) ? resultat.payload : undefined

  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3 max-w-3xl">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" aria-hidden />
        <h2 className="font-semibold text-sm text-foreground">Assistant IA — décris ta règle</h2>
        <span className="text-[11px] font-normal px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
          bêta
        </span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ia-phrase" className="sr-only">Décris ta règle</Label>
        <textarea
          id="ia-phrase"
          rows={2}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Ex. « Manon ne fait jamais de garde le mercredi »"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXEMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPhrase(ex)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <Button onClick={demander} disabled={isAsking} size="sm">
        {isAsking ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> L&apos;IA réfléchit…</> : <>Proposer une règle</>}
      </Button>

      {/* Proposition */}
      {proposition && (
        <div className="space-y-2 rounded-md border bg-card p-3">
          {proposition.comprehension && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Compris :</span> {proposition.comprehension}
            </p>
          )}

          {payload && apercu ? (
            <>
              <div className="rounded-md bg-muted/50 p-2.5">
                <p className="text-sm text-foreground leading-6">{apercu}</p>
                {proposition.force && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {FORCE_LABEL[proposition.force] ?? proposition.force}
                  </p>
                )}
              </div>
              {proposition.message && (
                <p className="text-xs text-muted-foreground">{proposition.message}</p>
              )}
              <Button onClick={creer} disabled={isCreating} size="sm" className="w-full">
                {isCreating
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Création…</>
                  : <><Check className="w-4 h-4 mr-1" /> Créer cette règle</>}
              </Button>
              <p className="text-[11px] text-muted-foreground/70 text-center">
                Vérifie la proposition avant de créer — l&apos;IA peut se tromper.
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {proposition.message || "L'assistant n'a pas pu transformer ta demande en règle. Reformule ou utilise « Nouvelle règle »."}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
