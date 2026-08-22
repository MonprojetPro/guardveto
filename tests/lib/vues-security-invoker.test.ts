// ============================================================
// Une vue recréée garde-t-elle son `security_invoker` ?
// ============================================================
// L'INCIDENT — 2026-08-22, découvert lors d'un audit CERBÈRE.
//
// `planning_semaine` et `compteurs_gardes` s'exécutaient sans RLS. Relevé en
// base, avant correctif :
//
//     set role anon;  select count(*) from planning_semaine;  →  66
//
// `anon` est le visiteur NON CONNECTÉ. La clé publishable qui l'active est
// publique par construction (elle est dans le bundle JS du navigateur). Le
// planning de gardes de tous les cabinets était donc lisible par n'importe qui,
// en un appel REST direct — les bornes `.eq('cabinet_id', …)` posées dans les
// lecteurs TypeScript protègent les écrans, pas l'API.
//
// LA CAUSE, ET C'EST ELLE QU'ON GARDE ICI :
//
//     CREATE OR REPLACE VIEW ne préserve PAS l'option `security_invoker`.
//
// L'option avait été posée en migration 010 et re-posée à la main par les
// quatre migrations suivantes qui recréaient la vue. Elle est tombée les 20 et
// 21 août 2026, sur trois migrations d'affilée où personne n'y a pensé. Rien
// n'a protesté : une vue sans RLS ne lève aucune erreur, elle rend simplement
// PLUS de lignes qu'elle ne devrait. Un défaut de sécurité silencieux, dont le
// symptôme visible est l'absence de symptôme.
//
// CE QUE CE TEST GARDE : pour chaque vue sensible, on rejoue les migrations
// dans l'ordre chronologique. Toute migration qui la RECRÉE doit reposer
// l'option — soit dans le même fichier, soit dans un fichier ultérieur. La
// dernière opération vue dans la chronologie doit être une pose, jamais une
// création nue.
//
// Aucune connexion réseau : le test lit les fichiers de migration, comme
// `colonnes-lues.test.ts` lit les sources. Il tourne donc en CI sans secret.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Les vues qui portent des données de plusieurs cabinets et DOIVENT donc
 * s'exécuter avec les droits de leur lecteur.
 *
 * En ajouter une ici est le bon réflexe dès qu'une nouvelle vue lit une table
 * porteuse de `cabinet_id`.
 */
const VUES_SENSIBLES = ['planning_semaine', 'compteurs_gardes'] as const

const DOSSIER_MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations')

/**
 * Les migrations déjà jouées en production qui recréent une vue sans reposer
 * l'option. On ne réécrit pas l'histoire : une migration jouée est figée, la
 * corriger ne changerait rien à la base et casserait la reproductibilité.
 *
 * ⚠️ CETTE LISTE NE DOIT JAMAIS S'ALLONGER. Si le test t'y renvoie pour une
 * migration que tu viens d'écrire, la réponse n'est pas de l'ajouter ici :
 * c'est d'ajouter en fin de ta migration
 *
 *     ALTER VIEW public.<vue> SET (security_invoker = true);
 *
 * Les trois dernières de cette liste sont précisément celles qui ont laissé la
 * porte ouverte du 20 au 22 août 2026. `002_views.sql` est d'une autre nature :
 * elle crée les vues avant que l'option n'existe dans le projet, et `010` la
 * pose juste derrière.
 */
const DETTE_HISTORIQUE: Record<string, string[]> = {
  planning_semaine: ['002_views.sql', '20260820151000_planning_semaine_applique_exceptions.sql'],
  compteurs_gardes: ['002_views.sql', '20260820152000_compteurs_jours_1er_we_exceptionnels.sql'],
}

/** Les migrations, dans l'ordre où Supabase les joue (préfixe chronologique). */
function migrationsOrdonnees(): { fichier: string; sql: string }[] {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((fichier) => ({
      fichier,
      sql: readFileSync(join(DOSSIER_MIGRATIONS, fichier), 'utf8'),
    }))
}

/**
 * Retire les commentaires SQL avant toute analyse.
 *
 * Sans ça, les longs en-têtes de ce projet — qui citent volontiers
 * `CREATE OR REPLACE VIEW planning_semaine` pour raconter l'incident — se
 * feraient prendre pour du code exécuté. Le test crierait sur des explications.
 */
function sansCommentaires(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((ligne) => ligne.replace(/--.*$/, ''))
    .join('\n')
}

/** La migration recrée-t-elle cette vue ? (`CREATE [OR REPLACE] VIEW x`) */
function recreeLaVue(sql: string, vue: string): boolean {
  const motif = new RegExp(
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?${vue}"?\b`,
    'i',
  )
  return motif.test(sql)
}

/** La migration pose-t-elle l'option sur cette vue ? (`ALTER VIEW x SET (…)`) */
function poseLOption(sql: string, vue: string): boolean {
  const motif = new RegExp(
    String.raw`\bALTER\s+VIEW\s+(?:public\.)?"?${vue}"?\s+SET\s*\(\s*security_invoker\s*=\s*(?:on|true)\s*\)`,
    'i',
  )
  return motif.test(sql)
}

/** La migration RETIRE-t-elle l'option ? (`RESET` ou `SET (… = off)`) */
function retireLOption(sql: string, vue: string): boolean {
  const reset = new RegExp(
    String.raw`\bALTER\s+VIEW\s+(?:public\.)?"?${vue}"?\s+RESET\s*\(\s*security_invoker`,
    'i',
  )
  const desactive = new RegExp(
    String.raw`\bALTER\s+VIEW\s+(?:public\.)?"?${vue}"?\s+SET\s*\(\s*security_invoker\s*=\s*(?:off|false)\s*\)`,
    'i',
  )
  return reset.test(sql) || desactive.test(sql)
}

describe('security_invoker sur les vues multi-cabinet', () => {
  const migrations = migrationsOrdonnees().map(({ fichier, sql }) => ({
    fichier,
    sql: sansCommentaires(sql),
  }))

  it('le dossier de migrations est bien lu', () => {
    expect(migrations.length).toBeGreaterThan(0)
  })

  it.each(VUES_SENSIBLES)(
    'la dette historique de `%s` ne contient aucune dispense devenue inutile',
    (vue) => {
      // Une dispense qui ne correspond plus à rien est un trou : elle survit à
      // la suppression du fichier qu'elle couvrait et pourrait un jour dispenser
      // une migration homonyme. On la retire dès qu'elle ne sert plus.
      const encoreFautives = new Set(
        migrations
          .filter(({ sql }) => recreeLaVue(sql, vue) && !poseLOption(sql, vue))
          .map(({ fichier }) => fichier),
      )
      const inutiles = (DETTE_HISTORIQUE[vue] ?? []).filter((f) => !encoreFautives.has(f))

      expect(
        inutiles,
        `Ces dispenses de DETTE_HISTORIQUE['${vue}'] ne couvrent plus rien — retire-les :\n` +
          inutiles.map((f) => `  • ${f}`).join('\n'),
      ).toEqual([])
    },
  )

  it.each(VUES_SENSIBLES)(
    "`%s` a bien `security_invoker` posé à l'issue de toutes les migrations",
    (vue) => {
      // On rejoue la chronologie. `protegee` suit l'état de l'option après
      // chaque fichier, exactement comme la base le ferait.
      let protegee = false
      let derniereMigrationQuiCasse: string | null = null

      for (const { fichier, sql } of migrations) {
        if (recreeLaVue(sql, vue)) protegee = false // CREATE OR REPLACE efface l'option
        if (retireLOption(sql, vue)) protegee = false
        if (poseLOption(sql, vue)) protegee = true

        if (!protegee && (recreeLaVue(sql, vue) || retireLOption(sql, vue))) {
          derniereMigrationQuiCasse = fichier
        }
      }

      expect(
        protegee,
        derniereMigrationQuiCasse
          ? `La vue \`${vue}\` sort des migrations SANS \`security_invoker\`.\n` +
              `Dernière migration qui la laisse ouverte : ${derniereMigrationQuiCasse}\n\n` +
              `Rappel : CREATE OR REPLACE VIEW ne préserve pas l'option. Ajoute, ` +
              `à la fin de cette migration ou dans une nouvelle :\n` +
              `    ALTER VIEW public.${vue} SET (security_invoker = true);\n\n` +
              `Sans elle, la vue s'exécute avec les droits de \`postgres\` ` +
              `(rolbypassrls) : ni le rôle, ni le cabinet ne filtrent, et le rôle ` +
              `\`anon\` — le visiteur non connecté — lit tout.`
          : `La vue \`${vue}\` n'a jamais reçu \`security_invoker\` dans les migrations.`,
      ).toBe(true)
    },
  )

  it.each(VUES_SENSIBLES)(
    'chaque migration qui recrée `%s` repose l\'option dans le même fichier',
    (vue) => {
      // Règle plus stricte que la précédente, et volontairement : une migration
      // ne doit pas laisser la porte ouverte, même une seule migration durant.
      // Entre les deux, la base tourne réellement dans cet état.
      const dette = DETTE_HISTORIQUE[vue] ?? []
      const fautives = migrations
        .filter(({ sql }) => recreeLaVue(sql, vue) && !poseLOption(sql, vue))
        .map(({ fichier }) => fichier)
        .filter((fichier) => !dette.includes(fichier))

      expect(
        fautives,
        `Ces migrations recréent \`${vue}\` sans reposer \`security_invoker\` :\n` +
          fautives.map((f) => `  • ${f}`).join('\n') +
          `\n\nAjoute en fin de fichier :\n` +
          `    ALTER VIEW public.${vue} SET (security_invoker = true);\n\n` +
          `N'ajoute PAS ta migration à DETTE_HISTORIQUE — cette liste ne couvre ` +
          `que des migrations déjà jouées en production, qu'on ne réécrit plus.`,
      ).toEqual([])
    },
  )
})
