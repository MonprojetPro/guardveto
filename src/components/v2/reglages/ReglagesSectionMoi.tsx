'use client'

// ============================================================
// GUARDVETO — Réglages refondus : la section « Pour moi » (B-202)
// ============================================================
// Les réglages qui ne valent que pour la personne connectée : les e-mails
// qu'elle reçoit, et son agenda Google (là où la fonction est ouverte).
// Avant, deux cartes renvoyaient vers deux autres pages ; ils vivent ici.
//
// Rien n'est recopié : l'enregistrement des e-mails passe par
// `useReceptionEmails` et l'agenda est `MonAgendaCorps`, le contenu même de
// la page validée en B-181 (ces deux anciennes pages ne sont plus que des
// renvois ici depuis B-202b).
// Chaque réglage part seul, au clic : pas de bouton « Enregistrer » à oublier.
// ============================================================

import { useState } from 'react'
import { Bell, Info } from 'lucide-react'
import { useReceptionEmails, type LigneReglage } from '@/components/v2/useReceptionEmails'
import { MonAgendaCorps, type DonneesMonAgenda } from '@/components/v2/MonAgendaCorps'
import type { RoleReglages } from '@/lib/reglages/coquille'
import { Bloc, Interrupteur } from './ReglagesCommun'

export interface DonneesSectionMoi {
  notifications: LigneReglage[]
  /** `null` là où « Mon agenda » n'est pas ouvert : le bloc n'apparaît pas. */
  agenda: DonneesMonAgenda | null
}

function MesNotifications({ reglages, role }: { reglages: LigneReglage[]; role: RoleReglages }) {
  const { etats, enCours, basculer } = useReceptionEmails(reglages)
  const [ouverte, setOuverte] = useState<string | null>(null)

  if (reglages.length === 0) {
    // Le secrétariat n'est destinataire d'aucun e-mail du produit (B-017) :
    // des interrupteurs qui ne commandent rien lui feraient croire qu'il a
    // réglé quelque chose. Une phrase honnête vaut mieux.
    return (
      <p className="rg-vide">
        {role === 'secretaire'
          ? 'Aucun e-mail automatique ne vous est adressé.'
          : 'Aucun e-mail automatique ne concerne votre profil pour le moment.'}
      </p>
    )
  }

  return (
    <>
      {reglages.map((r) => {
        const ouvert = ouverte === r.cle
        return (
          <div key={r.cle}>
            <div className="rg-rang">
              <span className="rg-rang-lib">
                {r.libelle}
                <button
                  type="button"
                  className="rg-info"
                  aria-label="Quand cet e-mail part"
                  aria-expanded={ouvert}
                  aria-controls={`rg-quand-${r.cle}`}
                  onClick={() => setOuverte(ouvert ? null : r.cle)}
                >
                  <Info className="rg-ico sm" aria-hidden="true" />
                </button>
              </span>
              <Interrupteur
                actif={etats[r.cle] ?? true}
                libelle={r.libelle}
                desactive={enCours}
                onBasculer={(v) => basculer(r.cle, v)}
              />
            </div>
            <p id={`rg-quand-${r.cle}`} className="rg-info-txt" hidden={!ouvert}>{r.explication}</p>
          </div>
        )
      })}
      {/* Pas une politesse : sans elle, qui décoche tout se croit injoignable. */}
      <p className="rg-note">
        <Bell className="rg-ico sm" aria-hidden="true" />
        <span>La cloche reste active : seul l’e-mail se coupe.</span>
      </p>
    </>
  )
}

export function ReglagesSectionMoi({ notifications, agenda, role }: DonneesSectionMoi & { role: RoleReglages }) {
  return (
    <div className="rg-panneau">
      <Bloc titre="Mes notifications">
        <MesNotifications reglages={notifications} role={role} />
      </Bloc>
      {agenda && (
        <Bloc titre="Mon agenda">
          <div className="rg-agenda">
            <MonAgendaCorps {...agenda} />
          </div>
        </Bloc>
      )}
    </div>
  )
}
