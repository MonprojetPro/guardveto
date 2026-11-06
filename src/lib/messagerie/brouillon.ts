// ============================================================
// GUARDVETO — Le brouillon d'un message survit a la fermeture (B-193)
// ============================================================
// Repris du kit `fil-de-discussion-complet` (installation WF base/kits) : dans
// les six implementations d'ou il est extrait, le texte tape mais non envoye
// vivait dans un simple etat local. Changer d'ecran, et un message long ecrit
// avec soin disparaissait sans un mot.
//
// Fichier PUR : le stockage est injectable, donc testable sans navigateur.
// ============================================================

export interface StockageBrouillon {
  getItem: (cle: string) => string | null
  setItem: (cle: string, valeur: string) => void
  removeItem: (cle: string) => void
}

interface BrouillonStocke {
  corps: string
  le: string
}

/** Au-dela, un brouillon est considere comme abandonne. */
export const AGE_MAX_BROUILLON_MS = 7 * 24 * 60 * 60 * 1000

function cle(conversationId: string): string {
  return `gv-messagerie-brouillon:${conversationId}`
}

/** Un texte vide EFFACE l'entree : on ne propose jamais de « restaurer » du vide. */
export function enregistrerBrouillon(
  stockage: StockageBrouillon,
  conversationId: string,
  corps: string,
  maintenant: () => Date = () => new Date(),
): void {
  try {
    if (!corps.trim()) {
      stockage.removeItem(cle(conversationId))
      return
    }
    const valeur: BrouillonStocke = { corps, le: maintenant().toISOString() }
    stockage.setItem(cle(conversationId), JSON.stringify(valeur))
  } catch {
    // Stockage plein ou refuse (navigation privee) : perdre la sauvegarde est
    // regrettable, faire tomber la zone de saisie le serait davantage.
  }
}

/** Relit le brouillon ; `null` s'il est absent, illisible ou trop ancien. */
export function lireBrouillon(
  stockage: StockageBrouillon,
  conversationId: string,
  maintenant: () => Date = () => new Date(),
): string | null {
  let brut: string | null
  try {
    brut = stockage.getItem(cle(conversationId))
  } catch {
    return null
  }
  if (!brut) return null
  try {
    const lu = JSON.parse(brut) as Partial<BrouillonStocke>
    const age = typeof lu.le === 'string' ? maintenant().getTime() - new Date(lu.le).getTime() : NaN
    if (typeof lu.corps !== 'string' || !lu.corps.trim() || Number.isNaN(age) || age > AGE_MAX_BROUILLON_MS) {
      stockage.removeItem(cle(conversationId))
      return null
    }
    return lu.corps
  } catch {
    // Un JSON corrompu laisse en place ferait echouer toutes les relectures.
    try {
      stockage.removeItem(cle(conversationId))
    } catch {
      // rien de plus a faire
    }
    return null
  }
}

/** A appeler APRES confirmation de l'envoi par le serveur, jamais avant. */
export function effacerBrouillon(stockage: StockageBrouillon, conversationId: string): void {
  try {
    stockage.removeItem(cle(conversationId))
  } catch {
    // sans consequence
  }
}
