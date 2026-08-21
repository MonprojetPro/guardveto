'use client'

// ============================================================
// GUARDVETO — DÉFINIR SON MOT DE PASSE (suite de l'invitation)
// ============================================================
// Même parcours que `/login`, donc même habillage : traiter l'un sans
// l'autre recréerait à un écran de distance l'incohérence qu'on vient
// de corriger. Pas de panneau d'identité ici (`.co-scene.seule`) : on
// arrive par un lien d'invitation, on sait déjà où on est.
// La logique (session, RPC `marquer_invite_complete`, redirection) est
// inchangée — seule la présentation bouge.
// ============================================================

import { useState, useTransition, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Satin } from '@/components/v2/Satin'
import '@/styles/v2-terrier.css'
import '@/styles/v2-connexion.css'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const supabase = createClient()
    const hash = window.location.hash

    // Cas 1 : hash avec access_token (reset direct ou fallback)
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.slice(1))
      const access_token = params.get('access_token') ?? ''
      const refresh_token = params.get('refresh_token') ?? ''

      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).then(({ error: err }) => {
          if (err) {
            window.location.href = '/login?error=' + encodeURIComponent(err.message)
            return
          }
          // Nettoie le hash de l'URL
          window.history.replaceState({}, '', window.location.pathname)
          setReady(true)
        })
        return
      }
    }

    // Cas 2 : session déjà en cookie (venant de /auth/callback ou /auth/confirm)
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.href = '/login'
        return
      }
      setReady(true)
    })
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }

    startTransition(async () => {
      const supabase = createClient()

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError(updateError.message); return }

      // invite_pending est mis à jour côté serveur via RPC SECURITY DEFINER :
      // la RLS de `veterinaires` réserve l'UPDATE aux admins, donc un véto ne
      // peut pas modifier sa fiche directement (la fonction borne sur auth.uid()).
      //
      // ⚠️ On LIT le retour. Cet appel était un `await` nu, et Supabase RETOURNE
      // ses erreurs au lieu de les lever : quand la fonction s'est avérée absente
      // de la base (migration 013 jamais jouée), l'échec n'a alerté personne et
      // tout véto ayant défini son mot de passe est resté affiché « Invitation
      // envoyée » — pendant deux mois, jusqu'au 2026-08-21.
      //
      // Le mot de passe, lui, EST enregistré : on ne bloque donc pas l'entrée
      // dans l'app pour une pastille de statut. On trace, et on continue.
      const { error: rpcError } = await supabase.rpc('marquer_invite_complete')
      if (rpcError) {
        console.error(
          `[set-password] marquer_invite_complete a échoué (${rpcError.message}) — `
          + `la fiche restera affichée « Invitation envoyée ». La migration 013 est-elle appliquée ?`,
        )
      }

      window.location.href = '/planning'
    })
  }

  if (!ready) {
    return (
      <div className="v2 co-page">
        <Satin />
        <p className="co-attente">
          <span className="co-spin" aria-hidden="true" />
          Connexion en cours…
        </p>
      </div>
    )
  }

  return (
    <div className="v2 co-page">
      <Satin />

      <main className="co-scene seule">
        <div>
          <div className="co-entete-fixe">
            <span className="co-binette">
              {/* eslint-disable-next-line @next/next/no-img-element -- pièce à
                  alpha servie telle quelle, comme dans la barre de l'app. */}
              <img src="/filou/filou-tete.webp" alt="" width={44} height={44} />
            </span>
            <span className="co-nom">
              Guard<em>Veto</em>
            </span>
          </div>

          <section className="co-carte">
            <h1>Définir mon mot de passe</h1>
            <p className="co-sous">Choisissez un mot de passe pour accéder à GuardVeto</p>

            <form onSubmit={handleSubmit} className="co-form">
              <div className="co-champ">
                <label htmlFor="password">Mot de passe</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                  required
                  autoFocus
                  autoComplete="new-password"
                  disabled={isPending}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'co-erreur' : undefined}
                />
              </div>

              <div className="co-champ">
                <label htmlFor="confirm">Confirmer le mot de passe</label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Répétez le mot de passe"
                  required
                  autoComplete="new-password"
                  disabled={isPending}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'co-erreur' : undefined}
                />
              </div>

              {error && (
                <p className="co-refus" id="co-erreur" role="alert">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5v5.2M12 16.3v.2" />
                  </svg>
                  {error}
                </p>
              )}

              <button type="submit" className="co-valider" disabled={isPending}>
                {isPending && <span className="co-spin" aria-hidden="true" />}
                {isPending ? 'Enregistrement...' : 'Valider le mot de passe'}
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}
