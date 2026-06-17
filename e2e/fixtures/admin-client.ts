import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ════════════════════════════════════════════════════════════════
// GUARDVETO — Client Supabase service_role pour le provisioning E2E
// ════════════════════════════════════════════════════════════════
// Le service_role BYPASSE la RLS et donne accès à l'API admin Auth
// (auth.admin.createUser / deleteUser). Réservé au setup/teardown.
//
// 🔑 Clés lues UNIQUEMENT depuis l'environnement (.env.local du projet,
//    chargé par Next pour le webServer ; ici on les lit via process.env).
//    JAMAIS de clé en dur. On échoue explicitement si une clé manque.
// ════════════════════════════════════════════════════════════════

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error(
      '[E2E] NEXT_PUBLIC_SUPABASE_URL manquant. Renseigne-le dans .env.local.'
    )
  }
  if (!serviceRoleKey) {
    throw new Error(
      '[E2E] SUPABASE_SERVICE_ROLE_KEY manquant. Renseigne-le dans .env.local '
      + '(clé service_role — nécessaire pour provisionner les cabinets de test).'
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
