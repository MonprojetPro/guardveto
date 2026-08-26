'use client'

// ============================================================
// GUARDVETO — Réglages du planning (équité + structure) — section /regles
// ============================================================
// Bloc UNIQUE et homogène pour les règles GLOBALES du cabinet (pas par véto) :
//   • Équilibrage des charges (6 dimensions d'équité)
//   • Structure du week-end (R8/R9)
// Présentation identique partout : titre + explication + UN menu déroulant à
// droite, dont la PREMIÈRE option = désactivé (Ignorée pour l'équité,
// Désactivée pour la structure). Plus de case à cocher séparée.
//
// Modifier une ligne = upsert de la règle correspondante (action serveur).
// Effet à la prochaine génération. Véto = lecture seule.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SlidersHorizontal, Plus, Trash2, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  EQUITY_DIMENSIONS, IMPORTANCE_LEVELS,
  type EquityDimension, type ImportanceLevel,
} from '@/engine/equity-weights'
import { IMPORTANCE_LABELS } from '@/engine/briques/catalogue'
import {
  setEquiteImportance, setStructureRegle, setRoleAvantageFinancier,
  setCohorteEquite, deleteCohorteEquite,
  type CohorteEquiteUI,
} from '@/app/(protected)/regles/actions'

// ── Référentiels d'affichage ─────────────────────────────────

const EQUITE_META: Record<EquityDimension, { titre: string; aide: string }> = {
  weekend: { titre: 'Week-ends', aide: 'Donner à chacun le même nombre de week-ends de garde.' },
  weekend_premier: { titre: 'Rôle de 1er le week-end', aide: 'Équilibrer qui est 1er le week-end (le rôle à l’avantage financier).' },
  ferie: { titre: 'Jours fériés', aide: 'Répartir équitablement les gardes des jours fériés.' },
  semaine_premier: { titre: 'Nuits de semaine — 1er', aide: 'Équilibrer les nuits de semaine assurés en 1er.' },
  semaine_second: { titre: 'Nuits de semaine — 2nd', aide: 'Équilibrer les nuits de semaine assurés en 2nd.' },
  semaine_renfort: {
    titre: 'Nuits de semaine — renfort',
    aide: 'Équilibrer les nuits de semaine tenus à partir de la 3ᵉ place.',
  },
  grands_weekend: { titre: 'Grands week-ends (salariés)', aide: 'Répartir les grands week-ends perdus par les salariés.' },
}

const FORCE_LABELS: Record<string, string> = {
  desactivee: 'Désactivée',
  jamais: 'Ferme',
  sauf_crise: 'À éviter sauf crise',
  evitee: 'Préférence (évitée)',
  si_possible: 'Préférence (si possible)',
}
const FORCE_OPTIONS = ['desactivee', 'jamais', 'sauf_crise', 'evitee', 'si_possible']

const STRUCTURE_META: Record<'liaison_creneaux' | 'inversion_role', { titre: string; aide: string }> = {
  liaison_creneaux: {
    titre: 'Même binôme vendredi soir et week-end',
    aide: 'Les deux vétos de garde le week-end sont ceux du vendredi soir.',
  },
  inversion_role: {
    titre: 'Inversion des rôles 1er / 2nd vendredi ↔ week-end',
    aide: 'Le 1er du vendredi soir devient 2nd le week-end. Sans la règle ci-dessus, sans effet.',
  },
}

// ── Pénalités souples réglables (backlog n°16 — R10/R10c/R10b/R8b) ──
// Préférences du moteur, jamais des interdictions fermes : le menu ne propose
// PAS « Ferme » (aucun gardien dur n'existe pour elles — coquille vide sinon).

export const PENALITES_SOUPLES_UI = [
  'eviter_we_consecutifs',
  'eviter_we_avant_vacances',
  'eviter_fete_fin_annee',
  'inversion_role_ferie',
] as const
type PenaliteSoupleUIId = (typeof PENALITES_SOUPLES_UI)[number]

const PENALITES_META: Record<PenaliteSoupleUIId, { titre: string; aide: string }> = {
  eviter_we_consecutifs: {
    titre: 'Éviter deux week-ends de garde de suite',
    aide: 'Le moteur évite de donner deux week-ends consécutifs au même vétérinaire (R10).',
  },
  eviter_we_avant_vacances: {
    titre: 'Éviter la garde le week-end avant ses vacances',
    aide: 'Un vétérinaire qui part en vacances la semaine suivante part reposé (R10c).',
  },
  eviter_fete_fin_annee: {
    titre: 'Éviter les gardes des soirs de réveillon',
    aide: 'Les soirs des 24 et 31 décembre sont évités autant que possible (R10b).',
  },
  inversion_role_ferie: {
    titre: 'Changer de rôle la veille d’un jour férié',
    aide: 'Le 1er de la veille devient si possible 2nd le jour férié, et inversement (R8b).',
  },
}

const FORCE_OPTIONS_SOUPLES = ['desactivee', 'sauf_crise', 'evitee', 'si_possible']

/** Force de repli quand on réactive une pénalité souple désactivée. */
const PENALITE_FORCE_REPLI: Record<PenaliteSoupleUIId, string> = {
  eviter_we_consecutifs: 'sauf_crise',
  eviter_we_avant_vacances: 'evitee',
  eviter_fete_fin_annee: 'evitee',
  inversion_role_ferie: 'si_possible',
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// R11b — rôle à avantage financier (réglage cabinet).
const ROLE_AVANTAGE_LABELS: Record<string, string> = {
  premier: 'Le 1er de garde',
  second: 'Le 2nd de garde',
  aucun: 'Aucun (pas d\'équilibrage)',
}
const ROLE_AVANTAGE_OPTIONS = ['premier', 'second', 'aucun']

export interface StructureRegleUI {
  actif: boolean
  force: string
}

// ── Ligne générique (présentation identique partout) ────────
function Ligne({
  titre, aide, value, valueLabel, options, isAdmin, isPending, onChange, cible, cibleAlt,
}: {
  titre: string
  aide: string
  value: string
  valueLabel: string
  options: { value: string; label: string }[]
  isAdmin: boolean
  isPending: boolean
  onChange: (v: string) => void
  /** Identifiant ciblable depuis le diagnostic d'impasse (?focus=…). */
  cible?: string
  /** Alias ciblable (ex : clé structurelle r8_inversion/r9_liaison). */
  cibleAlt?: string
}) {
  return (
    <div
      data-regle-cible={cible}
      data-regle-cible-alt={cibleAlt}
      className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card transition-shadow data-[focus=on]:ring-2 data-[focus=on]:ring-accent data-[focus=on]:ring-offset-1"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{titre}</p>
        <p className="text-xs text-muted-foreground leading-5">{aide}</p>
      </div>
      {isAdmin ? (
        <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={isPending}>
          <SelectTrigger className="w-52 shrink-0">{valueLabel}</SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-sm text-muted-foreground shrink-0 w-52 text-right">{valueLabel}</span>
      )}
    </div>
  )
}

// ── Cohortes d'équité par tag (Vague 6 tranche A — #21) ──────
// Libellé court de chaque dimension pour la liste des cohortes.
const DIMENSION_LABELS: Record<EquityDimension, string> = {
  weekend: 'Week-ends',
  weekend_premier: 'Rôle de 1er le week-end',
  ferie: 'Jours fériés',
  semaine_premier: 'Nuits de semaine — 1er',
  semaine_second: 'Nuits de semaine — 2nd',
  semaine_renfort: 'Nuits de semaine — renfort',
  grands_weekend: 'Grands week-ends (salariés)',
}
// Crans proposés à la CRÉATION d'une cohorte (on exclut « Ignorée » : pour
// retirer une cohorte on utilise la corbeille — plus explicite qu'un cran nul).
const IMPORTANCE_ACTIVES = IMPORTANCE_LEVELS.filter((n) => n !== 'ignoree')

interface ReglagesPlanningClientProps {
  equite: Record<EquityDimension, ImportanceLevel>
  /** Cohortes d'équité posées (dimension × tag × importance) — #21. */
  cohortes: CohorteEquiteUI[]
  /** Étiquettes réellement portées par l'équipe (choix du formulaire cohorte). */
  tagsEquipe: string[]
  structure: { liaison_creneaux: StructureRegleUI; inversion_role: StructureRegleUI }
  /** Réglage des 4 pénalités souples (backlog n°16) — clés PENALITES_SOUPLES_UI. */
  penalitesSouples: Record<string, StructureRegleUI>
  /** R11b : rôle portant l'avantage financier ('premier' | 'second' | 'aucun'). */
  roleAvantage: string
  isAdmin: boolean
}

export function ReglagesPlanningClient({ equite, cohortes, tagsEquipe, structure, penalitesSouples, roleAvantage, isAdmin }: ReglagesPlanningClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [eq, setEq] = useState(equite)
  const [st, setSt] = useState(structure)
  const [ps, setPs] = useState(penalitesSouples)
  const [roleAv, setRoleAv] = useState(roleAvantage)
  // Formulaire d'ajout de cohorte.
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  const [coDim, setCoDim] = useState<EquityDimension>('weekend')
  const [coTag, setCoTag] = useState(tagsEquipe[0] ?? '')
  const [coImp, setCoImp] = useState<ImportanceLevel>('important')

  const optionsImportance = IMPORTANCE_LEVELS.map((n) => ({ value: n, label: cap(IMPORTANCE_LABELS[n]) }))
  const optionsForce = FORCE_OPTIONS.map((f) => ({ value: f, label: FORCE_LABELS[f] }))
  const optionsForceSouple = FORCE_OPTIONS_SOUPLES.map((f) => ({ value: f, label: FORCE_LABELS[f] }))

  const changerEquite = (dim: EquityDimension, niveau: ImportanceLevel) => {
    const avant = eq[dim]
    setEq((p) => ({ ...p, [dim]: niveau }))
    startTransition(async () => {
      const res = await setEquiteImportance(dim, niveau)
      if (res?.error) { toast.error(res.error); setEq((p) => ({ ...p, [dim]: avant })) }
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  const changerRoleAvantage = (role: string) => {
    const avant = roleAv
    setRoleAv(role)
    startTransition(async () => {
      const res = await setRoleAvantageFinancier(role)
      if (res?.error) { toast.error(res.error); setRoleAv(avant) }
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  const changerPenaliteSouple = (briqueId: PenaliteSoupleUIId, choix: string) => {
    const avant = ps[briqueId]
    // « desactivee » → actif=false (on conserve la dernière force souple) ;
    // sinon actif=true + force choisie. Jamais « jamais » (préférence pure).
    const next: StructureRegleUI =
      choix === 'desactivee'
        ? { actif: false, force: FORCE_OPTIONS_SOUPLES.includes(avant.force) && avant.force !== 'desactivee' ? avant.force : PENALITE_FORCE_REPLI[briqueId] }
        : { actif: true, force: choix }
    setPs((p) => ({ ...p, [briqueId]: next }))
    startTransition(async () => {
      const res = await setStructureRegle(briqueId, next.actif, next.force)
      if (res?.error) { toast.error(res.error); setPs((p) => ({ ...p, [briqueId]: avant })) }
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  const changerStructure = (
    briqueId: 'liaison_creneaux' | 'inversion_role',
    choix: string,
  ) => {
    const avant = st[briqueId]
    // « desactivee » → actif=false (on conserve la dernière force) ; sinon actif=true + force.
    const next: StructureRegleUI =
      choix === 'desactivee'
        ? { actif: false, force: avant.force === 'desactivee' ? 'jamais' : avant.force }
        : { actif: true, force: choix }
    setSt((p) => ({ ...p, [briqueId]: next }))
    startTransition(async () => {
      const res = await setStructureRegle(briqueId, next.actif, next.force)
      if (res?.error) { toast.error(res.error); setSt((p) => ({ ...p, [briqueId]: avant })) }
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  // ── Cohortes d'équité (#21) ──
  const changerImportanceCohorte = (c: CohorteEquiteUI, imp: string) => {
    startTransition(async () => {
      const res = await setCohorteEquite(c.dimension, c.tag, imp)
      if (res?.error) toast.error(res.error)
      else { toast.success('Réglage enregistré — appliqué à la prochaine génération.'); router.refresh() }
    })
  }

  const supprimerCohorte = (c: CohorteEquiteUI) => {
    startTransition(async () => {
      const res = await deleteCohorteEquite(c.id)
      if (res?.error) toast.error(res.error)
      else { toast.success('Cohorte retirée.'); router.refresh() }
    })
  }

  const ajouterCohorte = () => {
    const tag = coTag.trim().toLowerCase()
    if (tag === '') { toast.error('Choisis une étiquette.'); return }
    startTransition(async () => {
      const res = await setCohorteEquite(coDim, tag, coImp)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Cohorte ajoutée — appliquée à la prochaine génération.')
      setAjoutOuvert(false)
      router.refresh()
    })
  }

  const optionsImportanceActives = IMPORTANCE_ACTIVES.map((n) => ({ value: n, label: cap(IMPORTANCE_LABELS[n]) }))

  return (
    <section className="space-y-4 max-w-3xl">
      <div>
        <h2 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-primary" /> Réglages du planning
        </h2>
        <p className="text-muted-foreground text-sm mt-1 leading-5">
          Les règles globales du cabinet. La première option d&apos;un menu (
          <em>Ignorée</em> / <em>Désactivée</em>) coupe la règle ; les suivantes
          en règlent l&apos;importance. Effet à la prochaine génération.
        </p>
      </div>

      {/* Équilibrage des charges */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Équilibrage des charges
        </h3>
        {EQUITY_DIMENSIONS.map((dim) => (
          <Ligne
            key={dim}
            titre={EQUITE_META[dim].titre}
            aide={EQUITE_META[dim].aide}
            value={eq[dim]}
            valueLabel={cap(IMPORTANCE_LABELS[eq[dim]])}
            options={optionsImportance}
            isAdmin={isAdmin}
            isPending={isPending}
            onChange={(v) => changerEquite(dim, v as ImportanceLevel)}
          />
        ))}
      </div>

      {/* Cohortes d'équité par étiquette (Vague 6 tranche A — #21) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Tags className="w-3.5 h-3.5" /> Cohortes d&apos;équité
          </h3>
          {isAdmin && (
            <Button
              size="sm" variant="outline"
              onClick={() => { setCoTag(tagsEquipe[0] ?? ''); setAjoutOuvert((o) => !o) }}
              disabled={isPending}
            >
              <Plus className="w-4 h-4 mr-1" /> Ajouter
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-5">
          Équilibrer une dimension <strong>uniquement</strong> entre les
          vétérinaires portant une étiquette (junior, senior…). S&apos;ajoute à
          l&apos;équilibrage global ci-dessus. Pour une répartition strictement
          séparée, mettez la dimension globale sur « Ignorée ».
        </p>

        {cohortes.length === 0 ? (
          <p className="text-sm text-muted-foreground p-3.5 rounded-lg border border-dashed border-border">
            Aucune cohorte d&apos;équité pour l&apos;instant.
          </p>
        ) : (
          <div className="space-y-2">
            {cohortes.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {DIMENSION_LABELS[c.dimension as EquityDimension] ?? c.dimension}
                  </p>
                  <p className="text-xs text-muted-foreground leading-5">
                    Entre les vétérinaires « {c.tag} »
                  </p>
                </div>
                {isAdmin ? (
                  <>
                    <Select
                      value={c.importance}
                      onValueChange={(v) => v && changerImportanceCohorte(c, v)}
                      disabled={isPending}
                    >
                      <SelectTrigger className="w-52 shrink-0">{cap(IMPORTANCE_LABELS[c.importance as ImportanceLevel] ?? c.importance)}</SelectTrigger>
                      <SelectContent>
                        {optionsImportanceActives.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => supprimerCohorte(c)} disabled={isPending}
                      aria-label="Retirer la cohorte"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground shrink-0 w-52 text-right">
                    {cap(IMPORTANCE_LABELS[c.importance as ImportanceLevel] ?? c.importance)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && ajoutOuvert && (
          <div className="p-3.5 rounded-lg border border-border bg-muted/40 space-y-3">
            {tagsEquipe.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune étiquette n&apos;est posée sur l&apos;équipe. Ajoutez-en
                d&apos;abord sur les fiches de la page Équipe.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Dimension</Label>
                    <Select value={coDim} onValueChange={(v) => v && setCoDim(v as EquityDimension)}>
                      <SelectTrigger className="w-full">{DIMENSION_LABELS[coDim]}</SelectTrigger>
                      <SelectContent>
                        {EQUITY_DIMENSIONS.map((d) => (
                          <SelectItem key={d} value={d}>{DIMENSION_LABELS[d]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Étiquette</Label>
                    <Select value={coTag} onValueChange={(v) => v && setCoTag(v)}>
                      <SelectTrigger className="w-full">{coTag || 'Choisir…'}</SelectTrigger>
                      <SelectContent>
                        {tagsEquipe.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Importance</Label>
                    <Select value={coImp} onValueChange={(v) => v && setCoImp(v as ImportanceLevel)}>
                      <SelectTrigger className="w-full">{cap(IMPORTANCE_LABELS[coImp])}</SelectTrigger>
                      <SelectContent>
                        {optionsImportanceActives.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAjoutOuvert(false)} disabled={isPending}>
                    Annuler
                  </Button>
                  <Button size="sm" onClick={ajouterCohorte} disabled={isPending || coTag.trim() === ''}>
                    {isPending ? 'Ajout…' : 'Ajouter la cohorte'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Structure du week-end */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Structure du week-end
        </h3>
        {(['liaison_creneaux', 'inversion_role'] as const).map((briqueId) => {
          const v = st[briqueId]
          const courant = v.actif ? v.force : 'desactivee'
          return (
            <Ligne
              key={briqueId}
              titre={STRUCTURE_META[briqueId].titre}
              aide={STRUCTURE_META[briqueId].aide}
              value={courant}
              valueLabel={FORCE_LABELS[courant]}
              options={optionsForce}
              isAdmin={isAdmin}
              isPending={isPending}
              onChange={(v2) => changerStructure(briqueId, v2)}
              cible={briqueId}
              cibleAlt={briqueId === 'inversion_role' ? 'r8_inversion' : 'r9_liaison'}
            />
          )
        })}
        <Ligne
          titre="Rôle payé du week-end (avantage financier)"
          aide="Le rôle qui rapporte plus le week-end. Le moteur équilibre qui l'obtient (dimension « Rôle de 1er le week-end » ci-dessus)."
          value={roleAv}
          valueLabel={ROLE_AVANTAGE_LABELS[roleAv] ?? roleAv}
          options={ROLE_AVANTAGE_OPTIONS.map((r) => ({ value: r, label: ROLE_AVANTAGE_LABELS[r] }))}
          isAdmin={isAdmin}
          isPending={isPending}
          onChange={changerRoleAvantage}
          cible="role_avantage_financier"
        />
      </div>

      {/* Préférences du planning (pénalités souples réglables — backlog n°16) */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Préférences du planning
        </h3>
        <p className="text-xs text-muted-foreground leading-5">
          Des préférences que le moteur essaie d&apos;honorer, jamais des
          interdictions : elles ne bloquent pas la génération.
        </p>
        {PENALITES_SOUPLES_UI.map((briqueId) => {
          const v = ps[briqueId] ?? { actif: true, force: PENALITE_FORCE_REPLI[briqueId] }
          const courant = v.actif ? v.force : 'desactivee'
          return (
            <Ligne
              key={briqueId}
              titre={PENALITES_META[briqueId].titre}
              aide={PENALITES_META[briqueId].aide}
              value={courant}
              valueLabel={FORCE_LABELS[courant] ?? courant}
              options={optionsForceSouple}
              isAdmin={isAdmin}
              isPending={isPending}
              onChange={(v2) => changerPenaliteSouple(briqueId, v2)}
              cible={briqueId}
            />
          )
        })}
      </div>
    </section>
  )
}
