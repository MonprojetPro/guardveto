'use client'

// ============================================================
// GUARDVETO — DÉFINIR SON MOT DE PASSE (suite de l'invitation)
// ============================================================
// Même parcours que `/login`, donc même habillage : traiter l'un sans
// l'autre recréerait à un écran de distance l'incohérence qu'on vient
// de corriger. Pas de panneau d'identité ici (`.co-scene.seule`) : on
// arrive par un lien d'invitation, on sait déjà où on est.
// Depuis B-201 (10/11), c'est une PORTE OBLIGÉE : `proxy.ts` renvoie ici
// toute session ouverte par un lien tant qu'aucun mot de passe ne l'a
// confirmée. Valider = enregistrer le mot de passe PUIS se reconnecter avec.
// ============================================================

import { useState, useTransition, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Satin } from '@/components/v2/Satin'
import { ChampMotDePasse } from '@/components/v2/ChampMotDePasse'
import { logout } from '@/app/login/actions'
import '@/styles/v2-terrier.css'
import '@/styles/v2-connexion.css'
import '@/styles/v2-boutons.css'
import { chantierOuvert } from '@/lib/produit/chantiers'

// B-206 — le dessin « Relief » des boutons. Avant la connexion il n'y a pas de
// cabinet : la porte de chantier ne peut donc s'ouvrir ici que si le chantier
// est ouvert à TOUS les cabinets (jamais pour un bac à sable seul).
const BOUTONS = chantierOuvert('boutons-relief', { estBacASable: false }) ? 'relief' : undefined

/** Les refus de Supabase arrivent en anglais : on traduit ceux qu'on connaît. */
function messageErreurMotDePasse(code: string | undefined, brut: string): string {
  if (code === 'weak_password') return 'Ce mot de passe est trop simple. Choisissez-en un plus long ou plus varié.'
  // Session ouverte depuis plus de 24 h, quand Supabase exige alors une
  // ré-authentification (cas des sessions par lien qui durent depuis octobre).
  if (code === 'session_not_found' || code === 'session_expired' || code === 'reauthentication_needed') {
    return 'Votre lien a expiré. Déconnectez-vous ci-dessous, puis demandez un nouveau lien avec « Mot de passe oublié » sur la page de connexion.'
  }
  return brut
}

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

      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) {
        window.location.href = '/login'
        return
      }

      // « Même mot de passe qu'avant » n'est pas un échec : quelqu'un qui en
      // avait déjà un et le retape a raison, on le reconnecte avec (B-201).
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError && updateError.code !== 'same_password') {
        setError(messageErreurMotDePasse(updateError.code, updateError.message))
        return
      }

      // ⚠️ B-201 — On SE RECONNECTE avec le mot de passe choisi. Sans ce pas,
      // la session reste « ouverte par un lien » : le gardien des pages
      // (`proxy.ts`) renverrait ici en boucle. C'est aussi la seule preuve que
      // le mot de passe enregistré ouvre vraiment la porte — avant, on pouvait
      // repartir de cette page en croyant être inscrit sans l'être.
      const { error: connexionError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      })
      if (connexionError) {
        setError(
          "Le mot de passe est enregistré, mais la connexion avec lui a échoué. Retournez sur la page de connexion et utilisez-le.",
        )
        return
      }

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

      // B-203 — Même principe pour le secrétariat : la fiche passe « Compte
      // actif ». La base ne l'accepte que d'une session ouverte PAR MOT DE
      // PASSE (celle qu'on vient d'ouvrir) ; pour un véto, elle ne fait rien.
      const { error: rpcSecretariat } = await supabase.rpc('marquer_mot_de_passe_secretaire')
      if (rpcSecretariat) {
        console.error(`[set-password] marquer_mot_de_passe_secretaire a échoué (${rpcSecretariat.message})`)
      }

      window.location.href = '/planning'
    })
  }

  if (!ready) {
    return (
      <div className="v2 co-page" data-boutons={BOUTONS}>
        <Satin />
        <p className="co-attente">
          <span className="co-spin" aria-hidden="true" />
          Connexion en cours…
        </p>
      </div>
    )
  }

  return (
    <div className="v2 co-page" data-boutons={BOUTONS}>
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
            <p className="co-sous">
              Dernière étape : choisissez le mot de passe qui vous servira aux prochaines connexions.
            </p>

            <form onSubmit={handleSubmit} className="co-form">
              {/* L'œil compte double ici : on CHOISIT un mot de passe, et on
                  doit le retaper à l'identique. Sans lui, deux frappes exactes
                  à l'aveugle, et un refus qui ne dit pas laquelle est fautive. */}
              <ChampMotDePasse
                id="password"
                label="Mot de passe"
                value={password}
                onChange={setPassword}
                placeholder="8 caractères minimum"
                required
                autoFocus
                autoComplete="new-password"
                disabled={isPending}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'co-erreur' : undefined}
              />

              <ChampMotDePasse
                id="confirm"
                label="Confirmer le mot de passe"
                value={confirm}
                onChange={setConfirm}
                placeholder="Répétez le mot de passe"
                required
                autoComplete="new-password"
                disabled={isPending}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'co-erreur' : undefined}
              />

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

            {/* B-201 — Cette page est désormais une porte obligée : quelqu'un qui
                tombe ici sur le compte d'un autre (poste partagé du cabinet)
                doit pouvoir en sortir sans fermer le navigateur. */}
            <form action={logout} className="co-pied-carte">
              <button type="submit" className="co-lien" disabled={isPending}>
                Ce n’est pas votre compte ? Se déconnecter
              </button>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}
