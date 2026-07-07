'use client'

// ============================================================
// GUARDVETO — Formulaire guidé de règle (P1A-007)
// ============================================================
// Création / édition d'une règle de cabinet, en langage naturel.
// Étapes : QUI (véto) → QUOI (type de règle) → ses paramètres →
// FORCE → APERÇU live. Écrit via upsertRegle (params_json bâti côté
// serveur, frontière de confiance).
//
// ⚠️ NE PROPOSE QUE LES BRIQUES ÉVALUABLES par le moteur (interdire_creneau,
//    repos_conditionnel, alternance_ancre, duo_interdit, au_plus_n, espacement_min).
//    Proposer une brique sans évaluateur créerait une règle silencieusement
//    ignorée (coquille vide). Doit rester aligné avec BRIQUES_EVALUABLES (actions.ts).
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
import type { RegleRow, VetoMini, PeriodeOption, TypeCreneauOption } from './ReglesClient'

/** Valeur sentinelle du sélecteur de validité = règle permanente (periode_id null). */
const PERMANENTE = '__permanente__'

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
  { value: 'au_plus_n', label: 'Limite de gardes', aide: 'Au plus N gardes sur une fenêtre (semaine civile ou jours glissants).' },
  { value: 'espacement_min', label: 'Espacement minimal', aide: 'Au moins X jours de repos entre deux gardes du même véto.' },
  { value: 'espacement_weekend', label: 'Fréquence des week-ends', aide: 'Au plus un week-end de garde toutes les N semaines (« un week-end sur N »).' },
  // Desiderata (n°7) — préférences POSITIVES, toujours souples.
  { value: 'preferer_creneau', label: 'Préférence de jours / créneaux', aide: 'Le moteur essaie de placer ses gardes sur les jours ou créneaux qu’il préfère. Jamais bloquant.' },
  { value: 'preferer_avec', label: 'Préfère être de garde avec…', aide: 'Le moteur essaie de le mettre en binôme avec ce co-équipier. Jamais bloquant.' },
  { value: 'volume_gardes', label: 'Souhaite plus / moins de gardes', aide: 'Biais assumé sur la répartition : le moteur lui donne plus (ou moins) de gardes que la moyenne. Jamais bloquant.' },
]

/** Desiderata : préférences pures — le niveau « Interdiction ferme » est exclu. */
const BRIQUES_SOUPLES_SEULEMENT = new Set<BriqueEvaluable>([
  'preferer_creneau', 'preferer_avec', 'volume_gardes',
])

/** Jours proposés pour une PRÉFÉRENCE (7 jours — un week-end est daté samedi). */
const JOURS_TOUS = [
  ...JOURS,
  { value: 'samedi', label: 'Samedi' },
  { value: 'dimanche', label: 'Dimanche' },
]

/** Fenêtres de comptage pour « au plus N gardes » (alignées sur FENETRES_VALIDES). */
const FENETRES = [
  { value: 'semaine_civile', label: 'par semaine civile (lun→dim)' },
  { value: 'glissante_7_jours', label: 'sur 7 jours glissants' },
  { value: 'glissante_14_jours', label: 'sur 14 jours glissants' },
  { value: 'glissante_30_jours', label: 'sur 30 jours glissants' },
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
  au_plus_n: 'sauf_crise',      // limite protectrice : ferme mais pliable en crise
  espacement_min: 'sauf_crise', // idem (trop dur → risque d'impasse)
  espacement_weekend: 'si_possible', // fréquence WE = préférence (ne jamais bloquer)
  preferer_creneau: 'si_possible',   // desiderata = préférences pures (n°7)
  preferer_avec: 'si_possible',
  volume_gardes: 'si_possible',
}

// ── Composant ────────────────────────────────────────────────

interface RegleFormDialogProps {
  open: boolean
  onClose: () => void
  vets: VetoMini[]
  periodes: PeriodeOption[]
  /** Types de créneaux du cabinet — filtre optionnel de au_plus_n (n°19). */
  typesCreneaux: TypeCreneauOption[]
  regle?: RegleRow | null
}

export function RegleFormDialog({ open, onClose, vets, periodes: periodesDispo, typesCreneaux, regle }: RegleFormDialogProps) {
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

  // au_plus_n
  const [n, setN] = useState<string>(
    typeof p.n === 'number' ? String(p.n) : typeof p.n === 'string' ? p.n : '2',
  )
  const [fenetre, setFenetre] = useState<string>(
    typeof p.fenetre === 'string' && FENETRES.some((f) => f.value === p.fenetre) ? p.fenetre : 'semaine_civile',
  )
  // au_plus_n — filtre optionnel par types de créneaux du cabinet (n°19).
  // Vide = toutes les gardes comptent (comportement historique).
  const [creneauxFiltre, setCreneauxFiltre] = useState<string[]>(
    Array.isArray(p.creneaux)
      ? (p.creneaux as unknown[]).filter(
          (x): x is string => typeof x === 'string' && typesCreneaux.some((t) => t.code === x),
        )
      : [],
  )

  // espacement_min
  const [ecartMin, setEcartMin] = useState<string>(
    typeof p.ecart_min_jours === 'number' ? String(p.ecart_min_jours)
      : typeof p.ecart_min_jours === 'string' ? p.ecart_min_jours : '3',
  )

  // espacement_weekend (« un week-end sur N »)
  const [nSemaines, setNSemaines] = useState<string>(
    typeof p.n_semaines === 'number' ? String(p.n_semaines)
      : typeof p.n_semaines === 'string' ? p.n_semaines : '2',
  )

  // preferer_creneau (n°7) : jours préférés + créneaux préférés (creneaux partagé
  // avec le filtre au_plus_n — même état creneauxFiltre, validé par brique).
  const [joursPref, setJoursPref] = useState<string[]>(
    Array.isArray(p.jours)
      ? (p.jours as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
  )

  // volume_gardes (n°7)
  const [sens, setSens] = useState<string>(p.sens === 'moins' ? 'moins' : 'plus')

  // Validité : PERMANENTE (par défaut) ou limitée à une période existante.
  const periodeInit = regle?.periode_id && periodesDispo.some((per) => per.id === regle.periode_id)
    ? regle.periode_id
    : PERMANENTE
  const [validite, setValidite] = useState<string>(periodeInit)

  const nomVeto = (id: string) => vets.find((v) => v.id === id)?.prenom ?? id

  const choisirBrique = (b: BriqueEvaluable) => {
    setBriqueId(b)
    setForce(FORCE_DEFAUT[b])
  }

  const togglePeriode = (p: string) =>
    setPeriodes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  const toggleJourPref = (j: string) =>
    setJoursPref((prev) => (prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j]))

  const toggleCreneauFiltre = (code: string) =>
    setCreneauxFiltre((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))

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
      case 'au_plus_n':
        params = { n: Number(n) || 0, fenetre, creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined }
        break
      case 'espacement_min':
        params = { ecart_min_jours: Number(ecartMin) || 0 }
        break
      case 'espacement_weekend':
        params = { n_semaines: Number(nSemaines) || 0 }
        break
      case 'preferer_creneau':
        params = {
          jours: joursPref.length > 0 ? joursPref : undefined,
          creneaux: creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
        }
        break
      case 'preferer_avec':
        params = { avec_veterinaire_id: avecId }
        break
      case 'volume_gardes':
        params = { sens }
        break
    }
    const predicat = rendreRegle(briqueId, params, { nomVeto })
    return sujet ? `${sujet} ${predicat}` : predicat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briqueId, ownerId, jour, exVac, siWe, sinon, semaines, periodes, avecId, n, fenetre, creneauxFiltre, ecartMin, nSemaines, joursPref, sens, vets])

  const handleSubmit = () => {
    if (!ownerId) { toast.error('Sélectionnez le vétérinaire concerné.'); return }
    if (briqueId === 'alternance_ancre' && periodes.length === 0) {
      toast.error('Sélectionnez au moins une période.'); return
    }
    if (briqueId === 'duo_interdit') {
      if (!avecId) { toast.error('Sélectionnez le second vétérinaire.'); return }
      if (avecId === ownerId) { toast.error('Choisissez deux vétérinaires différents.'); return }
    }
    if (briqueId === 'au_plus_n') {
      const v = Number(n)
      if (!Number.isInteger(v) || v < 1) { toast.error('Indiquez un nombre de gardes valide (≥ 1).'); return }
    }
    if (briqueId === 'espacement_min') {
      const v = Number(ecartMin)
      if (!Number.isInteger(v) || v < 1) { toast.error('Indiquez un écart valide (≥ 1 jour).'); return }
    }
    if (briqueId === 'espacement_weekend') {
      const v = Number(nSemaines)
      if (!Number.isInteger(v) || v < 2) { toast.error('Indiquez une fréquence valide (un week-end sur 2 minimum).'); return }
    }
    if (briqueId === 'preferer_creneau' && joursPref.length === 0 && creneauxFiltre.length === 0) {
      toast.error('Sélectionnez au moins un jour ou un type de créneau préféré.'); return
    }
    if (briqueId === 'preferer_avec') {
      if (!avecId) { toast.error('Sélectionnez le co-équipier préféré.'); return }
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
        n: Number(n),
        fenetre,
        creneaux: (briqueId === 'au_plus_n' || briqueId === 'preferer_creneau') && creneauxFiltre.length > 0 ? creneauxFiltre : undefined,
        ecart_min_jours: Number(ecartMin),
        n_semaines: Number(nSemaines),
        jours: briqueId === 'preferer_creneau' && joursPref.length > 0 ? joursPref : undefined,
        sens,
        periode_id: validite === PERMANENTE ? null : validite,
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

          {briqueId === 'au_plus_n' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="au-plus-n">Nombre de gardes max</Label>
                  <input
                    id="au-plus-n"
                    type="number"
                    min={1}
                    max={14}
                    value={n}
                    onChange={(e) => setN(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Fenêtre de comptage</Label>
                  <Select value={fenetre} onValueChange={(v) => v && setFenetre(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FENETRES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Filtre de créneaux (n°19) : « max 2 week-ends par mois ». */}
              <div className="space-y-1.5">
                <Label>Ne compter que certains créneaux (optionnel)</Label>
                <div className="space-y-2 mt-1">
                  {typesCreneaux.map((t) => (
                    <label key={t.code} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={creneauxFiltre.includes(t.code)}
                        onChange={() => toggleCreneauFiltre(t.code)}
                        className="rounded"
                      />
                      <span className="text-sm">{t.nom}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Rien de coché = toutes les gardes comptent. Ex. cocher «&nbsp;Week-end&nbsp;»
                  avec «&nbsp;2 sur 30 jours glissants&nbsp;» = au plus 2 week-ends par mois.
                </p>
              </div>
            </div>
          )}

          {briqueId === 'espacement_min' && (
            <div className="space-y-1.5">
              <Label htmlFor="ecart-min">Jours de repos minimum entre deux gardes</Label>
              <input
                id="ecart-min"
                type="number"
                min={1}
                max={30}
                value={ecartMin}
                onChange={(e) => setEcartMin(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}

          {briqueId === 'preferer_creneau' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Jours préférés</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {JOURS_TOUS.map((j) => (
                    <button
                      key={j.value}
                      type="button"
                      onClick={() => toggleJourPref(j.value)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        joursPref.includes(j.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary'
                      }`}
                    >
                      {j.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Créneaux préférés</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {typesCreneaux.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => toggleCreneauFiltre(t.code)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        creneauxFiltre.includes(t.code)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary'
                      }`}
                    >
                      {t.nom}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Au moins un jour OU un créneau. Le moteur essaie de concentrer ses
                  gardes dessus — sans jamais bloquer la génération.
                </p>
              </div>
            </div>
          )}

          {briqueId === 'preferer_avec' && (
            <div className="space-y-1.5">
              <Label>Préfère être de garde avec</Label>
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
              <p className="text-xs text-muted-foreground">
                Préférence dans UN sens (créez la règle symétrique si le souhait est partagé).
              </p>
            </div>
          )}

          {briqueId === 'volume_gardes' && (
            <div className="space-y-1.5">
              <Label>Souhait</Label>
              <Select value={sens} onValueChange={(v) => v && setSens(v)}>
                <SelectTrigger>
                  {sens === 'plus' ? 'Faire PLUS de gardes que la moyenne' : 'Faire MOINS de gardes que la moyenne'}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plus">Faire PLUS de gardes que la moyenne</SelectItem>
                  <SelectItem value="moins">Faire MOINS de gardes que la moyenne</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Biais assumé sur la répartition — les règles dures et l&apos;équilibre
                global restent prioritaires.
              </p>
            </div>
          )}

          {briqueId === 'espacement_weekend' && (
            <div className="space-y-1.5">
              <Label htmlFor="n-semaines">De garde au plus un week-end sur…</Label>
              <input
                id="n-semaines"
                type="number"
                min={2}
                max={26}
                value={nSemaines}
                onChange={(e) => setNSemaines(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Ex. « 3 » = un week-end sur trois (les deux week-ends suivants sont libres).
              </p>
            </div>
          )}

          {/* FORCE — les desiderata (préférences pures) excluent « Interdiction ferme » */}
          <div className="space-y-1.5">
            <Label>Niveau d&apos;importance</Label>
            <Select value={force} onValueChange={(v) => v && setForce(v as ForceFormulaire)}>
              <SelectTrigger>
                {(() => { const f = FORCES.find((x) => x.value === force); return f ? `${f.symbole} ${f.label}` : '' })()}
              </SelectTrigger>
              <SelectContent>
                {FORCES.filter(
                  (f) => !(BRIQUES_SOUPLES_SEULEMENT.has(briqueId) && f.value === 'jamais'),
                ).map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.symbole} {f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* VALIDITÉ (permanente ou limitée à une période) */}
          <div className="space-y-1.5">
            <Label>Validité</Label>
            <Select value={validite} onValueChange={(v) => v && setValidite(v)}>
              <SelectTrigger>
                {validite === PERMANENTE
                  ? 'Permanente (toutes les générations)'
                  : (periodesDispo.find((per) => per.id === validite)?.label ?? 'Période')}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PERMANENTE}>Permanente (toutes les générations)</SelectItem>
                {periodesDispo.map((per) => (
                  <SelectItem key={per.id} value={per.id}>Limitée à : {per.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {periodesDispo.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune période créée — la règle s&apos;appliquera à toutes les générations.
              </p>
            )}
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
