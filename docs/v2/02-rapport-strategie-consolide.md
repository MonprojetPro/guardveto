# GuardVeto V2 — Rapport de stratégie consolidé (catalogue de briques + structurel)

> 🔬 **Synthèse d'une enquête multi-agents** menée le 2026-06-15 sur les deux derniers points du brainstorming :
> **A** — le catalogue de briques de départ · **B** — le statut des règles structurelles.
> 8 audits indépendants : ARCH (technique moteur), REX+OTTO (produit), PIXEL (UX), CERBÈRE (sécurité), NOVA (stratégie/marché), Avocat du diable (adversarial), + 2 agents de synthèse (grammaire v2 consolidée, arbitrage de périmètre).
> Sources auditées : `docs/v2/01-brainstorming-v2.md`, `docs/v2/00-vision-roadmap-v2.md`, `docs/regles-metier-gardes.md`, `docs/retours-cabinet/`, le code réel (`src/engine/`), les migrations Supabase, recherche web (Ordre des vétérinaires, CCN 2564, RosterLab).
> **Statut : TOP 10 ARBITRÉ PAR MiKL le 2026-06-15** (voir §8 en fin de document). Décision majeure : **pas de livraison étalée — V2 complète d'un coup, échéance non contraignante** (sauf les 2 bugs prod V1, urgents).

---

## 0. Le verdict en une page

**L'architecture proposée tient. La grammaire de départ et le chiffre de couverture, non — mais ça se répare avec des ajouts ciblés, pas une refonte.**

Les 8 agents convergent sur le même jugement : le trio **briques (code partagé) + IA bornée (traduit, ne calcule jamais) + moteur déterministe (seul juge)** est une des architectures les plus saines qu'on puisse choisir. CERBÈRE va jusqu'à dire que c'est l'archi IA qu'il aurait recommandée. Le squelette est bon.

Mais l'enquête a déterré **trois familles de problèmes** :

1. **Une bombe technique cachée dans le code actuel.** Le moteur **ne minimise rien** : il retourne la *première* solution faisable, et la fonction d'équité n'est jamais appelée par la recherche. Conséquence : tant qu'on ne réécrit pas le solver, **l'échelle de force est un curseur branché sur du vide** — bouger un curseur ne changerait rien de prévisible. Tout le système de règles configurables repose là-dessus.

2. **La grammaire v1 couvrait ~50-65 % des demandes réelles, pas 95 %.** L'Avocat du diable l'a prouvé sur 24 cas réalistes. La bonne nouvelle : les trous se regroupent en **6 familles de briques manquantes** + un **domaine entier oublié (le REPOS)**. Une fois ajoutées, la grammaire v2 remonte à **83 % traitable** et passe le golden test des règles du pilote **11/11**.

3. **Le produit était pensé pour UN cabinet** (le pilote : canine, mono-site, associées libérales, garde sur place). Trois hypothèses tombent dès le 2ᵉ client : la **garde mutualisée entre cliniques** (cas dominant du marché FR), l'**astreinte téléphonique** (vocabulaire fondamental absent), le **droit du travail des salariés** (repos de sécurité = obligation légale, pas une option).

Et **deux bombes datées** sont déjà armées en production, à corriger avant l'hiver :
- les pénalités du moteur se cumulent mal (deux règles « moyennes » franchissent déjà le seuil d'une règle « forte ») ;
- le calcul des semaines paires/impaires casse en **décembre 2026** (2026 a 53 semaines ISO → deux semaines impaires consécutives → l'alternance de garde d'enfant d'Anne-So se désynchronise) — **pile au moment du passage à 6 vétos.**

La suite du rapport détaille tout, puis liste les **10 décisions** que toi seul peux trancher.

---

## 1. Ce sur quoi les 8 agents sont d'accord (à acter sans débat)

| # | Décision de consensus | Porté par |
|---|---|---|
| C1 | **Les Fondations passent AVANT toute interface configurable.** On ne construit pas un étage sur une fondation fissurée. | ARCH, NOVA, roadmap |
| C2 | **Le solver doit réellement optimiser** (aujourd'hui il prend la 1re solution venue). Sans ça, l'échelle de force ne veut rien dire. | ARCH (découverte), DIABLE (confirme) |
| C3 | **Corriger 2 bugs déjà en prod** : cumul de pénalités + parité de semaine (casse en déc. 2026). | ARCH, DIABLE |
| C4 | **L'IA ne calcule JAMAIS le planning.** Elle traduit/explique au moment de *définir*. Le moteur reste seul juge. | Les 8 |
| C5 | **L'IA n'est pas un avantage concurrentiel** (RosterLab est déjà « AI-powered »). Le vrai moat = profondeur réglementaire FR + réparation à perturbation minimale. | NOVA, DIABLE |
| C6 | **Le multi-cabinet est une Fondation, pas une feature tardive.** La sécurité actuelle est mono-cabinet ; greffer le multi après = tout réécrire. | CERBÈRE, NOVA |
| C7 | **Entre cabinets, on partage SEULEMENT le code des briques. Jamais les données** (règles, noms, carnet de remplaçants). | CERBÈRE, NOVA |
| C8 | **Une brique neuve écrite par l'IA = une vraie revue de code (PR Git), jamais du code exécuté depuis la base.** | CERBÈRE |
| C9 | **Règles versionnées + chaque planning garde la photo des règles qui l'ont produit** (rejouable, preuve en cas de litige entre associés). | ARCH, CERBÈRE |
| C10 | **Le diagnostic « pourquoi c'est impossible » est le jumeau obligatoire du curseur de dureté.** L'un ne va pas sans l'autre. | PIXEL, ARCH |
| C11 | **La couverture réelle est ~50-65 %, pas 95 %.** À recadrer honnêtement. | DIABLE, REX+OTTO |
| C12 | **Le domaine REPOS existe et manque** (1/3 du retour d'Anne-Catherine). | REX+OTTO, NOVA, DIABLE |

---

## 2. Point A — Le catalogue de briques, version corrigée

### 2.1 Le principe (inchangé, validé)
Une règle = une phrase à trous : **[QUI] · [QUAND] · [QUOI créneau+rôle] · [OPÉRATEUR] · [avec quelle FORCE] · [valable quand].**
Le catalogue de départ = le vocabulaire pour remplir chaque trou, rétro-ingéniéré des règles V1 + retours cabinet + standards du marché.

### 2.2 Les 13 corrections apportées par l'enquête
La grammaire v1 avait des angles morts. Voici ce que la v2 ajoute ou change :

| # | Correction | Pourquoi |
|---|---|---|
| 1 | **Opérateurs positifs** : IMPOSER (forcer le binôme du 25 déc), ENSEMBLE-REQUIS (« ensemble ou rien »), AU-MOINS-N, COUVERTURE (« au moins un senior par créneau ») | La grammaire ne savait qu'interdire/éviter ; le cabinet veut aussi *forcer*. Le « 25 décembre » d'Anne-Catherine était inexprimable. |
| 2 | **AU-PLUS-N exige une FENÊTRE** (semaine civile / glissante N jours / période) | « Max 2 nuits/semaine » sans fenêtre = passoire : jeu+ven puis lun+mar = 4 nuits en 6 jours. |
| 3 | **ÉQUILIBRER devient une famille à part**, chaque dimension avec **sa propre force** + **quotes-parts** (mi-temps 60 %) | Sinon l'équité (×100 dans le code) écrase mécaniquement toute règle souple. Et le temps partiel est massif dans la profession. |
| 4 | **« Alternance à ancre »** remplace la parité ISO | 2026 = 53 semaines → bug daté décembre 2026. L'ancre (1 sem/2 depuis une date de référence) est robuste. |
| 5 | **SAUF** (négation propre) + **OU** (composition) dans le QUAND | « Mercredi sauf vacances » en 1 règle ; la vraie règle d'Anne-So sans la dédoubler (sinon elle compte double dans le scoring). |
| 6 | **Pas de SI…ALORS générique sur le planning.** À la place : SI-calendaire + un catalogue fermé de **motifs pré-câblés** (ex. « si garde le WE cette semaine »), récursion bornée à 1 niveau | Le SI libre sur le plan crée des cycles de dépendance (le hack ligne 169 du code actuel en est la preuve). |
| 7 | **QUI élargi** : entité **paire/duo** (« jamais le même binôme 2 WE de suite »), rôle de la personne (véto/ASV/interne), compétence (canine/équine), marqueur « externe planifiable » | Couvre les règles relationnelles et les autres profils de cabinet. |
| 8 | **QUOI = un référentiel de créneaux par cabinet** (quels créneaux, horaires, nb de postes) + **type de couverture** (sur place / astreinte) | 4 cabinets-types sur 5 cassaient avec des créneaux figés. L'astreinte est le vocabulaire fondamental FR. |
| 9 | **6ᵉ axe : la VALIDITÉ** (permanente / saison / période N / date d'effet + version) | Exigé par le système de crise (règles ponctuelles) et le cas « règle créée en milieu de période ». **Non rétro-ajoutable.** |
| 10 | **« Dernier recours » = marqueur lexicographique**, pas un cran du curseur | Anne-Cat « seulement si personne d'autre » ≠ « pénalité élevée » (une accumulation de petites pénalités pourrait la choisir à tort). |
| 11 | **Famille « réglementaire » pré-assemblée** (repos de sécurité, plafonds CCN), dure par défaut, alerte si on l'assouplit | Obligation légale pour les cabinets employeurs + argument de vente. |
| 12 | **Honnêteté sur les hors-périmètre** : « 11h de repos entre services », « 48h/semaine » → nécessitent le planning de *jour* que l'outil n'a pas | Mieux vaut le dire que produire un planning faux en silence. |
| 13 | **Chaque créneau expose son intervalle réel** (un « week-end » daté samedi couvre sam 8h→lun 8h) | Sinon « la veille de » / « le lendemain de » se trompent de jour, et un congé débutant dimanche passe à travers. |

### 2.3 Le résultat mesuré
- **Golden test (les 11 règles réelles du cabinet)** : **11/11 exprimables**, dont 3 qui étaient bancales en v1 (la parité d'Anne-So, le « sauf vacances » de Fanny, le repos conditionnel de Jean).
- **Test adversarial (24 demandes réalistes de vétos)** : **83 % traitable** (✅ 14 exact + 🟡 6 via une brique catalogue), vs ~50-65 % en v1. Les **4 cas restants sont des trous honnêtement déclarés** (planning de jour ou données externes inexistantes), pas des plannings faux.

### 2.4 Stratégie de construction (marquage)
- 🟢 **Jour 1** : tout ce qui sert le pilote OU touche au schéma de données non-rétro-ajoutable.
- 🔵 **Catalogue prêt, activable plus tard** : compétences, astreinte, ENSEMBLE-REQUIS, AU-MOINS-N — le champ existe, la brique suit.
- ⚪ **V2.1+** : le confort.

---

## 3. Point B — Les règles structurelles, reformulées

La v1 proposait 3 statuts (figé / référentiel d'onboarding / on-off en bloc). L'enquête confirme l'instinct **mais corrige une erreur** : « réglé à l'onboarding » est faux dans la vraie vie.

| Statut | Contenu | Correction de l'enquête |
|---|---|---|
| ① **Invariants figés** | « en congé = pas de garde », « 1er ≠ 2nd » | Validé. *(Nuance CERBÈRE/diable : en mode crise manuel, l'admin peut-il outrepasser ? À border.)* |
| ② **Référentiel par cabinet** | effectifs, dates de saison, longueur de période, catalogue de créneaux, zone scolaire, région des fériés | **Doit être VERSIONNÉ par période, pas figé à l'inscription.** Les saisons changent de dates chaque année, la rotation passe de 12 à 6 semaines, Anne-Cat sort en cours de route. Un changement de structure ne s'applique qu'à la **prochaine période** (sinon les compteurs passés deviennent faux). |
| ③ **Conventions locales on/off** | liaison vendredi↔WE + inversion 1er/2nd, en bloc | Validé (le code prouve que ces règles sont enchevêtrées). **Nuance** : certaines ont besoin d'un « sauf » (Pâques : binôme sam-dim-lun mais 2 autres le vendredi). À gérer en convention nommée, pas en simple interrupteur. |

**Le point le plus important** : l'**effectif** n'est pas vraiment « par saison ». Des cabinets le règlent par *jour* (« le mardi est calme, 1 seul »), par *événement* (canicule → 3 de garde). Donc l'effectif doit pouvoir devenir une **règle de cardinalité** à terme — mais le stocker dès maintenant comme « nombre de postes » dans le référentiel de créneaux ouvre cette porte sans refonte.

---

## 4. Les désaccords entre agents, arbitrés

| Tension | Positions | Arbitrage retenu |
|---|---|---|
| **Nombre/noms des niveaux de force** | PIXEL : 4 nommés par conséquence · REX+OTTO : 3 visibles · brainstorming : 5 | **4 niveaux internes nommés par conséquence** (🔴 Jamais / 🟠 Sauf crise / 🟡 Évitée au max / ⚪ Si possible), **3 exposés par défaut**. On nomme par ce que le moteur FAIT, pas par l'importance ressentie (sinon tout le monde met « très important » et le moteur étouffe). |
| **Score additif vs lexicographique** | brainstorming : additif à gros écarts · ARCH : lexicographique | **Lexicographique.** L'additif est déjà cassé en prod. Seul le lexicographique garantit que « Jamais » = jamais, quel que soit le nombre de petites règles. |
| **Domaine REPOS** | trou noir vs hors-V2 | **Découpé en 3 marches** : affichage des repos (V2-cœur) → congés payés + grands week-ends en compteurs (V2.1) → repos comme contrainte du moteur (V3). Ignorer = signal « on n'a pas écouté » à une associée. |
| **Repos de sécurité** | NOVA : obligatoire jour 1 · REX+OTTO : livré OFF (sinon casse le pilote rural) | **Brique livrée en V2-cœur, désactivée par défaut.** Le pilote la laisse OFF ; la vente la présente comme « conformité CCN = un interrupteur ». |
| **Multi-tenant étanche vs garde mutualisée** | CERBÈRE : isolation stricte · NOVA : le marché a besoin de traverser les cabinets | **Isolation stricte MAINTENANT + une colonne « groupement » vide dans le schéma.** Zéro code de mutualisation en V2, mais la porte structurelle est ouverte pour la V3. |
| **Astreinte téléphonique** | NOVA : fondamental · pilote : que de la garde sur place | **Pas de feature en V2-cœur, mais le champ « type de présence » dans le schéma** (défaut : sur place). Le vocabulaire entre, la feature suit. |
| **IA porte unique vs mode guidé** | brainstorming : IA partout · PIXEL+CERBÈRE : plan B obligatoire | **Le formulaire guidé est le socle, l'IA une surcouche par-dessus.** Si l'IA tombe, le formulaire marche seul. La validation finale se fait par texte déterministe, jamais par le LLM. |

---

## 5. Le découpage proposé (face à l'échéance décembre 2026)

> ~5,5 mois avant le passage du pilote à 6 vétos / rotation 6 semaines. Le pilote est **bêta-testeur gratuit** : il tolère l'absence d'IA, il ne tolère PAS un planning faux ni l'oubli du repos.

### 🧱 FONDATIONS (non négociable, en premier)
F1 persister la vérité complète du moteur · F2 unifier le scoring · F3 lire les données en base (plus de listes en dur) · F4 normaliser le format des contraintes · **F5 multi-cabinet** (+ colonne « groupement » vide + champ « type de présence ») · **F6 réécrire le solver** (vraie optimisation, score lexicographique) · **F7 fix des 2 bugs prod** (cumul pénalités + parité semaine 53) · **F8 schéma versionné + trace** (la trace conditionne tout diagnostic futur).

### 🎯 V2-CŒUR (prêt pour le pilote)
Écran Règles avec **mode guidé** · curseurs **4 niveaux, 3 exposés** · **diagnostic d'impasse** factuel · catalogue de briques couvrant les retours cabinet (effectif configurable, rotation 6 sem, règle 10 réglable, forçage 25 déc, compteurs par type, « pas de garde le [jour] », « pas la veille ») · **REPOS marche 1** (affichage) · **repos de sécurité OFF** · **système de crise minimal** (réparation à perturbation minimale + mode manuel admin alerté + carnet de remplaçants) · **export CSV** · **notifs mail** (changement + appel volontaires) · **import → amorçage compteurs** · onboarding via back-office MPP.

### 🚀 V2.1 (juste après le pilote)
Surcouche **IA** (4 casquettes) · diagnostic intelligent « et si… » · REPOS marche 2 (congés payés + grands week-ends) · **self-service ouvert** · compteur d'équité visible par véto · catalogue auto-enrichi (cas 2 avec valve MiKL).

### 🌟 V3+
Astreinte fonctionnelle · garde mutualisée / groupement · REPOS marche 3 (contrainte moteur) · agent autonome de règles · scénarios multiples · rappels avant garde.

---

## 6. ⚖️ Top 10 des décisions que TOI seul peux trancher

> Chacune coûte **zéro aujourd'hui** et une **refonte** si on la découvre après le Palier 1. Recommandation entre parenthèses.

1. **Moteur : score lexicographique plutôt qu'additif ?** *(Recommandé : oui — l'additif est déjà cassé en prod, et le solver est de toute façon à réécrire.)*
2. **Multi-cabinet dès les Fondations ?** *(Recommandé : oui — sinon refonte de toute la sécurité après coup.)*
3. **Ajouter une colonne « groupement » vide maintenant** (pour la garde mutualisée future) ? *(Recommandé : oui — coût = une colonne vide.)*
4. **Ajouter un champ « type de présence » (sur place / astreinte) maintenant ?** *(Recommandé : oui — sinon migration de données quand le 1er cabinet à astreinte arrive.)*
5. **Versionner les règles + photographier les règles dans chaque planning ?** *(Recommandé : oui — l'historique perdu ne se reconstruit pas.)*
6. **Validation d'une règle par texte déterministe, jamais par l'IA ?** *(Recommandé : oui — une hallucination qui valide une règle fausse en silence = mort du produit, cohérent TILT.)*
7. **Formulaire guidé comme socle, IA en surcouche ?** *(Recommandé : oui — le produit doit survivre à une panne d'IA.)*
8. **Le REPOS entre en V2-cœur (au moins l'affichage) ?** *(Recommandé : oui, marche 1 — c'est 1/3 d'un retour d'associée.)*
9. **Le système de crise entre au cœur (version minimale) ?** *(Recommandé : oui — c'est LE différenciateur, et le moteur n'a aujourd'hui aucun objectif « réparation ».)*
10. **Pilote = bêta gratuit sur V2-cœur, V1 maintenue seulement sur les bugs bloquants ?** *(Déjà tranché §9quater — confirmé.)*

---

## 7. Risques résiduels (repérés en croisant les angles)

- **R1 — Crise « admin tout-puissant » × isolation multi-cabinet.** Personne n'a audité les deux ensemble : l'admin tout-puissant en crise est exactement le profil d'escalade que la sécurité veut contenir. À border : sa toute-puissance reste prouvée comme bornée à son propre cabinet.
- **R2 — Le registre d'équité × les dettes/créances de crise risquent de diverger** (même piège que le « scoring en double » qu'on corrige). À unifier en une seule source dès les Fondations.
- **R3 — Zéro stratégie de distribution.** Le produit sera bon ; rien ne dit comment le 2ᵉ cabinet arrive. Hors périmètre dev, mais bloquant commercial — à ouvrir en parallèle (canal « groupement coopératif » = le plus rentable à 79 €).
- **R4 — Le diagnostic d'impasse actuel est défectueux** (il évalue contre un planning vide). Or la crise ET le futur assistant IA s'appuient dessus. Son fix doit être en Fondations, pas plus tard.
- **R5 — Cumul de gardes la même semaine** (soirs + week-end) non contraint. Avec 6 vétos au lieu de 7, la pression monte → ce trou latent peut resurgir pile au pilote. À mettre comme brique candidate explicite.
- **R6 — Le coût IA réel n'est toujours pas mesuré.** L'IA descend en V2.1 (ça laisse le temps), mais lancer un prototype de mesure **pendant** la construction de V2-cœur, pas après — sinon tout le modèle éco (dont la part reversée à une cause) peut bouger.

---

---

## 8. ✅ Décisions tranchées par MiKL (2026-06-15)

| Sujet | Décision |
|---|---|
| **Paquet 1 — assurances schéma** (#2 multi-cabinet dès fondations, #3 case groupement, #4 champ type de présence, #5 versionnage des règles, #6 validation par texte déterministe) | ✅ **Les 5 validées en bloc.** Gravées dans les fondations. |
| **#1 — Moteur** | ✅ **Score lexicographique** (comparaison « par étages »), pas additif. Solver à réécrire. |
| **#7 — Saisie** | ✅ **Formulaire guidé = socle, IA en surcouche.** Validation finale par texte déterministe. |
| **#8 — Repos** | ✅ **TOTAL, pas de découpage en marches.** Affichage + congés payés (cycle 1er oct) + repos comme contrainte active du moteur — tout opérationnel à la livraison. |
| **#9 — Crise** | ✅ **Système complet d'un coup** (pas de version minimale étalée). |
| **#10 — Pilote** | ✅ Confirmé : bêta gratuit sur la V2 complète ; V1 maintenue uniquement sur les bugs bloquants jusqu'à la bascule. |
| **🎯 Périmètre & calendrier** | ✅ **Abandon de la livraison étalée (V2-cœur → V2.1).** On construit **la V2 complète d'un seul tenant** : Fondations + les 3 paliers (config + diagnostic + **IA comprise**) + repos complet + crise complète + multi-cabinet. **L'échéance de décembre 2026 n'est plus une contrainte de périmètre** — MiKL : « on se fiche de l'échéance, tout doit être opérationnel direct ». On livre quand c'est complet et solide. |

### ⚠️ Réserve critique actée en même temps
« On se fiche de l'échéance » s'applique à la **V2**, PAS aux **2 bugs déjà en production sur la V1** :
- **Parité ISO** : casse en **décembre 2026** (53 semaines ISO → 2 semaines impaires consécutives → l'alternance de garde d'enfant d'Anne-So se désynchronise). La V1 est en service quotidien → **à corriger sur la V1 avant l'hiver**, indépendamment du calendrier V2.
- **Cumul de pénalités** (45+20 > 50) : à corriger également.
→ **Chantier « correctifs bombes V1 » séparé et urgent**, en parallèle de la construction V2.

---

## 9. ✅ Décisions rouges tranchées par MiKL (2026-06-15 — session de révision)

> 4 questions soulevées par l'Avocat du diable v2 — tranchées en revue avec MiKL après explication concrète.

| # | Question | Décision actée |
|---|---|---|
| **D-R1 — Priorité des règles** | Score lexicographique pur ou réglable par cabinet ? | ✅ **Pur (fixe).** Quand deux règles du **même niveau** s'affrontent : le moteur choisit de façon **déterministe** (ordre interne stable, résultat rejouable). Il **signale le conflit** sur le planning brouillon (icône ⚠️) et l'IA explique le choix à l'admin, qui peut ajuster manuellement. |
| **D-R2 — Tie-break** | Déterministe ou aléatoire quand deux vétos sont à égalité ? | ✅ **Déterministe.** Même entrée = même résultat à chaque recalcul. Pas d'aléatoire. |
| **D-R3 — Compteurs à la période** | Comment gérer les vétos qui quittent ou rejoignent en cours de route ? | ✅ **Compteurs liés à la période, pas globaux.** Chaque période est générée avec les vétos définis AVANT la génération — ils arrivent avec leurs compteurs personnels. Un véto absent d'une période n'a pas de "dette" sur cette période. **Option à la main** : quand un admin ajoute un véto à une période, case à cocher *"Reprendre le dernier compteur de ce véto ?"* (utile si retour après absence). |
| **D-R4 — Gouvernance** | Hiérarchie de droits et multi-admins ? | ✅ **Simple, comme V1.** Deux rôles : admin et véto. Autant d'admins que le cabinet veut, avec les mêmes droits — c'est leur affaire de s'organiser. **Règles légales en dur : SUPPRIMÉES de la V2.** Pas de veille légale, pas de contrainte de droit du travail imposée — si un cabinet veut les ajouter un jour, c'est une config optionnelle, pas une règle système. À revoir en V3 si la demande émerge. |

### Ajout de périmètre — Configuration des périodes (session 2026-06-15)

La configuration d'une période devient **entièrement personnalisable** par cabinet :

| Paramètre configurable | Description |
|---|---|
| **Vétos actifs sur la période** | Liste à cocher parmi tous les vétos du cabinet (ex : 6 l'hiver sans Anne-Cat) |
| **Effectif par garde / par type de créneau** | Combien de vétos simultanément — peut varier par créneau au sein d'une même période (ex : 1 soir semaine · 2 week-end) |
| **Durée de rotation** | Toutes les N semaines |
| **Option "reprendre compteur"** | Par véto ajouté à la période, cocher si son historique doit être pris en compte |

**Philosophie V2 confirmée** : tout ce qui était codé en dur en V1 (effectif, vétos, durée, règles, poids) devient un paramètre réglable par cabinet. Chaque cabinet configure son propre système.

---

*Rapport produit le 2026-06-15 par MAX (orchestration) à partir de 8 audits d'agents MPP. Top 10 arbitré par MiKL le 2026-06-15. Décisions rouges D-R1→D-R4 + configuration de période tranchées le 2026-06-15. Prochaine étape : PRD V2 (REX + OTTO) sur le périmètre « V2 complète d'un coup ».*
