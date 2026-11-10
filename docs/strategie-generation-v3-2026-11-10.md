# Repenser la génération des gardes — stratégie du 10/11/2026 (B-196)

> Issue d'une confrontation Claude / Codex demandée par MiKL. Les deux stratégies ont été écrites
> indépendamment, puis confrontées sur leurs désaccords. Rien n'est codé : document de décision.

## Le principe

**L'admin parle, Filou traduit, le moteur garantit.** L'IA n'écrit jamais le planning elle-même :
elle transforme une phrase en consigne précise, que l'admin confirme, et que le moteur respecte.
Aucun appel IA pendant la génération : elle reste gratuite et dure quelques secondes.

## Ce que la confrontation a tranché

| Sujet | Claude | Codex | Retenu |
|---|---|---|---|
| Changer de moteur (CP-SAT, service Python) | Non | Oui, en lot 4 | **Non.** Codex a retiré sa proposition : le problème est l'expression et le calibrage, pas la recherche. À rouvrir seulement si, sur 30 scénarios figés, 3 ou plus n'aboutissent pas en 60 s alors qu'une solution existe. |
| Forme des consignes | Petit vocabulaire fermé | Langage composable général | **Petit vocabulaire fermé d'abord.** Le risque d'un langage général : une traduction fausse mais crédible. On l'étend à partir des demandes réelles. |
| Par quoi commencer | Les consignes | L'équité et un banc d'essai | **Corriger d'abord le socle d'équité (court), puis les consignes.** Sinon Filou promettrait une équité que le moteur ne tient pas. |

## Ce que Codex a trouvé et que Claude n'avait pas vu (vérifié dans le code)

- L'équité d'une période à l'autre ne reprend que l'écart de **week-ends** de la **seule période
  précédente** (`loader.ts`, lecture de `bonus_malus.ecart_we`).
- Le score final, celui qui accepte ou refuse les améliorations du moteur, **ne connaît pas** ce
  report (`score-lexicographique.ts` : 0 occurrence de `bonusMalus` ; `scorerCandidatLNS` :
  « indépendant du bonusMalus »). Le rattrapage posé au premier jet peut donc être défait ensuite.
- Une condition qui dépend du planning en cours de calcul peut tourner en rond : commencer par des
  conditions calculables **avant** la génération (qui est absent quelle semaine).
- Mesurer la réussite du calibrage au **nombre de corrections avant publication**, pas à la
  ressemblance case par case : un ancien planning peut contenir des compromis subis.

## Les lots

| Lot | Contenu | Ce que l'admin y gagne |
|---|---|---|
| 0 — Socle | Grand livre d'équité (réalisé, attendu, écart cumulé, toutes dimensions) connu du score final ; banc d'essai rejouant de vraies périodes | Le rattrapage d'une période sur l'autre devient réel |
| 1 — Consignes | Phrase → consigne confirmée. Deux premières : « ménager quelqu'un sur une période » et « si tout le monde est là une semaine, ceux du week-end ne font pas la semaine ». Après génération : tenue / pas tenue, et pourquoi | La demande d'origine |
| 2 — Retouches | « Décharge X la semaine du 12 » → le moteur ne refait que cette partie, montre avant/après. Option « retenir pour la suite » | Réajuster sans tout régénérer |
| 3 — Calibrage par l'exemple | Lire 2 ou 3 anciens plannings du cabinet, proposer les habitudes repérées ; l'admin trie : règle, préférence ou arrangement ponctuel | Fin du réglage à l'aveugle |
| 4 — Écrans | Trois entrées : fonctionnement habituel, exceptions de cette période, corrections. Les règles détaillées passent en mode expert | Fin de l'usine à gaz |

## Coût et temps (estimations, à mesurer au lot 1)

- Génération : 0 appel IA, quelques dizaines de secondes comme aujourd'hui.
- Une consigne : un appel court, quelques secondes, de l'ordre de quelques centimes (estimation de
  Codex : 0,01 à 0,05 $).

## Risques assumés

1. Une reformulation convaincante peut masquer un malentendu → chaque consigne affiche un exemple
   concret de son effet avant confirmation.
2. Trop d'exceptions rendent le planning impossible → le moteur dit laquelle bloque.
3. Un allègement devient une dette sans qu'on l'ait voulu → « rattrapé plus tard » ou « offert »
   se choisit à chaque consigne.
4. Les anciens plannings reproduisent des injustices → l'admin valide chaque habitude repérée.
5. Une demande hors vocabulaire → Filou dit qu'il ne sait pas encore la tenir, il n'improvise pas.
