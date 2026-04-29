import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// ── Mode DEV : bypass auth complet ───────────────────────────
// Activer via DEV_BYPASS_AUTH=true dans .env.local uniquement.
// N'utiliser JAMAIS en production.
const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === 'true'
// user_id lié à Anne-Sophie (admin) dans la table veterinaires
const DEV_USER_ID = '649a9035-5c29-4b47-8dcc-f8fb8e0ff4a6'

export async function createClient() {
  if (DEV_BYPASS) {
    // Service role = bypass RLS + getUser mocké → Anne-Sophie admin
    const client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    // Mock getUser pour que tout le code applicatif fonctionne sans session
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.auth.getUser = async () => ({
      data: { user: { id: DEV_USER_ID } as never },
      error: null,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return client as any
  }

  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignoré dans les Server Components (lecture seule)
          }
        },
      },
    }
  );
}
