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
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { chargerContexteIA } from '@/lib/ia/contexteCabinet'
import { lancerBancEssai, type ResultatBanc } from '@/lib/ia/bancEssai'
import { lancerBancRecette, type ResultatRecette } from '@/lib/ia/bancRecette'
import { controlerCoherence, type RapportCoherence } from '@/lib/ia/controleCoherence'
import {
  lancerBancRelecture,
  type ResultatBancRelecture,
} from '@/lib/ia/bancRelecture'

export type ResultatBancAction = { error: string } | { resultat: ResultatBanc }
export type ResultatBancRelectureAction =
  | { error: string }
  | { resultat: ResultatBancRelecture }
export type ResultatRecetteAction = { error: string } | { resultat: ResultatRecette }
export type RapportCoherenceAction = { error: string } | { rapport: RapportCoherence }

/**
 * Lance le banc d'essai. Admin-only : la garde est ici, côté serveur — masquer
 * l'écran ne protégerait rien.
 */
export async function lancerBanc(
  jeu: 'rapide' | 'complet' = 'rapide',
): Promise<ResultatBancAction> {
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
    const resultat = await lancerBancEssai(ctx, { jeu })
    return { resultat }
  } catch (e) {
    // On rend l'erreur brute : sur un banc de mesure, une erreur d'API
    // maquillée en « une erreur est survenue » ne sert à rien.
    return { error: e instanceof Error ? e.message : 'Erreur inconnue pendant la mesure.' }
  }
}

/**
 * Lance le banc de RECETTE : Filou répond-il juste aux vraies questions du
 * cabinet ? (Le banc ci-dessus, lui, mesure le coût des modèles.)
 *
 * Il tourne avec les droits de la personne connectée — donc en admin, sur son
 * cabinet et son catalogue d'outils réels. Un banc qui s'exécuterait avec des
 * droits élargis validerait un Filou que personne n'utilise.
 */
export async function lancerRecetteFilou(): Promise<ResultatRecetteAction> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée — reconnecte-toi.' }

  const { data: moi } = await supabase
    .from('veterinaires')
    .select('id, role_app, prenom, nom')
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
    const cabinetId = await resoudreCabinetId(supabase)
    const resultat = await lancerBancRecette({
      supabase,
      vetoId: (moi as { id: string }).id,
      // Le banc rejoue de vraies conversations : il doit porter la même
      // identité que l'écran, sinon il teste un Filou qui n'existe pas (B-040).
      prenom: (moi as { prenom?: string }).prenom ?? '',
      nom: (moi as { nom?: string }).nom ?? '',
      estAdmin: true,
      cabinetId,
    })
    return { resultat }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue pendant la recette.' }
  }
}

/**
 * Banc de mesure de la RELECTURE (B-089) — modèle et application mis en
 * concurrence sur le MÊME planning.
 *
 * ⚠️ CET APPEL COÛTE DE L'ARGENT : 4 relectures complètes, de l'ordre de 20 à
 * 40 centimes par exécution selon la taille de la période. L'écran annonce le
 * coût avant de lancer.
 *
 * ⚠️ IL N'ÉCRIT RIEN — contrairement à la vraie relecture, il ne fait pas
 * arbitrer les propositions et ne touche pas au planning. C'est pour ça qu'il
 * accepte une période PUBLIÉE, là où la route la refuse : la règle « on ne
 * retouche pas ce que l'équipe a sous les yeux » protège l'écriture, et il n'y
 * en a aucune ici. L'exiger en brouillon aurait rendu le banc inutilisable le
 * jour où il sert — Hiver P1 est publié depuis le 27/08.
 */
export async function lancerBancRelectureAction(
  periodeId?: string,
): Promise<ResultatBancRelectureAction> {
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
    const cabinetId = await resoudreCabinetId(supabase)

    // Sans période explicite, on prend la plus récente QUI A DES GARDES.
    // « La plus récente » tout court tomberait sur une période vide et le banc
    // mesurerait quatre modèles sur un planning sans rien à relire.
    let cible = periodeId
    if (!cible) {
      const { data: periodes } = await supabase
        .from('periodes')
        .select('id, libelle, date_debut, gardes(id)')
        .eq('cabinet_id', cabinetId)
        .order('date_debut', { ascending: false })

      const lignes = (periodes ?? []) as unknown as { id: string; gardes?: unknown[] }[]
      const avecGardes = lignes.find((p) => (p.gardes?.length ?? 0) > 0)
      if (!avecGardes) {
        return { error: 'Aucune période avec des gardes à relire sur ce cabinet.' }
      }
      cible = (avecGardes as { id: string }).id
    }

    return { resultat: await lancerBancRelecture(supabase, cible, cabinetId) }
  } catch (e) {
    // Erreur brute : sur un banc de mesure, un « une erreur est survenue » ne
    // sert à rien.
    return { error: e instanceof Error ? e.message : 'Erreur inconnue pendant la mesure.' }
  }
}

/**
 * Contrôle de cohérence — GRATUIT : aucun appel au modèle, que des lectures en
 * base. C'est lui qui a trouvé les vrais trous du 29 juillet, pendant que le
 * banc payant passait 5/5. À lancer sans compter.
 */
export async function lancerControleCoherence(): Promise<RapportCoherenceAction> {
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

  try {
    const cabinetId = await resoudreCabinetId(supabase)
    return { rapport: await controlerCoherence(supabase, cabinetId) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue pendant le contrôle.' }
  }
}
