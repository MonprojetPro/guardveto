'use client'

// ============================================================
// GUARDVETO — Champ « mot de passe », avec l'œil
// ============================================================
// Un champ masqué sans moyen de relire ce qu'on tape n'est pas une mesure de
// sécurité : c'est une saisie à l'aveugle qu'on refait deux fois. Sur l'écran
// d'invitation, où la personne CHOISIT son mot de passe et doit le confirmer,
// c'est deux frappes exactes exigées sans aucun retour — et un refus « les mots
// de passe ne correspondent pas » qui ne dit pas lequel des deux est fautif.
//
// Le composant existe parce que les DEUX écrans (connexion et définition du mot
// de passe) en ont besoin, et qu'ils partagent déjà tout le reste de leur
// habillage. Un œil sur un seul des deux aurait recréé, à un écran de distance,
// l'incohérence que la refonte de ces pages venait de corriger.
//
// Il accepte les deux façons de faire du projet : piloté par l'état
// (`value`/`onChange`, écran /set-password) ou par le formulaire natif (`name`,
// écran /login, dont la Server Action lit `formData`).
// ============================================================

import { useState } from 'react'

interface Props {
  id: string
  label: string
  /** Saisie pilotée par l'état. Absente = champ de formulaire natif. */
  value?: string
  onChange?: (v: string) => void
  /** Nom du champ pour un envoi de formulaire natif (Server Action). */
  name?: string
  placeholder?: string
  /** `current-password` à la connexion, `new-password` à la définition. */
  autoComplete?: string
  required?: boolean
  autoFocus?: boolean
  disabled?: boolean
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export function ChampMotDePasse({
  id, label, value, onChange, name, placeholder,
  autoComplete = 'current-password',
  required, autoFocus, disabled,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="co-champ">
      <label htmlFor={id}>{label}</label>
      <div className="co-champ-oeil">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
        />
        <button
          type="button"
          className="co-oeil"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          // Le bouton DIT ce qu'il va faire, pas l'état courant : un lecteur
          // d'écran annonce alors une action, pas une devinette.
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          // `tabIndex={-1}` volontaire : au clavier, on passe du mot de passe au
          // bouton d'envoi. L'œil sert à la souris et au tactile, il n'a pas à
          // s'intercaler dans le parcours de saisie — il reste atteignable par
          // le lecteur d'écran via son rôle.
          tabIndex={-1}
        >
          {visible ? (
            // Œil barré — « en cliquant, je masque ».
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 002.8 2.8" />
              <path d="M9.4 5.2A9.3 9.3 0 0112 5c4.6 0 8.3 3.6 9.5 7a12 12 0 01-2.3 3.5" />
              <path d="M6.2 6.7A12.3 12.3 0 002.5 12c1.2 3.4 4.9 7 9.5 7a9.6 9.6 0 003.9-.8" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M2.5 12C3.7 8.6 7.4 5 12 5s8.3 3.6 9.5 7c-1.2 3.4-4.9 7-9.5 7s-8.3-3.6-9.5-7z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}
