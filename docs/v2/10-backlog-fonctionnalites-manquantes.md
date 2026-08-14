# Backlog — Fonctionnalités manquantes (audit 360° du 2026-07-03)

> Consolidé depuis l'audit complet à 6 agents (moteur, règles, UX, sécurité,
> angles morts, OR-Tools). **Rien ici n'est engagé** : MiKL arbitre ce qu'on
> en fait et quand. Classement par probabilité de besoin réel pour des
> cabinets vétérinaires variés (pas seulement le pilote).
>
> Les correctifs du sprint blindage du 2026-07-03 (sécurité, verrou de
> génération, gate de publication, R17, fériés zone-aware, perf LNS) ne sont
> PAS listés ici : ils sont faits.

---

## 🔴 HAUTE probabilité — bloquants pour les prochains cabinets

### Règles / moteur

1. **Quote-part / temps partiel** — le schéma véto ne porte aucune notion de
   fraction d'activité : un mi-temps est « équilibré » comme un plein temps
   (variance brute). Bloque quasi tout cabinet >3 vétos. Préalable : proratiser
   la dette d'équité (le bonus/malus inter-périodes sur-corrige aussi lors d'un
   passage 7→6 vétos — cas réel de décembre 2026).
2. **Échange de gardes self-service** — demande n°1 des utilisateurs de ce type
   d'outil : un véto propose un échange, l'autre accepte, l'admin valide (ou
   auto-validation réglable). Aujourd'hui : processus 100 % manuel via l'admin
   (doc métier §8).
3. **Astreinte téléphonique vs sur place** — `creneau_modele.type_presence`
   recommandé par le catalogue blindé, jamais posé. Standard chez les ruraux et
   les groupements.
4. **Créneaux sur-mesure réellement planifiables** — un code de créneau inconnu
   du moteur → aucun slot généré, SILENCIEUSEMENT (`stepsForDay` prend aussi
   seulement le premier créneau actif d'un jour). L'UI/IA permet déjà de créer
   ces créneaux : c'est LA porte d'entrée des cabinets non pilotes (week-end
   fractionné samedi/dimanche, garde de jour + garde de nuit le même jour…).
   Au minimum : avertir l'admin quand un créneau du catalogue est ignoré.
5. **R11b de bout en bout** — `roleAvantageFinancier` est threadé dans tout le
   moteur mais AUCUNE colonne/UI/loader ne l'alimente : réglage fantôme, la
   question au cabinet (mémoire `equite-1er-weekend-financier`) ne peut pas
   être traduite en réglage. Finir (colonne cabinet/profil + UI + loader) ou
   retirer la promesse.
6. ✅ **FAIT (2026-07-07, Vague 4)** — Composition d'équipe (tags junior/senior) :
   `veterinaires.tags` + brique globale `composition_equipe` (au_moins_un /
   pas_seuls, ciblage créneaux, dur/mou) de bout en bout (moteur + validateur +
   pré-vol + UI /regles + fiche véto + IA).
7. ✅ **FAIT (2026-07-07, Vague 4)** — Préférences positives (desiderata) :
   briques par-véto toujours souples `preferer_creneau` (« préfère le mardi »,
   « préfère les week-ends »), `preferer_avec`, `volume_gardes` (« veut PLUS /
   MOINS de gardes ») — scorées dans les deux gardiens, formulaire + IA.
8. **Remplaçants externes (locum)** — pas de carnet de remplaçants ni de règle
   d'intégration au planning.

8 bis. **Remplacement d'UN SEUL jour d'un week-end** (décision MiKL 2026-07-16,
   recette maquette M1) — cas réel : un véto du binôme ne peut pas être présent
   le samedi (ou le dimanche) seulement. Cadrage arbitré : ça reste de
   l'**exceptionnel → parcours crise (M3)**, PAS une réattribution ordinaire du
   planning — mais **le moteur doit le permettre** : aujourd'hui le week-end est
   un créneau-bloc, tous les flux (réattribution, échanges, crise) opèrent au
   créneau entier. Voie technique : s'appuyer sur les relations génériques entre
   créneaux (verrou 4) pour porter un remplacement partiel jour-par-jour avec
   re-validation des règles. **Questions métier : posées par FILOU au client,
   pas tranchées d'avance** (décision MiKL 2026-07-17) — au premier cas
   concret, Filou pose la question au moment où elle se présente (« qui touche
   l'avantage financier du 1er WE si le remplacement ne couvre qu'un jour ? »,
   « ce week-end partiel compte comment dans l'équité ? », « simple
   remplacement ou dépannage avec dette ? ») et la réponse devient un
   **réglage du cabinet**, mémorisé et re-proposé par défaut les fois
   suivantes. Aligné sur le principe « toutes les règles réglables +
   faisabilité jugée en direct par l'IA » (mémoire
   backlog-regles-structurelles-modulables).

### Produit / opérationnel

9. **Monitoring d'erreurs (Sentry ou équivalent)** — aujourd'hui un échec
   agenda/Brevo/placements = `console.error` dans les logs Vercel que personne
   ne lit. Le meilleur rapport gain/effort du backlog. À défaut : notification
   in-app admin sur tout échec + page admin exposant `email_log`.
10. **Multi-cabinet : sortir les partages câblés en dur** — à faire AVANT le
    cabinet n°2 : (a) `sendRappelPublication` sélectionne tous les admins SANS
    filtre cabinet (fuite inter-tenant dès 2 cabinets, `notifications.ts:322`) ;
    (b) `GOOGLE_CALENDAR_ID` = une seule env globale → calendarId par cabinet
    en base ; (c) `BREVO_FROM_EMAIL` défaut en dur ; (d) détection de zone
    scolaire/fériés par adresse (mémoire `feature-detection-zone-par-adresse`).
11. **Rappel de CRÉER la période suivante** — le cron ne voit que les périodes
    existantes : si l'admin oublie de créer la période, silence total jusqu'au
    trou de gardes.
12. **Édition manuelle avec garde-fous** — PATCH `/api/gardes/[id]` ne valide
    rien : l'admin peut affecter un véto en congé validé ou inactif sans
    avertissement au moment du geste (la re-validation Realtime rattrape après
    coup, seulement si la page /planning est ouverte).

13. **Places au-delà de la deuxième : les modifier à la main** *(ajouté le
    2026-07-29)* — depuis `5fba4cb`, une garde à 3 ou 4 vétérinaires s'AFFICHE
    partout (grille, modale, PDF, agenda) et se COMPTE (compteurs), mais ces
    places ne se réattribuent qu'en régénérant le planning. Il faut généraliser
    `GET /api/gardes/[id]/disponibilites` — qui ne calcule aujourd'hui que
    `dispo_premier` / `dispo_second` — à un rôle quelconque du catalogue, puis
    étendre le PATCH et l'écriture dans `garde_placements`. La modale et
    l'écran catalogue disent explicitement cette limite en attendant.

14. **Ajouter un vétérinaire EN PLUS de la structure (renfort ponctuel)**
    *(demande MiKL du 2026-07-29)* — distinct du point 13. Là, il ne s'agit
    pas de pourvoir une place prévue par le créneau, mais d'en **ajouter une
    qui n'était pas prévue** : une nuit qu'on sait chargée, un remplaçant qui
    double un junior, un renfort de dernière minute. La structure du cabinet
    reste la référence pour la génération ; ce serait un ajout **manuel et
    ponctuel sur UNE garde**, sans toucher au catalogue.

    Questions ouvertes à trancher avec le cabinet avant de coder :
    - Ce renfort compte-t-il dans l'équité (compteurs, dette inter-périodes) ?
      Sinon un véto pourrait être resservi alors qu'il vient de doubler.
    - Est-il notifié / synchronisé sur l'agenda comme une place normale ?
      (a priori oui — sinon il ne le saurait pas)
    - La régénération l'écrase-t-elle, ou le préserve-t-elle comme une garde
      verrouillée ? C'est le point le plus risqué : un renfort ajouté à la main
      puis effacé par une régénération, personne ne s'en apercevrait.
    - Le moteur doit-il en tenir compte comme d'une contrainte (« ce soir-là,
      2 vétos de plus sont déjà posés ») ?

    Techniquement, le socle est déjà là : `garde_placements` porte N places et
    la vue les expose. Le travail est surtout produit (les 4 questions ci-dessus)
    puis UI (bouton « Ajouter un vétérinaire » dans la modale de garde).

## 🟠 MOYENNE probabilité

13. ✅ **FAIT (2026-07-08, Vague 5)** — Successions/repos avancés : 3 briques
    famille `sequence` de bout en bout — `succession_interdite` (pas de garde B
    le lendemain d'une garde A), `serie_max` (stretch borné, WE = 2 jours),
    `repos_apres_serie` (M jours de repos après N jours d'affilée). « Repos
    minimum consécutif » non dupliqué : équivalent `espacement_min` (écart N+1),
    documenté côté IA.
14. **Équité inter-annuelle des fêtes** — `historique_fete` (qui a fait Noël
    l'an dernier ?) promis par le doc métier §7, rien ne le porte.
15. ✅ **FAIT (2026-07-08, Vague 6)** — XOR et relations orientées : brique
    `exclusion_dates` « pas les deux » (forme fêtes noel/nouvel_an par année,
    reconduite seule + forme dates ISO libres, jours couverts WE inclus,
    intra-période) ; brique `seulement_avec` conditionnelle ORIENTÉE (« A
    seulement si B sur le même créneau », une ligne sans miroir, pose
    complétante, gardes anti-impasse à la création).
16. **Pénalités R10/R10b/R10c/R8b réglables** — 4 règles souples encore en dur
    (poids 50/30/45/20) : application directe du principe fondateur « aucune
    règle en dur » ; le mécanisme (étage + pénalité) existe déjà.
17. ✅ **FAIT (2026-07-08, Vague 5)** — Lookback inter-périodes :
    `contexteAnterieur` (~10 j de gardes figées) posé sur SolverInput +
    ValidationInput, chargé best-effort par le loader, consommé par les seules
    règles de rythme (R10, R3, espacement_min, espacement_weekend, au_plus_n)
    dans les deux gardiens ; équité/couverture insensibles, byte-identique
    sans donnée.
18. **Multi-propriétaires d'une règle** — `qui.refs[1..n]` tronqués en silence
    (`mapReglesCabinet.ts:253`) : une règle « pour Manon ET Antoine » ne
    s'applique qu'à Manon. Au minimum valider `refs.length === 1` à l'écriture.
19. **`au_plus_n` avec filtre créneaux exposé** — le moteur sait faire « max
    2 week-ends par mois » mais ni le formulaire ni l'IA ne permettent de le
    poser (axe `creneaux` non exposé).
20. ✅ **FAIT (2026-07-08, Vague 5)** — Cadencement fixe « 1 sur N » ancré :
    brique `cadencement_weekend` (n_semaines + ancre samedi + sens
    interdit/impose), cycle calendaire strict sans recalage vacances, phase
    stable inter-périodes par construction ; pré-vol intègre la capacité WE
    réduite du sens `interdit`.
21. ✅ **FAIT (2026-07-08, Vague 6)** — Groupes/cohortes d'équité
    paramétrables : brique `equilibrer` + tag optionnel — chaque règle taguée
    = entrée de score indépendante (dimension × cohorte × importance),
    variance sur les seuls porteurs ; partition explicite (2 cohortes +
    dimension globale sur Ignorée) ; UI + IA + pré-vol sans-porteur.
    `grands_weekend` global garde son défaut salariés (byte-identique).
    Limites assumées : tags lus live au replay ; cohorte sur grands_weekend
    ne voit que les salariés porteurs (compteur inchangé).
22. ✅ **FAIT (2026-07-07, Vague 4)** — Rôle selon attribut : brique globale
    `role_interdit_tag` (« un junior jamais 1er »), dur/mou, ciblage créneaux,
    rôle choisi parmi ceux du catalogue du cabinet.
23. **Pré-vol de cohérence des règles** — détecter AVANT génération les paires
    de règles dures arithmétiquement contradictoires et les règles pointant un
    véto sorti ; le diagnostic d'impasse est bon mais réactif.
24. **Souhaits de congé signalés à la génération** — le gate de publication les
    signale désormais (fait 2026-07-03), mais un avertissement dès l'écran de
    GÉNÉRATION (« X demandes en attente sur cette période ») serait plus tôt
    dans le parcours.

## 🟢 BASSE probabilité (V3 assumées)

25. Mutualisation inter-cabinets / pool de garde partagé (`groupement_id`).
26. Multi-site géographique.
27. Grille 24/7 à relais (au-delà des gardes de nuit/week-end).
28. Calendriers religieux mobiles / événements métier custom (poulinage,
    prophylaxie).
29. Dimension coût/budget (CCN 2564) et pondération de pénibilité (équité en
    poids plutôt qu'en comptage).
30. Patterns cycliques nommés (Panama…).

## 📌 Dettes techniques notées (pas des features)

- **Vendredi soir détruit/re-synthétisé en aval** : la vue/PDF/agenda
  reconstruisent le vendredi en présumant R8/R9 fermes. À trancher AVANT
  d'ouvrir le réglage R8/R9 aux cabinets : persister le vendredi réel (via
  `garde_placements`) ou verrouiller l'UI de réglage.
- ~~**`garde_placements` sans lecteur** (places 3+ perdues à toute édition)~~ —
  **traité le 2026-07-29** (`5fba4cb`) pour la LECTURE : la vue expose
  `places_sup`, et grille / modale / PDF / agenda / compteurs les consomment
  via `src/lib/gardes/places.ts`. Restent l'ÉCRITURE manuelle (point 13) et
  `attributions` V2, toujours écrite mais jamais relue ni mise à jour par
  l'édition manuelle/crise → données fausses garanties au futur cutover V2.
- **Backtracking du seed sans plafond de nœuds** (pire cas infaisable vicieux
  non borné sous le maxDuration serverless).
- **Régénération aveugle aux verrous** : les gardes verrouillées sont exclues
  de l'insert mais le solver planifie sans les connaître → violations
  possibles autour des verrous (le gate de publication les détecte désormais).
- **Threading P4 incomplet** : `crise/reparer.ts` classe toujours avec le rôle
  avantage financier par défaut.
- **Fallback vacances scolaires** en dur expire au 31/08/2027 (silencieux).
- **Cluster dormant** `creneaux_cabinet`/`StructureCreneauxClient` +
  composant orphelin `GenerateurPlanning.tsx` : à supprimer.
- **UX restant de l'audit** (hors refonte finale) : modales maison période/
  profil (perte de saisie au clic extérieur), `confirm()` natif suppression de
  profil, export PDF sans feedback, terminologie « Structure » surchargée,
  4 variantes de `StatutBadge`, `DayCell` non accessible clavier, page /regles
  très dense (sections repliables).

---

## Écran « Mon compte » — à créer (ajouté le 2026-08-14)

Aucun écran de profil n'existe aujourd'hui, ni pour un admin ni pour un véto.
Constaté à l'audit Réglages du 2026-08-14 : un vétérinaire ne peut **rien**
modifier le concernant — ni son e-mail, ni son téléphone, ni sa couleur. En
base, aucune policy `UPDATE` ne l'y autorise (`vet_read_all` est en SELECT
seul), donc même une Server Action écrite naïvement écrirait zéro ligne en
silence.

Ce que cet écran doit porter :

- **Changer son adresse e-mail soi-même** (demande MiKL, 2026-08-14).
  ⚠️ Deux e-mails coexistent : `auth.users.email` (identifiant de connexion) et
  `veterinaires.email` (destinataire des envois + clé de rapprochement à
  l'invitation). Passer par `supabase.auth.updateUser({ email })` — qui envoie
  un lien de confirmation — et n'aligner `veterinaires.email` qu'une fois la
  confirmation revenue. Le plus robuste : une **réconciliation au login**
  (`auth.users` = source de vérité, `veterinaires.email` = miroir).
- **Saisir son adresse postale** (demande MiKL, 2026-08-14 : « faudra prévoir
  la fonction rentrer l'adresse dans mon compte quand on s'occupera de cette
  partie-là »). Distincte de l'adresse du CABINET, qui vit dans Réglages et
  pilote la zone scolaire + la région des jours fériés du moteur.
- Changer son mot de passe depuis l'application (aujourd'hui : uniquement via
  « mot de passe oublié » sur `/login`).
- Préférences de notification par véto (qui reçoit quoi).

**🐛 Bug déjà présent, à corriger avec ce chantier** : `updateVeterinaire`
(`(protected)/admin/veterinaires/actions.ts:132-145`) écrit `veterinaires.email`
sans jamais toucher `auth.users`. Si l'admin corrige l'e-mail d'un véto déjà
invité, le toast annonce « Fiche mise à jour » mais ce véto continue de se
connecter avec son ANCIEN e-mail pendant que ses notifications partent au
NOUVEAU — et la ré-invitation ne le retrouve plus (le rapprochement se fait par
e-mail). La réconciliation au login décrite ci-dessus répare aussi ce cas.

**Écriture : par RPC `SECURITY DEFINER`, pas par une policy `UPDATE`.** La RLS
ne sait pas restreindre par colonne : une policy « le véto met à jour sa ligne »
le laisserait aussi se passer `role_app = 'admin'`.

⚠️ Chantier sur le chemin d'authentification : tests E2E obligatoires avant
merge, jamais à la veille d'une démonstration.

---

## Import d'un ancien planning — 4 défauts relevés à la recette (2026-08-14)

Relevés en testant la chaîne d'import (`lirePlanningImporte.ts`,
`import-actions.ts`, `ImportPlanning.tsx`) sur la vraie base et sur des
documents fabriqués. **Aucun n'a été corrigé** — la recette se tenait la veille
d'une démonstration.

### 1. 🔴 Un vétérinaire absent d'un planning sort du calcul d'équité

**Symptôme.** On importe un ancien planning où quelqu'un ne figure pas — parce
qu'il rentrait de congé maternité, parce qu'il venait d'arriver, ou simplement
parce que l'import ne couvre qu'une partie de l'équipe. Cette personne n'a
aucune ligne de rattrapage d'équité, et **les écarts de tous les autres sont
faussés en même temps**. Rien ne le signale : l'import s'annonce réussi, le
panneau affiche « Import enregistré », les compteurs paraissent justes.

Constaté en test : 8 gardes importées sur 7 vétérinaires actifs, dont un sans
aucune garde → **6 lignes `bonus_malus` écrites au lieu de 7**, et `bilanEcrit`
à `true` — donc aucun avertissement.

**Cause — deux étages, et c'est le second qui fait le plus de dégâts.**

1. La vue `compteurs_gardes` se termine par
   `WHERE v.actif = true AND (v.id = g.premier_id OR v.id = g.second_id)`.
   Un vétérinaire sans garde sur la période **n'a pas de ligne du tout** : il
   n'est pas à zéro, il n'existe pas.
2. `calculerBilans` (`src/engine/bilan.ts`) fait `const n = compteurs.length`
   et divise par ce `n`. Il divise donc **par le nombre de lignes reçues, pas
   par le nombre de vétérinaires du cabinet**. Sur l'exemple ci-dessus la
   moyenne week-end vaut **1,33 au lieu de 1,14** : l'écart de *tout le monde*
   est surévalué, pas seulement celui de l'absent.

**Le panneau promet pourtant l'inverse.** `ImportPlanning.tsx` affiche « La
prochaine génération rattraperait le retard et l'avance de chacun » et, sur le
reçu, « Le retard et l'avance de chacun sont repris ». C'est vrai pour ceux qui
figurent au planning, **faux pour les autres** — et c'est exactement la raison
d'être de la fonctionnalité.

**⚠️ Ce sont deux problèmes distincts, qu'il ne faut pas confondre** — ils ont
la même origine mais pas le même correctif, ni la même urgence.

**(a) L'AFFICHAGE : le véto disparaît du tableau.** `CompteursPanel` itère les
lignes de compteurs ; un vétérinaire sans ligne n'est pas rendu du tout. Sur
l'écran Compteurs et sur l'encart du Planning, le tableau montre 6 personnes
au lieu de 7, sans rien dire. C'est visible immédiatement, y compris par la
personne concernée.

**(b) L'ÉQUITÉ : le dénominateur est faux.** `calculerBilans` divise par le
nombre de lignes reçues, donc par le nombre de participants, pas par
l'effectif. Invisible, et durable puisque `bonus_malus` est relu par le moteur.

**Le correctif de (a) est petit et sans risque** — c'est celui qui a été
préparé le 2026-08-14 (non posé, en attente d'arbitrage) : compléter la liste
**d'affichage** avec les vétérinaires actifs manquants **après** l'appel à
`calculerBilans`, via `completerCompteursPourAffichage` dans
`src/hooks/useCompteurs.ts`. La quote-part reste calculée sur les seuls
participants — aucun écart affiché ne bouge — et la colonne « écart » des
lignes rajoutées affiche « hors répartition », ce que `CompteursPanel` sait
déjà faire (`horsRepartition={bilan === undefined}`).

**Ne PAS élargir les requêtes de lecture pour régler (a).** C'est le piège :
`queryCompteurs` et `queryCompteursPlage` excluent toutes deux les vétérinaires
sans garde, **délibérément et de façon cohérente** — `queryCompteursPlage`
initialise bien une ligne à zéro par vétérinaire actif, mais **la refiltre à la
fin** (`filter((r) => r.total_gardes > 0)`, avec le commentaire « cohérent avec
la vue »). Les élargir toucherait **7 appelants**, dont les **3 qui écrivent
`bonus_malus`** (import, `api/cron/lock-gardes`, `lib/gardes/appliquer-changement`),
et **casserait deux garde-fous** : `cron/lock-gardes` teste
`if (compteurs.length === 0) continue` et `appliquer-changement` teste
`else if (compteurs.length > 0)` pour décider s'il y a un bilan à écrire. Avec
des lignes à zéro, `compteurs.length` ne vaut plus jamais 0 : les deux gardes
deviennent mortes et une période verrouillée sans garde écrirait un jeu complet
de bilans à zéro.

**Le correctif de (b) demande d'abord une décision produit, pas du code :
un vétérinaire `dernier_recours` doit-il compter dans le dénominateur
d'équité ?** Aujourd'hui il en est exclu **par accident** (parce qu'il n'a pas
de gardes), pas par choix. Les deux populations que le code confond :

- un `dernier_recours` à 0 garde → **doit** rester hors du dénominateur ; son
  rôle est de ne pas servir tant que tout va bien. L'afficher à zéro avec
  « hors répartition » est la bonne réponse, et c'est ce que fait (a).
- un vétérinaire ordinaire à 0 garde (retour de congé maternité, arrivée en
  cours de période) → **doit** entrer dans le dénominateur et recevoir une
  ligne de dette, sinon il ne rattrapera jamais.

Tant que ce point n'est pas tranché, élargir le dénominateur changerait les
écarts de toute l'équipe sur un jugement que personne n'a pris.
`calculerBilans` n'a d'ailleurs pas de bug en soi : c'est une fonction pure qui
divise correctement par ce qu'on lui donne. Le jour où (b) sera traité, la voie
propre est de lui passer **l'effectif concerné** en plus des compteurs, plutôt
que de déduire le dénominateur de la longueur d'une liste construite pour
l'affichage.

> ⚠️ **Le correctif d'affichage (a) NE RÈGLE PAS (b), et c'est volontaire.**
> Après (a), le tableau montre bien tout le monde — mais un vétérinaire à zéro
> garde n'a toujours aucune ligne dans `bonus_malus`, et la quote-part des
> autres est toujours calculée sur les seuls participants. Le cas qui coûtera
> cher un jour : **un vétérinaire ordinaire qui rentre de congé maternité**. Il
> apparaîtra à zéro à l'écran (donc plus personne ne signalera d'anomalie), et
> le moteur continuera de l'ignorer au rattrapage. **(a) rend le symptôme
> invisible sans traiter la cause** — raison de plus pour garder cette entrée
> ouverte, et pour ne pas la refermer en voyant le tableau redevenu complet.

### 2. 🔴 La limite de taille réelle est ~3 Mo, pas les 12 Mo annoncés

**Symptôme.** Une vétérinaire dépose la photo de son planning prise au
téléphone, ou un PDF scanné par le photocopieur du cabinet. Au lieu du message
soigné du produit, elle reçoit une erreur technique brute (« Failed to fetch »
ou une erreur interne Next), sans rien qui lui dise quoi faire.

**Cause.** Le fichier transite par une Server Action, donc par une fonction
serverless Vercel. **Vercel plafonne le corps d'une requête à 4,5 Mo**
(documentation « Vercel Functions Limits », section *Request body size*, régime
Fluid compute) et renvoie une erreur `413 FUNCTION_PAYLOAD_TOO_LARGE`. Le
plafond est le même sur tous les plans : passer en Pro ne débloque rien.

Trois conséquences en chaîne :

- Le fichier est encodé en base64 avant l'envoi : **4 octets transmis pour
  3 octets de fichier**, soit +33 %. `4 500 000 × 3/4 = 3 375 000` →
  **le seuil réel est d'environ 3,3 Mo de fichier source. Retenir 3 Mo.**
- **`bodySizeLimit: '16mb'` dans `next.config.ts` n'y change rien.** Ce réglage
  lève le plafond *interne* à Next.js (1 Mo par défaut) — il agit *dans* la
  fonction. Le plafond Vercel agit *avant* elle, au niveau de la plateforme, et
  n'est pas relevable depuis le code. Le commentaire du fichier est lucide sur
  la limite Next mais ignore celle de la plateforme.
- **Le message français du produit n'est jamais atteint.** Le contrôle de
  `TAILLE_MAX_OCTETS` vit dans `lireDocumentPlanning`, donc *après* le point de
  rupture. Côté navigateur, l'échec tombe dans le `catch` générique de
  `deposerDocument` (`FilouChat.tsx`) qui affiche le message brut de
  l'exception.

**Zone de danger.** CSV, TXT, capture d'écran et PDF exporté d'un tableur : sans
risque (< 1 Mo). **Photo de téléphone (2–5 Mo) et PDF scanné (2–10 Mo) : au
cœur de la zone qui casse.** Ce sont précisément les deux formes qu'un cabinet
apportera spontanément.

**Correctif minimal — une ligne, à faire de toute façon.** Descendre
`TAILLE_MAX_OCTETS` de `12 * 1024 * 1024` à `3 * 1024 * 1024`
(`src/lib/ia/lirePlanningImporte.ts`). Ça ne fait pas passer un fichier de plus,
mais ça transforme une erreur de plateforme illisible en **la phrase française
déjà écrite**, qui dit quoi faire (« refais la photo en qualité normale, ou
découpe le PDF »). Le message annoncera alors 3 Mo, ce qui sera la vérité.

**Correctif réel — réduire l'image dans le navigateur avant l'envoi.** Faisable,
mais huit points à ne pas rater :

1. **Ça ne couvre pas le PDF.** Un PDF ne se redimensionne pas sur un canvas —
   et c'est justement le format le plus lourd. Le traiter supposerait de le
   rendre via pdf.js puis de le ré-encoder en image, ce qui ferait perdre le
   texte natif que le modèle lit bien mieux qu'une image. **Prévoir de toute
   façon un message honnête pour les PDF lourds.**
2. **Viser 2576 px sur le grand côté, pas 2000 px de large.** Le modèle lit en
   haute résolution jusqu'à 2576 px sur le grand côté ; en dessous, on jette de
   la finesse exploitable — et c'est sur les grilles denses qu'on en a besoin.
   Raisonner sur le *grand côté* et non la largeur : un planning mural est en
   paysage, un planning en liste est en portrait. Au-delà de 2576 px, on
   transmet des octets pour rien.
3. **L'orientation EXIF.** Une photo de téléphone porte une balise
   d'orientation. Les navigateurs l'appliquent sur une balise `<img>`, mais
   `createImageBitmap(blob)` **l'ignore** sauf à passer
   `{ imageOrientation: 'from-image' }`. S'en dispenser livre un planning
   couché. À tester sur une vraie photo de téléphone : un fichier généré n'a pas
   d'EXIF et ne révélerait pas le bug.
4. **Ne pas ré-encoder les PNG en JPEG.** Une capture d'écran de tableur passée
   en JPEG donne des contours baveux — exactement ce qui fait rater une lecture
   de chiffres. Règle : photo → JPEG qualité 0,85 ; capture d'écran ou export →
   garder le PNG, redimensionnement seul.
5. **GIF animé** : le canvas ne garde que la première image. Sans conséquence
   pour un planning, mais `image/gif` est dans les formats acceptés.
6. **Mémoire sur mobile.** Une photo de 48 Mpx décodée en canvas occupe ~190 Mo
   de RAM ; sur un téléphone d'entrée de gamme l'onglet peut être tué. Passer
   par `createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality:
   'high', imageOrientation: 'from-image' })`, qui décode **et** redimensionne
   en une passe sans matérialiser l'image pleine taille. Pas `new Image()` +
   canvas.
7. **Ne déclencher qu'au-delà du seuil.** Un CSV de 268 octets ou un PNG de
   13 Ko ne doivent pas être touchés : on dégraderait gratuitement ce qui
   passait très bien.
8. **Aligner le message.** Continuer d'annoncer « au-delà de 12 Mo » après
   coup entretiendrait la confusion.

**À vérifier en 2 minutes avant tout développement** : déposer une image
d'environ 5 Mo sur le déploiement. Si le message affiché est la phrase française
du produit, le plafond ne s'applique pas comme décrit ici et tout ce point
tombe. Si c'est une erreur technique, il est confirmé.

### 3. 🟠 `DEV_BYPASS_AUTH` est cassé depuis le rapatriement sur la base MPP

**Symptôme.** « Jamais rendu en local, pas de bypass auth » traîne dans les
notes du projet depuis des semaines, traité comme une fatalité — d'où des écrans
entiers poussés en production sans avoir jamais été vus tourner
(cf. la recette de `/regles` V2). En pratique : on pose `DEV_BYPASS_AUTH=true`
dans `.env.local`, on lance `npm run dev`, et l'application se comporte comme si
personne n'était connecté.

**Cause racine.** `src/lib/supabase/server.ts` code en dur
`DEV_USER_ID = '649a9035-5c29-4b47-8dcc-f8fb8e0ff4a6'`, avec le commentaire
« user_id lié à Anne-Sophie (admin) ». **Cet identifiant n'existe dans aucune
ligne `veterinaires` de la base actuelle** (`mpvrok…`) — vérifié par requête
directe : zéro résultat. C'est un vestige de l'ancienne base, d'avant le
rapatriement du SaaS sur la base MPP.

Le bypass fabrique donc bien un client service-role et un `getUser()` mocké,
mais sur un utilisateur fantôme. Toute la couche applicative fait ensuite
`select … from veterinaires where user_id = <fantôme>` et récupère `null` : plus
de profil, plus de rôle, plus de `cabinet_id`. **Et ça échoue en silence**, en
se présentant comme « non authentifié » — d'où le diagnostic erroné qui a duré
des semaines.

**Correctif — dans cet ordre de préférence :**

1. **Résoudre l'identifiant depuis la base au lieu de le coder en dur.** Au
   démarrage du bypass, lire le premier `veterinaires.user_id` non nul dont
   `role_app = 'admin'` pour le cabinet visé. Le bypass survit alors à tout
   changement de base, y compris à un futur passage sur la base d'un client.
2. **À défaut : rendre l'identifiant configurable** par une variable
   `DEV_BYPASS_USER_ID` dans `.env.local`, avec la valeur en dur comme repli.
3. **Dans tous les cas : échouer bruyamment.** Si le `user_id` du bypass ne
   correspond à aucune ligne `veterinaires`, lever une erreur explicite
   (« DEV_BYPASS_AUTH : l'utilisateur X n'existe pas dans cette base ») plutôt
   que de laisser l'application se dégrader en « non authentifié ». C'est le
   point qui aurait fait gagner des semaines : le mode dégradé silencieux a
   coûté plus cher que la panne elle-même.

**Gain attendu** : pouvoir à nouveau recetter en local avant de pousser. La
mémoire du projet porte plusieurs écrans « livrés mais non recettés » dont c'est
la cause directe.

### 4. 🟡 `max_tokens: 8000` partagé entre la réflexion et la restitution

**Symptôme.** Sur un document long — un planning couvrant une année entière, ou
une grille très dense — la lecture échoue avec « Ce que j'ai lu n'était pas
exploitable. Réessaie ? ». **Le second essai échoue exactement pareil**, sans
que rien n'explique pourquoi. Sur un document court, tout va bien.

**Cause.** L'appel de `lirePlanningDepuisFichier` demande `max_tokens: 8000`
avec `thinking: { type: 'adaptive' }`. Ce plafond couvre **la réflexion ET la
sortie**, pas seulement la sortie. À environ 30 tokens par garde restituée, une
période de 12 à 17 semaines passe confortablement ; un planning annuel
(300+ lignes) peut saturer le budget. La réponse est alors tronquée en cours de
route, le bloc d'outil arrive incomplet, `ParamsRestituer.safeParse` échoue, et
le code retourne son message générique.

**Le code ne lit pas `stop_reason`.** L'API signale pourtant explicitement une
troncature (`stop_reason: 'max_tokens'`), ce qui permettrait de distinguer « le
document est trop long » d'une vraie réponse illisible.

**Correctif :**

- **Lire `stop_reason`** et rendre un message qui dit la vraie raison : « Ce
  planning est trop long pour être lu d'un coup — découpe-le en deux périodes. »
  Un message qui oriente vaut mieux qu'un « Réessaie ? » qui envoie dans le mur.
- **Relever `max_tokens`** (le modèle en tolère bien davantage), en gardant à
  l'esprit que ça allonge l'attente devant l'écran.
- En attendant : **une période à la fois, pas une année**.

### 5. 💣 Mine — deux garde-fous qui encodent une règle métier dans une longueur

**Pas un bug aujourd'hui. Une mine amorcée**, du même genre que celles trouvées
dans l'écran Règles : le code est correct, mais il le restera pour une raison
qui n'est écrite nulle part et qui finira par disparaître.

**Les deux endroits :**

- `src/app/api/cron/lock-gardes/route.ts` — `if (compteurs.length === 0) continue`
- `src/lib/gardes/appliquer-changement.ts` — `else if (compteurs.length > 0)`

**Ce qu'ils veulent dire** : « cette période ne contient aucune garde, il n'y a
pas de bilan à écrire ». **Ce qu'ils testent réellement** : la longueur d'une
liste. Les deux coïncident uniquement parce que la vue `compteurs_gardes`
n'émet aucune ligne pour un vétérinaire sans garde — c'est-à-dire à cause d'une
**propriété de forme** de la requête, pas d'une règle métier énoncée quelque
part.

**Le jour où ça pète.** Quelqu'un complétera un jour la liste des vétérinaires
— pour régler le point 1(b) ci-dessus, ou simplement parce que « c'est plus
logique que tout le monde y soit ». Ce jour-là, `compteurs.length` ne vaudra
plus jamais 0 : il vaudra toujours au moins l'effectif actif. **Les deux gardes
deviendront muettes sans que rien ne le signale**, et une période verrouillée
sans aucune garde se mettra à écrire un jeu complet de bilans à zéro dans
`bonus_malus` — que le moteur relira. Le tout sur un cron qui tourne la nuit,
sans personne devant l'écran.

**Correctif (quand on y touchera, pas avant) :** tester la chose qu'on veut
vraiment savoir, pas son ombre. Deux voies possibles :

- `if (totalGardes === 0)` à partir d'un `count` explicite sur `gardes` pour la
  période — c'est la question posée, formulée telle quelle ;
- ou `if (compteurs.every((c) => c.total_gardes === 0))`, qui reste juste que la
  liste soit complétée ou non.

**Le vrai correctif, à défaut de tout réécrire ce soir : écrire l'invariant
au-dessus des deux lignes.** Une phrase qui dit « ceci suppose que la vue
n'émet aucune ligne pour un véto sans garde » transformerait une mine en piège
visible — c'est ce qui manque, plus que le code lui-même.

---

*Généré le 2026-07-03 à partir de l'audit 360° (6 agents Fable). Source de
vérité des arbitrages : MiKL.*
*Complété le 2026-08-14 (audit Réglages, veille de la séance VetdAllier).*
*Complété le 2026-08-14 (recette de l'import d'un ancien planning : équité des
absents, limite de taille réelle, cause racine du bypass auth, plafond de
tokens, mine des garde-fous `compteurs.length`).*
