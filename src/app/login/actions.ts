'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resoudreIdentite } from '@/lib/identite'

/**
 * La destination demandée avant la connexion, si elle est sûre.
 *
 * `suite` est posé par le middleware quand quelqu'un tombe sur la connexion en
 * voulant aller ailleurs — typiquement le lien d'appel aux volontaires reçu par
 * e-mail. On ne lui fait AUCUNE confiance : seul un chemin interne est accepté.
 * Sans ce filtre, `?suite=https://…` ferait de notre écran de connexion un
 * tremplin vers n'importe quel site, avec notre habillage pour caution.
 */
function suiteSure(formData: FormData): string | null {
  const brut = (formData.get('suite') as string | null)?.trim()
  if (!brut) return null
  // `//exemple.com` est une URL absolue déguisée : le navigateur y voit un
  // autre domaine. C'est le contournement classique d'un test naïf sur « / ».
  if (!brut.startsWith('/') || brut.startsWith('//')) return null
  // On ne renvoie pas non plus vers la connexion elle-même : on tournerait.
  if (brut.startsWith('/login')) return null
  return brut
}

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

  // On revient là où la personne allait, si elle allait quelque part. C'est ce
  // qui rend le lien de l'appel aux volontaires utilisable depuis un e-mail.
  const suite = suiteSure(formData)
  if (suite) redirect(suite)

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
