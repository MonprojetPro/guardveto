// ============================================================
// GUARDVETO — D'où Filou tient ce qu'il vient de dire
// ============================================================
// La doctrine du produit tient en une phrase : « le moteur et les garde-fous
// décident, Filou est le porte-parole ». Le second gardien (`agentFilou.ts`)
// veille sur ce qu'il OUBLIE de proposer — personne ne veillait sur ce qu'il
// AFFIRME.
//
// Deux chemins laissent passer un texte que rien ne fonde :
//   ① le modèle répond en texte libre dès le premier tour, sans avoir appelé
//      le moindre outil : sa réponse part quand même sur le tableau ;
//   ② `afficher_sur_le_tableau` prend du texte libre, affiché tel quel.
//
// MiKL a tranché : ON AFFICHE LES SOURCES, ON NE BLOQUE PAS. C'est la même
// règle que partout ailleurs dans GuardVeto — le système INFORME, il
// n'interdit pas. Un assistant qui refuse de répondre est un assistant qu'on
// cesse d'utiliser ; un assistant dont on voit sur quoi il s'appuie est un
// assistant qu'on peut contredire.
//
// Le cas qui compte le plus n'est pas la jolie liste : c'est la ligne AUCUNE
// LECTURE. C'est précisément le moment où il faut se méfier, et jusqu'ici rien
// ne le disait.
//
// ⚠️ Ces libellés ne sont PAS des noms d'outils. « lire_gardes, lire_equipe »
// ne veut rien dire pour Anne-Sophie. On écrit ce qu'un humain reconnaîtrait
// dans son propre logiciel.
// ============================================================

import { CATALOGUE } from './registre'
import { AUCUNE_LECTURE, phraseDApres } from '../sources-texte'

/**
 * Nom d'outil → ce qu'il a consulté, en français.
 *
 * Volontairement au singulier de l'objet et sans article de tête : ces morceaux
 * s'assemblent en « D'après le planning et les fiches de l'équipe. »
 *
 * Un outil de LECTURE absent de cette table est une régression silencieuse — la
 * réponse s'afficherait sans dire d'où elle vient. Le test
 * `sources.test.ts` refuse le catalogue si un seul y manque.
 */
const LIBELLES: Record<string, string> = {
  lire_equipe: "les fiches de l'équipe",
  lister_regles: 'les règles du cabinet',
  lire_gardes: 'le planning',
  lire_etat_periodes: "l'état des plannings",
  verifier_pre_vol_periode: 'le contrôle avant génération',
  lire_compteurs: 'les compteurs de gardes',
  lire_historique_periodes: "l'historique des plannings",
  lire_historique_fetes: "l'historique des fêtes de fin d'année",
  verifier_coherence_planning: 'le contrôle de cohérence du planning',
  lire_reglages_equite: "les réglages d'équité",
  lire_conges: 'les congés',
  lire_souhaits_en_attente: 'les souhaits de congés en attente',
  lire_absences: 'les absences',
  lire_compensations: 'les dépannages',
  lire_creneaux_touches: "les gardes touchées par l'absence",
  lire_echanges: 'les échanges de gardes',
  lire_profils_planning: 'les périodes types',
  lire_creneaux_profil: 'les types de garde',
  lire_relations_creneaux: 'les liens entre types de garde',
  lire_reglages_cabinet: 'les réglages du cabinet',
}

/** Les noms des outils qui LISENT quelque chose. Un outil d'affichage ne
 *  fonde rien, et une écriture n'a pas encore eu lieu : ni l'un ni l'autre
 *  n'est une source. */
const NOMS_LECTURE = new Set(
  CATALOGUE.filter((o) => o.genre === 'lecture').map((o) => o.nom),
)

/** Le catalogue tel qu'il devrait être décrit ici — sert au garde-fou de test. */
export function nomsDesLecturesDuCatalogue(): string[] {
  return [...NOMS_LECTURE]
}

/**
 * Ce sur quoi la réponse s'appuie, en français, sans doublon et dans l'ordre
 * où Filou a consulté.
 *
 * `outilsAppeles` porte aussi les écritures et le témoin « (2ᵉ regard) » du
 * second gardien : on les écarte ici, seule la lecture fonde une affirmation.
 */
export function sourcesLisibles(outilsAppeles: string[] | undefined): string[] {
  const vues: string[] = []
  for (const brut of outilsAppeles ?? []) {
    // Le second gardien suffixe le nom qu'il a retenu. On retrouve l'outil.
    const nom = brut.replace(/\s*\(2ᵉ regard\)\s*$/, '').trim()
    if (!NOMS_LECTURE.has(nom)) continue
    const libelle = LIBELLES[nom]
    if (!libelle || vues.includes(libelle)) continue
    vues.push(libelle)
  }
  return vues
}

/**
 * La ligne affichée sous la réponse.
 *
 * Quand rien n'a été lu, elle ne se contente pas de disparaître : elle le DIT.
 * Une absence de mention se lit comme « pas d'information », alors qu'ici c'est
 * l'information la plus importante de la fenêtre.
 */
export function phraseSources(outilsAppeles: string[] | undefined): string {
  const sources = sourcesLisibles(outilsAppeles)
  return sources.length === 0 ? AUCUNE_LECTURE : phraseDApres(sources)
}

/** Vrai quand la réponse ne repose sur AUCUNE lecture. C'est ce qui décide du
 *  ton de la ligne à l'écran : un rappel discret ou une mise en garde. */
export function sansAucuneLecture(outilsAppeles: string[] | undefined): boolean {
  return sourcesLisibles(outilsAppeles).length === 0
}
