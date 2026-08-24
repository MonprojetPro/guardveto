'use client'

import { useState, useTransition } from 'react'
import { Check, X, Inbox, CalendarOff, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ValiderCongeDialog } from '@/components/conges/ValiderCongeDialog'
import { RefuserCongeDialog } from '@/components/conges/RefuserCongeDialog'
import { ConflitPublieBadge } from '@/components/conges/ConflitPublieBadge'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { Conge, Veterinaire } from '@/types'
import { stylePastille } from '@/lib/couleurs'

const TYPE_LABELS: Record<string, string> = {
  vacances: 'Vacances', formation: 'Formation', sante: 'Santé',
  indisponibilite: 'Indisponibilité', autre: 'Autre',
}
const TYPE_COLORS: Record<string, string> = {
  vacances:        'bg-blue-100 text-blue-700',
  formation:       'bg-purple-100 text-purple-700',
  sante:           'bg-red-100 text-red-700',
  indisponibilite: 'bg-orange-100 text-orange-700',
  autre:           'bg-gray-100 text-gray-600',
}
const CRENEAU_LABELS: Record<string, string> = {
  journee: 'Journée', matin: 'Matin', 'apres-midi': 'Après-midi', soiree: 'Soirée',
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

function getNbSemaines(debut: string, fin: string) {
  const diff = Math.round(
    (new Date(fin + 'T00:00:00').getTime() - new Date(debut + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1
  return Math.ceil(diff / 7)
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
      <Inbox className="w-8 h-8 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

interface DemandesClientProps {
  demandes: Conge[]
  vets: Veterinaire[]
  currentVetoId: string
  /**
   * Conflits planning publié pré-calculés côté serveur (LOT A5-lite) :
   * { congeId → créneaux publiés chevauchés }. Une demande absente de la map
   * (ou avec un tableau vide) = aucun conflit → pas de badge.
   */
  conflitsParConge?: Record<string, CreneauImpacte[]>
}

export function DemandesClient({ demandes, vets, currentVetoId, conflitsParConge }: DemandesClientProps) {
  const [validerConge, setValiderConge] = useState<Conge | null>(null)
  const [refuserCongeItem, setRefuserCongeItem] = useState<Conge | null>(null)
  const [isPending, startTransition] = useTransition()

  const conges = demandes.filter((d) => d.type !== 'indisponibilite')
  const indispos = demandes.filter((d) => d.type === 'indisponibilite')

  const DemandeRow = ({ d }: { d: Conge }) => {
    const vet = vets.find((v) => v.id === d.veterinaire_id)
    const isIndispo = d.type === 'indisponibilite'
    const sem = isIndispo ? null : getNbSemaines(d.date_debut, d.date_fin)
    const conflitCreneaux = conflitsParConge?.[d.id] ?? []

    return (
      <div className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={stylePastille(vet?.couleur)}
        >
          {vet?.prenom.charAt(0) ?? '?'}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">
            {vet ? `${vet.prenom} ${vet.nom}` : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isIndispo ? (
              <>
                {formatDate(d.date_debut)}
                {d.creneau && <> · <span className="font-medium text-foreground">{CRENEAU_LABELS[d.creneau]}</span></>}
              </>
            ) : (
              <>{formatDate(d.date_debut)} → {formatDate(d.date_fin)} · {sem} sem.</>
            )}
            {d.commentaire && <> · <span className="italic">{d.commentaire}</span></>}
          </p>
          {conflitCreneaux.length > 0 && (
            <div className="mt-1.5">
              <ConflitPublieBadge creneaux={conflitCreneaux} />
            </div>
          )}
        </div>

        <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${TYPE_COLORS[d.type] ?? ''}`}>
          {TYPE_LABELS[d.type] ?? d.type}
        </span>

        <div className="flex gap-1 shrink-0">
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-50"
            onClick={() => setValiderConge(d)}
            title="Valider"
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setRefuserCongeItem(d)}
            disabled={isPending}
            title="Refuser"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-8">
        {/* En-tête */}
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Demandes en attente</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {demandes.length === 0
              ? 'Aucune demande en attente'
              : `${demandes.length} demande${demandes.length > 1 ? 's' : ''} à traiter`}
          </p>
        </div>

        {/* Congés */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarOff className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm text-foreground">
              Congés
              {conges.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {conges.length}
                </span>
              )}
            </h2>
          </div>
          {conges.length === 0
            ? <EmptyState message="Aucun congé en attente" />
            : <div className="space-y-2">{conges.map((d) => <DemandeRow key={d.id} d={d} />)}</div>}
        </section>

        {/* Indisponibilités ponctuelles */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm text-foreground">
              Indisponibilités ponctuelles
              {indispos.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white text-[10px] font-bold">
                  {indispos.length}
                </span>
              )}
            </h2>
          </div>
          {indispos.length === 0
            ? <EmptyState message="Aucune indisponibilité en attente" />
            : <div className="space-y-2">{indispos.map((d) => <DemandeRow key={d.id} d={d} />)}</div>}
        </section>
      </div>

      {validerConge && (
        <ValiderCongeDialog
          open={Boolean(validerConge)}
          onClose={() => setValiderConge(null)}
          conge={validerConge}
          vet={vets.find((v) => v.id === validerConge.veterinaire_id)}
          currentVetoId={currentVetoId}
        />
      )}
      {refuserCongeItem && (
        <RefuserCongeDialog
          open={Boolean(refuserCongeItem)}
          onClose={() => setRefuserCongeItem(null)}
          conge={refuserCongeItem}
          vet={vets.find((v) => v.id === refuserCongeItem.veterinaire_id)}
        />
      )}
    </>
  )
}
