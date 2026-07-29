'use client'

// ============================================================
// GUARDVETO — Catalogue des types de garde, version ADMIN (P3b)
// ============================================================
// Depuis P3b, le moteur planifie TOUT créneau du catalogue. Ce composant
// donne enfin la main à l'admin :
//   • créer un créneau SUR-MESURE (garde de jour, samedi seul…) ;
//   • activer / désactiver un créneau (seed compris — c'est ainsi qu'on
//     remplace le week-end atomique par samedi + dimanche séparés) ;
//   • supprimer un créneau sur-mesure (les 4 de base sont intangibles).
// Le véto non-admin voit la vue lecture (CatalogueCreneauxView).
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays, Users, Plus, Trash2, Power, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { CatalogueTypeUI } from '@/components/admin/CatalogueCreneauxView'
import {
  creerCreneauSurMesure,
  setCreneauActif,
  supprimerCreneauSurMesure,
} from '@/app/(protected)/admin/structure/actions'

/** Carte catalogue enrichie des infos d'administration. */
export interface CatalogueTypeAdminUI extends CatalogueTypeUI {
  /** Les 4 créneaux du seed : désactivables mais pas supprimables. */
  estSeed: boolean
}

interface ProfilOption {
  id: string
  nom: string
  est_defaut: boolean
}

const JOURS = [
  { idx: 1, label: 'Lun' }, { idx: 2, label: 'Mar' }, { idx: 3, label: 'Mer' },
  { idx: 4, label: 'Jeu' }, { idx: 5, label: 'Ven' }, { idx: 6, label: 'Sam' },
  { idx: 0, label: 'Dim' },
]

const ROLES_AUTO = ['premier', 'second', 'troisieme', 'quatrieme']

export function CatalogueCreneauxAdmin({
  types,
  profils,
}: {
  types: CatalogueTypeAdminUI[]
  profils: ProfilOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [formOuvert, setFormOuvert] = useState(false)

  // ── Champs du formulaire de création ──
  const profilDefaut = profils.find((p) => p.est_defaut) ?? profils[0]
  const [nom, setNom] = useState('')
  const [profilId, setProfilId] = useState<string>(profilDefaut?.id ?? '')
  const [jours, setJours] = useState<number[]>([])
  const [heureDebut, setHeureDebut] = useState('08:30')
  const [heureFin, setHeureFin] = useState('18:30')
  const [offset, setOffset] = useState(0)
  const [nbPlaces, setNbPlaces] = useState(1)

  function toggleJour(idx: number) {
    setJours((prev) => (prev.includes(idx) ? prev.filter((j) => j !== idx) : [...prev, idx]))
  }

  function creer() {
    startTransition(async () => {
      const res = await creerCreneauSurMesure({
        profil_id: profilId,
        nom,
        jours_semaine: jours,
        heure_debut: heureDebut,
        heure_fin: heureFin,
        offset_jours_fin: offset,
        nb_places: nbPlaces,
        roles: ROLES_AUTO.slice(0, nbPlaces),
      })
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Créneau « ${nom.trim()} » créé — il sera planifié à la prochaine génération.`)
      setFormOuvert(false)
      setNom('')
      setJours([])
      setNbPlaces(1)
      router.refresh()
    })
  }

  function basculerActif(t: CatalogueTypeAdminUI) {
    startTransition(async () => {
      const res = await setCreneauActif(t.id, !t.actif)
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(t.actif
        ? `« ${t.nom} » désactivé — il ne sera plus planifié.`
        : `« ${t.nom} » réactivé.`)
      router.refresh()
    })
  }

  function supprimer(t: CatalogueTypeAdminUI) {
    if (!window.confirm(`Supprimer le créneau « ${t.nom} » ? Les plannings déjà générés ne sont pas modifiés.`)) return
    startTransition(async () => {
      const res = await supprimerCreneauSurMesure(t.id)
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Créneau « ${t.nom} » supprimé.`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {types.map((t) => (
          <Card key={t.id} className={t.actif ? undefined : 'opacity-60'}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{t.nom}</span>
                {!t.estSeed && (
                  <Badge variant="secondary" className="font-normal">Sur-mesure</Badge>
                )}
                {!t.actif && (
                  <Badge variant="outline" className="font-normal">Inactif</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex items-start gap-2">
                <CalendarDays className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>{t.jours}</span>
              </div>
              <div className="flex items-start gap-2">
                <Users className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>{t.places}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-5">{t.horaires}</p>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => basculerActif(t)}
                >
                  <Power className="w-3.5 h-3.5 mr-1.5" />
                  {t.actif ? 'Désactiver' : 'Activer'}
                </Button>
                {!t.estSeed && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                    onClick={() => supprimer(t)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Supprimer
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Création d'un créneau sur-mesure ── */}
      {!formOuvert ? (
        <Button variant="outline" onClick={() => setFormOuvert(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Ajouter un type de garde sur-mesure
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau type de garde</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 block">
                <span className="font-medium">Nom</span>
                <input
                  type="text"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder="Ex : Garde de jour, Samedi matin…"
                  maxLength={60}
                  className="w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              {profils.length > 1 && (
                <label className="space-y-1.5 block">
                  <span className="font-medium">Profil</span>
                  <select
                    value={profilId}
                    onChange={(e) => setProfilId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2"
                  >
                    {profils.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nom}{p.est_defaut ? ' (défaut)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="font-medium">Jours couverts</span>
              <div className="flex flex-wrap gap-2">
                {JOURS.map((j) => (
                  <button
                    key={j.idx}
                    type="button"
                    onClick={() => toggleJour(j.idx)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      jours.includes(j.idx)
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    {j.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <label className="space-y-1.5 block">
                <span className="font-medium">Début</span>
                <input
                  type="time"
                  value={heureDebut}
                  onChange={(e) => setHeureDebut(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-1.5 block">
                <span className="font-medium">Fin</span>
                <input
                  type="time"
                  value={heureFin}
                  onChange={(e) => setHeureFin(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-1.5 block">
                <span className="font-medium">Jour de fin</span>
                <select
                  value={offset}
                  onChange={(e) => setOffset(Number(e.target.value))}
                  className="w-full rounded-md border bg-background px-3 py-2"
                >
                  <option value={0}>Le même jour</option>
                  <option value={1}>Le lendemain</option>
                  <option value={2}>Le surlendemain</option>
                  <option value={3}>Trois jours après</option>
                </select>
              </label>
              <label className="space-y-1.5 block">
                <span className="font-medium">Vétérinaires</span>
                <select
                  value={nbPlaces}
                  onChange={(e) => setNbPlaces(Number(e.target.value))}
                  className="w-full rounded-md border bg-background px-3 py-2"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                {/* Au-delà de deux places, l'affichage, le PDF, l'agenda et
                    les compteurs suivent — mais la réattribution à la main
                    depuis le planning ne sait encore traiter que les deux
                    premières. On le dit ici plutôt que de le laisser
                    découvrir sur un planning publié. */}
                {nbPlaces > 2 && (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    À partir de 3 vétérinaires, les places suivantes se
                    modifient en régénérant le planning — pas encore une par
                    une depuis la grille.
                  </span>
                )}
              </label>
            </div>

            <div className="flex gap-2">
              <Button onClick={creer} disabled={pending || !nom.trim() || jours.length === 0}>
                {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Créer le créneau
              </Button>
              <Button variant="outline" onClick={() => setFormOuvert(false)} disabled={pending}>
                Annuler
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-5">
              Le créneau sera planifié dès la prochaine génération : un vétérinaire différent
              par place, jamais deux gardes le même jour pour un même vétérinaire, congés
              respectés, attributions réparties équitablement.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
