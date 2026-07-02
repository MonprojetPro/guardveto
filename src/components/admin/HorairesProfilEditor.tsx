'use client'

// ============================================================
// GUARDVETO — Réglage des horaires PAR PROFIL (P5 slice 4b)
// ============================================================
// L'admin choisit un profil, puis règle les horaires de chacun de ses types de
// garde (prise, fin, jour de fin en clair). Contrairement à l'ancien éditeur
// (cabinet-large, table creneaux_cabinet), les horaires sont désormais propres
// au PROFIL (table creneau_modele) — c'est ce que la génération ET l'agenda
// lisent réellement. Un profil « Été » peut donc démarrer à 19h et « Hiver » à
// 18h30. Véto = lecture seule. Effet à la prochaine génération / synchro agenda.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import {
  Card, CardHeader, CardTitle, CardContent, CardFooter,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { setHorairesProfilCreneau } from '@/app/(protected)/admin/structure/actions'

export interface HoraireCreneauUI {
  id: string        // creneau_modele.id
  code: string
  libelle: string
  heureDebut: string // 'HH:MM'
  heureFin: string   // 'HH:MM'
  offsetJoursFin: number // 0..3
}

export interface ProfilHorairesUI {
  id: string
  nom: string
  est_defaut: boolean
  creneaux: HoraireCreneauUI[]
}

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

function CreneauCard({ creneau, isAdmin }: { creneau: HoraireCreneauUI; isAdmin: boolean }) {
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
    if (!HEURE_RE.test(debut) || !HEURE_RE.test(fin)) {
      toast.error('Renseigne des heures valides (format HH:MM).')
      return
    }
    if (offset === 0 && enMinutes(fin) <= enMinutes(debut)) {
      toast.error("L'heure de fin doit être après le début, ou la garde doit finir un jour suivant.")
      return
    }
    startTransition(async () => {
      const res = await setHorairesProfilCreneau(creneau.id, {
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

  const verrou = !isAdmin || isPending
  const finJourLabel = offset === 0 ? '' : ` ${OFFSET_LABELS[offset]}`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Clock className="w-4 h-4 text-primary shrink-0" />
          <span className="flex-1">{creneau.libelle}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${creneau.id}-debut`}>Prise de garde</Label>
            <Input
              id={`${creneau.id}-debut`}
              type="time"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
              disabled={verrou}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${creneau.id}-fin`}>Fin de garde</Label>
            <Input
              id={`${creneau.id}-fin`}
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
        <CardFooter className="justify-end">
          <Button size="sm" onClick={enregistrer} disabled={isPending || !modifie}>
            {isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export function HorairesProfilEditor({
  profils, isAdmin,
}: {
  profils: ProfilHorairesUI[]
  isAdmin: boolean
}) {
  // Profil affiché : le défaut d'abord, sinon le premier.
  const initial = profils.find((p) => p.est_defaut)?.id ?? profils[0]?.id ?? ''
  const [profilId, setProfilId] = useState(initial)
  const profil = profils.find((p) => p.id === profilId) ?? profils[0]

  if (!profil) {
    return <p className="text-sm text-muted-foreground">Aucun profil à configurer.</p>
  }

  return (
    <div className="space-y-4">
      {profils.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Profil :</span>
          <Select value={profilId} onValueChange={(v) => v && setProfilId(v)}>
            {/* min-w plutôt que largeur fixe : le nom de profil ne doit pas être tronqué. */}
            <SelectTrigger className="h-9 min-w-[220px] max-w-full text-sm">
              {profil.nom}{profil.est_defaut ? ' (par défaut)' : ''}
            </SelectTrigger>
            <SelectContent>
              {profils.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nom}{p.est_defaut ? ' (par défaut)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {profil.creneaux.map((c) => (
          <CreneauCard
            // Clé sur les valeurs serveur : réinitialise l'état local après refresh
            // ou changement de profil.
            key={`${c.id}-${c.heureDebut}-${c.heureFin}-${c.offsetJoursFin}`}
            creneau={c}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </div>
  )
}
