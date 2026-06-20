'use client'

// ============================================================
// GUARDVETO — Formulaire guidé de règle (P1A-007)
// ============================================================
// Création / édition d'une règle de cabinet, en langage naturel.
// Étapes : QUI (véto) → QUOI (type de règle) → ses paramètres →
// FORCE → APERÇU live. Écrit via upsertRegle (params_json bâti côté
// serveur, frontière de confiance).
//
// ⚠️ NE PROPOSE QUE LES 4 BRIQUES ÉVALUABLES par le moteur (interdire_creneau,
//    repos_conditionnel, alternance_ancre, duo_interdit). Proposer une brique
//    sans évaluateur créerait une règle silencieusement ignorée (coquille vide).
//
// L'aperçu réutilise EXACTEMENT le rendu de la liste (catalogue P1A-005) :
// ce que l'admin lit en construisant = ce qui s'affichera ensuite.
// ============================================================

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { rendreRegle } from '@/engine/briques/catalogue'
import { upsertRegle, type BriqueEvaluable, type ForceFormulaire } from '@/app/(protected)/regles/actions'
import type { RegleRow, VetoMini } from './ReglesClient'

// ── Référentiels d'affichage ─────────────────────────────────

const JOURS = [
  { value: 'lundi', label: 'Lundi' },
  { value: 'mardi', label: 'Mardi' },
  { value: 'mercredi', label: 'Mercredi' },
  { value: 'jeudi', label: 'Jeudi' },
  { value: 'vendredi', label: 'Vendredi' },
]

const BRIQUES: { value: BriqueEvaluable; label: string; aide: string }[] = [
  { value: 'interdire_creneau', label: 'Repos fixe un jour', aide: 'Ne fait jamais de garde un jour précis de la semaine.' },
  { value: 'repos_conditionnel', label: 'Repos selon la garde du week-end', aide: 'Jour de repos différent selon que le véto est de garde le week-end ou non.' },
  { value: 'alternance_ancre', label: 'Indisponible une semaine sur deux', aide: 'Indisponible certains créneaux les semaines paires ou impaires.' },
  { value: 'duo_interdit', label: 'Jamais en duo avec…', aide: 'Deux vétos ne peuvent pas être de garde seuls ensemble (réglé dans les deux sens).' },
]

const FORCES: { value: ForceFormulaire; label: string; symbole: string }[] = [
  { value: 'jamais', label: 'Interdiction ferme', symbole: '🔴' },
  { value: 'sauf_crise', label: 'À éviter sauf crise', symbole: '🟠' },
  { value: 'evitee', label: 'Préférence (évitée)', symbole: '🟡' },
  { value: 'si_possible', label: 'Préférence (si possible)', symbole: '🟡' },
]

const PERIODES = [
  { value: 'soir_semaine', label: 'Soirs de semaine' },
  { value: 'weekend', label: 'Week-ends' },
]

/** Force par défaut « naturelle » de chaque brique (alignée sur le pilote). */
const FORCE_DEFAUT: Record<BriqueEvaluable, ForceFormulaire> = {
  duo_interdit: 'jamais',
  alternance_ancre: 'sauf_crise',
  repos_conditionnel: 'sauf_crise',
  interdire_creneau: 'evitee',
}

// ── Composant ────────────────────────────────────────────────

interface RegleFormDialogProps {
  open: boolean
  onClose: () => void
  vets: VetoMini[]
  regle?: RegleRow | null
}

export function RegleFormDialog({ open, onClose, vets, regle }: RegleFormDialogProps) {
  const router = useRouter()
  const isEdit = Boolean(regle)
  const [isPending, startTransition] = useTransition()

  const pj = (regle?.params_json ?? {}) as {
    qui?: { refs?: unknown }
    params?: Record<string, unknown>
  }
  const refs = pj.qui?.refs
  const ownerInit = Array.isArray(refs) && typeof refs[0] === 'string' ? refs[0] : (vets[0]?.id ?? '')
  const p = pj.params ?? {}

  const [briqueId, setBriqueId] = useState<BriqueEvaluable>(
    (regle?.brique_id as BriqueEvaluable) ?? 'interdire_creneau',
  )
  const [ownerId, setOwnerId] = useState(ownerInit)
  const [force, setForce] = useState<ForceFormulaire>(
    (regle?.force as ForceFormulaire) ?? FORCE_DEFAUT.interdire_creneau,
  )

  // interdire_creneau
  const [jour, setJour] = useState(typeof p.jour === 'string' ? p.jour : 'mercredi')
  const [exVac, setExVac] = useState(Boolean(p.exception_vacances_scolaires))

  // repos_conditionnel
  const [siWe, setSiWe] = useState(typeof p.si_garde_we === 'string' ? p.si_garde_we : 'jeudi')
  const [sinon, setSinon] = useState(typeof p.sinon === 'string' ? p.sinon : 'vendredi')

  // alternance_ancre
  const [semaines, setSemaines] = useState<string>(typeof p.semaines === 'string' ? p.semaines : 'impaires')
  const [periodes, setPeriodes] = useState<string[]>(
    Array.isArray(p.periodes) ? (p.periodes as string[]).filter((x) => x === 'soir_semaine' || x === 'weekend') : ['weekend'],
  )

  // duo_interdit
  const autresVets = vets.filter((v) => v.id !== ownerId)
  const [avecId, setAvecId] = useState(
    typeof p.avec_veterinaire_id === 'string' ? p.avec_veterinaire_id : (autresVets[0]?.id ?? ''),
  )

  const nomVeto = (id: string) => vets.find((v) => v.id === id)?.prenom ?? id

  const choisirBrique = (b: BriqueEvaluable) => {
    setBriqueId(b)
    setForce(FORCE_DEFAUT[b])
  }

  const togglePeriode = (p: string) =>
    setPeriodes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  // ── Aperçu live (mêmes params que ceux écrits côté serveur) ──
  const apercu = useMemo(() => {
    const sujet = ownerId ? nomVeto(ownerId) : ''
    let params: Record<string, unknown> = {}
    switch (briqueId) {
      case 'interdire_creneau':
        params = { jour, exception_vacances_scolaires: exVac }
        break
      case 'repos_conditionnel':
        params = { si_garde_we: siWe, sinon }
        break
      case 'alternance_ancre':
        params = { semaines, periodes }
        break
      case 'duo_interdit':
        params = { avec_veterinaire_id: avecId }
        break
    }
    const predicat = rendreRegle(briqueId, params, { nomVeto })
    return sujet ? `${sujet} ${predicat}` : predicat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briqueId, ownerId, jour, exVac, siWe, sinon, semaines, periodes, avecId, vets])

  const handleSubmit = () => {
    if (!ownerId) { toast.error('Sélectionnez le vétérinaire concerné.'); return }
    if (briqueId === 'alternance_ancre' && periodes.length === 0) {
      toast.error('Sélectionnez au moins une période.'); return
    }
    if (briqueId === 'duo_interdit') {
      if (!avecId) { toast.error('Sélectionnez le second vétérinaire.'); return }
      if (avecId === ownerId) { toast.error('Choisissez deux vétérinaires différents.'); return }
    }

    startTransition(async () => {
      const res = await upsertRegle({
        id: regle?.id,
        brique_id: briqueId,
        owner_id: ownerId,
        force,
        jour,
        exception_vacances_scolaires: exVac,
        si_garde_we: siWe,
        sinon,
        semaines,
        periodes,
        avec_veterinaire_id: avecId,
      })
      if (res?.error) { toast.error(res.error); return }
      toast.success(isEdit ? 'Règle modifiée.' : 'Règle créée.')
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">
            {isEdit ? 'Modifier la règle' : 'Nouvelle règle'}
          </DialogTitle>
          <DialogDescription>
            Seuls les types de règles appliqués par le moteur sont proposés.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* QUI */}
          <div className="space-y-1.5">
            <Label>Vétérinaire concerné</Label>
            <Select value={ownerId} onValueChange={(v) => v && setOwnerId(v)}>
              <SelectTrigger>
                {ownerId
                  ? (() => { const v = vets.find((x) => x.id === ownerId); return v ? `${v.prenom} ${v.nom}` : '' })()
                  : <span className="text-muted-foreground">Sélectionner…</span>}
              </SelectTrigger>
              <SelectContent>
                {vets.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* QUOI */}
          <div className="space-y-1.5">
            <Label>Type de règle</Label>
            <Select value={briqueId} onValueChange={(v) => v && choisirBrique(v as BriqueEvaluable)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BRIQUES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {BRIQUES.find((b) => b.value === briqueId)?.aide}
            </p>
          </div>

          {/* Paramètres dynamiques */}
          {briqueId === 'interdire_creneau' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Jour de repos</Label>
                <Select value={jour} onValueChange={(v) => v && setJour(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={exVac} onChange={(e) => setExVac(e.target.checked)} className="rounded" />
                <span className="text-sm">Sauf pendant les vacances scolaires</span>
              </label>
            </div>
          )}

          {briqueId === 'repos_conditionnel' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Si garde le week-end</Label>
                <Select value={siWe} onValueChange={(v) => v && setSiWe(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sinon</Label>
                <Select value={sinon} onValueChange={(v) => v && setSinon(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {briqueId === 'alternance_ancre' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Semaines concernées</Label>
                <Select value={semaines} onValueChange={(v) => v && setSemaines(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paires">Semaines paires</SelectItem>
                    <SelectItem value="impaires">Semaines impaires</SelectItem>
                    <SelectItem value="toutes">Toutes les semaines</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Créneaux indisponibles</Label>
                <div className="space-y-2 mt-1">
                  {PERIODES.map((per) => (
                    <label key={per.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={periodes.includes(per.value)}
                        onChange={() => togglePeriode(per.value)}
                        className="rounded"
                      />
                      <span className="text-sm">{per.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {briqueId === 'duo_interdit' && (
            <div className="space-y-1.5">
              <Label>Jamais de garde seul avec</Label>
              <Select value={avecId} onValueChange={(v) => v && setAvecId(v)}>
                <SelectTrigger>
                  {avecId
                    ? (() => { const v = autresVets.find((x) => x.id === avecId); return v ? `${v.prenom} ${v.nom}` : '' })()
                    : <span className="text-muted-foreground">Sélectionner…</span>}
                </SelectTrigger>
                <SelectContent>
                  {autresVets.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {autresVets.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun autre vétérinaire disponible.</p>
              )}
            </div>
          )}

          {/* FORCE */}
          <div className="space-y-1.5">
            <Label>Niveau d&apos;importance</Label>
            <Select value={force} onValueChange={(v) => v && setForce(v as ForceFormulaire)}>
              <SelectTrigger>
                {(() => { const f = FORCES.find((x) => x.value === force); return f ? `${f.symbole} ${f.label}` : '' })()}
              </SelectTrigger>
              <SelectContent>
                {FORCES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.symbole} {f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* APERÇU */}
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Aperçu</p>
            <p className="text-sm text-foreground leading-6">
              {(() => { const f = FORCES.find((x) => x.value === force); return f?.symbole })()} {apercu}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Enregistrement…' : isEdit ? 'Modifier' : 'Créer la règle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
