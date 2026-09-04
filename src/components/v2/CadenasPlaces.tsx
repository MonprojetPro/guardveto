'use client'

// ============================================================
// GUARDVETO V2 — LE CADENAS SUR LA GRILLE (B-111, lot 3)
// ============================================================
// MiKL a tranché l'interface le 04/09 : le cadenas se pose DIRECTEMENT sur la
// grille, d'un geste, et non depuis la modale de garde. La raison est à
// l'usage — on ne cadenasse pas une case, on en cadenasse dix d'affilée avant
// de relancer une génération. Une modale à ouvrir et fermer dix fois aurait
// transformé un réglage en corvée.
//
// ── DEUX GESTES, DEUX COMPOSANTS ───────────────────────────────────────────
//
//   `BoutonCadenas` — sur une place DÉJÀ tenue : je la fixe, ou je la libère.
//   `FixerUneGarde` — sur un jour VIDE : je désigne quelqu'un, et c'est fixé
//                     d'office. C'est le pré-remplissage d'avant génération,
//                     quand la période n'a encore aucune ligne.
//
// ── CE QUE L'ÉCRAN NE CALCULE SURTOUT PAS ──────────────────────────────────
//
// Sur la ligne du vendredi, la vue du planning inverse les rôles : le « 1er »
// affiché est le 2nd de la garde. L'écran pourrait refaire cette inversion —
// il ne le fait PAS. Il envoie la GARDE et la PERSONNE, et le serveur cherche
// la place qu'elle occupe.
//
// L'inversion dépend de la configuration du cabinet, que la vue connaît et que
// l'écran ignore : la recopier ici aurait tenu jusqu'au premier cabinet qui
// découple son vendredi, puis se serait trompée sans rien dire.
//
// ── ON INFORME, ON NE BLOQUE PAS ───────────────────────────────────────────
//
// Le serveur enregistre d'abord et renvoie ensuite ce que le choix enfreint.
// Ces phrases s'affichent, elles n'annulent rien : « c'est l'admin qui aura
// décidé de faire comme ça » (MiKL, 04/09). D'où une bannière qu'on ferme, et
// non une fenêtre qui demande confirmation après coup — il serait absurde de
// demander la permission d'un enregistrement déjà fait.
// ============================================================

import { useState } from 'react'
import { Lock, LockOpen, Plus, X } from 'lucide-react'
import type { VetCrise } from '@/components/planning/CriseModal'

export interface ResultatCadenas {
  ok: boolean
  erreur?: string
  avertissements: string[]
  /** La garde touchée — pour que l'écran applique le résultat sans tout recharger. */
  gardeId?: string
  /**
   * Les PERSONNES cadenassées sur cette garde après le geste.
   *
   * Des personnes, et non des labels de place : sur la ligne du vendredi, la
   * vue du planning inverse les rôles, et réappliquer `{premier}` là-bas
   * dessinerait le cadenas sur l'autre place. Un identifiant de vétérinaire,
   * lui, ne s'inverse pas — il n'y a donc plus rien à convertir côté écran.
   */
  vetsFiges?: string[]
}

/** Appel unique au serveur — les deux gestes passent par la même porte. */
async function appeler(corps: Record<string, unknown>): Promise<ResultatCadenas> {
  try {
    const r = await fetch('/api/planning/places-figees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      return { ok: false, erreur: data?.error ?? 'Enregistrement impossible.', avertissements: [] }
    }
    return {
      ok: true,
      avertissements: data?.avertissements ?? [],
      gardeId: data?.gardeId,
      vetsFiges: (data?.vetsFiges ?? []) as string[],
    }
  } catch {
    return {
      ok: false,
      erreur: 'Le serveur n’a pas répondu. Vérifiez votre connexion et réessayez.',
      avertissements: [],
    }
  }
}

/**
 * Le cadenas d'une place occupée.
 *
 * Fermé = fixé, la génération n'y touche pas. Ouvert = libre. L'icône ouverte
 * ne s'affiche qu'au survol et au focus : dessiner un cadenas ouvert sur chaque
 * place transformerait la grille en champ d'icônes, et l'information « fixé »
 * se perdrait au milieu. Le CSS s'en charge (`.cad-libre`).
 */
export function BoutonCadenas({
  gardeId,
  vetId,
  prenom,
  fige,
  onFini,
}: {
  gardeId: string
  vetId: string
  prenom: string | null
  fige: boolean
  onFini: (r: ResultatCadenas) => void
}) {
  const [enCours, setEnCours] = useState(false)

  const libelle = fige
    ? `${prenom ?? 'Cette place'} est fixé — cliquer pour libérer`
    : `Fixer ${prenom ?? 'cette place'} : la régénération n’y touchera pas`

  return (
    <button
      type="button"
      className={`cad-btn${fige ? ' cad-fixe' : ' cad-libre'}`}
      title={libelle}
      aria-label={libelle}
      aria-pressed={fige}
      disabled={enCours}
      onClick={async (e) => {
        // La place vit dans un bouton cliquable (ouvrir la garde) : sans ça, le
        // clic sur le cadenas ouvrirait la modale par-dessus.
        e.stopPropagation()
        e.preventDefault()
        setEnCours(true)
        const r = await appeler({
          gardeId,
          veterinaireId: vetId,
          geste: fige ? 'liberer' : 'poser',
        })
        setEnCours(false)
        onFini(r)
      }}
    >
      {fige ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
    </button>
  )
}

/**
 * Le pré-remplissage d'un jour vide : « ce soir-là, c'est Fanny ».
 *
 * Volontairement minuscule et refermé par défaut. Il n'apparaît que sur une
 * période en brouillon, pour l'admin, et sur les jours qui portent réellement
 * un créneau — le vendredi et le dimanche renvoient au samedi, avec la raison,
 * plutôt que d'offrir un bouton qui créerait une garde que rien ne lit.
 */
export function FixerUneGarde({
  periodeId,
  date,
  type,
  libelleCreneau,
  vets,
  onFini,
}: {
  periodeId: string
  date: string
  type: string
  libelleCreneau: string
  vets: VetCrise[]
  onFini: (r: ResultatCadenas) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const [enCours, setEnCours] = useState(false)

  if (!ouvert) {
    return (
      <button
        type="button"
        className="fixer-ouvrir"
        title={`Fixer la garde de ce ${libelleCreneau} avant de générer`}
        onClick={() => setOuvert(true)}
      >
        <Plus aria-hidden="true" />
        Fixer
      </button>
    )
  }

  return (
    <div className="fixer-pop" role="group" aria-label={`Fixer la garde du ${date}`}>
      <div className="fixer-head">
        <span>1er de garde</span>
        <button type="button" className="fixer-fermer" aria-label="Annuler" onClick={() => setOuvert(false)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="fixer-liste">
        {vets.map((v) => (
          <button
            key={v.id}
            type="button"
            className="fixer-vet"
            disabled={enCours}
            onClick={async () => {
              setEnCours(true)
              const r = await appeler({
                periodeId,
                date,
                type,
                role: 'premier',
                geste: 'poser',
                veterinaireId: v.id,
              })
              setEnCours(false)
              setOuvert(false)
              onFini(r)
            }}
          >
            <span className="vdot" style={{ backgroundColor: v.couleur }} aria-hidden="true" />
            {v.prenom}
          </button>
        ))}
      </div>
      <p className="fixer-note">
        Le 2nd, s’il en faut un, sera trouvé par la génération.
      </p>
    </div>
  )
}

/**
 * La bannière qui dit ce qu'un cadenas enfreint — et rien d'autre.
 *
 * Elle n'annule jamais le geste : il est déjà enregistré. Elle porte donc des
 * constats, pas des questions, et se ferme d'un clic quand l'admin les a lus.
 */
export function BandeauCadenas({
  message,
  avertissements,
  onFermer,
}: {
  message: string | null
  avertissements: string[]
  onFermer: () => void
}) {
  if (!message && avertissements.length === 0) return null

  return (
    <div className={`cad-bandeau${message ? ' cad-bandeau-erreur' : ''}`} role="status">
      <div className="cad-bandeau-corps">
        {message && <p className="cad-bandeau-titre">{message}</p>}
        {avertissements.length > 0 && (
          <>
            <p className="cad-bandeau-titre">
              C’est enregistré. Voici ce que ce choix enfreint&nbsp;:
            </p>
            <ul>
              {avertissements.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <button type="button" className="cad-bandeau-fermer" aria-label="Fermer" onClick={onFermer}>
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
