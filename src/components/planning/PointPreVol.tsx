'use client'

// ============================================================
// GUARDVETO — Un point de pré-vol, avec de quoi le RÉGLER
// ============================================================
// Retour MiKL du 2026-08-02 : « y a rien qui permette à l'utilisateur de
// changer quoi que ce soit directement à partir de l'encart, il faut qu'il
// aille à droite à gauche, revienne, et vérifie… bref c'est chiant ».
//
// Ce composant est la réponse : le constat ET les gestes, au même endroit.
// Il sert aux DEUX écrans — le bandeau du planning et l'étape « avant de
// lancer » du parcours de génération — pour qu'un point se règle exactement
// de la même façon d'où qu'on le voie.
//
// QUELS GESTES, ET POURQUOI CEUX-LÀ
//
// Ils se déduisent du code d'avertissement, jamais devinés (même doctrine que
// `lib/regles/corrections.ts`, dont ce fichier est le bras armé) :
//
//   • `assouplir`  — la règle est trop dure pour ce que l'effectif permet.
//                    Elle RESTE, le moteur la respecte quand il peut. C'est la
//                    correction la plus fréquente et la moins destructrice.
//   • `pause`      — la règle est inerte ou fantôme : la suspendre ne coûte
//                    rien puisqu'elle n'a déjà aucun effet.
//   • `poser`/`retirer` une étiquette — le manque est HORS de la règle : c'est
//                    l'équipe qu'il faut corriger, pas le réglage.
//   • `ailleurs`   — les cas qu'on ne peut pas régler en un clic sans deviner
//                    l'intention (relever un plafond, réécrire une valeur).
//
// Rien n'est appliqué en silence : chaque geste dit ce qu'il change, et
// l'écran appelant recalcule le pré-vol derrière (`onCorrige`).
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ExternalLink } from 'lucide-react'
import {
  assouplirRegle,
  mettreEnPauseRegle,
  poserEtiquetteSurVetos,
  retirerEtiquetteDeVetos,
} from '@/app/(protected)/regles/actions'
import type { AvertissementPreVol } from '@/engine/pre-vol'

export interface VetEtiquette {
  id: string
  prenom: string
  nom: string
}

interface Props {
  avertissement: AvertissementPreVol
  /** Vétérinaires actifs — pour poser ou retirer une étiquette sur place. */
  vets: VetEtiquette[]
  /** Appelé après toute correction appliquée : l'appelant relit le pré-vol. */
  onCorrige: () => void
}

/** Codes où assouplir la règle ne changerait rien (elle est déjà sans effet). */
const ASSOUPLIR_INUTILE = new Set([
  'sequence_inerte',
  'regle_veto_sorti',
  'duo_veto_sorti',
  'cohorte_equite_sans_porteur',
])

/**
 * Où aller quand le geste ne peut pas être fait ici sans deviner l'intention
 * (relever un plafond de combien ? réécrire quelle valeur ?).
 *
 * ⚠️ Ces renvois s'ouvrent dans un NOUVEL ONGLET, et c'est délibéré. MiKL,
 * 2026-08-03 : « ça m'a sorti du parcours […] et surtout je suis sorti de la
 * génération, il faut que je recommence tout ». Un parcours en cours ne doit
 * jamais être détruit par un lien : l'admin corrige à côté, revient sur son
 * onglet, clique « J'ai corrigé — revérifier », et reprend où il en était.
 */
const ECRAN: Record<string, { href: string; label: string }> = {
  charge_globale_insuffisante: { href: '/regles', label: 'Relever les plafonds' },
  weekends_insuffisants:       { href: '/regles', label: 'Relever les limites de week-end' },
  sequence_inerte:             { href: '/regles', label: 'Revoir les valeurs saisies' },
  veto_jamais_disponible:      { href: '/regles', label: 'Revoir ses règles' },
  regle_veto_sorti:            { href: '/regles', label: 'Ouvrir les règles' },
  duo_veto_sorti:              { href: '/regles', label: 'Ouvrir les règles' },
  seulement_avec_partenaire_sorti: { href: '/regles', label: 'Choisir un autre binôme' },
  // Sans lui, une carte « créneau impossible » n'avait AUCUN bouton : le
  // pré-vol nomme les raisons sans pouvoir remonter à la règle exacte (elles
  // viennent du rejeu du moteur, pas d'une ligne identifiée).
  creneau_impossible:          { href: '/regles', label: 'Ouvrir les règles' },
}

export function PointPreVol({ avertissement: a, vets, onCorrige }: Props) {
  const [enCours, setEnCours] = useState<string | null>(null)
  // Le choix des vétérinaires quand le geste porte sur une étiquette.
  const [choixTag, setChoixTag] = useState<'poser' | 'retirer' | null>(null)
  const [selection, setSelection] = useState<string[]>([])

  const bloquant = a.gravite === 'bloquant'
  const ids = a.regleIds ?? []
  const ecran = ECRAN[a.code]

  // « TOUS portent l'étiquette » se corrige en la RETIRANT ; « personne ne la
  // porte » en la POSANT. Le code seul ne suffit pas à trancher pour
  // `role_interdit_intenable`, qui couvre les deux cas — le message, lui, le
  // dit. On se fie donc au marqueur explicite du pré-vol.
  const tousPorteurs = a.code === 'role_interdit_intenable' && a.message.startsWith('TOUS')
  const peutPoser = Boolean(a.tag) && !tousPorteurs
    && (a.code === 'composition_sans_porteur'
      || a.code === 'cohorte_equite_sans_porteur'
      || a.code === 'role_interdit_intenable')
  const peutRetirer = Boolean(a.tag) && tousPorteurs

  async function lancer(cle: string, action: () => Promise<{ error?: string } | { success: boolean }>, succes: string) {
    setEnCours(cle)
    const res = await action()
    setEnCours(null)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success(succes)
    setChoixTag(null)
    setSelection([])
    onCorrige()
  }

  function basculer(id: string) {
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <div className={`ppv${bloquant ? ' bloquant' : ''}`}>
      <p className="ppv-message">{a.message}</p>

      {a.regles.length > 0 && (
        <p className="gva-puces">
          <span className="gva-puces-label">
            Règle{a.regles.length > 1 ? 's' : ''} en cause
          </span>
          {a.regles.map((r, i) => (
            <span key={i} className="gva-puce">{r}</span>
          ))}
        </p>
      )}

      {/* ── Le choix des vétérinaires, quand le geste porte sur une étiquette ── */}
      {choixTag && (
        <div className="ppv-choix">
          <p className="ppv-choix-titre">
            {choixTag === 'poser'
              ? <>Qui porte l’étiquette « {a.tag} » ?</>
              : <>À qui retirer l’étiquette « {a.tag} » ?</>}
          </p>
          <div className="ppv-vets">
            {vets.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`ppv-vet${selection.includes(v.id) ? ' choisi' : ''}`}
                aria-pressed={selection.includes(v.id)}
                onClick={() => basculer(v.id)}
              >
                {v.prenom}
              </button>
            ))}
          </div>
          <div className="ppv-actions">
            <button
              type="button"
              className="ppv-btn"
              onClick={() => { setChoixTag(null); setSelection([]) }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="ppv-btn fort"
              disabled={selection.length === 0 || enCours !== null}
              onClick={() =>
                lancer(
                  'tag',
                  () => (choixTag === 'poser'
                    ? poserEtiquetteSurVetos(a.tag!, selection)
                    : retirerEtiquetteDeVetos(a.tag!, selection)),
                  choixTag === 'poser' ? 'Étiquette posée.' : 'Étiquette retirée.',
                )
              }
            >
              {enCours === 'tag' && <Loader2 className="ppv-spin" aria-hidden />}
              {choixTag === 'poser' ? 'Poser l’étiquette' : 'Retirer l’étiquette'}
            </button>
          </div>
        </div>
      )}

      {/* ── Les gestes ──────────────────────────────────────── */}
      {!choixTag && (
        <div className="ppv-actions">
          {ids.length > 0 && !ASSOUPLIR_INUTILE.has(a.code) && (
            <button
              type="button"
              className="ppv-btn fort"
              disabled={enCours !== null}
              title="La règle reste, mais le moteur pourra passer outre s’il ne trouve aucun planning sans elle — en le signalant."
              onClick={() =>
                lancer(
                  'assouplir',
                  async () => {
                    for (const id of ids) {
                      const r = await assouplirRegle(id)
                      if ('error' in r && r.error) return r
                    }
                    return { success: true }
                  },
                  'Règle passée en « sauf urgence ».',
                )
              }
            >
              {enCours === 'assouplir' && <Loader2 className="ppv-spin" aria-hidden />}
              Assouplir la règle
            </button>
          )}

          {peutPoser && (
            <button
              type="button"
              className="ppv-btn"
              disabled={enCours !== null}
              onClick={() => { setChoixTag('poser'); setSelection([]) }}
            >
              Poser l’étiquette « {a.tag} »
            </button>
          )}

          {peutRetirer && (
            <button
              type="button"
              className="ppv-btn fort"
              disabled={enCours !== null}
              onClick={() => { setChoixTag('retirer'); setSelection([]) }}
            >
              Retirer l’étiquette à quelqu’un
            </button>
          )}

          {ids.length > 0 && (
            <button
              type="button"
              className="ppv-btn"
              disabled={enCours !== null}
              title="La règle est conservée mais ignorée jusqu’à ce que tu la réactives."
              onClick={() =>
                lancer(
                  'pause',
                  async () => {
                    for (const id of ids) {
                      const r = await mettreEnPauseRegle(id)
                      if ('error' in r && r.error) return r
                    }
                    return { success: true }
                  },
                  'Règle mise en pause.',
                )
              }
            >
              {enCours === 'pause' && <Loader2 className="ppv-spin" aria-hidden />}
              Mettre en pause
            </button>
          )}

          {ecran && (
            <a
              href={ecran.href}
              target="_blank"
              rel="noopener noreferrer"
              className="ppv-btn"
              title="S’ouvre dans un nouvel onglet — ton parcours reste ouvert ici"
            >
              <ExternalLink className="ppv-ico" aria-hidden />
              {ecran.label}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
