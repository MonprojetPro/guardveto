// ============================================================
// GUARDVETO — Un abonnement temps réel qui échoue doit se VOIR
// ============================================================
// LE PIÈGE, payé deux fois sur ce projet.
//
// `canal.subscribe()` sans rappel de statut ne lève rien, ne journalise rien,
// ne rend rien. Si l'abonnement échoue — table absente de la publication
// `supabase_realtime`, RLS qui refuse la lecture, canal dupliqué — le composant
// est monté, le code semble tourner, et **aucun événement n'arrive jamais**.
//
// Le symptôme visible est l'absence de symptôme : l'écran ne se met pas à jour,
// et l'on conclut qu'il n'y avait rien de nouveau. C'est précisément ce qui
// s'est produit le 2026-08-25 sur `compensations` et `absences`, absentes de la
// publication — l'accueil « écoutait » deux tables qui ne parlaient pas.
//
// CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
//
// Il ne répare rien et n'affiche rien à l'utilisateur : un avertissement rouge
// sur l'écran d'un vétérinaire parce qu'un canal a mal démarré serait du bruit
// pour quelqu'un qui n'y peut rien. Il NOMME l'échec dans la console, avec les
// trois causes possibles et la table concernée — de quoi trancher en trente
// secondes au lieu de soupçonner le cache, le réseau, puis le navigateur.
//
// Repris du kit `realtime-refresh-supabase-next` (catalogue FORGE, 25/08), dont
// l'extraction avait justement révélé que les CINQ implémentations de ce projet
// partageaient cet angle mort — aucune ne lisait le statut de son abonnement.
// ============================================================

import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Abonne le canal en surveillant son démarrage.
 *
 * @param canal   le canal déjà garni de ses `.on(...)`
 * @param quoi    ce que ce canal écoute, en clair — sert au message d'alerte
 *                (ex. « accueil : conges, echanges, compensations »)
 */
export function abonnerEnSignalantLesEchecs(canal: RealtimeChannel, quoi: string): void {
  canal.subscribe((statut, erreur) => {
    // `SUBSCRIBED` est le seul état sain. `CLOSED` survient normalement au
    // démontage du composant : le signaler ferait crier chaque navigation.
    if (statut === 'SUBSCRIBED' || statut === 'CLOSED') return

    console.error(
      `[temps réel] L'abonnement « ${quoi} » n'a pas démarré (${statut}). ` +
        `L'écran ne se mettra PAS à jour tout seul — et rien d'autre ne le dira. ` +
        `Trois causes, dans cet ordre de fréquence : ` +
        `① une des tables écoutées est absente de la publication ` +
        `\`supabase_realtime\` (un abonnement à une table non publiée n'échoue pas, ` +
        `il ne se déclenche jamais) ; ` +
        `② la RLS interdit à cette personne de lire les lignes concernées ; ` +
        `③ deux canaux portent le même nom.` +
        (erreur ? ` Détail : ${erreur.message}` : ''),
    )
  })
}
