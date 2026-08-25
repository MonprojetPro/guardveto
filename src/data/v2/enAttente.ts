// ============================================================
// GUARDVETO V2 — Ce qui attend quelqu'un, compté pour de vrai
// ============================================================
// Le pendant exécutable de `lib/produit/attentes.ts` : celui-là dit CE QU'ON
// A DÉCIDÉ, celui-ci va le COMPTER en base et le rendre affichable.
//
// La séparation n'est pas cosmétique. Le registre est lu par un test qui
// refuse le silence ; ce catalogue est lu par l'accueil. Les garder ensemble
// aurait fini par faire dépendre le test d'un client Supabase, donc par le
// rendre lent, donc par le faire sauter.
//
// ── TROIS RÈGLES DE MAISON, TOUTES TROIS DÉJÀ PAYÉES ICI ────────────────────
//
// ① UNE ERREUR NE DEVIENT JAMAIS ZÉRO. Un `?? 0` avalé transforme « je n'ai
//    pas pu compter » en « il n'y a rien en attente » — c'est-à-dire en la
//    phrase exacte que ce chantier corrige. Chaque compte remonte donc son
//    erreur, et une fiche qui n'a pas pu être comptée s'affiche en le disant
//    plutôt que de disparaître. (Mémoire projet :
//    « supabase-erreur-avalee-devient-zero-ligne ».)
//
// ② ON NE COMPTE QUE CE QU'ON PEUT DÉFENDRE. Une fiche qui réclame une action
//    déjà faite se fait ignorer, puis fait ignorer les autres — le faux
//    positif de l'espacement minimum (`bb180d4`) a coûté exactement ça. D'où
//    l'absence assumée de fiche pour les absences, écrite au registre.
//
// ③ BEST-EFFORT, MAIS PAS SILENCIEUX. L'accueil ne doit pas tomber parce
//    qu'un compte secondaire a échoué ; il ne doit pas non plus faire comme
//    si de rien n'était.
// ============================================================

import type { createClient } from '@/lib/supabase/server'
import type { Veterinaire } from '@/types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Qui voit une fiche. */
export type Destinataire = 'admin' | 'veto' | 'tous'

/**
 * Une fiche du tableau, telle qu'elle est DÉFINIE (pas encore comptée).
 *
 * `rendueAilleurs` marque les fiches qui existent déjà dans l'Épicentre avec
 * leur propre fenêtre détaillée (les souhaits de congé côté administratrice
 * ouvrent la liste complète avec les conflits ; la période à publier ouvre son
 * récapitulatif). On ne les réécrit pas en simple lien — ce serait perdre du
 * contenu pour gagner de l'uniformité. Elles sont déclarées ici uniquement
 * pour que le registre puisse les citer sans mentir.
 */
export interface DefinitionFiche {
  cle: string
  pour: Destinataire
  rendueAilleurs?: true
}

/**
 * Une fiche prête à afficher : la définition, plus ce qu'on a compté.
 */
export interface FicheEnAttente {
  cle: string
  icone: string
  titre: string
  detail: string
  href: string
  /** Combien d'éléments attendent. Toujours ≥ 1 : on ne rend pas les fiches vides. */
  nombre: number
  /**
   * Ce qui a empêché de compter, le cas échéant. Une fiche porteuse d'une
   * erreur s'affiche quand même, en le disant — c'est tout l'intérêt.
   */
  erreur?: string
}

/**
 * TOUTES les fiches du tableau, y compris celles rendues ailleurs.
 *
 * Le test de couverture vérifie que chaque clé citée par le registre figure
 * ici, et qu'aucune fiche d'ici n'est orpheline. Les deux sens comptent :
 * une fiche supprimée sans que le registre bouge laisserait un état du
 * produit déclaré couvert alors qu'il ne l'est plus.
 */
export const FICHES: DefinitionFiche[] = [
  { cle: 'conges-a-decider', pour: 'admin', rendueAilleurs: true },
  { cle: 'periode-a-publier', pour: 'admin', rendueAilleurs: true },
  { cle: 'mon-conge-en-attente', pour: 'veto' },
  { cle: 'echange-a-repondre', pour: 'veto' },
  { cle: 'echange-a-valider', pour: 'admin' },
  { cle: 'depannage-a-rendre', pour: 'admin' },
]

/** Les tables que ces comptes interrogent — la liste que le temps réel doit écouter. */
export const TABLES_ECOUTEES = ['conges', 'echanges_gardes', 'compensations'] as const

function pluriel(n: number, singulier: string, plur: string): string {
  return n > 1 ? plur : singulier
}

/**
 * Un comptage : le nombre, et ce qui a empêché de le faire.
 *
 * `null` en nombre veut dire « je n'ai pas pu compter » — ce qui n'est PAS
 * zéro. Les deux se distinguent à l'affichage.
 */
interface Comptage {
  nombre: number | null
  erreur: string | null
}

async function compter(
  requete: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<Comptage> {
  const { count, error } = await requete
  if (error) return { nombre: null, erreur: error.message }
  return { nombre: count ?? 0, erreur: null }
}

/**
 * Compte tout ce qui attend LA PERSONNE CONNECTÉE, et rend les fiches à
 * afficher — dans l'ordre où elles doivent apparaître.
 *
 * ⚠️ CHAQUE FICHE EST BORNÉE À CE QUI CONCERNE VRAIMENT SON DESTINATAIRE.
 * « Un échange attend une réponse » n'a de sens pour un vétérinaire que si
 * c'est LUI qu'on attend. Lui montrer les échanges des autres serait du bruit
 * sur lequel il ne peut rien, et le bruit finit par masquer le signal.
 *
 * La RLS borne déjà tout au cabinet ; les filtres ci-dessous bornent à la
 * personne. Les deux sont nécessaires et ne font pas le même travail.
 */
export async function chargerEnAttente(
  supabase: SupabaseServerClient,
  veterinaire: Veterinaire,
): Promise<FicheEnAttente[]> {
  const estAdmin = veterinaire.role_app === 'admin'
  const moi = veterinaire.id

  const [monConge, echangeARepondre, echangeAValider, depannage] = await Promise.all([
    // ── Mon souhait de congé attend toujours une réponse ──────────────────
    // Pour le vétérinaire, pas pour l'administratrice : celle-ci a déjà sa
    // fiche avec la liste complète et les conflits détectés.
    estAdmin
      ? Promise.resolve<Comptage>({ nombre: 0, erreur: null })
      : compter(
          supabase
            .from('conges')
            .select('id', { count: 'exact', head: true })
            .eq('statut', 'souhait')
            .eq('veterinaire_id', moi),
        ),

    // ── Un échange attend MA réponse ──────────────────────────────────────
    // Deux cas, et il fallait les deux : l'échange qui me vise nommément
    // (`cible_id = moi`), et l'échange OUVERT à toute l'équipe
    // (`cible_id is null`, migration `echanges_ouverts`) que n'importe qui
    // peut prendre. Ne garder que le premier aurait laissé les échanges
    // ouverts exactement là où ils étaient : nulle part.
    //
    // On exclut les miens : je n'ai pas à me répondre à moi-même.
    estAdmin
      ? Promise.resolve<Comptage>({ nombre: 0, erreur: null })
      : compter(
          supabase
            .from('echanges_gardes')
            .select('id', { count: 'exact', head: true })
            .eq('statut', 'proposee')
            .neq('demandeur_id', moi)
            .or(`cible_id.eq.${moi},cible_id.is.null`),
        ),

    // ── Un échange accepté attend le feu vert de l'administratrice ────────
    // C'est la moitié invisible du parcours d'échange : les deux
    // vétérinaires se sont mis d'accord et croient l'affaire réglée, alors
    // que la garde n'a pas encore changé de main.
    estAdmin
      ? compter(
          supabase
            .from('echanges_gardes')
            .select('id', { count: 'exact', head: true })
            .eq('statut', 'acceptee'),
        )
      : Promise.resolve<Comptage>({ nombre: 0, erreur: null }),

    // ── Une garde reprise n'a jamais été rendue ───────────────────────────
    // Une dette n'expire pas toute seule. Sans fiche, elle ne vivait que sur
    // un écran où l'on ne va pas sans raison — donc où l'on ne va jamais,
    // puisque la raison d'y aller est justement ce qu'on ignore.
    estAdmin
      ? compter(
          supabase
            .from('compensations')
            .select('id', { count: 'exact', head: true })
            .eq('statut', 'a_compenser'),
        )
      : Promise.resolve<Comptage>({ nombre: 0, erreur: null }),
  ])

  const fiches: FicheEnAttente[] = []

  /** N'ajoute que ce qui a quelque chose à dire — ou qui n'a pas pu être lu. */
  const ajouter = (
    cle: string,
    c: Comptage,
    icone: string,
    href: string,
    titre: (n: number) => string,
    detail: (n: number) => string,
  ) => {
    if (c.erreur) {
      fiches.push({
        cle,
        icone: '⚠️',
        titre: "Je n'ai pas pu vérifier",
        detail: 'Ce compteur est momentanément muet — il ne dit pas qu\'il n\'y a rien.',
        href,
        nombre: 0,
        erreur: c.erreur,
      })
      return
    }
    const n = c.nombre ?? 0
    if (n === 0) return
    fiches.push({ cle, icone, titre: titre(n), detail: detail(n), href, nombre: n })
  }

  ajouter(
    'echange-a-repondre',
    echangeARepondre,
    '🤝',
    '/absences',
    (n) => `${n} ${pluriel(n, 'échange attend', 'échanges attendent')} ta réponse`,
    (n) => `Un confrère te ${pluriel(n, 'propose', 'proposent')} de reprendre une garde`,
  )

  ajouter(
    'echange-a-valider',
    echangeAValider,
    '🤝',
    '/absences',
    (n) =>
      `${n} ${pluriel(n, 'échange accepté attend', 'échanges acceptés attendent')} ta validation`,
    (n) =>
      `Les deux vétérinaires sont d'accord — ${pluriel(n, 'la garde ne changera', 'les gardes ne changeront')} de main qu'après ton feu vert`,
  )

  ajouter(
    'depannage-a-rendre',
    depannage,
    '💛',
    '/absences',
    (n) => `${n} ${pluriel(n, 'garde reprise', 'gardes reprises')} ${pluriel(n, "n'a", "n'ont")} pas été ${pluriel(n, 'rendue', 'rendues')}`,
    (n) => `Quelqu'un a dépanné ${pluriel(n, 'une fois', `${n} fois`)} sans contrepartie`,
  )

  ajouter(
    'mon-conge-en-attente',
    monConge,
    '⏳',
    '/absences',
    (n) => `${pluriel(n, 'Ta demande de congé attend', `Tes ${n} demandes de congé attendent`)} une réponse`,
    () => "Elle est bien arrivée — c'est l'administratrice qui doit trancher",
  )

  return fiches
}
