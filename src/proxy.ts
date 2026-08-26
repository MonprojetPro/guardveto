import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Mode dev : bypass auth — laisser passer sans vérification de session
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Rafraîchit la session — ne pas supprimer cet appel
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isLoginPage = pathname === '/login'
  const isPublicPath = isLoginPage
    || pathname === '/'
    || pathname.startsWith('/_next')
    || pathname.startsWith('/api')
    || pathname.startsWith('/auth/')
    || pathname === '/set-password'

  // Non authentifié → redirige vers /login, EN GARDANT OÙ L'ON ALLAIT.
  //
  // Sans le paramètre `suite`, la destination était perdue : on se connectait
  // et on atterrissait sur l'accueil, quelle qu'ait été l'intention de départ.
  //
  // Ce n'est pas un détail de confort. Le lien de l'APPEL AUX VOLONTAIRES
  // envoyé par e-mail pointe vers `/crise/volontaire?absence=…&garde=…&role=…`.
  // Un vétérinaire qui le reçoit sur son téléphone n'a presque jamais de
  // session ouverte : il cliquait, se connectait, et se retrouvait sur
  // l'accueil sans savoir ce qu'on attendait de lui. Le geste entier — « je
  // prends ce créneau » — était injoignable depuis l'e-mail qui l'invitait.
  // (Trouvé le 2026-08-26 en préparant la recette du dépannage.)
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    const destination = pathname + request.nextUrl.search
    url.pathname = '/login'
    url.search = ''
    // Uniquement un chemin INTERNE. Sans cette borne, un lien fabriqué
    // (`?suite=https://…`) ferait de l'écran de connexion un tremplin vers
    // n'importe quel site, avec la confiance visuelle de GuardVeto derrière.
    if (destination.startsWith('/') && !destination.startsWith('//')) {
      url.searchParams.set('suite', destination)
    }
    return NextResponse.redirect(url)
  }

  // Authentifié sur /login → redirige vers l'accueil (V2 depuis 2026-07-25 ;
  // c'était /planning avant la bascule, l'accueil n'existant pas encore).
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/accueil'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
