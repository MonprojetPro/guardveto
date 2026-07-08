'use client'

// ============================================================
// GUARDVETO — Écran « Règles du cabinet » (P1A-006)
// ============================================================
// Rend les regles_cabinet en français (catalogue P1A-005), groupées par
// force. Admin : activer/désactiver, supprimer (confirmation), créer/éditer
// (→ P1A-007). Véto : lecture seule (aucun bouton d'écriture).
//
// « Temps réel » à la mode GuardVeto : après chaque action serveur
// (revalidatePath) on appelle router.refresh() → la liste se met à jour
// sans rechargement. L'admin est le seul à écrire, le besoin est couvert.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ScrollText, Power, Pencil, Trash2, Plus, Lock, Inbox, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { rendreRegle } from '@/engine/briques/catalogue'
import { setRegleActif, deleteRegle } from '@/app/(protected)/regles/actions'
import { RegleFormDialog } from './RegleFormDialog'
import { AssistantIA } from './AssistantIA'

/** Briques que le formulaire P1A-007 sait éditer (= évaluables par le moteur).
 *  Doit rester aligné avec BRIQUES_EVALUABLES (actions.ts) + BRIQUES (RegleFormDialog). */
const BRIQUES_EDITABLES = new Set([
  'interdire_creneau', 'repos_conditionnel', 'alternance_ancre', 'duo_interdit',
  'au_plus_n', 'espacement_min', 'espacement_weekend',
  // Desiderata (n°7) — préférences positives par véto.
  'preferer_creneau', 'preferer_avec', 'volume_gardes',
  // Successions / séries / repos avancés (#13).
  'succession_interdite', 'serie_max', 'repos_apres_serie',
  // Cadencement « 1 WE sur N ancré » (#20).
  'cadencement_weekend',
])

// ── Données ──────────────────────────────────────────────────

export interface RegleRow {
  id: string
  brique_id: string
  params_json: unknown
  force: string
  actif: boolean
  /** null = règle permanente ; un id = règle limitée à cette période. */
  periode_id?: string | null
}

/** Période proposable au formulaire + résolution de son libellé (liste). */
export interface PeriodeOption {
  id: string
  label: string
}

/** Type de créneau du cabinet proposable au filtre au_plus_n (n°19). */
export interface TypeCreneauOption {
  code: string
  nom: string
}

export interface VetoMini {
  id: string
  prenom: string
  nom: string
  couleur: string | null
}

type GroupeKey = 'fermes' | 'sauf_crise' | 'confort' | 'reglementaires'

const FORCE_META: Record<string, { etage: number; groupe: GroupeKey; symbole: string }> = {
  invariant:     { etage: 0, groupe: 'fermes',         symbole: '🔴' },
  reglementaire: { etage: 1, groupe: 'reglementaires', symbole: '⚪' },
  jamais:        { etage: 2, groupe: 'fermes',         symbole: '🔴' },
  sauf_crise:    { etage: 3, groupe: 'sauf_crise',     symbole: '🟠' },
  evitee:        { etage: 4, groupe: 'confort',        symbole: '🟡' },
  si_possible:   { etage: 5, groupe: 'confort',        symbole: '🟡' },
}

const GROUPES: { key: GroupeKey; titre: string; symbole: string }[] = [
  { key: 'fermes',     titre: 'Interdictions fermes',    symbole: '🔴' },
  { key: 'sauf_crise', titre: 'À éviter sauf crise',     symbole: '🟠' },
  { key: 'confort',    titre: 'Préférences de confort',  symbole: '🟡' },
]

function etageDe(force: string): number {
  return FORCE_META[force]?.etage ?? 99
}
function symboleDe(force: string): string {
  return FORCE_META[force]?.symbole ?? '⚪'
}
function groupeDe(force: string): GroupeKey {
  return FORCE_META[force]?.groupe ?? 'confort'
}

// ── Rendu d'une règle en français (sujet + prédicat) ─────────

interface ParamsJson {
  qui?: { refs?: unknown }
  params?: unknown
}

/**
 * Clé de paire non ordonnée d'un duo interdit (sinon null). Sert à n'afficher
 * QU'UNE ligne par duo, alors que la base en stocke deux (A→B + B→A, requis par
 * le moteur). Le toggle/suppression côté serveur gèrent déjà les deux sens.
 */
function clePaireDuo(r: RegleRow): string | null {
  if (r.brique_id !== 'duo_interdit') return null
  const pj = r.params_json as { qui?: { refs?: unknown[] }; params?: { avec_veterinaire_id?: unknown } }
  const owner = pj?.qui?.refs?.[0]
  const partner = pj?.params?.avec_veterinaire_id
  if (typeof owner !== 'string' || typeof partner !== 'string') return null
  return [owner, partner].sort().join('|')
}

/** Retire le sens miroir des duos : on ne garde que la 1re ligne de chaque paire. */
function fusionnerDuos(rows: RegleRow[]): RegleRow[] {
  const vues = new Set<string>()
  return rows.filter((r) => {
    const cle = clePaireDuo(r)
    if (!cle) return true
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

function phraseRegle(regle: RegleRow, nomVeto: (id: string) => string): string {
  const pj = (regle.params_json ?? {}) as ParamsJson
  const refs = pj.qui?.refs
  // Multi-propriétaires (n°18) : le sujet affiche TOUTES les réfs — sauf pour
  // un duo interdit où refs[1] est le PARTENAIRE (déjà rendu par le prédicat).
  const refsStr = Array.isArray(refs) ? refs.filter((x): x is string => typeof x === 'string') : []
  const sujets = regle.brique_id === 'duo_interdit' ? refsStr.slice(0, 1) : refsStr
  const sujet = sujets.map(nomVeto).join(', ')
  const params = (pj.params ?? {}) as Record<string, unknown>
  const predicat = rendreRegle(regle.brique_id, params, { nomVeto })
  return sujet ? `${sujet} ${predicat}` : predicat
}

// ── Composant ────────────────────────────────────────────────

interface ReglesClientProps {
  regles: RegleRow[]
  vets: VetoMini[]
  periodes: PeriodeOption[]
  /** Types de créneaux du cabinet (filtre au_plus_n — n°19). */
  typesCreneaux: TypeCreneauOption[]
  isAdmin: boolean
}

export function ReglesClient({ regles, vets, periodes, typesCreneaux, isAdmin }: ReglesClientProps) {
  const labelPeriode = (id?: string | null) =>
    id ? (periodes.find((p) => p.id === id)?.label ?? 'période supprimée') : null
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [aSupprimer, setASupprimer] = useState<RegleRow | null>(null)
  const [formOuvert, setFormOuvert] = useState(false)
  const [aEditer, setAEditer] = useState<RegleRow | null>(null)

  const nomVeto = (id: string) => {
    const v = vets.find((x) => x.id === id)
    return v ? v.prenom : id
  }

  // Une seule ligne par duo (la base en stocke deux sens — cf. fusionnerDuos).
  const actives = fusionnerDuos(regles.filter((r) => r.actif))
  const inactives = fusionnerDuos(regles.filter((r) => !r.actif))

  const ouvrirCreation = () => {
    setAEditer(null)
    setFormOuvert(true)
  }

  const ouvrirEdition = (regle: RegleRow) => {
    if (!BRIQUES_EDITABLES.has(regle.brique_id)) {
      toast.info("Ce type de règle n'est pas encore éditable depuis le formulaire.")
      return
    }
    setAEditer(regle)
    setFormOuvert(true)
  }

  const onToggle = (regle: RegleRow) => {
    startTransition(async () => {
      const res = await setRegleActif(regle.id, !regle.actif)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(regle.actif ? 'Règle désactivée.' : 'Règle réactivée.')
        router.refresh()
      }
    })
  }

  const onDelete = () => {
    if (!aSupprimer) return
    const cible = aSupprimer
    startTransition(async () => {
      const res = await deleteRegle(cible.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Règle supprimée.')
        setASupprimer(null)
        router.refresh()
      }
    })
  }

  // ── Ligne de règle ─────────────────────────────────────────
  const RegleRowView = ({ regle, grisee }: { regle: RegleRow; grisee?: boolean }) => (
    <div
      data-regle-cible={regle.id}
      className={`flex items-start gap-3 p-3.5 rounded-lg border border-border bg-card transition-shadow data-[focus=on]:ring-2 data-[focus=on]:ring-accent data-[focus=on]:ring-offset-1 ${grisee ? 'opacity-55' : ''}`}
    >
      <span className="text-base leading-6 shrink-0" aria-hidden>
        {symboleDe(regle.force)}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-6">
          {phraseRegle(regle, nomVeto)}
        </p>
        {regle.periode_id && (
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md bg-accent/15 text-accent-foreground border border-accent/30">
            <CalendarClock className="w-3 h-3" /> {labelPeriode(regle.periode_id)}
          </span>
        )}
      </div>

      {isAdmin && (
        <div className="flex gap-1 shrink-0">
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => onToggle(regle)}
            disabled={isPending}
            title={regle.actif ? 'Désactiver' : 'Réactiver'}
          >
            <Power className="w-3.5 h-3.5" />
          </Button>
          {regle.actif && (
            <Button
              variant="ghost" size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => ouvrirEdition(regle)}
              title="Éditer"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setASupprimer(regle)}
            disabled={isPending}
            title="Supprimer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  )

  const Groupe = ({ groupeKey, titre, symbole }: { groupeKey: GroupeKey; titre: string; symbole: string }) => {
    const lignes = actives
      .filter((r) => groupeDe(r.force) === groupeKey)
      .sort((a, b) => etageDe(a.force) - etageDe(b.force) || a.brique_id.localeCompare(b.brique_id))
    if (lignes.length === 0) return null
    return (
      <section className="space-y-2">
        <h2 className="font-semibold text-sm text-foreground flex items-center gap-2">
          <span aria-hidden>{symbole}</span> {titre}
          <span className="text-muted-foreground font-normal">· {lignes.length}</span>
        </h2>
        <div className="space-y-2">
          {lignes.map((r) => <RegleRowView key={r.id} regle={r} />)}
        </div>
      </section>
    )
  }

  return (
    <>
      <div className="space-y-8 max-w-3xl">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-foreground flex items-center gap-2">
              <ScrollText className="w-6 h-6 text-primary" />
              Règles du cabinet
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {actives.length === 0
                ? 'Aucune règle active'
                : `${actives.length} règle${actives.length > 1 ? 's' : ''} active${actives.length > 1 ? 's' : ''}`}
              {' · '}mises à jour en direct
            </p>
          </div>
          {isAdmin && (
            <Button onClick={ouvrirCreation} className="shrink-0">
              <Plus className="w-4 h-4 mr-1" /> Nouvelle règle
            </Button>
          )}
        </div>

        {/* Assistant IA (bêta) — création de règle en langage naturel */}
        {isAdmin && <AssistantIA />}

        {actives.length === 0 && inactives.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <Inbox className="w-8 h-8 opacity-30" />
            <p className="text-sm">Aucune règle configurée pour ce cabinet.</p>
          </div>
        )}

        {/* Groupes actifs */}
        {GROUPES.map((g) => (
          <Groupe key={g.key} groupeKey={g.key} titre={g.titre} symbole={g.symbole} />
        ))}

        {/* Désactivées (réversible) */}
        {inactives.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
              Désactivées <span className="font-normal">· {inactives.length}</span>
            </h2>
            <div className="space-y-2">
              {inactives
                .sort((a, b) => etageDe(a.force) - etageDe(b.force))
                .map((r) => <RegleRowView key={r.id} regle={r} grisee />)}
            </div>
          </section>
        )}

        {/* Réglementaires — emplacement réservé (archi G1, étage 1 vide) */}
        <section className="space-y-2">
          <h2 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
            <span aria-hidden>⚪</span> Réglementaires (pré-assemblées)
            <span className="ml-1 inline-flex items-center gap-1 text-xs font-normal px-2 py-0.5 rounded-md bg-muted">
              <Lock className="w-3 h-3" /> bientôt
            </span>
          </h2>
          <div className="p-4 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Repos de sécurité, plafonds légaux… seront fournis pré-assemblés. (À venir)
          </div>
        </section>
      </div>

      {/* Confirmation de suppression */}
      <Dialog open={Boolean(aSupprimer)} onOpenChange={(o) => !o && setASupprimer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette règle ?</DialogTitle>
            <DialogDescription>
              Cette action est définitive. La règle ne sera plus prise en compte lors des prochaines générations.
            </DialogDescription>
          </DialogHeader>
          {aSupprimer && (
            <p className="text-sm bg-muted rounded-lg p-3 leading-6">
              {symboleDe(aSupprimer.force)} {phraseRegle(aSupprimer, nomVeto)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={isPending}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Formulaire guidé création / édition (P1A-007) */}
      {isAdmin && formOuvert && (
        <RegleFormDialog
          open={formOuvert}
          onClose={() => setFormOuvert(false)}
          vets={vets}
          periodes={periodes}
          typesCreneaux={typesCreneaux}
          regle={aEditer}
        />
      )}
    </>
  )
}
