# Contre-audit Filou — passe 4

> 2026-08-21 · quatrième passe adversariale sur l'assistant « Filou ».
> Aucun fichier de code modifié, aucune écriture en base. Lecture seule (code + `pg_policies` + données du cabinet pilote).
> Passes précédentes : `55ea8ab` (1), `b96aae7` (2), `0ef5ac0` (3).

**En une phrase :** aucune fuite de lecture n'a été trouvée dans le catalogue d'outils ; le trou qui reste est ailleurs — hors Filou, dans deux écrans et deux outils d'atelier qui lisent `planning_semaine` sans borne, ce qui ne coûte rien à un cabinet et traversera la cloison au second.

---

## Ce que j'ai fait pour pouvoir l'affirmer

- Les 52 entrées du catalogue (`src/lib/ia/outils/registre.ts:84-144`), une par une.
- Les 31 appels Supabase de `src/lib/ia/` (recensement exhaustif, § 3).
- Les politiques RLS réelles, lues dans `pg_policies` le 2026-08-21 (pas dans les migrations : c'est l'état servi qui fait foi).
- Les définitions réelles de `get_user_role()`, `get_veterinaire_id()`, `auth_cabinet_actif()`, `planning_semaine`, `compteurs_gardes`.
- Les gardes d'accès des 7 écrans V2 et des 7 fichiers d'actions serveur appelés par les outils d'écriture.
- L'état des données du cabinet pilote, pour distinguer « protégé » de « pas encore exposé ».

---

# 1. 🔴 Fuites encore ouvertes

**Aucune fuite de données par le catalogue d'outils.** Voici la vérification, outil par outil.

## 1.1 Le socle vérifié d'abord

Trois faits conditionnent tout le reste ; je les ai prouvés avant de juger un seul outil.

| Fait | Vérification | Verdict |
|---|---|---|
| `get_user_role()` lit-il une source falsifiable ? | Définition en base : `SELECT role_app FROM veterinaires WHERE user_id = auth.uid() AND actif = true` | ✅ Lit la **table**, pas `user_metadata`. Un vétérinaire ne peut pas se promouvoir admin par `auth.updateUser()`. |
| `auth_cabinet_actif()` | `(auth.jwt() -> 'app_metadata') ->> 'cabinet_id'`, croisé avec `cabinets.actif` | ✅ `app_metadata` n'est modifiable que par le `service_role`. |
| `ctx.cabinetId` | `resoudreCabinetId()` (`src/lib/supabase/cabinet.ts:38-70`) : JWT d'abord, repli sur `veterinaires.cabinet_id`, jamais le client | ✅ |

Et la contre-épreuve : le contexte de Filou est **toujours** reconstruit depuis la session, à chaque appel — `contexte()` dans `src/app/(protected)/filou/actions.ts:50-79`. Le fil de conversation vient du navigateur et n'est pas de confiance (`assainirHistorique`, ligne 113), mais il n'entre que dans le prompt : il ne touche ni `ctx`, ni `outilsPour(c.ctx)` (ligne 142), ni `trouverOutil(nomOutil, c.ctx)` (ligne 170). Une injection par le fil ne peut donc pas élargir un périmètre.

## 1.2 Les 21 outils de lecture et d'affichage

| # | Outil | Ce qui le borne | Vérifié |
|---|---|---|---|
| 1 | `afficher_sur_le_tableau` | Ne lit rien (`outils/afficher.ts:43-54`) | ✅ |
| 2 | `lire_equipe` | Champs restreints à soi + admin (`equipe.ts:103-117`) ; cabinet par RLS `veterinaires_cabinet_isolation` (RESTRICTIVE) | ✅ |
| 3 | `lister_regles` | Ouvert à tous — **et c'est cohérent** : `/regles` V2 est délibérément ouvert aux vétérinaires (`src/app/(v2)/regles/page.tsx:118-132`, aucun `redirect`). Le complément sensible, `reglagesQuiContraignent`, est bien restreint à soi (`regles.ts:335`) | ✅ |
| 4 | `lire_gardes` | `perimetrePeriodes` + `.in('periode_id', …)` (`planning.ts:184-201`) | ✅ |
| 5 | `lire_etat_periodes` | `chargerPeriodes` : `.eq('cabinet_id')` + `.not('publie_at','is',null)` si non-admin (`planning.ts:92-99`) | ✅ |
| 6 | `lire_compteurs` | `resoudrePeriode` borné (`compteurs.ts:104-110`), lignes filtrées sur soi (270-272), refus explicite s'il nomme un collègue (291-296), bilan officiel non requêté pour un non-admin (316-319) | ✅ |
| 7 | `lire_historique_periodes` | Filtre `publie_at` posé **en SQL avant la limite** (`compteurs.ts:467-475`) | ✅ |
| 8 | `lire_historique_fetes` | `adminSeulement` (`compteurs.ts:516`) | ✅ |
| 9 | `verifier_coherence_planning` | `adminSeulement` (`compteurs.ts:392`) | ✅ |
| 10 | `lire_conges` | RLS `conges_veto_read_own` + court-circuit explicite sur un collègue (`conges.ts:239-243`) | ✅ |
| 11 | `lire_souhaits_en_attente` | `adminSeulement` (`conges.ts:278`) | ✅ |
| 12 | `lire_absences` | `motif` et `commentaire` masqués hors soi/admin (`absences.ts:202-210`) ; cohérent avec `/absences`, ouvert aux vétos (`src/app/(v2)/absences/page.tsx:68`) | ✅ |
| 13 | `lire_compensations` | `adminSeulement` (`absences.ts:240`) | ✅ |
| 14 | `lire_creneaux_touches` | `adminSeulement` (`absences.ts:278`) | ✅ |
| 15 | `lire_echanges` | RLS `echanges_read_parties` + filtre `periode_id` autorisée (`echanges.ts:148-157`) ; bloc `a_valider_par_admin` **absent** (pas vide) pour un non-admin (365-367) | ✅ *(une réserve, § 1.4)* |
| 16 | `lire_reglages_equite` | `regles_cabinet` lisible de tous (RLS `regles_cabinet_read_auth`), comme `/regles` | ✅ |
| 17 | `lire_profils_planning` | Structure = même écran `/regles`, ouvert | ✅ |
| 18 | `lire_creneaux_profil` | idem | ✅ |
| 19 | `lire_relations_creneaux` | idem | ✅ |
| 20 | `lire_reglages_cabinet` | `adminSeulement` (`structure.ts:371`) — aligné sur `/reglages`, qui redirige un véto (`src/app/(v2)/reglages/page.tsx:60`) | ✅ |
| 21 | `verifier_pre_vol_periode` | `adminSeulement` (`planning.ts:381`) | ✅ |

**Les correctifs des trois passes tiennent tous.** J'ai relu chacun sur le code servi, pas sur le message de commit.

## 1.3 La contre-épreuve sur les données réelles

Le cabinet pilote a **une seule période, et son `publie_at` est NULL** (requête du 2026-08-21 : `periodes` = 1, `publie_at IS NULL` = 1). Conséquence directe, et je l'ai vérifiée sur le chemin de code : pour un vétérinaire, `perimetrePeriodes` renvoie `vide: true` **aujourd'hui**. Donc `lire_gardes`, `lire_echanges`, `gardesDuVetoCeJour` et `lire_compteurs` lui répondent tous « aucun planning ne t'a encore été diffusé ».

Ce n'est pas une panne : c'est exactement ce que son écran `/planning` lui montre, qui filtre pareil (`src/app/(v2)/planning/page.tsx:175-181`). Filou et l'écran disent la même chose. C'était le but de la passe 1 ; c'est vérifié en situation.

## 1.4 Une réserve, pas une fuite : la proposition d'échange « ouverte »

La RLS `echanges_read_parties` laisse passer `cible_id IS NULL` à **tout le cabinet** — c'est voulu, un appel à volontaires s'adresse à tout le monde. Mais `lire_echanges` renvoie ces lignes dans `historique_recent` (`echanges.ts:356-358`) avec `message` et `motif_refus`, y compris une fois la proposition **annulée** ou **refusée par l'admin** : `cible_id` reste NULL, donc elle reste visible de toute l'équipe.

Portée réelle : nulle aujourd'hui (`echanges_gardes` = 0 ligne). Le champ concerné est un mot d'explication écrit par le demandeur en sachant qu'il s'adressait à tous. Je le signale pour mémoire, pas comme un correctif à faire : la seule chose qui me gêne est qu'aucun écran V2 ne montre ces échanges, donc personne ne peut vérifier ce que Filou en dit.

## 1.5 Ce qui est visible d'un vétérinaire et n'a pas d'écran

À noter sans y voir un défaut, parce que c'est un choix produit à assumer et pas un oubli : `lire_equipe` donne à un vétérinaire les **prénoms et noms** de toute l'équipe alors que `/equipe` lui est fermé (`src/app/(v2)/equipe/page.tsx:50`). Dans un cabinet de sept personnes qui se croisent tous les jours et se lisent mutuellement sur le planning, ce n'est pas une information. Je le laisse ouvert.

---

# 2. 🧨 Régressions introduites par les correctifs

J'ai cherché sérieusement. Trois trouvailles, dont une seule mérite un geste.

## 2.1 ❌ Fausse alerte — `chargerEquipe` n'est pas cassé

`lire_equipe` retire des champs, mais **la fonction de chargement n'a pas bougé** : `chargerEquipe` (`equipe.ts:33-39`) renvoie toujours la fiche entière, et c'est elle — pas la sortie de l'outil — qu'utilise `resoudre()` puis `modifierVeterinaire.executer` pour reconstruire le formulaire complet (`equipe.ts:213-223`). La restriction vit dans le `map` de sortie (103-117), en aval. **Rien ne casse.** Idem pour les cinq autres résolutions de prénom du projet (`compteurs.ts:65`, `conges.ts:84`, `absences.ts:60`, `echanges.ts:183`, `regles.ts:82`) : elles lisent `veterinaires` directement, jamais la sortie de `lire_equipe`.

## 2.2 ❌ Fausse alerte — l'admin ne perd aucun échange

Le filtre de la passe 3 écarte les échanges dont la garde n'a pas de `periode_id` **autorisé**. Pour un admin, « autorisé » = toutes les périodes du cabinet (`perimetre.ts:78`, la clause `publie_at` ne s'applique qu'au non-admin). Vérifié en base : `gardes.periode_id IS NULL` = **0**, échanges concernés = **0**. Aucune perte.

Une borne subsiste toutefois : `perimetrePeriodes` plafonne à **50 périodes** (`perimetre.ts:76`). Au-delà — soit une douzaine d'années de planification — les échanges rattachés aux plus anciennes disparaîtraient de la vue de l'admin, silencieusement. Ce n'est pas une régression aujourd'hui (1 période), c'est une dette à connaître. `chargerPeriodes` porte la même borne à 30 (`planning.ts:97`).

## 2.3 ⚠️ Régression réelle et petite — Filou ne sait plus dire à un véto qui est l'administratrice

Avant la passe 3, `lire_equipe` renvoyait `role` pour tout le monde. Maintenant, pour un non-admin, `role` n'est présent que sur sa propre ligne (`equipe.ts:109-116`). Or « à qui je dois demander pour mes congés ? » est une question banale, et Filou n'a plus de quoi y répondre : il devra dire qu'il ne sait pas, ou pire, deviner.

C'est un vrai arbitrage, pas un bug : le rôle applicatif fait partie de l'organisation. Mais l'identité de l'administratrice n'est pas un secret — c'est elle qui envoie les e-mails de validation. **Piste, si MiKL le veut** : ne masquer que `statut`, `dernier_recours` et `etiquettes`, et laisser `role` visible. Je ne touche à rien sans son accord.

## 2.4 Une conséquence de performance, pas de sécurité

`perimetrePeriodes` est rappelé à chaque outil borné, et `proposer_echange` le déclenche **trois fois** pour une seule proposition (deux `gardesDuVetoCeJour` en `echanges.ts:418` et `438`, plus `chargerEchanges`). Trois requêtes identiques là où une suffirait. Sans effet visible sur un cabinet ; à mémoriser si l'attente de Filou devient un sujet.

---

# 3. 🏢 Isolation multi-cabinet

## 3.1 Le résultat, d'abord

**Toutes les TABLES lues par Filou portent une politique RLS RESTRICTIVE d'isolation par cabinet.** Une politique restrictive s'applique en ET avec toutes les autres : elle ne peut pas être contournée par une politique permissive trop large. C'est le bon dispositif, et il est en place.

Le risque du second cabinet n'est donc **pas** dans les tables. Il est entier dans les deux VUES.

## 3.2 Recensement exhaustif — les 31 appels Supabase de `src/lib/ia/`

Colonne « RLS » : politique vérifiée dans `pg_policies` le 2026-08-21.

### Sans `.eq('cabinet_id', …)` mais protégés par une RLS RESTRICTIVE d'isolation

| Fichier:ligne | Table | Politique d'isolation vérifiée | Verdict |
|---|---|---|---|
| `outils/equipe.ts:35` | `veterinaires` | `veterinaires_cabinet_isolation` RESTRICTIVE | ✅ |
| `outils/compteurs.ts:66` | `veterinaires` | idem | ✅ |
| `outils/conges.ts:85` | `veterinaires` | idem | ✅ |
| `outils/absences.ts:61` | `veterinaires` | idem | ✅ |
| `outils/echanges.ts:184` | `veterinaires` | idem | ✅ |
| `outils/regles.ts:82`, `:316`, `:373` | `veterinaires` | idem | ✅ |
| `outils/structure.ts:671` | `veterinaires` | idem | ✅ |
| `contexteCabinet.ts:44` | `veterinaires` | idem | ✅ |
| `bancRecette.ts:124` | `veterinaires` | idem | ✅ |
| `outils/conges.ts:93` | `conges` | `conges_cabinet_isolation` RESTRICTIVE | ✅ |
| `outils/absences.ts:114`, `:174`, `:416`, `:730`, `:828` | `absences` | `absences_cabinet_isolation` RESTRICTIVE | ✅ |
| `outils/absences.ts:243`, `:797`, `:815`, `:854` | `compensations` | `compensations_cabinet_isolation` RESTRICTIVE | ✅ |
| `outils/absences.ts:774` | `gardes` | `gardes_cabinet_isolation` RESTRICTIVE (+ `.eq('cabinet_id')` explicite ligne 777) | ✅✅ |
| `outils/echanges.ts:232` | `gardes` | idem (+ borne `periode_id`) | ✅✅ |
| `outils/planning.ts:642` | `gardes` | idem | ✅ |
| `outils/echanges.ts:126` | `echanges_gardes` | `echanges_cabinet_isolation` RESTRICTIVE | ✅ |
| `outils/compteurs.ts:197`, `outils/regles.ts:79`, `:355` | `regles_cabinet` | `regles_cabinet_isolation` RESTRICTIVE | ✅ |
| `outils/planning.ts:105`, `outils/structure.ts:84` | `profils_planning` | `profils_planning_isolation` RESTRICTIVE | ✅ |
| `outils/structure.ts:103` | `creneau_modele` | `creneau_modele_isolation` RESTRICTIVE | ✅ |
| `outils/structure.ts:112` | `relation_creneau` | `relation_creneau_isolation` RESTRICTIVE | ✅ |
| `outils/structure.ts:121` | `periode_type_creneau` | `periode_type_creneau_isolation` RESTRICTIVE | ✅ |
| `outils/structure.ts:149` | `periodes` | `periodes_cabinet_isolation` RESTRICTIVE | ✅ |
| `bancRecette.ts:136`, `controleCoherence.ts:67` | `periodes` | idem | ✅ |
| `controleCoherence.ts:72` | `profils_planning` | idem | ✅ |

### Avec `.eq('cabinet_id', …)` explicite (ceinture + bretelles)

`outils/perimetre.ts:74` · `outils/compteurs.ts:107` et `:470` · `outils/planning.ts:95` et `:210` · `outils/structure.ts:382`, `:1174`, `:1232` (`cabinets`, dont la RLS `cabinets_select` borne déjà à `auth_cabinet_actif()`) · `bancRecette.ts:134` · `controleCoherence.ts:63` et `:65`.

### 🔴 Les trois lectures qui ne sont bornées par RIEN

Ce sont des **vues**, propriétaires `postgres`, `rolbypassrls = true`, `reloptions = null` (donc **pas** `security_invoker`) — vérifié en base le 2026-08-21. Aucune politique RLS ne s'y applique, ni de rôle, ni de cabinet.

| Fichier:ligne | Vue | Borne posée | Verdict |
|---|---|---|---|
| `outils/planning.ts:191` | `planning_semaine` | `.in('periode_id', perimetre.ids)` ligne 199 | ✅ **bornée** (correctif passe 1) |
| `hooks/useCompteurs.ts:110`, appelé par `outils/compteurs.ts:236-237` | `compteurs_gardes` | `.eq('periode_id', periode.id)`, période résolue cabinet-scopée | ✅ **bornée** (correctif passe 1) |
| **`controleCoherence.ts:58-61`** | `planning_semaine` | **aucune** — ni `periode_id`, ni cabinet, ni date | 🔴 **non bornée** |
| **`bancRecette.ts:128-133`** | `planning_semaine` | `.gte('date', aujourd'hui).limit(60)` — **aucune borne de cabinet** | 🔴 **non bornée** |

Les deux dernières sont des outils d'atelier réservés à l'administrateur (garde vérifiée : `src/app/(protected)/admin/banc-ia/actions.ts:52`, `:94`, `:135`). Elles ne fuient donc rien vers un vétérinaire. Mais **au second cabinet, le rapport de cohérence et le banc de recette de l'admin du cabinet A compteront les gardes du cabinet B** — et le rapport dira que le planning est incohérent, sans que personne ne comprenne pourquoi. La borne est triviale à poser (`.in('periode_id', …)` comme ailleurs) ; je ne la pose pas, l'audit ne modifie rien.

### 3.3 Hors Filou, mais c'est là que ça saigne

En remontant la liste des lecteurs des vues (§ 4), deux écrans laissent passer **tout** pour un administrateur, délibérément et pour une bonne raison qui n'a pas envisagé le multi-cabinet :

- `src/app/(v2)/planning/page.tsx:181` — `const gardes = isAdmin ? toutesGardes : lignesDesPeriodes(…)`. Le commentaire des lignes 176-179 l'explique : la liste des périodes est plafonnée à 20, et filtrer ferait disparaître de l'écran de l'admin les gardes d'une période plus ancienne.
- `src/data/v2/accueilEpicentre.ts:353` — `const lignes = estAdmin ? toutesLignes : lignesDesPeriodes(…)`, même raisonnement.

Le raisonnement est juste sur un cabinet. Au second, il donne : **l'administratrice du cabinet A voit sur son planning et sur son accueil les gardes du cabinet B.** C'est la fuite la plus grave du système aujourd'hui — et elle n'est pas dans Filou.

---

# 4. 🔧 `security_invoker` : ce que ça coûterait

## 4.1 Ce que ça changerait exactement

`ALTER VIEW … SET (security_invoker = true)` fait exécuter la vue avec les droits **de l'appelant** au lieu de ceux du propriétaire. Les politiques RLS des tables sous-jacentes (`gardes`, `veterinaires`, `periodes`, `gardes_exceptions`, `garde_placements`, `creneau_modele`, `relation_creneau`, `profils_planning`) s'appliqueraient alors, y compris les RESTRICTIVE d'isolation par cabinet.

Autrement dit : l'isolation multi-cabinet deviendrait **structurelle** au lieu d'être reconstituée à la main, requête par requête, en TypeScript.

## 4.2 Les lecteurs, un par un

**Insensibles** — s'exécutent en `service_role` (`rolbypassrls = true`), donc rigoureusement rien ne change :

| Module | Ce qu'il lit |
|---|---|
| `src/lib/gardes/appliquer-changement.ts` | cycle partagé d'écriture d'une garde |
| `src/data/syncAttributions.ts` | synchronisation des attributions |
| `src/app/api/cron/lock-gardes/route.ts` | verrouillage nocturne |
| `src/app/api/cron/rappels/route.ts` | rappels |
| `src/app/api/cron/sync-calendrier/route.ts` | synchro Google Agenda |
| `src/app/api/absences/[id]/volontaire/route.ts` | prise de créneau par un volontaire |

**Session administrateur** — la RLS admin (`gardes_admin_all`, `vet_admin_all`, `periodes_admin_all`) rend `true` sur toutes les lignes du cabinet. Ne perdent donc **que** ce qui appartient à un autre cabinet, c'est-à-dire précisément ce qu'ils n'auraient jamais dû voir :

| Module | Effet du passage |
|---|---|
| `src/app/(v2)/planning/page.tsx:113` | ✅ **corrige** la fuite du § 3.3 |
| `src/data/v2/accueilEpicentre.ts:262` | ✅ **corrige** la fuite du § 3.3 |
| `src/app/(v2)/historique/page.tsx` (via `useCompteurs.ts:110`) | ✅ rien de perdu (admin-only, `redirect` ligne 109) |
| `src/lib/ia/controleCoherence.ts:59` | ✅ **corrige** le § 3.2 |
| `src/lib/ia/bancRecette.ts:129` | ✅ **corrige** le § 3.2 |
| `src/data/revaliderPlanning.ts` | ✅ « admin uniquement » revendiqué en tête de fichier, RLS complète |
| `src/lib/gardes/appliquer-exception.ts:122` | ✅ écriture admin |
| `src/lib/ia/outils/planning.ts:191` | ✅ déjà borné, la RLS ne fait que doubler |
| `src/lib/ia/outils/compteurs.ts` (via `useCompteurs`) | ✅ idem |

**Session vétérinaire** — c'est le seul endroit où il faut regarder de près :

| Module | Politique qui s'appliquerait | Risque |
|---|---|---|
| `src/app/(v2)/planning/page.tsx:113` | `gardes_veto_read` : `get_user_role() = 'veto'` → **true sur toutes les gardes du cabinet** | ⚠️ aucun changement de contenu. Le tri par diffusion resterait en TypeScript (`diffusion.ts`) — la RLS ne connaît pas `publie_at` sur `gardes`. |
| `src/data/v2/accueilEpicentre.ts:262` | idem | ⚠️ idem |
| `src/lib/crise/contexte.ts:225` | `gardes_veto_read` + `vet_read_all` | ⚠️ **le point à surveiller** : `vet_read_all` exige `actif = true`. Les jointures `LEFT JOIN veterinaires` de la vue renverraient donc `premier_prenom = NULL` pour un vétérinaire **inactif**. Mesuré : `veterinaires WHERE actif = false` = **0** aujourd'hui. Le jour où quelqu'un quitte le cabinet, un planning passé afficherait un trou à sa place, pour les vétos seulement. |
| `src/lib/ia/outils/planning.ts:191` | idem | ⚠️ même remarque sur les inactifs |

**Personne ne casse.** Le seul effet de bord réel est celui des vétérinaires devenus inactifs, et il est aujourd'hui théorique (0 ligne).

## 4.3 Recommandation

Le passage vaut le coup, et il est peu coûteux — mais **pas maintenant**.

1. **Pas avant le second cabinet.** Sur un cabinet, il ne corrige rien de visible et introduit un risque de régression d'affichage pour zéro bénéfice.
2. **Obligatoire avant le second cabinet.** Sans lui, l'admin du cabinet A voit le planning du cabinet B (§ 3.3), et ce n'est pas rattrapable par un correctif ponctuel : il faudrait reposer la borne dans chacun des neuf lecteurs, et se souvenir de la poser dans le dixième.
3. **Ce qu'il faut corriger AVANT de basculer**, sinon la bascule casse l'affichage des anciens plannings : l'exigence `actif = true` de la politique `vet_read_all`. Deux options — soit assouplir la politique en lecture (un vétérinaire sorti reste un nom sur un planning passé), soit accepter le trou. C'est une décision de MiKL, pas une décision technique.
4. **Ordre proposé** : ① régler le point 3 · ② poser la borne manquante sur `controleCoherence.ts` et `bancRecette.ts` (deux lignes, utile dans les deux cas) · ③ `ALTER VIEW` sur les deux vues · ④ retirer le `isAdmin ? toutesGardes :` des deux écrans, devenu inutile.

Une note de méthode, parce qu'elle vaut au-delà de ce chantier : le commentaire en tête de `outils/perimetre.ts:4-29` est le meilleur artefact produit par les quatre passes. Il ne décrit pas un correctif, il décrit **le piège**. C'est ce qui a permis de le retrouver dans deux fichiers d'atelier que personne n'aurait pensé à auditer.

---

# 5. Deux points d'hygiène relevés en chemin

Ni l'un ni l'autre n'est une fuite. Les deux méritent une ligne, parce qu'ils sont du type qui fabrique la fuite suivante.

## 5.1 🟠 Deux fichiers affirment une garde qui n'existe pas

- `src/components/v2/FilouChat.tsx:27-28` : « ADMIN SEULEMENT : l'action serveur est admin-only. »
- `src/lib/v2/filou-origine.ts:38-41` : « le champ de saisie de la tablette n'existe QUE pour un administrateur (`FilouChat.tsx`, l'action serveur est admin-only). »

**C'est faux.** `parlerAFilou` (`src/app/(protected)/filou/actions.ts:127-160`) n'a aucun contrôle de rôle — et c'est **volontaire et juste** : c'est la règle « Filou pour tous, périmètre par droits ». Ce que l'interface cache (`Epicentre.tsx:197`, `FilouChat.tsx:446`) reste un point d'entrée public : une Server Action est appelable depuis le navigateur par n'importe quel utilisateur authentifié, que le champ de saisie soit affiché ou non.

Le danger n'est pas dans le code d'aujourd'hui, il est dans ce que quelqu'un en déduira demain : « de toute façon c'est admin-only » est exactement la phrase qui justifie de retirer un des dix garde-fous posés en quatre passes. Ces deux commentaires sont à corriger.

## 5.2 🟢 `appliquerActionFilou` ne rejoue pas `resumer` — et c'est rattrapé partout

`appliquerActionFilou` (`actions.ts:162-188`) appelle `executer` **sans** repasser par `resumer`. Toutes les vérifications faites à l'aperçu sont donc contournables par un navigateur modifié qui forge la `charge`. J'ai testé les trois cas où ça pourrait faire mal, pour un non-admin :

| Attaque | Où elle meurt |
|---|---|
| `poser_conge` avec `charge.veterinaireId` = un collègue | `createConge` **force** `veterinaire_id = get_veterinaire_id()` pour un non-admin (`conges/actions.ts:114-120`) **et** la RLS `conges_veto_insert_souhait` l'exige au `WITH CHECK`. Deux barrières. |
| `supprimer_conge` avec `charge.id` = un congé **validé** à soi (l'aperçu n'autorise que `souhait`) | `executer` (`conges.ts:653-655`) ne revérifie que l'existence, pas le statut. Mais la RLS `conges_veto_delete_souhait` exige `statut = 'souhait'`. **Une seule barrière — la RLS.** |
| Appeler un outil `adminSeulement` en forgeant son nom | `trouverOutil(nom, ctx)` cherche dans `outilsPour(ctx)`, déjà filtré (`registre.ts:154-156`) |

Et pour un administrateur, les 26 outils d'écriture délèguent tous à une action serveur qui porte son propre `assertAdmin` — vérifié dans `admin/veterinaires/actions.ts:25-38`, `regles/actions.ts:101-108`, `admin/structure/actions.ts:100-107`, `admin/periodes/actions.ts:39-52`, `admin/depannages/actions.ts:35-39`, `echanges/actions.ts:484` et `:602` — ou écrit directement dans une table dont la RLS est `admin_write` (`declarer_absence`, `reparer_absence`).

**Verdict : la chaîne tient.** La seule marche un peu mince est `supprimer_conge`, tenue par la seule RLS. Un `if (conge.statut !== 'souhait' && !ctx.estAdmin)` dans `executer` la doublerait pour trois lignes. Non urgent.

---

# Verdict

**Oui, Filou est sûr pour un cabinet.** Les dix fuites fermées en trois passes tiennent toutes, vérifiées une par une sur le code servi ; les 52 outils sont bornés par le rôle, le cabinet et la diffusion ; aucune écriture n'est atteignable sans la garde de sa propre action serveur ; et le contexte est reconstruit depuis la session à chaque appel, donc rien de ce que le navigateur renvoie ne peut élargir un périmètre.

**Non, le système ne l'est pas pour deux cabinets** — et ce n'est plus la faute de Filou : ce sont `planning_semaine` et `compteurs_gardes`, deux vues qui ignorent toute RLS, lues sans borne par l'écran Planning et l'accueil **quand la personne est administratrice** (`planning/page.tsx:181`, `accueilEpicentre.ts:353`), plus deux outils d'atelier (`controleCoherence.ts:58`, `bancRecette.ts:128`). Ces quatre lignes suffisent à faire traverser la cloison.

**Sous une réserve, et une seule :** le passage des deux vues en `security_invoker` est la bonne réponse, mais il ne doit pas être fait avant d'avoir tranché le sort des vétérinaires devenus inactifs (§ 4.2) — sinon un planning passé se videra du nom des partants, pour les vétérinaires seulement, et sans que rien ne le signale.
