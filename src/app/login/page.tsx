'use client'

// ============================================================
// GUARDVETO — LA PORTE DU TERRIER (connexion)
// ============================================================
// Premier écran du produit, et le seul qui soit resté en V1 quand tout
// le reste est passé au « Terrier chaleureux » : aplat bleu canard sur
// la moitié gauche, carte blanche, bouton pleine largeur bleu. Il est
// ici accordé au reste — mêmes surfaces, mêmes rayons, mêmes ombres,
// même encre renarde, et Filou qui accueille à l'entrée.
//
// La logique n'a pas bougé d'une ligne : `actions.ts` (login /
// resetPassword), les champs, les messages et les enchaînements sont
// ceux d'avant. Seule la présentation change.
//
// Les deux feuilles sont importées ici parce que `/login` vit hors du
// groupe de routes (v2) — il ne peut pas, il redirige vers lui-même.
// ============================================================

import { useState, useTransition } from 'react'
import { login, resetPassword } from './actions'
import { Satin } from '@/components/v2/Satin'
import { Calendar, Shield } from 'lucide-react'
import '@/styles/v2-terrier.css'
import '@/styles/v2-connexion.css'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('error')
  })
  const [resetSent, setResetSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      const result = await login(formData)
      if (result?.error) {
        setError(result.error)
      }
    })
  }

  return (
    <div className="v2 co-page">
      <Satin />

      <main className="co-scene">
        {/* ── Le panneau d'identité — posé sur le satin, pas un aplat ── */}
        <section className="co-marque">
          <div className="co-lockup">
            <span className="co-binette">
              {/* eslint-disable-next-line @next/next/no-img-element -- pièce à
                  alpha servie telle quelle, comme dans la barre de l'app. */}
              <img src="/filou/filou-tete.webp" alt="" width={44} height={44} />
            </span>
            <span className="co-nom">
              Guard<em>Veto</em>
            </span>
          </div>

          {/* Slogan, pas titre de section : `Connexion` reste le seul h1 de
              l'écran, et l'ordre des titres ne part pas à l'envers. */}
          <div className="co-accroche">
            <p className="co-titre">
              Les gardes,
              <br />
              organisées.
            </p>
            <p className="co-lede">
              Planning des gardes vétérinaires — génération automatique, publication et suivi
              des compteurs.
            </p>
          </div>

          <ul className="co-points">
            {[
              { icon: Calendar, label: "Planning mensuel en un coup d'oeil" },
              { icon: Shield, label: 'Règles de répartition respectées' },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="co-point">
                <span className="co-ico">
                  <Icon strokeWidth={1.8} />
                </span>
                {label}
              </li>
            ))}
          </ul>

          {/* Filou accoudé au rebord : il tient la porte. */}
          <div>
            <div className="co-filou">
              {/* eslint-disable-next-line @next/next/no-img-element -- pièce
                  découpée dont le cadrage dépend de l'alpha natif (cf. CSS). */}
              <img src="/filou/filou-pose-fixe.webp" alt="" />
            </div>
            <div className="co-rebord" />
          </div>

          <p className="co-pied">Cabinet vétérinaire — accès réservé</p>
        </section>

        {/* ── La carte : le seul objet posé sur le satin ── */}
        <div>
          {/* En écran étroit, le panneau disparaît : l'identité repasse ici. */}
          <div className="co-entete">
            <div className="co-lockup">
              <span className="co-binette">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/filou/filou-tete.webp" alt="" width={44} height={44} />
              </span>
              <span className="co-nom">
                Guard<em>Veto</em>
              </span>
            </div>
            <p className="co-lede">Planning des gardes vétérinaires</p>
          </div>

          <section className="co-carte">
            <p className="co-kicker">Bienvenue</p>
            <h1>Connexion</h1>
            <p className="co-sous">Entrez vos identifiants pour accéder au planning.</p>

            <form onSubmit={handleSubmit} className="co-form">
              <div className="co-champ">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="prenom@cabinet.fr"
                  required
                  autoComplete="email"
                  disabled={isPending}
                  aria-describedby={error ? 'co-erreur' : undefined}
                />
              </div>

              <div className="co-champ">
                <label htmlFor="password">Mot de passe</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  disabled={isPending}
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
                {isPending ? 'Connexion en cours…' : 'Se connecter'}
              </button>
            </form>

            <p className="co-pied-carte">
              {resetSent ? (
                <span className="co-envoye">Email de réinitialisation envoyé.</span>
              ) : (
                <button
                  type="button"
                  className="co-lien"
                  disabled={isPending}
                  onClick={() => {
                    const email = (document.getElementById('email') as HTMLInputElement)?.value
                    if (!email) { setError('Entrez votre email puis cliquez sur ce lien.'); return }
                    startTransition(async () => {
                      const result = await resetPassword(email)
                      if (result?.error) { setError(result.error); return }
                      setResetSent(true)
                    })
                  }}
                >
                  Mot de passe oublié ?
                </button>
              )}
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
