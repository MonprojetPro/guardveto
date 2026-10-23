'use client'

// ============================================================
// GUARDVETO — Les outils du planning, VERSION CHANTIER (B-157)
// ============================================================
// 🔴 POURQUOI CE FICHIER EXISTE — ET POURQUOI IL EST UNE COPIE ASSUMÉE.
//
// `v2/outils-planning.tsx` est consommé par DEUX écrans : `PlanningV2`, que
// voient tous les cabinets (Val d'Allier compris), et `PlanningChantierV2`,
// que seul le bac à sable voit. Y retirer le bouton « Absence » ou y changer
// le bouton d'accent serait parti chez le client sans passer par la porte de
// `lib/produit/chantiers.ts` — c'est le mécanisme exact de B-151, le 08/10 :
// un changement de visuel arrivé chez le client parce qu'AUCUN code ne pouvait
// appliquer la consigne, même écrite.
//
// La convention posée par `chantier-restreint.test.ts` est donc tenue à la
// lettre : ce qui appartient à un chantier vit sous `components/chantier/`.
// La duplication est le PRIX de cette garantie, et elle est temporaire — le
// jour où le chantier passe en `tousLesCabinets`, c'est ce fichier-ci qui
// remplace l'original, et B-145b rappelle qu'il faudra alors le vérifier, pas
// le supposer.
//
// CE QUI CHANGE PAR RAPPORT À L'ORIGINAL — rien d'autre que la FORME :
//   • la barre ne rend plus une rangée de boutons mais trois sorties nommées
//     (`actionPrincipale`, `outils`, `etat`), que la tête de page range où
//     elle veut ;
//   • « Absence », « PDF » et « Journées » descendent dans le menu Outils —
//     ils gardent leur geste, ils perdent leur place en première ligne
//     (MiKL, 09/10 : « tu peux enlever le bouton absence, comme ça on gagne
//     une place ») ;
//   • ⚠️ DEPUIS B-172 (23/10), plus aucun bouton n'est rendu ici : « Générer »
//     et « Publier » vivent dans la bande « Préparer · Remplir · Publier »
//     (`BandePlanning`). Ce module n'expose plus que des ouvertures et les
//     fenêtres qu'elles ouvrent — voir le commentaire du hook, plus bas.
//
// CE QUI NE CHANGE PAS : les parcours, leurs garde-fous, le pré-vol. Aucune
// règle métier n'est touchée — ce serait risquer le moteur pour du décor.
// ============================================================

import { useEffect, useState } from 'react'
import { PreVolAlert } from '@/components/planning/PreVolAlert'
import { ParcoursGeneration } from '@/components/v2/ParcoursGeneration'
import { DialogPublicationChantier, type ContenuPeriode } from '@/components/chantier/DialogPublicationChantier'
import { ChoixNouveauPlanning } from '@/components/chantier/ChoixNouveauPlanning'
// B-157b — la fenêtre « Remplir les journées » est elle aussi une COPIE sous
// `chantier/` : l'originale s'affichait sans style depuis le planning (sa
// feuille n'y est pas importée), et la réparer à sa source aurait changé le
// rendu chez le client. Le type, lui, reste partagé — c'est une donnée.
import { GenererJourneeChantier } from '@/components/chantier/GenererJourneeChantier'
import type { PeriodeApplicable } from '@/components/v2/GenererJournee'
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
  /** Ouvre la modale de signalement d'absence, portée par l'écran. */
  onSignalerAbsence: () => void
  /** Tous les plannings du cabinet — le parcours en a besoin. */
  periodes: Periode[]
  /** Les périodes types actives (`profils_planning`), pour la voie « nouveau ». */
  periodesTypes: ProfilPlanning[]
  /** Les gardes que chaque période type fait couvrir, par id de période type. */
  gardesParType: Record<string, string[]>
  /** Vétérinaires actifs — pour régler un point d'étiquette sur place. */
  vets: VetEtiquette[]
  /** Plannings qui ont déjà des gardes — repère un brouillon jamais rempli. */
  periodesAvecGardes: string[]
  /** Va au mois donné (« AAAA-MM »). */
  onNaviguerVersMois: (anneeMois: string) => void
  /** Les modules allumés pour ce cabinet (B-148). */
  modules?: string[]
  /** Les plannings sur lesquels on peut poser des présences (non verrouillés). */
  periodesJournee?: PeriodeApplicable[]
  /** Y a-t-il au moins une présence récurrente à appliquer ? */
  aDesTrames?: boolean
  /** B-172 — ce que contient le planning affiché, compté en base. */
  contenu?: ContenuPeriode | null
  /** B-172 — aller sur un planning précis (créé à l'instant, par exemple). */
  onAllerVersPeriode?: (p: { id: string; date_debut: string }) => void
}

/** Une entrée du menu « Outils ». La tête de page les dessine, pas nous. */
export interface EntreeOutil {
  cle: string
  libelle: string
  /** La phrase qui dit ce que ça fait — lue, pas survolée. */
  aide: string
  icone: string
  /** `undefined` quand l'entrée est inerte : le menu l'affiche en gris. */
  action?: () => void
  /** Dit POURQUOI c'est inerte. Un bouton grisé muet ne s'explique pas. */
  empeche?: string
}

/** Résultat du pré-vol (backlog n°23 + n°24) — GET /api/generate/pre-vol. */
interface PreVolState {
  avertissements: AvertissementPreVol[]
  souhaitsEnAttente: number
}

// ── Hook ─────────────────────────────────────────────────

/**
 * B-172 — LES GESTES DU PLANNING NE SONT PLUS DES BOUTONS RENDUS ICI.
 *
 * Jusqu'au 23/10, ce hook rendait « Générer » et « Vérifier et publier » tout
 * dessinés, que la tête de page alignait. Ils vivent désormais dans la bande
 * « Préparer · Remplir · Publier » (`BandePlanning`), à côté de ce qu'ils
 * concernent : ce hook n'expose plus que des OUVERTURES (`ouvrirGeneration`,
 * `ouvrirJournees`, `ouvrirPublication`, `ouvrirNouveau`) et les fenêtres
 * qu'elles ouvrent.
 *
 * UNE SEULE PORTE POUR CRÉER : `ouvrirNouveau`. Elle demande ce que contient
 * le planning quand le cabinet a les deux modules, et va droit au but sinon.
 * « Je fais un nouveau planning » (dans Générer) et « Dates libres » (dans la
 * fenêtre des journées) ne sont plus des entrées : trois portes pour un même
 * geste, c'était le premier sujet de confusion relevé par MiKL.
 */
export function useOutilsPlanningChantier({
  periode,
  isAdmin,
  onSignalerAbsence,
  aDesGardes,
  periodes,
  periodesTypes,
  gardesParType,
  vets,
  periodesAvecGardes,
  onNaviguerVersMois,
  modules = ['gardes'],
  periodesJournee = [],
  aDesTrames = false,
  contenu = null,
  onAllerVersPeriode,
}: OptionsOutils) {
  // ⚠️ LE REPLI EST « GARDES SEULES », jamais « tout allumé » — un cabinet dont
  //    la liste de modules n'aurait pas été lue doit voir l'écran qu'il a
  //    toujours eu, pas se découvrir un geste qu'il n'a pas acheté.
  const aGardes = modules.includes('gardes')
  const aJournee = modules.includes('planning-journee')

  // Chaque ouverture REMONTE sa fenêtre (`key` sur le compteur) : les fenêtres
  // lisent leur point de départ à la création seulement — un état hérité de
  // l'ouverture précédente viserait le mauvais planning.
  const [parcours, setParcours] = useState<{
    ouvert: boolean
    n: number
    etape: 'choix' | 'nouveau'
    cible: Periode | null
  }>({ ouvert: false, n: 0, etape: 'choix', cible: null })
  const [journees, setJournees] = useState<{
    ouvert: boolean
    n: number
    mode: 'remplir' | 'creer'
    periodeId: string | null
  }>({ ouvert: false, n: 0, mode: 'remplir', periodeId: null })
  const [publicationOuverte, setPublicationOuverte] = useState(false)
  const [choixOuvert, setChoixOuvert] = useState(false)

  // Pré-vol du planning AFFICHÉ. Clé sur sa période : changer de mois invalide
  // l'affichage sans setState synchrone dans l'effet.
  const [preVol, setPreVol] = useState<(PreVolState & { periodeId: string }) | null>(null)
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

  const preVolActuel = preVol && preVol.periodeId === periodeId ? preVol : null

  /**
   * LE NOMBRE DE POINTS À RÉGLER, et rien d'autre.
   *
   * ⚠️ Ce n'est PAS le compteur des incohérences de B-152a — celles-là sont un
   * contrôle de publication, qui reste bloquant côté serveur. Ici on compte ce
   * que le PRÉ-VOL a trouvé : les avertissements du moteur et les demandes de
   * congé non tranchées.
   */
  const pointsAVerifier = preVolActuel
    ? preVolActuel.avertissements.length + preVolActuel.souhaitsEnAttente
    : 0

  // ── Les ouvertures ─────────────────────────────────────

  /** Générer les gardes de CE planning : droit au contrôle, sans « lequel ? ». */
  function ouvrirGeneration(cible: Periode | null = periode) {
    setParcours((p) => ({ ouvert: true, n: p.n + 1, etape: 'choix', cible }))
  }

  /** Remplir / compléter les journées de CE planning. */
  function ouvrirJournees() {
    setJournees((j) => ({ ouvert: true, n: j.n + 1, mode: 'remplir', periodeId: periode?.id ?? null }))
  }

  function ouvrirPublication() {
    setPublicationOuverte(true)
  }

  /** LA porte de création. */
  function ouvrirNouveau() {
    if (aGardes && aJournee) return setChoixOuvert(true)
    if (aGardes) return setParcours((p) => ({ ouvert: true, n: p.n + 1, etape: 'nouveau', cible: null }))
    if (aJournee) return setJournees((j) => ({ ouvert: true, n: j.n + 1, mode: 'creer', periodeId: null }))
  }

  // ── Le menu « Outils » ─────────────────────────────────
  //
  // ⚠️ « Absence » y vit : c'était le SEUL chemin spontané vers `CriseModal`
  // depuis le planning. Le supprimer aurait retiré une capacité ; le descendre
  // ne retire qu'un bouton.
  const peutImprimer = aDesGardes && periodeId !== ''
  const outils: EntreeOutil[] = [
    {
      cle: 'pdf',
      libelle: 'Imprimer en PDF',
      aide: 'Le planning de la période, prêt pour le comptoir',
      icone: '🖨',
      action: peutImprimer
        ? () => { window.location.href = `/api/export-pdf?periodeId=${periodeId}` }
        : undefined,
      // Un geste inerte DIT pourquoi il l'est.
      empeche: peutImprimer ? undefined : 'Ce planning n’a encore aucune garde à imprimer',
    },
  ]

  if (isAdmin) {
    outils.push({
      cle: 'absence',
      libelle: 'Signaler une absence',
      aide: 'Quelqu’un ne peut pas assurer sa garde — on la réattribue',
      icone: '🩹',
      action: onSignalerAbsence,
    })
  }

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

  // ── Les fenêtres ───────────────────────────────────────

  const modales = isAdmin ? (
    <>
      <ParcoursGeneration
        key={`parcours-${parcours.n}`}
        open={parcours.ouvert}
        onOpenChange={(o) => {
          setParcours((p) => ({ ...p, ouvert: o }))
          if (!o) setPreVolVersion((v) => v + 1)
        }}
        periodes={periodes}
        periodeAffichee={periode}
        periodesTypes={periodesTypes}
        gardesParType={gardesParType}
        vets={vets}
        periodesAvecGardes={periodesAvecGardes}
        onNaviguerVersMois={onNaviguerVersMois}
        etapeInitiale={parcours.etape}
        cibleDirecte={parcours.cible}
      />

      <DialogPublicationChantier
        open={publicationOuverte}
        onOpenChange={setPublicationOuverte}
        periode={periode}
        contenu={contenu}
        avecJournees={aJournee}
      />

      {aJournee && (
        <GenererJourneeChantier
          key={`journees-${journees.n}`}
          open={journees.ouvert}
          onOpenChange={(o) => setJournees((j) => ({ ...j, ouvert: o }))}
          periodes={periodesJournee}
          aDesTrames={aDesTrames}
          periodeInitialeId={journees.periodeId}
          mode={journees.mode}
          onPeriodeCreee={(p) => onAllerVersPeriode?.(p)}
        />
      )}

      <ChoixNouveauPlanning
        open={choixOuvert}
        onOpenChange={setChoixOuvert}
        onGardes={() => {
          setChoixOuvert(false)
          setParcours((p) => ({ ouvert: true, n: p.n + 1, etape: 'nouveau', cible: null }))
        }}
        onJournees={() => {
          setChoixOuvert(false)
          setJournees((j) => ({ ouvert: true, n: j.n + 1, mode: 'creer', periodeId: null }))
        }}
      />
    </>
  ) : null

  return {
    outils, pointsAVerifier, alertes, modales,
    aGardes, aJournee,
    ouvrirGeneration, ouvrirJournees, ouvrirPublication, ouvrirNouveau,
  }
}
