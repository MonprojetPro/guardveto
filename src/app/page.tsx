'use client'

import { useEffect } from 'react'

export default function Home() {
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('access_token')) {
      // Token auth Supabase dans le hash → transférer vers /auth/callback
      window.location.replace('/auth/callback' + hash)
    } else {
      // Depuis la bascule V2 (2026-07-25), la racine ouvre l'accueil épicentre
      // et non plus directement le planning.
      window.location.replace('/accueil')
    }
  }, [])

  return null
}
