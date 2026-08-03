// ============================================================
// Les colonnes qu'on demande à Supabase existent-elles ?
// ============================================================
// L'INCIDENT — 2026-08-02, deuxième panne du gardien en une heure.
//
// `data/verifierRegleCandidate.ts` lisait :
//
//     .from('periodes').select('id, nom, date_debut, date_fin, statut')
//
// La colonne s'appelle `libelle`. Il n'y a jamais eu de `nom` dans `periodes`.
//
// Ce qui rend l'erreur invisible : le client Supabase ne LÈVE PAS d'exception
// sur une colonne inconnue. Il renvoie `{ data: null, error: {...} }`. Le code
// faisait `(data ?? [])`, concluait « aucune période », et le gardien se taisait
// — sans le moindre message, ni à l'écran ni dans les logs. MiKL a posé six
// règles absurdes d'affilée sans que rien ne l'avertisse.
//
// `tsc` ne peut rien voir : le schéma de la base n'est pas typé ici.
//
// CE QUE CE TEST GARDE : la liste des colonnes que le code source demande,
// confrontée au schéma réel figé ci-dessous. Le schéma est recopié à la main
// (aucune connexion réseau dans les tests) — il se met à jour avec les
// migrations, comme n'importe quelle constante partagée.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Le schéma réel, relevé sur la base le 2026-08-02
 * (`information_schema.columns`). À compléter quand une migration ajoute une
 * table lue par les fichiers surveillés plus bas.
 */
const SCHEMA: Record<string, string[]> = {
  periodes: [
    'id', 'saison', 'numero', 'date_debut', 'date_fin', 'statut', 'publie_at',
    'created_at', 'rappel_15j_at', 'rappel_7j_at', 'libelle', 'cabinet_id',
    'snapshot_id', 'nb_vetos_semaine_soir', 'profil_id', 'generation_lock_at',
  ],
  veterinaires: [
    'id', 'user_id', 'nom', 'prenom', 'email', 'statut', 'role_app', 'actif',
    'dernier_recours', 'couleur', 'created_at', 'invite_pending', 'cabinet_id',
    'tags',
  ],
}

/** Les fichiers dont on vérifie les `.from(...).select(...)`. */
const SURVEILLES = [
  // Les requêtes ont déménagé de `verifierRegleCandidate.ts` vers ce module le
  // 2026-08-03 (le gardien est descendu au niveau serveur, pour toutes les
  // portes d'entrée). C'est ce test qui l'a signalé : il exige au moins un
  // `select` par fichier surveillé, et l'ancien n'en avait plus aucun.
  'src/data/controleImpact.ts',
]

/**
 * Extrait les couples (table, colonnes) d'un source : on cherche un
 * `.from('x')` suivi, dans les lignes qui suivent, d'un `.select('a, b, c')`.
 * Volontairement simple — les sélections dynamiques ou multi-lignes sont
 * ignorées plutôt que mal comprises.
 */
function selectsDe(source: string): Array<{ table: string; colonnes: string[] }> {
  const sortie: Array<{ table: string; colonnes: string[] }> = []
  const motif = /\.from\('([a-z_]+)'\)\s*(?:\r?\n\s*)?\.select\(\s*(['"`])([^'"`]+)\2/g
  let m: RegExpExecArray | null
  while ((m = motif.exec(source)) !== null) {
    const [, table, , liste] = m
    // Les jointures imbriquées (`a, b(c, d)`) sortent du cadre de ce contrôle.
    if (liste.includes('(')) continue
    sortie.push({
      table,
      colonnes: liste.split(',').map((c) => c.trim()).filter(Boolean),
    })
  }
  return sortie
}

describe('colonnes lues vs schéma réel', () => {
  it.each(SURVEILLES)('%s ne demande que des colonnes existantes', (chemin) => {
    const source = readFileSync(join(process.cwd(), chemin), 'utf-8')
    const selects = selectsDe(source)
    expect(selects.length).toBeGreaterThan(0)

    const fautes: string[] = []
    for (const { table, colonnes } of selects) {
      const connues = SCHEMA[table]
      if (!connues) continue // table hors périmètre du relevé
      for (const c of colonnes) {
        if (c !== '*' && !connues.includes(c)) fautes.push(`${table}.${c}`)
      }
    }
    expect(
      fautes,
      fautes.length === 0
        ? ''
        : `Colonnes inexistantes : ${fautes.join(', ')}. Supabase ne lève pas `
          + `d'exception là-dessus — il renvoie data: null, et le code d'appel `
          + `croit lire zéro ligne.`,
    ).toEqual([])
  })
})

describe('l’extracteur lui-même', () => {
  it('repère une colonne fautive (le bug d’origine)', () => {
    const faux = `const x = await supabase.from('periodes').select('id, nom, statut')`
    const [s] = selectsDe(faux)
    expect(s.table).toBe('periodes')
    expect(s.colonnes).toContain('nom')
    expect(SCHEMA.periodes).not.toContain('nom')
  })
})
