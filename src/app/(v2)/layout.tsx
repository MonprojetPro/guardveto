// ============================================================
// GUARDVETO V2 — Coquille des écrans « Terrier chaleureux »
// ============================================================
// La V2 vit dans son propre groupe de routes : elle a sa feuille de style, sa
// barre et son décor, et ne partage RIEN avec la coquille V1 (Sidebar/Header).
// Les deux cohabitent le temps de la bascule, écran par écran ; c'est ce qui
// permet de refaire l'accueil sans casser le planning qui marche.
//
// La feuille `v2-terrier.css` n'est importée QUE d'ici : Next l'attache au
// segment, donc les écrans V1 ne la chargent pas.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RubanBacASable } from '@/components/RubanBacASable'
import { chantierOuvertPourLeCabinet } from '@/lib/produit/chantiers-serveur'
import '@/styles/v2-terrier.css'
// L'écran de relecture d'un ancien planning importé (déposé dans la
// conversation de Filou, affiché sur le tableau).
import '@/styles/v2-import.css'
// Le socle téléphone (B-179) : EN DERNIER, il corrige ce qui précède.
import '@/styles/v2-mobile.css'
// Le système de boutons « Relief » (B-206). Importé pour tous, mais chacune de
// ses règles exige l'attribut `data-boutons` posé plus bas : sans lui, la
// feuille ne s'applique à rien.
import '@/styles/v2-boutons.css'

export default async function LayoutV2({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Le ruban est posé ICI, au-dessus de tout : les huit écrans V2 le portent
  // d'un coup, et le neuvième l'aura sans qu'on y pense (B-090).
  // B-206 — la porte de chantier décide, cabinet par cabinet. Fermée (ou
  // illisible), l'attribut est absent et les boutons restent ceux d'avant.
  const boutonsRelief = await chantierOuvertPourLeCabinet(supabase, 'boutons-relief')

  return (
    <div className="v2" data-boutons={boutonsRelief ? 'relief' : undefined}>
      <RubanBacASable />
      {children}
    </div>
  )
}
