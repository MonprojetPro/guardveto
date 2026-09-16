// ============================================================
// GUARDVETO — Mettre en forme une proposition en attente pour l'écran (B-122 lot 2)
// ============================================================
// Même geste que `enLigne` dans `app/api/planning/relecture/route.ts`, en plus
// léger : le panneau d'aperçu du planning n'a pas le dossier complet de la
// relecture (`dossier.places`), seulement l'équipe et le catalogue de types
// déjà chargés par la page. Le label de créneau est donc approximatif sur les
// types sur-mesure sans nom de catalogue — acceptable ici, l'affichage sert à
// se repérer, pas à décider quoi écrire (ça, c'est `appliquerProposition.ts`).
// ============================================================

import type { ChangementPropose } from '@/engine/relecture/arbitrer'
import type { Violation } from '@/engine/validation/validerPlanning'
import { libelleTypeGardeDb } from '@/lib/libelles-gardes'
import { dateFrSansJour } from '@/lib/dates-fr'
import { enFrancais } from './traductionRelecture'

export interface PropositionAffichee {
  id: string
  motif: string
  /** Une ligne par affectation : « 12 nov · Week-end · 1er : Fanny à la place d'Antoine ». */
  geste: string[]
  /** Ce que le moteur reproche — pour que le bouton dise ce qu'il enfreint. */
  objections: string[]
  compteursProjetes: { prenom: string; avant: number; apres: number }[]
}

export function mettreEnFormePropositions(
  propositions: { id: string; changement: ChangementPropose; violations: Violation[]; compteursProjetes: { prenom: string; avant: number; apres: number }[] }[],
  prenomParId: Map<string, string>,
  nomsTypes: Record<string, string>,
): PropositionAffichee[] {
  return propositions.map((p) => ({
    id: p.id,
    motif: p.changement.motif,
    geste: p.changement.affectations.map((a) => {
      const nouveau = a.vetId ? (prenomParId.get(a.vetId) ?? '?') : 'personne'
      return `${dateFrSansJour(a.date)} · ${libelleTypeGardeDb(a.type, nomsTypes)} · ${a.role} : ${nouveau}`
    }),
    objections: p.violations.map((v) => enFrancais(v.detail, prenomParId)),
    compteursProjetes: p.compteursProjetes,
  }))
}
