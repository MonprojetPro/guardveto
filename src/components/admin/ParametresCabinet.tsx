'use client'

// ============================================================
// GUARDVETO — Paramètres du cabinet (#10 b/c/d)
// ============================================================
// Dé-câblage des partages « en dur » : agenda Google, expéditeur Brevo et
// adresse (→ zone scolaire dérivée automatiquement) réglés PAR CABINET.
//
// Tous les champs sont OPTIONNELS : laissés vides, l'application retombe sur la
// configuration globale (variables d'environnement) — c'est le cas du cabinet
// pilote, dont le comportement reste strictement inchangé. Admin seul.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  configurerPartagesCabinet, configurerAdresseCabinet,
} from '@/app/(protected)/admin/structure/actions'

export interface ParametresCabinetUI {
  googleCalendarId: string
  brevoFromEmail: string
  brevoFromName: string
  adresse: string
  codePostal: string
  ville: string
  zoneScolaire: string
  regionFeries: string
}

const ZONE_LABEL: Record<string, string> = { A: 'Zone A', B: 'Zone B', C: 'Zone C' }
const REGION_LABEL: Record<string, string> = {
  metropole: 'Métropole',
  'alsace-moselle': 'Alsace-Moselle',
  guadeloupe: 'Guadeloupe', martinique: 'Martinique', guyane: 'Guyane',
  reunion: 'La Réunion', mayotte: 'Mayotte', polynesie: 'Polynésie',
}

export function ParametresCabinet({
  valeurs,
  isAdmin,
}: {
  valeurs: ParametresCabinetUI
  isAdmin: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Partages agenda / email
  const [calendarId, setCalendarId] = useState(valeurs.googleCalendarId)
  const [fromEmail, setFromEmail] = useState(valeurs.brevoFromEmail)
  const [fromName, setFromName] = useState(valeurs.brevoFromName)

  // Adresse → zone
  const [adresse, setAdresse] = useState(valeurs.adresse)
  const [codePostal, setCodePostal] = useState(valeurs.codePostal)
  const [ville, setVille] = useState(valeurs.ville)

  const zoneActuelle = valeurs.zoneScolaire
    ? `${ZONE_LABEL[valeurs.zoneScolaire] ?? valeurs.zoneScolaire} · ${REGION_LABEL[valeurs.regionFeries] ?? valeurs.regionFeries}`
    : '—'

  const enregistrerPartages = () => {
    startTransition(async () => {
      const res = await configurerPartagesCabinet({
        googleCalendarId: calendarId,
        brevoFromEmail: fromEmail,
        brevoFromName: fromName,
      })
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Partages enregistrés.')
        router.refresh()
      }
    })
  }

  const enregistrerAdresse = () => {
    startTransition(async () => {
      const res = await configurerAdresseCabinet({ adresse, codePostal, ville })
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      const derive = res && 'derive' in res ? res.derive : null
      if (derive?.zone) {
        toast.success(
          `Adresse enregistrée. Zone déduite : ${ZONE_LABEL[derive.zone] ?? derive.zone}`
          + ` · ${REGION_LABEL[derive.region] ?? derive.region}.`,
        )
      } else {
        toast.success(
          'Adresse enregistrée. Zone scolaire non déterminée automatiquement '
          + '(Corse, outre-mer ou code postal incomplet) — la zone actuelle est conservée.',
        )
      }
      router.refresh()
    })
  }

  if (!isAdmin) {
    // Lecture seule pour les vétos : on montre l'essentiel sans champ éditable.
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <p>Zone scolaire du cabinet : <span className="font-medium text-foreground">{zoneActuelle}</span>.</p>
        <p className="mt-1">(Lecture seule — seul l’administrateur peut modifier les paramètres du cabinet.)</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* #10b + #10c — Agenda Google + expéditeur des emails */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div>
          <h3 className="font-medium text-foreground">Agenda Google &amp; emails</h3>
          <p className="text-muted-foreground text-sm mt-1 leading-5">
            Ces réglages sont propres à votre cabinet. Laissez un champ vide pour
            utiliser la configuration par défaut de GuardVeto.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-calendar">Identifiant de l’agenda Google</Label>
            <Input
              id="pc-calendar"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              placeholder="exemple@group.calendar.google.com"
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Où les gardes publiées sont synchronisées. Vide = agenda par défaut.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pc-from-email">Email expéditeur (Brevo)</Label>
            <Input
              id="pc-from-email"
              type="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="cabinet@exemple.fr"
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pc-from-name">Nom expéditeur</Label>
            <Input
              id="pc-from-name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Cabinet vétérinaire…"
              disabled={isPending}
            />
          </div>
        </div>

        <Button onClick={enregistrerPartages} disabled={isPending}>
          Enregistrer
        </Button>
      </div>

      {/* #10d — Adresse → zone scolaire dérivée */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div>
          <h3 className="font-medium text-foreground">Adresse du cabinet</h3>
          <p className="text-muted-foreground text-sm mt-1 leading-5">
            À partir du code postal, GuardVeto déduit automatiquement votre
            <span className="font-medium"> zone de vacances scolaires</span> et votre
            <span className="font-medium"> région de jours fériés</span>, utilisées par
            le moteur de planning. Zone actuelle : <span className="font-medium text-foreground">{zoneActuelle}</span>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-6">
          <div className="space-y-1.5 sm:col-span-6">
            <Label htmlFor="pc-adresse">Adresse</Label>
            <Input
              id="pc-adresse"
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              placeholder="12 rue des Vétérinaires"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pc-cp">Code postal</Label>
            <Input
              id="pc-cp"
              value={codePostal}
              onChange={(e) => setCodePostal(e.target.value)}
              placeholder="03300"
              inputMode="numeric"
              maxLength={5}
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-4">
            <Label htmlFor="pc-ville">Ville</Label>
            <Input
              id="pc-ville"
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              placeholder="Cusset"
              disabled={isPending}
            />
          </div>
        </div>

        <Button onClick={enregistrerAdresse} disabled={isPending}>
          Enregistrer &amp; déduire la zone
        </Button>
      </div>
    </div>
  )
}
