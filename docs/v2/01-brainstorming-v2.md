# GuardVeto V2 — Brainstorming

> 🟡 **BROUILLON — phase de réflexion, RIEN n'est verrouillé.**
> Étape *avant* le PRD V2. Capture la réflexion MiKL ↔ MAX/ARCH/NOVA du 2026-06-10.
> Sources : audit moteur (ARCH), retours cabinet (`docs/retours-cabinet/`), benchmark concurrentiel, roadmap (`00-vision-roadmap-v2.md`).
> Prochaine étape : transformer ce brainstorming en **PRD V2** (REX + OTTO) une fois les arbitrages tranchés.

---

## 1. L'ambition V2

Faire passer GuardVeto d'un outil **où les règles sont soudées dans le code** à un outil **où les vétérinaires définissent et règlent eux-mêmes leurs contraintes**, en langage naturel, le moteur s'adaptant automatiquement — avec une IA qui traduit, compare, explique, et un moteur déterministe qui garantit le résultat.

**Pitch différenciant :** un logiciel de planning de gardes où on *parle* à l'application (« je veux ça, pas ça »), elle traduit et explique, le moteur calcule juste et garanti.

---

## 2. Décisions déjà prises par MiKL (2026-06-10)

1. **Ambition** : les **3 paliers d'emblée** (règles configurables → diagnostic → IA).
2. **Multi-cabinet construit d'emblée** (commercialisation visée — niche véto FR vide, confirmée par le benchmark).
3. **Système de gestion de crise** (absences longues) à concevoir avec soin — voir §8.

---

## 3. L'architecture cible (réflexion) — la cuisine de restaurant 👨‍🍳

Principe directeur : **le moteur produit UNE vérité complète, on l'enregistre telle quelle, tout le monde la lit — personne ne recalcule jamais** (généralisation de la leçon du bug R8).

```
   🛎️ COUCHE IA (maître d'hôtel) — traduit / compare / explique, ne calcule jamais
        ▼
   🥫 RÉFÉRENTIEL (garde-manger) — calendrier, équipe, RÈGLES — un seul stock, par cabinet
        ▼
   👨‍🍳 MOTEUR (chef) — fonction PURE "simuler(règles, référentiel)" → planning + trace + scores
        ▼
   🍽️ VÉRITÉ CANONIQUE (plat dressé) — planning complet persisté tel quel
        ▼
   🤵 CONSOMMATEURS (serveurs) — vue, PDF, agenda, compteurs, mobile — LISENT, ne re-cuisinent pas
```

3 pièces décisives :
- **Catalogue de règles typées** (cœur) — chaque type de règle = un évaluateur codé + un schéma de réglages + un widget visuel. La BDD dit *quelles* règles sont actives, le code garde la bibliothèque des évaluateurs.
- **Une seule fonction « simuler »** — sert l'aperçu de config, le diagnostic ET l'assistant IA. À concevoir une fois.
- **Le moteur produit sa « trace »** (le pourquoi : règles enfreintes, coût, contrainte bloquante) — sinon IA + diagnostic aveugles.

---

## 4. LE système de règles dur/mou (cœur de la réflexion)

### 4.1 Un seul curseur de force (pas deux catégories)
Une règle dure = une règle molle avec un poids « infini » (un mur). Donc **une seule liste de règles, chacune avec un curseur de force.** Proposition d'échelle pour des vétos :

| Niveau | Nom parlant | Comportement moteur |
|---|---|---|
| 🔴 | **Règle d'or** | Jamais enfreinte (le mur) |
| 🟠 | **Très importante** | Enfreinte seulement en crise / dernier recours |
| 🟡 | **Importante** | Évite vraiment, cède pour un meilleur équilibre global |
| ⚪ | **Confort** | Cède facilement |
| ⊘ | **Désactivée** | Ignorée |

### 4.2 Trois axes à ne pas confondre
Chaque règle se lit : **[cette règle] · s'applique à [qui/quand] · avec une force de [niveau].**
- **Force** = à quel point j'y tiens (le curseur).
- **Condition** = à qui / quand ça s'applique.
- **Portée** = réglage global du cabinet, qu'un véto peut parfois surcharger pour lui.

### 4.3 Les 3 pièges identifiés
1. **« Mort par mille petites règles »** : si les niveaux sont trop proches, plein de petites règles écrasent une grande. → de **gros écarts** entre niveaux (compromis : moins de réglage ultra-fin).
2. **Le jumeau obligatoire : le diagnostic.** On ne peut pas donner le bouton de dureté sans donner le « voici pourquoi c'est devenu impossible, assouplis telle règle ». Indissociables.
3. **Gouvernance** : qui règle quoi (admin = règles du cabinet ; véto = ses contraintes perso).

### 4.4 Briques vs Règles (analogie Lego)
- 🧱 **Briques** (ce que le moteur sait évaluer) : véto, jour, rôle 1er/2nd, semaine paire/impaire, week-end, férié, saison, effectif, « pas de », « préférer », « même que », « au plus N », « la veille de »… → **ajoutées par les développeurs.**
- 🏗️ **Règles** (assemblages de briques + force) → **créées à l'infini par les utilisateurs via l'IA.**
- **Configuration** = assembler des briques existantes (instantané, l'IA gère). **Développement** = fabriquer une brique neuve (un dev, une fois, réutilisable à jamais).

---

## 5. L'IA comme porte d'entrée universelle des règles

Toutes les règles passent par l'IA, qui **traduit + compare aux règles existantes + explique les implications**. Garde-fou central : **l'IA réfléchit/traduit au moment de DÉFINIR ; le moteur calcule seul au moment de GÉNÉRER** (déterminisme préservé).

### 5.1 L'escalier de « dégrossissage » (l'IA dissèque avant de déclarer une exception)
```
① Exprimable directement avec briques existantes ?      → réglé tout de suite
② Reformulable en briques en posant une bonne question ? → réglé (ex : "chirurgie 3j avant" = absence sur 4 jours)
③ Ramenable à une saisie manuelle + briques ?           → réglé
④ Vraiment aucune des trois ?                            → VRAIE exception → dev différé
```
→ Les marches ①②③ avalent ~95 % des demandes. L'IA est un **enquêteur** qui pose les bonnes questions.

### 5.2 Détecter qu'une règle « sort des briques » (anti-règle-fantôme) — 4 couches
1. **Grammaire / formulaire à menus fixes** : l'IA ne peut écrire que des briques connues (enums). Hors menu = inencodable.
2. **Vérificateur en code (le douanier)** : entités existent ? évaluateur réel ? paramètres cohérents ?
3. **Reformulation à l'envers** : l'IA reformule en clair, l'humain valide le SENS (attrape les « arrondis » abusifs).
4. **Simulation** : on applique la règle et on vérifie le comportement réel.
+ Catalogue de briques **partagé IA ↔ moteur** (une seule source de vérité, pas de décalage).

### 5.3 Les 4 réponses honnêtes du système
✅ **Exacte** · 🟡 **Approximée** (l'IA l'avoue) · 🔴 **Hors briques** (→ dev) · ⛔ **En conflit** (→ arbitrer).

---

### 5.4 Périmètre de l'IA (point E — tranché 2026-06-11)

**Principe de MiKL : « l'IA sert JUSTE d'intermédiaire ».** Périmètre volontairement borné — elle assiste, elle ne décide ni ne calcule jamais. **4 casquettes, pas une de plus :**

1. 🌉 **Traducteur** (cœur) — fait correspondre la demande du client **au maximum aux règles/briques déjà établies**, et transmet la règle **au bon format** au moteur. C'est le pont langage naturel → brique structurée.
2. 🔍 **Enquêteur** — quand le client émet une **règle floue**, l'IA **pose les bonnes questions** pour la préciser jusqu'à la rendre encodable (l'escalier de dégrossissage §5.1).
3. 🚦 **Aiguilleur** — **détecte qu'une règle n'est pas implémentable** avec les briques existantes et qu'elle **nécessite un dev de MiKL** → l'escalade en demande structurée vers le **Hub MPP** (§6 cas 2). L'IA reconnaît sa limite au lieu d'« inventer ».
4. 💬 **Assistant / chatbot de support** — **répond au client sur les fonctionnalités de l'appli** (« comment je fais pour… ? »). Rôle d'aide à l'usage, au-delà des seules règles. *(Nouveau périmètre — l'IA n'était jusqu'ici cantonnée qu'aux règles.)*

**Ce que l'IA ne fait JAMAIS** (garde-fou central, rappel §5) : elle **ne génère pas le planning**, ne calcule pas l'équité, ne tranche pas. Le **moteur déterministe** reste seul juge au moment de générer. L'IA travaille **au moment de DÉFINIR** (règles) et **d'EXPLIQUER/ASSISTER**, pas de produire.

**Sur le coût** (l'autre moitié de la question E) : ce périmètre borné est **favorable au coût** — pas de génération lourde, surtout du dialogue court (traduction, questions de clarification, réponses support). Cohérent avec le prix de **79 €/cabinet/mois** (§9bis). *Montant exact du coût IA à mesurer en prototype avant de figer le prix.*

**Leviers de coût retenus pour la V2** (simples, natifs, pas d'infra en plus) :
- **Cache de prompt** (natif Anthropic) — ne pas re-payer la partie fixe des instructions à chaque message.
- **Petit modèle** (type Haiku) pour la traduction de règles — tâche simple, modèle bon marché.
- **Recherche ciblée dans la doc** pour le chatbot support — n'envoyer que le passage utile, pas toute la doc.

**Techno évaluée et ÉCARTÉE pour la V2 — `headroom`** (https://github.com/chopratejas/headroom, évalué le 2026-06-11) :
- *Ce que c'est* : une couche de **compression de contexte** pour agents IA (−60 à −95 % de tokens avant d'atteindre le LLM, réversible). Cible affichée = **agents de code** qui avalent de gros contextes (code, logs, RAG).
- *Pourquoi écarté en V2* : l'IA GuardVeto est volontairement bornée à des **échanges courts** (§5.4) → **quasi rien à compresser**, gain marginal. De plus outil **Python + proxy permanent**, alors que GuardVeto = **Next.js/Vercel serverless** (intégration mal adaptée) ; dépendance jeune et très mouvante ; complexité ajoutée > euros gagnés.
- *À RÉÉVALUER en V3* : l'**agent autonome de dev de règles** (§7) lira du code/tests/gros contextes → terrain idéal pour headroom. Bookmark V3, pas V2.

---

## 6. Catalogue auto-enrichi (« la boîte noire »)

- **Cas 1 — règle = assemblage de briques existantes** → l'IA la crée, la nomme, la range, la rend réutilisable. **100 % auto, sans MiKL.** Catalogue qui grossit tout seul.
- **Cas 2 — règle = brique neuve** → l'IA prépare 90 % (spec + code + tests + aperçu en bac à sable), MiKL garde une **valve légère « feu vert »** (validation rapide, pas invention). Raison : protéger la **confiance** (un planning faux en silence = mort du produit). Cohérent avec TILT.
- **Bac à sable** : le client peut voir sa règle sur-mesure tourner en **simulation** avant qu'elle soit officielle (pas de frustration).
- **Branchement MonProjetPro Hub** : les vraies exceptions partent en **demande structurée** vers le Hub de MiKL → il agit vite, le client a un « ticket en cours » (pas un mur) + contournement manuel en attendant. En multi-cabinet : signal de demande = feuille de route produit.

---

## 7. V3 — Étoile du nord : l'agent autonome de développement de règles

Un agent qui développe en autonomie la quasi-totalité des demandes. Le travail n'est pas l'agent, c'est **son enveloppe de sécurité** (analogie voiture autonome : geofencing + freins + surveillance).
7 rails : (1) contrat de brique sandboxé · (2) batterie de tests auto obligatoire · (3) mode shadow · (4) un cabinet à la fois · (5) versioning + rollback instantané · (6) détection d'anomalie / circuit breaker · (7) humain SUR la boucle (voit + peut stopper).
**Curseur d'autonomie réglable** par niveau de risque (ouvrir progressivement).
🎁 **Cadeau stratégique** : ces rails = ce qu'on construit déjà en V2 (sandbox, golden tests, versioning, source unique, multi-tenant, catalogue borné). **V2 bien faite = V3 atteignable sans tout refaire.** Concevoir V2 ouverte, ne pas construire l'agent en V2.
Nuance honnête : « quasi toutes » (pas littéralement 100 % — données externes, ambiguïté, jugement → escalade élégante).

---

## 8. Système de gestion de crise (absences imprévues) — SPÉCIFICATION DÉTAILLÉE

> Sujet creusé en profondeur avec MiKL le 2026-06-10. Exhaustif. (Tâche #13.)

### 8.0 Principe fondateur
Un planning publié = **contrat social** (chacun s'est organisé). → **Réparation à perturbation minimale** : réaffecter seulement les gardes orphelines, changer le moins possible le reste. Régénérer tout lors d'un arrêt long = trahir tout le monde = interdit. **Différenciateur fort** : aucun concurrent du benchmark ne met ça en avant.

### 8.1 Types de crise (la réponse s'adapte)
- **Courte** (1 j) → bouchage manuel rapide (existe déjà en V1).
- **Longue** (semaines, arrêt de travail) → réparation à perturbation minimale (le cœur).
- **Immédiate** (« ce soir ») → bouchage instantané + notif (pas le temps d'un tour de volontaires).
- **Anticipée** (dans 15 j) → **tour des volontaires d'abord**, puis remplissage. Plus humain.

### 8.2 Les 3 voies de recouvrement (l'admin choisit)
1. **Auto** : le système répare seul (perturbation minimale), prévient les concernés, rééquilibre les compteurs, et **annonce les bonus/malus** générés.
2. **Appel aux volontaires** : un **mail** invite les vétos à se connecter à leur espace, voir les créneaux à couvrir et **se positionner**.
   - L'admin voit la **liste des volontaires dans l'ordre de positionnement** ; il **tranche** soit en suivant l'ordre, soit librement (arbitrairement).
   - **Délai limite** de réponse. Si personne ne s'est positionné à l'échéance → **soit attribution automatique** (selon règles + bonus/malus), **soit l'admin le fait à la main** (son choix).
3. **Remplaçant externe** (locum / véto hors cabinet) — option **dès le départ** (« forcément ça arrive »). Voir §8.5.

### 8.3 Validation des contraintes en mode crise (point clé)
Deux régimes distincts :
- **Mode AUTO** : le moteur respecte les **règles d'or** (🔴, jamais enfreintes) et peut assouplir le reste (curseurs baissés), **avec rapport clair** des règles pliées.
- **Mode MANUEL (admin)** : **les règles ne bloquent plus** — l'admin est **tout-puissant**, MAIS un **message d'alerte** le prévient à chaque fois que son choix **rompt telle ou telle règle**. → L'humain décide, en pleine connaissance de cause. (L'autorité humaine prime, mais informée.)

### 8.4 Multi-remplaçants & compteurs
- Une absence (même de 2 j) peut être couverte par **un remplaçant par jour**. Plusieurs vétos peuvent être absents en même temps.
- **Tout est suivi en compteurs INDIVIDUELS.**

### 8.5 Les remplaçants externes
- Enregistrés **dans le même onglet que les vétos**, mais **marqués « externe »** et séparés, **avec leurs coordonnées** → constitue de fait un **carnet de remplaçants réutilisable** (pratique, et utile en multi-cabinet).
- **Apparaissent dans les compteurs** (info) → les admin voient **combien de gardes chacun a faites**.
- **Le moteur les IGNORE** : ils ne comptent **pas** dans les règles ni l'équilibrage interne (ni dette ni bonus internes).
- Le **coût** (payer le remplaçant) = **hors mission** de l'outil.

### 8.6 La compensation du remplaçant (créance / dette)
Remplacer crée une **créance** (remplaçant) / **dette** (remplacé), suivie sur le **compteur**.
- Le remplaçant **propose** comment être « remboursé » : il **coche des propositions** OU écrit en **texte libre**, dans un **message perso** accompagnant le remplacement. Modes possibles :
  - a) **moins de gardes** les prochaines périodes (= bonus classique côté moteur)
  - b) **en argent**
  - c) une **dette** de l'autre véto (à rendre en gardes)
  - d) un **système custom** proposé par le remplaçant
  - e) **règlement externe** → **rien dans les compteurs**
- **Négociation** : l'**admin valide** ; s'il n'est pas d'accord → **plusieurs allers-retours** remplaçant ↔ admin ; quand **les deux ont accepté** → c'est **officiellement** dans le planning.
- **Validation humaine TOUJOURS** (au moins un admin).

### 8.7 Suivi de la dette / du solde
- La dette/créance est **notée sur le compteur**.
- En cas de **solde d'un véto** (départ, fin de cycle), le solde **s'affiche** → **les admin décident** comment ils gèrent.
- **Hors mission de l'outil** : le règlement en **argent** ou autre. L'outil **trace et affiche**, il ne gère pas l'argent.

### 8.8 Rôle de l'IA (lien avec le système de règles, topic 1)
Une fois l'accord acté, l'IA peut le **transformer — ou pas** :
- **rien** (résolution purement humaine, hors système)
- un **bonus/malus**
- une **règle ponctuelle** (valable la prochaine période seulement)
- une **règle durable** (ex. « le remplaçant fait 1 jour de moins/semaine jusqu'à extinction de la dette »)
→ L'IA **mappe vers une règle du catalogue existant** (mêmes briques que topic 1).

### 8.9 Retour anticipé de l'absent (Q1)
On **NE défait PAS** les réparations déjà publiées (devenues un contrat). L'absent **redevient disponible** pour les créneaux **futurs non couverts**. Échange volontaire **au cas par cas** possible (manque à gagner) — **jamais auto, toujours validé**.

### 8.10 Équité (Q3)
- Gardes manquées de l'absent (maladie) = **neutres** (pas de punition).
- Couvreurs = **crédit** (moins la période suivante, via bonus/malus).
- Absences répétées → injustice long terme = **question RH** : l'outil **trace et affiche**, **ne juge pas**.

### 8.11 Traçabilité
- L'admin peut attacher une **note à l'absence**.
- Tout l'historique (qui absent, qui a couvert, arrangements, règles pliées) est **journalisé**.

### 8.12 Si vraiment personne ne peut couvrir (Q2)
Escalade : (1) règles molles déjà assouplies → (2) diagnostic + leviers (remplaçant externe, etc.) → (3) **garde NON couverte affichée en rouge**. **Principe d'honnêteté** : un trou clair > une affectation forcée fausse.

### 8.13 UX (moment stressant → ultra-clair)
Déclarer l'absence (motif + note optionnels) → liste des gardes orphelines → choix de la voie (auto / volontaires / externe) → **aperçu** (qui change, qui est touché, règles pliées, impact équité, trous en rouge) → validation admin → mise à jour de la **vérité unique** (les consumers suivent) → notif des **seuls concernés** avec le **pourquoi** → traçabilité.

### 8.14 Réutilise les briques V2
fonction `simuler()`, curseurs de force, bonus/malus, diagnostic, source unique de vérité. = **composition naturelle**, pas un module greffé. Valide l'architecture.

### 8.15 Points tranchés par MiKL (2026-06-11) — clôture du système de crise

1. **Délai de réponse des volontaires = défini par l'admin** qui lance l'appel (champ paramétrable au moment de lancer l'appel, PAS une valeur figée dans le produit). Raison : **chaque cabinet a ses propres contraintes organisationnelles** (ex. le temps nécessaire pour mobiliser un intervenant extérieur varie d'un cabinet à l'autre). → renforce le §8.2 voie 2.

2. **Cycle de vie de la dette = déjà réglé, portée par le compteur.** La dette apparaît **sur le compteur** et y reste jusqu'à extinction.
   - **Départ d'un véto** : le cabinet **s'arrange avec le véto** pour solder (hors outil — l'outil trace et affiche, cf. §8.7).
   - **Changement de période** : aucune remise à zéro — comme **le moteur consulte le compteur pour l'équité**, il voit qu'il reste des dettes et en **tient compte automatiquement** dans la période suivante. La dette « voyage » avec le véto tant qu'elle n'est pas soldée.

3. **Historique du volontariat = à journaliser quelque part.** Garder une trace de **qui s'est porté volontaire, quand, pour quoi** → permet de voir si ce sont **toujours les mêmes** (transparence, anti-injustice). Sert aussi le suivi RH (cf. §8.10) et la confiance. → nouvel élément à tracer (à côté de la traçabilité §8.11).

> ✅ **Système de gestion de crise (§8) considéré comme COMPLET** au stade brainstorming. Restera à détailler au PRD (schéma de données du journal de volontariat, UI de l'historique).

---

## 9. Apports du benchmark concurrentiel (à intégrer)

**Positionnement retenu** : « **le premier logiciel français de planning de gardes pensé pour les vétérinaires** » — niche véto FR quasi vide ; concurrents fonctionnels = santé humaine (SuperPagr, Med-Planning) ; concurrents véto = anglophones (RosterLab, XShift, iTeam Rota).
**Fonctionnalités « standard marché » à ne pas oublier** (tâches #12-16) :
- Échange de gardes entre vétos (existe en manuel V1) + **système de crise** (le vrai manque).
- Demandes de remplacement + suggestions de remplaçants valides.
- Score d'équité **visible par véto** + indicateurs post-génération (% couverture, % équité).
- Repos de sécurité (pas de garde le lendemain d'une nuit).
- Ré-optimisation itérative + scénarios (plusieurs plannings candidats).
- Import planning existant (Excel/photo) + export CSV.
**Naming** : garder « véto » visible (SuperPagr occupe un territoire proche). Le cabinet veut un nouveau nom.

---

## 9 bis. Modèle économique (brainstorming en cours)

**Décisions MiKL (2026-06-10) :**
- **Prix de départ : 79 €/cabinet/mois, vétos illimités** (forfait cabinet, pas par utilisateur — cf. ci-dessous). Chiffre de travail, à réajuster quand le coût IA réel sera connu.
- **Deux formules :**
  - 🗓️ **Mensuel sans engagement**, résiliable à tout moment (zéro engagement — confiance + adapté à la conquête de niche ; faible churn si produit bon car besoin récurrent).
  - 📅 **Annuel avec réduction** (paiement d'avance contre prix réduit). Repère marché standard : **~2 mois offerts** (≈ 17 % de remise) → ordre de grandeur **~790 €/an** (≈ 66 €/mois équivalent). *Montant exact à caler.* Avantage : trésorerie d'avance + ancrage d'un client pour 12 mois, sans contredire le « sans engagement » (qui reste l'offre mensuelle par défaut).
- **Par cabinet** (forfait, vétos illimités) plutôt que par utilisateur — raison : le moteur a besoin de TOUS les vétos inscrits, donc ne pas pénaliser l'inscription complète (analogie « sport d'équipe »). *(à confirmer)*
- **Une part de chaque abonnement reversée à une cause** choisie par le cabinet véto (cause animale probable). Différenciateur éthique ALIGNÉ avec l'acheteur (vétos = métier de soin) → persuasion honnête, pas cosmétique. Modèle reconnu (1% for the Planet, B-Corp…).
  - Condition : **transparence** (% ou montant précis affiché + bilan annuel public) pour éviter le greenwashing.
  - Le cabinet pilote choisit la 1re cause (geste fort → ambassadeurs).
- **Pas de freemium permanent** (niche trop petite pour la règle des 2-5 % + l'IA coûte cher → ne JAMAIS mettre l'IA en gratuit). Plutôt **essai gratuit** (zéro risque) et éventuel mini-mode gratuit SANS IA comme produit d'appel.
- **Paliers de fonctionnalités** envisagés (Base = génération + PDF ; Pro = IA + crise + analytics ; + à la carte « règle sur-mesure » via MPP Hub) → l'IA est l'upsell qui monétise l'investissement V2/V3.

**Logique de prix** : `prix/cabinet/mois = hébergement + coût IA + part cause + marge`. Repères : valeur (~3 j économisés/période) ; concurrent RosterLab ≈ 120 $/cabinet. → **Point de départ retenu (2026-06-11) : 79 €/cabinet/mois** (haut de la fourchette envisagée), à valider/réajuster quand le coût IA réel sera connu.

**Question ouverte** : part cause = pourcentage (scalable) ou montant fixe par abonnement (lisible) ?

## 9 ter. Onboarding multi-cabinet (point D — tranché 2026-06-11)

**Décision MiKL : il faut prévoir LES DEUX voies d'entrée.** Un cabinet doit pouvoir **s'inscrire tout seul** (self-service), ET MiKL doit pouvoir **créer/enrôler un cabinet lui-même** (back-office).

### 9ter.1 Les deux portes mènent au même résultat
Quelle que soit la voie, on aboutit au **même état** : un **cabinet (tenant)** isolé + son **1er admin** relié + un référentiel vierge prêt à configurer. La différence n'est que la **porte d'entrée**, pas la mécanique interne.

| Voie | Qui l'utilise | Pourquoi elle existe |
|---|---|---|
| 🚪 **Self-service** (inscription autonome) | Le cabinet, depuis le site | Passage à l'échelle / commercialisation ; un cabinet découvre, s'inscrit, démarre son essai sans intervention humaine |
| 🛠️ **Back-office MPP** (MiKL enrôle) | MiKL | Cabinets pilotes, démo commerciale, accompagnement « VIP » du début, SAV, dépannage |

### 9ter.2 Ce que ça implique (le kit complet)
- **Parcours self-service** : page d'inscription publique → création cabinet + 1er admin → vérif email → choix de la **cause** (modèle éco §9bis) → **essai gratuit** qui démarre. C'est le parcours « Login/inscription » version *création de tenant*.
- **Console super-admin MPP** (toi) : un **back-office** où tu vois tous les cabinets, tu peux en **créer un à la main**, suspendre/réactiver, dépanner, voir l'état des abonnements. C'est ton **poste de pilotage produit** (utile aussi pour lire le « signal de demande de règles » multi-cabinet, cf. §6).
- **Bootstrap du 1er admin** : même logique qu'en V1 (un 1er admin invité/relié) mais **généralisée et automatisée** par cabinet — plus jamais à la main en base.

### 9ter.3 Nuance d'activation (à garder en tête, pas à trancher maintenant)
« Prévoir les deux » = **l'architecture supporte les deux dès le départ**. Mais l'**ouverture** du self-service au grand public peut être un simple **interrupteur** : au lancement, tu peux garder le self-service fermé (ou en liste d'attente) et n'enrôler que via ton back-office le temps de roder, puis ouvrir les inscriptions autonomes quand le produit est prêt. Zéro refonte le jour où tu ouvres les vannes.

---

## 9 quater. Frontière V1 / V2 (point F — tranché 2026-06-11)

**Décision MiKL : PAS de « V1 améliorée » intermédiaire.** Refus de livrer au cabinet une V1 retouchée qui, quelques semaines plus tard, serait remplacée par une V2 où il faut tout reprendre. → **On propose au cabinet de passer directement sur la V2.**

**Raison** : éviter le travail jetable (coder des règles en dur qu'on ré-architecturera juste après) et éviter de faire vivre au cabinet deux changements d'outil rapprochés.

**Statut du cabinet pilote (complément 2026-06-11)** : on leur sort une **version fonctionnelle** (la « V2 cœur ») et ils deviennent nos **bêta-testeurs** → **ils ne paient pas l'abonnement.** Contrepartie juste (ils ont essuyé les plâtres de la V1 + ils testent la V2 en conditions réelles) et levier produit (retours terrain + futur cabinet ambassadeur, cf. §6 / §9bis). Le passage au tarif **79 €/mois** ne concerne donc que les cabinets **suivants** (acquis via self-service ou enrôlés, §9ter).

### 9quater.1 La nuance à tenir : « direct V2 » ≠ « le cabinet n'a rien d'ici là »
La **V1 est déjà en service** (`guardveto.vercel.app`, le cabinet l'utilise). « Passer directement à la V2 » = stratégie produit, **pas** privation : le cabinet **continue d'utiliser la V1 en prod** pendant qu'on construit la V2. Il faut donc distinguer deux natures de demandes issues du bilan :

| Nature | Traitement pendant la construction V2 |
|---|---|
| 🐞 **Bugs bloquants** (empêchent l'usage quotidien : navigation, effectif été cassé, agenda) | ✅ **Corrigés sur la V1** quand même — sinon le pilote décroche AVANT d'avoir la V2 |
| ✨ **Améliorations / nouvelles règles** (compteurs par type, repos auto, « pas de garde la veille », règle 10 réglable…) | ⏸️ **Absorbées par la V2** (c'est précisément ce qu'on ne veut PAS coder en jetable) |

→ On **gèle la V1 en fonctionnalités** (plus de dev de confort jetable) mais on garde un **filet de correctifs de bugs bloquants** pour qu'elle reste vivable jusqu'à la bascule.

### 9quater.2 Contrainte de calendrier à garder à l'œil
Le cabinet passe à **6 vétos / rotation 6 semaines l'hiver prochain** (~déc. 2026, soit ~6 mois). Fenêtre serrée si on vise la V2 **complète** (Fondations + 3 paliers + multi-cabinet + crise). → Piste à arbitrer au PRD : livrer d'abord la **« V2 cœur » (Fondations + Palier 1)** — qui résout déjà l'essentiel des retours du bilan — et étaler IA / crise / multi-cabinet en paliers suivants (le `00-vision-roadmap` §4 prévoit déjà des paliers livrables indépendamment).

---

## 9 quinquies. Gouvernance des règles (point G — tranché 2026-06-11)

**Modèle « proposition → arbitrage → ancrage », généralisé depuis ce qui existe déjà en V1** (en V1, le véto fait déjà des demandes de congé que l'admin valide).

### 9quinquies.1 Le véto (depuis son dashboard) — PROPOSE
- Envoie ses **indisponibilités** (comme aujourd'hui).
- **Propose des règles** (ses contraintes/préférences perso).
- Peut **suggérer un niveau de dureté** (le curseur de force du §4.1) — il dit à quel point il y tient, mais il ne décide pas.
- **Le véto propose, il n'ancre jamais.**

### 9quinquies.2 L'admin — ARBITRE et ANCRE
- **Tranche toujours** : il **ancre ou non** la règle proposée (validation humaine systématique — cohérent avec le garde-fou « au moins un admin valide » du §8.6).
- Peut **créer des règles lui-même** directement (règles du cabinet).
- C'est lui qui décide du **niveau de dureté final** (peut suivre ou non la suggestion du véto).

### 9quinquies.3 L'IA — TRANSMETTEUR & PÉDAGOGUE (rappel important)
Au-delà des 4 casquettes du §5.4, dans ce flux de gouvernance l'IA joue un rôle de **médiateur explicatif** :
- Si une règle proposée **n'est pas cohérente**, ou **contredit une autre règle** déjà en place → **c'est l'IA qui l'explique au client** (au véto qui propose et/ou à l'admin qui arbitre).
- Elle rend la décision de l'admin **éclairée** (il sait ce qu'il ancre et ce que ça casse) — prolonge la réponse « ⛔ En conflit » du §5.3 et le diagnostic du Palier 2.

### 9quinquies.4 Répartition « qui règle quoi »
| Niveau | Qui | Quoi |
|---|---|---|
| 🏛️ **Règles du cabinet** | Admin | Effectif, rotations, règles communes, dureté finale, ancrage de TOUTE règle |
| 👤 **Contraintes perso** | Véto (proposition) → Admin (validation) | Indispos, préférences, suggestion de dureté |
| 🛎️ **Médiation** | IA | Traduit, détecte incohérences/conflits, explique, n'ancre jamais |

---

## 9 sexies. Compléments benchmark — trous comblés (2026-06-11)

Croisement des features « standard marché » (§9) avec le périmètre acté. Trois trous traités :

### 9sexies.1 🔴→✅ Score / compteur d'équité visible par le véto — **option admin**
La visualisation des compteurs côté véto **n'est pas automatique** : c'est une **option débloquée par l'admin** qui ouvre (ou non) un **onglet « Compteur »** dans l'espace de chaque véto.
- Raison : certains cabinets voudront la transparence totale, d'autres préféreront garder les compteurs en interne (politique du cabinet). → réglage **par cabinet**.
- Cohérent avec la gouvernance (§9quinquies) : l'admin maîtrise ce que le véto voit.
- 🎛️ **Granularité fine (MiKL 2026-06-11)** : depuis son dashboard, l'admin **coche les KPIs** qu'il veut rendre visibles aux vétos (sélection case par case, pas un simple on/off global de l'onglet). Chaque cabinet compose ainsi sa propre vue véto.
  - Candidats de KPIs à proposer (catalogue côté admin) : sa charge perso (nb de gardes par type), sa charge **vs moyenne du cabinet**, ses **dettes/crédits** (§8.6), son rang/équité, historique. → liste précise à figer au PRD.
  - *Note design : l'onglet véto n'affiche QUE les cases cochées par l'admin ; KPIs globaux du cabinet (% couverture, % équité d'ensemble) restent par défaut côté admin, cochables s'il le souhaite.*

### 9sexies.2 🔴→⏸️ Multi-planning / scénarios candidats — **reporté (noté au backlog)**
On **NE fait PAS** de plannings candidats multiples pour l'instant. **On reste sur UN seul planning.** Le besoin « essayer une autre option » est déjà couvert par :
- **Régénérer** le planning s'il ne convient pas + **changements manuels**.
- 🔑 **Tant qu'il n'est pas publié, le planning reste malléable SANS AUCUNE conséquence** (pas de notif, pas de contrat social — le « contrat social » du §8.0 ne s'active qu'à la **publication**). Le brouillon est un bac à sable.
- 📌 **Backlog / idée reportée** : générer N candidats et laisser l'admin en choisir un (qui deviendrait alors la vérité unique). Compatible avec l'archi « vérité unique » à condition que le choix se fasse AVANT publication. À réétudier plus tard, pas en V2 cœur.

### 9sexies.3 🔴→✅ Import d'un planning existant — **pour amorcer les COMPTEURS**
Bonne idée, et **cas concret immédiat** : notre cabinet test a déjà un planning en cours.
- **Ce que l'import fait** : alimenter les **compteurs / l'historique d'équité** (qui a déjà fait combien de gardes) pour que la génération suivante soit juste.
- **Ce que l'import NE fait PAS** : il ne sert **pas** à extraire des règles (les règles se définissent dans l'app, pas à partir du fichier importé).
- *Analogie* : « saisir le score à la mi-temps » — on n'enregistre que le score acquis, pas le match rejoué.
- 🔧 **Paramètre admin requis : « date pivot »** = la date **à partir de laquelle** ce qui est importé **compte dans le compteur** (ex. depuis le début du cycle congés 1er oct). En-deçà = ignoré.
- *À préciser au PRD : format d'import (Excel / CSV / photo→OCR ?), granularité (agrégat « X gardes par véto » suffit-il, ou détail créneau par créneau pour éviter de réattribuer un créneau déjà fait ?).*

### 9sexies.4 Confirmations de périmètre (tranchées 2026-06-11)
- ✅ **Export CSV** (en plus du PDF V1) → **OUI**, dans la V2 cœur.
- ⏸️ **Repos de sécurité** (« pas de garde le lendemain d'une nuit ») → **à décider quand on fera le tour du catalogue de règles** (point A). C'est une brique candidate, pas tranchée maintenant.
- ✅ **Mobile** → **OUI, en responsive** (s'affiche bien sur navigateur téléphone). Appli native = plus tard si besoin, pas en V2.
- 🔔 **Notifications V2 — périmètre arrêté** :
  - ✅ **Mails informant de tout changement dans le planning** (un créneau modifié → les concernés sont prévenus).
  - ✅ **Mails d'appel aux volontaires** (système de crise §8.2).
  - ⏸️ **Rappels avant garde** (« tu es de garde demain ») → **reportés** (« on verra plus tard »). PAS en V2 cœur.

---

## 10. Questions encore ouvertes (à trancher avant/dans le PRD)

1. ~~**Catalogue de briques de départ** : quel vocabulaire initial ?~~ ✅ **TRANCHÉ le 2026-06-15** : grammaire v2 consolidée (tuple à 6 axes QUI×QUAND×QUOI×OPÉRATEUR×FORCE×VALIDITÉ + familles ÉQUILIBRER, liaisons, marqueurs). Golden test 11/11, couverture portée à ~83 %. Détail complet : `02-rapport-strategie-consolide.md` §2.
2. ~~**Règles structurelles** (effectif, inversion, vendredi lié au WE) : figées / on-off / réglables ?~~ ✅ **TRANCHÉ le 2026-06-15** : 3 statuts — ① invariants figés ② **référentiel VERSIONNÉ par période** (pas figé à l'onboarding) ③ conventions locales on/off (avec « sauf » pour Pâques). L'effectif = nb de postes dans le référentiel de créneaux. Détail : `02-rapport-strategie-consolide.md` §3.
3. ~~**Système de crise** : les 3 questions ouvertes du §8.~~ ✅ **TRANCHÉ le 2026-06-11** (cf. §8.15).
4. **Multi-cabinet** : ~~inscription autonome dès le départ ou onboarding manuel par MiKL au début ?~~ ✅ **TRANCHÉ le 2026-06-11 : LES DEUX** (cf. §9ter). Modèle économique (par cabinet / par véto) : dégrossi au §9bis (par cabinet, *à confirmer*).
5. ~~**Ampleur de l'IA** : périmètre conversationnel, coût acceptable.~~ ✅ **TRANCHÉ le 2026-06-11 : 4 casquettes bornées** (traducteur / enquêteur / aiguilleur / assistant support), l'IA ne calcule jamais (cf. §5.4). Coût exact à mesurer en prototype.
6. ~~**Frontière V1 / V2** : ce que le cabinet pilote reçoit maintenant vs plus tard.~~ ✅ **TRANCHÉ le 2026-06-11 : pas de V1 améliorée, on propose directement la V2** (cf. §9quater). Nuance : V1 gelée en fonctions mais maintenue sur les bugs bloquants jusqu'à la bascule.
7. ~~**Gouvernance** : qui règle quoi (admin vs véto).~~ ✅ **TRANCHÉ le 2026-06-11** : véto PROPOSE (indispos, règles, suggestion de dureté) → admin ARBITRE et ANCRE (et crée ses propres règles) → IA explique les incohérences/conflits (cf. §9quinquies).

---

## 11. Prochaine étape

✅ **Toutes les questions du §10 sont tranchées** (les 2 dernières le 2026-06-15, après l'enquête multi-agents — cf. `02-rapport-strategie-consolide.md`).

**Décision de périmètre du 2026-06-15** : **V2 complète d'un seul tenant** (Fondations + 3 paliers config/diagnostic/IA + repos complet + crise complète + multi-cabinet). **Pas de livraison étalée. Échéance non contraignante** pour la V2 — MiKL : « on se fiche de l'échéance, tout doit être opérationnel direct ». ⚠️ Réserve : les **2 bugs prod V1** (parité ISO déc. 2026 + cumul pénalités) restent à corriger sur la V1 avant l'hiver, en chantier séparé.

➡️ Le brainstorming est **clos**. Prochaine étape : **PRD V2** (REX + OTTO) sur ce périmètre, **puis** le document d'architecture (`03-architecture-v2.md`).
