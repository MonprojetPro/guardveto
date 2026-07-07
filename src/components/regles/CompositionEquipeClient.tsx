'use client'

// ============================================================
// GUARDVETO — Règles d'équipe par étiquette (backlog n°6 + n°22) — /regles
// ============================================================
// Le lot « qui peut faire quoi », basé sur les étiquettes de l'équipe
// (junior/senior…). Deux briques, une seule section homogène :
//   • composition_equipe (n°6) : « au moins un senior par week-end »
//     (au_moins_un) / « un junior jamais seul » (pas_seuls)
//   • role_interdit_tag (n°22) : « un junior jamais 1er »
// Plusieurs règles possibles ; chacune a son niveau de force (ferme =
// bloque la génération, sinon préférence). Véto = lecture seule.
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Users, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { rendreRegle } from '@/engine/briques/catalogue'
import {
  upsertCompositionRegle, upsertRoleInterditRegle, setRegleActif, deleteRegle,
  type CompositionReglePayload, type RoleInterditReglePayload, type ForceFormulaire,
} from '@/app/(protected)/regles/actions'

// ── Types des props (résolus côté page serveur) ──────────────

/** Une règle d'équipe, toutes briques confondues (forme UI unifiée). */
export interface RegleEquipeUI {
  id: string
  brique: 'composition_equipe' | 'role_interdit_tag'
  /** composition_equipe uniquement. */
  mode?: 'au_moins_un' | 'pas_seuls'
  tag: string
  /** role_interdit_tag uniquement. */
  role?: string
  creneaux: string[]
  force: string
  actif: boolean
}

export interface TypeCreneauCompo {
  code: string
  nom: string
}

interface CompositionEquipeClientProps {
  regles: RegleEquipeUI[]
  typesCreneaux: TypeCreneauCompo[]
  /** Étiquettes déjà portées par l'équipe (suggestions du formulaire). */
  tagsEquipe: string[]
  /** Labels de rôles du catalogue du cabinet (ex. premier, second). */
  rolesCabinet: string[]
  isAdmin: boolean
}

const FORCE_LABELS: Record<string, string> = {
  desactivee: 'Désactivée',
  jamais: 'Ferme',
  sauf_crise: 'À éviter sauf crise',
  evitee: 'Préférence (évitée)',
  si_possible: 'Préférence (si possible)',
}
const FORCE_OPTIONS = ['desactivee', 'jamais', 'sauf_crise', 'evitee', 'si_possible']

/** Les 3 formes de règle proposées au formulaire (2 briques). */
type TypeRegleForm = 'au_moins_un' | 'pas_seuls' | 'role_interdit'

const TYPE_REGLE_LABELS: Record<TypeRegleForm, string> = {
  au_moins_un: 'Toujours au moins un vétérinaire avec cette étiquette',
  pas_seuls: 'Les vétérinaires avec cette étiquette ne sont jamais seuls',
  role_interdit: 'Les vétérinaires avec cette étiquette ne tiennent jamais un rôle',
}

const ROLE_LABELS: Record<string, string> = { premier: '1er', second: '2nd' }
const roleLisible = (r: string) => ROLE_LABELS[r] ?? r

export function CompositionEquipeClient({
  regles, typesCreneaux, tagsEquipe, rolesCabinet, isAdmin,
}: CompositionEquipeClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOuvert, setDialogOuvert] = useState(false)

  // ── Formulaire d'ajout ──
  const [typeRegle, setTypeRegle] = useState<TypeRegleForm>('au_moins_un')
  const [tag, setTag] = useState('')
  const [role, setRole] = useState(rolesCabinet[0] ?? 'premier')
  const [creneauxSel, setCreneauxSel] = useState<string[]>([])
  const [force, setForce] = useState('jamais')

  const resetForm = () => {
    setTypeRegle('au_moins_un'); setTag(''); setRole(rolesCabinet[0] ?? 'premier')
    setCreneauxSel([]); setForce('jamais')
  }

  const phrase = (r: RegleEquipeUI) =>
    rendreRegle(r.brique, {
      mode: r.mode, tag: r.tag, role: r.role,
      creneaux: r.creneaux.length > 0 ? r.creneaux : undefined,
    })

  /** Réécrit une règle existante avec une nouvelle force (via la bonne action). */
  const reecrire = async (r: RegleEquipeUI, nouvelleForce: ForceFormulaire) => {
    if (r.brique === 'role_interdit_tag') {
      const payload: RoleInterditReglePayload = {
        id: r.id, tag: r.tag, role: r.role ?? 'premier',
        creneaux: r.creneaux, force: nouvelleForce,
      }
      return upsertRoleInterditRegle(payload)
    }
    const payload: CompositionReglePayload = {
      id: r.id, mode: r.mode ?? 'au_moins_un', tag: r.tag,
      creneaux: r.creneaux, force: nouvelleForce,
    }
    return upsertCompositionRegle(payload)
  }

  const changerForce = (r: RegleEquipeUI, choix: string) => {
    startTransition(async () => {
      // « Désactivée » → toggle actif=false (la force est conservée en base) ;
      // sinon réactive si besoin + applique la force choisie.
      if (choix === 'desactivee') {
        const res = await setRegleActif(r.id, false)
        if (res?.error) toast.error(res.error)
        else { toast.success('Règle désactivée.'); router.refresh() }
        return
      }
      const res = await reecrire(r, choix as ForceFormulaire)
      if (res?.error) { toast.error(res.error); return }
      if (!r.actif) await setRegleActif(r.id, true)
      toast.success('Réglage enregistré — appliqué à la prochaine génération.')
      router.refresh()
    })
  }

  const supprimer = (r: RegleEquipeUI) => {
    startTransition(async () => {
      const res = await deleteRegle(r.id)
      if (res?.error) toast.error(res.error)
      else { toast.success('Règle supprimée.'); router.refresh() }
    })
  }

  const creer = () => {
    startTransition(async () => {
      const res = typeRegle === 'role_interdit'
        ? await upsertRoleInterditRegle({
            tag, role, creneaux: creneauxSel, force: force as ForceFormulaire,
          })
        : await upsertCompositionRegle({
            mode: typeRegle, tag, creneaux: creneauxSel, force: force as ForceFormulaire,
          })
      if (res?.error) { toast.error(res.error); return }
      toast.success('Règle d’équipe créée — appliquée à la prochaine génération.')
      setDialogOuvert(false)
      resetForm()
      router.refresh()
    })
  }

  const basculerCreneau = (code: string) => {
    setCreneauxSel((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  return (
    <section className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Composition d&apos;équipe
          </h2>
          <p className="text-muted-foreground text-sm mt-1 leading-5">
            Des règles basées sur les <strong>étiquettes</strong> de l&apos;équipe
            (junior, senior…) : « au moins un senior par week-end », « un junior
            jamais seul », « un junior jamais 1er ». Les étiquettes se posent sur
            les fiches de la page Équipe.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setDialogOuvert(true)} disabled={isPending}>
            <Plus className="w-4 h-4 mr-1" /> Ajouter
          </Button>
        )}
      </div>

      {regles.length === 0 ? (
        <p className="text-sm text-muted-foreground p-3.5 rounded-lg border border-dashed border-border">
          Aucune règle d&apos;équipe pour l&apos;instant.
        </p>
      ) : (
        <div className="space-y-2">
          {regles.map((r) => {
            const courant = r.actif ? r.force : 'desactivee'
            return (
              <div
                key={r.id}
                data-regle-cible={r.id}
                className="flex items-center gap-3 p-3.5 rounded-lg border border-border bg-card"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{phrase(r)}</p>
                  <p className="text-xs text-muted-foreground leading-5">
                    Étiquette « {r.tag} »
                    {r.role ? ` — rôle : ${roleLisible(r.role)}` : ''}
                    {r.creneaux.length > 0
                      ? ` — créneaux : ${r.creneaux
                          .map((c) => typesCreneaux.find((t) => t.code === c)?.nom ?? c)
                          .join(', ')}`
                      : ' — tous les créneaux'}
                  </p>
                </div>
                {isAdmin ? (
                  <>
                    <Select value={courant} onValueChange={(v) => v && changerForce(r, v)} disabled={isPending}>
                      <SelectTrigger className="w-52 shrink-0">{FORCE_LABELS[courant] ?? courant}</SelectTrigger>
                      <SelectContent>
                        {FORCE_OPTIONS.map((f) => (
                          <SelectItem key={f} value={f}>{FORCE_LABELS[f]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => supprimer(r)} disabled={isPending} aria-label="Supprimer la règle"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground shrink-0 w-52 text-right">
                    {FORCE_LABELS[courant] ?? courant}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Dialog d'ajout ── */}
      <Dialog open={dialogOuvert} onOpenChange={(o) => { if (!o) { setDialogOuvert(false); resetForm() } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Nouvelle règle d&apos;équipe</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Type de règle</Label>
              <Select value={typeRegle} onValueChange={(v) => v && setTypeRegle(v as TypeRegleForm)}>
                <SelectTrigger className="w-full">{TYPE_REGLE_LABELS[typeRegle]}</SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_REGLE_LABELS) as TypeRegleForm[]).map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_REGLE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="compo-tag">Étiquette</Label>
              <Input
                id="compo-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder={typeRegle === 'au_moins_un' ? 'senior' : 'junior'}
              />
              {tagsEquipe.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {tagsEquipe.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTag(t)}
                      className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                        tag.trim().toLowerCase() === t
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:border-primary'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                L&apos;étiquette doit être posée sur au moins un vétérinaire (page Équipe).
              </p>
            </div>

            {typeRegle === 'role_interdit' && (
              <div className="space-y-1.5">
                <Label>Rôle interdit</Label>
                <Select value={role} onValueChange={(v) => v && setRole(v)}>
                  <SelectTrigger className="w-full">{roleLisible(role)}</SelectTrigger>
                  <SelectContent>
                    {rolesCabinet.map((r) => (
                      <SelectItem key={r} value={r}>{roleLisible(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Créneaux concernés</Label>
              <div className="flex flex-wrap gap-1.5">
                {typesCreneaux.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => basculerCreneau(t.code)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      creneauxSel.includes(t.code)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:border-primary'
                    }`}
                  >
                    {t.nom}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Aucun sélectionné = la règle s&apos;applique à tous les créneaux.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Importance</Label>
              <Select value={force} onValueChange={(v) => v && setForce(v)}>
                <SelectTrigger className="w-full">{FORCE_LABELS[force]}</SelectTrigger>
                <SelectContent>
                  {['jamais', 'sauf_crise', 'evitee', 'si_possible'].map((f) => (
                    <SelectItem key={f} value={f}>{FORCE_LABELS[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                « Ferme » bloque la génération si la règle ne peut pas être respectée ;
                les autres niveaux sont des préférences.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOuvert(false); resetForm() }} disabled={isPending}>
              Annuler
            </Button>
            <Button onClick={creer} disabled={isPending || tag.trim() === ''}>
              {isPending ? 'Création…' : 'Créer la règle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
