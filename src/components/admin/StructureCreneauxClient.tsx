'use client'

// ============================================================
// GUARDVETO — Réglage de la structure des créneaux (A3)
// ============================================================
// Une carte par type de garde (soir de semaine, vendredi soir, week-end,
// férié). L'admin règle l'heure de début, l'heure de fin, et le jour où la
// garde se termine (présenté EN CLAIR : « le lendemain / le surlendemain »,
// jamais « offset »). Un badge « Valeur par défaut » indique qu'aucune
// surcharge n'est enregistrée : le cabinet utilise alors les horaires par
// défaut de l'application.
//
// Modifier + Enregistrer = upsert de la ligne creneaux_cabinet.
// Réinitialiser au défaut = suppression de la ligne (bouton visible seulement
// s'il existe une surcharge). Véto = lecture seule (aucun bouton, champs
// verrouillés). Effet à la prochaine génération / synchro agenda.
//
// Chaque carte est clé-ée sur ses valeurs serveur : après un enregistrement
// (router.refresh), la clé change et l'état local se réinitialise proprement
// depuis les nouvelles props.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, RotateCcw } from 'lucide-react'
import {
  Card, CardHeader, CardTitle, CardContent, CardFooter,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  upsertCreneauCabinet, resetCreneauCabinet,
} from '@/app/(protected)/admin/structure/actions'

/** Données d'un type de créneau prêtes pour l'UI (valeur cabinet OU défaut). */
export interface CreneauUI {
  code: string
  libelle: string
  heureDebut: string // 'HH:MM'
  heureFin: string // 'HH:MM'
  offsetJoursFin: number // 0..3
  /** Vrai si aucune surcharge cabinet → on affiche les horaires par défaut. */
  estDefaut: boolean
}

/** Libellés « en clair » du jour de fin (jamais le mot « offset »). */
const OFFSET_LABELS: Record<number, string> = {
  0: 'le jour même',
  1: 'le lendemain',
  2: 'le surlendemain',
  3: 'trois jours après',
}
const OFFSET_OPTIONS = [0, 1, 2, 3]
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10))
  return h * 60 + m
}

function CreneauCard({ creneau, isAdmin }: { creneau: CreneauUI; isAdmin: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [debut, setDebut] = useState(creneau.heureDebut)
  const [fin, setFin] = useState(creneau.heureFin)
  const [offset, setOffset] = useState(creneau.offsetJoursFin)

  const modifie =
    debut !== creneau.heureDebut
    || fin !== creneau.heureFin
    || offset !== creneau.offsetJoursFin

  const enregistrer = () => {
    // Validation légère côté client (le serveur reste l'autorité).
    if (!HEURE_RE.test(debut) || !HEURE_RE.test(fin)) {
      toast.error('Renseigne des heures valides (format HH:MM).')
      return
    }
    if (offset === 0 && enMinutes(fin) <= enMinutes(debut)) {
      toast.error("L'heure de fin doit être après le début, ou la garde doit finir un jour suivant.")
      return
    }
    startTransition(async () => {
      const res = await upsertCreneauCabinet({
        code: creneau.code,
        heure_debut: debut,
        heure_fin: fin,
        offset_jours_fin: offset,
      })
      if (res?.error) toast.error(res.error)
      else {
        toast.success(`Horaires « ${creneau.libelle} » enregistrés.`)
        router.refresh()
      }
    })
  }

  const reinitialiser = () => {
    startTransition(async () => {
      const res = await resetCreneauCabinet(creneau.code)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(`« ${creneau.libelle} » remis aux horaires par défaut.`)
        router.refresh()
      }
    })
  }

  const verrou = !isAdmin || isPending
  const finJourLabel = OFFSET_LABELS[offset] === 'le jour même' ? '' : ` ${OFFSET_LABELS[offset]}`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Clock className="w-4 h-4 text-primary shrink-0" />
          <span className="flex-1">{creneau.libelle}</span>
          {creneau.estDefaut && (
            <Badge variant="outline" className="font-normal">Valeur par défaut</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${creneau.code}-debut`}>Prise de garde</Label>
            <Input
              id={`${creneau.code}-debut`}
              type="time"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
              disabled={verrou}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${creneau.code}-fin`}>Fin de garde</Label>
            <Input
              id={`${creneau.code}-fin`}
              type="time"
              value={fin}
              onChange={(e) => setFin(e.target.value)}
              disabled={verrou}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>La garde se termine…</Label>
          {isAdmin ? (
            <Select
              value={String(offset)}
              onValueChange={(v) => v && setOffset(Number(v))}
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                {OFFSET_LABELS[offset]}
              </SelectTrigger>
              <SelectContent>
                {OFFSET_OPTIONS.map((o) => (
                  <SelectItem key={o} value={String(o)}>{OFFSET_LABELS[o]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">{OFFSET_LABELS[offset]}</p>
          )}
        </div>

        <p className="text-xs text-muted-foreground leading-5">
          Garde prise à <span className="font-medium text-foreground">{debut}</span>,
          rendue à <span className="font-medium text-foreground">{fin}</span>{finJourLabel}.
        </p>
      </CardContent>

      {isAdmin && (
        <CardFooter className="justify-end gap-2">
          {!creneau.estDefaut && (
            <Button variant="ghost" size="sm" onClick={reinitialiser} disabled={isPending}>
              <RotateCcw className="w-3.5 h-3.5" />
              Réinitialiser au défaut
            </Button>
          )}
          <Button size="sm" onClick={enregistrer} disabled={isPending || !modifie}>
            {isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export function StructureCreneauxClient({
  creneaux, isAdmin,
}: {
  creneaux: CreneauUI[]
  isAdmin: boolean
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {creneaux.map((c) => (
        <CreneauCard
          // Clé sur les valeurs serveur : réinitialise l'état local après refresh.
          key={`${c.code}-${c.heureDebut}-${c.heureFin}-${c.offsetJoursFin}-${c.estDefaut}`}
          creneau={c}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  )
}
