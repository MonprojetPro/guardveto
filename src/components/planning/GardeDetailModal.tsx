'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, Lock, Wrench } from 'lucide-react'
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
import { ViolationDialog } from './ViolationDialog'

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

// ── Avatar vétérinaire ───────────────────────────────────

function VetAvatar({ prenom, couleur, size = 'md' }: { prenom: string; couleur: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm'
    ? 'w-6 h-6 text-[10px]'
    : 'w-8 h-8 text-xs'
  return (
    <div
      className={`${cls} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
      style={{ backgroundColor: couleur }}
    >
      {prenom.charAt(0)}
    </div>
  )
}

// ── Résumé des gardes actuelles ──────────────────────────

function GardeActuelle({ label, prenom, nom, couleur }: {
  label: string
  prenom: string | null
  nom: string | null
  couleur: string | null
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-muted-foreground w-20 shrink-0">{label}</span>
      {prenom ? (
        <div className="flex items-center gap-2">
          <VetAvatar prenom={prenom} couleur={couleur ?? '#888'} />
          <span className="text-sm font-medium text-foreground">{prenom} {nom}</span>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground italic">Non attribué</span>
      )}
    </div>
  )
}

// ── Ligne de sélection vétérinaire ───────────────────────

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
  const isNone = vet.id === ''

  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left transition-all',
        selected
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-card border border-border hover:bg-muted/50',
      ].join(' ')}
    >
      {/* Avatar */}
      {isNone ? (
        <div className="w-7 h-7 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center shrink-0">
          <span className="text-[10px] text-muted-foreground">—</span>
        </div>
      ) : (
        <VetAvatar prenom={vet.prenom} couleur={selected ? '#ffffff44' : vet.couleur} size="sm" />
      )}

      {/* Nom + raison d'indispo */}
      <span className="flex-1 min-w-0">
        <span className={`block font-medium ${selected ? 'text-primary-foreground' : 'text-foreground'}`}>
          {isNone ? 'Aucun' : `${vet.prenom} ${vet.nom}`}
        </span>
        {!isNone && !selected && !dispo.ok && (
          <span className="block text-xs text-red-500 mt-0.5 leading-tight">
            {dispo.raison?.replace(/^R\d+ : /, '')}
          </span>
        )}
        {!isNone && !selected && dispo.warning && (
          <span className="block text-xs text-amber-600 mt-0.5 leading-tight">
            {dispo.warning.replace(/^R\d+ : /, '')}
          </span>
        )}
      </span>

      {/* Point de couleur dispo */}
      {!isNone && !selected && (
        <span className={[
          'shrink-0 w-2 h-2 rounded-full mt-1',
          dispo.ok && !dispo.warning ? 'bg-green-500' : '',
          dispo.ok && dispo.warning ? 'bg-amber-400' : '',
          !dispo.ok ? 'bg-red-400' : '',
        ].join(' ')} />
      )}
    </button>
  )
}

// ── Section sélecteur ────────────────────────────────────

function SectionSelecteur({
  label,
  vets,
  role,
  selected,
  onSelect,
}: {
  label: string
  vets: VetDispo[]
  role: 'premier' | 'second'
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const vetSelectionne = vets.find((v) => v.id === selected)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {vetSelectionne && (
          <span className="text-xs text-muted-foreground">
            {vetSelectionne.prenom} {vetSelectionne.nom} sélectionné·e
          </span>
        )}
      </div>
      <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
        {/* Ligne Aucun */}
        <VetRow
          vet={{ id: '', prenom: 'Aucun', nom: '', couleur: '#ccc', dernier_recours: false, dispo_premier: { ok: true }, dispo_second: { ok: true }, nb_gardes_we_mois: 0 }}
          role={role}
          selected={selected === null}
          onClick={() => onSelect(null)}
        />
        {vets.map((v) => (
          <VetRow
            key={v.id}
            vet={v}
            role={role}
            selected={selected === v.id}
            onClick={() => onSelect(v.id)}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Disponible
        </span>
        {' · '}
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Dernier recours
        </span>
        {' · '}
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Indisponible
        </span>
      </p>
    </div>
  )
}

// ── Modal principale ─────────────────────────────────────

export function GardeDetailModal({ garde, date, isAdmin, onClose, onSaved }: GardeDetailModalProps) {
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<DisponibilitesData | null>(null)
  const [premierSel, setPremierSel] = useState<string | null>(null)
  const [secondSel, setSecondSel] = useState<string | null>(null)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [showCorriger, setShowCorriger] = useState(false)
  // Violation de règle à confirmer avant sauvegarde
  const [violation, setViolation] = useState<{
    type: 'dure' | 'souple'
    message: string
    vetPrenom: string
  } | null>(null)

  const isOpen = date !== null

  useEffect(() => {
    if (!garde || !isOpen) return
    // Réinitialisation volontaire de l'état à chaque ouverture de la modale,
    // juste avant de recharger les disponibilités de la garde sélectionnée.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    setData(null)
    setCorrectionMode(false)
    setShowCorriger(false)
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(`/api/gardes/${garde.id}/disponibilites`)
      .then((r) => r.json())
      .then((d: DisponibilitesData) => {
        setData(d)
        setPremierSel(d.garde.premier_id)
        setSecondSel(d.garde.second_id)
      })
      .catch(() => toast.error('Impossible de charger les disponibilités.'))
      .finally(() => setLoading(false))
    // On ne dépend que de l'id de la garde (pas de l'objet entier) pour éviter
    // un rechargement à chaque changement de référence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garde?.id, isOpen])

  function handleClose() {
    setData(null)
    onClose()
  }

  /** Vérifie si un vet sélectionné viole une règle (comparé à l'attribution originale) */
  function detecterViolation(): { type: 'dure' | 'souple'; message: string; vetPrenom: string } | null {
    if (!data) return null

    // Vérification premier de garde
    if (premierSel && premierSel !== data.garde.premier_id) {
      const vet = data.vets.find((v) => v.id === premierSel)
      if (vet) {
        if (!vet.dispo_premier.ok && vet.dispo_premier.raison) {
          return {
            type: 'dure',
            message: vet.dispo_premier.raison.replace(/^R\d+ : /, ''),
            vetPrenom: vet.prenom,
          }
        }
        if (vet.dispo_premier.warning) {
          return {
            type: 'souple',
            message: vet.dispo_premier.warning.replace(/^R\d+ : /, ''),
            vetPrenom: vet.prenom,
          }
        }
      }
    }

    // Vérification second de garde (si visible)
    if (!masquerSecond && secondSel && secondSel !== data.garde.second_id) {
      const vet = data.vets.find((v) => v.id === secondSel)
      if (vet) {
        if (!vet.dispo_second.ok && vet.dispo_second.raison) {
          return {
            type: 'dure',
            message: vet.dispo_second.raison.replace(/^R\d+ : /, ''),
            vetPrenom: vet.prenom,
          }
        }
        if (vet.dispo_second.warning) {
          return {
            type: 'souple',
            message: vet.dispo_second.warning.replace(/^R\d+ : /, ''),
            vetPrenom: vet.prenom,
          }
        }
      }
    }

    return null
  }

  async function performSave() {
    if (!garde) return
    setSaving(true)
    try {
      const res = await fetch(`/api/gardes/${garde.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ premier_id: premierSel, second_id: secondSel, force: correctionMode }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Erreur lors de la sauvegarde.'); return }
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

  async function handleSave() {
    const v = detecterViolation()
    if (v) {
      setViolation(v)
      return
    }
    await performSave()
  }

  const masquerSecond = data?.garde.saison === 'ete' && data?.garde.type === 'semaine'
  const estVerrouille = data?.garde.verrouille ?? false
  const modeEdition = isAdmin && (!estVerrouille || correctionMode)

  return (
    <>
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

          {!garde && <p className="text-sm text-muted-foreground py-4">Aucune garde planifiée ce jour.</p>}

          {garde && loading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Chargement…
            </div>
          )}

          {garde && data && !loading && (
            <div className="space-y-5">

              {/* ── Garde actuelle (toujours visible) ──────── */}
              <div className="rounded-lg bg-muted/40 p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Garde actuelle</p>
                <GardeActuelle
                  label="1er de garde"
                  prenom={garde.premier_prenom}
                  nom={garde.premier_nom}
                  couleur={garde.premier_couleur}
                />
                {!masquerSecond && (
                  <GardeActuelle
                    label="2nd de garde"
                    prenom={garde.second_prenom}
                    nom={garde.second_nom}
                    couleur={garde.second_couleur}
                  />
                )}
              </div>

              {/* ── Garde verrouillée ───────────────────────── */}
              {estVerrouille && isAdmin && !correctionMode && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                  <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Garde verrouillée</p>
                    <p className="text-xs text-amber-700 mt-0.5">Impossible de modifier sans déverrouiller.</p>
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

              {/* ── Sélecteurs admin ────────────────────────── */}
              {modeEdition && (
                <>
                  <div className="border-t pt-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                      Modifier la garde
                    </p>
                    <div className="space-y-5">
                      <SectionSelecteur
                        label="1er de garde"
                        vets={data.vets}
                        role="premier"
                        selected={premierSel}
                        onSelect={setPremierSel}
                      />
                      {!masquerSecond && (
                        <SectionSelecteur
                          label="2nd de garde"
                          vets={data.vets}
                          role="second"
                          selected={secondSel}
                          onSelect={setSecondSel}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              {modeEdition && garde ? 'Annuler' : 'Fermer'}
            </Button>
            {modeEdition && garde && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enregistrement…</> : 'Enregistrer'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Violation de règle ──────────────────────────── */}
      {violation && (
        <ViolationDialog
          open={!!violation}
          type={violation.type}
          message={violation.message}
          vetPrenom={violation.vetPrenom}
          onAccept={async () => {
            setViolation(null)
            await performSave()
          }}
          onAnnuler={() => setViolation(null)}
        />
      )}

      {/* ── Confirmation "Corriger" ──────────────────────── */}
      <Dialog open={showCorriger} onOpenChange={(open) => { if (!open) setShowCorriger(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Modifier une garde verrouillée
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cette garde est verrouillée. La modifier la déverrouillera et la marquera comme modifiée manuellement.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCorriger(false)}>Annuler</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => { setCorrectionMode(true); setShowCorriger(false) }}
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
