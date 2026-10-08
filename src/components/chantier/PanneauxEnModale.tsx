'use client'

// ============================================================
// GUARDVETO V2 — Les deux panneaux latéraux, devenus des fenêtres
// ============================================================
// B-145 lot 2c. Deux arbitrages de MiKL, rendus à six jours d'écart et qui
// disent la même chose :
//
//   06/10, sur les compteurs : « que le client puisse le consulter comme une
//   pop up afin de ne pas encombrer l'écran du planning »
//   07/10, sur les absences : « on part sur le même principe que pour le
//   compteur, une pop up qui s'ouvre si ils veulent tous les détails »
//
// La colonne de droite faisait 262 px. La libérer est ce qui rend possible
// l'accordéon du concept 3a : la marge des prénoms et sept colonnes de jour ne
// tiennent pas dans la largeur restante.
//
// 🔑 LE CONTENU N'EST PAS RÉÉCRIT. `CompteursPanel` et `AbsencesAVenirPanel`
//    sont montés tels quels. Recopier leur contenu dans une fenêtre aurait créé
//    une seconde version à maintenir — et c'est la version oubliée qui se met à
//    mentir (« trois chemins d'écriture, deux gardiens », 22/08). Seule la
//    PORTE change.
//
// ⚠️ CE QUE LE SECRÉTARIAT AURAIT PERDU SANS CETTE FENÊTRE. Son panneau était
//    sa seule réponse à « il revient quand ? » — une question de comptoir qui
//    regarde DEVANT, que la grille par jour ne couvre pas. L'arbitrage du 06/10
//    disait « on le supprime, ça sera indiqué sur le planning » ; appliqué tel
//    quel, il lui retirait une information sans la remplacer. La fenêtre la lui
//    rend, par une autre porte.
// ============================================================

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CompteursPanel } from '@/components/v2/CompteursPanel'
import { AbsencesAVenirPanel, type AbsenceAVenir } from '@/components/v2/AbsencesAVenirPanel'
import type { CompteursRow } from '@/hooks/useCompteurs'
import type { BilanVet } from '@/engine/bilan'
import type { CleColonne } from '@/lib/planning/colonnesCompteurs'

export function CompteursModale({
  ouvert,
  lignes,
  bilans,
  colonnes,
  projetees,
  onFermer,
}: {
  ouvert: boolean
  lignes: CompteursRow[]
  bilans: BilanVet[]
  colonnes: CleColonne[]
  projetees?: CompteursRow[]
  onFermer: () => void
}) {
  if (!ouvert) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFermer() }}>
      <DialogContent className="gv-modale gv-modale-large">
        <DialogHeader>
          <DialogTitle>Compteurs · période</DialogTitle>
          <DialogDescription>
            Ils bougent à chaque changement, manuel comme automatique.
          </DialogDescription>
        </DialogHeader>
        <CompteursPanel
          lignes={lignes}
          bilans={bilans}
          colonnes={colonnes}
          projetees={projetees}
        />
      </DialogContent>
    </Dialog>
  )
}

export function AbsencesModale({
  ouvert,
  absences,
  onFermer,
}: {
  ouvert: boolean
  absences: AbsenceAVenir[]
  onFermer: () => void
}) {
  if (!ouvert) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFermer() }}>
      <DialogContent className="gv-modale">
        <DialogHeader>
          <DialogTitle>Qui est absent</DialogTitle>
          {/* La question posée au téléphone n'est pas « qui manque aujourd'hui »
              — la grille y répond — mais « il revient quand ? ». La fenêtre
              regarde donc DEVANT, quel que soit le mois affiché. */}
          <DialogDescription>
            Les congés et absences à venir, pour répondre au comptoir.
          </DialogDescription>
        </DialogHeader>
        <AbsencesAVenirPanel absences={absences} />
      </DialogContent>
    </Dialog>
  )
}
