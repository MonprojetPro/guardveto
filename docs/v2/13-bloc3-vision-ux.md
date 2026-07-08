# Bloc 3 — Vision UX : « le cabinet qui vient de s'abonner »

> Synthèse de la réflexion d'ensemble (2026-07-08), nourrie par l'audit interne
> (doc 12) et le benchmark marché (doc 11). Cadrage MiKL : penser depuis le
> cabinet qui vient de s'abonner ; simplicité SANS perdre liberté/visibilité ;
> moderne, IA-first ; assistant = RENARD (décision ferme). Statut : **vision
> proposée, en attente d'arbitrage MiKL avant tout découpage.**

---

## 1. Ce qu'attend un cabinet qui vient de payer

Il n'attend pas un logiciel : il attend de **rendre son dimanche**. Aujourd'hui son
planning de gardes se fait sur Excel + SMS (3-5 h/semaine, benchmark doc 11) et la
convention collective lui impose de notifier chaque salarié 1 mois à l'avance.
Son attente au jour 1 tient en trois phrases :

1. « Montre-moi vite un planning qui tient debout. » (aha < 10 minutes — les
   études 2025 : aha < 5 min = +40 % de rétention à 30 jours)
2. « Laisse-moi dire NOS règles avec MES mots. »
3. « Laisse-moi voir et corriger ce qui est défini — c'est moi la responsable. »

L'ennemi marketing n'est pas QGenda : c'est Excel. Mais la leçon QGenda est
capitale : ses utilisateurs **abandonnent la génération automatique** quand les
règles deviennent opaques. Notre arme n'est donc pas « on génère aussi », c'est
**« on explique tout, en français, et tu restes maître »** — ce que le moteur
sait déjà faire (rendreRegle, pré-vol, diagnostic vérifié, gates honnêtes).

## 2. Le diagnostic en une phrase

La puissance est là (26 briques, deux gardiens, IA sur 19 types de règles) mais
elle est livrée **sans séquencement** (aucun chemin jour 1), **en double**
(2 systèmes de règles, 2 portes pour la liaison WE, 3 assistants IA anonymes)
et **dans le vocabulaire du moteur** (briques, forces vs importances, cohortes,
profils, ancres). L'usine à gaz n'est pas la puissance — c'est la tuyauterie
qui fuit dans l'interface.

## 3. La vision : 4 mouvements

### Mouvement 1 — Le renard devient LE fil conducteur 🦊

UN SEUL assistant (fusion des 3 existants), nommé, incarné (avatars fox-1..5
déjà dans le repo), accessible partout (panneau global, pas un encadré « bêta »
au milieu d'un écran). Quatre verbes :

- **Il accueille** : au jour 1, c'est lui qui mène l'entretien d'arrivée
  (« Vous êtes combien ? Qui fait les gardes ? Comment tournez-vous le
  week-end ? ») et remplit la configuration EN DIRECT, visiblement, à l'écran
  (pattern « setup conversationnel » 2025, réf. Intercom Fin). Piste forte :
  « envoie-moi ton planning Excel actuel, je comprends vos habitudes ».
- **Il crée** (déjà acquis) : règles, liaisons, profils, cohortes — en phrases.
- **Il explique** (NOUVEAU, la moitié manquante) : « pourquoi Manon ce
  week-end ? », « qu'est-ce qui est défini pour Victor ? », « pourquoi la
  génération a échoué ? » — il pilote la sortie d'impasse au lieu de renvoyer
  l'admin cliquer des liens.
- **Il célèbre sobrement** : « Planning publié, 12 semaines équitables. »
  Jamais de nagging (anti-pattern Duo/Clippy).

Garde-fous non négociables (benchmark volet 3) : il **reformule et l'humain
valide** avant toute application (notre pattern actuel, à généraliser) ; chaque
action IA a son équivalent bouton/formulaire visible (le renard est un
raccourci, jamais un péage) ; il est **réductible/désactivable** ; il tient un
**journal de ses actions** ; il ne parle jamais spontanément pendant qu'on
consulte (disponible, pas intrusif — sauf critique : planning invalide).

### Mouvement 2 — Un jour 1 séquencé (aha < 10 minutes)

- Un **écran d'accueil** (la racine ne redirige plus vers un calendrier vide)
  avec une **checklist de 4 étapes** : ① Ton équipe ② Vos habitudes de garde
  ③ Générer ④ Inviter les vétos. Persistante tant que non finie.
- **Cabinet type pré-configuré** (défauts intelligents) : le profil par défaut
  existe déjà côté produit — garde chaque nuit + week-end, repos pilote,
  équité standard. On ne configure pas AVANT de voir : on voit, puis on ajuste
  (« chez nous, Anne-Cat ne fait pas les gardes » → une phrase au renard).
- **Planning d'exemple pré-peuplé** à la première connexion (pattern Linear) :
  un cabinet fictif de 7 vétos, avec pastilles d'équité, un congé, un échange —
  le produit se comprend en le regardant, pas en lisant un tour guidé.
- La période « invisible » au jour 1 : « planifie jusqu'à fin décembre » suffit
  (lundi de départ et saison calculés automatiquement, plus de piège).

### Mouvement 3 — Réunifier : une notion, une porte

- **Une seule notion de « règles »** : résorber les contraintes legacy des
  fiches vétos (contraintes_veto) dans /regles — migration ou façade unique.
- **Une seule porte pour chaque réglage** : la liaison vendredi↔week-end vit à
  UN endroit ; « Structure du week-end » de /regles et « Créneaux liés » de
  /admin/structure fusionnent.
- **Vocabulaire 100 % métier à l'écran** : plus de « cohorte », « brique »,
  « ancre », « code machine », « BM hérité ». Les 2 échelles (force vs
  importance) se présentent sous UNE grammaire simple (ex. « obligatoire /
  important / si possible »), le moteur garde sa granularité en dessous
  (progressive disclosure : un mode « réglages avancés » conserve TOUT).
- **La tuyauterie sort du métier** : Google Calendar ID, Brevo → un écran
  « Connexions » à part, jamais entre deux réglages de garde.
- **Navigation regroupée** : 11 entrées plates → ~5 groupes vécus
  (Planning · Absences & échanges · Équipe · Règles du cabinet · Réglages).
- Les « profils de planning » deviennent invisibles tant qu'on n'en a qu'un.

### Mouvement 4 — La visibilité, renforcée (la contrepartie de la simplicité)

- **Une vue « Tout ce qui est défini »** : l'intégralité de la configuration en
  phrases françaises (rendreRegle est déjà là), consultable par vétérinaire
  (« tout ce qui concerne Manon ») et par thème. C'est LA réponse à « liberté
  et visibilité maximales ».
- **Récap avant génération** : « 12 règles fermes, 8 préférences, effectif 2,
  profil Hiver » — pas seulement les anomalies.
- **Journal du renard** : tout ce que l'IA a créé/modifié, traçable.
- On garde tels quels les bijoux existants : pré-vol, diagnostic vérifié par
  replay, gate de publication avec réserves, re-validation temps réel.

## 4. Le nom du renard (à trancher par MiKL, vérif INPI avant de graver)

Tête de liste du benchmark : **Goupil** (le renard du Roman de Renart —
français, malin, patrimoine, sérieux souriant), **Rox** (capital affectif
immédiat, une syllabe), **Filou** (prénom d'animal de compagnie ultra-courant
chez la clientèle des vétos). Autres pistes : Renart, Vulpi, Malo, Noisette,
Fennec. À éviter : Goupix (Pokémon), Foxy/Fox (Firefox), Rouky (c'est le chien).

## 5. Ce que ça change pour la recette et la suite

La recette des vagues 4/5/6 (gelée par MiKL) se fera naturellement à travers le
nouveau parcours : dicter au renard « équilibre les week-ends entre les
juniors » est le test des cohortes ; « Manon ne veut pas faire le 24 ET le
31 » celui du XOR. Le Bloc 3 EST la recette rendue possible.

Découpage pressenti (à affiner après arbitrage) : T1 fondations du renard
(fusion + identité + panneau global) → T2 jour 1 (accueil, checklist, défauts,
exemple) → T3 réunification règles/structure/vocabulaire → T4 vue « tout ce qui
est défini » + explications du renard. La refonte design visuelle reste la
phase finale (décision MiKL inchangée).
