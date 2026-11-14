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
// B-211 — les phrases vivent dans `lib/equite/phrases` : deux cartes les
// montrent maintenant (celle-ci et `RattrapageCard`), et deux copies
// finiraient par dire deux choses du meme chiffre.
import {
  horsRotation,
  phraseCumul,
  phraseRattrapage,
  type GrandLivreAffiche,
} from '@/lib/equite/phrases'

export type { GrandLivreAffiche } from '@/lib/equite/phrases'

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

/**
 * Ce que le moteur rattrape sur CETTE dimension, sous la pastille.
 *
 * ⚠️ PLUS DE 6e COLONNE, et c'est tout l'objet du correctif B-211a. La
 * colonne « Rattrapage sur cette période » portait une PHRASE entière
 * (« 1 week-end en moins, 2 nuits de semaine en moins ») dans une cellule
 * de `.count-table`, centrée et en gras : sur téléphone le tableau sortait
 * de sa carte (317 px pour 306), l'en-tête s'affichait « RATTR APAGE SUR
 * CETTE PÉRIOD E » et le texte s'empilait sur six lignes avant d'être
 * tronqué. Mesuré au banc le 14/11.
 *
 * Le rattrapage de chaque dimension vit donc SOUS la pastille de cette
 * dimension, là où le tableau a déjà sa place : rien ne s'élargit.
 */
function Rattrape({ valeur, titre }: { valeur: number; titre: string }) {
  if (valeur === 0) return null
  return (
    // ⚠️ L'infobulle porte l'ECART ACCUMULE, pas une phrase generique.
    // En retirant la 6e colonne on retire la phrase du tableau : si le
    // cumul ne se retrouvait pas ici, on perdrait la seule chose qui dit
    // qu'il reste 3 week-ends derriere un rattrapage de 1. Les tests du
    // 13/11 l'ont attrape a la seconde ou elle a disparu.
    <small className="bm-part" title={titre}>
      rattrape {valeur > 0 ? `+${valeur}` : `−${Math.abs(valeur)}`}
    </small>
  )
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
  // Y a-t-il quelque chose a rattraper ? Sert desormais a la NOTE de bas
  // de carte, plus a une colonne.
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
          ci-dessous restent justes pour cette période, mais ce que le moteur
          rattrape n’est pas affiché — ce n’est pas qu’il n’y a rien à rattraper.
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
                    {horsRotation(grandLivre, l.veterinaire_id) && (
                      // Sans cette mention, le dernier recours n'a aucun
                      // « rattrape » sous ses pastilles et RIEN ne dit
                      // pourquoi : son ecart se lirait comme un oubli.
                      <small
                        className="bm-part"
                        title={phraseCumul(
                          grandLivre.cumul[l.veterinaire_id],
                          grandLivre.nbPeriodes,
                          true,
                          grandLivre.chantierOuvert === true,
                        )}
                      >
                        hors rotation
                      </small>
                    )}
                  </td>
                  <td>
                    <Ecart valeur={l.ecart_we} />
                    {detaille && <Part realise={l.we_realise} quota={l.we_quota} />}
                    <Rattrape
                      valeur={grandLivre.report[l.veterinaire_id]?.we ?? 0}
                      titre={phraseCumul(
                        grandLivre.cumul[l.veterinaire_id],
                        grandLivre.nbPeriodes,
                        horsRotation(grandLivre, l.veterinaire_id),
                        grandLivre.chantierOuvert === true,
                      )}
                    />
                  </td>
                  <td>
                    <Ecart valeur={l.ecart_semaine} />
                    {detaille && <Part realise={l.sem_realise} quota={l.sem_quota} />}
                    <Rattrape
                      valeur={grandLivre.report[l.veterinaire_id]?.semaine ?? 0}
                      titre={phraseCumul(
                        grandLivre.cumul[l.veterinaire_id],
                        grandLivre.nbPeriodes,
                        horsRotation(grandLivre, l.veterinaire_id),
                        grandLivre.chantierOuvert === true,
                      )}
                    />
                  </td>
                  <td>
                    <Ecart valeur={l.ecart_feries} />
                    {detaille && <Part realise={l.feries_realise} quota={l.feries_quota} />}
                    <Rattrape
                      valeur={grandLivre.report[l.veterinaire_id]?.feries ?? 0}
                      titre={phraseCumul(
                        grandLivre.cumul[l.veterinaire_id],
                        grandLivre.nbPeriodes,
                        horsRotation(grandLivre, l.veterinaire_id),
                        grandLivre.chantierOuvert === true,
                      )}
                    />
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
                </tr>
              ))}
            </tbody>
          </table>

          <p className="count-note">
            <b>+</b> signifie qu’il a fait <b>plus</b> que sa part : le moteur lui en
            donnera moins au prochain tour. <b>−</b> signifie l’inverse : il passera
            devant. <b>=</b> signifie qu’il est dans sa juste part.
            {unReport && (
              <>
                {' '}
                <b>« rattrape »</b> sous une pastille est ce que le moteur corrige
                sur cette période, en tenant compte des périodes closes d’avant.
              </>
            )}
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
