# Contre-audit adversarial de Filou — passe 2

> **Date** : 2026-08-21 · **Objet** : mettre en défaut les correctifs du commit `55ea8ab`
> **Méthode** : lecture exhaustive du catalogue (`src/lib/ia/outils/*`), des fichiers appelés
> hors `outils/`, de la boucle (`agentFilou.ts`), de l'action serveur (`filou/actions.ts`),
> **plus vérification en base** des politiques RLS, des propriétaires de vues et des
> définitions de vues. Toute affirmation ci-dessous cite un fichier:ligne ou une requête SQL
> réellement exécutée. Aucun fichier modifié, aucune écriture en base.

---

## Ce qui a été vérifié en base (et qui fonde tout le reste)

| Fait | Preuve |
|---|---|
| `planning_semaine` et `compteurs_gardes` sont des **vues**, propriétaire `postgres`, `reloptions = NULL` (donc **pas** `security_invoker`), **0 politique** | `pg_class` + `pg_policies`, 2026-08-21 |
| **Toutes** les tables métier lues par Filou portent une politique **RESTRICTIVE** `cabinet_id = auth_cabinet_actif()` | `pg_policies`, 20 tables |
| `gardes` → `gardes_veto_read` : `qual = (get_user_role() = 'veto')` — **aucun filtre de publication** | `pg_policies` |
| `absences` → `absences_read_auth` : `qual = true` | `pg_policies` |
| `historique_fete` → `historique_fete_read_auth` (permissive SELECT, `qual = true`) | `pg_policies` |
| `periodes` → `periodes_read_publie` : `statut IN ('publie','verrouille')` — raisonne sur le **statut**, pas sur `publie_at` | `pg_policies` |
| `planning_semaine` **résout déjà** `gardes_exceptions` (`LEFT JOIN ep/es`, le remplaçant sort dans `premier_prenom`) et expose `places_sup`, `jour_exceptionnel`, `exception_premier`, `exception_second`, `compte_1er_we` | `pg_get_viewdef` |
| `compteurs_gardes` expose `jours_1er_we_exceptionnels` et `jours_exceptionnels_pris` | `information_schema.columns` |

**Le contexte n'est pas falsifiable depuis le client.** `contexte()`
(`src/app/(protected)/filou/actions.ts:50-79`) part de `supabase.auth.getUser()`, lit
`role_app` par `user_id`, et dérive `cabinetId` via `resoudreCabinetId()`
(`src/lib/supabase/cabinet.ts`) qui prend `app_metadata.cabinet_id` du JWT — jamais un champ
du client. `appliquerActionFilou` (`actions.ts:170-177`) rejoue `trouverOutil(nom, ctx)` sur
le catalogue **filtré par rôle** (`registre.ts:154`) puis revalide par le schéma Zod. Le
`vetoId`, le `estAdmin` et le `cabinetId` ne sont donc pas attaquables par le navigateur.
**Le prompt système ne contient aucune donnée de cabinet** : `SYSTEM`
(`agentFilou.ts:138-217`) et `SYSTEM_GARDIEN` (`agentFilou.ts:543-558`) sont des constantes ;
le seul ajout dynamique est la date du jour (`actions.ts:143`). *(`chargerContexteIA`
— `contexteCabinet.ts:43` — injecte bien des prénoms et des étiquettes dans un prompt, mais
il sert `proposerRegle` / `proposerProfil`, pas la boucle Filou : vérifié par grep, il
n'apparaît pas dans le chemin `faireTravaillerFilou`.)*

---

## 🔴 FUITES ENCORE OUVERTES

### F1 — `lire_historique_fetes` livre au chat un tableau que l'écran refuse

**Fichier** : `src/lib/ia/outils/compteurs.ts:500-536` — l'outil **n'a pas** `adminSeulement`.
Il appelle `queryHistoriqueFetes(ctx.supabase)` (`src/hooks/useCompteurs.ts:422`), qui lit
`historique_fete` sans aucun filtre de rôle. La politique `historique_fete_read_auth` a
`qual = true` : tout authentifié du cabinet lit tout.

**Or l'écran correspondant est fermé aux vétérinaires** :
`src/app/(v2)/historique/page.tsx:109` → `if (!estAdmin) redirect('/planning')`.

**Scénario** : un vétérinaire écrit « qui a fait Noël l'an dernier ? ». Filou appelle
`lire_historique_fetes` et renvoie l'historique nominatif complet, année par année, rôle
compris. C'est le contenu de `/historique` — exactement ce que la fermeture du 2026-08-21
voulait retirer, et exactement le raisonnement tenu pour `lire_compteurs` dans le même
commit (`compteurs.ts:260-269`), qui n'a pas été appliqué à cet outil-là.

**C'est la cinquième porte du même défaut**, et elle est restée ouverte.

**Correctif** : deux options, selon la décision produit.
- Si l'historique des fêtes est un outil de préparation comme le reste de `/historique` →
  `adminSeulement: true`, une ligne.
- S'il est légitime pour un vétérinaire de savoir à qui c'est le tour → alors c'est l'écran
  qu'il faut rouvrir partiellement, pas Filou qu'il faut laisser en écart. **Ne pas laisser
  les deux diverger** est le point, quel que soit le choix.

---

### F2 — `proposer_echange` sonde le planning NON DIFFUSÉ, garde par garde

**Fichiers** :
- `src/lib/ia/outils/echanges.ts:188-197` — `gardesDuVetoCeJour()` lit la table `gardes` avec
  `.eq('date', date)` et `.or('premier_id.eq.…,second_id.eq.…')`. **Aucune borne de période,
  aucune borne de publication.**
- `src/lib/ia/outils/echanges.ts:375` et `:395` — `resoudreProposition()` l'appelle deux
  fois : sur soi (`ctx.vetoId`), puis **sur un collègue** (`cible.id`).
- `src/lib/ia/outils/echanges.ts:417` — `proposerEchangeOutil` **n'est pas** `adminSeulement`.

**La RLS ne rattrape rien** : `gardes_veto_read` a pour seule condition
`get_user_role() = 'veto'`. Un vétérinaire lit donc **toutes** les gardes de son cabinet,
brouillons compris. Le correctif `perimetre.ts` du commit `55ea8ab` ne couvre pas ce chemin :
il vise les lectures de **vues**, et celle-ci lit la **table**.

**Scénario d'exploitation concret** — un vétérinaire, sur un planning d'hiver encore en
brouillon (donc invisible sur son écran et fermé par `perimetrePeriodes`) :

> « Filou, propose ma garde du 3 mars à Camille, et je reprends la sienne du 12 mars. »

`resoudreGardeDuJour` (`echanges.ts:202-223`) renvoie l'une de ces trois phrases, toutes
formulées à partir de données du planning brouillon :

- `« Camille n'a aucune garde le jeudi 12 mars. »` → **elle n'est pas de garde ce jour-là**
- `« Camille a plusieurs gardes le jeudi 12 mars (Soir de semaine, Week-end). Précise laquelle. »`
  → **elle en a deux, et de quels types**
- la proposition aboutit → **elle est de garde, et à quel rôle** (`decrireGarde`,
  `echanges.ts:437` : date, type de garde, `1er de garde` / `2nd de garde`)

En répétant la question date par date, un vétérinaire **reconstitue le planning non diffusé
de n'importe lequel de ses confrères**. La même mécanique appliquée à `ctx.vetoId`
(`echanges.ts:375`) lui donne ses propres affectations brouillon — « une promesse que
personne ne lui a faite », précisément ce que `perimetre.ts:62-64` dit vouloir empêcher.

**Aggravant** : ce chemin est un `resumer()`, donc il est aussi atteignable par le **second
gardien** (`agentFilou.ts:626`), qui appelle `resumer()` de sa propre initiative sur une
simple interprétation de la conversation — sans que la personne ait explicitement demandé un
échange.

**Correctif** :

```ts
// echanges.ts — gardesDuVetoCeJour()
const perimetre = await perimetrePeriodes(ctx)          // outils/perimetre.ts
if (perimetre.vide) return []
const { data } = await ctx.supabase
  .from('gardes')
  .select('id, type, premier_id, second_id')
  .in('periode_id', perimetre.ids)                       // ← la borne manquante
  .eq('date', date)
  .or(`premier_id.eq.${vetId},second_id.eq.${vetId}`)
```

Vérifier au passage que `gardes` porte bien `periode_id` (c'est le cas : la vue
`planning_semaine` le lit depuis `gardes g`). Un échange sur une garde non diffusée n'a de
toute façon aucun sens métier — on ne cède pas une garde que personne ne connaît encore.

---

### F3 — `lire_absences` donne le motif médical et le commentaire libre à toute l'équipe

**Fichier** : `src/lib/ia/outils/absences.ts:163-197` — **pas** `adminSeulement`, aucun filtre
sur `ctx.vetoId`. La requête (`absences.ts:171-174`) ne pose ni `cabinet_id` ni rôle, et la
politique `absences_read_auth` a `qual = true`. La sortie (`absences.ts:188-195`) renvoie
`motif` et `commentaire` **pour tout le monde**.

**Contradiction interne, prouvée dans le même fichier** : `declarerAbsence` décrit son propre
champ commentaire comme *« Un détail libre, visible par l'administrateur »*
(`absences.ts:322`). L'administratrice l'écrit en croyant cela. `lireAbsences` le distribue à
l'équipe entière.

**Scénario** : un vétérinaire demande « pourquoi Fanny n'est plus sur le planning cette
semaine ? ». Filou répond avec `motif: "maladie"` et le commentaire tel que l'admin l'a
saisi — qui peut contenir n'importe quoi, y compris une précision médicale. C'est une donnée
de santé, et le seul rempart aujourd'hui est ce que l'administratrice a bien voulu ne pas
écrire.

**Correctif minimal, sans fermer l'outil** (savoir qu'un confrère est absent est légitime,
savoir *pourquoi* ne l'est pas) :

```ts
// absences.ts:188 — dans le map de sortie
motif: ctx.estAdmin || l.veterinaire_id === ctx.vetoId ? l.motif : 'absence',
commentaire: ctx.estAdmin || l.veterinaire_id === ctx.vetoId ? l.commentaire : null,
```

Et aligner la description de `declarer_absence` sur ce qui est réellement visible.

---

## ⚠️ CONTOURNEMENTS POSSIBLES

### C1 — Le second gardien double tous les chemins `resumer()`, sans demande explicite

`chercherActionOubliee` (`agentFilou.ts:567-645`) rejoue un appel modèle avec
`tool_choice: { type: 'any' }` (`agentFilou.ts:602`) — **obligation de choisir un outil** —
puis exécute `outil.resumer(valides.data, ctx)` (`agentFilou.ts:626`).

Le périmètre de droits **tient** : `ecritures` est dérivé de `outils`
(`agentFilou.ts:575`), lui-même déjà filtré par `outilsPour(ctx)` (`actions.ts:142`,
`registre.ts:147`). Un non-admin ne peut donc pas déclencher un outil admin par ce chemin.

Ce que ça change quand même : **toute fuite logée dans un `resumer()` devient déclenchable
sans que la personne l'ait demandée**. F2 en est l'illustration — une conversation où un
vétérinaire évoque vaguement un confrère et une date peut faire appeler
`proposerEchangeOutil.resumer` par le gardien, donc faire sonder le planning brouillon, sans
qu'aucune phrase n'ait demandé un échange. Le gardien n'est pas le défaut ; il en multiplie
la surface.

### C2 — Le piège « repart de la liste complète » : recherché partout, un seul cas, bénin

J'ai relu chaque outil de lecture à la recherche du motif exact corrigé dans `lireCompteurs`
(un filtre par nom qui repart de la source non restreinte).

- **`lireCompteurs`** (`compteurs.ts:298`) : corrigé — `lignes = lignes.filter(...)` repart
  bien de `lignes` (déjà restreinte, `compteurs.ts:270-272`), et le refus explicite est posé
  **avant** (`compteurs.ts:291-296`). Vérifié, rien à redire.
- **`lireConges`** (`conges.ts:246`) : le filtre repart de `conges`, mais la RLS de `conges`
  a déjà borné à ses propres lignes pour un non-admin, **et** un refus explicite est posé en
  amont (`conges.ts:239-243`). Correct.
- **`lireEchanges`** (`echanges.ts:307-315`) : les trois groupes repartent de `echanges`, mais
  `chargerEchanges` est borné par `echanges_read_parties` (demandeur / cible / ouverte /
  admin). `a_valider_par_admin` est **absent** et non vide pour un non-admin
  (`echanges.ts:322-324`) — bonne pratique, appliquée.
- **`lireAbsences`** (`absences.ts:181-186`) : le filtre par prénom repart de `lignes`
  complètes — mais ici il n'y a **aucune restriction préalable à préserver** (cf. F3). Le
  motif est présent ; c'est l'absence de restriction en amont qui est le vrai problème.
- **Seul cas assumé** : `lireCompteurs` calcule `calculerBilans(compteurs, totalWE)`
  (`compteurs.ts:307`) sur la liste **complète**, y compris pour un non-admin. C'est
  nécessaire — un écart à la moyenne ne se calcule pas sans la moyenne d'équipe — et rien de
  la liste complète ne ressort : la sortie boucle sur `lignes` (`compteurs.ts:326`). Le seul
  agrégat qui sort est `nombre_week_ends_dans_la_periode` (`compteurs.ts:325`), qui n'est
  pas une donnée personnelle. **Pas une fuite, mais le point à ne jamais toucher sans
  vérifier.**

### C3 — Écritures : aucune ne contourne sa garde admin

Vérifié un par un. Les 30 outils d'écriture délèguent tous à une action serveur de
l'application (`updateVeterinaire`, `setEquiteImportance`, `validerCongeAction`,
`proposerEchange`, `changerStatutCompensationAction`, `creerPeriodeAction`,
`publierPOST`…), qui reportent leur propre garde. Trois exceptions écrivent directement en
base :

- `declarerAbsence.executer` → `insert` sur `absences` (`absences.ts:400`)
- `reparerAbsence.executer` → `insert` sur `compensations` (`absences.ts:781`) et `update`
  sur `absences` (`absences.ts:812`)

Les trois portent `adminSeulement: true` **et** sont couvertes en base par
`absences_admin_write` / `compensations_admin_write` (`get_user_role() = 'admin'`). Double
garde. Rien à signaler.

### C4 — Messages de désambiguïsation : les périodes sont propres, les prénoms sont un motif à surveiller

- `resoudrePeriode` (`planning.ts:130` et `:134`) énumère des libellés de période — mais
  repart de `chargerPeriodes(ctx)`, qui filtre cabinet **et** `publie_at`
  (`planning.ts:92-99`). **Aucune fuite.**
- `resoudrePeriode` (`compteurs.ts:156` et `:159`) — même conclusion, la requête est bornée
  en amont (`compteurs.ts:104-110`).
- `resoudreVeto` / `resoudre` / `resoudrePrenom` (`compteurs.ts:82`, `equipe.ts:74`,
  `conges.ts:128`, `absences.ts:89`, `echanges.ts:177`) énument **tous les prénoms du
  cabinet** dès qu'un nom n'est pas reconnu. Sans conséquence aujourd'hui (un vétérinaire
  connaît son équipe, et `lire_equipe` est ouvert à tous), mais c'est exactement le motif de
  fuite par message d'erreur : à ne pas reproduire sur une liste qui, elle, serait restreinte.

---

## 🏢 À DEUX CABINETS

**La bonne nouvelle, et elle est solide** : les tables tiennent. Les lectures de Filou qui
n'ont **aucun** `.eq('cabinet_id')` — `chargerVets` (`compteurs.ts:66`), `chargerEquipe`
(`equipe.ts:33`), `chargerEquipeLegere` (`conges.ts:85`, `absences.ts:61`),
`chargerVeterinaires` (`echanges.ts:161`), `chargerConges` (`conges.ts:92`),
`chargerReglesEquite` (`compteurs.ts:196`), `chargerReglesCabinet` (`regles.ts:344`),
`chargerProfils` / `chargerCreneaux` / `chargerRelations` / `chargerAffinages`
(`structure.ts:82-128`), `trouverAbsenceActive` (`absences.ts:113`) — sont **toutes**
protégées par une politique RESTRICTIVE `cabinet_id = auth_cabinet_actif()`, vérifiée en base
sur les 20 tables concernées.

**Mais elles ne sont protégées QUE par ça.** Aucune de ces requêtes ne pose la borne
elle-même. Le jour où une politique est modifiée, désactivée le temps d'une migration, ou
oubliée sur une nouvelle table, une douzaine d'outils traversent le cabinet d'un coup. C'est
une dette, pas un bug.

**Ce qui fuirait vraiment au prochain client :**

1. **Les deux vues, dès le premier outil qui oublie la borne.** `planning_semaine` et
   `compteurs_gardes` n'ont ni RLS ni `security_invoker` (vérifié). Aujourd'hui les deux
   lecteurs Filou sont bornés — `lireGardes` par `.in('periode_id', perimetre.ids)`
   (`planning.ts:191`), `lireCompteurs` par `resoudrePeriode` (`compteurs.ts:104`). C'est une
   **discipline**, pas une contrainte : rien dans le code ne fait échouer une requête non
   bornée. Le correctif de fond reste celui que le commit `55ea8ab` annonce lui-même :
   `security_invoker` sur les deux vues (21 modules lecteurs à revoir).

2. **`get_user_role()` et `get_veterinaire_id()` ne sont pas bornés par cabinet.** Toutes
   deux (SECURITY DEFINER, vérifiées en base) font :
   `SELECT … FROM veterinaires WHERE user_id = auth.uid() AND actif = true LIMIT 1`.
   Un même compte auth rattaché à **deux** cabinets — vétérinaire remplaçant sur deux sites,
   administratrice de deux structures — verrait son **rôle** et son **identité vétérinaire**
   choisis arbitrairement par le `LIMIT 1`. Ces deux fonctions sont au cœur de **toutes** les
   politiques RLS du projet : un mauvais `LIMIT 1` fait basculer un vétérinaire en admin, ou
   l'inverse. **C'est le risque structurel n°1 du deuxième client**, et il est en base, pas
   dans Filou.

3. **`cabinets` : RLS activée, 1 politique, aucune RESTRICTIVE**, et pas de colonne
   `cabinet_id` (c'est `id`). Les trois lectures de Filou bornent explicitement par
   `.eq('id', ctx.cabinetId)` (`structure.ts:376`, `:1167`, `:1225`) — donc pas de fuite
   *aujourd'hui*, mais cette table-là est tenue **par le code seul**.

4. **F2 (`gardesDuVetoCeJour`) reste borné au cabinet** par `gardes_cabinet_isolation`. La
   fuite qu'il ouvre est intra-cabinet (rôle + diffusion), pas inter-cabinets.

---

## 📚 CE QUE FILOU IGNORE

| # | Ce qu'il ne sait pas | Conséquence pour le client | Effort |
|---|---|---|---|
| 1 | **`places_sup` — 3ᵉ place et au-delà** | **Annonce des trous qui n'existent pas** | Faible |
| 2 | `gardes_exceptions` — le remplacement d'un seul jour | Réponse juste, explication absente | Faible |
| 3 | `jours_1er_we_exceptionnels` / `jours_exceptionnels_pris` | Compteurs incomplets | Très faible |
| 4 | `joursTouches` — quels jours d'un week-end sont touchés | Parle du week-end entier | Faible |
| 5 | La règle « un planning non publié ne sort pas du logiciel » | Refuse sans savoir l'expliquer | Très faible |

### 1. `places_sup` — ce n'est pas une ignorance, c'est un bug de comptage

`lireGardes` sélectionne `date, type, premier_prenom, second_prenom, periode_statut`
(`planning.ts:191`) et calcule
`pourvues = [r.premier_prenom, r.second_prenom].filter(Boolean).length` (`planning.ts:259`).

Or la vue expose `places_sup` — un `jsonb_agg` des placements dont `place_index >= 2`
(vérifié dans `pg_get_viewdef`) — et la structure autorise jusqu'à **4 places**
(`N_PLACES_MAX = 4`, `structure.ts:232`).

Sur un créneau réglé à 3 places et **entièrement pourvu**,
`manque = Math.max(0, attendues - pourvues)` (`placesAttendues.ts:140`) vaut donc
`3 - 2 = 1`. Et la description de l'outil ordonne à Filou d'en parler :
*« au-dessus de 0, dis-le clairement, ce n'est jamais anodin »* (`planning.ts:167`).

**Filou annonce un trou dans un planning complet, et insiste dessus.** C'est le défaut le
plus visible pour le client, et il est du même genre que celui déjà payé sur les nuits de
semaine (documenté `planning.ts:208-217`).

*Correctif* : ajouter `places_sup` au `select` et compter
`pourvues = [premier, second].filter(Boolean).length + places_sup.length`.

### 2. `gardes_exceptions`

Grep sur tout `src/lib/ia` : **zéro occurrence**. Mais — et c'est une bonne surprise — la vue
`planning_semaine` les résout déjà : `LEFT JOIN gardes_exceptions ep/es` puis
`CASE WHEN ep.id IS NOT NULL THEN ep.veterinaire_id ELSE b.tit_premier END`.

**Donc la question posée est bien traitée** : un vétérinaire remplacé le seul dimanche d'un
week-end qui demande « suis-je de garde dimanche ? » obtient **la bonne réponse** — il
n'apparaît pas sur cette date, et le remplaçant, lui, apparaît. Vérifié dans la définition de
la vue.

Ce que Filou ne peut pas faire, faute de lire les colonnes : dire que **c'est un
remplacement d'un seul jour**, nommer le titulaire, ou expliquer pourquoi le samedi et le
dimanche ne portent pas le même nom. Les quatre colonnes existent et ne sont pas lues :
`jour_exceptionnel`, `exception_premier`, `exception_second`, `compte_1er_we`
(`planning.ts:191`).

*Correctif* : les ajouter au `select` et une phrase dans la description de l'outil.

### 3. Les colonnes exceptionnelles des compteurs

`queryCompteurs` fait `select('*')` (`useCompteurs.ts:111`) : les deux colonnes **arrivent**
bien jusqu'à `lireCompteurs`. Elles sont simplement **non mappées** dans la sortie
(`compteurs.ts:326-369`), donc invisibles du modèle. Deux lignes à ajouter.

### 4. `joursTouches`

Le champ existe bien : `CreneauImpacte.joursTouches: string[]`
(`src/lib/crise/contexte.ts:79`, rempli lignes 288-306). Mais `lireCreneauxTouches` ne renvoie
que `date`, `role`, `remplacants_legaux`, `aucun_remplacant_legal`
(`absences.ts:304-309`). Filou ne peut donc pas dire à l'administratrice « seul le dimanche
est à couvrir sur ce week-end » — il parle du créneau entier.

### 5. La règle de diffusion elle-même

Filou la **respecte** désormais (`perimetre.ts`), mais ne sait pas la **dire**. La seule
phrase disponible est `messagePerimetreVide` (`perimetre.ts:96-100`), et le prompt système
(`agentFilou.ts:138-217`) ne mentionne nulle part qu'un planning non publié n'existe pas pour
un vétérinaire. Un vétérinaire qui demande « pourquoi je ne vois pas le planning d'hiver ? »
reçoit un refus sans explication. Une ligne de prompt suffirait — et c'est précisément « ce
qu'il doit connaître pour accompagner le client ».

---

## Verdict

Les correctifs du commit `55ea8ab` sont **justes sur leur périmètre** — les quatre lectures
de vues sont correctement bornées, le piège du filtre par nom est réellement fermé, les refus
côté vétérinaire sont neutres — mais leur périmètre était **trop étroit** : ils ferment les
lectures de VUES et laissent ouvertes trois portes qui lisent des TABLES ou qui n'ont jamais
reçu de garde de rôle (F1 `lire_historique_fetes`, F2 `proposer_echange`, F3
`lire_absences`).

**F2 est la plus grave** : par une suite de propositions d'échange refusées, un vétérinaire
reconstitue date par date le planning non diffusé de n'importe quel confrère — c'est-à-dire
exactement ce que les quatre correctifs de la veille voulaient rendre impossible, atteint par
un chemin qu'ils n'ont pas regardé.

Enfin, un défaut qui n'est pas une fuite mais qui se verra tout de suite chez le client :
faute de lire `places_sup`, **Filou annonce un vétérinaire manquant sur des créneaux à 3 ou 4
places entièrement pourvus** — et sa propre description lui ordonne d'insister.
