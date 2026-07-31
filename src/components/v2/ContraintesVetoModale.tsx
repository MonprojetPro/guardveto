'use client'

// ============================================================
// GUARDVETO V2 — « Ses contraintes », depuis la fiche d'un véto
// ============================================================
// Remplace la section `ContraintesSection` (V1) qui se dépliait sous la carte.
//
// Elle avait DEUX défauts, dont un invisible et grave :
//
//  · le look — composants shadcn V1 posés en ligne dans une carte V2, donc gris
//    ardoise et poubelle rouge vif au milieu du terrier ;
//  · la donnée — elle lisait `contraintes_veto`, table que le moteur n'utilise
//    PLUS depuis P1A-004 (cf. `engine/loader.ts` : « remplace le join
//    contraintes_veto »). Elle affichait donc une copie figée, et son crayon
//    écrivait dans le vide. Deux règles réellement appliquées par le moteur
//    n'apparaissaient nulle part.
//
// Cet écran lit `regles_cabinet` — LA source du moteur — filtrée sur le véto.
// Ce n'est pas une seconde liste de règles : c'est une VUE de l'écran Règles.
// D'où la réutilisation intégrale de `RegleFormDialog`, de `phraseRegle` et des
// actions serveur `setRegleActif` / `deleteRegle`. Rien n'est réécrit ici sauf
// la mise en forme.
// ============================================================

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { phraseRegle, reglesDuVeto, etageDe, symboleDe, motForce, aideForce } from '@/lib/regles/libelle'
import '@/styles/regles-forces.css'
import { setRegleActif, deleteRegle } from '@/app/(protected)/regles/actions'
import {
  RegleFormDialog,
} from '@/components/regles/RegleFormDialog'
import {
  BRIQUES_EDITABLES,
  type RegleRow,
  type PeriodeOption,
  type TypeCreneauOption,
  type VetoMini,
} from '@/components/regles/ReglesClient'

interface Props {
  /** La fiche depuis laquelle on a ouvert : sujet de toutes ces règles. */
  veto: VetoMini
  /** TOUTES les règles du cabinet — le filtrage par véto se fait ici. */
  regles: RegleRow[]
  vets: VetoMini[]
  periodes: PeriodeOption[]
  typesCreneaux: TypeCreneauOption[]
  onClose: () => void
}

export function ContraintesVetoModale({
  veto, regles, vets, periodes, typesCreneaux, onClose,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [aSupprimer, setASupprimer] = useState<RegleRow | null>(null)
  const [formOuvert, setFormOuvert] = useState(false)
  const [aEditer, setAEditer] = useState<RegleRow | null>(null)

  const nomVeto = (id: string) => vets.find((v) => v.id === id)?.prenom ?? id

  // Les siennes, duos dédoublonnés et tournées de son point de vue.
  // Tri : le plus contraignant d'abord, puis les désactivées en fin de liste.
  const siennes = useMemo(() => {
    return reglesDuVeto(regles, veto.id).sort(
      (a, b) =>
        Number(b.actif) - Number(a.actif) ||
        etageDe(a.force) - etageDe(b.force) ||
        a.brique_id.localeCompare(b.brique_id),
    )
  }, [regles, veto.id])

  const actives = siennes.filter((r) => r.actif).length

  const ouvrirCreation = () => {
    setAEditer(null)
    setFormOuvert(true)
  }

  const ouvrirEdition = (regle: RegleRow) => {
    if (!BRIQUES_EDITABLES.has(regle.brique_id)) {
      toast.info("Ce type de règle ne s'édite pas encore depuis le formulaire.")
      return
    }
    setAEditer(regle)
    setFormOuvert(true)
  }

  const basculer = (regle: RegleRow) => {
    startTransition(async () => {
      const res = await setRegleActif(regle.id, !regle.actif)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        regle.actif
          ? 'Contrainte mise en pause — le moteur ne la lira plus.'
          : 'Contrainte réactivée.',
      )
      router.refresh()
    })
  }

  const supprimer = () => {
    if (!aSupprimer) return
    const cible = aSupprimer
    startTransition(async () => {
      const res = await deleteRegle(cible.id)
      if (res?.error) {
        toast.error(res.error)
        return
      }
      toast.success('Contrainte supprimée.')
      setASupprimer(null)
      router.refresh()
    })
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o && !isPending) onClose() }}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle className="cv-titre">
              <span className="cv-avatar" style={{ background: veto.couleur ?? '#C7530F' }} aria-hidden="true">
                {veto.prenom.charAt(0).toUpperCase()}
              </span>
              Les contraintes de {veto.prenom}
            </DialogTitle>
            <DialogDescription>
              {actives === 0
                ? "Aucune contrainte active : le moteur peut la placer partout où la structure l'autorise."
                : `${actives} contrainte${actives > 1 ? 's' : ''} que le moteur respecte à chaque génération.`}
            </DialogDescription>
          </DialogHeader>

          {siennes.length === 0 ? (
            <p className="cv-vide">
              Rien de particulier pour {veto.prenom}. Une contrainte, c&apos;est un jour de
              repos fixe, une indisponibilité qui revient, ou une personne avec qui elle ou
              il ne doit pas se retrouver seul.
            </p>
          ) : (
            <ul className="cv-liste">
              {siennes.map((r) => {
                const partagee = r.brique_id === 'duo_interdit'
                return (
                  <li key={r.id} className={`cv-item${r.actif ? '' : ' en-pause'} force-${r.force}`}>
                    {/* Le bandeau : ce que le moteur s'autorise, et les
                        étiquettes de contexte. Les actions partagent cette
                        ligne — elles étaient empilées à droite en colonne, ce
                        qui laissait la moitié de la largeur vide. */}
                    <div className="cv-item-tete">
                      <span className="force-badge">
                        <span aria-hidden="true">{symboleDe(r.force)}</span> {motForce(r.force)}
                      </span>
                      {partagee && <span className="cv-tag">à deux</span>}
                      {!r.actif && <span className="cv-tag">en pause</span>}

                      <span className="cv-item-actions">
                        {r.actif && (
                          <button type="button" onClick={() => ouvrirEdition(r)} disabled={isPending}>
                            Modifier
                          </button>
                        )}
                        <button type="button" onClick={() => basculer(r)} disabled={isPending}>
                          {r.actif ? 'Mettre en pause' : 'Réactiver'}
                        </button>
                        <button
                          type="button"
                          className="cv-danger"
                          onClick={() => setASupprimer(r)}
                          disabled={isPending}
                        >
                          Retirer
                        </button>
                      </span>
                    </div>

                    <p className="cv-phrase">{phraseRegle(r, nomVeto)}</p>

                    {/* Ce que « 🔴 Jamais » veut dire concrètement. Sans cette
                        phrase, la carte montrait une pastille de couleur et un
                        bouton rouge — MiKL : « c'est pas assez parlant ». */}
                    <p className="cv-effet">
                      {r.actif
                        ? aideForce(r.force)
                        : "En pause : le moteur ne la lit plus du tout, comme si elle n'existait pas."}
                    </p>

                    {partagee && (
                      <p className="cv-effet">
                        Cette contrainte lie deux personnes : elle apparaît aussi sur l&apos;autre
                        fiche, et la retirer la retire des deux côtés.
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <DialogFooter className="cv-pied">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Fermer
            </Button>
            <Button onClick={ouvrirCreation} disabled={isPending}>
              + Ajouter une contrainte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation avant de retirer — le geste est définitif, et il change
          ce que le moteur produira à la prochaine génération. */}
      <Dialog open={Boolean(aSupprimer)} onOpenChange={(o) => { if (!o && !isPending) setASupprimer(null) }}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle>Retirer cette contrainte ?</DialogTitle>
            <DialogDescription>
              C&apos;est définitif. Dès la prochaine génération, le moteur ne s&apos;interdira
              plus rien de ce côté-là. Pour la suspendre sans la perdre, préfère
              « Mettre en pause ».
            </DialogDescription>
          </DialogHeader>
          {aSupprimer && (
            <p className="cv-rappel">
              <span aria-hidden="true">{symboleDe(aSupprimer.force)}</span>{' '}
              {phraseRegle(aSupprimer, nomVeto)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setASupprimer(null)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={supprimer} disabled={isPending}>
              {isPending ? 'Un instant…' : 'Retirer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Le formulaire de l'écran Règles, tel quel — avec le véto de la fiche
          pré-sélectionné en création. Monté seulement à l'ouverture : son état
          initial se recalcule à chaque fois (règle éditée ≠ règle précédente). */}
      {formOuvert && (
        <RegleFormDialog
          open
          onClose={() => setFormOuvert(false)}
          vets={vets}
          periodes={periodes}
          typesCreneaux={typesCreneaux}
          regle={aEditer}
          ownerParDefaut={veto.id}
        />
      )}
    </>
  )
}
