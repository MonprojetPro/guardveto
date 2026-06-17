# GuardVeto V2 — Catalogue de règles « blindé »

> 🔬 **Synthèse de l'enquête « Ponçage des règles »** (2026-06-15) — 6 agents + benchmark concurrentiel.
> Angles : types de structures (R1), contraintes humaines/perso (R2), temporel/calendaire (R3), relationnel/équipe (R4), benchmark logiciels (R5), avocat du diable v2 (R6).
> Objet : vérifier que la grammaire v2 (`02-rapport-strategie-consolide.md` §2) borde tous les cas de figure d'une appli de planning de gardes, et lister ce qui manque.
> **Statut : à intégrer au PRD V2. Contient 4 décisions d'architecture rouges qui touchent des choix déjà actés — à re-trancher (§5).**

---

## 0. Le verdict en une page

**La grammaire v2 est solide sur l'axe pour lequel elle a été conçue (canine mono-activité, mono-site = le pilote), mais sa couverture réelle chute hors de ce profil.** Mesures croisées des 6 agents :

| Angle | Couverture « traitable » | Lecture |
|---|---|---|
| Golden test (11 règles du pilote) | **11/11** ✅ | Le pilote est parfaitement couvert. |
| Cas adversariaux expressifs (24 cas, diable v1) | ~83 % | Peut-on *écrire* la règle. |
| **Types de structures** (R1, 13 cabinets) | ~62 % | Décroche sur multi-activité, CHV/urgences, mutualisation. |
| **Contraintes humaines** (R2, ~80 cas) | ~65 % natif | Manque espacement + ancres riches. |
| **Relationnel** (R4, 34 cas) | **~26 % solide** | L'angle le plus faible : grammaire « binaire ». |
| **Fidélité d'arbitrage** (R6) | **~65 %** | Sait-on *faire respecter* la règle comme voulu. |

**Conclusion** : le « 83 % » mesurait la bonne moitié du problème (dire la règle), pas l'autre (la faire respecter fidèlement, durablement, reproductiblement). Le squelette à 6 axes tient ; il faut **~20 briques/opérateurs supplémentaires** (tous regroupables en familles) **et surtout régler 4 décisions d'architecture** qui sont non-rétro-ajoutables.

Bonne nouvelle stratégique (benchmark R5) : **aucun concurrent ne propose un moteur de contraintes “dures vs souples” lisible et auditable.** Le marché vend soit de l'IA boîte noire (Momentum/Biosked), soit de la conformité GTA lourde (Octime, Kelio, Chronos, Horoquartz). Un moteur transparent + équité explicite reste un positionnement différenciant clair.

---

## 1. Les briques manquantes — liste maîtresse dédupliquée

Fusion des trouvailles des 6 agents. Priorité : 🔴 critique (débloque beaucoup ou non-rétro-ajoutable) · 🟠 forte · 🟡 confort.

### 1.1 Famille TEMPS & RÉCURRENCE

| Brique | Ce qu'elle exprime | Sources | Prio |
|---|---|---|---|
| **Espacement minimal entre gardes** | « pas 2 nuits de suite », « 2 jours d'écart mini », « 3 semaines entre 2 WE », « 48h après un don du sang » | R2 (B1), R4 | 🔴 |
| **Ancre mobile resynchronisée** | garde alternée d'enfant recalée à chaque vacances scolaires | R2 (B2) | 🔴 |
| **Cycle « 1 sur N » + pas non-hebdomadaire** | pompier volontaire 1 WE/3, perfusion tous les 21 jours | R2 (B3) | 🟠 |
| **Ancre « Nième jour-de-semaine du mois »** | « 2e mardi du mois » (dialyse), « 1er lundi » (mandat) | R2 (B4) | 🟠 |
| **Fenêtre décalée sur l'alternance** | indispo Anne-So « jeu soir semaine impaire → jeu matin semaine paire » (traverse la frontière de semaine) | R6 (att. 9) | 🟠 |
| **Référentiel calendaire religieux mobile** | Ramadan, Aïd, Yom Kippour (calendrier lunaire) | R2 (B5) | 🟡 |
| **Rampe / paliers progressifs** | grossesse (allègement puis interdiction), retour de congé maternité, réduction senior par étapes | R2 (B6) | 🟠 |

### 1.2 Famille LOGIQUE & COMPOSITION

| Brique | Ce qu'elle exprime | Sources | Prio |
|---|---|---|---|
| **XOR / exclusion mutuelle** | « mercredi xor vendredi par semaine », « 24 déc xor 31 déc » | R2 (B7) | 🟠 |
| **Motif composite pré-calculé** « grand week-end » | rendre « si garde le WE » un fait atomique de niveau 0 → corrige les repos conditionnels de Jean et des salariés sans récursion à 2 niveaux | R6 (att. 6, 7) | 🔴 |
| **État « suspendu / arbitrage humain »** | mercredi de Fanny pendant les vacances : ni actif ni SAUF, mais « bascule en proposition à valider » | R6 (att. 8) | 🟠 |

### 1.3 Famille RELATIONNEL (l'angle le plus faible — R4)

> Constat R4 : la grammaire v2 « pense binaire » (un opérateur = une paire). Elle craque dès que l'arité dépasse 2 ou que la relation dépend de l'effectif.

| Brique | Ce qu'elle exprime | Sources | Prio |
|---|---|---|---|
| **COUVERTURE conditionnelle de composition** | « si un junior est de garde → un senior interne requis » (≠ « ≥1 senior par créneau », divergent dès effectif ≠ 2) | R4 (B2, P0), R1 (M4) | 🔴 |
| **AU-PLUS-N / RATIO par catégorie dans un créneau** | « ≤1 junior par garde », « ratio senior:junior ≥ 1:1 », « ≤1 externe » | R4 (B3, B4, P0) | 🔴 |
| **COUVERTURE multi-attributs (composite)** | « au moins un véto interne ET senior ET habilité équine » → débloque le faux-positif de sécurité du locum | R4 (C4, I2, I3) | 🔴 |
| **COUVERTURE conditionnée à l'effectif** | « au moins 2 seniors SI 3 de garde » | R4 (H1), R1 | 🟠 |
| **Opérateurs n-aires** | `PAS-ENSEMBLE(A,B,C)` (clique interdite ≠ 3 interdits par paires) | R4 (F4) | 🟠 |
| **Relations orientées** | « moi de garde seulement si Victor l'est » (covoiturage à un conducteur), incompatibilité asymétrique | R2 (B8), R4 (A4, F3) | 🟠 |
| **ORDRE-RÔLE selon attribut** | « le 1er de garde doit être plus senior que le 2nd », « un junior jamais 1er » | R4 (E3, E5) | 🟠 |
| **ÉQUILIBRER-APPARIEMENTS** | « que chacun tourne avec chacun », « jamais 2× le même 2nd de suite » (matrice N×N de co-occurrences) | R4 (D2, D3, D4) | 🟡 |
| **PRÉFÉRER-ENSEMBLE (affinité souple)** + **EXCEPTION tracée** | « préfère travailler avec X » ; « Victor PEUT être avec Manon (permission volontaire, pas un oubli) » | R4 (F2, A2) | 🟡 |

### 1.4 Famille STRUCTURE & MULTI-ACTIVITÉ (R1)

| Brique | Ce qu'elle exprime | Sources | Prio |
|---|---|---|---|
| **Groupe / cohorte d'équité paramétrable** | équilibrer indépendamment par filière / rôle / statut / type de shift / saison (au lieu d'un total unique) — débloque 6 structures sur 13 | R1 (M1) | 🔴 |
| **Multi-filières / lignes de garde parallèles** | canine ‖ rurale ‖ équine en simultané, chacune son périmètre de candidats | R1 (M2) | 🔴 |
| **Pondération de charge (équité en poids)** | équilibrer en jours-équivalents / pénibilité, pas en comptage brut | R1 (M6), R4 | 🟠 |
| **Quote-part majorée (>100 %)** | « jeune qui VEUT plus de gardes » | R2 (B10) | 🟠 |
| **Interdiction conditionnelle de remplissage par profil** | « ne comble pas avec un locum/junior sans validation, même s'il est dispo » (plus fort que dernier recours) | R1, R4 (I), R2 | 🟠 |
| **Shifts multiples / grille continue 24-7 + relais** | centre d'urgences : matin/AM/nuit, découpage d'un WE en relais, continuité de chaîne (anti-trou) | R1 (M5) | 🟡 (V3) |
| **Préférence de continuité / regroupement** | « réutiliser le même locum sur la période », « grouper mes gardes » | R1 (M8), R2 (B9) | 🟡 |
| **Attribut géographique / multi-site** | zone, site, rayon ; « jamais le même véto sur 2 cliniques le même soir » | R1 (M9), R4 (G3) | 🟡 (V3) |
| **Garde mutualisée inter-cabinets** | pool de garde partagé entre cliniques (cas dominant du marché) | R1 (M3), NOVA | ⚪ (V3, schéma prêt) |
| **Calendrier d'événements métier custom** | tournée prophylaxie, poulinage, concours, saison de ski comme déclencheurs de QUAND | R1 (M10) | 🟡 |

### 1.6 Famille SÉQUENCE & ROULEMENT (révélée par l'état de l'art — R5)

> Le benchmark de la littérature OR (Nurse/Physician Rostering, compétition INRC) + 9 éditeurs internationaux a révélé 7 familles de contraintes **standard du domaine** que la grammaire v2 n'a pas. Ce sont les patterns que tout solver mûr traite.

| Brique | Ce qu'elle exprime | Prio |
|---|---|---|
| **Successions interdites entre types de créneaux** | « interdit garde-de-nuit → matin », « interdit enchaîner soir puis WE » (généralise « la veille de ») | 🟠 |
| **Shift isolé / repos isolé** | « pas de garde seule entre 2 repos », « pas de repos seul entre 2 gardes » | 🟠 |
| **Stretch borné + repos post-nuits** | « entre 3 et 5 gardes d'affilée », « repos imposé après une série de nuits » | 🟠 |
| **Minimum consécutif** | « au moins 2 jours de repos d'affilée » (complément du AU-PLUS-N) | 🟠 |
| **Dimension COÛT / BUDGET** | pondérer/plafonner le coût (indemnités astreinte 20 % + garde nuit/dim/férié 20 % de la CCN 2564) — déjà présent **implicitement** via R11b (« avantage financier ») | 🟠 |
| **Substitution descendante** | « un senior comble un poste junior en pénurie, mais pénalisé » (transposable au dernier recours d'Anne-Cat) | 🟡 |
| **Pattern cyclique nommé** | roulement répété multi-jours (Panama 2-2-3, 4-on-4-off) — au-delà de l'alternance à ancre 1/2 | 🟡 (V3) |
| **Couverture cible souple au-dessus du minimum dur** | « min 1 (dur), idéal 2 (souple) » | 🟡 |
| **Rééquilibrage auto au changement d'effectif** | recalculer la cible d'équité quand un véto entre/sort (= départ d'Anne-Cat) | 🟠 |
| **Override tracé avec sévérité** | quand l'admin force en crise : journaliser qui/quand/pourquoi + afficher les règles violées et leur niveau | 🟠 |

**Point UX à voler au marché** (R5) : la conformité réglementaire est partout un **« pack = un interrupteur »** (Skello 150+ CCN, Deputy stress profiles, Humanity par juridiction) ; la détection des violations se fait **AVANT publication** avec le motif (Humanity right-to-rest), jamais un planning faux en silence. → renforce notre diagnostic d'impasse + « conformité CCN véto = un clic » comme argument de vente.

### 1.5 Hors-périmètre assumés (à déclarer, pas à masquer)

Tous convergent vers **4 familles** que l'outil n'a pas les données pour traiter (cohérent correction #12) :
1. **Planning de JOUR / clientèle** : « pas de garde le samedi matin où je consulte », « 11h de repos entre services », « 48h/semaine », prise de poste 18h vs fin de nounou.
2. **Lecture de calendriers tiers** : planning du conjoint, agenda SDIS réel (saisie manuelle possible, pas la lecture).
3. **Données du monde physique** : géoloc/domicile/rayon, météo/route, routage téléphonique du numéro unique.
4. **Données RH/paie** : compteur d'heures réel, nombre d'interventions en astreinte.

→ Recommandation R1/R2 : les **lister explicitement à l'onboarding par type de cabinet** (« GuardVeto ne gère pas X, voici pourquoi »).

---

## 2. Les bugs latents en production (au-delà des 2 connus)

R3 et R6 ont confirmé les 2 bombes (parité ISO déc. 2026 + cumul de pénalités) et en ont déterré **d'autres**, tous dans la V1 en service :

| # | Bug | Effet | Source |
|---|---|---|---|
| 1 | **Le solver ne minimise rien** (retourne la 1re solution faisable, `scoreEquite` jamais appelé) | toute l'équité est « décorative » ; l'échelle de force est branchée sur du vide | R3, R6, C4 (les 3 le confirment dans le code) |
| 2 | **Tie-break non déterministe** (dépend de l'ordre SQL des vétos) | deux plannings également valides → résultat change à règles identiques → **casse la rejouabilité** promise (preuve en litige) | R6 (att. 12) |
| 3 | Férié tombant un samedi/dimanche **non compté** dans l'équité fériés | équité fériés faussée | R3 (J4) |
| 4 | Lundi de Pentecôte / férié adjacent au WE traité comme garde de semaine ordinaire | qui garde ce lundi ? ni inversé ni rattaché au WE | R3 (C5) |
| 5 | Inversion 1er/2nd **non appliquée aux fériés en semaine** (alors que la règle métier l'exige) | règle métier §2 non respectée silencieusement | R3 (C3) |
| 6 | Trous/chevauchements de bornes entre saisons (fin août/début sept, fin avril/début mai) | jours mal saisonnés | R3 (E2, E3) |
| 7 | Double source de vérité saison (`loader` lit la base, `estEnEte` recalcule) | incohérence latente | R3 (E1) |
| 8 | « 2 WE de suite » non détecté à la jonction de 2 périodes (générées séparément) | un véto peut faire le dernier WE de janvier + le premier de février | R3 (H3) |
| 9 | Bonus/malus à mémoire courte (1 seule période de lookback) | une dette sur 2 périodes s'évapore | R3 (I1) |
| 10 | Véto qui part (`actif=false`) non daté | gardes passées effaçables du bilan ; filet « dernier recours » disparaît en silence | R3 (G2) |
| 11 | Vacances scolaires en dur, Zone C seulement, périmées dès 2027 | le « mercredi sauf vacances » de Fanny devient faux | R3 (D1) |
| 12 | **3 comptages divergents déjà en prod** (`compterParVet` TS ≠ vue SQL ≠ hook) | l'écran et le moteur ne lisent pas le même chiffre | C4 |

---

## 3. Les champs de schéma à graver dès les Fondations (non-rétro-ajoutables)

Consolidé de R3, R4, R6. Ce sont les colonnes qu'on ne peut pas ajouter après coup sans migration douloureuse :

- `contrainte.date_ancre` (alternance à ancre, remplace la parité ISO) + variante **offset décalé** (att. 9)
- `contrainte.date_effet` / `valid_to` / `version` (axe VALIDITÉ, versionnage)
- `veterinaire.date_entree` / `date_sortie` (cycle de vie, proratisation) + `quote_part`
- `veterinaire.tags[]` (statut, junior, dernier-recours, externe-planifiable, compétences)
- `veterinaire.dette_equite` (mémoire d'équité longue, **unifiée** avec créances de crise)
- `slot.borne_reelle` (intervalle réel du créneau : WE = sam 8h→lun 8h)
- `cabinet.zone_scolaire` + `cabinet.region_feries` + `cabinet.timezone` (multi-cabinet / régional)
- `cabinet.groupement_id` (vide — porte ouverte mutualisation V3)
- `creneau.type_presence` (sur_place / astreinte — vide, porte ouverte V3)
- `planning.regles_snapshot` + `metriques_snapshot` (rejouabilité, preuve en litige)
- `referentiel_cabinet` versionné par période (effectifs, créneaux, saisons, longueur)
- `historique_fete(vet_id, annee, type)` (équité Noël/fêtes inter-annuelle)
- `solverInput.contexteAnterieur` (lookback ~10 j pour les WE consécutifs à la jonction de périodes)
- **groupe / cohorte d'équité** sur les dimensions ÉQUILIBRER (att. R1 M1)

---

## 4. Règles de gestion à graver (comportement, pas schéma)

De R3 (14 règles) + R6 :
1. **Saison = partition exhaustive sans trou** (hiver = complément de l'été ; test de contiguïté obligatoire). La saison vient toujours de la base, jamais d'un recalcul code.
2. **Toute période commence un lundi** (validé, erreur explicite sinon).
3. **Alternance par ancre, jamais parité ISO.** Bannir le n° de semaine de tout calcul d'équité/quota.
4. **Semaine = lundi→dimanche calendaire** pour les quotas. Préférer les fenêtres glissantes N jours aux mois/semaines civils.
5. **Date d'effet** : une règle s'applique aux jours ≥ date_effet **non encore publiés**. Jamais de rétroactivité silencieuse. Diff visible avant régénération.
6. **Snapshot des règles + métriques à chaque génération** (rejouabilité).
7. **Référentiel versionné** : tout changement de structure ne s'applique qu'à la prochaine période ; compteurs passés figés.
8. **Proratisation** : quote-part = f(jours réellement présents). Un arrêt long ne génère **jamais** de dette d'équité.
9. **Départ = `date_sortie` datée**, jamais un `actif=false` brut.
10. **Équité à mémoire longue** (dette persistante cumulée, pas un delta N-1), unifiée avec les créances de crise.
11. **Fériés comptés indépendamment du type de slot** (un WE férié incrémente aussi le compteur fériés).
12. **Lookback inter-périodes** (~10 j) pour les règles de consécutivité.
13. **Fériés/vacances = données versionnées par année/zone/région**, en base, rechargées chaque été, alerte si l'année à venir manque.
14. **Export agenda en heure locale + TZID**, jamais UTC fixe.

---

## 5. ⚠️ Les 4 décisions ROUGES qui touchent des choix déjà actés (R6)

> L'avocat du diable v2 a attaqué non pas « peut-on écrire la règle » mais « le moteur arbitre-t-il comme le cabinet l'attend ». Il a trouvé **4 points non-rétro-ajoutables qui remettent en cause ou complètent des décisions du Top 10**. À re-trancher AVANT d'écrire les Fondations.

### 🔴 D-R1 — Le score lexicographique pur a un défaut inverse (touche la décision #1 actée)
Le lexicographique « par étages » que tu as validé tue bien la « mort par mille petites règles », **mais crée le défaut inverse** : il peut sacrifier 5 petits inconforts 🟡 (5 vétos lésés) pour gagner 1 cran sur une seule règle 🟠. Un cabinet qui voulait un **compromis raisonnable** ne peut pas l'obtenir — « la tyrannie de l'étage supérieur ».
→ **Reco R6** : faire du mode d'agrégation (lexico / additif / hybride avec tolérance d'étage) un **réglage de référentiel par cabinet**, versionné. Graver « lexico pour tous » contredit le multi-cabinet (un choix mono-cabinet gravé en fondation multi-cabinet).

> 🔁 **Convergence indépendante (R5, benchmark OR)** : deux agents arrivent à la même conclusion par des chemins différents. R5 note que **tous les solvers du marché (RosterLab, INRC) et toute la littérature soft-constraint utilisent une somme pondérée de violations**, pas un lexicographique pur — parce que le lexicographique **exprime mal la “fairness fine”** (une cible « 4 gardes ± écart pénalisé », un écart-type d'équité minimisé = des objectifs *continus*). C'est le seul vrai angle mort architectural du benchmark. **Recommandation consolidée : lexicographique HYBRIDE** — comparaison par étages (garantit « Jamais = jamais ») **mais somme pondérée À L'INTÉRIEUR de chaque étage** (récupère la fairness fine). C'est l'approche classique en recherche opérationnelle, et elle réconcilie ta décision #1 avec le besoin d'équilibrage nuancé. À acter en remplacement du « lexicographique pur ».
>
> Corollaire (R5) : il faut aussi **choisir explicitement LA fonction de fairness** dans ÉQUILIBRER (min-max ou écart-type — les 2 plus répandues). Sans ce choix, « équité » reste flou et le ressenti des vétos sera aléatoire.

### 🔴 D-R2 — Le tie-break doit être déterministe (touche la décision #5 rejouabilité)
Aujourd'hui deux plannings également valides se départagent selon l'ordre SQL des vétos → le planning change à règles identiques. **Ça casse la promesse « rejouable / preuve en cas de litige »** que tu as validée (#5).
→ **Reco R6** : tie-break final explicite et documenté (ex. ordre d'ID véto, ou règle d'équité), gravé comme invariant. Couplé à la réécriture du solver (qui doit comparer les solutions, pas retourner la première).

### 🔴 D-R3 — La migration 7→6 vétos de décembre est un champ de mines (touche l'échéance + décision #8)
Les dettes d'équité calculées sur 7 vétos / 12 semaines n'ont **pas le même sens** à 6 vétos / 6 semaines. Le code soustrait crûment des nombres absolus sans renormaliser → Anne-So devrait rattraper une dette d'un « monde à 7 » dans un « monde à 6 » = sur-correction injuste. Plus : les règles nommant Anne-Cat (qui sort) deviennent des **références mortes** (crash ou perte silencieuse d'une règle d'or).
→ **Reco R6** : stocker les dettes en **fraction de quote-part** (pas en nombre absolu de gardes) + un **diff de migration obligatoire** à chaque nouvelle version de période (liste les règles pointant vers une entité disparue, force l'admin à trancher).

### 🔴 D-R4 — La hiérarchie DANS le rouge n'existe pas (nouveau, transverse)
Plusieurs 🔴 peuvent entrer en conflit frontal sans règle de préséance : un IMPOSER 🔴 (« binôme du 25 déc ») vs l'invariant « en congé = pas de garde » si l'un tombe malade ; deux associées qui ancrent deux règles cabinet 🔴 contradictoires (cas réel : divergence règle 10 AC/AS) ; l'admin « tout-puissant » en crise qui voudrait violer une règle **légale** (repos de sécurité = illégal à outrepasser).
→ **Reco R6** : 3 sous-niveaux dans le rouge — **(a) invariant système** (jamais outrepassable) > **(b) réglementaire/légal** (jamais outrepassable même en crise) > **(c) règle d'or utilisateur** (outrepassable en crise avec alerte/justification tracée). Plus une matrice de préséance **force × validité × mode (normal / crise-auto / crise-manuel)**. Plus un rôle « admin principal » ou une co-validation pour les règles cabinet 🔴 (gouvernance multi-admin non gérée aujourd'hui).

### Autres correctifs R6 (🟠, à intégrer au PRD sans re-trancher)
- **Pré-vol de cohérence** des règles 🔴 entre elles AVANT le solver (détecter les contradictions arithmétiques, pas via le diagnostic d'impasse qui est défectueux).
- **COUVERTURE : déclarer bloquante vs qualifiante** (dimensionne le besoin OU qualifie les présents).
- **ENSEMBLE-REQUIS : valider la fermeture transitive** à la définition (éviter le trio indivisible sur un créneau à 2).
- **IA : ne jamais inventer un N** (« trop souvent » sans chiffre → question forcée, ou ÉQUILIBRER, jamais AU-PLUS-N inventé) + **liens dynamiques** vers les entités congé, pas des copies de date.
- **Carnet de remplaçants par cabinet** (pas de compteurs partagés tant que la mutualisation V3 n'est pas spécifiée).
- **Expiration de règle intra-période interdite** (sinon la photo des règles est incohérente).

---

## 6. Ce que le benchmark confirme (R5)

- **Pas de moat “IA”** : Momentum/Biosked, SuperPagr (OR-Tools), eTemptation, Chronos (Probayes) sont déjà « IA / optimisation ». Le marché santé est mûr.
- **Le vrai comparable fonctionnel** = Planning-Medical.com / Momentum (génération sous contraintes + équité + desiderata + repos + lissage des indemnités). SuperPagr (gratuit) est le plus proche conceptuellement.
- **⚠️ Concurrent le plus proche de NOTRE architecture : DeGarde (degarde.co)** — même paradigme exact « **14 contraintes dures + 25 souples** », équité week-end, quotités temps partiel, indisponibilités/préférences, et un positionnement revendiqué « **moteur mathématique, pas une boîte noire** » (= notre promesse de transparence). Conçu par des médecins hospitaliers, santé humaine (pédiatrie, urgences). C'est le seul acteur qui partage notre philosophie dur/souple → **à surveiller de près** ; un deep-dive ciblé (tarifs, liste exhaustive de leurs 39 contraintes, démo) est recommandé avant de figer notre positionnement. Notre différenciation résiduelle face à eux : la **niche véto FR** (déontologie, CCN 2564) + la **réparation à perturbation minimale** + la **surcouche IA de traduction en langage naturel**.
- **Notre angle défendable** (confirmé par tous) : **moteur transparent “dures vs souples” + équité explicite (rôle 1er WE) + réparation à perturbation minimale + profondeur réglementaire véto FR** (CCN 2564, déontologie continuité de soins). Aucun concurrent ne combine ciblage de niche + moteur + équité fine.
- **Briques que tout le marché traite et qu'on doit avoir pour être crédible hors pilote** : repos de sécurité (avec alerte), compétences/habilitations par poste, distinction astreinte/garde, desiderata, équité nuits/WE/fériés, génération auto avec retouche manuelle.

---

## 7. Synthèse pour le PRD

1. **La grammaire à 6 axes est validée comme socle.** On ajoute ~20 briques (groupées en 4 familles : temps/récurrence, logique/composition, relationnel, structure/multi-activité), marquées 🔴/🟠/🟡 ci-dessus.
2. **Les 2 briques les plus rentables hors pilote** : le **groupe d'équité paramétrable** (M1) + les **filières de garde parallèles** (M2) — elles font passer 4 types de cabinet de 🟠 à 🟢.
3. **Les 2 briques humaines prioritaires** : **espacement entre gardes** (B1) + **ancre mobile** (B2).
4. **La brique relationnelle pivot** : **COUVERTURE multi-attributs / conditionnelle de composition** (supervision « junior ⇒ senior interne ») — elle ferme le faux-positif de sécurité le plus dangereux.
5. **Les 4 décisions rouges (§5) se tranchent AVANT les Fondations** — elles coûtent zéro maintenant et une refonte après le Palier 1.
6. **Tous les champs de schéma du §3 entrent dans les Fondations**, même vides.
7. **Les 12 bugs latents (§2) rejoignent le chantier “correctifs V1” ou la réécriture du solver** selon qu'ils touchent la prod actuelle ou la V2.

---

*Produit le 2026-06-15 par MAX à partir de 6 audits + benchmark. Compagnon : `04-compteurs-produit.md`. Alimente le PRD V2 (REX + OTTO) et l'architecture (`05-architecture-v2.md`).*
