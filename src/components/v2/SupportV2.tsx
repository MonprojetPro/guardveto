'use client'

// ============================================================
// GUARDVETO V2 — L'écran SUPPORT (B-016)
// ============================================================
// Demandé par Anne-Sophie le 2026-08-21 : signaler un bug ou proposer une
// amélioration DEPUIS l'application, capture d'écran à l'appui. Jusqu'ici les
// retours passaient par MiKL, à l'oral ou par message — ils se perdaient et
// n'étaient rattachés à rien.
//
// ── LE FICHIER NE PASSE PAS PAR LE SERVEUR, ET C'EST TOUT LE SUJET ──────────
//
// Vercel refuse une requête de plus de 4,5 Mo AVANT que la moindre ligne de
// notre code s'exécute. Une capture d'écran de téléphone pèse 2 à 10 Mo : c'est
// exactement la zone de casse, et c'est le cas d'usage principal ici. Un
// contrôle posé derrière ce plafond serait mort-né (leçon du 2026-08-18).
//
// Le navigateur téléverse donc DIRECTEMENT vers Supabase, avec la session de la
// personne connectée. La plateforme n'est plus sur le chemin du fichier ; elle
// ne reçoit ensuite que des chemins de quelques dizaines d'octets. Le plafond
// existe toujours — il ne nous concerne plus.
//
// ── CE QUI SE PASSE QUAND ÇA RATE ───────────────────────────────────────────
//
// Le dépôt du fichier et l'enregistrement de la demande sont deux gestes
// distincts. Si le second échoue, le premier a déjà eu lieu : on retire alors
// les fichiers qu'on vient de déposer, plutôt que de les abandonner dans le
// stockage. Un échec doit laisser les choses comme il les a trouvées.
//
// Refus en modale, succès en toast (règle du projet) : un refus qui s'efface
// tout seul au bout de trois secondes est un refus que personne n'a lu.
// ============================================================

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Paperclip, X, Bug, Lightbulb, Send, Check, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useErreurBloquante } from '@/components/v2/regles/ErreurBloquante'
import { deposerDemandeSupport } from '@/app/(v2)/support/actions'
import {
  ACCEPT_HTML,
  NB_PIECES_MAX,
  LONGUEUR_DESCRIPTION,
  LONGUEUR_TITRE,
  nomDeFichierSur,
  poidsLisible,
  refusDemande,
  refusFichier,
  TAILLE_MAX_OCTETS,
  type TypeDemande,
} from '@/lib/support/contraintes'
import type { LigneDemande, PieceDeposee } from '@/lib/support/types'

interface Props {
  demandes: LigneDemande[]
  /** Le cabinet de la personne connectée : il PRÉFIXE le chemin de dépôt. */
  cabinetId: string
  /** Un administrateur voit les demandes de toute l'équipe ; un vétérinaire, les siennes. */
  estAdmin: boolean
  /**
   * B-050 — pré-remplissage quand on arrive depuis un écran qui a buté (la
   * génération de planning aujourd'hui). Le contexte technique est DANS la
   * description, relisible et modifiable : un envoi silencieux ne laissait ni
   * l'un ni l'autre. Absents = formulaire vierge, comportement d'origine.
   */
  titreInitial?: string
  descriptionInitiale?: string
}

/** Ce que l'écran dit d'un statut. Les trois derniers viendront du hub MPP. */
const LIBELLE_STATUT: Record<LigneDemande['statut'], string> = {
  recue: 'Reçue',
  en_cours: 'En cours',
  traitee: 'Traitée',
  fermee: 'Fermée',
}

function dateLisible(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SupportV2({
  demandes,
  cabinetId,
  estAdmin,
  titreInitial,
  descriptionInitiale,
}: Props) {
  // Arriver depuis un blocage veut dire signaler un défaut : `bug` est le bon
  // point de départ, et il reste changeable.
  const [type, setType] = useState<TypeDemande>('bug')
  const [titre, setTitre] = useState(titreInitial ?? '')
  const [description, setDescription] = useState(descriptionInitiale ?? '')
  const [fichiers, setFichiers] = useState<File[]>([])
  const [envoi, setEnvoi] = useState<null | 'depot' | 'enregistrement'>(null)

  const champFichier = useRef<HTMLInputElement>(null)
  const { ouvrirErreur, dialogueErreur } = useErreurBloquante()

  const enCours = envoi !== null
  const blocage = useMemo(() => refusDemande({ titre, description }), [titre, description])

  // ── Le choix des fichiers ────────────────────────────────────────────────
  // Chaque fichier est jugé un par un et le refus NOMME le fichier fautif :
  // « un fichier est trop lourd » quand on en a sélectionné trois oblige à
  // recommencer à l'aveugle.
  const ajouterFichiers = (liste: FileList | null) => {
    if (!liste || liste.length === 0) return
    const candidats = Array.from(liste)

    const place = NB_PIECES_MAX - fichiers.length
    if (candidats.length > place) {
      ouvrirErreur(
        place === 0
          ? `Tu as déjà ${NB_PIECES_MAX} pièces jointes. Retire-en une pour en ajouter une autre.`
          : `Il ne reste de la place que pour ${place} pièce${place > 1 ? 's' : ''} jointe${place > 1 ? 's' : ''} — ${NB_PIECES_MAX} au maximum par demande.`,
        { titre: 'Trop de pièces jointes' },
      )
      return
    }

    for (const f of candidats) {
      const refus = refusFichier({ name: f.name, size: f.size, type: f.type })
      if (refus) {
        ouvrirErreur(refus, { titre: 'Ce fichier ne peut pas être joint' })
        return
      }
    }

    setFichiers((precedents) => [...precedents, ...candidats])
    // Le champ est remis à zéro : sans ça, re-choisir le MÊME fichier après
    // l'avoir retiré ne déclenche aucun événement, et rien ne se passe.
    if (champFichier.current) champFichier.current.value = ''
  }

  const retirerFichier = (index: number) => {
    setFichiers((precedents) => precedents.filter((_, i) => i !== index))
  }

  // ── L'envoi ──────────────────────────────────────────────────────────────
  const envoyer = async () => {
    const refus = refusDemande({ titre, description })
    if (refus) {
      ouvrirErreur(refus, { titre: 'Il manque quelque chose' })
      return
    }

    const supabase = createClient()
    const demandeId = crypto.randomUUID()
    const deposes: PieceDeposee[] = []

    setEnvoi('depot')
    try {
      // ① Les fichiers, directement chez Supabase.
      for (const [i, f] of fichiers.entries()) {
        const chemin = `${cabinetId}/${demandeId}/${i + 1}-${nomDeFichierSur(f.name)}`
        const { error } = await supabase.storage
          .from('support')
          .upload(chemin, f, { contentType: f.type, upsert: false })

        if (error) {
          // Le bucket a ses propres limites (poids, format) : c'est le gardien
          // qui compte, celui qu'on ne peut pas contourner depuis le navigateur.
          // Quand c'est LUI qui refuse, on le dit sans le traduire en panne.
          console.error('[Support] Dépôt refusé pour', chemin, error.message)
          await nettoyer(supabase, deposes)
          ouvrirErreur(
            `« ${f.name} » n’a pas pu être déposé. Vérifie qu’il s’agit bien d’une image ou d’un PDF de moins de ${poidsLisible(TAILLE_MAX_OCTETS)}, puis réessaie.`,
            { titre: 'La pièce jointe n’est pas passée' },
          )
          return
        }
        deposes.push({ chemin, nomOrigine: f.name, taille: f.size, typeMime: f.type })
      }

      // ② La demande elle-même.
      setEnvoi('enregistrement')
      const res = await deposerDemandeSupport({
        demandeId,
        type,
        titre,
        description,
        pieces: deposes,
        ecran: typeof window !== 'undefined' ? window.location.pathname : null,
        navigateur: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })

      if ('error' in res) {
        // On ne laisse pas derrière nous les fichiers d'une demande qui n'existe
        // pas : ils ne seraient rattachés à rien et personne n'irait les
        // chercher.
        await nettoyer(supabase, deposes)
        ouvrirErreur(res.error, { titre: 'Ta demande n’est pas partie' })
        return
      }

      setTitre('')
      setDescription('')
      setFichiers([])

      if (res.avertissement) {
        // Enregistrée mais pas transmise : ce n'est ni un succès net ni un
        // échec. La modale le dit, parce que c'est justement le cas qu'un toast
        // ferait disparaître avant qu'on l'ait lu.
        ouvrirErreur(res.avertissement, { titre: 'Ta demande est bien enregistrée' })
        return
      }

      toast.success('Ta demande est partie. Merci — elle est rattachée à ton cabinet.')
    } catch (e) {
      console.error('[Support] Envoi interrompu :', e)
      ouvrirErreur("L’envoi n’a pas abouti. Ta connexion a peut-être coupé — réessaie dans un instant.", {
        titre: 'L’envoi n’a pas abouti',
      })
    } finally {
      setEnvoi(null)
    }
  }

  const poidsTotal = fichiers.reduce((s, f) => s + f.size, 0)

  return (
    <>
      {dialogueErreur}

      {/* Le NOM de l'écran, et rien d'autre. Consigne MiKL du 2026-08-21,
          re-appliquée ici le 25/08 : « je ne suis pas fan de tes paragraphes,
          mets le titre plus en évidence, les gens comprendront ». Le lede qui
          se trouvait ici décrivait ce que fait un formulaire posé juste en
          dessous — une explication qui ne se lit jamais deux fois, et qui ne
          se lisait déjà pas la première. Ne pas le réintroduire. */}
      <div className="page-head">
        <h1>Assistance</h1>
      </div>

      {/* ── Le formulaire ──────────────────────────────────────────────── */}
      <section className="sup-card" aria-labelledby="sup-titre-form">
        <h2 id="sup-titre-form" className="sup-card-titre">
          Signaler quelque chose
        </h2>

        {/* B-050 — arrivée depuis un écran qui a buté. Le rappel de la capture
            se fait ICI, au moment où on peut encore la joindre : le dire sur
            l'écran d'origine seulement, c'est le dire trop tôt (on a navigué
            depuis) ou trop tard (l'écran a disparu). */}
        {titreInitial && (
          <p className="sup-venu-de">
            J’ai rempli ce que je savais du blocage. Complète avec tes mots — et
            <strong> joins la capture d’écran</strong> si tu l’as prise&nbsp;: c’est
            ce qui fait gagner le plus de temps.
          </p>
        )}

        <div className="sup-types" role="radiogroup" aria-label="Nature de la demande">
          <button
            type="button"
            role="radio"
            aria-checked={type === 'bug'}
            className={`sup-type${type === 'bug' ? ' actif' : ''}`}
            onClick={() => setType('bug')}
            disabled={enCours}
          >
            <Bug aria-hidden="true" />
            <span>
              <b>Quelque chose ne marche pas</b>
              <em>Une erreur, un écran bloqué, un chiffre faux</em>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={type === 'amelioration'}
            className={`sup-type${type === 'amelioration' ? ' actif' : ''}`}
            onClick={() => setType('amelioration')}
            disabled={enCours}
          >
            <Lightbulb aria-hidden="true" />
            <span>
              <b>J’ai une idée</b>
              <em>Un manque, une amélioration, une simplification</em>
            </span>
          </button>
        </div>

        <div className="sup-champ">
          <label htmlFor="sup-titre">En quelques mots</label>
          <input
            id="sup-titre"
            type="text"
            value={titre}
            maxLength={LONGUEUR_TITRE.max}
            onChange={(e) => setTitre(e.target.value)}
            placeholder={
              type === 'bug'
                ? 'Ex. : le planning de septembre est vide sur mon téléphone'
                : 'Ex. : pouvoir imprimer le planning du mois'
            }
            autoComplete="off"
            disabled={enCours}
          />
        </div>

        <div className="sup-champ">
          <label htmlFor="sup-desc">Raconte</label>
          <textarea
            id="sup-desc"
            value={description}
            maxLength={LONGUEUR_DESCRIPTION.max}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder={
              type === 'bug'
                ? 'Ce que tu faisais, ce que tu attendais, et ce qui s’est passé à la place.'
                : 'Ce que tu voudrais faire, et pourquoi c’est gênant aujourd’hui.'
            }
            disabled={enCours}
          />
          <p className="sup-aide">
            {type === 'bug'
              ? 'Le plus utile : à quel moment exactement ça se produit. Une capture d’écran vaut dix lignes.'
              : 'Décris le besoin plutôt que la solution — on trouvera souvent mieux ensemble.'}
          </p>
        </div>

        {/* ── Les pièces jointes ───────────────────────────────────────── */}
        <div className="sup-champ">
          <label htmlFor="sup-fichiers">Pièces jointes</label>
          <input
            ref={champFichier}
            id="sup-fichiers"
            type="file"
            className="sup-fichier-input"
            accept={ACCEPT_HTML}
            multiple
            onChange={(e) => ajouterFichiers(e.target.files)}
            disabled={enCours || fichiers.length >= NB_PIECES_MAX}
          />
          <label
            htmlFor="sup-fichiers"
            className={`sup-depot${fichiers.length >= NB_PIECES_MAX ? ' plein' : ''}`}
          >
            <Paperclip aria-hidden="true" />
            <span>
              {fichiers.length >= NB_PIECES_MAX
                ? `${NB_PIECES_MAX} pièces jointes, c’est le maximum`
                : 'Ajouter une capture d’écran ou un PDF'}
            </span>
          </label>
          <p className="sup-aide">
            Images et PDF, jusqu’à {poidsLisible(TAILLE_MAX_OCTETS)} par fichier, {NB_PIECES_MAX} au
            maximum.
          </p>

          {fichiers.length > 0 && (
            <ul className="sup-pieces">
              {fichiers.map((f, i) => (
                <li key={`${f.name}-${i}`} className="sup-piece">
                  <span className="sup-piece-nom">{f.name}</span>
                  <span className="sup-piece-poids">{poidsLisible(f.size)}</span>
                  <button
                    type="button"
                    className="sup-piece-retirer"
                    onClick={() => retirerFichier(i)}
                    disabled={enCours}
                    aria-label={`Retirer ${f.name}`}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fichiers.length > 1 && (
            <p className="sup-aide">Total : {poidsLisible(poidsTotal)}</p>
          )}
        </div>

        <div className="sup-actions">
          <button type="button" className="btn btn-valider" onClick={envoyer} disabled={enCours || !!blocage}>
            <Send aria-hidden="true" />
            {envoi === 'depot'
              ? 'Envoi des pièces jointes…'
              : envoi === 'enregistrement'
                ? 'Enregistrement…'
                : 'Envoyer'}
          </button>
          {/* Le bouton désactivé DIT pourquoi. Un bouton gris muet fait chercher
              ce qu'on a mal fait. */}
          {blocage && !enCours && <span className="sup-blocage">{blocage}</span>}
        </div>
      </section>

      {/* ── Ce qui a déjà été envoyé ───────────────────────────────────── */}
      <section className="sup-card" aria-labelledby="sup-titre-liste">
        <h2 id="sup-titre-liste" className="sup-card-titre">
          {estAdmin ? 'Les demandes du cabinet' : 'Mes demandes'}
        </h2>

        {demandes.length === 0 ? (
          <p className="sup-vide">
            Rien d’envoyé pour l’instant. Ce que tu écriras ci-dessus apparaîtra ici, avec sa date.
          </p>
        ) : (
          <ul className="sup-liste">
            {demandes.map((d) => (
              <li key={d.id} className={`sup-item ${d.type}`}>
                <div className="sup-item-tete">
                  <span className={`sup-etiquette ${d.type}`}>
                    {d.type === 'bug' ? <Bug aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}
                    {d.type === 'bug' ? 'Problème' : 'Idée'}
                  </span>
                  <b className="sup-item-titre">{d.titre}</b>
                  <span className={`sup-statut ${d.statut}`}>{LIBELLE_STATUT[d.statut]}</span>
                </div>

                <p className="sup-item-desc">{d.description}</p>

                <p className="sup-item-pied">
                  {dateLisible(d.createdAt)}
                  {estAdmin && d.auteurNom && <> · {d.deMoi ? 'toi' : d.auteurNom}</>}
                  {d.nbPieces > 0 && (
                    <>
                      {' '}
                      · {d.nbPieces} pièce{d.nbPieces > 1 ? 's' : ''} jointe{d.nbPieces > 1 ? 's' : ''}
                    </>
                  )}
                  {/* L'état RÉEL de l'envoi, pas une supposition. Le 2026-08-21,
                      trois « Envoyé » s'affichaient pour des messages rejetés. */}
                  {d.emailEnvoye ? (
                    <span className="sup-transmise">
                      <Check aria-hidden="true" /> transmise
                    </span>
                  ) : (
                    <span className="sup-non-transmise">
                      <AlertTriangle aria-hidden="true" /> enregistrée, pas encore transmise
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/**
 * Retire les fichiers d'une demande qui n'a finalement pas abouti.
 *
 * Volontairement silencieux : on est déjà en train d'expliquer un échec à
 * l'utilisateur, lui en annoncer un second sur une opération de ménage qui ne
 * le concerne pas n'apporterait rien. La trace part dans la console.
 */
async function nettoyer(
  supabase: ReturnType<typeof createClient>,
  deposes: PieceDeposee[],
): Promise<void> {
  if (deposes.length === 0) return
  const { error } = await supabase.storage.from('support').remove(deposes.map((p) => p.chemin))
  if (error) console.error('[Support] Fichiers orphelins non retirés :', error.message)
}
