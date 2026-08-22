# Plan de chantiers — recette du 21 août 2026

> **Ce fichier survit au `/clear`.** Il contient tout ce qu'il faut pour reprendre sans le contexte de la conversation.
> Écrit le 2026-08-21 au soir, après la séance VetdAllier et la recette qui a suivi.
> Orchestration : **MAX** en teammates. MiKL valide à la fin de chaque lot.

---

## Comment on procède

1. MAX lance **un lot à la fois**, avec ses coéquipiers en parallèle.
2. À la fin du lot, **MAX interpelle MiKL** avec ce qui a été fait et ce qu'il doit vérifier.
3. MiKL vérifie sur le déploiement, valide ou corrige.
4. Lot suivant.
5. À la fin : **bilan global** — on repasse sur tout, on s'assure que rien n'est cassé.

**Règles qui s'appliquent à tous les lots :**
- ⚠️ **INSPECTION DES CONSUMERS avant toute modification d'entité** — la règle a payé trois fois cette semaine (voir « Leçons » en bas).
- ⚠️ **KIT COMPLET** — pas de bouton qui ne fait rien, pas de demi-fonctionnalité.
- Tests + build verts avant chaque commit. MiKL teste sur le déploiement, jamais en local.
- Aucune date au format `AAAA-MM-JJ` à l'écran → `lib/dates-fr`.
- Aucun secret, aucune clé, aucun compte externe créé par un agent → « En attente de MiKL ».

---
---

# ✅ DÉJÀ FAIT le 21 août — ne pas refaire

*Listé pour mémoire, et pour qu'aucun agent ne recommence.*

| # | Chantier | Commit |
|---|---|---|
| 1 | Zéro paragraphe d'explication en tête des 6 écrans, titre mis en avant | `ffb46ba` |
| 2 | « Identifiant de l'agenda » → « Adresse de l'agenda Google » + aide | `ffb46ba` |
| 3 | Bug « Invitation envoyée » à vie (RPC `marquer_invite_complete` absente en base) | `ffb46ba` |
| 4 | Encart e-mails : adresse d'envoi retirée (case piégée), nom affiché conservé | `1d0a8d2` |
| 5 | Boutons « Créer un congé » / « Déclarer une absence » sur la ligne des onglets | `1d0a8d2` |
| 6 | « Envoyé » → « Parti » / « Refusé » dans les deux journaux | `9805b8f` |
| 7 | Webhook Brevo `POST /api/webhooks/brevo` + statuts `remis`/`rejete`/`spam`/`differe` | `4c5c979` |
| 8 | Expéditeur du cabinet unifié sur les **5 chemins** de `notifications.ts` | `4c5c979` |
| 9 | Œil « afficher le mot de passe » sur `/login` et `/set-password` | `4c5c979` |
| 10 | Vitest ramassait les tests Playwright → 3 échecs permanents | `267be24` |
| 11 | **Audit dates ISO** — 27 messages + garde-fou qui lit le source | `d08fe7b` |
| 12 | Dépannage invisible (2 tables, 1 seule lue) | `d08fe7b` |
| 13 | Écart des compteurs faux (comptait le dernier recours) + légende des colonnes | `e925ae4` |

**Base de données, déjà appliqué :** migration `marquer_invite_complete`, migration `email_log_statuts_livraison`, `cabinets.brevo_from_email = vetovaldallier@gmail.com`, journal d'e-mails vidé, compte de Fanny remis à zéro.

---
---

# 🔴 LOT 1 — Les deux règles enfreintes *(à faire en premier)*

**Pourquoi en premier :** le planning **est publié** avec deux violations. Si le moteur produit du faux, tout le reste est cosmétique.

### Ce qu'on a constaté
Fenêtre de publication et bandeau du planning :
```
FREQ_WE : Antoine — deux week-ends à 7 jour(s) d'écart
          (2026-09-12 → 2026-09-19), min 1 toutes les 2 semaines
FREQ_WE : Victor  — deux week-ends à 7 jour(s) d'écart
          (2026-09-26 → 2026-10-03), min 1 toutes les 2 semaines
```
*(les dates s'affichent désormais en français — le fond, lui, n'a pas été examiné)*

### 🕵️ Agent 1 — Enquête *(Opus, TILT)*
**Ne corriger RIEN avant d'avoir prouvé la cause.**

1. Le cas d'Antoine est **à cheval sur deux périodes** (19 sept. = fin de l'historique été, 12 sept. = dedans). Or un correctif de `bb180d4` traitait déjà « plus jamais deux week-ends consécutifs, y compris à cheval sur deux périodes ». **A-t-il régressé, ou ne couvre-t-il pas ce cas ?**
2. Le moteur a-t-il **le droit** d'enfreindre `FREQ_WE` ? Vérifier la fermeté de la règle en base (`regles_cabinet.force`) : si elle est souple (`sauf_urgence`), le moteur a le droit et le message doit le DIRE. Si elle est dure (`jamais`), c'est un défaut du solver.
3. Le validateur voit la violation **après coup** — pourquoi le solver ne l'a-t-il pas évitée ? Le pré-vol la connaît-il ? *(leçon connue : « tout ciblage se thread aux DEUX gardiens »)*

**Livrable** : un diagnostic avec preuves (requêtes SQL, extraits de code), et **la cause racine validée par MiKL avant tout correctif**.

### 🎨 Agent 2 — L'affichage de la fenêtre de publication *(Sonnet)*
MiKL : « **c'est quoi cet affichage de merde** ».

Défauts visibles sur la capture :
- `FREQ_WE` — un **code machine** est affiché tel quel. `lib/regles/libelleViolation.ts` sait le traduire (« Fréquence des week-ends ») : il n'est pas utilisé ici.
- « min 1 toutes les 2 semaines » — jargon de paramètre, pas une phrase.
- Les violations sont **à plat**, alors que `grouperViolations()` existe et regroupe par cause.
- Rien ne dit si c'est **grave** (règle dure) ou **assumé** (règle souple).

**Attendu** : une fenêtre qui dit en français ce qui cloche, groupé par cause, avec la gravité. Ne pas toucher au moteur — c'est l'agent 1.
⚠️ **Dépend du verdict de l'agent 1** sur la fermeté : ne finaliser les mots qu'après.

---
---

# 🟠 LOT 2 — La page Absences

MiKL : « **faut revoir page absence** ».

### 🎯 Agent 3 — Signaler les nouveautés *(Sonnet)*
> « tu peux afficher les souhaits nouveaux qui viennent d'arriver et qui ne sont pas traités »
> « indique sur le tableau les nouveautés, type changement dans les souhaits et les dépannages »

Aujourd'hui rien ne distingue un souhait arrivé il y a une heure d'un souhait vieux de trois semaines. Il faut ouvrir chaque onglet pour savoir s'il se passe quelque chose.

**À faire :**
- Marquer visuellement ce qui est **non traité** (souhaits en attente, échanges à valider, dépannages).
- Distinguer le **nouveau** (arrivé depuis la dernière visite) du simplement **en attente**.
- Le signal doit remonter **sur le tableau/l'accueil**, pas seulement dans l'onglet.

⚠️ **INSPECTION DES CONSUMERS obligatoire** : `conges`, `echanges_gardes`, `compensations`, `absences`. Recenser TOUS les compteurs et badges (dock, cloche, accueil, onglets) et dire lesquels sont branchés en Realtime. Présenter le tableau à MiKL **avant** de coder.

### 🧹 Agent 4 — Le bandeau d'incohérences *(Sonnet)*
MiKL : « **affichage dégueulasse** » sur le bandeau « 6 incohérences sur le planning publié · 3 causes ».

Les dates ISO y sont corrigées (lot déjà livré), mais l'agent doit **revérifier le rendu réel** et reprendre ce qui reste : codes (`FREQ_WE`, `R2`, `R16`) encore visibles, densité, hiérarchie.
⚠️ Se coordonner avec l'agent 2 : même matière, deux écrans. **Une seule façon de nommer une violation**, pas deux.

---
---

# 🟡 LOT 3 — L'historique de l'été 2026

> ⚠️ **Demande de MiKL qu'il a fallu qu'il réclame deux fois — ne pas la perdre.**

### État réel constaté en base (2026-08-21)
Période « Historique été 2026 » (`e26cec19-…`), 27/07 → 20/09, **8 gardes, toutes des week-ends** :

| Date | Type | 1er | 2nd |
|---|---|---|---|
| 01/08 | week-end | Victor | Anne-Sophie |
| 08/08 | week-end | Manon | Anne-Catherine |
| 15/08 | week-end | Victor | Manon |
| 22/08 | week-end | Anne-Sophie | Jean |
| 29/08 | week-end | Jean | Manon |
| 05/09 | week-end | Victor | Jean |
| 12/09 | week-end | Fanny | Antoine |
| 19/09 | week-end | Antoine | Anne-Sophie |

**Aucun soir de semaine n'a jamais été saisi.**

### Ce que MiKL demande
> « refaire l'historique été 2026 en n'en gardant que les 2 dernières semaines de cette période, soir de semaine et week-end »

### ⛔ BLOQUANT — MAX doit poser ces questions à MiKL AVANT de toucher à la base
1. **Quelles dates exactement ?** « Les 2 dernières semaines » = du 07/09 au 20/09 (donc les week-ends du 12 et du 19) ? Ou autre chose ?
2. **Qui était de garde les soirs de semaine ?** Cette donnée **n'existe nulle part** — ni en base, ni dans un document. Elle doit venir d'Anne-Sophie. On ne l'invente pas : l'historique nourrit les compteurs et l'équité de la prochaine génération.
3. **Les 6 week-ends antérieurs : supprimés, ou conservés hors période ?** Ils comptent aujourd'hui dans les compteurs.

**Rappels utiles :** ça se règle **en base**, pas en code ([[amorcage-historique-en-base-pas-en-code]]) ; l'import de planning est **éteint** volontairement (`IMPORT_PLANNING_ACTIF`), ne pas le rallumer ; contrainte `debut_lundi` sur les périodes ; `compteurs_gardes` rend invisibles les vétos à zéro garde.

---
---

# 🟢 LOT 4 — L'onglet Support *(demandé « rapidement » par la cliente)*

Décidé en séance avec Anne-Sophie. Recevoir **en direct** les demandes de bug et d'amélioration, **avec pièces jointes** (captures d'écran).

### 🏗️ Agent 5 — Conception *(Opus, ARCH)*
Modèle de données, écran, qui voit quoi (un véto voit-il ses propres demandes ? l'admin voit-il tout ?), notifications. **Kit complet** : une demande a un statut, une réponse, un fil.

### ⚠️ Le piège, déjà payé — à lire avant de coder
[[controle-derriere-plafond-plateforme-est-mort]] :
- Vercel refuse un corps de requête **> 4,5 Mo** *avant* d'entrer dans la fonction ;
- les arguments d'une **Server Action** plafonnent vers **1 Mo** (`react-server-dom-webpack`), invisible en local ;
- ⇒ **route API + envoi binaire**, jamais une Server Action pour un fichier ;
- le refus de taille doit tomber **dans le navigateur**, sur la charge réelle.

### 🐕‍🦺 CERBÈRE — gate obligatoire
Un formulaire qui accepte des fichiers depuis l'extérieur : taille, type MIME, stockage, accès aux pièces jointes d'un autre cabinet.

---
---

# 🔵 LOT 5 — Le rôle « secrétaire » *(lecture seule)*

Décidé en séance. Un troisième type de compte : **visualisation du planning synchronisé en direct, rien d'autre**.

### ⛔ DEUX AVERTISSEMENTS AVANT DE COMMENCER

1. **Ce rôle a DÉJÀ existé et a été SUPPRIMÉ** — migration `remove_secretaire_role` du 2026-06-01. **Comprendre pourquoi avant de le réintroduire.** Si on l'a retiré pour une bonne raison, elle vaut encore.
2. **Il se heurte de plein fouet à la dette `security_invoker`** ([[vues-sans-rls-security-invoker]]) : `planning_semaine` et `compteurs_gardes` s'exécutent **sans filtre de rôle NI de cabinet**. Un compte « lecture seule » qui passerait par ces vues verrait **tous les cabinets**. Réutiliser `outils/perimetre.ts`.

C'est le lot le plus risqué du plan. **Ne pas le lancer en parallèle d'un autre chantier touchant la RLS.**

---
---

# ⚪ LOT 6 — V3, hors périmètre actuel

**Chat entre vétos + envoi d'e-mails.** Explicitement repoussé en V3 par MiKL. Les échanges de gardes existent déjà, sans conversation ni notification. **Ne pas commencer.**

---
---

# 📋 Bilan global — après le dernier lot

- Recette de bout en bout sur le déploiement : invitation, publication, congés, échanges, compteurs.
- Vérifier qu'aucune date ISO n'est réapparue *(le garde-fou tourne, mais il ne couvre que 2 fichiers)*.
- Journal des e-mails : les lignes passent-elles à **« Remis »** ? *(le webhook n'a jamais été vu fonctionner sur un vrai envoi)*
- CERBÈRE sur l'ensemble.
- ATLAS : patch-log + leçons.

---

## Leçons de la semaine — à garder sous la main

- **Une même notion écrite dans deux tables, un lecteur qui n'en connaît qu'une.** Trois fois cette semaine : les 2 chemins d'e-mail, les 2 tables de dépannage, les 2 gardiens du moteur. **Avant de croire un compteur à zéro, chercher par quelles portes la donnée peut entrer.**
- **Un indicateur qui empire quand tout s'améliore mesure la mauvaise chose.**
- **Une explication au survol n'existe pas sur tactile.**
- **Une migration présente dans le dépôt n'est pas une migration appliquée.**
- **Tout `supabase.rpc()` doit lire son `error`** — Supabase retourne ses erreurs, il ne les lève pas.

---

*Plan écrit le 2026-08-21. État vérifié en base le même jour. MiKL valide lot par lot.*
