'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  // Mode dev : accès direct sans mot de passe
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    redirect('/planning')
  }

  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'Email ou mot de passe incorrect.' }
  }

  // Vérifie que l'utilisateur a bien un profil vétérinaire lié
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: veto } = await supabase
      .from('veterinaires')
      .select('id, actif')
      .eq('user_id', user.id)
      .single()

    if (!veto || !veto.actif) {
      await supabase.auth.signOut()
      return { error: 'Votre compte n\'est pas encore activé. Contactez l\'administratrice.' }
    }
  }

  redirect('/planning')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
