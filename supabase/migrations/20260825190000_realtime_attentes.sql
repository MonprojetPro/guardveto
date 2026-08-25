-- ============================================================
-- GUARDVETO — Le tableau doit pouvoir apprendre ce qui arrive
-- ============================================================
-- CONTEXTE (2026-08-25). Le « coup d'œil du matin » ne remontait que deux
-- choses et disait « rien à vérifier » ; les échanges de gardes proposés, les
-- échanges acceptés en attente de validation et les dettes de dépannage
-- dormaient sans que rien ne les signale. La correction ajoute des fiches à
-- l'accueil, et un abonnement temps réel pour qu'elles apparaissent seules.
--
-- ⚠️ POURQUOI CETTE MIGRATION EST INSÉPARABLE DU CODE QUI L'ACCOMPAGNE.
--
-- Un abonnement Realtime à une table absente de la publication ne renvoie
-- AUCUNE erreur. Il ne se déclenche simplement jamais. Le composant aurait
-- l'air branché, le code aurait l'air complet, et une dette de dépannage
-- créée sous les yeux de l'administratrice n'apparaîtrait pas — jusqu'à ce
-- que quelqu'un recharge la page et croie à un hasard.
--
-- C'est la règle de maison payée plusieurs fois sur ce projet : la chaîne se
-- vérifie de bout en bout, jamais au milieu. `conges`, `echanges_gardes`,
-- `gardes`, `periodes`, `notifications`, `regles_cabinet` et `veterinaires`
-- étaient déjà publiées ; `compensations` et `absences` ne l'étaient pas.
--
-- `absences` est ajoutée bien qu'aucune fiche ne l'exploite encore : elle est
-- le manque assumé du registre (`lib/produit/attentes.ts`, StatutAbsence.active),
-- et le jour où le compteur de créneaux découverts existera, la chaîne sera
-- déjà en place. Une table publiée sans consommateur ne coûte rien ; une
-- fiche branchée sur une table non publiée coûte une enquête.
--
-- IDEMPOTENTE : `ADD TABLE` échoue si la table est déjà membre de la
-- publication. Trois migrations de la même semaine se sont déjà marché
-- dessus sur ce projet (incident des vues `security_invoker`, 20-21/08) —
-- celle-ci doit pouvoir être rejouée sans casser un déploiement.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'compensations'
  ) then
    alter publication supabase_realtime add table public.compensations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'absences'
  ) then
    alter publication supabase_realtime add table public.absences;
  end if;
end $$;

-- Les deux tables de sauvegarde du 4 août, à l'origine des deux erreurs
-- rouges du Security Advisor, sont traitées à part :
-- `20260825191000_retirer_backups_du_4_aout.sql`. Une suppression
-- irréversible en production ne voyage pas au milieu d'une migration qui
-- parle d'autre chose — elle doit pouvoir être lue, discutée et jouée seule.
