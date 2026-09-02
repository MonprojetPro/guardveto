-- ============================================================
-- GUARDVETO — Tracer aussi les tentatives qui n'ont RIEN démarré (B-104)
-- ============================================================
-- Deux heures après avoir posé le traceur, l'incident s'est reproduit — et la
-- table est restée VIDE. MiKL : « ça a bugué, j'ai voulu régénérer, regarde. »
-- Mesure : zéro ligne pour sa tentative, aucun verrou posé.
--
-- ── L'INSTRUMENT ÉTAIT AVEUGLE EXACTEMENT LÀ OÙ ÇA CASSE ───────────────────
--
-- Deux angles morts, tous deux dans le code écrit une heure plus tôt :
--
--   ① `ouvrirTrace` était appelé APRÈS l'acquisition du verrou. Tout échec
--      antérieur — refus 409, requête jamais partie — n'écrivait rien.
--   ② Le témoin du navigateur commençait par « sans traceId, je me tais ».
--
-- Les deux moitiés étaient donc muettes sur la MÊME zone. Et c'est le défaut
-- que la migration précédente dénonçait en toutes lettres, reproduit un cran
-- plus tôt dans la chaîne : une trace qui ne garde que ce qui a déjà commencé
-- à bien se passer.
--
-- ── CE QUE MiKL A CONFIRMÉ, ET QUI ORIENTE TOUT ────────────────────────────
--
-- « La fenêtre s'est fermée. » Or aucune trace ne s'est ouverte. La fermeture
-- est donc probablement la CAUSE et non la conséquence : l'écran disparaît, le
-- `fetch` est annulé avec lui, le serveur ne commence jamais rien.
--
-- C'est précisément ce que le témoin de démontage devait dire — et il s'est tu.
--
-- ── DEUX ÉTATS À NE JAMAIS CONFONDRE ───────────────────────────────────────
--
--   `fermee_le IS NULL`            → le serveur avait commencé, il est MORT.
--   `issue = 'abandon_client'`     → le serveur n'a JAMAIS commencé, et seul
--                                    le navigateur peut en témoigner.
--
-- Ce sont des causes opposées. Les ranger sous un même symptôme reviendrait à
-- refaire le diagnostic à l'aveugle, ce que ce projet a déjà payé trois mois.
-- ============================================================

alter table public.generations_trace drop constraint if exists generations_trace_issue_check;

alter table public.generations_trace
  add constraint generations_trace_issue_check
  check (issue in ('complet', 'partiel', 'echec', 'erreur', 'refusee', 'abandon_client'));

comment on column public.generations_trace.issue is
  'complet/partiel/echec : les trois issues de B-053. erreur : exception. refusee : le verrou a refuse le depart (une generation tournait deja). abandon_client : le navigateur a signale que l ecran a disparu, sans qu aucune generation ne demarre cote serveur. NULL = jamais fermee, la fonction est morte sans pouvoir ecrire.';

comment on column public.generations_trace.periode_id is
  'La periode visee. Renseignee meme quand rien n a demarre : une tentative avortee vise une periode, et c est par elle qu on la retrouve.';
