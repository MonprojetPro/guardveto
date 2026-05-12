import { type EmailOtpType } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/set-password'

  const redirectTo = new URL(next, request.url)
  const errorRedirect = new URL('/login?error=lien-invalide', request.url)

  if (!token_hash || !type) {
    return NextResponse.redirect(errorRedirect)
  }

  // Dans un Route Handler, les cookies doivent être écrits sur la Response
  const response = NextResponse.redirect(redirectTo)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Déconnecte toute session existante
  await supabase.auth.signOut()

  // Vérifie le token d'invitation et crée la session du nouvel utilisateur
  const { error } = await supabase.auth.verifyOtp({ type, token_hash })

  if (error) {
    return NextResponse.redirect(errorRedirect)
  }

  return response
}
