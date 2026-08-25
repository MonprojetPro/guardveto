'use client'

// ============================================================
// GUARDVETO V2 — La barre : la binette de Filou, le dock, le compte
// ============================================================
// Au repos, le dock n'affiche que des icônes ; l'entrée survolée SE DÉPLIE et
// son libellé glisse à côté. Chaque pastille (`.di-pip`) porte une VRAIE
// information : brouillon en cours, souhaits en attente, agenda connecté.
// Aucune pastille décorative — une pastille qui ne veut rien dire apprend à
// l'utilisateur à ne plus les regarder.
// Porté depuis `maquette/m6-accueil-epicentre.html`.
//
// LA BINETTE, à gauche, RAMÈNE À L'ACCUEIL. Elle remplace le mot-marque
// « GuardVeto » : l'accueil, c'est le bureau de Filou, donc c'est lui la porte.
// Sans elle, quitter l'accueil était un aller sans retour — le dock ne le
// listait pas (aucun chemin de retour hors saisie d'URL).
//
// Client, pour une seule raison : `usePathname()`. On sait ainsi OÙ ON EST et
// on le montre (`aria-current` + entrée dépliée). Un dock sans page courante
// laisse l'utilisateur se demander sur quel écran il a atterri.
// ============================================================

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/login/actions'
import type { DonneesAccueil } from '@/data/v2/accueilEpicentre'

interface Props {
  prenom: string
  estAdmin: boolean
  /**
   * Le secrétariat (B-017, 2026-08-25). Son dock se réduit à ce qu'il a le
   * droit de consulter.
   *
   * ⚠️ Masquer une entrée ne FERME pas la porte : chaque page refuse aussi
   * l'accès côté serveur. Ce drapeau évite de proposer des portes qui se
   * referment, il ne protège rien par lui-même — leçon du projet, une porte
   * retirée du menu reste ouverte à qui connaît l'adresse.
   */
  estSecretaire?: boolean
  dock: DonneesAccueil['dock']
}

export function BarreV2({ prenom, estAdmin, estSecretaire = false, dock }: Props) {
  const chemin = usePathname()
  /** Vrai sur l'écran lui-même comme sur ses sous-pages. */
  const ici = (href: string) => chemin === href || chemin.startsWith(href + '/')
  /** Classes + `aria-current` d'un coup : la page courante se voit ET s'annonce. */
  const entree = (href: string) => ({
    className: `dock-item${ici(href) ? ' ici' : ''}`,
    'aria-current': ici(href) ? ('page' as const) : undefined,
  })

  const brouillon = dock.statutPlanning === 'brouillon'
  // Le secrétariat ne connaît pas les périodes (arbitrage MiKL du 25/08) :
  // « Planning · Historique été 2026 » lui parlait d'un découpage qui ne le
  // concerne pas, et « aucune période » se serait lu comme une panne. Le nom
  // de l'espace suffit.
  const libellePlanning = estSecretaire
    ? 'Planning'
    : dock.statutPlanning
      ? `Planning · ${brouillon ? 'Brouillon ' : ''}${dock.libellePlanning}`
      : 'Planning · aucune période'

  const libelleAbsences =
    dock.nbSouhaits > 0
      ? `Absences & échanges · ${dock.nbSouhaits} souhait${dock.nbSouhaits > 1 ? 's' : ''}`
      : dock.nbEchanges > 0
        ? `Absences & échanges · ${dock.nbEchanges} échange${dock.nbEchanges > 1 ? 's' : ''}`
        : 'Absences & échanges'
  const aTraiter = dock.nbSouhaits + dock.nbEchanges

  return (
    <header className="app-bar rise" aria-label="Barre GuardVeto">
      <div className="ab-ident">
        {/* La binette ramène à l'accueil — sauf pour le secrétariat, dont
            l'accueil n'existe pas : l'épicentre est le bureau de Filou, et
            Filou ne lui est pas ouvert (arbitrage MiKL du 25/08). Sa porte de
            retour est donc le planning, qui est aussi sa raison d'être ici. */}
        <Link
          className={`ab-porte${ici(estSecretaire ? '/planning' : '/accueil') ? ' ici' : ''}`}
          href={estSecretaire ? '/planning' : '/accueil'}
          aria-label={estSecretaire ? 'Le planning du cabinet' : 'Accueil · le bureau de Filou'}
          aria-current={ici(estSecretaire ? '/planning' : '/accueil') ? 'page' : undefined}
          title={estSecretaire ? 'Planning' : 'Accueil'}
        >
          <span className="ab-filou">
            <Image
              src="/filou/filou-tete.webp"
              alt=""
              width={40}
              height={40}
              priority
              className="ab-filou-img"
            />
          </span>
          <span className="ab-marque">
            <span className="ab-name">
              Guard<em>Veto</em>
            </span>
            <span className="ab-user">{prenom}</span>
          </span>
        </Link>
      </div>

      <nav className="dock-menu" aria-label="Les espaces de GuardVeto">
        <Link {...entree('/planning')} href="/planning" aria-label={libellePlanning}>
          <span className="di-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="5" width="17" height="15.5" rx="4.5" />
              <path d="M8 3.2v3.4M16 3.2v3.4M3.5 10.2h17" />
              <circle cx="12" cy="15.2" r="1.7" fill="currentColor" stroke="none" />
            </svg>
            {brouillon && <i className="di-pip warn" />}
          </span>
          <span className="di-flap" aria-hidden="true">
            <span className="di-text">{libellePlanning}</span>
          </span>
        </Link>

        {/* Absences & échanges : le secrétariat verra les absences au lot 2,
            en lecture seule. Tant que cet écran porte des boutons d'action, on
            ne lui ouvre pas une porte sur des commandes qui lui seraient
            refusées — un bouton qui échoue vaut moins qu'un bouton absent. */}
        {!estSecretaire && (
        <Link {...entree('/absences')} href="/absences" aria-label={libelleAbsences}>
          <span className="di-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.3 9.2a5.6 5.6 0 0 1 9.6-2.5" />
              <path d="M17.6 3.6v3.2h-3.2" />
              <path d="M16.7 14.8a5.6 5.6 0 0 1-9.6 2.5" />
              <path d="M6.4 20.4v-3.2h3.2" />
            </svg>
            {aTraiter > 0 && <i className="di-pip count">{aTraiter}</i>}
          </span>
          <span className="di-flap" aria-hidden="true">
            <span className="di-text">{libelleAbsences}</span>
          </span>
        </Link>
        )}

        {estAdmin && (
          <Link
            {...entree('/equipe')}
            href="/equipe"
            aria-label={`Équipe · ${dock.nbVetos} vétérinaires`}
          >
            <span className="di-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8.6" r="3.2" />
                <path d="M3.4 19.4c.6-3.3 2.8-5.2 5.6-5.2s5 1.9 5.6 5.2" />
                <circle cx="17" cy="9.8" r="2.4" />
                <path d="M15.8 14.3c2.3.4 4.2 2 4.8 4.6" />
              </svg>
            </span>
            <span className="di-flap" aria-hidden="true">
              <span className="di-text">Équipe · {dock.nbVetos} vétos</span>
            </span>
          </Link>
        )}

        {/* Ouverte à TOUTE l'équipe : un vétérinaire y consulte les horaires,
            les enchaînements et les règles qui fabriquent son planning — la
            page le reçoit en vitrine, sans aucune commande. L'entrée était
            réservée aux admins depuis la bascule V2 ; c'était une porte fermée
            sur une information qui le concerne au premier chef. */}
        {!estSecretaire && (
        <Link {...entree('/regles')} href="/regles" aria-label="Organisation du cabinet">
          <span className="di-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7.4h2.9M11 7.4h9M4 12h8.9M17 12h3M4 16.6h4.9M13 16.6h7" />
              <circle cx="9" cy="7.4" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="11" cy="16.6" r="2" />
            </svg>
          </span>
          <span className="di-flap" aria-hidden="true">
            <span className="di-text">Organisation</span>
          </span>
        </Link>
        )}

        {/* RÉSERVÉ AUX ADMINS — décision MiKL du 2026-08-20.
            Cet écran est un outil de PRÉPARATION : il sert à voir qui a
            accumulé quoi pour équilibrer la période suivante. Un vétérinaire
            n'a rien à en faire, et l'y laisser entrer avait deux défauts. Le
            premier, de fond : il y lisait des périodes qui ne lui ont jamais
            été diffusées — l'écran planning venait justement de cesser de les
            lui montrer, l'historique continuait. Le second, de cohérence :
            « aucune garde sur ton planning » d'un côté, et le détail de
            l'historique été de l'autre.
            L'entrée disparaît ICI, et la page elle-même refuse l'accès : une
            porte qu'on se contente de retirer du menu reste ouverte à qui
            connaît l'adresse. */}
        {estAdmin && (
          <Link {...entree('/historique')} href="/historique" aria-label="Historique et compteurs">
            <span className="di-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12.6" r="7.4" />
                <path d="M12 8.6v4l2.9 1.9" />
                <path d="M4.6 5.4 6.9 3.7M19.4 5.4 17.1 3.7" />
              </svg>
            </span>
            <span className="di-flap" aria-hidden="true">
              <span className="di-text">Historique &amp; compteurs</span>
            </span>
          </Link>
        )}

        {estAdmin && (
          <Link
            {...entree('/reglages')}
            href="/reglages"
            aria-label={dock.agendaConnecte ? 'Réglages · agenda connecté' : 'Réglages du cabinet'}
          >
            <span className="di-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.1" />
                <path d="M12 4v2.3M12 17.7V20M4 12h2.3M17.7 12H20M6.3 6.3l1.7 1.7M16 16l1.7 1.7M17.7 6.3 16 8M8 16l-1.7 1.7" />
              </svg>
              {dock.agendaConnecte && <i className="di-pip ok" />}
            </span>
            <span className="di-flap" aria-hidden="true">
              <span className="di-text">
                Réglages{dock.agendaConnecte ? ' · Agenda connecté ✓' : ''}
              </span>
            </span>
          </Link>
        )}
        {/* L'ASSISTANCE, ouverte à toute l'équipe (arbitrage MiKL du
            2026-08-25). Le vétérinaire qui a vu le problème est celui qui sait
            le décrire et joindre sa capture — le réserver à l'administrateur
            aurait remis un intermédiaire entre le bug et le dépannage, ce que
            ce chantier vient justement supprimer.
            En dernier dans le dock : ce n'est pas un espace où l'on travaille,
            c'est celui où l'on va quand quelque chose cloche. */}
        {!estSecretaire && (
        <Link {...entree('/support')} href="/support" aria-label="Assistance">
          <span className="di-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.4" />
              <path d="M9.5 9.4a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.8" />
              <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="di-flap" aria-hidden="true">
            <span className="di-text">Assistance</span>
          </span>
        </Link>
        )}
      </nav>

      <form action={logout}>
        <button type="submit" className="ab-sortie" aria-label="Se déconnecter">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 8.4V6.2a2 2 0 0 0-2-2H6.4a2 2 0 0 0-2 2v11.6a2 2 0 0 0 2 2h6.1a2 2 0 0 0 2-2v-2.2" />
            <path d="M10.2 12h9.4M16.7 8.9l3 3.1-3 3.1" />
          </svg>
        </button>
      </form>
    </header>
  )
}
