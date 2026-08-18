# Décisions produit — GuardVeto

Ce fichier garde les décisions de **périmètre commercial et fonctionnel** prises par MiKL :
ce qu'on fait, ce qu'on ne fait pas, et ce qu'on fait payer. Il ne décrit pas la technique
(voir `02-architecture.md`) ni les correctifs (voir `patch-log.md`) — il dit **pourquoi**
une fonction existe, a été retirée, ou est réservée.

---

## 2026-08-18 — La reprise d'historique devient une prestation payante

**Décision de MiKL.** L'import d'un ancien planning **n'est plus proposé dans
l'application**. La reprise de l'historique d'un cabinet est désormais une
**prestation d'accompagnement personnalisé**, réalisée par MiKL lui-même lors de
la configuration initiale — et **une option payante** pour les cabinets qui la
souhaitent.

Verbatim : *« je pense qu'il serait préférable que cette configuration de
l'historique des plannings soit une fonction que je ferai moi-même en
accompagnement personnalisé lors de la configuration initiale. Sinon j'ai peur
que ce soit trop complexe à mettre en automatique. […] Et comme ça ça casera une
option payante que je proposerai aux cabinets qui souhaiteraient que je paramètre
cela pour eux. »*

### Ce qui a motivé la décision

L'export réel de l'agenda du cabinet Val d'Allier — **8 456 événements sur neuf
ans (2018-2026)** — a servi de banc d'essai grandeur nature. Il a montré trois
obstacles que l'automatisation ne franchit pas seule :

| Obstacle | Mesure |
|---|---|
| L'agenda d'un cabinet n'est pas un planning de gardes | **20 %** des événements sont autre chose : réunions, vacances, formations, congrès, « pas de garde svp » — **952 libellés différents** |
| La convention d'écriture appartient au cabinet | Les gardes s'écrivent en sigles maison (`AS1`, `Man j`, `Victor 2`). La coder en dur ferait du sur-mesure Val d'Allier dans un produit générique |
| Une partie de l'historique n'est plus rattachable | **~1 900 gardes** appartiennent à d'anciens confrères (`l`, `mel`, `m`, `c`, `fab`, `leont`, `s`), et certains sigles sont irréductiblement ambigus — `M1`, c'est Mélanie, Manon ou Marie ? |

Ces trois points ont un dénominateur commun : **ils demandent quelqu'un qui
connaît le cabinet**. C'est exactement la définition d'une prestation, pas d'un
automatisme.

### Ce qui a été observé au passage (et qui reste vrai)

- **`1` et `2` sont des rangs de garde, pas des jours.** Prouvé sur les données :
  sur 2 682 jours portant un suffixe, 2 407 (90 %) portent un `1` **et** un `2` le
  même jour, et jamais la même personne (2 exceptions sur 2 407, des coquilles).
- **Suffixes relevés** : `1` (2 663), `2` (2 435), `j` journée (996), `am` matin
  (570), `journée` (87), `apm` (2).
- **Un export iCal vaut infiniment mieux qu'un PDF.** Dates exactes, aucune
  lecture visuelle, aucun appel facturé. Si la fonction est un jour rallumée,
  c'est par là qu'il faut entrer — pas par la photo.
- **Le rattachement des noms était cassé de toute façon** : sur 39 façons d'écrire
  les 7 vétos actuels relevées dans les documents réels, **28 n'étaient pas
  reconnues**, parce que le suffixe collé au sigle (`AS1`) empêche de retrouver la
  personne. Jean, noté `J`, ne l'était jamais.

### Ce qui a été fait dans le code

**Rien n'a été supprimé** — consigne explicite de MiKL : *« désactive-la, ne la
supprime pas, on sait jamais »*.

La chaîne complète (lecture du document, écran de validation ligne par ligne,
écriture, annulation) est **intacte et fonctionnelle**, derrière un unique
interrupteur : `IMPORT_PLANNING_ACTIF` dans `src/lib/import/actif.ts`.

L'interrupteur coupe **les deux bouts** :
1. le bouton « Importer un ancien planning » disparaît de l'écran Compteurs, ainsi
   que la phrase du chapeau qui l'annonçait ;
2. le serveur refuse, dans `contexteAdmin()` — le passage obligé de la route de
   lecture **et** de l'action d'écriture.

Repasser la constante à `true` rallume tout.

### Le besoin immédiat, qui reste entier

MiKL : *« on va juste repartir du mois d'août […] on veut juste que ceux qui
étaient de garde les derniers week-ends avant la nouvelle génération ne soient
pas les mêmes »*.

Ce n'est **pas** une reprise d'historique : c'est un amorçage minimal, sur
quelques week-ends, pour que la première génération ne redonne pas la garde aux
mêmes personnes. À traiter séparément — **question ouverte au 2026-08-18**.
