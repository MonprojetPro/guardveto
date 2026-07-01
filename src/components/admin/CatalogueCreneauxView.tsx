// ============================================================
// GUARDVETO — Vue LECTURE du catalogue de types de garde (P5 slice 1)
// ============================================================
// Affiche le VRAI catalogue du cabinet (table `creneau_modele`) : la source que
// le moteur consomme réellement pour générer les plannings (jours couverts,
// nombre de places / rôles, horaires). Jusqu'ici, ces informations n'étaient
// visibles NULLE PART — l'écran /admin/structure ne montrait que les horaires
// des 4 types en dur. Cette vue les révèle, en lecture seule (« la vérité du
// catalogue »). L'édition (composer/renommer/ajouter des types, N places, IA)
// viendra dans les slices suivantes.
//
// Composant PUR de présentation (pas de state, pas d'action) — rendu serveur.
// ============================================================

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CalendarDays, Users } from 'lucide-react'

/** Un type de garde du catalogue, prêt pour l'affichage. */
export interface CatalogueTypeUI {
  id: string
  nom: string
  /** Jours couverts, déjà mis en clair (« Lun, Mar, Mer, Jeu »), ou « Jours fériés ». */
  jours: string
  /** Places/rôles en clair (« 2 places : 1er, 2nd »). */
  places: string
  /** Horaires en clair (« 18:30 → 08:30, le lendemain »). */
  horaires: string
  actif: boolean
}

export function CatalogueCreneauxView({ types }: { types: CatalogueTypeUI[] }) {
  if (types.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun type de garde n&apos;est encore défini pour votre cabinet.
      </p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {types.map((t) => (
        <Card key={t.id} className={t.actif ? undefined : 'opacity-60'}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="flex-1">{t.nom}</span>
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
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
