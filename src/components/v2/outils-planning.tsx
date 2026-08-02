'use client'

// ============================================================
// GUARDVETO V2 — Les outils du planning (pilules d'en-tête)
// ============================================================
// REFONTE DU 2026-08-02 (demande MiKL). Ce fichier ne PILOTE plus la
// génération : il ouvre le PARCOURS (`ParcoursGeneration`), qui accompagne
// l'admin du choix du planning jusqu'au résultat, et la PUBLICATION
// (`DialogPublication`), qui contrôle avant de déclencher les automatisations.
// Les garde-fous métier n'ont pas disparu — ils sont devenus des étapes de ces
// deux parcours (confirmation d'écrasement d'un planning publié, diagnostic
// d'impasse, créneaux ignorés, réserves du gate serveur).
//
// CE QUI RESTE ICI : la barre d'outils elle-même, et le bandeau de pré-vol
// affiché en permanence au-dessus de la grille (le signal « quelque chose
// cloche » qu'on voit sans rien ouvrir).
//
// DEUX CORRECTIONS D'AFFICHAGE, MÊME RETOUR :
//   • « Générer » est le geste central de l'application — il porte donc
//     l'accent et une icône, au lieu d'être la quatrième pilule grise d'une
//     rangée de quatre.
//   • Un planning déjà publié affichait un bouton vert plein « Publiée ».
//     MiKL : « on dirait un bouton alors que ce n'est qu'un label, ça crée la
//     confusion ». C'est désormais un ÉTAT (pastille), pas un bouton.
// ============================================================

import { useEffect, useState } from 'react'
import { PreVolAlert } from '@/components/planning/PreVolAlert'
import { ParcoursGeneration } from '@/components/v2/ParcoursGeneration'
import { DialogPublication } from '@/components/v2/DialogPublication'
import type { VetEtiquette } from '@/components/planning/PointPreVol'
import type { AvertissementPreVol } from '@/engine/pre-vol'
import type { Periode, ProfilPlanning } from '@/types'

// ── Types ────────────────────────────────────────────────

interface OptionsOutils {
  /** Période dont relève le mois affiché — la SEULE source de vérité. */
  periode: Periode | null
  /** La période affichée a-t-elle déjà des gardes ? (PDF, publication) */
  aDesGardes: boolean
  isAdmin: boolean
  /** Ouvre la modale de signalement d'absence, portée par `PlanningV2`. */
  onSignalerAbsence: () => void
  /** Tous les plannings du cabinet — le parcours en a besoin. */
  periodes: Periode[]
  /** Les périodes types actives (`profils_planning`), pour la voie « nouveau ». */
  periodesTypes: ProfilPlanning[]
  /** Vétérinaires actifs — pour régler un point d'étiquette sur place. */
  vets: VetEtiquette[]
  /** Va au mois donné (« AAAA-MM ») — porté par `PlanningV2`. */
  onNaviguerVersMois: (anneeMois: string) => void
}

/** Résultat du pré-vol (backlog n°23 + n°24) — GET /api/generate/pre-vol. */
interface PreVolState {
  avertissements: AvertissementPreVol[]
  souhaitsEnAttente: number
}

// ── Hook ─────────────────────────────────────────────────

export function useOutilsPlanning({
  periode,
  aDesGardes,
  isAdmin,
  onSignalerAbsence,
  periodes,
  periodesTypes,
  vets,
  onNaviguerVersMois,
}: OptionsOutils) {
  const [parcoursOuvert, setParcoursOuvert] = useState(false)
  const [publicationOuverte, setPublicationOuverte] = useState(false)
  // Le raccourci du menu de période ouvre directement la voie « nouveau » :
  // l'admin a déjà dit ce qu'il voulait, lui reposer la question serait un clic
  // pour rien.
  const [etapeParcours, setEtapeParcours] = useState<'choix' | 'nouveau'>('choix')

  // Pré-vol du planning AFFICHÉ — le signal permanent au-dessus de la grille.
  // Clé sur sa période : changer de mois invalide l'affichage sans setState
  // synchrone dans l'effet.
  const [preVol, setPreVol] = useState<(PreVolState & { periodeId: string }) | null>(null)
  // Bumpé après chaque correction ou génération : les règles ont pu changer.
  const [preVolVersion, setPreVolVersion] = useState(0)

  const periodeId = periode?.id ?? ''

  useEffect(() => {
    if (!periodeId || !isAdmin) return
    let annule = false
    fetch(`/api/generate/pre-vol?periodeId=${encodeURIComponent(periodeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (annule || !data) return
        setPreVol({
          periodeId,
          avertissements: (data.avertissements ?? []) as AvertissementPreVol[],
          souhaitsEnAttente: typeof data.souhaitsEnAttente === 'number' ? data.souhaitsEnAttente : 0,
        })
      })
      .catch(() => { /* silencieux — le pré-vol ne bloque jamais */ })
    return () => { annule = true }
  }, [periodeId, isAdmin, preVolVersion])

  // Seul le pré-vol de la période AFFICHÉE est montré (l'ancien devient inerte).
  const preVolActuel = preVol && preVol.periodeId === periodeId ? preVol : null

  const estPublie = periode?.statut === 'publie'
  const estVerrouille = periode?.statut === 'verrouille'
  const peutPublier = aDesGardes && periode?.statut === 'brouillon'

  /** Ouvre le parcours, éventuellement droit sur la création d'un planning. */
  function ouvrirParcours(etape: 'choix' | 'nouveau' = 'choix') {
    setEtapeParcours(etape)
    setParcoursOuvert(true)
  }

  // ── Les pilules, dans l'ordre de la maquette ───────────
  // Compteurs (rendu par PlanningV2) · PDF · Absence · [état] · Générer
  // C'est « Générer » qui ferme la ligne et porte l'accent : c'est le geste
  // central de l'application, pas une option parmi d'autres.

  const pilules = (
    <>
      <button
        type="button"
        className="head-btn ghost"
        disabled={!aDesGardes}
        title="Exporter le planning de la période en PDF"
        onClick={() => {
          if (periodeId) window.location.href = `/api/export-pdf?periodeId=${periodeId}`
        }}
      >
        🖨 PDF
      </button>

      {isAdmin && (
        <>
          <button
            type="button"
            className="head-btn"
            title="Signaler l’absence d’un vétérinaire et réparer le planning"
            onClick={onSignalerAbsence}
          >
            Absence
          </button>

          {/* Un planning DÉJÀ publié n'a plus d'action « publier » : afficher un
              bouton vert plein « Publiée » faisait croire à un geste possible.
              C'est un état — il en a la forme. */}
          {estPublie ? (
            <span className="head-etat publie" title="Ce planning est publié : l’équipe le voit">
              ✓ Publié
            </span>
          ) : estVerrouille ? (
            <span className="head-etat" title="Planning verrouillé : consultation seule">
              🔒 Verrouillé
            </span>
          ) : (
            <button
              type="button"
              className="head-btn valider"
              disabled={!peutPublier}
              title={aDesGardes ? 'Publier le planning auprès de l’équipe' : 'Génère d’abord le planning'}
              onClick={() => setPublicationOuverte(true)}
            >
              Publier
            </button>
          )}

          {/* Le geste central : accentué, avec sa baguette. Plus de `disabled`
              quand le mois n'a pas de planning — c'est justement le cas où il
              faut pouvoir en créer un. */}
          <button
            type="button"
            className="head-btn generer"
            title="Générer un planning — nouveau, ou en refaire un existant"
            onClick={() => ouvrirParcours('choix')}
          >
            <span className="hb-etincelle" aria-hidden>✨</span>
            Générer
          </button>
        </>
      )}
    </>
  )

  // ── Le bandeau, au-dessus de la grille ─────────────────
  // Chaque point y est RÉGLABLE sur place : corriger déclenche un rechargement
  // du pré-vol, donc la liste se vide au fur et à mesure.

  const alertes = isAdmin && preVolActuel ? (
    <PreVolAlert
      avertissements={preVolActuel.avertissements}
      souhaitsEnAttente={preVolActuel.souhaitsEnAttente}
      vets={vets}
      onCorrige={() => setPreVolVersion((v) => v + 1)}
    />
  ) : null

  // ── Les deux parcours ──────────────────────────────────

  const modales = isAdmin ? (
    <>
      {/* `key` sur l'étape d'entrée : la modale reste montée entre deux
          ouvertures, un simple `useState(etapeInitiale)` ne la verrait donc
          jamais changer. Changer la clé la remonte sur la bonne étape — sans
          poser un setState dans un effet (interdit par le lint du projet). */}
      <ParcoursGeneration
        key={etapeParcours}
        open={parcoursOuvert}
        onOpenChange={(o) => {
          setParcoursOuvert(o)
          if (!o) setPreVolVersion((v) => v + 1)
        }}
        periodes={periodes}
        periodeAffichee={periode}
        periodesTypes={periodesTypes}
        vets={vets}
        onNaviguerVersMois={onNaviguerVersMois}
        etapeInitiale={etapeParcours}
      />

      <DialogPublication
        open={publicationOuverte}
        onOpenChange={setPublicationOuverte}
        periode={periode}
        aDesGardes={aDesGardes}
      />
    </>
  ) : null

  return { pilules, alertes, modales, ouvrirAssistant: ouvrirParcours }
}
