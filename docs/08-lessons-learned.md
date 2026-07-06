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
