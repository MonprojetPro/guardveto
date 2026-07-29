'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, AlertTriangle, ArrowLeftRight, Lock, Wrench, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { GardeDenormalisee } from '@/types'
import type { VetDispo, DisponibilitesData } from '@/app/api/gardes/[id]/disponibilites/route'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import { ViolationDialog } from './ViolationDialog'

// ── Types ────────────────────────────────────────────────

interface GardeDetailModalProps {
  garde: GardeDenormalisee | null
  date: string | null
  isAdmin: boolean
  /** Id du véto connecté — pour « proposer un échange » sur SES gardes. */
  moiVetId?: string
  /** Libellés du catalogue (code → nom) pour les types sur-mesure (P3b). */
  nomsTypes?: Record<string, string>
  onClose: () => void
  onSaved: () => void
  /**
   * Admin : déclarer le véto assigné comme absent (gestion de crise). Reçoit la
   * date de la garde et l'id du véto. Absent → bouton masqué.
   */
  onDeclarerAbsent?: (date: string, vetId: string) => void
}

// ── Helpers ──────────────────────────────────────────────

function formatDateLongue(dateISO: string): string {
  return new Date(dateISO + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function labelTypeGarde(type: string, nomsTypes?: Record<string, string>): string {
  if (type === 'weekend') return 'Week-end (sam → lun)'
  if (type === 'ferie') return 'Jour férié'
  if (type === 'semaine') return 'Garde de semaine (soir)'
  // Type SUR-MESURE (P3b) : nom du catalogue, sinon code humanisé.
  return libelleTypeGardeDb(type, nomsTypes)
}

/** Les trois états de disponibilité, dans l'ordre où la maquette les trie. */
type Tone = 'vert' | 'ambre' | 'rouge'
const ORDRE_TONE: Record<Tone, number> = { vert: 0, ambre: 1, rouge: 2 }

function toneDe(dispo: { ok: boolean; warning?: string }): Tone {
  if (!dispo.ok) return 'rouge'
  return dispo.warning ? 'ambre' : 'vert'
}

/** Retire le préfixe technique « R7 : » des messages de règle. */
function sansCodeRegle(texte?: string): string {
  return (texte ?? '').replace(/^R\d+ : /, '')
}

// ── Une place de garde : qui la tient, et de quoi en changer ──

function PlaceGarde({
  label,
  role,
  vets,
  selected,
  onSelect,
  modeEdition,
  ouvert,
  onToggle,
  typeGarde,
  partenaireId,
  onDeclarerAbsent,
}: {
  label: string
  role: 'premier' | 'second'
  vets: VetDispo[]
  selected: string | null
  onSelect: (id: string | null) => void
  modeEdition: boolean
  /** La liste des vétérinaires est-elle dépliée pour cette place ? */
  ouvert: boolean
  onToggle: () => void
  typeGarde: string
  /** Véto tenant l'AUTRE place ce jour-là — il n'est pas proposé ici. */
  partenaireId: string | null
  /** Admin, garde publiée : signaler l'absence de celui qui tient la place. */
  onDeclarerAbsent?: (vetId: string) => void
}) {
  const titulaire = vets.find((v) => v.id === selected) ?? null

  // Les disponibles d'abord : le bon choix saute aux yeux (maquette).
  const lignes = vets
    .filter((v) => v.id !== partenaireId)
    .map((v) => ({ v, tone: toneDe(role === 'premier' ? v.dispo_premier : v.dispo_second) }))
    .sort((a, b) => ORDRE_TONE[a.tone] - ORDRE_TONE[b.tone])

  return (
    <div className={`gm-section${modeEdition ? '' : ' disabled'}`}>
      <div className="gm-slot-row">
        <span className="gm-slot-label">{label}</span>

        {titulaire ? (
          <span className="gm-current">
            <span className="dot" style={{ background: titulaire.couleur }}>
              {titulaire.prenom.charAt(0)}
            </span>
            {titulaire.prenom} {titulaire.nom}
          </span>
        ) : (
          <span className="gm-current none">Aucun · à pourvoir</span>
        )}

        {onDeclarerAbsent && titulaire && (
          <button
            type="button"
            className="gm-absent-link"
            title={`Déclarer ${titulaire.prenom} absent·e`}
            onClick={() => onDeclarerAbsent(titulaire.id)}
          >
            <UserMinus className="w-3.5 h-3.5" />
            Absent·e
          </button>
        )}

        {modeEdition && (
          <button
            type="button"
            className="gm-reassign"
            aria-expanded={ouvert}
            onClick={onToggle}
          >
            {ouvert ? 'Fermer' : 'Réattribuer'}
          </button>
        )}
      </div>

      {modeEdition && ouvert && (
        <>
          <ul className="av-list">
            {lignes.map(({ v, tone }) => {
              const dispo = role === 'premier' ? v.dispo_premier : v.dispo_second
              const raison = sansCodeRegle(dispo.raison ?? dispo.warning)
              // L'impact compteur : ce que ce choix ferait au total. Seul le
              // décompte des week-ends nous est renvoyé — on ne l'affiche donc
              // que là, plutôt que d'inventer un chiffre pour les autres types.
              const impact =
                typeGarde === 'weekend' && tone !== 'rouge'
                  ? `${v.nb_gardes_we_mois} → ${v.nb_gardes_we_mois + 1} WE`
                  : ''
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    className={`av-row ${tone}`}
                    aria-current={selected === v.id ? 'true' : undefined}
                    onClick={() => onSelect(v.id)}
                  >
                    <span className="dot" style={{ background: v.couleur }} />
                    <span>{v.prenom} {v.nom}</span>
                    <span className={`av-state ${tone}`}>●</span>
                    <span className="av-reason">{raison || 'Disponible'}</span>
                    <span className="av-count">{impact}</span>
                  </button>
                </li>
              )
            })}
            <li>
              <button
                type="button"
                className="av-row"
                aria-current={selected === null ? 'true' : undefined}
                onClick={() => onSelect(null)}
              >
                <span className="dot none" />
                <span>Aucun</span>
                <span className="av-state">·</span>
                <span className="av-reason">Laisser la place à pourvoir</span>
                <span className="av-count" />
              </button>
            </li>
          </ul>

          <p className="av-legende">
            <span><i style={{ background: 'var(--ok)' }} /> Disponible</span>
            <span><i style={{ background: 'var(--warn)' }} /> Sous réserve</span>
            <span><i style={{ background: 'var(--danger)' }} /> Indisponible</span>
          </p>
        </>
      )}
    </div>
  )
}

// ── Modal principale ─────────────────────────────────────

export function GardeDetailModal({ garde, date, isAdmin, moiVetId, nomsTypes, onClose, onSaved, onDeclarerAbsent }: GardeDetailModalProps) {
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState<DisponibilitesData | null>(null)
  const [premierSel, setPremierSel] = useState<string | null>(null)
  const [secondSel, setSecondSel] = useState<string | null>(null)
  const [correctionMode, setCorrectionMode] = useState(false)
  const [showCorriger, setShowCorriger] = useState(false)
  // Une seule liste de vétérinaires dépliée à la fois : on ne change qu'une
  // place à la fois, et la modale reste courte (maquette).
  const [placeOuverte, setPlaceOuverte] = useState<'premier' | 'second' | null>(null)
  // Violation de règle à confirmer avant sauvegarde
  const [violation, setViolation] = useState<{
    type: 'dure' | 'souple'
    message: string
    vetPrenom: string
  } | null>(null)
  // Avertissements métier renvoyés par le SERVEUR (véto inactif / en congé
  // validé) — garde-fou au moment de l'écriture (backlog n°12). À confirmer.
  const [avertServeur, setAvertServeur] = useState<string[] | null>(null)

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
    setPlaceOuverte(null)
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

  async function performSave(confirmerAvertissements = false) {
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
          confirmerAvertissements,
        }),
      })
      const json = await res.json()
      // Garde-fou serveur (backlog n°12) : véto inactif / en congé validé →
      // 409 avec la liste des avertissements. On les affiche pour confirmation.
      if (res.status === 409 && json?.needsConfirmation) {
        setAvertServeur(Array.isArray(json.warnings) && json.warnings.length > 0
          ? json.warnings
          : [json.error ?? 'Affectation à confirmer.'])
        return
      }
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
    // Garde-fou immédiat : le même véto ne peut pas être 1er ET 2nd
    if (premierSel && secondSel && premierSel === secondSel) {
      toast.error('Le même vétérinaire ne peut pas être à la fois 1er et 2nd de garde.')
      return
    }
    const v = detecterViolation()
    if (v) {
      setViolation(v)
      return
    }
    await performSave()
  }

  // Effectif configurable : on masque le 2nd seulement si la nuit de semaine est
  // à 1 véto (repli saison été) ET qu'aucun 2nd n'a été généré. Si un 2nd existe
  // (période avec effectif semaine forcé à 2), on l'affiche même en été.
  // Type SUR-MESURE (P3b) : un créneau à 1 place n'a pas de 2nd → masqué aussi.
  const estTypeV1 = ['semaine', 'weekend', 'ferie'].includes(data?.garde.type ?? '')
  const masquerSecond =
    (data?.garde.saison === 'ete' && data?.garde.type === 'semaine' && !data?.garde.second_id)
    || (!estTypeV1 && !data?.garde.second_id)
  const estVerrouille = data?.garde.verrouille ?? false
  const modeEdition = isAdmin && (!estVerrouille || correctionMode)

  // Véto : « proposer un échange » sur SA garde (publiée, future, non verrouillée).
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const peutProposerEchange =
    !isAdmin &&
    Boolean(moiVetId) &&
    Boolean(garde) &&
    garde!.periode_statut === 'publie' &&
    garde!.date > aujourdHui &&
    !estVerrouille &&
    (garde!.premier_id === moiVetId || garde!.second_id === moiVetId)

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            {garde && (
              <p className="gm-kicker">{labelTypeGarde(garde.type, nomsTypes)}</p>
            )}
            <DialogTitle className="capitalize">
              {date && formatDateLongue(date)}
            </DialogTitle>
            {garde && (
              <div className="gm-badges">
                {garde.periode_statut === 'publie' && (
                  <span className="gm-badge publie">● Publiée</span>
                )}
                {garde.periode_statut === 'brouillon' && (
                  <span className="gm-badge brouillon">● Brouillon</span>
                )}
                {estVerrouille && <span className="gm-badge lock">🔒 Verrouillée</span>}
                {garde.modifie_manuellement && (
                  <span className="gm-badge warn">✎ Modifiée à la main</span>
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
            <>
              {/* ── Garde verrouillée : l'encart, et sa confirmation EN LIGNE.
                     La maquette confirme ici plutôt que dans une seconde
                     pop-up par-dessus la première — même garde-fou, une
                     fenêtre de moins à l'écran. ──────────────────────── */}
              {estVerrouille && isAdmin && !correctionMode && (
                <div className="lock-encart">
                  <b><Lock className="inline w-3.5 h-3.5 mb-0.5" /> Cette garde est verrouillée</b>{' '}
                  : elle est passée, ou les vétérinaires en ont déjà été notifiés. On ne la
                  modifie pas par accident.
                  {!showCorriger ? (
                    <div className="reform-actions">
                      <button type="button" className="btn btn-corriger" onClick={() => setShowCorriger(true)}>
                        <Wrench className="w-3.5 h-3.5 mr-1.5" />
                        Corriger cette garde
                      </button>
                    </div>
                  ) : (
                    <div className="lock-confirm">
                      Les vétérinaires concernés seront prévenus de la correction, et Google
                      Agenda resynchronisé. On continue ?
                      <div className="reform-actions">
                        <button
                          type="button"
                          className="btn btn-valider"
                          onClick={() => { setCorrectionMode(true); setShowCorriger(false) }}
                        >
                          Oui, corriger
                        </button>
                        <button type="button" className="btn btn-corriger" onClick={() => setShowCorriger(false)}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {estVerrouille && correctionMode && (
                <div className="lock-encart">
                  <b>🔓 Correction ouverte</b> · les vétérinaires seront prévenus à
                  l’enregistrement.
                </div>
              )}

              {/* ── Les places de garde ─────────────────────── */}
              <PlaceGarde
                label="1er de garde"
                role="premier"
                vets={data.vets}
                selected={premierSel}
                onSelect={(id) => { setPremierSel(id); setPlaceOuverte(null) }}
                modeEdition={modeEdition}
                ouvert={placeOuverte === 'premier'}
                onToggle={() => setPlaceOuverte((p) => (p === 'premier' ? null : 'premier'))}
                typeGarde={garde.type}
                partenaireId={masquerSecond ? null : secondSel}
                onDeclarerAbsent={
                  onDeclarerAbsent && garde.periode_statut === 'publie'
                    ? (vetId) => onDeclarerAbsent(garde.date, vetId)
                    : undefined
                }
              />

              {!masquerSecond && (
                <PlaceGarde
                  label="2nd de garde"
                  role="second"
                  vets={data.vets}
                  selected={secondSel}
                  onSelect={(id) => { setSecondSel(id); setPlaceOuverte(null) }}
                  modeEdition={modeEdition}
                  ouvert={placeOuverte === 'second'}
                  onToggle={() => setPlaceOuverte((p) => (p === 'second' ? null : 'second'))}
                  typeGarde={garde.type}
                  partenaireId={premierSel}
                  onDeclarerAbsent={
                    onDeclarerAbsent && garde.periode_statut === 'publie'
                      ? (vetId) => onDeclarerAbsent(garde.date, vetId)
                      : undefined
                  }
                />
              )}
            </>
          )}

          <DialogFooter>
            {peutProposerEchange && garde && (
              <Button
                variant="outline"
                className="sm:mr-auto"
                onClick={() => router.push(`/echanges?proposer=${garde.id}`)}
              >
                <ArrowLeftRight className="w-4 h-4 mr-2" />
                Proposer un échange
              </Button>
            )}
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

      {/* ── Avertissement métier serveur (véto inactif / en congé) ──
             La confirmation de garde verrouillée, elle, se fait désormais
             dans l'encart de la modale principale : plus de pop-up par-dessus
             la pop-up. ─────────────────────────────────────────────── */}
      <Dialog open={!!avertServeur} onOpenChange={(open) => { if (!open) setAvertServeur(null) }}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            <p className="gm-kicker">Garde · vérification</p>
            <DialogTitle>Affectation à confirmer</DialogTitle>
          </DialogHeader>
          <div className="gf-card souple">
            <p className="gf-title">
              <AlertTriangle className="w-3.5 h-3.5" />
              Ce que la vérification a relevé
            </p>
            {(avertServeur ?? []).map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Veux-tu enregistrer cette affectation malgré tout ?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAvertServeur(null)} disabled={saving}>
              Annuler
            </Button>
            <Button
              disabled={saving}
              onClick={async () => { setAvertServeur(null); await performSave(true) }}
            >
              Enregistrer quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
