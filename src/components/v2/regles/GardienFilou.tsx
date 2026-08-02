'use client'

// ============================================================
// GUARDVETO V2 — Filou gardien : « cette règle tient-elle ? »
// ============================================================
// L'OBJECTIF, POSÉ DÈS LA V1 ET JAMAIS TENU JUSQU'ICI
//
// MiKL, 2026-08-02 : « quand l'utilisateur crée une règle, il faut que Filou
// indique au moment où l'utilisateur valide sa règle que cette règle est OK
// avec les autres, sinon il doit y avoir un message d'avertissement et des
// suggestions de correction ou une validation si jamais la personne veut quand
// même le faire ».
//
// QUI DÉCIDE, QUI PARLE
//
// Le moteur décide (`engine/pre-vol.ts`, rejoué avec et sans la règle par
// `data/verifierRegleCandidate.ts`). Filou PARLE. C'est le principe du projet,
// et il tient toute cette fenêtre : aucun appel d'IA, aucune latence, aucune
// facture — et aucune incohérence inventée. Les corrections proposées viennent
// de `lib/regles/corrections.ts`, finies et vérifiables.
//
// CE QUI N'EST PAS UN REFUS
//
// Les actions d'écriture gardent leurs propres refus (étiquette sans porteur,
// doublon, anti-impasse) : ceux-là bloquent, et s'affichent en modale d'erreur
// (`ErreurBloquante`). Ici on AVERTIT : le bouton « Enregistrer quand même »
// existe et il enregistre vraiment. Une règle intenable sur la période testée
// peut être exactement ce que l'admin veut poser pour la suivante — lui retirer
// ce choix serait décider à sa place.
//
// LE SILENCE EST LE CAS NOMINAL
//
// Quand rien ne coince, cette fenêtre ne s'ouvre PAS : la règle s'enregistre,
// et un toast dit simplement que Filou a vérifié. Une confirmation à chaque
// règle correcte serait un péage — et on apprendrait à cliquer sans lire, ce
// qui viderait l'avertissement de tout sens le jour où il compte.
// ============================================================

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { correctionsPour, phraseGardien, type CorrectionProposee } from '@/lib/regles/corrections'
import type { VerdictGardien } from '@/data/verifierRegleCandidate'

interface Props {
  /** Le verdict à montrer. `null` = fenêtre fermée. */
  verdict: VerdictGardien | null
  /** Enregistrer malgré les avertissements. */
  onPasserOutre: () => void
  /** Fermer sans enregistrer : on revient au panneau, la saisie est intacte. */
  onAnnuler: () => void
  /**
   * Appliquer une correction que l'écran sait faire lui-même — aujourd'hui, le
   * seul cas est « repasser la fermeté à X ». Absent = le bouton d'assouplissement
   * n'est pas proposé (le panneau appelant ne gère pas la fermeté).
   */
  onAssouplir?: (force: string) => void
  /** Enregistrement en cours : on verrouille les trois issues. */
  enCours?: boolean
}

export function GardienFilou({
  verdict, onPasserOutre, onAnnuler, onAssouplir, enCours,
}: Props) {
  const router = useRouter()

  const ouvert = Boolean(verdict && verdict.avertissements.length > 0)
  const avertissements = verdict?.avertissements ?? []
  const corrections = correctionsPour(avertissements)

  /** Une correction n'est CLIQUABLE que si l'écran sait la faire. Les autres
   *  restent affichées comme des conseils : dire quoi faire vaut mieux que
   *  taire ce qu'on ne sait pas automatiser. */
  const cliquable = (c: CorrectionProposee) =>
    (c.genre === 'assouplir' && Boolean(onAssouplir)) || c.genre === 'ailleurs'

  const appliquer = (c: CorrectionProposee) => {
    if (c.genre === 'assouplir' && onAssouplir && c.cible) {
      onAnnuler()
      onAssouplir(c.cible)
      return
    }
    if (c.genre === 'ailleurs' && c.cible) router.push(c.cible)
  }

  return (
    <Dialog open={ouvert} onOpenChange={(o) => { if (!o && !enCours) onAnnuler() }}>
      <DialogContent className="gv-modale gv-gardien">
        <DialogHeader>
          <DialogTitle>
            <Image
              src="/filou/filou-tete.webp"
              alt=""
              width={34}
              height={34}
              className="gv-gardien-binette"
            />
            Filou a vérifié ta règle
          </DialogTitle>
          <DialogDescription>
            {phraseGardien(avertissements.length, verdict?.periodeTestee)}
          </DialogDescription>
        </DialogHeader>

        {/* Ce que le moteur a trouvé. Les libellés de règles viennent du
            catalogue (même source que le diagnostic d'impasse) : jamais une
            phrase réécrite ici, sinon l'écran dirait une chose et le planning
            une autre. */}
        <ul className="gv-gardien-liste">
          {avertissements.map((a, i) => (
            <li key={`${a.code}-${i}`}>
              <p className="gv-gardien-quoi">{a.message}</p>
              {a.regles.length > 0 && (
                <p className="gv-gardien-regles">
                  {a.regles.length === 1 ? 'Règle en cause : ' : 'Règles en cause : '}
                  {a.regles.join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>

        {corrections.length > 0 && (
          <div className="gv-gardien-corrections">
            <p className="gv-gardien-titre">Ce que je te propose</p>
            {corrections.map((c) => (
              <div key={c.label} className="gv-gardien-correction">
                <div>
                  <p className="gv-gardien-quoi">{c.label}</p>
                  <p className="gv-gardien-regles">{c.detail}</p>
                </div>
                {cliquable(c) && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => appliquer(c)}
                    disabled={enCours}
                  >
                    {c.genre === 'assouplir' ? 'Appliquer' : 'Y aller'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onAnnuler} disabled={enCours}>
            Revenir à ma règle
          </Button>
          <Button onClick={onPasserOutre} disabled={enCours}>
            {enCours ? 'Un instant…' : 'Enregistrer quand même'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
