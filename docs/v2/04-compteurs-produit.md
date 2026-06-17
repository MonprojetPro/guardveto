# GuardVeto V2 — Les compteurs comme PRODUIT configurable

> 🔬 **Synthèse de l'enquête « Compteurs comme produit »** (2026-06-15) — 4 agents.
> Angles : modèle conceptuel générique (C1), catalogue exhaustif des métriques (C2), configurabilité & UX (C3), branchement moteur + schéma + source unique (C4).
> Demande MiKL : « penser les compteurs comme un produit qui se veut généraliste et personnalisable ; aujourd'hui on s'appuie sur les règles du cabinet pilote, mais d'autres cabinets n'auront pas le même nombre de jours de congés, voudront d'autres métriques. »
> **Statut : à intégrer au PRD V2.**

---

## 0. Le verdict en une page

**Aujourd'hui les compteurs ne sont pas “à risque” de diverger — ils divergent déjà, en triple, en production.** Les 4 agents convergent sur le même diagnostic et la même solution.

Le diagnostic (prouvé dans le code par C4) : il existe **trois définitions parallèles et divergentes** du mot « compteur » :
1. `compterParVet()` (TS, moteur) — connaît R11b et R15, ignore le découpage 1er/2nd que produit la vue ;
2. la vue SQL `compteurs_gardes` — connaît le découpage 1er/2nd, **ignore R11b et R15** ;
3. la re-agrégation manuelle du hook `useCompteurs` — réimplémente la vue une 3ᵉ fois.
Plus un **score d'équité mort** (`scoreEquite` jamais appelé par le solver) et un score glouton vivant. C'est le piège du « double scoring » (risque R2) **déjà réalisé, en pire**.

La solution (C1 + C4, identique) : **un compteur n'est pas un chiffre, c'est une définition** ; et toutes les définitions, soldes, dettes d'équité et dettes de crise sont **des projections d'un seul registre (ledger)**. Les chiffres du pilote (42j/70j, cycle 1er oct, ordre WE>fériés>semaine) ne sont plus du code en dur — ce sont les **valeurs par défaut d'un template**, modifiables par chaque cabinet.

---

## 1. L'anatomie d'un compteur générique (C1)

Un compteur est entièrement décrit par un **descripteur déclaratif** (le QUOI, pas le COMMENT). Le moteur sait évaluer n'importe quel descripteur ; le cabinet ne code jamais, il remplit des trous — **la même grammaire “phrase à trous” que les briques de règles**.

Les 9 propriétés qui définissent un compteur :
1. **Source** : d'où vient l'événement compté — `planning` (dérivé, recalculable) · `ledger` (mouvements persistés) · `import` (amorçage externe) · `referentiel` (valeur de config).
2. **Filtre** : quel événement compter (« type == weekend && rôle == premier ») — en enums fermés (catalogue partagé avec les règles).
3. **Unité + sens** : garde / jour / WE / heure / euro / écart / booléen ; et « plus = mieux / pire / neutre / cible ».
4. **Dimension(s)** : par quoi on regroupe (par véto ? par véto × type de créneau ?).
5. **Fenêtre** : période / saison / année-cycle (ancre, ex. 1er oct) / glissante N jours / permanente.
6. **Agrégation** : somme / moyenne / variance / écart max-min / min / max / comptage / dernière valeur.
7. **Cible + pondération** : quote-part égale / quota fixe / quota par personne ; pondéré par temps de travail (mi-temps 60 %).
8. **Seuils d'alerte** : ok / attention / critique (sémantique visuelle).
9. **Report inter-période** : aucun (charge) / solde cumulé (dette qui voyage) / remise à zéro (bilan).

Plus 3 attributs produit : **statut** (actif), **visibilité** (admin / véto / public), et **`est_dimension_optimisation`** (ce compteur sert-il le moteur, ou seulement l'affichage — voir §5).

**La preuve que c'est suffisant** : les 6 familles de compteurs y rentrent toutes sans exception, juste en changeant les valeurs des trous.

| Type | Exemple | Réglages clés |
|---|---|---|
| CHARGE | nb de week-ends | source=planning, agrégation=somme, report=aucun |
| CHARGE croisée | nb de gardes **par type** (demande cabinet) | même chose, dimensions=[véto, type] — un cube de plus, pas un nouveau compteur |
| ÉQUITÉ | déséquilibre WE | base=charge WE, agrégation=variance, sens=cible, `est_dimension_optimisation`=true |
| SOLDE/DETTE | bonus-malus, créance de crise | source=ledger, report=solde_cumulé |
| DROITS | solde CP | source=ledger+référentiel, fenêtre=année-cycle(1er oct), report=solde_cumulé |
| CONFORMITÉ | repos de sécurité respecté ? | unité=booléen, agrégation=comptage(violations), sens=plus_est_pire |
| FINANCIER | nb de fois 1er le WE (R11b) | filtre=`rôle==premier && type==weekend`, sens=cible |

Point décisif : **CHARGE et ÉQUITÉ ne sont pas deux objets, ce sont deux agrégations de la même source filtrée.** La métrique d'équité *pointe vers* la métrique de charge (`base=we_total, agrégation=variance`). Une seule définition de « ce qu'est un week-end de garde », deux lectures.

---

## 2. Le catalogue de métriques (C2) — 10 familles

C2 a ratissé toutes les métriques qu'un cabinet vétérinaire pourrait vouloir. Classées 🟢 cœur (tout cabinet) / 🔵 utile / ⚪ niche :

1. **CHARGE** — total, par type (sem 1er/2nd, WE 1er/2nd, vendredi, férié), nuits, WE travaillés, heures, jours d'affilée, cumul intra-semaine, grands WE salariés, astreintes, charge pondérée quote-part.
2. **ÉQUITÉ / JUSTICE** — écart à la moyenne, écart à la quote-part, variance, rang, indice de Gini, concentration (« toujours les mêmes ? »), équité **par type**, satisfaction des souhaits, **ordre de priorité d'équilibrage** (très paramétrable — AC et AS divergent déjà).
3. **FINANCIER** — nb de fois 1er le WE, indemnités d'astreinte, majorations nuit/dimanche/férié, revenu estimé (presque toujours niche).
4. **DROITS & SOLDES** — CP pris/restants/dotation, récup/repos compensateur, **compteur négatif** (demande AC), RTT, dette/créance de gardes par type, dette de crise, indisponibilités.
5. **PÉNIBILITÉ / QVT** — WE sacrifiés, garde la veille d'un jour off, enchaînements, repos de sécurité, gardes pendant les fêtes, 2 WE de suite, nuits consécutives.
6. **CONFORMITÉ** — repos légal 11h, repos hebdo 35h, plafond 48h, conformité CCN, alerte d'assouplissement réglementaire. *(⚠️ 11h et 48h = partiels, nécessitent le planning de jour absent.)*
7. **VOLONTARIAT / CRISE** — nb volontaire, remplacements faits/reçus, balance d'entraide, fiabilité, gardes en dernier recours, échanges validés.
8. **HISTORIQUE / TENDANCE** — Noël/fériés sur N ans, tendance de charge, historique des dettes, photo des règles par planning.
9. **COLLECTIF (cabinet)** — taux de couverture, nb de trous, équité globale, nb de règles pliées, robustesse, taux de modifications manuelles.
10. **EXPÉRIENCE VÉTO (vue “moi”)** — prochain créneau, ma charge vs moyenne, mes soldes, mes souhaits respectés, mon historique fêtes.

### 🎯 Focus CONGÉS — les 12 axes de variation (le point central de MiKL)
Le compteur de congés du pilote est un cas particulier déguisé en standard. Ce qui **doit** être paramétrable par cabinet :

| Paramètre | Pilote | Doit varier ? |
|---|---|---|
| Dotation associés | 10 sem / 70 j | ✅ |
| Dotation salariés | 6 sem / 42 j (5+1) | ✅ |
| Unité de décompte | jours (7 j/sem) | ✅ jours / semaines / demi-journées |
| Mode de comptage | pratique (pas paie) | ✅ ouvré / ouvrable / calendaire |
| **Début de cycle** | **1er octobre** | ✅ **critique** (1er juin / 1er janvier ailleurs) |
| Date de RAZ | 30 septembre | ✅ |
| Report d'un cycle | (ouvert) | ✅ perdu / reporté / plafonné |
| Périodicité du bilan | trimestriel | ✅ trimestriel / annuel / par période |
| Régimes cohabitants | associé + salarié | ✅ 1, 2 ou + régimes en parallèle |
| Compteur négatif | demandé | ✅ on/off |
| Jours isolés vs semaine pleine (mercredi→mercredi) | distingués | ✅ on/off (avancé) |
| Types d'absence actifs | CP, offert, récup, repos hebdo… | ✅ sous-ensemble par cabinet |

→ Conclusion C2 : le congé doit être un **moteur de soldes paramétrable** (dotation + cycle + unité + types), pas un compteur figé.

---

## 3. La configurabilité sans coder (C3)

**Tension centrale** : générique (chaque cabinet ses congés, ses métriques) **vs** non-technique (Anne-So ne fait pas de formule). Résolution : *on ne demande JAMAIS de construire une métrique, on demande de CHOISIR dans un catalogue pré-fait puis de remplir 2-3 champs.* Analogie : un **menu de restaurant**, pas un tableur vide.

### 3 niveaux d'effort croissant
1. **Template (90 % des cas, 30 s)** — le cabinet choisit un starter pack à son profil, tout est pré-réglé.
2. **Catalogue à cocher** — active/désactive des compteurs pré-faits, règle 2-3 champs simples.
3. **IA-assistante (rare)** — décrit en français, l'IA traduit vers un compteur du catalogue OU déclare hors-briques (Hub MPP). **L'IA ne définit jamais le calcul d'un compteur** (sinon hallucination = chiffre faux = mort de la confiance). Le formulaire reste le socle ; l'IA est surcouche (cohérent décision #7).

### Le mécanisme qui rend le paramétrable utilisable par un non-technique : **l'aperçu temps réel**
Anne-So ne comprendra jamais « le week-end compte comme congé » dans l'abstrait. Elle le comprend instantanément si elle voit « Fanny passe de 24 à 21 jours restants » quand elle coche la case. **Chaque écran de réglage montre le résultat sur un véto réel.** C'est non négociable.

### KPIs cochables (admin → véto) — §9sexies.1
L'admin coche, case par case, ce que chaque véto voit, regroupé en **3 blocs de sensibilité croissante** : sa charge perso (anodin) → sa position relative (⚠️ comparaison) → vue d'ensemble du cabinet (⚠️⚠️ très sensible). Côté véto, l'onglet n'affiche que les cases cochées ; zéro case cochée → pas d'onglet. **Chaque chiffre comparatif côté véto vient avec un « et alors ? » actionnable** (« +3 gardes → tu seras allégée », jamais un rang froid).

### Templates par profil
🌾 Rural/mixte (charge perso seule, prudent) · 🏥 Standard canine (= le pilote) · 🏢 Clinique/structure (transparence large + astreinte). Chaque template pré-règle les valeurs par défaut ; tout est marqué « (modifiable) ».

---

## 4. Le registre unique — schéma & branchement moteur (C4)

C'est la réponse frontale au risque R2. Aujourd'hui **4 systèmes** lisent/écrivent la même réalité (« qui a fait combien, qui doit à qui ») sans se parler : ÉQUILIBRER (moteur), compteurs affichés (vue), bonus/malus (table `bonus_malus`), dettes de crise (pas encore). **Cible : un seul ledger dont tous dérivent.**

### Principe : événements + projections
- Un **événement de ledger** = un fait daté, signé, attribuable (« le 10/01, véto X a fait 1 garde WE en 1er, période P, génération G » ; « le 03/02, X a dépanné Z → +1 créance X / +1 dette Z »).
- Les **compteurs affichés** = projection en lecture (somme par dimension). Jamais stockés en dur.
- Les **soldes inter-période** (bonus/malus) = autre projection (écart cumulé vs quote-part, qui voyage).
- Les **dettes de crise** = événements du **même** journal, type `crise_depannage`.
- Ce que le **moteur consomme** = la projection « solde net par dimension » au moment de générer.

→ ÉQUILIBRER, affiché, bonus/malus et dettes de crise ne sont plus 4 systèmes, mais **4 lectures du même registre**. R2 est désarmé par construction : il ne *peut pas* y avoir divergence s'il n'y a qu'un ledger. Et comme on stocke les **événements** (pas seulement les soldes), tout est traçable et rejouable (preuve en litige, décision #5).

### Schéma (4 tables, multi-tenant, versionné)
- **`metric_definitions`** (cabinet_id, clé, libellé, filtre jsonb, `est_dimension_optimisation`, force, version, effet_début/fin) — la définition configurable.
- **`metric_quotas`** (cabinet_id, metric_def, véto, quote_part, effet_début/fin) — proratisation mi-temps.
- **`ledger_events`** (cabinet_id, véto, metric_def, période, type_evt, delta, source_id, generation_id, date) — **LA source unique**.
- **`metric_balances`** (cabinet_id, véto, metric_def, période, solde_net, figé_le) — projection matérialisée pour le report (remplace et généralise la table `bonus_malus` à 4 colonnes en dur).

**Pièges multi-tenant** (à border avant le premier code) : `cabinet_id` dans **chaque** index unique (sinon collision de clés entre cabinets) et **chaque** policy RLS ; pas de vue cross-cabinet (la vue actuelle fait un CROSS JOIN sans filtre tenant = fuite en multi) ; l'import « date pivot » entre comme un `ledger_event type=ajustement_import` (jamais une 2ᵉ source) ; report de solde gardé en `numeric` non arrondi (sinon biais sur les quote-parts mi-temps).

### Calculé vs persisté (la ligne de partage)
- **Dérivé à la volée** (jamais stocké → désync impossible) : tous les compteurs intra-période (charge, équité, pénibilité, couverture). Ne JAMAIS matérialiser un compteur intra-période.
- **Persisté** : les soldes de fin de période (qui voyagent), les événements de ledger (faits historiques immuables), l'amorçage par import.

### La frontière « affiché vs optimisé » (la question fine de la mission)
**Un drapeau explicite : `est_dimension_optimisation`.** Toute métrique est *affichable* par défaut (zéro risque) ; seules celles marquées comme dimension d'optimisation entrent dans le score du solver — et elles exigent alors une **force** (étage lexicographique), une **quote-part** et une validation par texte déterministe (jamais par l'IA). Raison : si toute métrique custom devenait automatiquement une dimension d'optim, on retomberait sur le bug additif (trop d'étages = moteur paralysé). *Un cabinet crée librement des métriques d'affichage ; promouvoir une métrique en dimension d'optimisation est un acte délibéré et validé.*

### À faire PENDANT la réécriture du solver (seule fenêtre sans dette)
1. Tuer la divergence des 3 comptages → une seule définition pilotée par `metric_definitions`.
2. Brancher réellement la boucle (a) : le solver optimise la projection du ledger, pas un glouton déconnecté. `scoreEquite` mort → soit supprimé, soit promu en LA fonction objectif.
3. Passer additif → lexicographique proprement (supprimer les POIDS bidouillés).
4. Calcul incrémental des compteurs dans la recherche (delta, pas recompte total à chaque nœud).
5. Intégrer les dettes de crise comme dimension dès cette réécriture (sinon on rebranche 2 fois et R2 ressurgit).
6. Geler la photo des règles + définitions de métriques dans chaque génération.
7. Réparer le diagnostic d'impasse (aujourd'hui il évalue contre un planning vide → il ment).

---

## 5. Questions à trancher par MiKL (compteurs)

De C3 et C2 :
1. **Unité de congé par défaut** : jours (la plupart des cabinets) avec « semaine pleine mercredi→mercredi » en réglage avancé du template pilote ? *(reco : oui)*
2. **Transparence inter-vétos** : doit-on même proposer la case « un véto voit les compteurs de tous les autres » ? *(reco : oui mais avec gros avertissement, défaut off)*
3. **Le véto voit-il son rang/classement, ou seulement son écart à la moyenne ?** *(reco : jamais de rang explicite côté véto — écart + trajectoire seulement)*
4. **Granularité de l'import** (amorçage compteurs) : l'agrégat « X gardes par véto » suffit-il, ou faut-il le détail créneau par créneau (pour ne pas réattribuer un créneau déjà fait) ?
5. **Compteurs personnalisés hors-catalogue** : valve MiKL (modèle §6 cas 2 : l'IA prépare, tu valides) ou refus net ?
6. **Bilan de fin de période** : validation admin obligatoire avant report des bonus/malus, ou auto-report ? *(reco : validation obligatoire — cohérent « l'admin tranche toujours »)*

---

## 6. Synthèse pour le PRD

1. **Les compteurs sont un produit, pas des chiffres.** Un compteur = un descripteur déclaratif (9 propriétés) ; le moteur de métriques évalue n'importe quel descripteur ; les 6 familles sont le même moule.
2. **Une seule définition, un seul ledger.** Tuer les 3 comptages divergents + unifier ÉQUILIBRER, bonus/malus, dettes de crise et soldes CP dans un registre d'événements unique. C'est la résolution concrète de R2 et de la règle CONSUMERS.
3. **Externaliser TOUTES les constantes du pilote** (42/70 j, cycle 1er oct, ordre WE>fériés>semaine, durée 12/17 sem) en valeurs par défaut de template. Le pilote devient un cabinet comme un autre.
4. **Le congé = un moteur de soldes paramétrable** (12 axes de variation), pas un compteur figé. 3 axes critiques non-rétro-ajoutables : cycle, unité, régimes cohabitants.
5. **La configurabilité passe par “choisir + régler”, jamais “construire”** — templates + catalogue à cocher + aperçu temps réel. L'IA est surcouche, jamais calculatrice.
6. **Frontière nette affiché/optimisé** (`est_dimension_optimisation`) pour qu'une métrique custom ne paralyse pas le moteur.
7. **Tout se branche pendant la réécriture du solver** — seule fenêtre pour le faire sans dette.

---

*Produit le 2026-06-15 par MAX à partir de 4 audits. Compagnon : `03-catalogue-regles-blinde.md`. Alimente le PRD V2 (REX + OTTO) et l'architecture (`05-architecture-v2.md`).*
