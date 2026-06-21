'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, CalendarOff, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { CongeForm } from './CongeForm'
import { ValiderCongeDialog } from './ValiderCongeDialog'
import { ConflitPlanningDialog } from './ConflitPlanningDialog'
import { ConflitPublieBadge } from './ConflitPublieBadge'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import { deleteConge, refuserConge, type ConflitPlanning } from '@/app/(protected)/conges/actions'
import type { CreneauImpacte } from '@/lib/crise/contexte'
import type { Conge, StatutConge, TypeConge, Veterinaire } from '@/types'

const TYPE_LABELS: Record<TypeConge, string> = {
  vacances: 'Vacances', formation: 'Formation', sante: 'Santé',
  indisponibilite: 'Indisponibilité', autre: 'Autre',
}
const TYPE_COLORS: Record<TypeConge, string> = {
  vacances:        'bg-blue-100 text-blue-700 border-blue-200',
  formation:       'bg-purple-100 text-purple-700 border-purple-200',
  sante:           'bg-red-100 text-red-700 border-red-200',
  indisponibilite: 'bg-orange-100 text-orange-700 border-orange-200',
  autre:           'bg-gray-100 text-gray-600 border-gray-200',
}
const CRENEAU_LABELS: Record<string, string> = {
  journee: 'Journée', matin: 'Matin', 'apres-midi': 'Après-midi', soiree: 'Soirée',
}
const STATUT_CONFIG: Record<StatutConge, { label: string; className: string }> = {
  souhait: { label: 'Souhait',  className: 'bg-orange-100 text-orange-700 border-orange-200' },
  valide:  { label: 'Validé',   className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  refuse:  { label: 'Refusé',   className: 'bg-red-100 text-red-700 border-red-200' },
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function getNbJours(debut: string, fin: string) {
  return Math.round(
    (new Date(fin + 'T00:00:00').getTime() - new Date(debut + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1
}

/** Affiche la durée en jours si < 1 semaine, sinon en semaines (arrondi). */
function formatDuree(jours: number) {
  if (jours < 7) return `${jours} j`
  return `${Math.round(jours / 7)} sem.`
}

interface CongesListProps {
  conges: Conge[]
  vets: Veterinaire[]
  currentUserId: string
  isAdmin: boolean
  /**
   * Conflits planning publié pré-calculés côté serveur (LOT A5-lite) :
   * { congeId → créneaux publiés chevauchés }. Renseigné uniquement pour les
   * souhaits en attente côté admin ; les autres congés n'y figurent pas.
   */
  conflitsParConge?: Record<string, CreneauImpacte[]>
}

export function CongesList({ conges, vets, currentUserId, isAdmin, conflitsParConge }: CongesListProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [addDefaultVet, setAddDefaultVet] = useState<string | undefined>()
  const [editConge, setEditConge] = useState<Conge | null>(null)
  const [validerConge, setValiderConge] = useState<Conge | null>(null)
  const [isPending, startTransition] = useTransition()
  const [filtreVet, setFiltreVet] = useState('tous')
  const [filtreType, setFiltreType] = useState('tous')

  // ── Conflit congé ↔ planning publié (cas « Antoine », LOT A4) ──────────
  // `conflit` : alerte affichée après une validation/création qui percute une
  // garde publiée. `criseOuverte` : passage à la CriseModal pré-remplie quand
  // l'admin choisit « Gérer maintenant ».
  const [conflit, setConflit] = useState<ConflitPlanning | null>(null)
  const [criseOuverte, setCriseOuverte] = useState(false)

  // Vétos au format attendu par la CriseModal (réutilisation du flux existant).
  const vetsCrise: VetCrise[] = vets.map((v) => ({
    id: v.id, prenom: v.prenom, nom: v.nom, couleur: v.couleur,
  }))
  const vetConflit = conflit ? vets.find((v) => v.id === conflit.veterinaire_id) : null
  const vetConflitNom = vetConflit ? `${vetConflit.prenom} ${vetConflit.nom}` : 'ce vétérinaire'

  const congesVisibles = isAdmin ? conges : conges.filter((c) => c.veterinaire_id === currentUserId)
  const souhaitsEnAttente = isAdmin ? conges.filter((c) => c.statut === 'souhait') : []
  const autresConges = isAdmin
    ? congesVisibles.filter((c) => c.statut !== 'souhait')
    : congesVisibles

  const congesFiltres = autresConges
    .filter((c) => filtreVet === 'tous' || c.veterinaire_id === filtreVet)
    .filter((c) => filtreType === 'tous' || c.type === filtreType)

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteConge(id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Congé supprimé')
    })
  }

  const handleRefuser = (id: string) => {
    startTransition(async () => {
      const result = await refuserConge(id)
      if (result.error) { toast.error(result.error); return }
      toast.success('Congé refusé')
    })
  }

  const resumeParVet = isAdmin
    ? vets.filter((v) => v.actif).map((v) => {
        const cv = conges.filter((c) => c.veterinaire_id === v.id)
        const jours = cv.reduce((a, c) => a + getNbJours(c.date_debut, c.date_fin), 0)
        return { vet: v, nb: cv.length, jours }
      }).filter((r) => r.nb > 0)
    : []

  const canEdit = (c: Conge) => isAdmin || c.statut === 'souhait'
  // Vet peut supprimer ses propres congés (annulation) — admin peut tout supprimer
  const canDelete = (c: Conge) => isAdmin || c.veterinaire_id === currentUserId

  const CongeRow = ({ c, showVet = true, showActions = true }: { c: Conge; showVet?: boolean; showActions?: boolean }) => {
    const vet = vets.find((v) => v.id === c.veterinaire_id)
    const duree = formatDuree(getNbJours(c.date_debut, c.date_fin))
    const editable = canEdit(c)
    const statutCfg = STATUT_CONFIG[c.statut]
    const conflitCreneaux = conflitsParConge?.[c.id] ?? []

    return (
      <div className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card">
        {isAdmin && showVet ? (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: vet?.couleur ?? '#ccc' }}
          >
            {vet?.prenom.charAt(0) ?? '?'}
          </div>
        ) : !isAdmin ? (
          <div className={`w-2 self-stretch rounded-full shrink-0 ${c.statut === 'valide' ? 'bg-emerald-400' : c.statut === 'refuse' ? 'bg-red-400' : 'bg-orange-400'}`} />
        ) : null}

        <div className="flex-1 min-w-0">
          {isAdmin && showVet && (
            <p className="font-medium text-sm text-foreground">
              {vet ? `${vet.prenom} ${vet.nom}` : '—'}
            </p>
          )}
          <p className={`text-xs text-muted-foreground ${!isAdmin ? 'text-sm font-medium text-foreground' : ''}`}>
            {c.type === 'indisponibilite'
              ? formatDate(c.date_debut)
              : <>{formatDate(c.date_debut)} → {formatDate(c.date_fin)}<span className="mx-1.5 opacity-30">·</span>{duree}</>}
            {c.creneau && c.type === 'indisponibilite' && (
              <><span className="mx-1.5 opacity-30">·</span>{CRENEAU_LABELS[c.creneau] ?? c.creneau}</>
            )}
            {c.commentaire && <><span className="mx-1.5 opacity-30">·</span><span className="italic">{c.commentaire}</span></>}
          </p>
          {!isAdmin && c.statut === 'refuse' && c.raison_refus && (
            <p className="text-xs text-destructive mt-1 italic">Motif : {c.raison_refus}</p>
          )}
          {conflitCreneaux.length > 0 && (
            <div className="mt-1.5">
              <ConflitPublieBadge creneaux={conflitCreneaux} />
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={`text-xs ${TYPE_COLORS[c.type]}`}>{TYPE_LABELS[c.type]}</Badge>
          <Badge variant="outline" className={`text-xs ${statutCfg.className}`}>{statutCfg.label}</Badge>
        </div>

        {showActions && (
          <div className="flex gap-1 shrink-0">
            {isAdmin && c.statut === 'souhait' ? (
              <>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-50"
                  onClick={() => setValiderConge(c)}
                  title="Valider"
                >
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleRefuser(c.id)}
                  disabled={isPending}
                  title="Refuser"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => setEditConge(c)}
                  disabled={!editable}
                  title={editable ? 'Modifier' : 'Non modifiable'}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(c.id)}
                  disabled={isPending || !canDelete(c)}
                  title={canDelete(c) ? 'Supprimer / Annuler' : 'Non supprimable'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Congés</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {congesVisibles.length} congé{congesVisibles.length > 1 ? 's' : ''} enregistré{congesVisibles.length > 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => { setAddDefaultVet(isAdmin ? undefined : currentUserId); setAddOpen(true) }} className="gap-2">
          <Plus className="w-4 h-4" />
          {isAdmin ? 'Ajouter un congé' : 'Demander un congé'}
        </Button>
      </div>

      {/* Souhaits en attente (admin) */}
      {isAdmin && souhaitsEnAttente.length > 0 && (
        <div className="rounded-xl border-2 border-orange-200 bg-orange-50/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <p className="text-sm font-semibold text-orange-800">
              {souhaitsEnAttente.length} souhait{souhaitsEnAttente.length > 1 ? 's' : ''} en attente
            </p>
          </div>
          <div className="space-y-2">
            {souhaitsEnAttente.map((c) => <CongeRow key={c.id} c={c} />)}
          </div>
        </div>
      )}

      {/* Résumé par véto (admin) — cliquer filtre la liste sur ce véto */}
      {resumeParVet.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {resumeParVet.map(({ vet, nb, jours }) => {
            const actif = filtreVet === vet.id
            return (
              <button
                key={vet.id}
                onClick={() => setFiltreVet(actif ? 'tous' : vet.id)}
                aria-pressed={actif}
                title={actif ? 'Afficher tous les vétérinaires' : `Voir les congés de ${vet.prenom}`}
                className={`flex items-center gap-2.5 p-3 rounded-lg border transition-colors text-left ${
                  actif
                    ? 'border-primary ring-1 ring-primary/30 bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/40'
                }`}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: vet.couleur }}>
                  {vet.prenom.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{vet.prenom} {vet.nom}</p>
                  <p className="text-xs text-muted-foreground">{nb} congé{nb > 1 ? 's' : ''} · {formatDuree(jours)}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filtres (admin) */}
      {isAdmin && (
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={filtreVet} onValueChange={(v) => v && setFiltreVet(v)}>
            <SelectTrigger className="w-52">
              {filtreVet === 'tous' ? 'Tous les vétérinaires' : (() => { const v = vets.find((x) => x.id === filtreVet); return v ? `${v.prenom} ${v.nom}` : '' })()}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous les vétérinaires</SelectItem>
              {vets.filter((v) => v.actif).map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filtreType} onValueChange={(v) => v && setFiltreType(v)}>
            <SelectTrigger className="w-40">
              {filtreType === 'tous' ? 'Tous les types' : TYPE_LABELS[filtreType as TypeConge] ?? filtreType}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous les types</SelectItem>
              {(Object.entries(TYPE_LABELS) as [TypeConge, string][]).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(filtreVet !== 'tous' || filtreType !== 'tous') && (
            <Button variant="ghost" size="sm" onClick={() => { setFiltreVet('tous'); setFiltreType('tous') }} className="text-muted-foreground text-xs">
              Réinitialiser
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">{congesFiltres.length} résultat{congesFiltres.length > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Historique / liste principale */}
      <div className="space-y-2">
        {congesFiltres.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <CalendarOff className="w-10 h-10 opacity-30" />
            <p className="text-sm">Aucun congé trouvé.</p>
          </div>
        ) : (
          congesFiltres.map((c) => <CongeRow key={c.id} c={c} />)
        )}
      </div>

      {/* Dialogs */}
      <CongeForm
        open={addOpen}
        onClose={() => { setAddOpen(false); setAddDefaultVet(undefined) }}
        vets={vets} currentUserId={currentUserId} isAdmin={isAdmin}
        defaultVetId={addDefaultVet}
        onConflit={setConflit}
      />
      {editConge && (
        <CongeForm
          open={Boolean(editConge)}
          onClose={() => setEditConge(null)}
          vets={vets} currentUserId={currentUserId} isAdmin={isAdmin}
          conge={editConge}
        />
      )}
      {validerConge && (
        <ValiderCongeDialog
          open={Boolean(validerConge)}
          onClose={() => setValiderConge(null)}
          conge={validerConge}
          vet={vets.find((v) => v.id === validerConge.veterinaire_id)}
          currentVetoId={currentUserId}
          onConflit={setConflit}
        />
      )}

      {/* Alerte conflit congé ↔ planning publié (cas « Antoine ») */}
      {conflit && (
        <ConflitPlanningDialog
          open={!criseOuverte}
          onOpenChange={(o) => { if (!o) setConflit(null) }}
          vetNom={vetConflitNom}
          creneauxImpactes={conflit.creneauxImpactes}
          onGerer={() => setCriseOuverte(true)}
        />
      )}

      {/* Réparation du planning via le flux de crise EXISTANT, pré-rempli. */}
      {conflit && criseOuverte && (
        <CriseModal
          key={`crise-${conflit.veterinaire_id}-${conflit.date_debut}`}
          open={criseOuverte}
          onOpenChange={(o) => {
            setCriseOuverte(o)
            // Fermer la CriseModal clôt tout le parcours de conflit.
            if (!o) setConflit(null)
          }}
          vets={vetsCrise}
          vetDefautId={conflit.veterinaire_id}
          dateDebutDefaut={conflit.date_debut}
          dateFinDefaut={conflit.date_fin}
        />
      )}
    </>
  )
}
