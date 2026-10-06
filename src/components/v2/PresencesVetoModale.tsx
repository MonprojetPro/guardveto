'use client'

// ============================================================
// GUARDVETO V2 — Les présences récurrentes d'une personne, depuis sa fiche
// ============================================================
// B-149. Demande de MiKL le 06/10 : *« il faudrait également que les récurrences
// apparaissent dans l'onglet véto et où l'admin pourrait également les remplir
// là, comme pour les contraintes. »*
//
// **« également »** — donc DEUX portes sur la même donnée, pas un déménagement :
// la vue d'ensemble par équipe reste sur `/journee`, et la fiche de chaque
// personne porte les siennes.
//
// ── POURQUOI CETTE MODALE NE CONTIENT PRESQUE RIEN ──────────────────────────
//
// 🔑 Elle monte `TramesJournee` filtré sur une personne, et c'est tout. Recopier
//    le formulaire ici aurait fabriqué deux écrans qui écrivent la même table —
//    « trois chemins d'écriture, deux gardiens » (22/08), transposé à la
//    présentation. Ils auraient divergé au premier correctif, et c'est toujours
//    celui qu'on ne regarde pas qui garde le défaut.
//
// Elle reprend la forme de `ContraintesVetoModale`, voisine dans la même fiche :
// deux boutons côte à côte qui ouvrent deux fenêtres bâties pareil, c'est ce que
// MiKL voulait dire par « comme pour les contraintes ».
// ============================================================

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TramesJournee } from '@/components/v2/TramesJournee'
import type { BlocJournee, TrameJournee, Veterinaire } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (ouvert: boolean) => void
  /** La personne dont on règle les présences. */
  veto: Veterinaire
  trames: TrameJournee[]
  blocs: BlocJournee[]
}

export function PresencesVetoModale({ open, onOpenChange, veto, trames, blocs }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Les présences de {veto.prenom} {veto.nom}
          </DialogTitle>
          <DialogDescription>
            Ses journées au cabinet, telles qu’elles reviennent chaque semaine.
          </DialogDescription>
        </DialogHeader>

        {/* ⚠️ `equipe` ne porte QUE cette personne, en plus de `limiterA`. Le
            filtre est donc fait deux fois, volontairement : si un jour un appel
            oubliait `limiterA`, la modale afficherait toute l'équipe dans la
            fiche d'une seule personne — sans qu'aucun test ne rougisse. */}
        <TramesJournee
          trames={trames.filter((t) => t.veterinaire_id === veto.id)}
          blocs={blocs}
          equipe={[veto]}
          limiterA={veto.id}
        />
      </DialogContent>
    </Dialog>
  )
}
