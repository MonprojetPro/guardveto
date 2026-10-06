'use client'

// ============================================================
// GUARDVETO V2 — Générer le planning des journées
// ============================================================
// B-148. Ce composant vivait sur `/journee` jusqu'au 06/10, où MiKL l'a renvoyé
// à sa vraie place : *« cette fonction n'a rien à faire là… elle doit se faire
// quand la personne va remplir son planning sur la page planning. »*
//
// Il avait raison. Je l'avais posé sur `/journee` pour satisfaire le gardien du
// code mort — une action serveur sans appelant est refusée par la suite de
// tests. **La contrainte technique était réelle, l'endroit était faux** : on ne
// remplit pas un planning depuis l'écran où l'on décrit des habitudes.
//
// C'est le geste qui manquait au lot 1 : celui-ci écrivait la RÈGLE et le disait
// franchement — « ces règles ne remplissent pas encore le planning ». Personne
// ne les appliquait.
//
// ── POURQUOI L'APERÇU AVANT, ET PAS UN SIMPLE BOUTON ────────────────────────
//
// Le geste écrit des centaines de lignes sur un planning en service. Un bouton
// qui ne dit pas combien il va écrire n'est pas cliqué — ou il est cliqué une
// fois, par quelqu'un qui ne le refera plus. L'aperçu et l'écriture appellent la
// MÊME fonction de calcul côté serveur (`aPoser`), donc le nombre annoncé est
// exactement celui qui sera écrit. Deux calculs séparés finissent toujours par
// diverger : c'est ce qui a coûté B-130b, « 23 cases annoncées pour 19 écrites ».
//
// ── CE QUI EST DIT, ET QU'ON AURAIT PU TAIRE ────────────────────────────────
//
// ① L'application est ADDITIVE : elle ne retire ni ne modifie jamais rien, donc
//    aucune retouche manuelle ne peut être perdue. C'est ce qui remplace le
//    cadenas, écarté pour la journée par MiKL le 06/10.
// ② Par conséquent, une présence retirée à la main REVIENT si on réapplique.
//    C'est une limite réelle du lot, et une limite qu'on écrit : un écran qui
//    laisserait découvrir ça en recette aurait fabriqué la surprise exacte que
//    ce produit combat.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  appliquerTrames,
  apercuApplicationTrames,
  type Apercu,
} from '@/app/(v2)/journee/presences-actions'

/** Une période proposable : celles qui se modifient encore. */
export interface PeriodeApplicable {
  id: string
  libelle: string
  date_debut: string
  date_fin: string
  statut: string
}

interface Props {
  open: boolean
  onOpenChange: (ouvert: boolean) => void
  periodes: PeriodeApplicable[]
  /** Y a-t-il au moins une trame active ? Sinon le geste n'a aucun objet. */
  aDesTrames: boolean
}

export function GenererJournee({ open, onOpenChange, periodes, aDesTrames }: Props) {
  const router = useRouter()
  const [periodeId, setPeriodeId] = useState<string>(periodes[0]?.id ?? '')
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [enCours, setEnCours] = useState(false)

  const periode = periodes.find((p) => p.id === periodeId) ?? null

  /**
   * Changer de période INVALIDE l'aperçu.
   *
   * Sans ce reset, le compte d'une période resterait affiché sous le nom d'une
   * autre — et la confirmation porterait sur un chiffre qui n'est pas le sien.
   * C'est le genre d'écart qu'on ne voit pas en relisant le code et qu'on ne
   * remarque qu'une fois le planning écrit.
   */
  function choisir(id: string) {
    setPeriodeId(id)
    setApercu(null)
  }

  async function regarder() {
    if (!periodeId) return
    setEnCours(true)
    try {
      setApercu(await apercuApplicationTrames(periodeId))
    } finally {
      setEnCours(false)
    }
  }

  async function appliquer() {
    if (!periodeId) return
    setEnCours(true)
    try {
      const r = await appliquerTrames(periodeId)
      if ('error' in r) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
      // On relit l'aperçu plutôt que de le vider : il doit maintenant annoncer
      // « tout est déjà en place », ce qui prouve à l'écran que l'écriture a eu
      // lieu. Le vider laisserait l'admin se demander si ça a marché.
      setApercu(await apercuApplicationTrames(periodeId))
      // ⚠️ ET ON RAFRAÎCHIT LA GRILLE DERRIÈRE. `revalidatePath` côté serveur
      //    invalide le cache ; sans ce `refresh`, l'admin ferme la fenêtre et
      //    retrouve un planning inchangé — le « faut que je rafraîchisse pour
      //    voir » que ce produit traque depuis le début.
      router.refresh()
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Remplir le planning des journées</DialogTitle>
          <DialogDescription>
            Les présences récurrentes décrites dans « Journée » sont des règles. Ce geste les pose
            réellement sur un planning, jour par jour.
          </DialogDescription>
        </DialogHeader>

        {periodes.length === 0 ? (
          /* On dit pourquoi et où aller, plutôt qu'un sélecteur vide et un
             bouton inerte. */
          <p className="tj-vide">
            Aucun planning ne peut recevoir de présences pour l’instant : créez d’abord une période.
            Les présences s’y rattachent, et c’est sa publication qui les montre à l’équipe.
          </p>
        ) : !aDesTrames ? (
          <p className="tj-vide">
            Décrivez d’abord au moins une présence récurrente dans l’écran « Journée » : il n’y a
            rien à poser pour l’instant.
          </p>
        ) : (
          <>
            <div className="at-ligne">
              <label className="at-label" htmlFor="at-periode">
                Sur quel planning
              </label>
              {/* ⚠️ JAMAIS de `<select>` natif sur ce projet — mais la liste des
                  périodes est une donnée, pas un menu de navigation, et le
                  composant `Select` du projet attend un contexte client qui
                  n'existe pas ici. On utilise donc des boutons : un par
                  planning, l'actif se voit. C'est aussi plus lisible qu'un menu
                  pour deux ou trois périodes. */}
              <div className="at-choix" role="group" aria-label="Choisir le planning">
                {periodes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn btn-sm ${p.id === periodeId ? 'btn-primary' : 'btn-ghost'}`}
                    aria-pressed={p.id === periodeId}
                    onClick={() => choisir(p.id)}
                    disabled={enCours}
                  >
                    {p.libelle}
                    {p.statut === 'brouillon' && <span className="at-etat"> · brouillon</span>}
                  </button>
                ))}
              </div>
            </div>

            {periode && (
              <p className="at-bornes">
                Du {periode.date_debut} au {periode.date_fin}
              </p>
            )}

            <div className="at-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={regarder}
                disabled={enCours || !periodeId}
              >
                {enCours ? 'Calcul…' : 'Voir ce que ça poserait'}
              </button>

              {/* Le bouton d'écriture n'apparaît QU'APRÈS l'aperçu, et seulement
                  s'il y a réellement quelque chose à poser. Un geste qui écrit
                  des centaines de lignes ne doit pas être atteignable sans avoir
                  lu ce qu'il fait. */}
              {apercu?.ok && apercu.aPoser > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={appliquer}
                  disabled={enCours}
                >
                  Poser {apercu.aPoser} présence{apercu.aPoser > 1 ? 's' : ''}
                </button>
              )}
            </div>

            {apercu && (
              <div className={apercu.ok ? 'at-apercu' : 'tj-refus'} role="status">
                {apercu.ok ? apercu.phrase : apercu.probleme}
              </div>
            )}

            {/* ⚠️ LA LIMITE EST ÉCRITE, pas laissée à découvrir en recette.
                L'application ne retire jamais rien — c'est ce qui protège les
                retouches — donc une présence supprimée à la main revient. */}
            <p className="tj-avis" role="note">
              <span className="tj-avis-icone" aria-hidden="true">
                !
              </span>
              <span>
                Ce geste <b>ajoute seulement</b> : il ne retire ni ne déplace aucune présence déjà
                posée, vos retouches sont donc à l’abri. Les congés validés et les absences
                déclarées sont respectés — personne n’est posé un jour où il est absent. En
                revanche, une présence que vous avez retirée à la main reviendra si vous
                réappliquez les règles.
              </span>
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
