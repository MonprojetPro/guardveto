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
type Famille = 'attente_premier' | 'conge' | 'deja_de_garde' | 'structure' | 'regle'

function familleDe(code: string): Famille {
  // R18/R19 — « le 1er doit être désigné avant le 2nd ». Ce n'est PAS un
  // empêchement, c'est l'ordre de remplissage : cette place attend simplement
  // que la précédente soit pourvue. Famille à part, sans levier propre.
  if (code === 'R18' || code === 'R19') return 'attente_premier'
  if (code === 'R16') return 'conge'
  if (code === 'R21' || code === 'R17') return 'deja_de_garde'
  if (code === 'R8' || code === 'R9') return 'structure'
  return 'regle'
}

/**
 * Une place qui n'attend QUE d'en voir une autre pourvue n'est pas un problème
 * en soi (B-054).
 *
 * MiKL, en recette : « il répète plusieurs fois la même objection ». Sur le
 * week-end du 26/09, cinq lignes identiques — « Le 1er de garde WE doit être
 * désigné avant le 2nd » — une par vétérinaire. Or cette phrase ne dit rien de
 * ce qui bloque : elle apparaît parce que la place du 1er est restée vide. La
 * traiter comme une cause envoie chercher un empêchement qui n'existe pas.
 */
function estConsequence(c: CaseVide): boolean {
  return c.raisons.length > 0 && c.raisons.every((r) => familleDe(r.code) === 'attente_premier')
}

/**
 * Dédoublonne les raisons sur leur TEXTE.
 *
 * « Le 1er de garde WE doit être désigné avant le 2nd » est identique pour tout
 * le monde — elle ne nomme personne. L'afficher cinq fois donne l'impression de
 * cinq obstacles là où il n'y en a qu'un.
 */
function raisonsUniques(raisons: RaisonAffichee[]): RaisonAffichee[] {
  const vues = new Set<string>()
  return raisons.filter((r) => {
    const cle = r.raison.trim()
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
}

/** Ce sur quoi on peut AGIR, par famille. Jamais une promesse de résultat. */
const LEVIER: Record<Famille, string> = {
  attente_premier: 'Pourvois d’abord la place précédente : celle-ci s’ouvrira ensuite.',
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
          // Une place qui attend seulement qu'une autre soit pourvue : on le dit
          // en une phrase, sans dérouler cinq fois la même objection.
          if (estConsequence(c)) {
            return (
              <li key={`${c.date}|${c.type}|${c.role}`} className="cap-item">
                <p className="cap-quand">{libelleCase(c)}</p>
                <p className="cap-levier">{LEVIER.attente_premier}</p>
              </li>
            )
          }

          // Groupement par cause — jamais une liste de codes à plat.
          const parFamille = new Map<Famille, RaisonAffichee[]>()
          for (const r of raisonsUniques(c.raisons)) {
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
