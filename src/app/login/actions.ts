'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resoudreIdentite } from '@/lib/identite'

export async function login(formData: FormData) {
  // Mode dev : accès direct sans mot de passe
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    redirect('/accueil')
  }

  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Email ou mot de passe incorrect.' }
  }

  // Le compte est-il rattaché à quelqu'un — vétérinaire OU secrétariat ?
  //
  // Avant le 2026-08-25 cette vérification ne connaissait que les
  // vétérinaires : une secrétaire tapait le bon mot de passe et s'entendait
  // répondre « votre compte n'est pas encore activé », ce qui était faux et
  // sans issue. C'est le même motif que l'incident du 15/08 (un compte auth
  // valide, rejeté par l'application faute d'être reconnu ailleurs).
  const identite = await resoudreIdentite(supabase)

  if (!identite.ok) {
    // On distingue les deux échecs. Dire « compte non activé » sur une panne
    // de base enverrait le cabinet appeler l'administratrice pour rien, un
    // jour où c'est justement le service qui est en cause.
    await supabase.auth.signOut()
    return {
      error:
        identite.raison === 'base-muette'
          ? 'Je n’arrive pas à joindre la base pour le moment. Réessaie dans un instant.'
          : "Votre compte n'est pas encore activé. Contactez l'administratrice.",
    }
  }

  // Le secrétariat n'a pas d'accueil : l'épicentre est le bureau de Filou, et
  // Filou ne lui est pas ouvert (arbitrage MiKL du 25/08). Son écran d'arrivée
  // est le planning, qui est aussi sa raison d'être ici.
  if (identite.identite.genre === 'secretaire') redirect('/planning')

  // Depuis la bascule V2 (2026-07-25), on atterrit sur l'accueil épicentre.
  redirect('/accueil')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function resetPassword(email: string) {
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://guardveto.vercel.app'}/set-password`,
  })
  if (error) return { error: error.message }
  return { success: true }
}
