'use client'

// ============================================================
// GUARDVETO V2 — Organisation du cabinet : la coquille et ses quatre onglets
// ============================================================
// Une seule porte pour « comment mon cabinet fonctionne » : ce qu'il est
// (périodes types, types de garde, enchaînements) et ce qu'il exige (les
// règles). En V1, c'était deux pages qui ne se connaissaient pas.
//
// ── LE VOCABULAIRE (décidé avec MiKL le 2026-08-01) ──────────────
//
//   ORGANISATION DU CABINET   ce que porte cet écran
//     └── PÉRIODE TYPE        « Hiver », « Été », « Été 2 »… un MODÈLE
//                             réutilisable : ses types de garde, ses
//                             horaires, son effectif, ses règles
//   PLANNING                  des dates à remplir en appliquant UNE période
//                             type. C'est le RÉSULTAT, pas un réglage — il ne
//                             se configure pas ici.
//
// Le mot « profil » ne doit plus apparaître à l'écran : il ne disait à
// personne ce qu'il faisait, au point que MiKL a dû inventer « période
// structurelle » pour se faire comprendre. Côté BASE, la table s'appelle
// encore `profils_planning` et les actions serveur `…Profil` — c'est la
// frontière assumée de cette étape : on renomme ce que l'utilisateur lit,
// pas ce que Postgres stocke. Les deux se rejoindront (ou pas) plus tard.
//
// LA PÉRIODE TYPE EST LE CONTEXTE DE LA PAGE, pas un widget local. Il y avait
// trois sélecteurs en V1, désynchronisés — et le catalogue de créneaux était
// en plus codé en dur sur celle par DÉFAUT : un admin qui avait un « Été » ne
// voyait jamais ses créneaux d'été. Ici, un seul sélecteur, en tête, et les
// onglets 1 à 3 en découlent.
//
// PAS D'ASSISTANT IA INLINE. La V1 en avait trois (règles, profils, liaisons),
// trois encarts qui faisaient chacun un bout du travail de Filou. C'est Filou,
// au rebord, qui centralise : il ramène à l'accueil avec la mémoire de l'écran
// d'où on vient (`#filou=regles`), et l'accueil accroche sur la bonne question.
// ============================================================

import { useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { FilouEdge } from './FilouEdge'
import { OngletProfils } from './regles/OngletProfils'
import { OngletCreneaux } from './regles/OngletCreneaux'
import { OngletEnchainements } from './regles/OngletEnchainements'
import { OngletMoteur } from './regles/OngletMoteur'
import type { ProfilUI, NiveauLiaisonUI, VetoUI } from './regles/types'
import type { RegleRow, PeriodeOption, TypeCreneauOption } from '@/components/regles/ReglesClient'
import type { RegleEquipeUI } from '@/components/regles/CompositionEquipeClient'
import type { StructureRegleUI } from '@/components/regles/ReglagesPlanningClient'
import type { CohorteEquiteUI } from '@/app/(protected)/regles/actions'
import type { EquityDimension, ImportanceLevel } from '@/engine/equity-weights'

type Onglet = 'profils' | 'creneaux' | 'enchainements' | 'moteur'

const ONGLETS: Onglet[] = ['profils', 'creneaux', 'enchainements', 'moteur']

/**
 * Les ancres de `?focus=` qui ont DÉMÉNAGÉ dans l'onglet « Enchaînements ».
 * Le bandeau de diagnostic d'impasse renvoie ici avec la cible d'un réglage
 * précis ; il ne sait pas que la page a changé de forme, et il n'a pas à le
 * savoir. C'est la page qui sait où vit chacune de ses ancres.
 */
const FOCUS_ENCHAINEMENTS = new Set([
  'liaison_creneaux',
  'inversion_role',
  'r9_liaison',
  'r8_inversion',
])

interface Props {
  /** `?onglet=` — permet de faire un lien direct vers une section. */
  ongletInitial?: string
  /** `?focus=` — ancre d'un réglage précis, venue du diagnostic d'impasse. */
  focus?: string
  profils: ProfilUI[]
  regles: RegleRow[]
  reglesEquipe: RegleEquipeUI[]
  vets: VetoUI[]
  periodes: PeriodeOption[]
  typesCreneaux: TypeCreneauOption[]
  rolesCabinet: string[]
  tagsEquipe: string[]
  equite: Record<EquityDimension, ImportanceLevel>
  cohortes: CohorteEquiteUI[]
  niveauxLiaison: Record<'meme_binome' | 'inversion_role', NiveauLiaisonUI>
  penalitesSouples: Record<string, StructureRegleUI>
  roleAvantage: string
}

/** Onglet de départ : l'ancre de focus l'emporte sur `?onglet=`, qui l'emporte sur le défaut. */
function ongletDeDepart(ongletInitial?: string, focus?: string): Onglet {
  if (focus && FOCUS_ENCHAINEMENTS.has(focus)) return 'enchainements'
  if (focus) return 'moteur' // toutes les autres ancres sont des règles
  if (ongletInitial && (ONGLETS as string[]).includes(ongletInitial)) return ongletInitial as Onglet
  return 'profils'
}

export function ReglesStructureV2({
  ongletInitial,
  focus,
  profils,
  regles,
  reglesEquipe,
  vets,
  periodes,
  typesCreneaux,
  rolesCabinet,
  tagsEquipe,
  equite,
  cohortes,
  niveauxLiaison,
  penalitesSouples,
  roleAvantage,
}: Props) {
  const [onglet, setOnglet] = useState<Onglet>(() => ongletDeDepart(ongletInitial, focus))

  // Profil courant : celui par défaut au premier rendu. Il pilote les trois
  // premiers onglets — un seul contexte pour toute la page.
  const [profilChoisi, setProfilChoisi] = useState<string>(
    () => (profils.find((p) => p.estDefaut) ?? profils[0])?.id ?? '',
  )

  // Le profil RÉELLEMENT affiché : celui qu'on a choisi s'il existe encore,
  // sinon le profil par défaut. C'est une valeur DÉRIVÉE, pas un état à
  // resynchroniser : quand on supprime le profil courant depuis l'onglet 1, la
  // page doit retomber sur le défaut au même rendu, pas au rendu suivant.
  const profil = useMemo(
    () => profils.find((p) => p.id === profilChoisi) ?? profils.find((p) => p.estDefaut) ?? profils[0],
    [profils, profilChoisi],
  )
  const profilId = profil?.id ?? ''
  const setProfilId = setProfilChoisi

  const nbCreneauxActifs = profil?.creneaux.filter((c) => c.actif).length ?? 0
  const nbLiaisons = profil?.relations.filter((r) => r.actif).length ?? 0
  const nbRegles = regles.filter((r) => r.actif).length + reglesEquipe.filter((r) => r.actif).length

  /** Classes + `aria-selected` d'un onglet : l'état se lit sur l'attribut, pas sur une classe. */
  const tab = (cle: Onglet) => ({
    type: 'button' as const,
    role: 'tab' as const,
    'aria-selected': onglet === cle,
    onClick: () => setOnglet(cle),
  })

  return (
    <>
      <div className="page-head rise">
        <div>
          <p className="page-kicker">Organisation</p>
          <h1>Comment votre cabinet organise ses gardes.</h1>
          <p className="lede">
            Vos périodes types — l&apos;hiver, l&apos;été — avec leurs types de garde, leurs
            horaires, leurs enchaînements et leurs règles. Tout ce qui est réglé ici s&apos;applique
            au prochain planning que vous générerez.
          </p>
        </div>

        {/* Le sélecteur n'apparaît QUE sur les onglets qui décrivent UNE
            période type. Sur l'onglet « Périodes types », il faisait doublon
            avec la grille juste en dessous — deux commandes pour un même
            choix, à 30 cm l'une de l'autre. Là-bas, on désigne la période type
            en cliquant sa carte. Sur « Règles », il ne veut rien dire
            aujourd'hui : une règle ne dépend encore d'aucune période type
            (c'est justement l'étape 4 du chantier). */}
        {profils.length > 1 && (onglet === 'creneaux' || onglet === 'enchainements') && (
          <div className="page-actions">
            <div className="profil-pilote">
              <span id="profil-courant-label">Période type</span>
              <Select value={profilId} onValueChange={(v) => v && setProfilId(v)}>
                <SelectTrigger aria-labelledby="profil-courant-label" className="w-[230px]">
                  {profil?.nom ?? 'Choisir…'}
                </SelectTrigger>
                <SelectContent>
                  {profils.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nom}
                      {p.estDefaut ? ' · par défaut' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <nav className="tabs" role="tablist" aria-label="Sections de l’organisation du cabinet">
        <button {...tab('profils')}>
          Périodes types {profils.length > 0 && <span className="count">{profils.length}</span>}
        </button>
        <button {...tab('creneaux')}>
          Types de garde{' '}
          {nbCreneauxActifs > 0 && <span className="count">{nbCreneauxActifs}</span>}
        </button>
        <button {...tab('enchainements')}>
          Enchaînements {nbLiaisons > 0 && <span className="count">{nbLiaisons}</span>}
        </button>
        <button {...tab('moteur')}>
          Règles {nbRegles > 0 && <span className="count">{nbRegles}</span>}
        </button>
      </nav>

      {/* La scène porte Filou accroché au rebord DROIT des cartes. Il repart
          avec la mémoire de l'écran (`#filou=regles`) : c'est ce qui lui permet
          d'accueillir par la bonne question. Cf. `src/lib/v2/filou-origine.ts`. */}
      <div className="reg-scene">
        <FilouEdge origine="regles" cote="droite" />

        {onglet === 'profils' && (
          <section className="tab-panel" role="tabpanel" aria-label="Périodes types">
            <OngletProfils
              profils={profils}
              profilCourantId={profilId}
              onChoisir={setProfilId}
            />
          </section>
        )}

        {/* `key={profil.id}` : changer de période type change le catalogue.
            Sans remontage, un formulaire à demi rempli garderait des types de
            garde qui n'existent pas dans celle qu'on vient d'ouvrir. */}
        {onglet === 'creneaux' && profil && (
          <section className="tab-panel" role="tabpanel" aria-label="Types de garde">
            <OngletCreneaux key={profil.id} profil={profil} />
          </section>
        )}

        {onglet === 'enchainements' && profil && (
          <section className="tab-panel" role="tabpanel" aria-label="Enchaînements">
            <OngletEnchainements
              key={profil.id}
              profil={profil}
              niveaux={niveauxLiaison}
              focus={focus}
            />
          </section>
        )}

        {onglet === 'moteur' && (
          <section className="tab-panel" role="tabpanel" aria-label="Règles">
            <OngletMoteur
              regles={regles}
              reglesEquipe={reglesEquipe}
              vets={vets}
              periodes={periodes}
              typesCreneaux={typesCreneaux}
              rolesCabinet={rolesCabinet}
              tagsEquipe={tagsEquipe}
              equite={equite}
              cohortes={cohortes}
              penalitesSouples={penalitesSouples}
              roleAvantage={roleAvantage}
              focus={focus}
            />
          </section>
        )}

        {profils.length === 0 && onglet !== 'moteur' && (
          <section className="card">
            <p className="empty-row">
              Aucune période type n&apos;est configurée pour ce cabinet. Les types de garde et leurs
              enchaînements se règlent par période type — commence par en créer une.
            </p>
          </section>
        )}
      </div>
    </>
  )
}
