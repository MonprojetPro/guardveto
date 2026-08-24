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

// ── Types ────────────────────────────────────────────────

interface BonusMalusCardProps {
  periodeId: string
  periodeStatut: 'brouillon' | 'publie' | 'verrouille'
  /** Bilan déjà calculé en base (vide s'il ne l'a jamais été) */
  existingBilan: BonusMalusRow[]
  /** Écarts hérités de la période précédente (ce que le moteur traînait déjà) */
  heritage: BonusMalusRow[]
  /** Noms et couleurs des vétos (pour l'affichage) */
  vetsInfo: Array<{ id: string; prenom: string; nom: string; couleur: string }>
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
  heritage_we: number | null
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
  heritage,
  vetsInfo,
}: BonusMalusCardProps) {
  const [calcul, setCalcul] = useState(false)
  const [bilan, setBilan] = useState<BilanVet[] | null>(null)

  const heritageMap = new Map(heritage.map((b) => [b.veterinaire_id, b]))
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
        heritage_we: heritageMap.get(b.veterinaire_id)?.ecart_we ?? null,
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
          heritage_we: heritageMap.get(eb.veterinaire_id)?.ecart_we ?? null,
        }
      })

  const detaille = bilan !== null
  const unReport = lignes.some((l) => l.heritage_we !== null)

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

      {lignes.length > 0 ? (
        <>
          <table className="count-table">
            <thead>
              <tr>
                <th>Vétérinaire</th>
                <th>Week-ends</th>
                <th>Nuits de semaine</th>
                <th>Jours fériés</th>
                {unReport && <th>Report du tour d’avant</th>}
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
                  {unReport && (
                    <td>
                      {l.heritage_we !== null ? (
                        <Ecart valeur={l.heritage_we} />
                      ) : (
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
