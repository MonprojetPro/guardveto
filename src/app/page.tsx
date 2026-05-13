'use client'

import { useEffect } from 'react'

export default function Home() {
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('access_token')) {
      // Token auth Supabase dans le hash → transférer vers /auth/callback
      window.location.replace('/auth/callback' + hash)
    } else {
      window.location.replace('/planning')
    }
  }, [])

  return null
}
