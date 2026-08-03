'use client'

// ============================================================
// GUARDVETO V2 — L'encart compteurs du planning, à colonnes réglables
// ============================================================
// Décidé avec MiKL le 2026-08-03. Deux changements :
//
//  ① UNE COLONNE « ÉCART ». Les trois colonnes d'origine (week-ends, nuits,
//     1ᵉʳ de week-end) donnent des nombres BRUTS : elles ne disent pas si la
//     répartition est juste. Il fallait lire la phrase du bas — « écart de 10
//     week-ends entre le plus et le moins chargé » — pour l'apprendre, sans
//     savoir chez QUI. L'écart le montre ligne par ligne, et c'est le MÊME
//     calcul que le bilan officiel de fin de période (`calculerBilans`) : pas
//     de seconde façon de compter.
//
//  ② DES COLONNES AU CHOIX, quatre au maximum. La limite vient de la largeur
//     réelle de l'encart, pas d'une préférence : à cinq, les prénoms passent
//     sur deux lignes et les nombres se touchent. Le réglage suit la personne
//     (table `preferences_affichage`), pas le navigateur.
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import { Settings2, Check } from 'lucide-react'
import { setColonnesCompteurs } from '@/app/(protected)/preferences/actions'
import {
  COLONNES, ORDRE_CATALOGUE, MAX_COLONNES, normaliserColonnes,
  type CleColonne,
} from '@/lib/planning/colonnesCompteurs'
import type { CompteursRow } from '@/hooks/useCompteurs'
import type { BilanVet } from '@/engine/bilan'

interface Props {
  lignes: CompteursRow[]
  /** Écarts à la juste part, par vétérinaire — source unique `calculerBilans`. */
  bilans: BilanVet[]
  /** Colonnes retenues par la personne connectée (déjà normalisées côté page). */
  colonnes: CleColonne[]
}

/** La pastille d'écart, même code couleur que l'écran Historique. */
function Ecart({ valeur, horsRepartition }: { valeur: number; horsRepartition: boolean }) {
  if (horsRepartition) {
    return <span className="cnt-ecart-pastille none" title="Dernier recours : hors répartition">—</span>
  }
  const abs = Math.abs(valeur)
  const classe = abs === 0 ? 'ok' : abs === 1 ? 'warn' : 'bad'
  const titre =
    abs === 0 ? 'Dans la juste part'
    : abs === 1 ? 'Léger écart, rattrapé à la prochaine génération'
    : 'Écart à rattraper'
  const texte = valeur === 0 ? '=' : valeur > 0 ? `+${valeur}` : `−${abs}`
  return <span className={`cnt-ecart-pastille ${classe}`} title={titre}>{texte}</span>
}

export function CompteursPanel({ lignes, bilans, colonnes }: Props) {
  const [choix, setChoix] = useState<CleColonne[]>(colonnes)
  const [reglageOuvert, setReglageOuvert] = useState(false)
  const [enregistrement, setEnregistrement] = useState(false)

  const bilanDe = new Map(bilans.map((b) => [b.veterinaire_id, b]))

  async function basculer(cle: CleColonne) {
    const dejaLa = choix.includes(cle)
    if (!dejaLa && choix.length >= MAX_COLONNES) {
      toast.error(
        `${MAX_COLONNES} colonnes au maximum — l’encart est étroit. Décoche-en une d’abord.`,
      )
      return
    }
    const suivant = normaliserColonnes(
      dejaLa ? choix.filter((c) => c !== cle) : [...choix, cle],
    )
    const precedent = choix
    setChoix(suivant) // optimiste : le réglage doit répondre au clic
    setEnregistrement(true)
    const res = await setColonnesCompteurs(suivant)
    setEnregistrement(false)
    if ('error' in res && res.error) {
      setChoix(precedent) // le serveur a refusé : on revient à l'état d'avant
      toast.error(res.error)
    }
  }

  if (lignes.length === 0) {
    return (
      <p className="cnt-ecart">Aucune garde comptée sur cette période pour l&apos;instant.</p>
    )
  }

  // Les barres se comparent à la valeur la plus haute de LEUR colonne : une
  // barre commune aux nuits et aux week-ends écraserait les week-ends.
  const valeurDe = (l: CompteursRow, cle: CleColonne): number => {
    switch (cle) {
      case 'we': return l.we_total
      case 'nuits': return l.sem_total
      case 'premier': return l.we_premier
      case 'feries': return l.feries_total
      case 'total': return l.total_gardes
      case 'ecart': return bilanDe.get(l.veterinaire_id)?.ecart_we ?? 0
    }
  }
  const maxDe = new Map<CleColonne, number>(
    choix.map((c) => [c, Math.max(1, ...lignes.map((l) => Math.abs(valeurDe(l, c))))]),
  )

  const weMin = Math.min(...lignes.map((l) => l.we_total))
  const weMax = Math.max(...lignes.map((l) => l.we_total))

  return (
    <>
      <div className="cnt-reglage-barre">
        <button
          type="button"
          className="cnt-reglage-btn"
          aria-expanded={reglageOuvert}
          title="Choisir les colonnes affichées"
          onClick={() => setReglageOuvert((v) => !v)}
        >
          <Settings2 className="ppv-ico" aria-hidden />
          Colonnes
        </button>
      </div>

      {reglageOuvert && (
        <div className="cnt-reglage">
          <p className="cnt-reglage-titre">
            Colonnes affichées
            <span className="cnt-reglage-compte">{choix.length}/{MAX_COLONNES}</span>
          </p>
          {ORDRE_CATALOGUE.map((cle) => {
            const active = choix.includes(cle)
            const bloque = !active && choix.length >= MAX_COLONNES
            return (
              <button
                key={cle}
                type="button"
                className={`cnt-reglage-item${active ? ' active' : ''}`}
                disabled={enregistrement || bloque}
                aria-pressed={active}
                onClick={() => void basculer(cle)}
              >
                <span className="cnt-reglage-case" aria-hidden>
                  {active && <Check className="ppv-ico" />}
                </span>
                <span className="cnt-reglage-txt">
                  <b>{COLONNES[cle].entete}</b>
                  <small>{COLONNES[cle].description}</small>
                </span>
              </button>
            )
          })}
          <p className="cnt-reglage-note">
            {MAX_COLONNES} au maximum : au-delà, l’encart devient illisible sur cette
            largeur. Ton choix te suit sur tes autres appareils.
          </p>
        </div>
      )}

      <div>
        <div className="cnt-row cnt-header" style={{ '--nb-col': choix.length } as React.CSSProperties}>
          <span>Vétérinaire</span>
          {choix.map((c) => (
            <span key={c} title={COLONNES[c].description}>{COLONNES[c].entete}</span>
          ))}
        </div>
        {lignes.map((l) => {
          const bilan = bilanDe.get(l.veterinaire_id)
          return (
            <div
              className="cnt-row"
              key={l.veterinaire_id}
              style={{ '--nb-col': choix.length } as React.CSSProperties}
            >
              <span className="cnt-vet">
                <i style={{ background: l.couleur }} />
                {l.prenom}
                <small>{l.statut === 'associe' ? 'assoc.' : 'sal.'}</small>
              </span>
              {choix.map((c) => {
                if (c === 'ecart') {
                  return (
                    <span className="cnt-num" key={c}>
                      <Ecart
                        valeur={bilan?.ecart_we ?? 0}
                        horsRepartition={bilan === undefined}
                      />
                    </span>
                  )
                }
                const v = valeurDe(l, c)
                return (
                  <span className={`cnt-num${v === 0 ? ' zero' : ''}`} key={c}>
                    {v}
                    {COLONNES[c].barre && (
                      <span className="bar">
                        <b style={{ transform: `scaleX(${v / (maxDe.get(c) ?? 1)})` }} />
                      </span>
                    )}
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>

      <p className="cnt-ecart">
        {weMax - weMin === 0
          ? 'Week-ends parfaitement répartis.'
          : `Écart de ${weMax - weMin} week-end${weMax - weMin > 1 ? 's' : ''} entre le plus et le moins chargé.`}
      </p>
    </>
  )
}
