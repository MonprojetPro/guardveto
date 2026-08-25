// ============================================================
// GUARDVETO — QUI est connecté ? (B-017, lot 1)
// ============================================================
// Jusqu'au 2026-08-25, la réponse était partout la même, recopiée dans une
// dizaine de pages :
//
//     const { data: moi } = await supabase.from('veterinaires')…single()
//     if (!moi) { await supabase.auth.signOut(); redirect('/login') }
//
// « Je ne te trouve pas dans les vétérinaires » y voulait dire « tu n'existes
// pas » — et la sanction était la déconnexion. C'était juste tant que le seul
// moyen d'avoir un compte était d'être vétérinaire. Depuis que le secrétariat
// existe, cette ligne déconnecterait une secrétaire à chaque page, sans le
// moindre message : elle taperait son mot de passe et retomberait sur l'écran
// de connexion, indéfiniment.
//
// Ce module est donc devenu la SEULE réponse à « qui est connecté ». Il
// cherche d'abord côté vétérinaires — le cas de loin le plus fréquent — puis
// côté secrétariat. Il ne déconnecte JAMAIS de lui-même : déconnecter est une
// décision d'écran, pas de lecture, et un `signOut()` enfoui dans un helper
// est impossible à déboguer.
//
// ⚠️ L'erreur est LUE, jamais avalée. Une base qui ne répond pas ne doit pas
// devenir « ce compte n'existe pas » — c'est la leçon B-011 du 2026-08-24, où
// Filou annonçait « cette personne n'existe pas » sur une panne réseau. Ici la
// conséquence serait pire : une déconnexion en boucle un jour de panne.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import type { Veterinaire } from '@/types'

/** Les trois rôles du produit. `secretaire` est arrivé le 2026-08-25. */
export type RoleConnecte = 'admin' | 'veto' | 'secretaire'

export interface FicheSecretaire {
  id: string
  nom: string
  email: string | null
  cabinet_id: string
}

/**
 * Ce que l'application sait de la personne connectée.
 *
 * Le champ `genre` sépare les deux mondes à la racine : un écran qui a besoin
 * d'un vétérinaire (ses gardes, ses congés, ses compteurs) ne peut pas se
 * tromper, TypeScript l'oblige à vérifier d'abord.
 */
export type Identite =
  | {
      genre: 'veto'
      role: 'admin' | 'veto'
      /** La fiche complète : les écrans existants continuent de s'en servir. */
      veto: Veterinaire
      /** Ce qu'on affiche dans la barre. */
      nomAffiche: string
      cabinetId: string | null
    }
  | {
      genre: 'secretaire'
      role: 'secretaire'
      secretaire: FicheSecretaire
      nomAffiche: string
      cabinetId: string | null
    }

/** Ce qui a empêché de répondre — à distinguer de « ce compte n'est rattaché à rien ». */
export type EchecIdentite = 'non-authentifie' | 'base-muette' | 'sans-rattachement'

export type ResultatIdentite =
  | { ok: true; identite: Identite }
  | { ok: false; raison: EchecIdentite }

/**
 * Résout l'identité du compte connecté, côté serveur.
 *
 * Ne redirige pas, ne déconnecte pas : rend un résultat, et c'est l'écran qui
 * décide quoi en faire. Un helper qui redirige tout seul rend le parcours
 * impossible à suivre quand on cherche pourquoi quelqu'un se retrouve sur la
 * page de connexion.
 */
export async function resoudreIdentite(

  supabase: SupabaseClient<any, any, any>,
): Promise<ResultatIdentite> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, raison: 'non-authentifie' }

  // ── D'abord les vétérinaires ────────────────────────────────────────────
  // `maybeSingle` et non `single` : l'absence de ligne est un cas NORMAL ici
  // (c'est peut-être une secrétaire), pas une erreur. Avec `single`, Supabase
  // renverrait une erreur qu'on ne saurait plus distinguer d'une vraie panne.
  const { data: vetDb, error: erreurVet } = await supabase
    .from('veterinaires')
    .select('*')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  if (erreurVet) {
    console.error('[Identité] Lecture des vétérinaires impossible :', erreurVet.message)
    return { ok: false, raison: 'base-muette' }
  }

  if (vetDb) {
    const vet = vetDb as Veterinaire
    return {
      ok: true,
      identite: {
        genre: 'veto',
        role: vet.role_app === 'admin' ? 'admin' : 'veto',
        veto: vet,
        nomAffiche: vet.prenom,
        cabinetId: (vet as { cabinet_id?: string | null }).cabinet_id ?? null,
      },
    }
  }

  // ── Puis le secrétariat ─────────────────────────────────────────────────
  const { data: secDb, error: erreurSec } = await supabase
    .from('secretaires')
    .select('id, nom, email, cabinet_id')
    .eq('user_id', user.id)
    .eq('actif', true)
    .maybeSingle()

  if (erreurSec) {
    console.error('[Identité] Lecture du secrétariat impossible :', erreurSec.message)
    return { ok: false, raison: 'base-muette' }
  }

  if (secDb) {
    const sec = secDb as FicheSecretaire
    return {
      ok: true,
      identite: {
        genre: 'secretaire',
        role: 'secretaire',
        secretaire: sec,
        // Le nom de la FICHE, qui n'est pas forcément un prénom : chez Val
        // d'Allier ce sera « Secrétariat », trois personnes derrière un seul
        // compte. La barre affiche donc ce que le cabinet a écrit, sans
        // prétendre saluer quelqu'un en particulier.
        nomAffiche: sec.nom,
        cabinetId: sec.cabinet_id,
      },
    }
  }

  return { ok: false, raison: 'sans-rattachement' }
}

/**
 * L'écran accepte TOUT LE MONDE — vétérinaire comme secrétariat — mais exige
 * un compte rattaché. Ne revient pas sinon.
 *
 * C'est le point d'entrée des écrans ouverts aux deux, le planning aujourd'hui.
 * La décision de déconnecter vit ICI et nulle part ailleurs : un `signOut()`
 * recopié dans dix pages finit toujours par se déclencher dans un cas qu'il
 * n'avait pas prévu — c'est exactement ce qui aurait renvoyé une secrétaire à
 * la page de connexion, en boucle et sans message.
 */
export async function exigerIdentite(

  supabase: SupabaseClient<any, any, any>,
): Promise<Identite> {
  const resultat = await resoudreIdentite(supabase)
  if (resultat.ok) return resultat.identite

  // Une base muette ne vaut PAS une déconnexion : une panne passagère
  // obligerait sinon tout le cabinet à ressaisir son mot de passe.
  if (resultat.raison !== 'base-muette') await supabase.auth.signOut()
  redirect('/login')
}

/**
 * L'écran exige un VÉTÉRINAIRE (ou une administratrice). Ne revient pas sinon.
 *
 * Trois issues, et elles ne se confondent pas :
 *   · vétérinaire → l'identité est rendue, l'écran continue ;
 *   · secrétariat → renvoi vers le planning. Ce n'est PAS un compte inconnu,
 *     c'est un compte qui n'a rien à faire là. Le déconnecter — ce que faisait
 *     le code d'avant, faute de savoir qu'elle existait — l'aurait laissée
 *     retaper son mot de passe en boucle sans le moindre message ;
 *   · rien du tout → déconnexion et retour à la connexion, sauf si c'est la
 *     BASE qui n'a pas répondu : une panne passagère ne doit pas obliger tout
 *     le cabinet à ressaisir son mot de passe.
 *
 * C'est ce refus SERVEUR qui ferme réellement les portes. Le dock réduit du
 * secrétariat n'est qu'un confort d'affichage : une porte retirée du menu
 * reste ouverte à qui connaît l'adresse (leçon du projet).
 */
export async function exigerVeterinaire(

  supabase: SupabaseClient<any, any, any>,
): Promise<Extract<Identite, { genre: 'veto' }>> {
  const resultat = await resoudreIdentite(supabase)

  if (resultat.ok) {
    if (resultat.identite.genre === 'veto') return resultat.identite
    redirect('/planning')
  }

  if (resultat.raison !== 'base-muette') await supabase.auth.signOut()
  redirect('/login')
}

/**
 * Vrai si cette identité n'a accès qu'à la consultation.
 *
 * Écrit une seule fois ici plutôt que `role === 'secretaire'` répété dans
 * chaque écran : le jour où un autre profil en lecture seule apparaît, il n'y
 * a qu'un endroit à changer — et surtout, l'intention est lisible.
 */
export function enLectureSeule(identite: Identite): boolean {
  return identite.genre === 'secretaire'
}
