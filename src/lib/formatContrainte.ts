import type { ContrainteVeto, Veterinaire } from '@/types'

const JOURS: Record<string, string> = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi',
  jeudi: 'Jeudi', vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
}

const PERIODES_LABEL: Record<string, string> = {
  soir_semaine: 'soir semaine',
  weekend: 'weekend',
  journee_semaine: 'journée semaine',
  apres_midi: 'après-midi',
  journee: 'journée',
}

function labelJour(j: string) {
  return JOURS[j] ?? j
}

function labelPeriode(p: string) {
  return PERIODES_LABEL[p] ?? p
}

export function formatContrainte(
  contrainte: ContrainteVeto,
  vets: Veterinaire[]
): string {
  const cfg = contrainte.config as Record<string, unknown>

  // Si la config contient une description pré-calculée (données de seed)
  if (typeof cfg.description === 'string' && cfg.description.length > 0) {
    return cfg.description
  }

  switch (contrainte.type) {
    case 'jour_repos_fixe': {
      // Format standardisé : { jour, flexible_vacances }
      if (typeof cfg.jour === 'string') {
        const base = `Repos le ${labelJour(cfg.jour)}`
        const extra = cfg.flexible_vacances ? ' (flexible en vacances scolaires)' : ''
        const periode = typeof cfg.periode === 'string' ? ` (${labelPeriode(cfg.periode)})` : ''
        return base + periode + extra
      }
      // Format avec regles array (seed Anne-Sophie)
      if (Array.isArray(cfg.regles)) {
        const parts = (cfg.regles as Array<{ jour: string; periode?: string; semaine?: string }>)
          .map((r) => {
            let s = labelJour(r.jour)
            if (r.periode) s += ` ${labelPeriode(r.periode)}`
            if (r.semaine) s += ` (sem. ${r.semaine}s)`
            return s
          })
        return `Repos : ${parts.join(' · ')}`
      }
      return 'Jour de repos fixe'
    }

    case 'jour_repos_conditionnel': {
      const si = typeof cfg.si_garde_we === 'string' ? labelJour(cfg.si_garde_we) : '?'
      const sinon = typeof cfg.sinon === 'string' ? labelJour(cfg.sinon) : '?'
      return `Si garde WE → repos le ${si} · sinon le ${sinon}`
    }

    case 'indisponibilite_cyclique': {
      const sem = cfg.semaines === 'paires' ? 'paires'
        : cfg.semaines === 'impaires' ? 'impaires'
        : 'toutes'
      const periodes = Array.isArray(cfg.periodes)
        ? (cfg.periodes as string[]).map(labelPeriode).join(', ')
        : '?'
      return `Indispo sem. ${sem} : ${periodes}`
    }

    case 'duo_interdit': {
      const autreId = cfg.avec_veterinaire_id as string | undefined
      const autre = vets.find((v) => v.id === autreId)
      const nom = autre ? `${autre.prenom} ${autre.nom}` : 'vétérinaire inconnu'
      return `Duo interdit avec ${nom}`
    }

    default:
      return 'Contrainte inconnue'
  }
}

export const TYPE_LABELS: Record<ContrainteVeto['type'], string> = {
  jour_repos_fixe: 'Jour de repos fixe',
  jour_repos_conditionnel: 'Repos conditionnel (WE)',
  indisponibilite_cyclique: 'Indisponibilité cyclique',
  duo_interdit: 'Duo interdit',
}
