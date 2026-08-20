# Audit — Filou est-il à jour des changements ?

> Date : 2026-08-21 · Périmètre : catalogue d'outils de Filou (`src/lib/ia/outils/`) confronté aux
> changements du 20-21/08 (remplacement d'un seul jour, détection d'absence élargie, règle de
> diffusion, historique réservé aux admins).
> **Aucun fichier de code n'a été modifié, aucune écriture en base.**

---

## Le mécanisme qui explique presque tout

Deux faits, vérifiés en base, expliquent la majorité des constats ci-dessous.

**① Les vues `planning_semaine` et `compteurs_gardes` ne sont soumises à AUCUNE RLS.**
Elles appartiennent à `postgres`, qui porte `rolbypassrls = true`, et elles n'ont pas l'option
`security_invoker`. Une vue non-invoker s'exécute avec les droits de son propriétaire : ni la
politique de rôle, ni même l'isolation par cabinet ne s'appliquent à qui la lit.

```
relname            | owner    | bypassrls | reloptions
planning_semaine   | postgres | true      | null
compteurs_gardes   | postgres | true      | null
```

C'est exactement ce que le correctif d'hier avait constaté sur l'écran planning
(`src/app/(v2)/planning/page.tsx:161` — « la RLS laisse volontairement passer toutes les périodes
du cabinet […] c'est donc ICI que se fait le tri »). Le tri a été posé dans l'écran. **Il n'a pas
été posé dans Filou.**

**② Les tables, elles, sont bien bornées.** `periodes` limite un véto aux statuts
`publie` / `verrouille` (`periodes_read_publie`), `conges` à ses propres lignes
(`conges_veto_read_own`). Les outils de Filou qui passent par les tables sont donc protégés ;
ceux qui passent par les vues ne le sont pas.

**État réel de la base aujourd'hui** : une seule période, `verrouille`, `publie_at IS NULL`
— donc **jamais diffusée** — et 24 jours de planning derrière elle. C'est l'« Historique été
2026 » que le commit `c1f538b` a précisément retiré de la vue d'un vétérinaire.

---

## 1. Tableau des outils

| Outil Filou | Ce qu'il lit | Borné au rôle ? | Impacté par les changements ? | Verdict |
|---|---|---|---|---|
| `afficher_sur_le_tableau` | rien (affichage) | s.o. | non | ✅ |
| `lire_equipe` | table `veterinaires` | ❌ non (ouvert véto) | écran `/equipe` devenu admin-seul | ⚠️ plus bavard que l'écran |
| `lister_regles` | `regles_cabinet` | ❌ non | écran `/regles` reste ouvert en lecture au véto | ✅ cohérent |
| **`lire_gardes`** | **vue `planning_semaine`** | ❌ **non** | **règle de diffusion (pt 3)** | 🔴 **fuite** |
| `lire_etat_periodes` | table `periodes` | RLS : publié/verrouillé | diffusion (pt 3) | ⚠️ le « verrouillé jamais diffusé » passe |
| **`lire_compteurs`** | **vue `compteurs_gardes`** + `periodes` | ❌ **non** (bilan officiel seul est admin) | **historique admin-seul (pt 4)** + exceptions (pt 1) | 🔴 **fuite + incomplet** |
| `lire_historique_periodes` | table `periodes` | RLS : publié/verrouillé | diffusion (pt 3) | ⚠️ même réserve |
| `lire_historique_fetes` | `historique_fetes` | ❌ non | non | ✅ |
| `verifier_coherence_planning` | `revaliderPlanningPublie` | ✅ admin | exceptions non contrôlées | ⚠️ incomplet |
| `lire_conges` | table `conges` | ✅ RLS + refus explicite | non | ✅ (modèle du genre) |
| `lire_souhaits_en_attente` | `conges` | ✅ admin | non | ✅ |
| `lire_absences` | table `absences` | ❌ non (RLS `read_auth = true`) | détection élargie (pt 2) | ✅ cohérent avec `/absences` |
| `lire_compensations` | `compensations` | ✅ admin | non | ✅ |
| **`lire_creneaux_touches`** | `recenserCreneauxImpactes` | ✅ admin | **pt 2 : `joursTouches` ignoré** | ⚠️ incomplet |
| `lire_echanges` | `echanges_gardes` | ✅ RLS + filtres `ctx.vetoId` | non | ✅ |
| `lire_reglages_equite` | `regles_cabinet` | ❌ non | non | ✅ |
| `lire_profils_planning` / `lire_creneaux_profil` / `lire_relations_creneaux` / `lire_reglages_cabinet` | `profils_planning`, `creneau_modele`, `relation_creneau`, `cabinets` | ❌ non | non | ✅ cohérent avec `/regles` |
| `modifier_veterinaire` | action serveur `/equipe` | ✅ admin | non | ✅ |
| `creer_regle`, `agir_sur_regles` | actions `/regles` | ✅ admin | non | ✅ |
| `poser_conge` | action `createConge` | ✅ sujet forcé sur soi si véto | non | ✅ |
| `valider_conge`, `refuser_conge` | actions `/conges` | ✅ admin | non | ✅ |
| `supprimer_conge` | `deleteConge` | ✅ souhait propre si véto | non | ✅ |
| `declarer_absence` | INSERT `absences` | ✅ admin | pt 2 : compte les créneaux, pas les jours | ⚠️ mineur |
| `appeler_volontaires` | `sendAppelVolontaires` | ✅ admin | **pt 2 : appelle sur le BLOC** | ⚠️ incomplet |
| **`reparer_absence`** | `appliquerChangementGarde` | ✅ admin | **pt 1 + 2 : écrit toujours le bloc** | ⚠️ **incomplet, effet lourd** |
| `marquer_compensation` | action `/depannages` | ✅ admin | non | ✅ |
| `proposer/accepter/refuser/annuler_echange` | actions `/echanges` | ✅ RLS + `statut = 'publie'` exigé côté action | non | ✅ |
| `valider_echange_admin`, `refuser_echange_admin` | actions `/echanges` | ✅ admin | non | ✅ |
| `creer_periode`, `regler_periode`, `publier_periode`, `verifier_pre_vol_periode` | actions `/periodes`, `/api/publish`, `/api/generate/pre-vol` | ✅ admin | non | ✅ |
| `regler_equite` | action `/regles` | ✅ admin | non | ✅ |
| Les 10 outils de `structure.ts` en écriture | actions `/regles` | ✅ admin | non | ✅ |

**Aucun outil du catalogue ne connaît `gardes_exceptions`.** Vérifié par recherche sur tout `src/` :
les seules occurrences hors migrations sont `export-pdf`, `api/gardes/[id]`, `GardeDetailModal`,
`appliquer-exception.ts`, `useCompteurs`, `HistoriqueV2`, `CompteursPanel`. Rien dans `src/lib/ia/`.

---

## 2. 🔴 FUITES ET ERREURS

### A. FUITE — un vétérinaire obtient par Filou le planning que son écran lui cache

**C'est la même maladie que celle corrigée hier sur l'agenda Google puis sur l'écran planning.
Le troisième canal n'a pas été traité : Filou.**

- **Preuve.** `src/lib/ia/outils/planning.ts:146-262` — `lireGardes` n'a **pas** `adminSeulement`
  (le catalogue le donne donc à tout le monde, `registre.ts:148`). Sa requête,
  `planning.ts:169-173`, lit `planning_semaine` avec pour seul filtre `gte('date', …)` /
  `lte('date', …)`. Aucun filtre sur `publie_at`, aucun filtre sur `periode_id`, aucun appel à
  `lib/planning/diffusion.ts`, aucun filtre `cabinet_id`.
- **Pourquoi la base ne rattrape pas.** La vue appartient à `postgres` (`bypassrls = true`) et n'est
  pas `security_invoker` : elle ignore toutes les politiques RLS (voir plus haut).
- **Effet concret, aujourd'hui, sur la base réelle.** Un vétérinaire écrit à Filou « qui est de garde
  la semaine du 10 août ? ». Il reçoit les 24 jours de la période verrouillée jamais diffusée —
  ceux-là mêmes que `/planning` et `/historique` lui refusent depuis hier. Le jour où une période
  sera en brouillon, il recevra en plus le brouillon **et son état** : `planning.ts:257` renvoie
  `etat_periode` = « brouillon », soit exactement l'information que `BarreV2.tsx` a cessé de lui
  montrer au commit `2bb7c40`.
- **Second effet, plus sournois.** Pour un véto, `chargerPeriodes` (`planning.ts:85-92`) lit la
  table `periodes`, cette fois protégée par RLS. Sur une période en brouillon, il obtient donc les
  jours **sans** la période correspondante : `placesAttendues` ne trouve rien et renvoie `null`.
  Filou lui annonce des noms de garde tout en étant incapable de dire si l'effectif est complet.

### B. FUITE — les compteurs cumulés de toute l'équipe, alors que `/historique` est interdit aux vétos

- **Preuve.** `src/lib/ia/outils/compteurs.ts:203-324` — `lireCompteurs` n'a **pas**
  `adminSeulement`. Il lit `compteurs_gardes` via `queryCompteurs` (`useCompteurs.ts:100`), vue qui
  ignore la RLS elle aussi, et renvoie pour **chaque** vétérinaire : total de gardes, week-ends en
  1er/2nd, semaine, fériés, et l'**écart d'équité** (`compteurs.ts:278-321`).
- **Ce qui a bien été protégé, et ce qui ne l'a pas été.** L'auteur a pris soin de réserver le seul
  *bilan officiel* à l'admin (`compteurs.ts:268-271`, commentaire explicite : « sur /historique, le
  widget équivalent n'est montré qu'à l'admin »). Mais le 2026-08-21, c'est **la page entière** qui
  est passée admin-seul : `src/app/(v2)/historique/page.tsx:109` → `if (!estAdmin) redirect('/planning')`.
  Le raisonnement « je copie la restriction du widget » était juste la veille ; il ne l'est plus.
- **Effet concret.** « Filou, qui a fait le plus de week-ends cette année ? » → un vétérinaire
  obtient au chat le tableau d'équité complet du cabinet. Motif de la restriction, mot pour mot dans
  le commit `2bb7c40` : « c'est un outil de PRÉPARATION […] un véto n'en a pas l'usage ».
- **Portée exacte.** La période visée passe par `resoudrePeriode` (`compteurs.ts:96-145`) qui lit la
  table `periodes` : la RLS y borne le véto au publié/verrouillé. Il n'atteint donc pas un
  brouillon par cet outil — mais il atteint bien la période verrouillée jamais diffusée.

### C. FUITE (moindre, mais du même genre) — l'existence et l'état des périodes non diffusées

- **Preuve.** `lireEtatPeriodes` (`planning.ts:273-328`) et `lireHistoriquePeriodes`
  (`compteurs.ts:399-431`) : pas d'`adminSeulement`, et le filtre est celui de la RLS
  (`publie` **ou** `verrouille`), pas celui de la diffusion (`publie_at`).
- **Or `lib/planning/diffusion.ts:8-19` dit exactement l'inverse** : « ⚠️ LE CRITÈRE EST
  `publie_at`, JAMAIS LE STATUT. Une période peut être verrouillée sans avoir jamais été diffusée. »
  C'est le cas de l'unique période en base aujourd'hui.
- **Effet.** Filou liste à un véto « Historique été 2026 — verrouillée, du 27/07 au 20/09 », avec
  profil et effectif de nuit. La barre du haut a cessé de le faire hier.

### D. Écart de périmètre — la fiche de chaque collègue

- **Preuve.** `lireEquipe` (`equipe.ts:80-102`) : pas d'`adminSeulement`, renvoie statut
  associé/salarié, rôle applicatif, actif, **dernier recours** et étiquettes de tous. L'écran
  correspondant, lui, est fermé : `src/app/(v2)/equipe/page.tsx:50` →
  `if (vet.role_app !== 'admin') redirect('/accueil')`.
- Ce n'est pas de la donnée sensible au sens de B, mais c'est le même écart écran/Filou.
  **À trancher par MiKL**, pas par le code : Filou a besoin de `lire_equipe` pour répondre « pourquoi
  Manon n'a jamais de garde ». Une version « allégée pour le véto » (prénoms + actif, sans dernier
  recours ni étiquettes) tiendrait les deux bouts.

### Réponses devenues fausses

**Aucune réponse de Filou n'est devenue *fausse* du fait des changements** — et c'est un vrai
résultat, non une absence de recherche. La raison est structurelle : les exceptions ont été posées
**dans la vue** (migration `20260820151000`, en-tête : « Brancher les exceptions dans la vue les
sert TOUS d'un coup […] les outils de Filou »). Comme `lire_gardes` lit la vue, il annonce
spontanément le bon remplaçant sur le bon jour. Le pari de la surcouche a tenu.

Une seule nuance à surveiller : sur un jour dont l'exception laisse la place **vacante**
(`premier_prenom` à `NULL`, voulu par la migration ligne 22), `lire_gardes` calcule `manque > 0` et
Filou annoncera « il manque quelqu'un » — ce qui est vrai, mais il dira « trou de planning » là où
l'admin dira « place volontairement laissée vide ce jour-là ». Cosmétique, pas faux.

---

## 3. ⚠️ CE QUE FILOU NE SAIT PAS ENCORE FAIRE

| # | Capacité manquante | Preuve | Effort |
|---|---|---|---|
| 1 | **Boucher la fuite du brouillon** — filtrer `lire_gardes` par `lignesDesPeriodes(…, periodesVisibles(…))` comme le fait `planning/page.tsx:161-181`, et passer `lire_compteurs`, `lire_etat_periodes`, `lire_historique_periodes` au même critère `publie_at`. | `planning.ts:169`, `compteurs.ts:220` | **petit** (le module `diffusion.ts` existe déjà, il suffit de l'appeler) |
| 2 | **Lire une exception de jour** — dire « le dimanche, c'est Camille qui remplace Victor, le reste du week-end ne bouge pas ». Les 4 colonnes existent (`jour_exceptionnel`, `exception_premier`, `exception_second`, `compte_1er_we`) ; `lire_gardes` ne les sélectionne pas. | `planning.ts:171` (liste de colonnes) | **petit** |
| 3 | **Poser une exception de jour** — aucun outil n'écrit dans `gardes_exceptions`. L'admin ne peut le faire que depuis la modale du planning. Un outil d'écriture devrait poser les deux questions de la modale (périmètre jour/bloc, puis « ce jour compte-t-il comme 1er de garde ? ») et déléguer à `appliquer-exception.ts` — jamais réimplémenter. | absence totale de `gardes_exceptions` dans `src/lib/ia/` | **moyen** (le helper existe ; le piège du vendredi à rôles inversés, traité au commit `32bec2c`, doit être repris) |
| 4 | **Réparer une absence sur un seul jour** — `recenserCreneauxImpactes` renvoie désormais `joursTouches` et `blocMultiJours` (`crise/contexte.ts:79-85`), mais `reparerAbsence` et `appelerVolontaires` les ignorent : ils appellent `appliquerChangementGarde` sur la garde entière (`absences.ts:770-778`). **Conséquence réelle** : « Fanny est absente le dimanche, mets Camille » → Filou réattribue les trois jours du week-end **et déplace l'équité**, là où la modale demanderait « ce jour, ou tout le week-end ? ». Un `perimetre` non demandé est un défaut décidé à la place de l'admin — exactement ce que le commit `32bec2c` a refusé de faire dans l'écran. | `absences.ts:626-701` et `:704-816` | **moyen** |
| 5 | **Dire les jours exceptionnels dans les compteurs** — `queryCompteurs` fait `select('*')` et ramène `jours_1er_we_exceptionnels` / `jours_exceptionnels_pris`, mais `lireCompteurs` ne les recopie pas dans sa réponse (`compteurs.ts:281-321`). `/historique` les affiche en badge (`HistoriqueV2.tsx:426-439`) ; Filou n'en parlera jamais. | `compteurs.ts:281` | **petit** |
| 6 | **Contrôler la cohérence des exceptions** — `controleCoherence.ts:58-62` lit `planning_semaine` sans les colonnes d'exception et ne pose aucun contrôle sur `gardes_exceptions` (exception orpheline, remplaçant en congé ce jour-là, exception sur une garde supprimée). Le banc `bancRecette.ts` ne construit aucun cas d'exception non plus (`construireCas`, lignes 219-288). | `controleCoherence.ts:58`, `bancRecette.ts:219` | **moyen** |
| 7 | **Isoler Filou au cabinet sur les vues** — `lire_gardes` ne filtre pas `cabinet_id` et la vue ignore l'isolation RLS. Aujourd'hui sans effet (`nb_cabinets = 1`, vérifié), mais c'est une bombe à retardement le jour du deuxième cabinet. La bonne parade est la même qu'au point 1 : filtrer par les périodes du cabinet, jamais par une colonne de la vue. | `planning.ts:169`, `pg_class.reloptions = null` | **petit** dans Filou, **moyen** si on veut passer les vues en `security_invoker` |

---

## Conclusion

Filou n'a **pas** été mis à jour : il est resté sur la logique d'avant-hier, où le brouillon
n'existait que dans la tête de l'application. Deux fuites sont prouvées — un vétérinaire obtient par
le chat le planning non diffusé, et les compteurs d'équité de toute l'équipe que `/historique` vient
de lui fermer. Bonne nouvelle en revanche : rien n'est devenu **faux**, parce que les exceptions ont
été posées dans la vue, que Filou lit déjà. Le plus urgent est le point 1 du tableau ci-dessus :
c'est trois appels à un module qui existe déjà. Le reste (poser et lire une exception, réparer un
seul jour) est du confort dont l'absence ne trompe personne — sauf le point 4, où Filou réattribue
un week-end entier quand on ne lui demande qu'un dimanche.
