// ============================================================
// GUARDVETO — La marque « bac à sable », sur TOUS les écrans (B-090)
// ============================================================
// MiKL, le 31/08 : « mets-moi une marque dans la barre du bac à sable que c'est
// bien la version démo, car sinon je ne sais pas ».
//
// Le besoin est né le jour même : le bac à sable a été remis à l'identique du
// compte client — mêmes 7 prénoms, même planning Hiver P1, mêmes compteurs.
// Les deux comptes sont devenus indiscernables à l'œil, et c'est exactement ce
// qu'on voulait pour mesurer. Le revers, c'est qu'une retouche faite « pour
// essayer » peut désormais atterrir chez le vrai cabinet sans que rien ne
// prévienne.
//
// ── POURQUOI DANS LE LAYOUT, ET PAS DANS LA BARRE ───────────────────────────
//
// `BarreV2` est appelée par huit pages, chacune avec ses propres props. Y
// ajouter un paramètre obligerait à toucher ces huit appels — et le neuvième
// écran, celui qu'on écrira dans trois mois, n'aurait pas la marque. Un
// avertissement absent d'un seul écran est pire qu'un avertissement absent
// partout : il apprend à faire confiance à son absence.
//
// Posé dans les DEUX layouts (V1 et V2), il couvre chaque écran d'un coup, y
// compris ceux qui n'existent pas encore.
//
// ── CE QU'IL N'EST PAS ──────────────────────────────────────────────────────
//
// Ce n'est PAS une sécurité : il n'empêche rien, il informe. Les droits et
// l'isolation restent l'affaire de la RLS et de `cabinet_id`. Un bandeau qui
// prétendrait protéger donnerait une fausse assurance de plus.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'

/**
 * Rend le ruban si le cabinet de la personne connectée est marqué bac à sable,
 * `null` sinon.
 *
 * ⚠️ En cas de doute, on n'affiche RIEN. Un ruban « démo » qui apparaîtrait par
 * erreur sur le compte du client serait une fausse alerte — et une fausse
 * alerte répétée finit par être ignorée, y compris le jour où elle est vraie.
 */
export async function RubanBacASable() {
  let estBacASable = false

  try {
    const supabase = await createClient()
    const cabinetId = await resoudreCabinetId(supabase)
    const { data } = await supabase
      .from('cabinets')
      .select('est_bac_a_sable, nom')
      .eq('id', cabinetId)
      .maybeSingle()

    estBacASable = Boolean((data as { est_bac_a_sable?: boolean } | null)?.est_bac_a_sable)
  } catch {
    // Une lecture qui échoue ne doit pas empêcher l'écran de s'afficher : la
    // marque est un confort, pas une condition d'accès.
    return null
  }

  if (!estBacASable) return null

  return (
    <div
      role="status"
      aria-label="Vous êtes sur le bac à sable, pas sur le compte du cabinet"
      style={{
        // Style en ligne À DESSEIN : ce ruban est monté dans deux coquilles qui
        // ne partagent aucune feuille de style (V1 en Tailwind, V2 avec ses
        // propres jetons). Dépendre de l'une des deux le rendrait invisible
        // dans l'autre — précisément là où on aurait cessé de le chercher.
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '0.35rem 0.75rem',
        background: 'repeating-linear-gradient(135deg, #b45309, #b45309 12px, #92400e 12px, #92400e 24px)',
        color: '#fff',
        fontSize: '0.8125rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        textAlign: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
      }}
    >
      BAC À SABLE — données de démonstration
      <span style={{ fontWeight: 400, opacity: 0.9 }}>
        · ce n’est pas le compte du cabinet
      </span>
    </div>
  )
}
