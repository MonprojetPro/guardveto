'use server'

// ============================================================
// B-134 lot 5c — chacun coupe les e-mails qu'il ne veut plus recevoir
// ============================================================
// Une seule action, et elle est PERSONNELLE : elle n'écrit jamais que la ligne
// de la personne connectée. Ce n'est pas seulement la RLS qui l'impose
// (`prefs_notifs_self`) — l'action ne prend pas d'identifiant d'utilisateur en
// argument, donc il n'existe aucun chemin, même buggé, pour couper les e-mails
// d'un collègue.
// ============================================================

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { exigerIdentite } from '@/lib/identite'
import {
  REGLAGES_EMAIL,
  reglagesPourRole,
  type CleReglage,
} from '@/lib/notifications-reglages'

export type ResultatReglageNotif = { success: true } | { error: string }

/**
 * Coupe ou rétablit UN e-mail pour la personne connectée.
 *
 * @param cle    le réglage concerné
 * @param recoit true = je veux le recevoir (on retire la clé des désactivées)
 */
export async function setReceptionEmail(
  cle: CleReglage,
  recoit: boolean,
): Promise<ResultatReglageNotif> {
  const supabase = await createClient()
  const identite = await exigerIdentite(supabase)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Reconnectez-vous.' }

  // ⚠️ DEUX REFUS, ET ILS NE DISENT PAS LA MÊME CHOSE.
  //
  // Le premier : une clé qui n'existe pas dans le catalogue. Sans lui, un appel
  // forgé écrirait n'importe quelle chaîne dans `desactivees` — la colonne est
  // volontairement sans CHECK (voir la migration), donc la base accepterait.
  if (!REGLAGES_EMAIL.some((r) => r.cle === cle)) {
    return { error: 'Ce réglage n’existe pas.' }
  }
  // Le second : une clé réelle mais qui ne concerne pas ce rôle. Un vétérinaire
  // n'a pas à couper les rappels de publication de l'administratrice — l'écran
  // ne le lui propose pas, et le serveur le refuse aussi. Une porte simplement
  // retirée du menu reste ouverte à qui connaît l'adresse.
  if (!reglagesPourRole(identite.role).some((r) => r.cle === cle)) {
    return { error: 'Ce réglage ne concerne pas votre profil.' }
  }

  if (!identite.cabinetId) {
    return { error: 'Cabinet introuvable — réglage non enregistré.' }
  }

  // On relit AVANT d'écrire plutôt que de faire confiance à ce que l'écran
  // croit savoir : deux onglets ouverts, et le second écraserait les choix du
  // premier avec un état périmé.
  const { data: ligne, error: erreurLecture } = await supabase
    .from('preferences_notifications')
    .select('desactivees')
    .eq('user_id', user.id)
    .maybeSingle()

  if (erreurLecture) {
    console.error('[reglages-notifs] Lecture avant écriture en échec:', erreurLecture.message)
    return { error: 'Réglage non enregistré. Réessayez.' }
  }

  const actuelles = new Set<string>((ligne?.desactivees as string[] | null) ?? [])
  if (recoit) actuelles.delete(cle)
  else actuelles.add(cle)

  const { error } = await supabase.from('preferences_notifications').upsert(
    {
      user_id: user.id,
      cabinet_id: identite.cabinetId,
      desactivees: [...actuelles],
      mis_a_jour_le: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (error) {
    console.error('[reglages-notifs] Écriture en échec:', error.message)
    return { error: 'Réglage non enregistré. Réessayez.' }
  }

  revalidatePath('/reglages/notifications')
  return { success: true }
}
