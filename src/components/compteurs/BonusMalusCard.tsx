'use client'

// ============================================================
// GUARDVETO — Le bilan de la période (bonus / malus)
// ============================================================
// Ce que chacun a fait par rapport à sa juste part, et ce que le moteur en
// retiendra pour le tour suivant. Habillé V2 (« Terrier ») comme les
// compteurs qui le précèdent sur la page : même carte, même tableau, MÊME
// pastille d'écart (`components/v2/Ecart`) — c'est la même donnée.
//
// Deux états de lecture, à ne pas confondre :
//   • bilan RECALCULÉ dans la session → on connaît le réalisé ET la part ;
//   • bilan RELU DE LA BASE → `bonus_malus` ne stocke que les écarts, jamais
//     les totaux. Les cases « réalisé » sont alors vides, et on le DIT, au
//     lieu d'aligner des tirets muets.
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Ecart } from '@/components/v2/Ecart'
import type { BilanVet } from '@/engine/bilan'
import type { BonusMalusRow } from '@/hooks/useCompteurs'
import { stylePoint } from '@/lib/couleurs'
import type { CumulEcarts, ReportEquite } from '@/engine/grand-livre-equite'

/** Ce que la page transmet du grand livre (sérialisable : pas de fonctions). */
export interface GrandLivreAffiche {
  cumul: Record<string, CumulEcarts>
  report: Record<string, ReportEquite>
  /** Combien de périodes closes ont vraiment un bilan — on le DIT à l'écran. */
  nbPeriodes: number
  /**
   * Lecture impossible. Sans ce champ, un historique illisible s'afficherait
   * comme un historique VIDE : la colonne de rattrapage disparaîtrait, et
   * l'admin lirait « personne ne traîne rien » — une bonne nouvelle que
   * personne ne va vérifier. C'est la règle « le tableau ne peut pas se
   * taire » : un vide dû à une panne doit se dire.
   */
  erreur?: string | null
}

/** « 2 week-ends », « 1 nuit de semaine » — au bon nombre, en français. */
function enClair(n: number, singulier: string, pluriel: string): string {
  const abs = Math.abs(n)
  return `${abs} ${abs > 1 ? pluriel : singulier}`
}

/**
 * Ce que le moteur rattrape SUR LA PÉRIODE AFFICHÉE, dit en français.
 *
 * ⚠️ « au tour suivant » était FAUX et la colonne s'est appelée ainsi
 * quelques heures le 2026-11-13 : le grand livre est chargé à la date de
 * début de la période SÉLECTIONNÉE, et le sélecteur permet d'ouvrir
 * n'importe laquelle des périodes passées. Anne-So consultant « Hiver P1 »
 * aurait lu l'état d'il y a deux périodes en croyant voir la prochaine
 * génération. « Sur cette période » est vrai dans les deux cas : pour une
 * période close, c'est ce qui a été appliqué ; pour celle en préparation,
 * c'est ce qui le sera.
 *
 * Le signe du report suit la convention du moteur (`> 0` = doit faire
 * PLUS). On ne montre JAMAIS ce signe tel quel : « +1 » ne veut rien dire
 * pour l'admin, « une garde de week-end en plus » si.
 */
function phraseRattrapage(r: ReportEquite | undefined): string | null {
  if (!r) return null
  const bouts: string[] = []
  if (r.we !== 0) bouts.push(`${enClair(r.we, 'week-end', 'week-ends')} ${r.we > 0 ? 'en plus' : 'en moins'}`)
  if (r.semaine !== 0) bouts.push(`${enClair(r.semaine, 'nuit de semaine', 'nuits de semaine')} ${r.semaine > 0 ? 'en plus' : 'en moins'}`)
  if (r.feries !== 0) bouts.push(`${enClair(r.feries, 'jour férié', 'jours fériés')} ${r.feries > 0 ? 'en plus' : 'en moins'}`)
  return bouts.length > 0 ? bouts.join(', ') : null
}

/** Le cumul réel, pour l'infobulle — c'est lui qui dit si le rattrapage est partiel. */
function phraseCumul(
  c: CumulEcarts | undefined,
  nbPeriodes: number,
  horsRotation: boolean,
): string {
  if (!c) return 'Aucun écart sur les périodes passées.'

  // ⚠️ Le grand livre cumule TOUT LE MONDE mais ne donne un report qu'à
  // l'effectif : un vétérinaire de dernier recours a un cumul et aucun
  // rattrapage. Sans cette phrase, l'infobulle lui promettait de rendre ses
  // douze gardes période après période — ce qui n'arrivera jamais, puisqu'il
  // est retiré de l'effectif avant même d'être candidat. Une promesse
  // rassurante que personne ne va vérifier : exactement ce que la règle
  // « le tableau ne peut pas se taire » interdit, pris par l'autre bout.
  if (horsRotation) {
    return (
      'Hors rotation (dernier recours) : cet écart est réel, mais il ne sera ' +
      'pas rattrapé — ce vétérinaire n’est pas candidat aux gardes.'
    )
  }
  const bouts: string[] = []
  if (c.we !== 0) bouts.push(`${enClair(c.we, 'week-end', 'week-ends')} ${c.we > 0 ? 'de plus' : 'de moins'}`)
  if (c.semaine !== 0) bouts.push(`${enClair(c.semaine, 'nuit de semaine', 'nuits de semaine')} ${c.semaine > 0 ? 'de plus' : 'de moins'}`)
  if (c.feries !== 0) bouts.push(`${enClair(c.feries, 'jour férié', 'jours fériés')} ${c.feries > 0 ? 'de plus' : 'de moins'}`)
  if (bouts.length === 0) return `À sa juste part sur ${enClair(nbPeriodes, 'période close', 'périodes closes')}.`
  return (
    `Avant cette période, sur ${enClair(nbPeriodes, 'période close', 'périodes closes')} : ` +
    `${bouts.join(', ')} que sa part. Le rattrapage est volontairement étalé — au plus ` +
    'un week-end, un jour férié et deux nuits de semaine par période.'
  )
}

// ── Types ────────────────────────────────────────────────

interface BonusMalusCardProps {
  periodeId: string
  periodeStatut: 'brouillon' | 'publie' | 'verrouille'
  /** Bilan déjà calculé en base (vide s'il ne l'a jamais été) */
  existingBilan: BonusMalusRow[]
  /**
   * Le grand livre d'équité (B-196 lot 0) : ce que chacun traîne de TOUTES
   * les périodes passées, et ce que le moteur en rattrapera au tour suivant.
   *
   * ⚠️ Cette carte affichait auparavant, sous le titre « Report du tour
   * d'avant », l'écart de week-ends de la SEULE période précédente. C'était
   * exact comme chiffre et faux comme promesse : le moteur ne reportait pas
   * autre chose, mais ni l'écran ni le moteur ne tenaient compte des
   * périodes antérieures ni des nuits de semaine. Montrer un tiers de la
   * dette sans dire que c'en est un tiers, c'est la « phrase rassurante »
   * que la règle « le tableau ne peut pas se taire » interdit.
   */
  grandLivre: GrandLivreAffiche
  /** Noms et couleurs des vétos (pour l'affichage) */
  vetsInfo: Array<{ id: string; prenom: string; nom: string; couleur: string; statut?: string | null }>
}

interface Ligne {
  veterinaire_id: string
  prenom: string
  nom: string
  couleur: string
  we_realise: number
  we_quota: number
  ecart_we: number
  sem_realise: number
  sem_quota: number
  ecart_semaine: number
  feries_realise: number
  feries_quota: number
  ecart_feries: number
  /** B-200 — week-ends LIBRES d'un salarié face à la moyenne des salariés. */
  salarie: boolean
  grands_realise: number
  grands_quota: number
  ecart_grands_we: number
}

/** « 3 sur 2,3 » — le réalisé face à la part théorique, en français. */
function Part({ realise, quota }: { realise: number; quota: number }) {
  return (
    <small className="bm-part">
      {realise} sur {quota.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
    </small>
  )
}

// ── Composant ────────────────────────────────────────────

export function BonusMalusCard({
  periodeId,
  periodeStatut,
  existingBilan,
  grandLivre,
  vetsInfo,
}: BonusMalusCardProps) {
  const [calcul, setCalcul] = useState(false)
  const [bilan, setBilan] = useState<BilanVet[] | null>(null)

  const dejaCalcule = existingBilan.length > 0

  async function recalculer() {
    setCalcul(true)
    try {
      const res = await fetch('/api/bilan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Je n’ai pas pu calculer le bilan.')
        return
      }
      setBilan(data.bilans)
      toast.success('Bilan recalculé.')
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setCalcul(false)
    }
  }

  // Le bilan fraîchement calculé porte les totaux ; celui relu en base ne
  // porte que les écarts (la table ne stocke rien d'autre).
  const lignes: Ligne[] = bilan
    ? bilan.map((b) => ({
        veterinaire_id: b.veterinaire_id,
        prenom: b.prenom,
        nom: b.nom,
        couleur: b.couleur,
        we_realise: b.we_realise,
        we_quota: b.we_quota,
        ecart_we: b.ecart_we,
        sem_realise: b.sem_realise,
        sem_quota: b.sem_quota,
        ecart_semaine: b.ecart_semaine,
        feries_realise: b.feries_realise,
        feries_quota: b.feries_quota,
        ecart_feries: b.ecart_feries,
        salarie: b.statut === 'salarie',
        grands_realise: b.grands_we_realise,
        grands_quota: b.grands_we_quota,
        ecart_grands_we: b.ecart_grands_we,
      }))
    : existingBilan.map((eb) => {
        const info = vetsInfo.find((v) => v.id === eb.veterinaire_id)
        return {
          veterinaire_id: eb.veterinaire_id,
          prenom: info?.prenom ?? '—',
          nom: info?.nom ?? '',
          couleur: info?.couleur ?? 'var(--soft)',
          we_realise: 0,
          we_quota: 0,
          ecart_we: eb.ecart_we,
          sem_realise: 0,
          sem_quota: 0,
          ecart_semaine: eb.ecart_semaine,
          feries_realise: 0,
          feries_quota: 0,
          ecart_feries: eb.ecart_feries,
          salarie: info?.statut === 'salarie',
          grands_realise: 0,
          grands_quota: 0,
          ecart_grands_we: eb.ecart_grands_we ?? 0,
          }
      })

  const detaille = bilan !== null
  // Une colonne de rattrapage ne s'affiche que si QUELQU'UN a quelque chose
  // à rattraper — sinon elle alignerait des tirets muets.
  const unReport = lignes.some((l) => phraseRattrapage(grandLivre.report[l.veterinaire_id]) !== null)
  // 🔴 B-200 — « il manque des colonnes ? ça n'a pas été mis à jour ». L'écart
  //    des grands week-ends est calculé et ENREGISTRÉ depuis le début
  //    (`bonus_malus.ecart_grands_we`), et le moteur le rattrape, mais ce
  //    tableau ne l'a jamais affiché. Il n'a de sens que pour les salariés.
  const desSalaries = lignes.some((l) => l.salarie)

  return (
    <section className="card count-card bm-card" aria-label="Bilan de la période">
      <div className="card-head">
        <h3>⚖️ Bilan de la période</h3>
        {periodeStatut !== 'brouillon' && (
          <button
            type="button"
            className="btn btn-outline btn-sm spacer bm-recalc"
            onClick={recalculer}
            disabled={calcul}
          >
            {calcul ? (
              <>
                <Loader2 className="ppv-spin" aria-hidden /> Je calcule…
              </>
            ) : dejaCalcule || bilan ? (
              'Recalculer'
            ) : (
              'Calculer le bilan'
            )}
          </button>
        )}
        <span className="sub">ce que chacun a fait par rapport à sa juste part</span>
      </div>

      {grandLivre.erreur && (
        // Une panne de lecture se DIT. Muette, elle se lirait comme
        // « personne ne traîne rien » : une salle vide, pas un angle mort.
        <p className="count-note" role="status">
          <b>Le report des périodes passées n’a pas pu être lu.</b> Les écarts
          ci-dessous restent justes pour cette période, mais la colonne du
          rattrapage est absente — ce n’est pas qu’il n’y a rien à rattraper.
        </p>
      )}

      {lignes.length > 0 ? (
        <>
          <table className="count-table">
            <thead>
              <tr>
                <th>Vétérinaire</th>
                <th>Week-ends de garde</th>
                <th>Nuits de semaine de garde</th>
                <th>Jours fériés de garde</th>
                {desSalaries && <th>Week-ends libres (salariés)</th>}
                {unReport && <th>Rattrapage sur cette période</th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.veterinaire_id}>
                  <td>
                    <span className="ct-vet">
                      <i style={stylePoint(l.couleur)} />
                      {l.prenom} {l.nom}
                    </span>
                  </td>
                  <td>
                    <Ecart valeur={l.ecart_we} />
                    {detaille && <Part realise={l.we_realise} quota={l.we_quota} />}
                  </td>
                  <td>
                    <Ecart valeur={l.ecart_semaine} />
                    {detaille && <Part realise={l.sem_realise} quota={l.sem_quota} />}
                  </td>
                  <td>
                    <Ecart valeur={l.ecart_feries} />
                    {detaille && <Part realise={l.feries_realise} quota={l.feries_quota} />}
                  </td>
                  {desSalaries && (
                    <td>
                      {l.salarie ? (
                        <>
                          <Ecart valeur={l.ecart_grands_we} sens="repos" />
                          {detaille && <Part realise={l.grands_realise} quota={l.grands_quota} />}
                        </>
                      ) : (
                        <span className="ecart none" title="Associé : non concerné">—</span>
                      )}
                    </td>
                  )}
                  {unReport && (
                    <td
                      title={phraseCumul(
                        grandLivre.cumul[l.veterinaire_id],
                        grandLivre.nbPeriodes,
                        // Un cumul SANS report = quelqu'un que le moteur
                        // n'appellera pas (cf. `construireReport`).
                        grandLivre.cumul[l.veterinaire_id] !== undefined &&
                          grandLivre.report[l.veterinaire_id] === undefined,
                      )}
                    >
                      {phraseRattrapage(grandLivre.report[l.veterinaire_id]) ?? (
                        <span className="ecart none">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="count-note">
            <b>+</b> signifie qu’il a fait <b>plus</b> que sa part : le moteur lui en
            donnera moins au prochain tour. <b>−</b> signifie l’inverse : il passera
            devant. <b>=</b> signifie qu’il est dans sa juste part.
            {!detaille && (
              <>
                {' '}
                Le détail du réalisé n’est pas conservé en base — clique sur
                «&nbsp;Recalculer&nbsp;» pour le voir.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="count-vide">
          {periodeStatut === 'brouillon'
            ? 'Le bilan sera disponible une fois la période publiée.'
            : 'Aucun bilan pour cette période — clique sur « Calculer le bilan ».'}
        </p>
      )}
    </section>
  )
}
