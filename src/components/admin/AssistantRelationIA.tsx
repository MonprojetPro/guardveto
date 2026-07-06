'use client'

// ============================================================
// GUARDVETO — Assistant IA : lier deux créneaux en langage naturel (RG4)
// ============================================================
// Décris une liaison (« le week-end doit garder l'équipe du vendredi ») →
// l'IA propose une liaison structurée → tu valides → création via
// creerRelationCreneau. Miroir exact de AssistantProfilIA (P5 slice 5).
// L'IA PROPOSE, l'humain DÉCIDE : aucune écriture tant que « Créer » n'est
// pas cliqué.
// ============================================================

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles, Loader2, Check, RotateCcw, Eraser, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  proposerRelationDepuisTexte,
  creerRelationCreneau,
  type PropositionRelationResultat,
} from '@/app/(protected)/admin/structure/actions'

/** Ce que l'assistant sait faire, en langage clair (pas de jargon). */
const CAPACITES = [
  'Lier deux types de garde pour que la même équipe assure les deux (comme votre vendredi soir et votre week-end).',
  'Lier deux types de garde pour qu’un vétérinaire présent sur les deux y change de rôle (1er puis 2nd).',
  'Cibler un profil précis (« sur le profil Été… ») — sinon le profil par défaut.',
]

const EXEMPLES = [
  'La garde du samedi doit garder la même équipe que le vendredi soir',
  'Un véto qui enchaîne le matin et le soir doit changer de rôle',
]

export function AssistantRelationIA() {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [phrase, setPhrase] = useState('')
  const [resultat, setResultat] = useState<PropositionRelationResultat | null>(null)
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null)
  const [erreurCreation, setErreurCreation] = useState<string | null>(null)
  const [aideOuverte, setAideOuverte] = useState(false)
  const [isAsking, startAsk] = useTransition()
  const [isCreating, startCreate] = useTransition()

  const demander = () => {
    if (phrase.trim().length < 3) {
      setErreurSaisie('Décris la liaison en quelques mots.')
      textareaRef.current?.focus()
      return
    }
    setErreurSaisie(null)
    setErreurCreation(null)
    startAsk(async () => {
      const res = await proposerRelationDepuisTexte(phrase)
      setResultat(res)
      if ('error' in res) toast.error(res.error)
    })
  }

  const creer = () => {
    if (!resultat || 'error' in resultat || !resultat.payload) return
    setErreurCreation(null)
    const payload = resultat.payload
    startCreate(async () => {
      const res = await creerRelationCreneau(payload)
      if (res && 'error' in res) { setErreurCreation(res.error); return }
      toast.success('Liaison créée — elle s’applique dès la prochaine génération.')
      setPhrase('')
      setResultat(null)
      router.refresh()
    })
  }

  /** Repart de zéro côté proposition, mais GARDE la phrase pour l'éditer. */
  const reformuler = () => {
    setResultat(null)
    setErreurCreation(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  /** Remise à zéro complète : efface AUSSI la phrase. */
  const toutEffacer = () => {
    setPhrase('')
    setResultat(null)
    setErreurCreation(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const proposition = resultat && !('error' in resultat) ? resultat.proposition : null
  const apercu = resultat && !('error' in resultat) ? resultat.apercu : ''
  const payload = resultat && !('error' in resultat) ? resultat.payload : undefined

  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-4 space-y-3 max-w-3xl">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" aria-hidden />
        <h3 className="font-semibold text-sm text-foreground">Assistant IA — décris une liaison</h3>
        <span className="text-[11px] font-normal px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
          bêta
        </span>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ia-relation" className="sr-only">Décris la liaison</Label>
        <textarea
          id="ia-relation"
          ref={textareaRef}
          rows={2}
          value={phrase}
          onChange={(e) => { setPhrase(e.target.value); if (erreurSaisie) setErreurSaisie(null) }}
          placeholder="Ex. « La garde du samedi doit garder la même équipe que le vendredi soir »"
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

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={demander} disabled={isAsking} size="sm">
          {isAsking ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> L&apos;IA réfléchit…</> : <>Proposer une liaison</>}
        </Button>
        <button
          type="button"
          onClick={() => setAideOuverte(true)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          <HelpCircle className="w-3.5 h-3.5" /> Que sait faire l&apos;assistant ?
        </button>
      </div>

      {erreurSaisie && (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
          {erreurSaisie}
        </p>
      )}

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

              {proposition.message && (
                <p className="text-xs text-muted-foreground">{proposition.message}</p>
              )}

              <div className="flex gap-2">
                <Button onClick={creer} disabled={isCreating} size="sm" className="flex-1">
                  {isCreating
                    ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Création…</>
                    : <><Check className="w-4 h-4 mr-1" /> Créer cette liaison</>}
                </Button>
                <Button onClick={reformuler} disabled={isCreating} size="sm" variant="outline">
                  <RotateCcw className="w-4 h-4 mr-1" /> Reformuler
                </Button>
                <Button
                  onClick={toutEffacer}
                  disabled={isCreating}
                  size="sm"
                  variant="ghost"
                  title="Effacer la phrase et la proposition (repartir de zéro)"
                >
                  <Eraser className="w-4 h-4 mr-1" /> Tout effacer
                </Button>
              </div>
              {erreurCreation && (
                <p className="text-xs text-destructive font-medium rounded-md bg-destructive/10 px-2.5 py-2" role="alert">
                  {erreurCreation}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/70 text-center">
                Vérifie la proposition avant de créer — l&apos;IA peut se tromper.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {proposition.message || "L'assistant n'a pas pu transformer ta demande en liaison. Reformule ou crée-la à la main."}
              </p>
              <div className="flex gap-2">
                <Button onClick={reformuler} size="sm" variant="outline">
                  <RotateCcw className="w-4 h-4 mr-1" /> Reformuler ma demande
                </Button>
                <Button
                  onClick={toutEffacer}
                  size="sm"
                  variant="ghost"
                  title="Effacer la phrase et la proposition (repartir de zéro)"
                >
                  <Eraser className="w-4 h-4 mr-1" /> Tout effacer
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Fenêtre d'aide : ce que l'assistant sait faire (langage clair) */}
      <Dialog open={aideOuverte} onOpenChange={setAideOuverte}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ce que l&apos;assistant sait lier</DialogTitle>
            <DialogDescription>
              Décris la liaison avec tes mots. L&apos;assistant sait gérer ces règles :
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm text-foreground">
            {CAPACITES.map((c) => (
              <li key={c} className="flex gap-2">
                <Check className="w-4 h-4 mt-0.5 text-accent shrink-0" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground border-t border-border pt-3 mt-1">
            Le niveau de ces règles (ferme ou simple préférence) se règle dans{' '}
            <a href="/regles" className="underline hover:text-foreground">Règles du planning</a>.
            Imposer un repos après une garde viendra plus tard.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  )
}
