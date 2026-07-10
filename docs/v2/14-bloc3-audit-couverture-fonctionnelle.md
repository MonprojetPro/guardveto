# Bloc 3 — Audit de couverture fonctionnelle : l'existant face à la nouvelle UX

> Produit le 2026-07-10 à la demande de MiKL (« il manque des fonctionnalités,
> profitez-en pour faire un audit et on verra comment on procédera pour les
> intégrer dans l'UX »).
> Sources : 3 inventaires exhaustifs du code (admin / véto + transverse /
> surface de configuration, agents Fable), vision UX (doc 13), audit UX
> (doc 12), labo design v3 (`labo-design-guardveto.html`), retours MiKL du
> 2026-07-10 (7 points).
> But : garantir la **non-perte fonctionnelle** — chaque capacité existante
> doit avoir une maison dans la nouvelle UX, ou être écartée EXPLICITEMENT.

---

## 1. Les « maisons » de la nouvelle UX (rappel du cadre)

Navigation regroupée cible (~6 entrées) + Filou selon ses 3 niveaux de présence :

| Maison | Contenu | Présence de Filou |
|---|---|---|
| **Accueil jour-1** | roue orbitale seule au départ ; clic sur une part → pop-up entretien (Filou + tableau des validations) ; disparaît après les 4 étapes | pleine lumière |
| **Planning** | grille + actions manuelles + caractéristiques de période + volet compteurs + génération/publication | terrier + garde-fou |
| **Absences & échanges** | congés (véto + admin), échanges (cycle complet), crise/absences, dépannages | terrier |
| **Équipe** | fiches vétos, tags, invitations, activation | terrier |
| **Règles du cabinet** | encarts par règle (icônes + réglette + bouton Filou), onglets par catégorie, vue « tout ce qui est défini » | premier plan d'office |
| **Historique & compteurs** | périodes passées, compteurs cumulés, tri par période, plage libre | terrier |
| **Réglages** (dont « Connexions ») | structure/profils/créneaux, Google Agenda, Brevo, adresse/zones | terrier |

## 2. Verdict global

L'existant représente **11 écrans admin + 7 écrans véto + ~15 systèmes
transverses**. Le labo v3 couvre le CŒUR du nouveau parcours (accueil,
planning-brouillon + garde-fou, règles, historique, création de période) mais
**6 blocs fonctionnels entiers n'ont pas encore de maquette**, et l'audit a
révélé **12 dettes/incohérences** dont 2 bombes multi-cabinet.

## 3. Tableau de couverture — bloc par bloc

Statuts : ✅ couvert par le labo v3 · 🟡 à intégrer (destination claire, à
maquetter) · 🔴 trou de conception (à réfléchir avant de maquetter).

### 3.1 Planning (vie courante)

| Capacité existante | Nouvelle UX | Statut |
|---|---|---|
| Vue mensuelle, nav mois, liste mobile, légende, fériés/week-ends | Planning (grille conservée) | 🟡 le labo montre une grille simplifiée |
| Sélecteur de période de travail + badge statut | Bandeau « caractéristiques de la période » (retour MiKL n°1 : dates, saison, profil, effectif, statut) | 🟡 |
| **Générer** (+ confirmation de régénération d'une période publiée) | Planning — bouton visible + récap avant génération (labo) ; la confirmation de régénération reste un gate | 🟡 gate à maquetter |
| **Publier** (2 gates : conséquences + réserves re-validées) | Planning — moment de vérité ; Filou peut PORTER le gate des réserves (il explique les réserves au lieu d'une liste brute) | 🟡 à maquetter |
| Pré-vol (11 codes d'avertissement) | Fusionné dans le récap avant génération, voix Filou | ✅ principe / 🟡 contenu réel |
| Diagnostic d'impasse (suggestions vérifiées, « Assouplir cette règle ») | Filou « explique » (mouvement 1) — il pilote la sortie d'impasse ; le deep-link `?focus=` reste l'ancrage technique | 🟡 scène à maquetter |
| Re-validation continue du publié (bandeau temps réel) | C'EST le garde-fou Filou du labo (déjà démontré) — à étendre au publié | ✅ |
| Créneaux du catalogue ignorés (alerte post-génération) | Voix Filou après génération | 🟡 |
| Rappel de publication (bandeau <15 j) | Notification + Filou qui le mentionne | 🟡 |
| Modale garde : réattribuer 1er/2nd avec dispos calculées (vert/ambre/rouge + raisons), ViolationDialog, garde-fou serveur 409, correction d'une garde verrouillée, « déclarer absent·e » | Le menu contextuel du labo est la V0 de cette modale — il faut y remettre : choix du rôle (1er/2nd), raisons d'indispo, verrouillage/correction, déclarer absent | 🟡 |
| CriseModal 2 étapes (absence → réparation créneau par créneau, recommandé équitable, appel aux volontaires, compensations, « N prêts / M non résolus ») | 🔴 **trou majeur** — parcours complet à concevoir ; candidat idéal pour être MENÉ PAR FILOU (c'est déjà une conversation : « Manon est malade du 12 au 15 » → il propose les réparations) | 🔴 |
| Export PDF | Bouton sobre sur Planning | 🟡 |
| Verrouillage nocturne gardes/périodes (cron) | Invisible, mais les états « verrouillé » doivent se voir dans la nouvelle grille | 🟡 |

### 3.2 Absences & échanges (aucune maquette à ce jour)

| Capacité | Nouvelle UX | Statut |
|---|---|---|
| Véto : poser congé (5 types, multi-jours découpés, indispo 1 jour + créneau), modifier tant que souhait, supprimer avec confirmation, statuts + motif de refus | Absences & échanges — parcours véto MOBILE-FIRST (acte 3) | 🔴 à maquetter |
| Admin : valider (dates ajustables), refuser avec motif, créer congé direct, cas « Antoine » (conflit publié → CriseModal), badges de conflit, filtres, résumé par véto | Absences & échanges (vue admin) ; « demandes » et « congés » FUSIONNENT (doublon actuel /conges + /admin/demandes = une seule porte) | 🔴 à maquetter |
| Échanges : proposer (ciblé/ouvert, contrepartie), accepter, décliner+motif, annuler, valider admin, 6 statuts, badges nav, verrous anti-course | Absences & échanges ; le badge nav reste ; entrée depuis le planning conservée (`?proposer=`) | 🔴 à maquetter |
| Dépannages/compensations (dettes de crise, statuts) | Absences & échanges (sous-onglet admin) ou Historique | 🔴 décider la maison |

### 3.3 Règles (le labo v3 pose le décor, l'audit donne le contenu réel)

| Capacité | Nouvelle UX | Statut |
|---|---|---|
| 26 briques (17 par-véto + équipe/tags + globales), paramètres bornés serveur | Encarts par règle (retour n°4) — l'encart doit rendre TOUS les params de la brique | 🟡 |
| DEUX échelles : force (4 niveaux) vs importance équité (5 crans) | La **réglette** (retour n°4) doit présenter UNE grammaire (ex. obligatoire / important / si possible) qui pilote les 2 échelles selon la famille — le moteur garde sa granularité | 🔴 conception fine |
| Groupement actuel par force (🔴🟠🟡) | **Onglets par catégorie** (retour n°5) — proposition : Repos & jours · Week-ends · Charge & rythme · Duos & équipe · Préférences · Équité | 🟡 |
| Créer/éditer (formulaire guidé), activer/désactiver, supprimer, anti-doublon | Icônes de l'encart + création par Filou (niveau 2 : il est là d'office) ; formulaire guidé → « réglages avancés » | ✅ principe / 🟡 détails |
| Validité par période (règles par-véto seulement) | À montrer sur l'encart (badge) ; asymétrie avec les globales à assumer | 🟡 |
| Assistant IA règle (19 types, propose→valide) | DEVIENT Filou (fusion des 3 assistants) | ✅ |
| Interroger sur les conflits (retour n°6 : « si je change ça, conflit avec quoi ? ») | Bouton Filou par encart → capacité NOUVELLE (le moteur a le replay/diagnostic pour l'alimenter) | 🔴 nouvelle capacité à spécifier |
| Réglages du planning (6 dimensions d'équité × 5 crans, cohortes par tag, R8/R9, 4 pénalités souples, R11b avantage financier) | Onglet « Équité » + onglet « Week-ends » du nouvel écran Règles | 🟡 |
| Composition d'équipe par tag (3 formes) | Onglet « Duos & équipe » | 🟡 |
| Deep-link `?focus=` (diagnostic → règle) | À CONSERVER (ancrage des explications de Filou) | 🟡 |
| Contraintes legacy fiches vétos (4 types, doublon sans force/période) | RÉSORPTION (mouvement 3) — migration vers /regles + rebrancher `/api/gardes/[id]/disponibilites` sur `regles_cabinet` (il lit ENCORE le legacy) | 🔴 chantier dev |
| Vue « tout ce qui est défini » (par véto / par thème) | Prévue dans la vision, PAS encore dans le labo | 🟡 |

### 3.4 Historique & compteurs

| Capacité | Nouvelle UX | Statut |
|---|---|---|
| 4 tableaux (WE, semaine 1er/2nd, fériés, grands WE) + écarts colorés + ligne « moi » surlignée | Onglet Historique (labo v3 = V0) + volet Planning | ✅ principe |
| **Sélecteur de période + PLAGE DE DATES LIBRE + périmètre tout/validé** | Retour MiKL n°7 : EXISTE DÉJÀ dans /compteurs — à reprendre tel quel dans l'onglet Historique | 🟡 reprendre |
| Volet compteurs du planning : colonnes EXTENSIBLES (retour n°2) | Confirmé nécessaire : créneaux sur-mesure jusqu'à 4 places/rôles nommés + 6 dimensions d'équité → colonnes dérivées du catalogue du cabinet, pas en dur | 🔴 conception (règle : colonnes = types de créneaux actifs × rôles suivis) |
| Bilan bonus/malus (calcul fin de période, BM hérité, comparaison) | Onglet Historique (admin) | 🟡 |
| Historique des fêtes (qui a tenu Noël/Nouvel An, alimenté auto) | Onglet Historique | 🟡 |

### 3.5 Équipe

| Capacité | Nouvelle UX | Statut |
|---|---|---|
| Fiches (statut, rôle app, couleur, dernier recours, tags ≤10) | Équipe | 🟡 à maquetter |
| Inviter / ré-inviter (+ badges Sans compte / Invitation envoyée) | Équipe — c'est l'étape ④ de l'onboarding jour-1 | 🟡 |
| Désactiver avec garde-fou (gardes publiées à venir listées) | Équipe + voix Filou | 🟡 |
| Contraintes legacy | disparaissent (cf. 3.3) | 🔴 chantier dev |

### 3.6 Réglages & Connexions (la tuyauterie sort du métier)

| Capacité | Nouvelle UX | Statut |
|---|---|---|
| Profils de planning (dupliquer, renommer, saison, effectif, supprimer) + IA profil | Réglages — INVISIBLES tant qu'il n'y a qu'un profil (vision) ; l'IA profil fusionne dans Filou | 🟡 |
| Catalogue créneaux (sur-mesure 1-4 places, activer/désactiver, horaires par profil) | Réglages > Structure des gardes | 🟡 |
| Créneaux liés (2 genres) + IA relation ; niveau réglé sur /regles (couplage à réunifier — vision : « une seule porte ») | Fusion dans l'onglet « Week-ends » / structure de l'écran Règles | 🔴 conception |
| Google Calendar ID, Brevo, adresse → zone scolaire/fériés | Écran « Connexions » dédié (vision) | 🟡 |
| Effectif par période (précédence période > profil > saison) | Récap avant génération (labo v3 le montre) + Réglages | ✅ principe |

### 3.7 Transverse

| Capacité | Nouvelle UX | Statut |
|---|---|---|
| Notifs in-app 12 types + cloche Realtime + page historique + badges nav | CONSERVÉS tels quels ; Filou ne remplace pas la cloche (canaux distincts) | 🟡 reprendre |
| E-mails Brevo (8 types) + journal admin | Conservés ; journal → Réglages > Connexions | 🟡 |
| Sync Google Agenda (publication, unitaire, purge, re-sync, anti rate-limit) | Conservée ; état de la sync visible dans Connexions | 🟡 |
| Crons (verrouillage + bonus/malus, rappels J-15/J-7, fériés/vacances) | Invisibles (états visibles là où pertinent) | ✅ |
| Auth (login mdp, reset, invitation → set-password, 2 rôles, RLS) | Conservée ; l'écran login prend l'ambiance Terrier chaleureux | 🟡 |
| Monitoring incidents techniques → cloche admin | Conservé — et Filou peut le RACONTER (« la sync agenda a échoué cette nuit, j'ai réessayé ») | 🟡 |
| Page /crise/volontaire (lien e-mail « je prends ce créneau ») | Conservée, ambiance nouvelle | 🟡 |
| Parcours véto complet (5 entrées nav, mobile) | Acte 3 (mobile-first) — AUCUNE maquette véto à ce jour | 🔴 à maquetter |

## 4. Dettes et incohérences découvertes (hors UX — à corriger en dev)

| # | Découverte | Gravité | Action proposée |
|---|---|---|---|
| D1 | `seulement_avec` créable mais NON éditable (absent de `BRIQUES_EDITABLES`) — oubli Vague 6C | Bug UI | Fix trivial (1 ligne) — dispatch ruflo |
| D2 | Double système vivant : `contraintes_veto` (CRUD sur fiches) non lu par le moteur, MAIS `/api/gardes/[id]/disponibilites` lit ENCORE le legacy → une règle /regles n'influence pas le check de dispo manuel | **Divergence active** | Chantier de résorption (mouvement 3) — rebrancher disponibilites sur `regles_cabinet` en priorité |
| D3 | « Anne-Sophie » codée en dur dans les e-mails congé validé/refusé (`brevo.ts`) | 🔴 bombe multi-cabinet | Fix rapide (nom de l'admin du cabinet) — ruflo |
| D4 | Expéditeur défaut en dur `vetovaldallier@gmail.com` (`brevo.ts:33`) | 🔴 bombe multi-cabinet | Fix rapide — ruflo |
| D5 | E-mails congés NON journalisés dans `email_log` (chemin `sendBrevoEmail` ≠ `sendViaBrevo`) | Trou de traçabilité | Fix rapide — ruflo |
| D6 | PDF : fériés métropole en dur malgré le référentiel multi-région | Incohérence | Fix — ruflo |
| D7 | Aucune notification à l'admin quand un véto POSE un souhait de congé (badge SSR seulement) | Trou fonctionnel | Ajouter type notif (rejoint l'audit notifs de fin de dev) |
| D8 | `/api/gardes/[id]/disponibilites` auth-only : un véto peut récupérer les raisons d'indispo de tous | Exposition mineure | Gate admin — ruflo |
| D9 | `POST /api/calendar-sync` : capacité sans bouton UI | Porte manquante | Bouton dans Connexions (nouvelle UX) |
| D10 | `audit_log` alimenté mais aucune UI de consultation | Assumé ? | À décider (journal Filou pourrait l'absorber) |
| D11 | `journee_semaine` (indispo cyclique legacy) sans équivalent dans /regles | Perte à la résorption | Ajouter la période à `alternance_ancre` lors de D2 |
| D12 | Réglages non exposés : lookback 10 j en dur, poids historique fêtes, `sur_feries` des sur-mesure, genre `repos_apres`, niveau par relation individuelle | Backlog assumé | Rester au backlog (doc 10) — ne pas charger la nouvelle UX |

Interdit de ré-exposer : `motif_grand_weekend` (brique interne, anti-coquille-vide documenté).

## 5. Les 7 retours MiKL du 2026-07-10 (labo v3) — état

| # | Retour | Réponse de l'audit |
|---|---|---|
| 1 | Caractéristiques de période sur le planning | Bandeau période véto existe déjà — à enrichir (profil, effectif résolu avec sa provenance, statut) |
| 2 | Volet compteurs extensible | Confirmé indispensable (sur-mesure 4 places/rôles) — colonnes dérivées du catalogue actif du cabinet |
| 3 | Roue seule au départ, pop-up par étape | Pur choix UX — aucune contrainte technique |
| 4-5 | Encarts + réglette + onglets | Faisable ; le point dur = UNE grammaire pour DEUX échelles (force/importance) — conception fine à valider sur maquette |
| 6 | Bouton Filou « conflit avec quoi ? » | Capacité NOUVELLE — le moteur a déjà replay + diagnostic pour l'alimenter ; à spécifier (T4 du découpage dev) |
| 7 | Tri par période + plage libre chevauchante | **Existe déjà** dans /compteurs (mode plage + périmètre) — à reprendre dans l'onglet Historique, rien à inventer |

## 6. Comment procéder (proposition)

Compléter la grande maquette **par tranches**, chacune validée par MiKL avant
la suivante (le labo devient la maquette maîtresse) :

1. **M1 — Planning complet** : caractéristiques de période, volet compteurs
   extensible, génération/publication avec gates portés par Filou, modale de
   garde complète (rôles, dispos, verrouillage), états verrouillé/publié.
2. **M2 — Règles complet** : onglets par catégorie, encarts avec réglette
   (grammaire unique), bouton Filou par règle, vue « tout ce qui est défini »,
   équité + week-ends intégrés (une seule porte).
3. **M3 — Absences & échanges** : congés admin+véto fusionnés, échanges,
   crise menée par Filou, dépannages.
4. **M4 — Accueil retouché** (roue seule + pop-up), Équipe, Historique enrichi
   (bonus/malus, fêtes, plage libre), Connexions.
5. **M5 — Parcours véto mobile-first** (acte 3).

En parallèle (indépendant des maquettes) : corriger les dettes D1, D3, D4,
D5, D8 (fixes rapides ruflo) — D2/D11 (résorption legacy) attendent le
chantier T3 du dev Bloc 3.

Après validation des 5 tranches : découpage dev (doc 13 §5 enrichi de cet
audit).
