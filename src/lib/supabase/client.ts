import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    // `.trim()` : une variable collée dans l'interface Vercel embarque souvent
    // un retour à la ligne invisible qui rend l'URL ou la clé inutilisable.
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim()
  );
}
