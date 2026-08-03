'use client'

// ============================================================
// GUARDVETO V2 — Filou porte-parole, quelle que soit la porte
// ============================================================
// PALIER 3 de l'audit du 2026-08-03.
//
// Les paliers 1 et 2 ont mis le contrôle d'impact sur le chemin de toutes les
// écritures. Mais leurs refus ressortaient en message d'erreur brut : correct,
// et parfaitement muet sur ce qu'il fallait faire ensuite. Cette fenêtre est
// leur voix commune.
//
// QUI DÉCIDE, QUI PARLE — le principe du projet, encore
//
// Le moteur décide (`engine/pre-vol.ts`, rejoué avec et sans la modification
// par `data/controleImpact.ts`). Filou PARLE. Aucun appel d'IA, aucune latence,
// aucune facture, et surtout aucune incohérence inventée : tout ce qui
// s'affiche ici a été calculé.
//
// CE QUI LA DISTINGUE DE `GardienFilou`
//
// `GardienFilou` sert l'écran Règles : il avertit sur une règle qu'on est en
// train d'écrire, et propose de revenir sur sa fermeté. Celle-ci sert TOUTES
// les autres portes — valider un congé, retirer un vétérinaire, changer
// l'effectif, poser une étiquette — et embarque les vrais gestes de correction
// (`PointPreVol`) : assouplir, mettre en pause, poser/retirer une étiquette,
// sans quitter la fenêtre. Corriger relance le contrôle : la liste se vide
// sous les yeux, et le bouton d'action se rouvre tout seul.
//
// BLOQUANT ou SIMPLE AVERTISSEMENT
//
// Le ton et les issues suivent la gravité, comme partout ailleurs dans le
// produit : ce qui rend la génération IMPOSSIBLE barre la route (pas de
// « quand même » tant que ce n'est pas réglé) ; le reste avertit et laisse
// passer. Décision MiKL du 2026-08-03.
// ============================================================

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { lienAccueilAvecSujet, type OrigineFilou } from '@/lib/v2/filou-origine'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PointPreVol, type VetEtiquette } from '@/components/planning/PointPreVol'
import type { Impact } from '@/data/controleImpact'

interface Props {
  /** L'impact à montrer. `null` = fenêtre fermée. */
  impact: Impact | null
  /** Ce que l'utilisateur essayait de faire — « valider ce congé »… */
  geste: string
  /** L'écran d'où l'on vient — Filou reprend la conversation à cet endroit. */
  origine: OrigineFilou
  /** Vétérinaires actifs, pour les gestes qui portent sur une étiquette. */
  vets: VetEtiquette[]
  /** Refaire le geste en passant outre. Absent = aucune issue « quand même ». */
  onPasserOutre?: () => void
  /** Fermer sans rien faire : la saisie de l'appelant reste intacte. */
  onAnnuler: () => void
  /** Une correction vient d'être appliquée : l'appelant relance son contrôle. */
  onCorrige?: () => void
  /** Action en cours : on verrouille les issues. */
  enCours?: boolean
}

export function GardienImpact({
  impact, geste, origine, vets, onPasserOutre, onAnnuler, onCorrige, enCours,
}: Props) {
  const router = useRouter()

  const points = impact?.nouveaux ?? []
  const ouvert = Boolean(impact && points.length > 0)
  const bloquants = impact?.bloquants ?? []
  const estBloquant = bloquants.length > 0
  const repares = impact?.repares ?? []

  if (!ouvert) return null

  const phrase = estBloquant
    ? `Si tu fais ça, le planning ne pourra plus être généré du tout. Voilà pourquoi — et ce qu’on peut y faire.`
    : `Ça passe, mais je préfère te le dire avant : ${geste} a des conséquences.`

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enCours) onAnnuler() }}>
      <DialogContent className="gv-modale gv-parcours">
        <DialogHeader>
          <p className="gm-kicker">Filou · vérification</p>
          <DialogTitle>
            {estBloquant
              ? 'Attends — ça bloquerait la génération'
              : 'Un point avant de continuer'}
          </DialogTitle>
          <DialogDescription>
            {impact?.periodeTestee
              ? `J’ai rejoué les règles du cabinet sur « ${impact.periodeTestee} ».`
              : 'J’ai rejoué les règles du cabinet.'}
          </DialogDescription>
        </DialogHeader>

        <div className="gi-mot">
          <Image
            src="/filou/filou-tete.webp"
            alt=""
            width={54}
            height={54}
            className="gi-filou"
            aria-hidden
          />
          <p className="gi-phrase">{phrase}</p>
        </div>

        <div className="gp-controle">
          {/* Chaque point porte SES gestes : on corrige ici, la liste se vide,
              et le bouton d'action se rouvre tout seul quand plus rien ne
              bloque. C'est la différence entre un avertissement et une aide. */}
          {points.map((a, i) => (
            <PointPreVol
              key={`${a.code}-${i}`}
              avertissement={a}
              vets={vets}
              onCorrige={() => onCorrige?.()}
            />
          ))}

          {/* La bonne nouvelle compte aussi : une modification qui RÉPARE
              quelque chose doit le dire, sinon le système ne renvoie jamais
              que des reproches. */}
          {repares.length > 0 && (
            <div className="gi-repare">
              <b>Au passage, ça règle {repares.length} point{repares.length > 1 ? 's' : ''}</b>
              <span>{repares[0].message}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onAnnuler} disabled={enCours}>
            {estBloquant ? 'Revenir en arrière' : 'Annuler'}
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push(lienAccueilAvecSujet(origine, points[0]?.message ?? geste))}
            disabled={enCours}
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            En parler avec Filou
          </Button>

          {/* Pas de « quand même » sur un blocage : ce serait promettre un
              planning qui n'existe pas. L'issue est de corriger, ici même. */}
          {!estBloquant && onPasserOutre && (
            <Button onClick={onPasserOutre} disabled={enCours}>
              Continuer quand même
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
