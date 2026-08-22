// ============================================================
// GUARDVETO — CartesViolations : UNE seule façon de montrer une violation
// ============================================================
// Trois écrans affichaient la même donnée (`ViolationRevalidation[]`) de trois
// façons différentes : `RevalidationRealtime` groupait déjà par cause,
// `DialogPublication` (+ le doublon dans `ActionBar`) listait les violations à
// plat avec la date ISO brute, `Epicentre` mettait le CODE machine en gras.
// MiKL : « c'est quoi cet affichage de merde » / « affichage dégueulasse ».
//
// Ce composant est la SEULE écriture d'une violation. Il consomme
// `grouperViolations` + `intituleViolation` (source unique du nommage,
// `lib/regles/libelleViolation.ts`) et regroupe en plus PAR VÉTÉRINAIRE à
// l'intérieur de chaque cause : « 12 dates » n'est presque jamais 12
// problèmes, c'est souvent 2 vétérinaires qui reviennent sur toutes les
// dates. Chaque ligne réutilise le `detail` déjà rédigé en français par le
// validateur (dates via `lib/dates-fr.ts` — jamais d'ISO brut ici).
//
// Toute violation qui atteint un écran est structurellement une règle DURE
// (le validateur écarte les règles souples avant de remplir la liste,
// `if (etage > 2) continue`, 8 fois dans `validerPlanning.ts`) — inutile donc
// de redistinguer des niveaux de gravité ici, il n'y en a qu'un.
//
// Origine héritée (lookback inter-périodes) : une violation dont les dates
// appartiennent à la période PRÉCÉDENTE n'est pas une faute du planning
// affiché — elle vient de l'historique saisi et se corrige en déverrouillant.
// Champ `origine` optionnel et provisoire (voir `types-revalidation.ts`) : tant
// qu'il n'est pas posé côté moteur, aucune ligne n'est marquée héritée et le
// rendu est identique à avant.
// ============================================================

import { grouperViolations } from '@/lib/regles/libelleViolation'
import type { ViolationRevalidation } from './types-revalidation'

interface CartesViolationsProps {
  violations: ViolationRevalidation[]
  /** Sous-groupes (vétérinaires) affichés avant de basculer sur « et N autres ». */
  maxParCause?: number
}

const DEFAUT_MAX_PAR_CAUSE = 8

function estHeritee(v: ViolationRevalidation): boolean {
  return v.origine === 'anterieure'
}

/** Sous-groupe d'une cause : un vétérinaire (ou, à défaut d'identifiant, une
 *  date isolée) — c'est lui qui porte le `detail` à afficher. */
interface SousGroupe {
  cle: string
  items: ViolationRevalidation[]
  heritee: boolean
}

function grouperParVeto(items: ViolationRevalidation[]): SousGroupe[] {
  const par = new Map<string, ViolationRevalidation[]>()
  for (const v of items) {
    // Sans identifiant de véto (violation collective, ex. COUVERTURE), on
    // isole par date+type plutôt que de tout fusionner sous une clé unique.
    const cle = v.vetId ?? `${v.date}·${v.type}`
    const liste = par.get(cle)
    if (liste) liste.push(v)
    else par.set(cle, [v])
  }
  return [...par.entries()].map(([cle, its]) => ({
    cle,
    items: its,
    heritee: its.every(estHeritee),
  }))
}

/**
 * Rend une carte par cause (`.gva-cause`), SANS conteneur englobant : c'est à
 * l'écran appelant de fournir le cadre (le `.gva-corps` du bandeau realtime,
 * le `.gp-controle` de la modale de publication…), qui diffère d'un écran à
 * l'autre. Ce qui ne doit JAMAIS différer, c'est le contenu d'une carte.
 */
export function CartesViolations({
  violations,
  maxParCause = DEFAUT_MAX_PAR_CAUSE,
}: CartesViolationsProps) {
  if (violations.length === 0) return null

  // Regroupé par CAUSE : « 12 incohérences » est presque toujours une ou deux
  // règles répétées sur plusieurs dates/vétérinaires.
  const causes = grouperViolations(violations)

  return (
    <>
      {causes.map((cause) => {
        const parVeto = grouperParVeto(cause.items)
        const sousGroupes = parVeto.slice(0, maxParCause)
        const reste = parVeto.length - sousGroupes.length
        const nbVetos = new Set(cause.items.map((v) => v.vetId).filter(Boolean)).size

        return (
          <div key={cause.code} className="gva-cause">
            <p className="gva-cause-tete">
              <span className="gva-cause-nom">{cause.intitule}</span>
              {nbVetos > 0 && (
                <span className="gva-cause-nb">
                  {nbVetos} vétérinaire{nbVetos > 1 ? 's' : ''} concerné{nbVetos > 1 ? 's' : ''}
                </span>
              )}
            </p>

            <ul className="gva-cause-liste">
              {sousGroupes.map((g) => {
                const autres = g.items.length - 1
                return (
                  <li key={g.cle} className="gva-cause-item">
                    {g.items[0].detail}
                    {autres > 0 && ` (+${autres} autre${autres > 1 ? 's' : ''} date${autres > 1 ? 's' : ''})`}
                    {g.heritee && (
                      <span className="gva-cause-heritee">
                        {' '}— héritée de l'historique saisi, hors de cette période : modifiable en
                        déverrouillant.
                      </span>
                    )}
                  </li>
                )
              })}
              {reste > 0 && (
                <li className="gva-cause-item gva-cause-reste">
                  … et {reste} autre{reste > 1 ? 's' : ''}.
                </li>
              )}
            </ul>
          </div>
        )
      })}
    </>
  )
}
