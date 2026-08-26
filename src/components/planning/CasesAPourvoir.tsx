'use client'

// ============================================================
// GUARDVETO — Les cases restées à pourvoir (B-053)
// ============================================================
// Ce qui s'affichait avant : un mur rouge, dix règles à plat avec leur code
// machine, « 25 créneaux non couverts » (un chiffre faux — c'était tout ce qui
// suivait le point d'arrêt), et aucun planning. MiKL : « t'imagine un client qui
// tombe là-dessus, il panique ».
//
// Ce qui s'affiche maintenant : le planning EST en base, il lui manque N cases.
// Pour chacune : QUI ne pouvait pas, POURQUOI, et COMMENT débloquer.
//
// Trois principes tenus ici :
//   • grouper par CAUSE, jamais aligner des codes (règle du 19/08) ;
//   • ne jamais taire une exclusion — la liste des empêchés est complète, sinon
//     l'admin croirait que les absents de la liste étaient disponibles ;
//   • ne proposer que des leviers RÉELS, tirés des raisons rencontrées. Aucune
//     piste inventée, aucune promesse de résultat : on dit ce qui bloque et ce
//     sur quoi on peut agir, pas « fais ça et ça marchera ».
// ============================================================

import { CalendarClock } from 'lucide-react'
import { sansCodeTechnique } from '@/lib/regles/sansCodeTechnique'

export interface RaisonAffichee {
  /** Code technique du moteur — sert au GROUPEMENT, jamais à l'affichage. */
  code: string
  vetId: string
  raison: string
}

export interface CaseVide {
  date: string
  type: string
  role: string
  raisons: RaisonAffichee[]
}

// ── Libellés ─────────────────────────────────────────────

function dateLisible(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })
}

function libelleCase(c: CaseVide): string {
  const quoi = c.type === 'weekend' ? 'le week-end du' : 'la nuit du'
  const qui =
    c.role === 'premier' ? '1er de garde'
      : c.role === 'second' ? '2e de garde'
        : c.role
  return `${quoi} ${dateLisible(c.date)} — ${qui}`
}

/**
 * La famille d'une raison — c'est elle qui porte le « comment débloquer ».
 * On lit le CODE (stable) et non le texte (qui change avec les libellés).
 */
type Famille = 'conge' | 'deja_de_garde' | 'structure' | 'regle'

function familleDe(code: string): Famille {
  if (code === 'R16') return 'conge'
  if (code === 'R21' || code === 'R17' || code === 'R18' || code === 'R19') return 'deja_de_garde'
  if (code === 'R8' || code === 'R9') return 'structure'
  return 'regle'
}

/** Ce sur quoi on peut AGIR, par famille. Jamais une promesse de résultat. */
const LEVIER: Record<Famille, string> = {
  conge: 'Un congé peut être décalé ou raccourci — c’est la voie la plus directe.',
  deja_de_garde: 'Il faudrait une personne de plus ce soir-là : la même ne peut pas tenir deux places.',
  structure: 'C’est l’enchaînement vendredi ↔ week-end qui impose le duo. Il se règle dans les règles de structure.',
  regle: 'Ces règles peuvent être assouplies depuis l’écran Règles — l’une d’elles suffit peut-être.',
}

// ── Composant ────────────────────────────────────────────

export function CasesAPourvoir({
  cases,
  nomParVet,
}: {
  cases: CaseVide[]
  /** Prénom d'un vétérinaire ; sans lui on n'affiche jamais son identifiant. */
  nomParVet?: (vetId: string) => string | undefined
}) {
  if (cases.length === 0) return null

  return (
    <div className="cap-bloc">
      <p className="cap-titre">
        <CalendarClock className="cap-ico" aria-hidden />
        {cases.length === 1
          ? 'Une case n’a trouvé personne'
          : `${cases.length} cases n’ont trouvé personne`}
      </p>
      <p className="cap-sous">
        Le reste du planning est déjà en place. Pour chacune, voici qui ne pouvait pas,
        et ce sur quoi tu peux agir.
      </p>

      <ul className="cap-liste">
        {cases.map((c) => {
          // Groupement par cause — jamais une liste de codes à plat.
          const parFamille = new Map<Famille, RaisonAffichee[]>()
          for (const r of c.raisons) {
            const f = familleDe(r.code)
            parFamille.set(f, [...(parFamille.get(f) ?? []), r])
          }
          // Les familles les plus représentées d'abord : c'est là qu'est le levier.
          const familles = [...parFamille.entries()].sort((a, b) => b[1].length - a[1].length)

          return (
            <li key={`${c.date}|${c.type}|${c.role}`} className="cap-item">
              <p className="cap-quand">{libelleCase(c)}</p>

              {familles.map(([famille, raisons]) => (
                <div key={famille} className="cap-famille">
                  <ul className="cap-raisons">
                    {raisons.map((r, i) => (
                      // Les libellés du moteur commencent par le prénom
                      // (« Manon est en congé du… ») : on affiche le message
                      // nettoyé de son code, sans redire le nom. `nomParVet`
                      // n'est le filet que si un libellé venait à l'omettre —
                      // et il ne rend JAMAIS un identifiant à l'écran.
                      <li key={i}>
                        {sansCodeTechnique(r.raison) ||
                          `${nomParVet?.(r.vetId) ?? 'Un vétérinaire'} n’est pas disponible`}
                      </li>
                    ))}
                  </ul>
                  <p className="cap-levier">{LEVIER[famille]}</p>
                </div>
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
