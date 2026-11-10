'use client'

// ============================================================
// GUARDVETO — L'onglet Réglages refondu (B-202, chantier `reglages-v2`)
// ============================================================
// MiKL, le 10/11 : « cet onglet est mal organisé et pas du tout ergonomique
// […] au même titre que Planning dont on a revu tout le graphisme, je veux
// qu'on revoie tout de cet onglet ». Maquette validée le même jour :
// `docs/maquettes/B-202-reglages.html`.
//
// Cinq sections au lieu d'une grille de cartes mélangées. Sur ordinateur, un
// sommaire reste à gauche ; sur téléphone, une liste mène à chaque section,
// et une flèche y ramène. Hors administratrice, il n'y a que « Pour moi » :
// pas de sommaire pour une seule section.
//
// 🔴 PORTE DE CHANTIER. Ce composant n'est rendu que si `chantierOuvert`
//    (`reglages-v2`) l'autorise : bac à sable seul tant que MiKL n'a pas
//    recetté. Le Val d'Allier garde l'écran actuel (`ReglagesV2`).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronLeft, ChevronRight, FileText, MessageSquare, Plug, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import '@/styles/chantier-reglages-v2.css'
import {
  attentions, sectionsPour, type IdSection, type Partages, type RoleReglages, type Section,
} from '@/lib/reglages/coquille'
import type { LigneEmail } from '@/lib/reglages/libelles'
import { ReglagesSectionMoi, type DonneesSectionMoi } from './ReglagesSectionMoi'
import { ReglagesSectionCabinet, type DonneesSectionCabinet } from './ReglagesSectionCabinet'
import { ReglagesSectionMessagerie } from './ReglagesSectionMessagerie'
import { ReglagesSectionConnexions, type DonneesSectionConnexions } from './ReglagesSectionConnexions'
import { ReglagesSectionSuivi } from './ReglagesSectionSuivi'

/** Ce que l'administratrice voit en plus de « Pour moi ». Lu côté serveur, pour elle seule. */
export interface DonneesReglagesCabinet {
  cabinet: DonneesSectionCabinet
  connexions: DonneesSectionConnexions
  /** Les trois champs que `configurerPartagesCabinet` réécrit ensemble, tels qu'enregistrés. */
  partages: Partages
  messagerieAllumee: boolean
  emails: LigneEmail[]
}

interface Props {
  role: RoleReglages
  /** La section demandée par l'adresse (`?section=`), déjà validée pour ce rôle. */
  sectionDemandee: IdSection | null
  moi: DonneesSectionMoi
  /** `null` hors administratrice : aucune donnée du cabinet n'arrive jusqu'ici. */
  cabinet: DonneesReglagesCabinet | null
}

const ICONES: Record<IdSection, LucideIcon> = {
  moi: User,
  cabinet: Building2,
  messagerie: MessageSquare,
  connexions: Plug,
  suivi: FileText,
}

export function ReglagesChantierV2({ role, sectionDemandee, moi, cabinet }: Props) {
  const sections = sectionsPour(role)
  const plusieurs = sections.length > 1 && cabinet !== null

  const [section, setSection] = useState<IdSection>(sectionDemandee ?? sections[0].id)
  // Sur téléphone : la liste des sections, ou une section ouverte. Un lien
  // qui nomme une section l'ouvre directement. Sur ordinateur, ignoré.
  const [vue, setVue] = useState<'liste' | 'section'>(sectionDemandee ? 'section' : 'liste')

  // L'adresse change sans que le composant soit remonté (lien « Réglages » de
  // la barre, retour du navigateur) : la section suit. Ajustement pendant le
  // rendu, la façon React de suivre une prop — pas d'effet, pas de double rendu.
  const [demandeVue, setDemandeVue] = useState(sectionDemandee)
  if (sectionDemandee !== demandeVue) {
    setDemandeVue(sectionDemandee)
    if (sectionDemandee) {
      setSection(sectionDemandee)
      setVue('section')
    } else {
      setVue('liste')
    }
  }

  // Les trois champs partagés, tels qu'ENREGISTRÉS : chaque « Enregistrer »
  // repart de là, jamais de la saisie en cours d'une autre section.
  const [partages, setPartages] = useState<Partages | null>(cabinet?.partages ?? null)

  // Après un geste de l'utilisatrice, le titre de la section reçoit le focus :
  // sur téléphone, le bouton de la liste qu'elle vient de toucher disparaît,
  // et un lecteur d'écran resterait sinon sur un élément invisible.
  const titreRef = useRef<HTMLHeadingElement>(null)
  const aFocaliser = useRef(false)
  useEffect(() => {
    if (!aFocaliser.current) return
    aFocaliser.current = false
    titreRef.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [section, vue])

  // Le retour du navigateur, sur téléphone, ramène à la liste comme la flèche
  // de l'écran (l'entrée a été poussée à l'ouverture d'une section).
  useEffect(() => {
    const surRetour = () => {
      if (!new URLSearchParams(window.location.search).get('section')) setVue('liste')
    }
    window.addEventListener('popstate', surRetour)
    return () => window.removeEventListener('popstate', surRetour)
  }, [])

  const alertes = cabinet
    ? attentions({
        zoneConnue: cabinet.cabinet.zoneScolaire !== '',
        envoiConfigure: cabinet.cabinet.envoiConfigure,
        agendaBranche:
          (partages?.googleCalendarId.trim() ?? '') !== '' || cabinet.connexions.repliDisponible,
        emails: cabinet.emails,
      })
    : null

  // L'adresse suit la section : un rafraîchissement ou un lien partagé retombe
  // au même endroit. Depuis le sommaire (ordinateur), on REMPLACE l'adresse :
  // pas d'entrée d'historique par clic. Depuis la liste (téléphone), on en
  // POUSSE une, pour que le retour du téléphone ramène à la liste.
  const pousse = useRef(false)
  const ouvrir = (id: IdSection, depuis: 'sommaire' | 'liste') => {
    aFocaliser.current = true
    setSection(id)
    setVue('section')
    try {
      if (depuis === 'liste') {
        window.history.pushState(null, '', `?section=${id}`)
        pousse.current = true
      } else {
        window.history.replaceState(null, '', `?section=${id}`)
      }
    } catch {
      /* navigateur qui refuse : sans conséquence, la section reste ouverte */
    }
  }

  const revenir = () => {
    setVue('liste')
    try {
      if (pousse.current) {
        pousse.current = false
        window.history.back()
      } else {
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch {
      /* idem */
    }
  }

  const marqueur = (s: Section) => {
    if (!alertes) return null
    if (s.id === 'suivi' && alertes.suivi > 0) {
      return <span className="rg-compte" title="E-mails en échec">{alertes.suivi}</span>
    }
    if ((s.id === 'cabinet' && alertes.cabinet) || (s.id === 'connexions' && alertes.connexions)) {
      return <span className="rg-point" title="À régler" />
    }
    return null
  }

  const contenu = (id: IdSection) => {
    if (id === 'moi' || !cabinet || !partages) {
      return <ReglagesSectionMoi {...moi} role={role} />
    }
    switch (id) {
      case 'cabinet':
        return <ReglagesSectionCabinet {...cabinet.cabinet} partages={partages} onPartagesEnregistres={setPartages} />
      case 'messagerie':
        return <ReglagesSectionMessagerie allumee={cabinet.messagerieAllumee} />
      case 'connexions':
        return (
          <ReglagesSectionConnexions {...cabinet.connexions} partages={partages} onPartagesEnregistres={setPartages} />
        )
      case 'suivi':
        return <ReglagesSectionSuivi emails={cabinet.emails} />
    }
  }

  const courante = sections.find((s) => s.id === section) ?? sections[0]

  if (!plusieurs) {
    return (
      <div className="rg-page">
        <div className="page-head rise">
          <div>
            <h1>Réglages</h1>
          </div>
        </div>
        <div className="rg-seule rise rise-2">
          {/* Le titre de la section, pour les lecteurs d'écran : h1 puis h3 sautait un niveau. */}
          <h2 className="sr-only">Pour moi</h2>
          {contenu('moi')}
        </div>
      </div>
    )
  }

  return (
    <div className="rg-page" data-vue={vue}>
      <div className="page-head rise rg-tete-page">
        <div>
          <h1>Réglages</h1>
        </div>
      </div>

      <div className="rg-coquille rise rise-2" data-vue={vue}>
        {/* Ordinateur : le sommaire, toujours visible. */}
        <nav className="rg-sommaire" aria-label="Sections des réglages">
          {sections.map((s) => {
            const Icone = ICONES[s.id]
            const on = s.id === courante.id
            return (
              <button
                key={s.id}
                type="button"
                className={on ? 'rg-nav on' : 'rg-nav'}
                aria-current={on ? 'page' : undefined}
                onClick={() => ouvrir(s.id, 'sommaire')}
              >
                <Icone className="rg-ico" aria-hidden="true" />
                <span className="rg-nav-lib">{s.nom}</span>
                {marqueur(s)}
              </button>
            )
          })}
        </nav>

        {/* Téléphone : la liste qui mène à chaque section. */}
        <div className="rg-liste">
          {sections.map((s) => {
            const Icone = ICONES[s.id]
            return (
              <button key={s.id} type="button" className="rg-mrow" onClick={() => ouvrir(s.id, 'liste')}>
                <span className="rg-puce" aria-hidden="true">
                  <Icone className="rg-ico" />
                </span>
                <span className="rg-mrow-tx">
                  <b>{s.nom}</b>
                  <span>{s.resume}</span>
                </span>
                {marqueur(s)}
                <ChevronRight className="rg-ico rg-chevron" aria-hidden="true" />
              </button>
            )
          })}
        </div>

        <div className="rg-section">
          <button type="button" className="rg-retour" onClick={revenir}>
            <ChevronLeft className="rg-ico sm" aria-hidden="true" />
            Réglages
          </button>
          <h2 className="rg-sec-titre" ref={titreRef} tabIndex={-1}>{courante.nom}</h2>
          {/* 🔴 TOUTES les sections restent montées, une seule est visible.
              Démontées, elles repartaient de leurs props au retour : un e-mail
              coupé se réaffichait « activé » (son action ne revalide pas cette
              page), et une adresse à moitié tapée disparaissait en silence. */}
          {sections.map((s) => (
            <div key={s.id} hidden={s.id !== courante.id}>
              {contenu(s.id)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
