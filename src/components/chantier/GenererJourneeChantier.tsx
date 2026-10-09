'use client'

// ============================================================
// GUARDVETO — « Remplir le planning des journées », VERSION CHANTIER (B-157b)
// ============================================================
// MiKL, recette du 09/10, capture à l'appui : *« revois-moi cette page-là, elle
// est moche de ouf et surtout pas ergonomique non plus »*.
//
// 🔴 LA CAUSE N'ÉTAIT PAS LE DESSIN — C'ÉTAIT UNE FEUILLE DE STYLE ABSENTE.
//    `GenererJournee` habille tout son contenu avec les classes `.at-*` et
//    `.tj-*`, qui vivent dans `src/styles/v2-journee.css`. Cette feuille n'est
//    importée QUE par `app/(v2)/journee/page.tsx` — et la fenêtre, elle,
//    s'ouvre depuis l'écran PLANNING, qui ne l'importe pas. Toutes ses classes
//    étaient donc sans effet : le planning choisi s'affichait en texte nu à
//    côté d'un bouton (impossible de savoir lequel était retenu), la pastille
//    d'avertissement se réduisait à un « ! » orphelin collé au texte, et rien
//    ne hiérarchisait quoi que ce soit.
//
//    ⚠️ C'est la TROISIÈME variante du même défaut en une journée : une
//    variable CSS hors de portée (B-157a), des classes sans aucune règle
//    (B-157a), et maintenant une feuille qui n'arrive pas jusqu'à l'écran.
//    Aucune des trois ne casse quoi que ce soit : `tsc`, 2184 tests et le
//    build restent verts. Elles ne se voient QUE sur l'écran.
//
//    🔴 L'ÉCRAN DU CLIENT A EXACTEMENT LE MÊME DÉFAUT AUJOURD'HUI. Il monte la
//    même fenêtre depuis la même page. Le correctif tient en une ligne (un
//    import dans `app/(v2)/planning/page.tsx`) mais il CHANGE LE RENDU CHEZ
//    VAL D'ALLIER : il n'est donc pas pris ici, il est signalé au board et
//    MiKL tranche. On ne répare pas chez le client au détour d'un chantier —
//    c'est le mécanisme de B-151, même quand l'intention est bonne.
//
// ── CE QUE CETTE VERSION CHANGE, AU-DELÀ DE L'HABILLAGE ─────────────────────
//
//  · Le planning se choisit sur des CARTES qui portent leur statut ET leurs
//    dates. L'original affichait les bornes sur une ligne isolée, sous les
//    boutons : en changeant de planning on ne savait plus de quelles dates on
//    parlait.
//  · Les dates passent en français (`periodeFr`). « Du 2026-10-19 au
//    2027-01-10 » est une écriture de base de données, pas une phrase.
//  · Le parcours est NUMÉROTÉ (choisir · regarder · poser). Les trois gestes
//    étaient au même niveau visuel, alors qu'ils sont séquentiels.
//
// ── CE QUI NE CHANGE PAS, ET NE DOIT PAS ────────────────────────────────────
//
// L'aperçu et l'écriture appellent la MÊME fonction serveur (`aPoser`) : le
// nombre annoncé est exactement celui qui sera écrit. Deux calculs séparés
// finissent toujours par diverger — c'est ce qui a coûté B-130b, « 23 cases
// annoncées pour 19 écrites ».
// Et la limite reste ÉCRITE, pas laissée à découvrir en recette : le geste
// n'enlève jamais rien, donc une présence retirée à la main revient.
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
import { periodeFr } from '@/lib/dates-fr'
import {
  appliquerTrames,
  apercuApplicationTrames,
  type Apercu,
} from '@/app/(v2)/journee/presences-actions'
import type { PeriodeApplicable } from '@/components/v2/GenererJournee'

interface Props {
  open: boolean
  onOpenChange: (ouvert: boolean) => void
  periodes: PeriodeApplicable[]
  /** Y a-t-il au moins une trame active ? Sinon le geste n'a aucun objet. */
  aDesTrames: boolean
}

/** Ce que le statut d'un planning dit, en français. */
function libelleStatut(statut: string): string {
  if (statut === 'brouillon') return 'Brouillon · pas encore diffusé'
  if (statut === 'publie') return 'Publié · l’équipe le voit'
  return statut
}

export function GenererJourneeChantier({ open, onOpenChange, periodes, aDesTrames }: Props) {
  const router = useRouter()
  const [periodeId, setPeriodeId] = useState<string>(periodes[0]?.id ?? '')
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [enCours, setEnCours] = useState(false)

  const periode = periodes.find((p) => p.id === periodeId) ?? null

  /**
   * Changer de planning INVALIDE l'aperçu.
   *
   * Sans ce reset, le compte d'une période resterait affiché sous le nom d'une
   * autre — et la confirmation porterait sur un chiffre qui n'est pas le sien.
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
      // ⚠️ ET ON RAFRAÎCHIT LA GRILLE DERRIÈRE — sans ce `refresh`, l'admin
      //    ferme la fenêtre et retrouve un planning inchangé.
      router.refresh()
    } finally {
      setEnCours(false)
    }
  }

  const peutPoser = apercu?.ok === true && apercu.aPoser > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
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
          <p className="gjc-vide">
            Aucun planning ne peut recevoir de présences pour l’instant : créez d’abord une période.
            Les présences s’y rattachent, et c’est sa publication qui les montre à l’équipe.
          </p>
        ) : !aDesTrames ? (
          <p className="gjc-vide">
            Décrivez d’abord au moins une présence récurrente dans l’écran « Journée » : il n’y a
            rien à poser pour l’instant.
          </p>
        ) : (
          <div className="gjc">
            {/* ── 1 ─────────────────────────────────────────────────────────
                ⚠️ JAMAIS de `<select>` natif sur ce projet. Des cartes plutôt
                qu'un menu : pour deux ou trois plannings elles se lisent d'un
                coup d'œil, et surtout chacune porte SES dates — l'original
                les affichait sur une ligne isolée, commune aux deux, donc en
                changeant de planning on ne savait plus de quoi on parlait. */}
            <section className="gjc-etape">
              <h3 className="gjc-titre">
                <span className="gjc-num" aria-hidden>1</span>
                Sur quel planning
              </h3>
              <div className="gjc-cartes" role="group" aria-label="Choisir le planning">
                {periodes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="gjc-carte"
                    aria-pressed={p.id === periodeId}
                    onClick={() => choisir(p.id)}
                    disabled={enCours}
                  >
                    <b>{p.libelle}</b>
                    <small>{libelleStatut(p.statut)}</small>
                    <small>{periodeFr(p.date_debut, p.date_fin)}</small>
                  </button>
                ))}
              </div>
            </section>

            {/* ── 2 ───────────────────────────────────────────────────────── */}
            <section className="gjc-etape">
              <h3 className="gjc-titre">
                <span className="gjc-num" aria-hidden>2</span>
                Regarder ce que ça poserait
              </h3>
              <button
                type="button"
                className="gjc-btn"
                onClick={regarder}
                disabled={enCours || !periodeId}
              >
                {enCours ? 'Calcul en cours…' : 'Calculer l’aperçu'}
              </button>

              {apercu && (
                <p className={apercu.ok ? 'gjc-apercu' : 'gjc-refus'} role="status">
                  {apercu.ok ? apercu.phrase : apercu.probleme}
                </p>
              )}
            </section>

            {/* ── 3 ─────────────────────────────────────────────────────────
                Le geste d'écriture n'apparaît QU'APRÈS l'aperçu, et seulement
                s'il y a réellement quelque chose à poser. Un geste qui écrit
                des centaines de lignes ne doit pas être atteignable sans avoir
                lu ce qu'il fait. */}
            {peutPoser && (
              <section className="gjc-etape">
                <h3 className="gjc-titre">
                  <span className="gjc-num" aria-hidden>3</span>
                  Poser sur le planning
                </h3>
                <button
                  type="button"
                  className="gjc-cta"
                  onClick={appliquer}
                  disabled={enCours}
                >
                  Poser {apercu.aPoser} présence{apercu.aPoser > 1 ? 's' : ''}
                  {periode ? ` sur ${periode.libelle}` : ''}
                </button>
              </section>
            )}

            {/* ⚠️ LA LIMITE EST ÉCRITE, pas laissée à découvrir en recette.
                L'application ne retire jamais rien — c'est ce qui protège les
                retouches — donc une présence supprimée à la main revient. */}
            <p className="gjc-avis">
              <span className="gjc-avis-ico" aria-hidden>!</span>
              <span>
                Ce geste <b>ajoute seulement</b> : il ne retire ni ne déplace aucune présence déjà
                posée, vos retouches sont donc à l’abri. Les congés validés et les absences
                déclarées sont respectés — personne n’est posé un jour où il est absent. En
                revanche, une présence que vous avez retirée à la main reviendra si vous
                réappliquez les règles.
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
