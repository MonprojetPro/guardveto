'use client'

// ============================================================
// GUARDVETO V2 — La modale des refus BLOQUANTS de l'Organisation
// ============================================================
// POURQUOI CE FICHIER EXISTE
//
// Un refus serveur arrivait ici en `toast.error` : une vignette de la taille
// d'une carte de visite, en bas à droite, qui s'efface toute seule au bout de
// quelques secondes. C'est le bon format pour « Réglage enregistré » — c'est le
// pire pour « ta règle n'a pas été créée », au moment précis où l'on vient de
// remplir un panneau entier. MiKL, en recette : « le message en pop-up
// minuscule en bas c'est nul, mets en place de vraies pop-ups qui avertissent
// vraiment et qui expliquent, limite y aurait un CTA pour aller au bon
// endroit ».
//
// Donc : les SUCCÈS restent des toasts (les transformer en modales obligerait à
// cliquer après chaque réglage), les REFUS deviennent une modale qui dit trois
// choses — ce qui s'est passé, POURQUOI, et où aller pour le régler.
//
// CE QUI EST ICI, ET CE QUI EST AILLEURS
//
// Ce fichier ne fait que RENDRE la modale. La traduction d'un message serveur
// en titre + explication + porte de sortie vit dans `lib/regles/refus.ts` :
// c'est de la logique pure, donc testable — et le test vérifie qu'aucun message
// de `regles/actions.ts` n'a glissé hors de ses motifs.
//
// Le texte serveur n'est jamais réécrit : il est repris mot pour mot en tête de
// la modale. Le décodeur AJOUTE une explication en dessous, il ne remplace pas.
// ============================================================

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { decoderRefus } from '@/lib/regles/refus'

/** Une porte de sortie proposée dans le pied de la modale. */
export interface CtaErreur {
  label: string
  /** Navigation interne (`/equipe`…). Exclusif avec `onClick`. */
  href?: string
  /** Action locale (rouvrir un panneau, corriger un champ…). */
  onClick?: () => void
}

export interface ContenuErreur {
  /** Titre de la modale — ce qui n'a PAS eu lieu, pas « Erreur ». */
  titre: string
  /** Le message brut du serveur, repris tel quel. */
  message: string
  /** Ce que ça veut dire, en français, et ce qu'il faut faire. */
  explication?: string
  cta?: CtaErreur
}

/** Ce que l'appelant peut imposer par-dessus le décodeur. */
export type OptionsErreur = Partial<Omit<ContenuErreur, 'message'>>

/** Ce qu'une action serveur peut répondre à cet écran. `regleExistante` est
 *  l'identifiant de la règle qui fait doublon : il transforme « retrouve-la
 *  dans la liste » en un bouton qui y emmène. */
export interface ReponseAction {
  error?: string
  success?: boolean
  regleExistante?: string
}

// ── Du décodage au contenu affichable ───────────────────────

/** Habille le refus décodé : le message brut en tête, l'action en bouton. */
function contenuDepuis(
  message: string,
  aller: (href: string) => void,
): ContenuErreur {
  const { titre, explication, action } = decoderRefus(message)
  const cta: CtaErreur | undefined =
    action?.genre === 'aller'
      ? { label: action.label, onClick: () => aller(action.href) }
      : action?.genre === 'recharger'
        ? { label: action.label, onClick: () => window.location.reload() }
        : undefined
  return { titre, message, explication, cta }
}

// ── Le hook ─────────────────────────────────────────────────

/**
 * Rend une modale d'erreur et son ouvreur.
 *
 *   const { ouvrirErreur, dialogueErreur } = useErreurBloquante()
 *   if (res?.error) { ouvrirErreur(res.error); return }
 *   …
 *   return (<>{…}{dialogueErreur}</>)
 *
 * `ouvrirErreur` est stable (useCallback sans dépendance d'état) : on peut donc
 * l'employer dans un `useEffect` sans relancer l'effet à chaque rendu.
 */
export function useErreurBloquante(options?: {
  /**
   * Appelé juste avant qu'un bouton de la modale n'emmène ailleurs. Sert à
   * refermer le panneau ou le formulaire qui a déclenché le refus : il est
   * rendu PAR-DESSUS l'écran, et une navigation ne le démonte pas (on reste
   * sur la même route, seul un paramètre change). Sans ça, on arrive bien sur
   * la règle visée — mais derrière un formulaire qui masque tout.
   */
  avantDeQuitter?: () => void
}) {
  const router = useRouter()
  const [contenu, setContenu] = useState<ContenuErreur | null>(null)
  const avantDeQuitter = options?.avantDeQuitter

  const aller = useCallback((href: string) => router.push(href), [router])

  const ouvrirErreur = useCallback(
    (message: string, options?: OptionsErreur) => {
      setContenu({ ...contenuDepuis(message, aller), ...options })
    },
    [aller],
  )

  /**
   * Le refus + la règle qui le provoque, en un seul geste.
   *
   * « Une règle identique existe déjà » sans moyen d'aller la voir, c'est une
   * impasse polie : on ferme, on cherche dans une liste de vingt lignes, et on
   * ne sait pas laquelle. Le serveur connaît son identifiant — l'ancre
   * `?focus=` de l'écran fait le reste (défilement + halo, le même mécanisme
   * que le diagnostic d'impasse).
   */
  const ouvrirRefus = useCallback(
    (res: ReponseAction, options?: OptionsErreur) => {
      if (!res.error) return
      ouvrirErreur(res.error, {
        ...(res.regleExistante
          ? {
              cta: {
                label: 'Voir la règle existante',
                onClick: () => aller(`/regles?focus=${encodeURIComponent(res.regleExistante!)}`),
              },
            }
          : {}),
        ...options,
      })
    },
    [ouvrirErreur, aller],
  )

  const fermer = () => setContenu(null)

  const dialogueErreur = (
    <Dialog open={Boolean(contenu)} onOpenChange={(o) => { if (!o) fermer() }}>
      <DialogContent className="gv-modale gv-modale-erreur">
        <DialogHeader>
          <DialogTitle>
            <AlertTriangle size={18} aria-hidden="true" />
            {contenu?.titre}
          </DialogTitle>
          <DialogDescription>{contenu?.message}</DialogDescription>
        </DialogHeader>

        {contenu?.explication && <p className="gv-explication">{contenu.explication}</p>}

        <DialogFooter>
          {/* Le bouton neutre dit ce qu'il FAIT, pas où l'on est. « Rester ici »
              (première version) décrivait une position, pas une action : on ne
              savait pas si ça fermait, si ça enregistrait, ni ce qu'on gardait.
              MiKL, en recette : « c'est pas ouf comme mots pour faire comprendre
              à l'utilisateur ». « Corriger ma saisie » dit la suite du geste —
              le panneau est toujours là derrière, avec ce qu'on avait tapé. */}
          <Button variant="outline" onClick={fermer}>
            {contenu?.cta ? 'Corriger ma saisie' : 'J’ai compris'}
          </Button>
          {contenu?.cta && (
            <Button
              onClick={() => {
                const { cta } = contenu
                fermer()
                // Le panneau qui a déclenché le refus doit se fermer AVANT la
                // navigation : sans ça on arrive bien sur la règle visée, mais
                // le formulaire reste ouvert par-dessus et masque tout — on
                // voit qu'on est arrivé quelque part sans pouvoir rien y faire.
                avantDeQuitter?.()
                if (cta?.onClick) cta.onClick()
                else if (cta?.href) aller(cta.href)
              }}
            >
              {contenu.cta.label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { ouvrirErreur, ouvrirRefus, dialogueErreur }
}
