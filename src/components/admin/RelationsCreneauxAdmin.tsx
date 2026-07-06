'use client'

// ============================================================
// GUARDVETO — Liaisons entre créneaux (ex R8/R9), version ADMIN (RG4)
// ============================================================
// Depuis RG2/RG3, le moteur ET le validateur appliquent les relations EN
// DONNÉE (`relation_creneau`). Ce composant les rend visibles et éditables :
//   • lire les liaisons du profil (« vendredi → week-end : même équipe ») ;
//   • en créer entre n'importe quels créneaux du profil (sur-mesure compris) ;
//   • désactiver (le moteur l'ignore, réversible) ou supprimer.
// Le véto non-admin voit la liste en lecture seule.
//
// Le NIVEAU (ferme / souple) se règle par genre sur /regles (briques R8/R9).
// ============================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Link2, Plus, Trash2, Power, Loader2, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  creerRelationCreneau,
  setRelationActive,
  supprimerRelation,
} from '@/app/(protected)/admin/structure/actions'

export interface RelationLigneUI {
  id: string
  profilId: string
  sourceNom: string
  cibleNom: string
  genre: 'meme_binome' | 'inversion_role'
  actif: boolean
}

export interface CreneauOptionUI {
  id: string
  nom: string
  profilId: string
  actif: boolean
}

interface ProfilOption {
  id: string
  nom: string
  est_defaut: boolean
}

/** Libellés « en clair » des genres (le vocabulaire du moteur reste en donnée). */
const GENRE_CLAIR: Record<RelationLigneUI['genre'], string> = {
  meme_binome: 'même équipe',
  inversion_role: 'rôles différents',
}

export function RelationsCreneauxAdmin({
  profils,
  relations,
  creneaux,
  isAdmin,
}: {
  profils: ProfilOption[]
  relations: RelationLigneUI[]
  creneaux: CreneauOptionUI[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [formOuvert, setFormOuvert] = useState(false)

  const profilDefaut = profils.find((p) => p.est_defaut) ?? profils[0]
  const [profilId, setProfilId] = useState<string>(profilDefaut?.id ?? '')
  const [sourceId, setSourceId] = useState('')
  const [cibleId, setCibleId] = useState('')
  const [genre, setGenre] = useState<RelationLigneUI['genre']>('meme_binome')

  const relationsProfil = relations.filter((r) => r.profilId === profilId)
  const creneauxProfil = creneaux.filter((c) => c.profilId === profilId)

  function changerProfil(id: string) {
    setProfilId(id)
    setSourceId('')
    setCibleId('')
  }

  function creer() {
    startTransition(async () => {
      const res = await creerRelationCreneau({
        profil_id: profilId,
        source_id: sourceId,
        cible_id: cibleId,
        genre,
      })
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Liaison créée — elle s’applique dès la prochaine génération.')
      setFormOuvert(false)
      setSourceId('')
      setCibleId('')
      router.refresh()
    })
  }

  function basculerActif(r: RelationLigneUI) {
    startTransition(async () => {
      const res = await setRelationActive(r.id, !r.actif)
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(r.actif
        ? 'Liaison désactivée — le moteur ne l’appliquera plus.'
        : 'Liaison réactivée.')
      router.refresh()
    })
  }

  function supprimer(r: RelationLigneUI) {
    if (!window.confirm(
      `Supprimer la liaison « ${r.sourceNom} → ${r.cibleNom} : ${GENRE_CLAIR[r.genre]} » ? `
      + 'Les plannings déjà générés ne sont pas modifiés.',
    )) return
    startTransition(async () => {
      const res = await supprimerRelation(r.id)
      if (res && 'error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Liaison supprimée.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {profils.length > 1 && (
        <label className="block text-sm space-y-1.5 max-w-xs">
          <span className="font-medium">Profil</span>
          <select
            value={profilId}
            onChange={(e) => changerProfil(e.target.value)}
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

      {relationsProfil.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune liaison entre créneaux pour ce profil : chaque type de garde est
          attribué indépendamment des autres.
        </p>
      ) : (
        <div className="space-y-2">
          {relationsProfil.map((r) => (
            <div
              key={r.id}
              className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 text-sm ${
                r.actif ? '' : 'opacity-60'
              }`}
            >
              <Link2 className="w-4 h-4 text-primary shrink-0" />
              <span className="font-medium">{r.sourceNom}</span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">{r.cibleNom}</span>
              <Badge variant="secondary" className="font-normal">
                {GENRE_CLAIR[r.genre]}
              </Badge>
              {!r.actif && <Badge variant="outline" className="font-normal">Inactive</Badge>}
              {isAdmin && (
                <span className="ml-auto flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => basculerActif(r)}
                  >
                    <Power className="w-3.5 h-3.5 mr-1.5" />
                    {r.actif ? 'Désactiver' : 'Activer'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                    onClick={() => supprimer(r)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Supprimer
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Création d'une liaison (admin) ── */}
      {isAdmin && (!formOuvert ? (
        <Button variant="outline" onClick={() => setFormOuvert(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Lier deux créneaux
        </Button>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouvelle liaison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="space-y-1.5 block">
                <span className="font-medium">Premier créneau</span>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                >
                  <option value="">Choisir…</option>
                  {creneauxProfil.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}{c.actif ? '' : ' (inactif)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 block">
                <span className="font-medium">Règle</span>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value as RelationLigneUI['genre'])}
                  className="w-full rounded-md border bg-background px-3 py-2"
                >
                  <option value="meme_binome">même équipe sur les deux</option>
                  <option value="inversion_role">rôles différents entre les deux</option>
                </select>
              </label>
              <label className="space-y-1.5 block">
                <span className="font-medium">Second créneau</span>
                <select
                  value={cibleId}
                  onChange={(e) => setCibleId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2"
                >
                  <option value="">Choisir…</option>
                  {creneauxProfil
                    .filter((c) => c.id !== sourceId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom}{c.actif ? '' : ' (inactif)'}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <div className="flex gap-2">
              <Button onClick={creer} disabled={pending || !sourceId || !cibleId}>
                {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                Créer la liaison
              </Button>
              <Button variant="outline" onClick={() => setFormOuvert(false)} disabled={pending}>
                Annuler
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-5">
              Le moteur relie chaque garde du second créneau à la garde du premier créneau
              qui la précède immédiatement (dans les 7 jours). « Même équipe » : les mêmes
              vétérinaires assurent les deux gardes. « Rôles différents » : un vétérinaire
              présent sur les deux gardes doit y changer de rôle (ex. 1er puis 2nd).
              Le niveau de ces règles (ferme ou préférence) se règle dans{' '}
              <a href="/regles" className="underline hover:text-foreground">Règles du planning</a>.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
