# Leçons apprises — GuardVeto

> Registre des pièges rencontrés et des solutions qui ont réellement fonctionné.
> Tenu par ATLAS. Objectif : ne jamais retomber dans le même piège.

---

## 2026-06-04 — Moteur : binôme de semaine = même véto en 1er ET 2nd (contrainte dure manquante)

**Contexte :** recette, génération d'un planning hiver. 38 des 48 gardes de semaine avaient `premier_id = second_id` (le même véto en 1er et 2nd). Les week-ends étaient corrects.

**Cause racine (prouvée par lecture du code) :** dans `src/engine/rules/hard-constraints.ts`, `isValid` n'avait **aucune règle interdisant que le 1er et le 2nd d'un créneau soient la même personne**. Pour le week-end, c'était garanti *indirectement* par R8 (inversion 1er/2nd) + R9 (même duo que vendredi). Pour la semaine, rien → le solver, en cherchant le 2nd, retrouvait le 1er comme candidat valide (meilleur score d'équité) et le réassignait.

**Fix :** ajout de la règle dure **R21** (`checkR21RolesDistincts`) : un véto déjà dans un rôle d'un créneau ne peut pas occuper l'autre rôle. Branchée dans `isValid`. Conséquence voulue : si un soir n'a pas 2 vétos distincts disponibles, le moteur tombe en **impasse signalée** (route `/api/generate` renvoie `success:false` + `joursNonCouverts`, l'UI affiche l'alerte) — il **n'invente plus** de faux binôme.

**Pourquoi le bug n'avait pas été détecté :** le test `tousLesCreneauxRemplis` vérifiait que `premier_id` ET `second_id` sont **non-null**, mais **jamais qu'ils sont différents**. Un test « les cases sont remplies » ≠ « les cases sont valides ».

**À retenir / réutiliser :**
1. Quand deux rôles doivent être tenus par des personnes différentes, c'est une **contrainte dure explicite** — ne jamais compter sur le fait que « ça arrivera naturellement ».
2. Un test de complétude (« pas de null ») doit être doublé d'un test de **validité** (« valeurs distinctes / cohérentes »). Ajout du test de régression `R21 — 1er ≠ 2nd` (solver.test.ts), y compris sur le benchmark 12 semaines.
3. Principe métier confirmé par MiKL : **si une règle ne peut pas être respectée, SIGNALER l'impasse, ne jamais inventer.**

---

## 2026-06-04 — Emails métier non envoyés : clé SMTP ≠ clé API Brevo

**Contexte :** recette. Les emails de **connexion** (invitation, reset) arrivaient, mais **aucun email métier** (congé validé/refusé, planning publié) n'était reçu. `email_log` vide (mais ce flux ne journalise pas — fausse piste écartée).

**Cause racine (prouvée) :** le compte Brevo **n'avait aucune clé API**. La valeur placée dans `BREVO_API_KEY` (Vercel) était en réalité la **clé/identifiant SMTP** (celle qui sert à Supabase Auth). Or il existe **deux circuits Brevo distincts** :
- **SMTP** (login + clé SMTP) → utilisé par Supabase pour les emails d'auth. ✅
- **API transactionnelle v3** (`api.brevo.com/v3/smtp/email`, clé `xkeysib-…`) → utilisée par le code app (`src/lib/brevo.ts`, `src/lib/notifications.ts`) pour les emails métier. ❌ refus « non autorisé » → échec **silencieux** (`sendBrevoEmail` log juste un warn).

**Preuve décisive :** page Brevo « Vos clés API » → « Vous n'avez aucune clé API ». Donc la valeur dans Vercel ne pouvait pas être une clé API valide.

**Fix :** générer une **clé API v3** dans Brevo → remplacer `BREVO_API_KEY` dans Vercel (Production) → **redeploy** → email reçu. Aucun code modifié.

**À retenir / réutiliser :**
1. SMTP et API Brevo sont **deux mondes** : une config SMTP fonctionnelle ne garantit PAS que l'API marche. Vérifier qu'une **clé API `xkeysib-…`** existe.
2. L'expéditeur (`BREVO_FROM_EMAIL`) doit être un **sender vérifié** pour l'API. Un `@gmail.com` en expéditeur = délivrabilité fragile → privilégier un **domaine dédié** (lié à la question domaine perso du cabinet).
3. `sendBrevoEmail` échoue en **silence** (warn) — envisager de journaliser aussi les emails congé dans `email_log` (amélioration traçabilité).
4. Lié à l'incident SMTP du 2026-06-03 (port 587) : la config email de ce projet a deux étages indépendants, tester **les deux**.

---

## 2026-06-04 — Liens des emails Auth cassés en flux PKCE (reset + invitation)

**Contexte :** recette interne. Le scénario « mot de passe oublié » échoue : l'email arrive bien, mais cliquer le lien renvoie l'utilisateur sur la page de connexion sans jamais ouvrir la session ni proposer de changer le mot de passe.

**Cause racine (prouvée par observation directe) :** l'app Supabase est en **flux PKCE**. Les templates email utilisaient `{{ .ConfirmationURL }}`, qui génère un lien vers le endpoint **hébergé** Supabase `…/auth/v1/verify?token=pkce_…&redirect_to=…/set-password`. Après vérification, Supabase redirige vers `redirect_to` avec un `?code=…` qui **doit être échangé contre une session** (`exchangeCodeForSession`). Or la page d'atterrissage `/set-password` ne gérait que l'ancien flux *implicit* (`#access_token` dans le hash) ou une session déjà en cookie — elle ne faisait **pas** l'échange du `code`. Résultat : pas de session → redirection vers `/login`.

**Preuve décisive :** le token du lien commençait par `pkce_` (ex. `token=pkce_0912d2c1…`), et la barre d'adresse finissait sur `/login` sans session. C'est cette URL réelle — pas une hypothèse — qui a confirmé le flux.

**Fix retenu :** réadresser tous les liens d'action des templates email vers la **route serveur** déjà existante `/auth/confirm` (`src/app/auth/confirm/route.ts`), qui fait `verifyOtp({ type, token_hash })`, ouvre la session en cookie, puis redirige vers `next` :
```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<recovery|invite|signup|email_change>&next=<page>
```
Aucune modification de code applicatif : la route `/auth/confirm` faisait déjà le bon travail ; seuls les **templates email** (config dashboard) étaient mal adressés.

**Pourquoi c'était non-évident (et dangereux) :**
- L'**envoi** de l'email fonctionne parfaitement (`recovery_sent_at` bien renseigné en base) → on croit que « les mails marchent ».
- Le **1er admin invité via le dashboard Supabase** ne passe PAS par ce chemin → le bug reste invisible tant qu'on n'a pas testé un clic sur un lien généré par l'app.
- Le défaut touche **toute la chaîne d'emails à lien** : reset **ET invitation**. Donc l'onboarding des 6 vétos était cassé sans qu'on le voie — symptôme classique du **kit incomplet** (la fonction « envoyer un email » paraissait finie alors que l'atterrissage était mort).

**À retenir / réutiliser :**
1. Sur tout projet Supabase **SSR + PKCE**, ne pas utiliser `{{ .ConfirmationURL }}` brut : router les liens vers une route serveur (`/auth/confirm`) avec `token_hash` + `type`.
2. Tester un **clic réel** sur le lien d'au moins **un** email généré par l'app, pas seulement la réception. La réception ne prouve rien sur l'atterrissage.
3. Un même flux d'atterrissage doit servir **tous** les emails (reset, invitation, confirmation, changement d'email) — sinon un seul template oublié recasse l'onboarding.
4. TILT respecté : la cause a été **prouvée par l'URL réelle** (token `pkce_`) avant tout correctif. Aucun fix à l'aveugle.

---

## 2026-06-29 — Assistant IA : anti-coquille-vide, ambiguïté, et le piège du chiffre en dur

**Contexte :** recette de l'assistant IA (créer une règle en langage naturel). Plusieurs retours MiKL ont révélé des angles morts récurrents — tous des variantes du même thème : **ne jamais livrer quelque chose qui FAIT semblant**.

**Pièges trouvés & corrigés :**
1. **Doublons** : aucune vérification d'existant à la création → on pouvait empiler la même règle (et un duo apparaissait en double car écrit dans les 2 sens A→B + B→A). Fix : `trouverEquivalent` (même véto + mêmes params) + détection de paire duo non ordonnée, en création seulement.
2. **Prénom ambigu** : la résolution prénom→id prenait **le 1er match en silence** → si deux vétos s'appellent pareil, la règle visait peut-être le mauvais. Fix : distinguer `aucun` / `ambigu` et **REFUSER de choisir** (l'humain tranche via le formulaire). Principe : mieux vaut refuser que se tromper en silence.
3. **Règle sans effet** (plafond « au plus 50 gardes/semaine ») : l'IA proposait, le bouton Créer restait. Fix : la couche de conversion refuse (pas de payload → pas de bouton). C'est l'anti-coquille-vide appliqué à l'IA.
4. **Message incohérent** : quand notre couche refuse une proposition que l'IA croyait faisable, l'UI affichait le message **optimiste de l'IA** (« je propose de limiter à 20… ») → illusion « rien n'a changé ». Fix : forcer le message sur NOTRE raison de refus.
5. **Affichage du duo** : 2 lignes en base = 2 lignes à l'écran. Fusionné en 1 ligne — MAIS il a fallu rendre le **toggle activer/désactiver** symétrique (sinon on laissait un demi-duo actif). Fusionner un affichage ⇒ vérifier que TOUTES les actions sur la ligne agissent sur les deux rows.

**LA leçon transverse (la plus importante) — pas de chiffre métier en dur :**
Le message disait « plafond trop élevé (maximum 14) ». MiKL : *le 14 est arbitraire, et même 7 (= 1 garde/jour) est une hypothèse — certains cabinets auront plusieurs gardes/jour.* → tout seuil « réaliste » dépend de **ce que le cabinet définit au départ**. On a retiré **tout chiffre affiché** (borne gardée en garde-fou interne, invisible) ; la version dérivée de la config cabinet est reportée en V2. **À réutiliser : un seuil affiché à l'utilisateur ne doit jamais être une constante câblée — il doit venir de la config du tenant, sinon on ment.**

**À retenir / réutiliser :**
1. Une couche IA suit les MÊMES règles que le reste : anti-coquille-vide (ne pas proposer ce qui n'aura aucun effet), refuser plutôt que deviner, message honnête.
2. Quand deux couches portent un avis (l'IA propose `faisable`, notre validateur refuse), c'est **toujours le validateur qui parle à l'écran**, jamais l'optimisme de l'amont.
3. Fusionner un affichage (duo 2→1 ligne) = auditer tous les consumers d'action de la ligne (toggle, edit, delete).
4. Tout seuil/borne montré à l'utilisateur = config tenant, pas constante.

---

## 2026-06-29 — Week-end « bloc atomique daté samedi » : angle mort des indispos/absences le dimanche

**Contexte :** MiKL demande « si un véto ne peut pas CE dimanche-là, comment fait-on ? ». Audit de la chaîne congés → moteur → dépannage.

**Cause racine (prouvée par lecture du code) :** le week-end de garde est **un seul créneau, daté au samedi**, qui couvre implicitement vendredi-soir + samedi + dimanche (solver `genererSteps` : dimanche = aucun slot propre). Or :
- R16 (congé bloque une garde) compare `slot.date` à la plage du congé → une indispo le **dimanche** ne matche pas le samedi → le véto reste assignable au week-end.
- La détection de crise (`recenserCreneauxImpactes`) filtre les gardes par `date` dans la fenêtre d'absence → une absence **dimanche seul** ne voit pas la garde week-end (datée samedi).

**Décisions MiKL (produit) :**
1. **Week-end reste atomique** (Option A). Le découpage par jour casserait l'**unité de compteur** (« 1 bloc = 1 week-end » pour toute l'équité, le grand WE, l'avantage rôle 1er) → ce serait un gros chantier V2.
2. Le cas « quelqu'un prend juste le dimanche » = **dépannage ponctuel** (système vérifié OPÉRATIONNEL : déclaration absence → remplaçant proposé/manuel/volontaire → re-check légalité serveur → application avec recalcul compteurs+agenda+email → trace compensation).
3. **Ne PAS câbler « ven+sam+dim »** : la couverture jour-par-jour d'un créneau doit venir de la **config cabinet** (un samedi peut être juste un samedi ailleurs) → correctif rangé dans le chantier **structure des gardes configurable (V2)**.

**Contournement immédiat (cabinet pilote, WE = ven→dim) :** déclarer une indispo/absence en **incluant le samedi** (le jour qui porte la garde week-end) → bien prise en compte.

**À retenir / réutiliser :**
1. Un objet « bloc » qui couvre plusieurs jours mais n'est **daté que d'un seul** crée un angle mort sur les autres jours — vérifier toute logique « par date » (congés, absences, indispos) contre ce type de bloc.
2. Avant de « simplifier » en câblant une structure métier (durée d'un week-end), se demander si elle varie d'un cabinet à l'autre → si oui, c'est de la **config tenant**, pas une constante.

---

## Leçons antérieures (résumées — détail dans `patch-log.md`)

- **2026-06-01 — Vues `SECURITY DEFINER` contournaient la RLS** : un véto pouvait voir un planning en brouillon. Fix : vues en `security_invoker` + `search_path` figé (migrations 010, 011). → Toujours vérifier que les vues respectent la RLS sur un projet auth-critique.
- **2026-06-01 — Suppression d'un rôle = traquer TOUS les résidus** : retirer le rôle « secretaire » a nécessité base + policies RLS + code + doc (migration 012). Un résidu = faille ou bug.
- **2026-06-01 — `node_modules` corrompu en dossier OneDrive** : réinstallation complète nécessaire ; ESLint 9 = flat config native via `eslint-config-next`.
- **2026-06-01 — Résidu d'outil dev en prod** : un script live-reload `localhost:8400` (outil `impeccable`) traînait dans `layout.tsx` et serait parti en prod. Vérifier les résidus d'outillage avant livraison.

## 2026-07-06 — P3b : généraliser un type fermé, la checklist des points de silence

**Contexte** : rendre les créneaux sur-mesure planifiables a exigé d'ouvrir l'union
`TypeGardeEngine` fermée. La recon a recensé 27 fichiers touchant le trio de codes.

**Leçons** :
1. **Un « byte-identique » non testé n'existe pas.** Les goldens du moteur
   n'exerçaient que le chemin legacy (aucun ne passait `input.creneaux`) — la
   preuve d'équivalence catalogue-défaut ↔ legacy était un commentaire, pas un
   test. Réflexe : AVANT de généraliser un chemin, écrire le test d'équivalence
   qui fige l'existant (`tests/engine/p3b-sur-mesure.test.ts`).
2. **Chercher la règle absente, pas seulement les règles cassées.** « Pas deux
   gardes le même jour pour un même véto » n'existait nulle part : R21 couvre le
   même créneau, `espacement_min` saute explicitement le même jour. Invisible
   tant qu'un seul créneau/jour existait — béant dès le multi-créneaux (R22 créée).
3. **Les mappings réducteurs sont des complices en chaîne.** `mapTypeGardeEnDb`
   (4→3), `mapDbTypeToEngine` (3→2), `typeEngineVersCodeCreneau` (switch fermé),
   le CHECK SQL et le dictionnaire `CRENEAUX[type]` devaient être levés ENSEMBLE :
   en oublier UN = crash (horaires), perte silencieuse (UNIQUE collision +
   ignoreDuplicates) ou violations fantômes (gate de publication qui aplatit).
   Réflexe : griller le chemin complet type-par-type du moteur jusqu'au PDF.
4. **Les colonnes V1 perdent de l'info (labels + places >2)** : toute
   reconstruction depuis `gardes` doit repasser par le catalogue (rôles) et le
   miroir `garde_placements`, sinon la couverture du validateur ment.

---

## 2026-07-06 — RG2 : généraliser une règle structurelle sans champ de mines (relations en donnée)

**Contexte :** verrou n°4 du doc 09 — R8/R9 étaient câblées sur le couple `vendredi_soir↔weekend` dans 3 couches moteur (contrainte dure, pénalité souple, et le repli du validateur). Objectif : les étendre aux types sur-mesure via des relations en donnée, en byte-identique pour l''existant.

**Ce qui a réellement fonctionné :**
1. **Faire voyager la nouvelle config DANS un objet déjà threadé partout.** `relations` vit DANS `StructureConfig`, déjà propagé en bloc par `resoudreContexte`, la crise, le replay et le diagnostic → zéro nouveau threading, zéro risque de « champ détruit en silence » par une reconstruction champ-par-champ (le piège R11b/resoudreContexte n''existe même pas ici).
2. **Distinguer `undefined` de `[]`.** `undefined` = pas de donnée chargée (contexte legacy, snapshot ≤ v3) → repli couple historique, FIDÈLE parce que ces plannings ont été générés quand le couple était câblé. `[]` = la donnée dit « zéro relation » → découplage réel voulu. Sans cette distinction, soit le repli écrase la volonté du cabinet, soit les contextes legacy perdent R8/R9.
3. **L''appariement des occurrences est LA vraie nouveauté conceptuelle** (le reste est mécanique). Règle retenue : adjacence (aucune autre occurrence de l''un ou l''autre créneau entre les deux), même jour inclus (matin+soir), fenêtre 7 jours. Byte-identique à `vendrediDeSemaine` par construction (depuis un samedi, la 1re occurrence en arrière est TOUJOURS le vendredi J-1).
4. **Écrire les tests custom AVANT de généraliser révèle les angles morts** : c''est en écrivant le cas « matin+soir le même jour » que le balayage k=0 (même jour) s''est avéré manquant — la vision produit (doc 09 : plusieurs gardes/jour) doit piloter les cas de test, pas le code existant.

**Piège restant (assumé, tranche 3) :** le validateur indépendant applique encore le couple historique en dur — sans UI d''édition des relations, aucune divergence possible en pratique, mais toute donnée custom AVANT la tranche 3 produirait des violations fantômes.

---

## 2026-07-07 — Vague 4 : règles « qui peut faire quoi » (tags + composition + desiderata)

**Contexte :** backlog #6 (« un junior jamais seul », « au moins un senior par week-end »), #22 (« un junior jamais 1er ») et #7 (desiderata : « préfère le mardi », « préfère avec X », « veut plus de gardes ») — 3 tranches livrées le même jour (`f59de66`, `5ee9eac`, `7239da5`).

**Ce qui a réellement fonctionné :**
1. **La « pose complétante » est LE bon moment pour juger une équipe.** Une règle qui porte sur la COMPOSITION d'un créneau (au moins un senior, pas que des juniors, avec X) ne peut pas bloquer une pose intermédiaire : l'avenir peut encore réparer (le senior arrive sur la place suivante). Le check ne se déclenche que quand la dernière place se pourvoit — le backtracking gère le reste. Bloquer plus tôt élimine des solutions valides.
2. **Le total de places qui fait foi = ce que le solver VA pourvoir, pas ce que le catalogue déclare.** Un `semaine_soir` plafonné par l'effectif déclare 2 places mais n'en pourvoit qu'une : l'équipe se fige à la 1re pose. D'où `SolverStep.nbPlaces` (nbAEmettre) threadé jusqu'aux slots — y compris dans la reconstruction étage 0 de `scorerPlanning` (places POURVUES de l'attribution finale).
3. **Jamais de bonus négatif dans le vecteur lexicographique.** Un coût négatif rendrait un planning « meilleur que zéro violation » et casserait la hiérarchie des étages. Préférence positive = PÉNALITÉ DE NON-SATISFACTION (0 si honorée) ; les termes négatifs restent réservés au tri des candidats (précédent : malusAvantageFinancier), utilisé pour le biais « veut plus de gardes ».
4. **Règle sans gardien dur = famille R10/R8b** : refuser « jamais » à l'écriture + clamper l'étage à l'évaluation (défense en profondeur). Les desiderata sont des préférences PURES — les proposer « fermes » serait une coquille vide.
5. **Le « qui » d'une règle peut être une ÉTIQUETTE, pas un véto** : `veterinaires.tags` (text[] libre) prépare aussi les cohortes d'équité (#21) sans re-migration. Anti-coquille-vide : l'écriture refuse un tag que personne ne porte, le pré-vol re-signale (tag sans porteur, rôle intenable si TOUS portent le tag).

**Piège évité :** le scoreur global ne comptait PAS les règles par-véto souples (dette double-scoring préexistante) — les nouvelles briques (composition, rôle, desiderata) sont scorées EXPLICITEMENT dans `scorerPlanning` avec les mêmes prédicats que le tri candidat, sinon le LNS défait ce que le greedy construit.

---

## 2026-07-08 — Vague 5 : les rythmes (lookback inter-périodes + séquences + cadencement ancré)

**Contexte :** backlog #17 (règles de rythme aveugles à la jonction de deux périodes), #13 (successions/repos du nurse rostering) et #20 (cadencement « 1 WE sur N ancré », cas pompier volontaire) — 3 tranches livrées le même jour (`9543cf9`, `8f13908`, `4ea3460`).

**Ce qui a réellement fonctionné :**
1. **Une donnée de contexte hors-période s''injecte en VUE ÉTENDUE explicite, jamais fusionnée dans `planning.attributions`.** Le lookback (~10 j de gardes figées de la période précédente) est concaténé par un helper pur (`attributionsAvecContexte`) consommé par les SEULS prédicats de rythme (R10, R3, espacement_min, espacement_weekend, au_plus_n). Fusionner dans le planning aurait contaminé la couverture (`slotsAttendus`), l''équité (`compterParVet`) et la persistance — trois familles de bugs silencieux évitées d''un coup. Le validateur indépendant construit SA propre vue (`planningRythme`), sans importer le helper moteur (deux gardiens).
2. **Avant de créer une brique, chercher l''ÉQUIVALENCE sémantique dans le catalogue.** « Repos minimum consécutif de N jours » ≡ `espacement_min` d''écart N+1 : le pattern manquant du nurse rostering se règle dans le PROMPT IA (« si un véto dit ‹ au moins 2 jours de repos ›, propose espacement_min »), pas par une 4e brique doublon qui aurait divergé de la première à la prochaine évolution.
3. **Une règle « après exactement N » est INVULNÉRABLE.** Premier jet de `repos_apres_serie` : « une série d''exactement N jours impose M jours de repos » — or toute pose adjacente ALLONGE la série au-delà de N, donc plus aucune série n''est « exactement N » et la règle ne se déclenche jamais. Les seuils de séquence se formulent en « ≥ N ». Test d''invulnérabilité à ajouter d''office sur toute règle à fenêtre déclenchante.
4. **Un cadencement ancré sur date absolue est inter-périodes PAR CONSTRUCTION.** `cadencement_weekend` juge le slot contre son ancre (modulo signé N×7 depuis le samedi de l''ancre), pas contre les autres gardes : pas besoin du lookback, phase stable à travers les jonctions, et STRICTEMENT calendaire (aucun recalage vacances — un engagement pompier ne se décale pas, contrairement à l''indispo cyclique scolaire).
5. **L''ordre de pose non chronologique du solver (WE d''abord, soirs ensuite) impose des prédicats SYMÉTRIQUES** : chaque règle de séquence juge le candidat contre les gardes déjà posées AVANT et APRÈS lui dans le temps (gabarit espacement_min). Un prédicat « seulement vers le passé » raterait la moitié des violations.

---

## 2026-07-08 — Vague 6 : derniers items « règles » (cohortes d'équité + XOR + conditionnelle orientée)

**Contexte :** backlog #21 (cohortes d'équité paramétrables par tag, préparées par la Vague 4), #15a (« 24 déc XOR 31 déc ») et #15b (« moi seulement si Victor est de garde ») — 3 tranches livrées le même jour (`806e98a`, `f1c2336`, `217b244`), catalogue à 26 briques, 788 tests.

**Ce qui a réellement fonctionné :**
1. **Un prédicat d'exclusion entre deux cibles doit tester le candidat SEUL, pas seulement les gardes existantes.** Premier jet d'`exclusion_dates` : « le candidat couvre la cible 1 → l'autre cible est-elle déjà couverte par une garde existante ? ». Or un UNIQUE slot `weekend` (daté du samedi, couvrant sam+dim) peut couvrir LES DEUX cibles à lui seul : le moteur posait la garde, le validateur — qui juge les jours couverts du planning FINAL — criait une violation fantôme au gate de publication. Attrapé en review, corrigé, prouvé par un test « accord des deux gardiens ». Règle générale : tout prédicat « pas A et B ensemble » se teste d'abord sur « le candidat porte-t-il A ET B ? ».
2. **Faire voyager une nouvelle config DANS un objet déjà threadé est une parade STRUCTURELLE au champ de mines `resoudreContexte`.** Les cohortes vivent dans `EquityWeights.cohortes` (comme les relations en RG2 dans `StructureConfig.relations`) : loader → solver → scoreur → crise → replay hérités sans UN SEUL champ ajouté à `SolverInput`. La reconstruction champ-par-champ n'a rien à apprendre = rien à oublier.
3. **Sur le chemin chaud d'`isValid` (appelé des dizaines de milliers de fois par le LNS), aucun travail avant la violation.** Le check `seulement_avec` construisait une `Map` de tous les vétos à CHAQUE appel, uniquement pour le prénom du message d'erreur. Résolution paresseuse (find O(n) seulement en cas de refus). À vérifier d'office sur tout nouveau check : que coûte-t-il quand il ne se déclenche PAS ?
4. **Une relation orientée n'est PAS un demi-duo.** `seulement_avec` = UNE ligne en base (refs[0]=A porteur, params.avec_veterinaire_id=B), aucun miroir, et le prédicat ne se déclenche qu'à la pose de A — B reste libre. Le duo symétrique (2 lignes miroir, fusion UI) et la conditionnelle orientée sont deux briques distinctes, pas une option sur la même.
5. **La sémantique « même créneau » d'une conditionnelle rend les créneaux 1 place structurellement interdits au porteur** — conséquence à ASSUMER et à attraper à la CRÉATION (pattern RG4) : refus si tous les créneaux visés sont à 1 place, avec alternative proposée (ciblage multi-places ou préférence souple `preferer_avec`). L'impasse cryptique des semaines plus tard coûte plus cher que le message au moment du geste.

**Piège documenté (non corrigé, assumé) :** les cohortes d'équité lisent les `vet.tags` LIVE au replay (les tags ne sont pas snapshotés) — même comportement que `composition_equipe`/`role_interdit_tag`, cohérent. Et une cohorte taguée sur `grands_weekend` ne « voit » que les salariés porteurs (le compteur `grandsWePerdus` n'est incrémenté que pour eux — voie sûre du byte-identique).

## 2026-07-10 — Fixes audit Bloc 3 (D1-D8) : deux leçons transverses

1. **Tout texte nominatif dans un template = bombe multi-cabinet.** « Anne-Sophie » signait en dur les e-mails de congés (brevo.ts) : parfait pour le pilote, faux pour tout autre abonné. Règle : les templates reçoivent l'identité (signature, expéditeur) en PARAMÈTRE avec un repli générique — et le repli ne doit JAMAIS être une adresse/nom réels (D4 : refuser d'envoyer vaut mieux qu'usurper l'adresse du pilote).

2. **Avant de gater une route « admin-only », grep ses consumers.** `/api/gardes/[id]/disponibilites` semblait réservée à la réattribution admin, mais la modale de garde est PARTAGÉE admin/véto : le véto en lit les métadonnées (verrouillage, type, échange). Un 403 sec aurait cassé le parcours véto en silence. Pattern retenu : dégrader la réponse par rôle (`vets: []`) plutôt que bloquer — la donnée sensible n'est ni calculée ni servie, l'UI existante ne change pas.

## 2026-07-26 — Assistant IA cassé en silence, et le piège de la limite « pile »

**Le fait.** L'assistant IA (traduction phrase → règle), recetté et validé
plusieurs semaines plus tôt, était **cassé en production** : toute demande
renvoyait un `400 invalid_request_error`. Découvert par hasard, en construisant
un banc de mesure de coût. Personne ne s'en était aperçu : la panne ne se
manifeste que quand on utilise la fonctionnalité, et plus personne n'y allait.

**Deux plafonds API sur les schémas de sortie structurée**, découverts l'un
après l'autre — le premier masquait le second :

| Plafond | Ce qui compte | Notre schéma |
|---|---|---|
| **16** | paramètres à **union** (un champ `nullable` → `type: [x, "null"]`) | 30 ❌ |
| **24** | paramètres **optionnels** | 30 ❌ |

**Trois leçons.**

1. **Une fonctionnalité recettée puis laissée sans usage peut casser en
   silence.** Le code n'a pas changé — c'est la plateforme en face qui a évolué.
   Tout ce qui dépend d'une API externe et n'est pas exercé régulièrement mérite
   soit un test de fumée périodique, soit une vérification avant chaque
   démonstration client.

2. **Atteindre une limite « pile » est un piège quand le compte est condamné à
   grandir.** Fusionner des champs pour passer de 30 à 24 aurait « marché » — et
   recassé au prochain type de règle ajouté, alors que le projet a précisément
   pour objectif de rendre *toutes* les règles configurables. La bonne réponse
   était de **découpler la forme externe** (contrainte par l'API) **de la forme
   interne** (dictée par le métier) : 7 champs figés côté API, les paramètres
   variables voyageant dans une chaîne JSON. Le compte ne bougera plus jamais.

3. **Découpler ne veut pas dire perdre la validation — elle se déplace.** Chaque
   paramètre déplié est re-validé *individuellement* contre le schéma interne :
   un champ mal typé devient `null` **seul**, sans emporter ses voisins corrects
   ni traverser jusqu'au moteur de planning. Un JSON illisible dégrade la
   proposition au lieu de faire tomber l'assistant.

**Règle retenue.** Ne jamais remettre un champ par paramètre dans un schéma
envoyé à un modèle. Un nouveau type de règle = de nouveaux paramètres dans
`params_json` et dans le catalogue du prompt, **rien** dans `SortieIaSchema`.
(À noter : un objet à clés libres n'est pas une alternative — Zod rend
`z.record()` en `{properties: {}, additionalProperties: false}`, soit un objet
obligatoirement vide.)

## 2026-07-26 — Optimiser un prompt : mesurer d'abord, condenser ensuite

**Le contexte.** L'assistant IA coûtait 3,96 ¢ par demande. Objectif : réduire
sans rien perdre en qualité ni en exigence.

**Ce que la mesure a appris, et qu'on aurait mal deviné.** 80 % du coût venait
du **prompt lui-même** (6 179 tokens d'entrée contre 150-350 de réponse), pas du
modèle. Chercher l'économie en changeant de modèle n'aurait touché qu'un
cinquième du problème.

**Deux leviers, dans cet ordre.**

1. **La mise en cache du prompt** (−50 % immédiat). Le prompt est identique d'une
   demande à l'autre : l'API le garde en mémoire et ne le refacture qu'au
   dixième du prix. Condition impérative : il doit rester **identique à
   l'octet** — donc jamais de date, d'horodatage ni d'identifiant de session
   dedans.
2. **Condenser le catalogue** (−39 % de caractères). La graisse était
   **structurelle, pas dans le fond** : une convention répétée 8 fois, une
   désambiguïsation écrite deux fois en entier, des exemples redondants. Aucun
   type de règle ni avertissement n'a été retiré.

**Le résultat, mesuré avant/après sur les 19 types de règles : 21/21 conservé**,
coût par demande de 3,96 → 0,95 ¢ (cache actif), première demande de 4,79 → 3,54 ¢.

**La règle à retenir.** *Ne jamais toucher à un prompt sans un banc qui couvre
tous les cas.* Le jeu de test court n'exerçait que 3 types sur 19 : une
régression sur les 16 autres serait passée inaperçue — et une règle mal traduite
ne se voit qu'une fois le planning publié. Le filet est en place
(`/admin/banc-ia`, mode « Vérifier les 19 types ») et doublé de 8 tests
unitaires qui figent le contrat entre le schéma et le catalogue.

**Corollaire observé deux fois dans la même journée** : quand un test échoue,
suspecter le test avant le modèle. Les deux « échecs » mesurés étaient des
phrases d'épreuve mal écrites — Filou avait raison de refuser dans les deux cas.
