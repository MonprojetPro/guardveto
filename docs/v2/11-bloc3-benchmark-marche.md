# Bloc 3 UX — Benchmark marché, onboarding et assistants IA incarnés

> Matière première de la réflexion Bloc 3 (simplification UX + renard IA).
> Produit le 2026-07-08 par un agent d'analyse (recherche web, sources 2024-2026).
> Convention : **FAIT** = constaté/sourcé ; **LECTURE** = interprétation d'analyste.
> Réserve : moteur de recherche centré US — solide sur les grands noms, plus sommaire sur les micro-acteurs FR.

---

## Volet 1 — Les concurrents : où est (vraiment) l'usine à gaz

### Le constat structurant du marché français

**FAIT** — Il n'existe pas, après recherche, d'outil français **dédié à la génération automatique de plannings de gardes vétérinaires**. Le marché FR est structuré ainsi :
- Les **PMS vétérinaires** (logiciels de gestion de cabinet) dominés par le quatuor Vétocom (~40 % de parts de marché), Bourgelat, AssistoVet, Vet'Phi, plus les modernes dr.veto et Planipets — ils gèrent agenda de consultation, dossiers, facturation, et au mieux un affichage de planning de gardes, **pas un moteur de génération à règles** (Planipets guide 2026, appvizer).
- La **permanence des soins** est organisée par département sous l'égide des Conseils Régionaux de l'Ordre, avec des tableaux fixés des mois à l'avance (Ordre des vétérinaires, SNVEL).
- **FAIT** — Le concurrent n°1 réel est **Excel + SMS** : « des tableaux Excel fragiles et des échanges de SMS désorganisés », 3 à 5 h/semaine de gestion manuelle (eBrigade). La convention collective impose de notifier chaque salarié au moins 1 mois à l'avance (ASVinfos), ce qui rend le bricolage Excel douloureux.

**LECTURE** — Le positionnement « les concurrents sont des usines à gaz » est vrai pour les planificateurs médicaux US, mais pour la cible réelle (cabinets FR de 7-10 vétos), le combat n'est pas « nous vs QGenda » : c'est **« nous vs Excel + l'associée qui y passe son dimanche »**. Le pitch devient « la puissance d'un QGenda, la simplicité d'un tableau papier, sans les 3 mois de setup ».

### Fiches concurrents (5 médicaux + 2 génériques + le statu quo)

| Solution | Cible | UX constatée | Config des règles | Verdict « usine à gaz » |
|---|---|---|---|---|
| AMION | Hôpitaux US | Datée, dense | Fichier local + web 1990s | 🔴 Oui, assumée |
| QGenda | Groupes médicaux US | Riche, drag & drop | Setup lourd par consultants | 🔴 Oui (au setup) |
| Lightning Bolt (PerfectServe) | Hôpitaux US | Très configurable | Règles non intuitives, courbe raide | 🔴 Oui |
| Petal (PetalMD) | Médecins CA/FR | Web moderne, mobile faible | Service + config | 🟡 Moyenne |
| Momentum | Réseaux de soins US | Simple, épurée | Automatisation centrale | 🟢 Plutôt simple (honnêteté oblige) |
| Skello | CHR/retail FR | Quotidien très simple | Config initiale 2-4 sem., avancé 2-3 mois | 🟡 Simple devant, complexe derrière |
| Planday | Équipes horaires EU | Correcte mais labels confus | Setup manuel fastidieux | 🟡 Moyenne |
| Excel + Doodle + SMS | Le vrai statu quo | Familière mais fragile | Aucune (tout dans la tête) | 🔴 Usine à gaz humaine |

**AMION (Doximity)** — **FAITS** : interface « outdated » de l'aveu du vendeur (KLAS) ; « legacy solution » plus activement commercialisée ; refonte récente de l'app jugée « VERY VERY VERY BAD » par des urgentistes qui ne retrouvent plus leur vue multi-jours (App Store reviews, Med Staff Tracker). **LECTURE** : l'anti-modèle parfait — puissant, historique, UX d'un autre âge et refonte qui a braqué les fidèles. Leçon : les vues familières (grille multi-jours) sont sacrées pour les soignants.

**QGenda** — **FAITS** : gère des règles très complexes pour des services de 60+ médecins ; mais setup « considérable, plusieurs réunions avec QGenda, beaucoup de développement custom » ; un administrateur a **abandonné la génération automatique** parce que chaque correction de conflit en créait un autre, et est revenu au manuel ; prix prohibitif pour les petites structures (Capterra, G2, SelectHub). **LECTURE** : LA pièce à conviction — même l'outil le plus puissant du marché voit ses utilisateurs renoncer à l'auto-génération quand les règles deviennent opaques. Le différenciateur GuardVeto n'est pas « on génère aussi », c'est « quand ça coince, l'assistant t'explique pourquoi en français ».

**Lightning Bolt / PerfectServe** — **FAITS** : « très customisable et complexe », « créer une structure de planning ou définir des règles n'est pas intuitif » (KLAS, SelectHub). KLAS : « beaucoup d'organisations n'ont pas encore atteint le processus totalement automatisé espéré ». **LECTURE** : l'écart promesse/réalité de l'automatisation est l'espace de GuardVeto.

**Petal (ex-PetalMD)** — le plus proche culturellement (québécois, francophonie, gardes médicales). **FAITS** : interface web jugée « intuitive et agréable » par une partie des utilisateurs, mais critiques récurrentes « trop de couleurs, pas intuitif », app mobile « moins conviviale », échange de gardes « inefficace et confus » (Capterra FR/EN, GetApp FR). **LECTURE** : preuve que « moderne » ne suffit pas — l'échange de gardes (que GuardVeto a déjà) est le point de friction n°1 des médecins ; le soigner à fond est un différenciateur concret.

**Momentum Scheduling** — **FAITS** (le contre-exemple honnête) : « easy to use », « simple enough to figure out but complex enough to handle complicated scheduling », 6 mois de planning créés en moins d'une journée ; faiblesses = customisation limitée, app iPhone rudimentaire (Software Advice, Software Finder). **LECTURE** : le créneau « simple ET puissant » existe déjà aux US — GuardVeto doit ajouter ce que personne n'a : l'assistant IA qui configure et explique les règles en langage naturel.

**Skello** — le générique FR que les cabinets pourraient prendre par défaut. **FAITS** : prise en main quotidienne unanimement saluée, « accessible même aux moins technophiles » ; MAIS déploiement 2-4 semaines avec accompagnement, 2-3 mois pour les fonctions avancées (impli.fr, lafabriquedunet, independant.io). **LECTURE** : Skello prouve qu'en France on peut vendre la simplicité — mais son moteur ignore tout des gardes ordinales, de l'équité financière 1er/2nd week-end ou du repos post-garde. GuardVeto = « le Skello des gardes vétérinaires », avec le métier dedans.

**Planday** — **FAITS** : avis contradictoires, invitations d'employés manuelles et chronophages, labels confus (« employee groups ») (Connecteam, Capterra, Research.com). **LECTURE** : faiblesse typique des génériques — parler « garde, astreinte, week-end, férié, repos » et non « shifts, groups, templates » est un avantage déloyal.

**eBrigade** — seul acteur FR trouvé qui cible explicitement les astreintes de cliniques vétérinaires (venu du monde pompiers/urgences) : roulements 12-52 semaines, contraintes individuelles, indemnités. **LECTURE** : à surveiller, mais outil d'organisation généraliste adapté, pas un moteur à règles configurables avec IA.

### Synthèse Volet 1 (LECTURE)

Le positionnement « usine à gaz vs radicalement simple » est **factuel** côté médical US mais doit être **nuancé** : Momentum est simple, Skello est simple au quotidien. Le vrai triangle différenciant : ① métier gardes vétérinaires FR natif (réglementation, équité, vocabulaire), ② génération automatique **qui explique ses choix** (là où QGenda perd ses utilisateurs), ③ configuration des règles en langage naturel (personne ne le fait). L'ennemi marketing : Excel, pas QGenda.

---

## Volet 2 — Onboarding « jour 1 » : ce qui marche en 2025-2026

### Les chiffres qui cadrent tout (FAITS)

- Time-to-first-value : **< 5 minutes = excellent** (Figma, Linear, Canva), 5-20 min acceptable, > 20 min = perte significative de signups (Flowjam, digitalheroesco).
- Aha moment atteint en < 5 min → **+40 % de rétention à 30 jours** vs 15+ min.
- Le premier moment de valeur devrait arriver en **3 à 5 étapes** ; la plupart des fondateurs en shippent 9 à 13 (insaim.design).
- Réduire un formulaire d'inscription de 7 à 3 champs : **-44,7 % d'abandon** (saasfactor).
- Les flows par rôle/cas d'usage : +30-50 % d'activation.

### Les 6 patterns gagnants, appliqués à GuardVeto

1. **L'aha moment le plus tôt possible = « mon premier planning généré ».** LECTURE : voir un planning de 12 semaines équitable apparaître en secondes, là où l'associée y passait un week-end. Tout l'onboarding converge vers ça en < 10 minutes chrono : noms des vétos → règles par défaut → GÉNÉRER. Rien d'autre n'est obligatoire avant.
2. **Défauts intelligents d'abord, configuration ensuite.** FAITS : les défauts « éliminent les pauses » ; ne poser une question à l'inscription que si le choix affecte le premier résultat ; chaque étape = « une confirmation rapide, pas un formulaire » (UserOnboard, Humbleteam). LECTURE : un cabinet type FR est très prévisible (garde chaque nuit + week-end, repos post-garde, équité financière) — livrer un « cabinet type » pré-configuré (le profil par défaut existe déjà) et laisser l'IA ajuster (« chez nous, Anne-Cat ne fait pas les gardes »).
3. **Anti-onboarding à la Linear : montrer l'état idéal, pas l'expliquer.** FAITS : onboarding Linear ~1 minute, espace **pré-peuplé de données de démo qui modélisent la perfection**, checklist de micro-tâches en contexte (Candu teardowns). LECTURE : à la première connexion, montrer un **planning d'exemple déjà généré** (cabinet fictif de 7 vétos, pastilles d'équité, une garde échangée, un congé posé) plutôt qu'un écran vide + wizard.
4. **Checklist de démarrage progressive.** FAITS : apprendre en faisant > lire (Appcues, Guidejar). LECTURE : 4 cases max — ① Ajoute tes vétérinaires ② Vérifie les règles proposées ③ Génère ton premier planning ④ Invite l'équipe. La checklist survit à la première session.
5. **Setup conversationnel par IA.** FAITS : pattern 2025 émergent = remplacer les formulaires par un agent qui pose les questions, pré-remplit, valide en temps réel (Dock, Voiceflow, IrisAgent) ; Intercom Fin en référence commerciale. LECTURE : LE pont naturel avec le renard — il mène l'entretien d'arrivée (« On est combien ? Qui fait les gardes ? Vous tournez comment le week-end ? ») et construit la config en direct **en montrant à l'écran ce qu'il remplit**. Mais garder un chemin classique parallèle : le conversationnel est une porte d'entrée, jamais la seule.
6. **Démarrer de l'existant (import).** LECTURE : chaque cabinet a un Excel ou un tableau papier de ses rotations. « Envoie-moi ton planning actuel (photo ou fichier), je m'en sers pour comprendre vos habitudes » = aha moment massif + cas d'usage IA très crédible. À défaut, « comment vous faisiez jusqu'ici ? » alimentant les défauts fait déjà 80 % du travail.

### Anti-patterns à éviter (LECTURE consolidée)

- Tout faire configurer **avant** de montrer un planning (le piège QGenda/Skello : la valeur derrière un mur de setup).
- Un tour du produit en tooltips au lieu de tâches réelles.
- Demander à l'inscription des infos qui ne changent pas le premier planning (adresse, SIRET, préférences fines de chaque véto).
- Un onboarding pensé pour l'admin uniquement : les 6 autres vétos ont leur propre « jour 1 » (voir son planning perso + poser un congé en < 1 minute, sur mobile).

---

## Volet 3 — Assistants IA incarnés : ce qui marche, ce qui agace

### Ce qui marche (patterns 2025-2026)

1. **Une personnalité désactivable, jamais imposée.** FAIT : Microsoft a lancé fin 2025 **Mico**, avatar animé de Copilot, « un Clippy de l'ère IA » dont la grande différence assumée est « Mico is easy to shut off » (TechCrunch, Euronews). LECTURE : le renard doit avoir un mode discret (« réduire le renard ») dès la V1 — c'est paradoxalement ce qui le rend acceptable comme porte d'entrée principale.
2. **« Show your work » : montrer ce que l'IA a compris et fait.** FAITS : patterns de confiance 2025 = afficher le raisonnement de l'agent, lier les sources, contenu généré « en opacité réduite » tant que l'humain n'a pas validé (BuildMVPFast, Groto, The Skins Factory). McKinsey 2025 : le plus de valeur = validation humaine intégrée. LECTURE : GuardVeto fait déjà ça côté moteur (validateur indépendant, explications de refus) — l'incarner : le renard **reformule** (« J'ai compris : Anne-Cat ne prend plus de gardes l'hiver. Voici la règle que je crée ») et l'admin valide avant application. La confiance vient de la reformulation visible, pas du ton mignon.
3. **Passer la main sans friction.** FAIT : Fin (Intercom) fait un handoff automatique vers l'humain dès que c'est plus sûr, avec contexte partagé. LECTURE : quand le renard ne sait pas traduire une demande en règle, il le dit franchement et ouvre le formulaire guidé classique pré-rempli de ce qu'il a compris — jamais de réponse inventée.
4. **L'attachement émotionnel, dosé.** FAITS : Duo (Duolingo) prouve la puissance d'une mascotte cœur-de-marque (DAU ×4,5) (Adweek). LECTURE : Duo fonctionne sur la **culpabilisation ludique**, inacceptable dans un contexte pro médical. Garder : la célébration (« Planning publié, 12 semaines équitables 🎉 »), l'accueil personnalisé. Bannir : le nagging, « le renard est triste ».

### Ce qui agace (anti-patterns)

- **Le Clippy-effect : interrompre au moment de concentration.** FAIT : Clippy surgissait quand l'utilisateur essayait de finir une tâche ; « a character can be friendly and still feel invasive » (Windows Forum, TechCrunch). LECTURE : le renard ne parle jamais spontanément pendant qu'un véto consulte son planning ou pose un congé. Disponible, pas proactif — sauf information critique (planning invalide, garde orpheline).
- **La mascotte gadget** : un avatar qui n'est qu'un habillage de chatbot FAQ. LECTURE : le renard n'a de légitimité que s'il **agit** (créer une règle, expliquer une attribution, proposer un échange).
- **L'IA qui cache les commandes classiques.** FAITS : le débat 2025-26 « Copilot as the UI » conclut que le conversationnel ne remplace pas les affordances visibles (Figr) ; les publics pro préfèrent une IA « qui agit comme une machine » (Euronews). LECTURE : chaque action du renard a son équivalent bouton/formulaire visible. Le renard est un raccourci, pas un péage.
- **L'opacité** : appliquer des changements sans trace. LECTURE : journal visible « ce que l'assistant a fait » — aussi un argument de vente auprès de l'admin responsable devant ses associés.

### 8 pistes de noms pour le renard (+ 3 à éviter)

*Vérification sommaire (recherches FR) : aucun des 8 ne correspond à un produit vétérinaire/santé animale connu. Réserve : faire un check INPI/marques avant de graver.*

| Nom | Justification |
|---|---|
| **Goupil** | Le nom médiéval du renard (Roman de Renart) — français, malin, chaleureux ; conflits hors secteur seulement (véhicules électriques Goupil, ancien ordinateur SMT Goupil). |
| **Renart** | La graphie littéraire originale (avec un t) — clin d'œil cultivé, « ruse bienveillante », prononciation évidente. |
| **Rox** | Le renard de « Rox et Rouky » — capital affectif immédiat chez les 30-55 ans, une syllabe (« demande à Rox ») ; ne pas utiliser l'imagerie Disney. |
| **Filou** | Malicieux et affectueux, prénom d'animal de compagnie ultra-courant — résonance parfaite avec la clientèle des vétos. |
| **Vulpi** | Du latin *vulpes* — sonorité douce et un peu savante qui flatte un public scientifique, très disponible. |
| **Malo** | Prénom breton doux, évoque « malin » sans l'écrire — moderne, zéro connotation négative. |
| **Noisette** | La couleur rousse, tendre et rassurante — bon si l'avatar doit être bienveillant plutôt que rusé. |
| **Fennec** | Le petit renard des sables — réserve : nom de code historique de Firefox mobile (conflit tech, pas véto). |

**À éviter** : **Goupix** (Pokémon renard officiel) ; **Foxy/Fox** (anglicisme + Firefox) ; **Rouky** (c'est le chien — l'erreur ferait sourire les clients).

**LECTURE finale** : Goupil et Rox sont les deux plus forts — Goupil si le positionnement est « l'assistant malin qui connaît le métier », Rox si c'est « le compagnon attachant ». Filou = meilleur second choix « clientèle vétérinaire ».

---

## Ce qu'il faut retenir (synthèse en 5 lignes)

1. **Le positionnement est factuel mais l'ennemi réel est Excel** : aucun outil FR dédié aux gardes véto avec moteur à règles ; les médicaux US sont bien des usines à gaz (sauf Momentum) — d'où l'obligation d'ajouter l'IA comme différenciateur, pas juste la simplicité.
2. **La pièce à conviction anti-usine à gaz** : des utilisateurs QGenda abandonnent la génération automatique faute de comprendre les conflits — GuardVeto gagne en *expliquant* ses plannings.
3. **Jour 1** : premier planning généré en < 10 min, cabinet type pré-configuré, planning d'exemple à la Linear, checklist de 4 tâches, entretien d'arrivée mené par le renard (avec chemin classique parallèle).
4. **Le renard** : disponible mais jamais interruptif, reformule avant d'appliquer (l'humain valide), désactivable, chaque action IA doublée d'un chemin classique, journal de ses actions.
5. **Noms** : Goupil, Rox ou Filou en tête ; éviter Goupix, Foxy, Rouky ; vérifier l'INPI avant décision.
