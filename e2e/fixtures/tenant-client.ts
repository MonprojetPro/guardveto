import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Client Supabase "tenant" (anon + session réelle)
// ════════════════════════════════════════════════════════════════
// Crée un client avec la clé ANON (la même que le navigateur de l'app),
// puis se connecte avec les identifiants d'un user de test. Le JWT
// résultant porte app_metadata.cabinet_id → les requêtes passent par la
// RLS EXACTEMENT comme dans l'app.
//
// C'est l'outil clé du test d'isolation multi-tenant : on interroge la
// base AVEC le contexte d'un utilisateur réel et on vérifie que la RLS
// ne renvoie QUE les lignes de son cabinet.
//
// Clés lues depuis l'environnement uniquement (jamais en dur).
// ════════════════════════════════════════════════════════════════

export async function signInTenantClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      '[E2E] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquants.'
    )
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`[E2E] signIn tenant ${email} a échoué: ${error.message}`)
  }
  return client
}
