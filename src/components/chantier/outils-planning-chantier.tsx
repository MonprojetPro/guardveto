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
//   • l'accent est CONTEXTUEL : un planning sans gardes propose « Générer »,
//     un planning rempli propose « Vérifier et publier ». Deux boutons
//     d'accent côte à côte, c'était deux fois aucun.
//
// CE QUI NE CHANGE PAS : les parcours, leurs garde-fous, le pré-vol. Aucune
// règle métier n'est touchée — ce serait risquer le moteur pour du décor.
// ============================================================

import { useEffect, useState, type ReactNode } from 'react'
import { PreVolAlert } from '@/components/planning/PreVolAlert'
import { ParcoursGeneration } from '@/components/v2/ParcoursGeneration'
import { DialogPublication } from '@/components/v2/DialogPublication'
import { GenererJournee, type PeriodeApplicable } from '@/components/v2/GenererJournee'
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

export function useOutilsPlanningChantier({
  periode,
  aDesGardes,
  isAdmin,
  onSignalerAbsence,
  periodes,
  periodesTypes,
  gardesParType,
  vets,
  periodesAvecGardes,
  onNaviguerVersMois,
  modules = ['gardes'],
  periodesJournee = [],
  aDesTrames = false,
}: OptionsOutils) {
  // ⚠️ LE REPLI EST « GARDES SEULES », jamais « tout allumé » — un cabinet dont
  //    la liste de modules n'aurait pas été lue doit voir l'écran qu'il a
  //    toujours eu, pas se découvrir un geste qu'il n'a pas acheté.
  const aGardes = modules.includes('gardes')
  const aJournee = modules.includes('planning-journee')
  const [journeeOuverte, setJourneeOuverte] = useState(false)
  const [parcoursOuvert, setParcoursOuvert] = useState(false)
  const [publicationOuverte, setPublicationOuverte] = useState(false)
  const [etapeParcours, setEtapeParcours] = useState<'choix' | 'nouveau'>('choix')

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

  const estPublie = periode?.statut === 'publie'
  const estVerrouille = periode?.statut === 'verrouille'
  // Volontairement SANS `aDesGardes` : un bouton grisé ne dit pas pourquoi il
  // l'est. Le clic ouvre le contrôle de publication, qui répond noir sur blanc
  // — « ce planning n'a aucune garde, génère-le d'abord ».
  const peutPublier = periode?.statut === 'brouillon'

  /** Ouvre le parcours, éventuellement droit sur la création d'un planning. */
  function ouvrirParcours(etape: 'choix' | 'nouveau' = 'choix') {
    setEtapeParcours(etape)
    setParcoursOuvert(true)
  }

  // ── Ce que la tête de page a le droit d'afficher ───────

  /**
   * LE NOMBRE DE LA PASTILLE, et rien d'autre.
   *
   * ⚠️ Ce n'est PAS le compteur des 48 incohérences de B-152a — celles-là sont
   * un contrôle de publication, qui reste bloquant côté serveur. Ici on compte
   * ce que le PRÉ-VOL a trouvé : les avertissements du moteur et les demandes
   * de congé non tranchées. Confondre les deux ferait dire à la pastille une
   * chose qu'elle ne mesure pas.
   */
  const pointsAVerifier = preVolActuel
    ? preVolActuel.avertissements.length + preVolActuel.souhaitsEnAttente
    : 0

  /**
   * L'ACTION PRINCIPALE — une seule, contextuelle.
   *
   * Le modèle du 09/10 met « Vérifier et publier » en accent ; l'écran mettait
   * « Générer ». Les deux ont raison, à des moments différents : sur un
   * planning vide, publier n'a aucun sens, et sur un planning rempli, générer
   * est un geste de reprise, pas le geste suivant. L'accent suit donc l'état.
   */
  let actionPrincipale: ReactNode = null
  if (isAdmin) {
    if (estPublie) {
      actionPrincipale = (
        <span className="pv2h-etat publie" title="Ce planning est publié : l’équipe le voit">
          Publié
        </span>
      )
    } else if (estVerrouille) {
      actionPrincipale = (
        <span className="pv2h-etat" title="Planning verrouillé : consultation seule">
          Verrouillé
        </span>
      )
    } else if (aDesGardes && peutPublier) {
      actionPrincipale = (
        <button
          type="button"
          className="pv2h-cta"
          title="Contrôler le planning, puis le publier auprès de l’équipe"
          onClick={() => setPublicationOuverte(true)}
        >
          Vérifier et publier
        </button>
      )
    } else if (aGardes) {
      actionPrincipale = (
        <button
          type="button"
          className="pv2h-cta"
          title="Générer un planning — nouveau, ou en refaire un existant"
          onClick={() => ouvrirParcours('choix')}
        >
          Générer le planning
        </button>
      )
    } else {
      // B-148 — sans gardes à calculer, « générer » désigne le remplissage des
      // journées. Proposer le parcours des gardes ici serait un calcul sans
      // objet.
      actionPrincipale = (
        <button
          type="button"
          className="pv2h-cta"
          title="Remplir le planning des journées depuis les présences récurrentes"
          onClick={() => setJourneeOuverte(true)}
        >
          Remplir les journées
        </button>
      )
    }
  }

  /**
   * LE MENU « OUTILS » — ce qui quitte la première ligne sans quitter l'écran.
   *
   * ⚠️ « Absence » y descend, et c'est le point à surveiller : c'était le SEUL
   * chemin spontané vers `CriseModal` depuis le planning (les autres entrées,
   * dans `/absences` et `/conges`, ne s'ouvrent qu'en réparation d'un conflit
   * déjà détecté). Le supprimer aurait retiré une capacité ; le descendre ne
   * retire qu'un bouton.
   */
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
      // Un geste inerte DIT pourquoi il l'est. Un bouton grisé muet renvoie
      // l'admin chercher la raison ailleurs — le défaut relevé le 03/08 sur
      // « Publier », réglé une fois, à ne pas réintroduire par la petite porte.
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

    if (aGardes && aJournee) {
      outils.push({
        cle: 'journees',
        libelle: 'Remplir les journées',
        aide: 'Appliquer les présences récurrentes sur la période',
        icone: '🗓',
        action: () => setJourneeOuverte(true),
      })
    }

    if (aGardes && aDesGardes) {
      // Quand l'accent est pris par « Vérifier et publier », le parcours de
      // génération doit rester atteignable : c'est lui qui refait un planning.
      outils.push({
        cle: 'generer',
        libelle: 'Refaire la génération',
        aide: 'Relancer le moteur sur cette période, ou en créer une autre',
        icone: '✨',
        action: () => ouvrirParcours('choix'),
      })
    }
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

  // ── Les parcours ───────────────────────────────────────

  const modales = isAdmin ? (
    <>
      {/* `key` sur l'étape d'entrée : la modale reste montée entre deux
          ouvertures, un simple `useState(etapeInitiale)` ne la verrait donc
          jamais changer. */}
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
        gardesParType={gardesParType}
        vets={vets}
        periodesAvecGardes={periodesAvecGardes}
        onNaviguerVersMois={onNaviguerVersMois}
        etapeInitiale={etapeParcours}
      />

      <DialogPublication
        open={publicationOuverte}
        onOpenChange={setPublicationOuverte}
        periode={periode}
        aDesGardes={aDesGardes}
      />

      {aJournee && (
        <GenererJournee
          open={journeeOuverte}
          onOpenChange={setJourneeOuverte}
          periodes={periodesJournee}
          aDesTrames={aDesTrames}
        />
      )}
    </>
  ) : null

  return { actionPrincipale, outils, pointsAVerifier, alertes, modales, ouvrirAssistant: ouvrirParcours }
}
