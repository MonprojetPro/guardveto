'use client'

// ============================================================
// GUARDVETO V2 — Qui est au cabinet ce jour-là
// ============================================================
// B-150 / B-145 lot 2a. Arbitrage de MiKL, le 07/10, sur la question « les
// absences du secrétariat, à quel niveau de détail sur la grille ? » :
//
//   « on part sur le même principe que pour le compteur, une pop up qui
//    s'ouvre si ils veulent tous les détails »
//
// La case du planning porte donc le CHIFFRE (« 5 présents »), cette fenêtre
// porte le détail. C'est ce qui permet de ne pas écrire les prénoms dans une
// case de 96 px — la mesure du 02/10 donnait jusqu'à 21 lignes à loger dans les
// 4 disponibles, et c'est ce qui avait fait rejeter la première maquette.
//
// ⚠️ LE CHÂSSIS EST LE `Dialog` PARTAGÉ, jamais un voile maison. Un voile écrit
//    à la main perd le piège de focus, la fermeture par Échap et le clic hors
//    cadre — et il faudrait les réécrire à l'identique dans chaque fenêtre.
//    Même raison que « jamais de `<select>` natif » sur ce projet.
//
// ⚠️ ELLE NE REMPLACE PAS ENCORE LE PANNEAU DU SECRÉTARIAT.
//    `AbsencesAVenirPanel` répond à « il revient quand ? », une question de
//    comptoir qui regarde DEVANT, pas un jour précis. Ce panneau disparaît au
//    lot 2c : sa question devra être reprise, sinon on retire une information
//    sans la remplacer — ce que l'arbitrage du 06/10 signalait déjà.
//
// ⚠️ LECTURE SEULE DANS CE LOT. `poserPresence` et `retirerPresence` existent,
//    sont gardées et testées, et n'ont encore aucun appelant (B-145a) : leur
//    place est la grille dépliée du lot 2b, là où l'admin voit la tranche qu'elle
//    vise. Un bouton « ajouter » ici ne tiendrait qu'une moitié du geste.
// ============================================================

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { JourneeAffichee } from '@/lib/planning/presencesDuJour'
import { stylePoint } from '@/lib/couleurs'

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
})

export function JourneeDuJourModale({
  date,
  journee,
  isAdmin,
  onFermer,
}: {
  /** `AAAA-MM-JJ`, ou `null` quand rien n'est ouvert. */
  date: string | null
  journee?: JourneeAffichee
  /**
   * Décide de la seule phrase qui parle d'un AUTRE écran.
   *
   * ⚠️ `/journee` redirige vers `/accueil` tout ce qui n'est pas admin
   *    (`page.tsx:77`, vérifié), et le secrétariat n'a même pas de fiche
   *    vétérinaire pour y entrer. Lui dire « ça se règle dans Journée » lui
   *    ferait chercher pendant dix minutes une porte que le serveur refuse —
   *    le défaut relevé par MiKL le 20/08, et « un lien qui quitte un parcours
   *    le détruit ».
   */
  isAdmin: boolean
  onFermer: () => void
}) {
  if (!date) return null

  const presences = journee?.presences ?? []
  const anomalies = presences.filter((p) => p.anomalie)

  // Groupé par tranche : c'est la question réellement posée (« qui est là ce
  // matin ? »), pas « qui est là dans la journée ». L'ordre vient déjà de
  // `composerPresencesParJour`, qui suit celui voulu par l'admin — on ne retrie
  // pas ici, sinon deux écrans classeraient la même donnée différemment.
  const parTranche: { tranche: string; heures: string; gens: typeof presences }[] = []
  for (const p of presences) {
    const dernier = parTranche[parTranche.length - 1]
    if (dernier && dernier.tranche === p.tranche) dernier.gens.push(p)
    else parTranche.push({ tranche: p.tranche, heures: p.heures, gens: [p] })
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFermer() }}>
      <DialogContent className="gv-modale">
        <DialogHeader>
          <DialogTitle>Au cabinet</DialogTitle>
          <DialogDescription>
            {DATE_LONGUE.format(new Date(date + 'T12:00:00Z'))}
          </DialogDescription>
        </DialogHeader>

        {presences.length === 0 ? (
          /* ⚠️ « Personne n'est inscrit » et « la journée n'a pas été remplie »
             ne sont PAS la même chose, et les confondre est exactement le
             défaut du tableau d'accueil qui annonçait « Rien à vérifier »
             (25/08) : une salle vide et un angle mort se lisent pareil, et
             personne ne va vérifier une bonne nouvelle. On dit donc ce qu'on
             sait, et seulement ça. */
          <p className="jdm-vide">
            Aucune présence n’est inscrite ce jour-là. Ça ne veut pas dire que le cabinet est
            fermé — seulement que rien n’a encore été posé sur cette journée.
          </p>
        ) : (
          <div className="jdm-tranches">
            {parTranche.map((t) => (
              <div className="jdm-tranche" key={t.tranche}>
                <div className="jdm-tr-head">
                  <b>{t.tranche}</b>
                  {t.heures && <span className="jdm-heures">{t.heures}</span>}
                  <span className="jdm-compte">
                    {t.gens.length} personne{t.gens.length > 1 ? 's' : ''}
                  </span>
                </div>
                <ul className="jdm-gens">
                  {t.gens.map((p) => (
                    <li key={p.id} className={p.anomalie ? 'jdm-gen a-verifier' : 'jdm-gen'}>
                      <span className="vdot" style={stylePoint(p.couleur)} aria-hidden="true" />
                      <span className="jdm-prenom">{p.prenom}</span>
                      {/* L'origine se dit, parce qu'elle change ce qui se passe
                          ensuite : une présence venue d'une récurrence revient
                          si on réapplique les récurrences. C'est la limite
                          assumée du lot précédent, et elle doit être LUE, pas
                          découverte après coup. */}
                      <span className="jdm-origine">
                        {p.deLaTrame ? 'par sa récurrence' : 'posée à la main'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Les anomalies ne sont pas décoratives : une présence sur une tranche
            retirée, ou sur quelqu'un qui a quitté l'équipe, COMPTE dans
            l'effectif affiché. La taire rendrait le chiffre faux sans qu'une
            seule ligne l'explique. */}
        {anomalies.length > 0 && (
          <div className="jdm-anomalies" role="status">
            <b>À vérifier</b>
            <ul>
              {anomalies.map((p) => (
                <li key={`a-${p.id}`}>
                  {p.prenom} — {p.anomalie}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin && (
          <p className="jdm-pied">
            Les présences se règlent par les récurrences, dans « Journée », puis en les appliquant
            sur ce planning.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
