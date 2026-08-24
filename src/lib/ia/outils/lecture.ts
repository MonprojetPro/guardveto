// ============================================================
// GUARDVETO — Distinguer « il n'y a rien » de « ça n'a pas répondu »
// ============================================================
// SERVER-ONLY.
//
// LE PIÈGE QUE CE MODULE EXISTE POUR FERMER — « Filou est un consumer comme un
// autre : son échec est silencieux et poli. »
//
// Supabase ne LÈVE pas ses erreurs, il les RETOURNE. Une lecture écrite ainsi :
//
//     const { data } = await ctx.supabase.from('veterinaires').select(…)
//     return (data as Fiche[] | null) ?? []
//
// rend exactement la même chose quand la base répond « aucune ligne » et quand
// elle ne répond pas du tout : un tableau vide. Filou, lui, ne peut pas faire la
// différence — et un tableau vide, pour lui, est un FAIT sur le cabinet. Il en
// tire alors des affirmations catégoriques et fausses :
//
//   • « Aucun vétérinaire ne s'appelle "Camille" dans ce cabinet. Les
//     vétérinaires sont : » — phrase qui se termine sur un vide.
//   • « Aucun planning ne t'a encore été diffusé » — à quelqu'un dont le
//     planning est publié depuis un mois.
//
// LA RÈGLE : une lecture qui échoue doit REMONTER. La boucle de Filou
// (`agentFilou.ts`) transforme une exception d'outil en résultat `is_error`, ce
// qui lui rend la main avec la raison — il dira la panne au lieu d'inventer un
// fait. C'est le même principe que `publier_periode`, qui refuse déjà de
// confondre un contrôle en panne avec un contrôle sans réserve.
//
// Ce module ne rend donc jamais un `[]` de consolation : soit la donnée, soit
// une `PanneLecture` qui porte sa propre phrase en français.
// ============================================================

/** Le code que PostgREST renvoie quand un `.single()` ne trouve aucune ligne.
 *  Ce n'est PAS une panne : la base a répondu, et sa réponse est « rien ». */
const CODE_AUCUNE_LIGNE = 'PGRST116'

/** La forme minimale de ce que rend une requête Supabase. On ne dépend pas des
 *  types du client : ce module est appelé sur des dizaines de requêtes aux
 *  formes de `data` toutes différentes. */
export interface ReponseSupabase {
  data: unknown
  error: { message: string; code?: string } | null
}

/**
 * Une lecture qui n'a pas abouti.
 *
 * Le message n'est pas technique : il part tel quel vers Filou comme résultat
 * d'outil en erreur, et c'est lui qui décide de ce qu'il en dit à la personne.
 * On lui interdit donc explicitement de le lire comme un vide — sans cette
 * phrase, un modèle pressé enchaîne « aucun résultat » sur une erreur.
 */
export class PanneLecture extends Error {
  /** Ce qu'on essayait de lire, en français. Ex. « la liste de l'équipe ». */
  readonly quoi: string

  constructor(quoi: string, detail?: string) {
    super(
      `Je n'ai pas pu consulter ${quoi} : la base de données n'a pas répondu${
        detail ? ` (${detail})` : ''
      }. Ce n'est PAS un résultat vide — n'affirme rien au sujet de ${quoi}, et ne conclus surtout pas qu'il n'y a rien. Dis à la personne, en français, que cette consultation a échoué et qu'il faut réessayer.`,
    )
    this.name = 'PanneLecture'
    this.quoi = quoi
  }
}

/**
 * Les lignes d'une lecture, ou une panne — jamais un vide de consolation.
 *
 * @param quoi ce qu'on lisait, en français et au singulier de l'objet :
 *   « la liste de l'équipe », « les congés du cabinet ». Cette phrase se
 *   retrouve mot pour mot dans ce que Filou dira.
 */
export function lignesLues<T>(reponse: ReponseSupabase, quoi: string): T[] {
  if (reponse.error) throw new PanneLecture(quoi, reponse.error.message)
  return (reponse.data as T[] | null) ?? []
}

/**
 * La ligne unique d'une lecture, ou `null` si la base a répondu « aucune ».
 *
 * La nuance qui compte : un `.single()` sans résultat renvoie une ERREUR
 * (`PGRST116`) alors que c'est une réponse parfaitement valable. La confondre
 * avec une panne ferait crier Filou sur un cas normal — et l'habituer à crier,
 * c'est le meilleur moyen qu'on ne l'écoute plus quand il s'agit d'une vraie.
 */
export function ligneLue<T>(reponse: ReponseSupabase, quoi: string): T | null {
  if (reponse.error) {
    if (reponse.error.code === CODE_AUCUNE_LIGNE) return null
    throw new PanneLecture(quoi, reponse.error.message)
  }
  return (reponse.data as T | null) ?? null
}

/**
 * La phrase à rendre quand une ÉCRITURE a échoué.
 *
 * Les outils d'écriture ne lèvent pas : ils rendent `{ error }`, et l'action
 * serveur l'affiche à côté du bouton qui vient d'être cliqué. Ce qu'on refuse
 * ici, c'est l'écriture dont personne ne lit le résultat — Filou annonce alors
 * « c'est fait » sur une base qui n'a rien enregistré.
 */
export function messageEcritureRatee(quoi: string, detail?: string): string {
  return `${quoi} n'a pas pu être enregistré : la base de données a refusé l'écriture${
    detail ? ` (${detail})` : ''
  }. Rien n'a changé — réessaie dans un instant.`
}
