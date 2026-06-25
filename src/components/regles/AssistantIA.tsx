'use client'

// ============================================================
// GUARDVETO — Assistant IA (Palier 3, slice 1) — UI BASIQUE
// ============================================================
// Décris une règle en langage naturel → l'IA propose une règle structurée →
// tu valides → création via le upsertRegle existant. Visuel volontairement
// minimal (la refonte design viendra en phase finale). L'IA PROPOSE, l'humain
// DÉCIDE : aucune écriture en base tant que l'admin n'a pas cliqué « Créer ».
//
// L'admin garde la main sur DEUX décisions avant de créer :
//   • la PUISSANCE (étage dur/mou) — pré-remplie par l'IA, réglable ;
//   • « Reformuler » — repart de la phrase (effacer la proposition), que la
//     règle ait été jugée faisable ou non par l'IA.
// ============================================================

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles, Loader2, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  proposerRegleDepuisTexte,
  upsertRegle,
  type ForceFormulaire,
  type PropositionIaResultat,
} from '@/app/(protected)/regles/actions'

const FORCE_LABEL: Record<ForceFormulaire, string> = {
  jamais: '🔴 Interdiction ferme',
  sauf_crise: '🟠 À éviter sauf crise',
  evitee: '🟡 Préférence (évitée)',
  si_possible: '🟡 Préférence (si possible)',
}

/** Du plus contraignant (dur) au plus souple (mou) — ordre d'affichage. */
const FORCES_ORDRE: ForceFormulaire[] = ['jamais', 'sauf_crise', 'evitee', 'si_possible']

const EXEMPLES = [
  'Manon ne fait jamais de garde le mercredi',
  'Victor au plus 2 gardes par semaine',
  'Au moins 3 jours entre deux gardes pour Antoine',
]

export function AssistantIA() {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [phrase, setPhrase] = useState('')
  const [resultat, setResultat] = useState<PropositionIaResultat | null>(null)
  // Puissance choisie par l'admin (pré-remplie avec celle proposée par l'IA).
  const [force, setForce] = useState<ForceFormulaire | null>(null)
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
      // Pré-remplit le curseur de puissance avec le choix de l'IA (réglable ensuite).
      setForce(!('error' in res) && res.payload ? res.payload.force : null)
      if ('error' in res) toast.error(res.error)
    })
  }

  const creer = () => {
    if (!resultat || 'error' in resultat || !resultat.payload) return
    // L'admin peut avoir ajusté la puissance : on prend SON choix, sinon celui de l'IA.
    const payloadFinal = { ...resultat.payload, force: force ?? resultat.payload.force }
    startCreate(async () => {
      const res = await upsertRegle(payloadFinal)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Règle créée.')
      setPhrase('')
      setResultat(null)
      setForce(null)
      router.refresh()
    })
  }

  /** Repart de zéro côté proposition, mais garde la phrase pour l'éditer. */
  const reformuler = () => {
    setResultat(null)
    setForce(null)
    // Redonne le focus au texte pour enchaîner la reformulation.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const proposition = resultat && !('error' in resultat) ? resultat.proposition : null
  const apercu = resultat && !('error' in resultat) ? resultat.apercu : ''
  const payload = resultat && !('error' in resultat) ? resultat.payload : undefined
  /** Puissance proposée par l'IA (pour signaler à l'admin s'il l'a modifiée). */
  const forceIa = payload?.force ?? null

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
          ref={textareaRef}
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
              </div>

              {/* Puissance réglable — pré-remplie avec le choix de l'IA */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Puissance de la règle
                </Label>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Puissance de la règle">
                  {FORCES_ORDRE.map((f) => {
                    const actif = (force ?? payload.force) === f
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={actif}
                        onClick={() => setForce(f)}
                        className={
                          'text-xs px-2.5 py-1 rounded-md border transition-colors ' +
                          (actif
                            ? 'border-accent bg-accent/15 text-foreground font-medium'
                            : 'border-border text-muted-foreground hover:bg-muted')
                        }
                      >
                        {FORCE_LABEL[f]}
                      </button>
                    )
                  })}
                </div>
                {forceIa && (force ?? payload.force) !== forceIa && (
                  <p className="text-[11px] text-muted-foreground/70">
                    Modifié — l&apos;IA proposait : {FORCE_LABEL[forceIa]}
                  </p>
                )}
              </div>

              {proposition.message && (
                <p className="text-xs text-muted-foreground">{proposition.message}</p>
              )}

              <div className="flex gap-2">
                <Button onClick={creer} disabled={isCreating} size="sm" className="flex-1">
                  {isCreating
                    ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Création…</>
                    : <><Check className="w-4 h-4 mr-1" /> Créer cette règle</>}
                </Button>
                <Button
                  onClick={reformuler}
                  disabled={isCreating}
                  size="sm"
                  variant="outline"
                >
                  <RotateCcw className="w-4 h-4 mr-1" /> Reformuler
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/70 text-center">
                Vérifie la proposition avant de créer — l&apos;IA peut se tromper.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {proposition.message || "L'assistant n'a pas pu transformer ta demande en règle. Reformule ou utilise « Nouvelle règle »."}
              </p>
              <Button onClick={reformuler} size="sm" variant="outline">
                <RotateCcw className="w-4 h-4 mr-1" /> Reformuler ma demande
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
