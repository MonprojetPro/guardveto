'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, Lock, Wrench, CheckCircle2, XCircle, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { GardeDenormalisee } from '@/types'
import type { VetDispo, DisponibilitesData } from '@/app/api/gardes/[id]/disponibilites/route'

// ── Types ────────────────────────────────────────────────

interface GardeDetailModalProps {
  garde: GardeDenormalisee | null
  date: string | null
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}

// ── Helpers ──────────────────────────────────────────────

function formatDateLongue(dateISO: string): string {
  return new Date(dateISO + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function labelTypeGarde(type: string): string {
  if (type === 'weekend') return 'Week-end (sam → lun)'
  if (type === 'ferie') return 'Jour férié'
  return 'Garde de semaine (soir)'
}

function StatutBadge({ statut }: { statut: string }) {
  if (statut === 'publie') return <Badge className="bg-green-100 text-green-800 border-green-200">Publié</Badge>
  if (statut === 'verrouille') return <Badge variant="secondary">Verrouillé</Badge>
  return <Badge variant="outline">Brouillon</Badge>
}

// ── Rangée d'un vétérinaire ──────────────────────────────

function VetRow({
  vet,
  role,
  selected,
  onClick,
}: {
  vet: VetDispo
  role: 'premier' | 'second'
  selected: boolean
  onClick: () => void
}) {
  const dispo = role === 'premier' ? vet.dispo_premier : vet.dispo_second

  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left transition-colors',
        selected
          ? 'bg-primary/10 border border-primary ring-1 ring-primary/30'
          : 'border border-border hover:bg-muted/50',
        !dispo.ok ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Couleur + initiale */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ backgroundColor: vet.couleur }}
      >
        {vet.prenom.charAt(0)}
      </div>

      {/* Nom */}
      <span className="flex-1 font-medium text-foreground">
        {vet.prenom} {vet.nom}
        {vet.dernier_recours && (
          <span className="ml-1.5 text-[10px] text-amber-600 font-normal">(dernier recours)</span>
        )}
      </span>

      {/* Statut dispo */}
      <div className="shrink-0 flex items-center gap-1.5">
        {dispo.ok ? (
          dispo.warning ? (
            <>
              <Star className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs text-amber-600 hidden sm:inline">Dernier recours</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              {vet.nb_gardes_we_mois > 0 && (
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {vet.nb_gardes_we_mois} WE/mois
                </span>
              )}
            </>
          )
        ) : (
          <>
            <XCircle className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[120px]">
              {dispo.raison?.replace(/^R\d+ : /, '')}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

// ── Règles vérifiées ─────────────────────────────────────

function ReglesVerifiees({
  premierVet,
  secondVet,
}: {
  premierVet: VetDispo | null
  secondVet: VetDispo | null
}) {
  if (!premierVet && !secondVet) return null

  const items: { label: string; ok: boolean; warning?: string; raison?: string }[] = []

  if (premierVet) {
    const d = premierVet.dispo_premier
    items.push({
      label: `${premierVet.prenom} — 1er de garde`,
      ok: d.ok,
      warning: d.warning,
      raison: d.raison,
    })
  }

  if (secondVet) {
    const d = secondVet.dispo_second
    items.push({
      label: `${secondVet.prenom} — 2nd de garde`,
      ok: d.ok,
      warning: d.warning,
      raison: d.raison,
    })
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Règles vérifiées
      </p>
      {items.map((item, i) => (
        <div
          key={i}
          className={[
            'flex items-start gap-2 rounded-md px-3 py-2 text-xs',
            item.ok && !item.warning ? 'bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-400' : '',
            item.ok && item.warning ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-400' : '',
            !item.ok ? 'bg-destructive/10 text-destructive' : '',
          ].join(' ')}
        >
          {item.ok && !item.warning && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          {item.ok && item.warning && <Star className="w-3.5 h-3.5 shrink-0 mt-0.5 fill-amber-400" />}
          {!item.ok && <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <span>
            <strong>{item.label}</strong>
            {item.raison && ` — ${item.raison.replace(/^R\d+ : /, '')}`}
            {item.warning && ` — ${item.warning.replace(/^R\d+ : /, '')}`}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Modal principale ─────────────────────────────────────

export function GardeDetailModal({ garde, date, isAdmin, onClose, onSaved }: GardeDetailModalProps) {
  const router = useRouter()

  // État local
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<DisponibilitesData | null>(null)
  const [premierSel, setPremierSel] = useState<string | null>(null)
  const [secondSel, setSecondSel] = useState<string | null>(null)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [showCorriger, setShowCorriger] = useState(false)

  const isOpen = date !== null

  // Fetch disponibilités quand la modale s'ouvre
  useEffect(() => {
    if (!garde || !isOpen) return

    setLoading(true)
    setData(null)
    setCorrectionMode(false)
    setShowCorriger(false)
    setPremierSel(garde.premier_id)
    setSecondSel(garde.second_id)

    fetch(`/api/gardes/${garde.id}/disponibilites`)
      .then((r) => r.json())
      .then((d: DisponibilitesData) => {
        setData(d)
        setPremierSel(d.garde.premier_id)
        setSecondSel(d.garde.second_id)
      })
      .catch(() => toast.error('Impossible de charger les disponibilités.'))
      .finally(() => setLoading(false))
  }, [garde?.id, isOpen])

  // Fermeture
  function handleClose() {
    setData(null)
    onClose()
  }

  // Sauvegarde
  async function handleSave() {
    if (!garde) return
    setSaving(true)
    try {
      const res = await fetch(`/api/gardes/${garde.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          premier_id: premierSel,
          second_id: secondSel,
          force: correctionMode,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Erreur lors de la sauvegarde.')
        return
      }
      toast.success('Garde mise à jour.')
      onSaved()
      router.refresh()
      handleClose()
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setSaving(false)
    }
  }

  // Déterminer si la 2ème place est masquée (été + semaine)
  const masquerSecond = data?.garde.saison === 'ete' && data?.garde.type === 'semaine'
  const estVerrouille = data?.garde.verrouille ?? false
  const modeEdition = isAdmin && (!estVerrouille || correctionMode)

  // Vétérinaires sélectionnés
  const premierVet = data?.vets.find((v) => v.id === premierSel) ?? null
  const secondVet = data?.vets.find((v) => v.id === secondSel) ?? null

  return (
    <>
      {/* ── Modale principale ─────────────────────────────── */}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {date && formatDateLongue(date)}
            </DialogTitle>
            {garde && (
              <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                <span>{labelTypeGarde(garde.type)}</span>
                <span>·</span>
                <StatutBadge statut={garde.periode_statut} />
                {garde.modifie_manuellement && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Wrench className="w-3 h-3" />
                    Modifié manuellement
                  </span>
                )}
              </div>
            )}
          </DialogHeader>

          {/* Pas de garde ce jour */}
          {!garde && (
            <p className="text-sm text-muted-foreground py-4">
              Aucune garde planifiée ce jour.
            </p>
          )}

          {/* Chargement */}
          {garde && loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement des disponibilités…
            </div>
          )}

          {/* Contenu principal */}
          {garde && data && !loading && (
            <div className="space-y-5">
              {/* Alerte garde verrouillée */}
              {estVerrouille && isAdmin && !correctionMode && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                  <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                      Garde verrouillée
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
                      Cette garde est verrouillée et ne peut pas être modifiée sans action explicite.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100"
                    onClick={() => setShowCorriger(true)}
                  >
                    <Wrench className="w-3.5 h-3.5 mr-1.5" />
                    Corriger
                  </Button>
                </div>
              )}

              {/* Mode lecture seule — véto/secrétaire */}
              {!isAdmin && (
                <div className="space-y-3">
                  <VetInfo label="1er de garde" vetId={garde.premier_id} prenom={garde.premier_prenom} nom={garde.premier_nom} couleur={garde.premier_couleur} />
                  {!masquerSecond && (
                    <VetInfo label="2nd de garde" vetId={garde.second_id} prenom={garde.second_prenom} nom={garde.second_nom} couleur={garde.second_couleur} />
                  )}
                </div>
              )}

              {/* Mode édition admin */}
              {modeEdition && (
                <>
                  {/* 1er de garde */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">1er de garde</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      <VetRow
                        key="none-premier"
                        vet={{ id: '', prenom: 'Aucun', nom: '', couleur: '#ccc', dernier_recours: false, dispo_premier: { ok: true }, dispo_second: { ok: true }, nb_gardes_we_mois: 0 }}
                        role="premier"
                        selected={premierSel === null}
                        onClick={() => setPremierSel(null)}
                      />
                      {data.vets.map((v) => (
                        <VetRow
                          key={v.id}
                          vet={v}
                          role="premier"
                          selected={premierSel === v.id}
                          onClick={() => setPremierSel(v.id)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* 2nd de garde */}
                  {!masquerSecond && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">2nd de garde</p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        <VetRow
                          key="none-second"
                          vet={{ id: '', prenom: 'Aucun', nom: '', couleur: '#ccc', dernier_recours: false, dispo_premier: { ok: true }, dispo_second: { ok: true }, nb_gardes_we_mois: 0 }}
                          role="second"
                          selected={secondSel === null}
                          onClick={() => setSecondSel(null)}
                        />
                        {data.vets.map((v) => (
                          <VetRow
                            key={v.id}
                            vet={v}
                            role="second"
                            selected={secondSel === v.id}
                            onClick={() => setSecondSel(v.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Règles vérifiées */}
                  {(premierSel || secondSel) && (
                    <ReglesVerifiees premierVet={premierVet} secondVet={secondVet} />
                  )}
                </>
              )}

              {/* Lecture seule admin — garde non verrouillée mais pas en mode édition */}
              {isAdmin && estVerrouille && !correctionMode && (
                <div className="space-y-3">
                  <VetInfo label="1er de garde" vetId={garde.premier_id} prenom={garde.premier_prenom} nom={garde.premier_nom} couleur={garde.premier_couleur} />
                  {!masquerSecond && (
                    <VetInfo label="2nd de garde" vetId={garde.second_id} prenom={garde.second_prenom} nom={garde.second_nom} couleur={garde.second_couleur} />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              {modeEdition && garde ? 'Annuler' : 'Fermer'}
            </Button>
            {modeEdition && garde && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enregistrement…
                  </>
                ) : (
                  'Enregistrer'
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog de confirmation "Corriger" ─────────────── */}
      <Dialog open={showCorriger} onOpenChange={(open) => { if (!open) setShowCorriger(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Modifier une garde verrouillée
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cette garde est verrouillée. La modifier manuellement la déverrouillera et la marquera comme modifiée.
            Cette action est réversible.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCorriger(false)}>
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                setCorrectionMode(true)
                setShowCorriger(false)
              }}
            >
              <Wrench className="w-4 h-4 mr-2" />
              Corriger quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Info vét lecture seule ───────────────────────────────

function VetInfo({
  label,
  vetId,
  prenom,
  nom,
  couleur,
}: {
  label: string
  vetId: string | null
  prenom: string | null
  nom: string | null
  couleur: string | null
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-muted-foreground w-24 shrink-0">{label}</span>
      {vetId && prenom ? (
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: couleur ?? '#888' }}
          >
            {prenom.charAt(0)}
          </div>
          <span className="text-sm text-foreground">
            {prenom} {nom}
          </span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground italic">Non attribué</span>
      )}
    </div>
  )
}
