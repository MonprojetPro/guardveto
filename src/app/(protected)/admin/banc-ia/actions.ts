'use server'

// ============================================================
// GUARDVETO — Banc d'essai des modèles IA (écran d'administration)
// ============================================================
// La clé API est marquée « sensible » sur Vercel : elle ne se lit qu'à
// l'exécution côté serveur, et n'est récupérable ni par la CLI ni par le
// dashboard. Mesurer le coût de Filou depuis un poste de travail est donc
// impossible — d'où cet écran, qui fait la mesure LÀ OÙ la clé vit.
//
// ⚠️ CET APPEL COÛTE DE L'ARGENT : 3 comptages (gratuits) + 12 appels facturés,
// de l'ordre de 30 à 40 centimes par exécution. Admin-only, et l'écran annonce
// le coût avant de lancer.
//
// Écran JETABLE : il sert à trancher le choix de modèle, pas à rester. À
// supprimer une fois la décision prise.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { chargerContexteIA } from '@/lib/ia/contexteCabinet'
import { lancerBancEssai, type ResultatBanc } from '@/lib/ia/bancEssai'

export type ResultatBancAction = { error: string } | { resultat: ResultatBanc }

/**
 * Lance le banc d'essai. Admin-only : la garde est ici, côté serveur — masquer
 * l'écran ne protégerait rien.
 */
export async function lancerBanc(): Promise<ResultatBancAction> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée — reconnecte-toi.' }

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  if (moi?.role_app !== 'admin') {
    return { error: 'Réservé aux administrateurs du cabinet.' }
  }

  if (!assistantIaDisponible()) {
    return { error: 'Assistant IA non configuré (clé API manquante côté serveur).' }
  }

  try {
    const ctx = await chargerContexteIA(supabase)
    const resultat = await lancerBancEssai(ctx)
    return { resultat }
  } catch (e) {
    // On rend l'erreur brute : sur un banc de mesure, une erreur d'API
    // maquillée en « une erreur est survenue » ne sert à rien.
    return { error: e instanceof Error ? e.message : 'Erreur inconnue pendant la mesure.' }
  }
}
