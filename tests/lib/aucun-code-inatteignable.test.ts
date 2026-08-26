// ============================================================
// Aucun fichier de src/ ne doit être inatteignable
// ============================================================
// L'EXIGENCE — MiKL, le 2026-08-26 :
//
//   « Ça m'inquiète, parce que je t'ai déjà commandé plusieurs passes pour
//    voir s'il y avait encore des traces de V1, et là je m'aperçois que oui. »
//
// POURQUOI CES PASSES NE POUVAIENT PAS MARCHER — c'est tout le sujet.
//
// Une passe de nettoyage cherche des TRACES : des mentions de « V1 », des
// imports vers d'anciens composants, des routes obsolètes. Or **un fichier mort
// n'a par définition aucune trace**. Il ne mentionne rien, personne ne le
// mentionne, il compile, il passe le lint, il n'apparaît dans aucun `grep`.
// Il est invisible à toute recherche par mot-clé.
//
// La question « reste-t-il des traces de V1 ? » ne pouvait donc pas les
// trouver. La seule qui les révèle est : « quels fichiers ne sont atteints par
// AUCUNE page ? » — et elle demande de construire le graphe des imports depuis
// les points d'entrée, pas de chercher des mots.
//
// CE QUE ÇA A COÛTÉ : le 26/08, un correctif réel — la `key` qui empêche de
// déclarer absent le MAUVAIS vétérinaire — a été posé dans `MonthView.tsx`, un
// fichier que rien n'importe. Il a passé la revue (la ligne était bien là) et
// n'avait aucun effet. Le défaut est resté en production une demi-journée de
// plus.
//
// CE QUE CE TEST FAIT : il repart des points d'entrée réels de Next (pages,
// layouts, routes API, middleware), suit les imports de proche en proche, et
// échoue si un fichier de `src/` n'est jamais atteint — sauf s'il figure dans
// `ATTENDUS_HORS_GRAPHE` ci-dessous, avec sa raison.
//
// Comme les registres de Filou et du tableau d'accueil, il refuse le SILENCE :
// un fichier qui sort du graphe doit être soit supprimé, soit déclaré.
//
// Aucune connexion réseau : on lit les fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, normalize, relative, extname, basename } from 'node:path'

const RACINE = join(__dirname, '..', '..', 'src')
const EXTS = ['.ts', '.tsx', '.js', '.jsx']

/**
 * Les fichiers qui n'ont PAS vocation à être importés par l'application, et
 * pourquoi. Toute entrée ici est une décision assumée, pas un oubli.
 *
 * ⚠️ AVANT D'AJOUTER UNE LIGNE : se demander si le fichier ne serait pas
 * simplement mort. La bonne réponse est alors de le supprimer, pas de le
 * déclarer ici — sinon ce test devient la liste de ce qu'on a renoncé à
 * nettoyer.
 */
const ATTENDUS_HORS_GRAPHE: Record<string, string> = {
  // NB : `proxy.ts` n'est PAS ici — il est traité comme un point d'entrée à
  // part entière (Next 16 a renommé `middleware.ts` ainsi et le charge
  // lui-même). Preuve qu'il tourne : « ƒ Proxy (Middleware) » en sortie de
  // `npm run build`. Le déclarer ici en plus serait le compter deux fois.
  // Les deux registres qui rendent le silence impossible. Ils sont lus par
  // leurs tests, pas par l'application : c'est exactement leur raison d'être.
  'lib/ia/couverture-produit.ts':
    'Registre « Filou suit le produit » (B-019). Lu par son test, volontairement hors application.',
  'lib/produit/attentes.ts':
    'Registre « le tableau ne peut pas se taire » (B-005). Lu par son test, volontairement hors application.',

  // ── Fondation posée d'avance, pas un vestige ──────────────────────────────
  // La distinction compte : le 26/08, 15 fichiers ont été supprimés parce
  // qu'ils étaient des restes de la V1. Ces deux-là ne le sont pas — ils
  // portent le modèle « roulement par place » (décision produit de MiKL), dont
  // l'en-tête dit explicitement : « La consommation par le moteur est la story
  // B4 — pas encore branchée. Table vide = comportement inchangé. »
  //
  // Les supprimer reviendrait à jeter une décision d'architecture parce qu'elle
  // n'a pas encore d'appelant. C'est exactement ce que ce test doit permettre
  // de distinguer : mort, ou en attente ASSUMÉE.
  'engine/roulement.ts':
    'Modèle « roulement par place » (Fondation B). Types et helpers purs ; le branchement au moteur est la story B4, non commencée.',
  'data/chargerRoulementCabinet.ts':
    'Le loader du roulement ci-dessus. Même story B4 : écrit d’avance, pas encore appelé.',

  // ── Un validateur de schéma que seul son test appelle ─────────────────────
  // Supprimé par erreur le 26/08 en le prenant pour un simple ré-export : il
  // DÉFINIT `validerConfigBrique`, et son test s'est cassé. Restauré.
  //
  // Il est déclaré ici, mais sans complaisance : un validateur que la
  // production n'appelle jamais ne valide rien. Soit on le branche là où une
  // config de brique entre dans le système, soit on l'admet comme une aide de
  // test. La question est ouverte — B-030 au board.
  'engine/briques/index.ts':
    'Définit `validerConfigBrique`, appelé uniquement par son test. À brancher ou à assumer comme outil de test (B-030).',
}

// ── Construction du graphe ──────────────────────────────────────────────────

function tousLesFichiers(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) out.push(...tousLesFichiers(chemin))
    else if (EXTS.includes(extname(entree))) out.push(chemin)
  }
  return out
}

const FICHIERS = tousLesFichiers(RACINE)
const SET_FICHIERS = new Set(FICHIERS)

/** Chemin relatif à `src/`, en séparateurs POSIX — la forme lisible. */
function cle(chemin: string): string {
  return relative(RACINE, chemin).split('\\').join('/')
}

/** Résout un specifier d'import vers un fichier de `src/`, ou null si externe. */
function resoudre(spec: string, depuis: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = normalize(join(RACINE, ...spec.slice(2).split('/')))
  else if (spec.startsWith('.')) base = normalize(join(dirname(depuis), spec))
  else return null // dépendance npm

  const candidats = [
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, 'index' + e)),
  ]
  for (const c of candidats) if (SET_FICHIERS.has(c)) return c
  return SET_FICHIERS.has(base) ? base : null
}

const RE_IMPORT =
  /(?:from\s+['"]([^'"]+)['"])|(?:import\s*\(\s*['"]([^'"]+)['"])|(?:require\(\s*['"]([^'"]+)['"])/g

function importsDe(fichier: string): string[] {
  let source: string
  try {
    source = readFileSync(fichier, 'utf8')
  } catch {
    return []
  }
  const out: string[] = []
  for (const m of source.matchAll(RE_IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3]
    const resolu = spec ? resoudre(spec, fichier) : null
    if (resolu) out.push(resolu)
  }
  return out
}

/** Les fichiers que Next appelle par CONVENTION, sans qu'on les importe. */
const NOMS_ENTREE = new Set([
  'page.tsx', 'page.ts', 'layout.tsx', 'layout.ts', 'route.ts',
  'loading.tsx', 'error.tsx', 'not-found.tsx', 'template.tsx',
  'global-error.tsx', 'default.tsx', 'sitemap.ts', 'robots.ts',
  'opengraph-image.tsx', 'icon.tsx',
])

function estTest(chemin: string): boolean {
  const k = cle(chemin)
  return k.includes('__tests__') || k.includes('.test.') || k.includes('.spec.') || k.endsWith('.d.ts')
}

const ENTREES = FICHIERS.filter((f) => {
  const k = cle(f)
  if (k.startsWith('app/') && NOMS_ENTREE.has(basename(f))) return true
  return k === 'middleware.ts' || k === 'instrumentation.ts' || k === 'proxy.ts'
})

const atteints = new Set<string>()
const pile = [...ENTREES]
while (pile.length > 0) {
  const f = pile.pop()!
  if (atteints.has(f)) continue
  atteints.add(f)
  pile.push(...importsDe(f))
}

// ── Le contrôle ─────────────────────────────────────────────────────────────

describe('Tout le code de src/ est atteignable depuis un écran', () => {
  it('le test ne passe pas à vide : les points d’entrée sont bien trouvés', () => {
    // Sans ce garde-fou, une erreur de résolution de chemin ferait passer le
    // test au vert en n'ayant rien parcouru — le défaut même qu'il traque.
    expect(ENTREES.length, 'aucun point d’entrée Next trouvé').toBeGreaterThan(20)
    expect(atteints.size, 'le parcours n’est pas descendu dans le graphe').toBeGreaterThan(150)
  })

  it('aucun fichier n’est inatteignable sans avoir été déclaré', () => {
    const orphelins = FICHIERS.filter((f) => !atteints.has(f) && !estTest(f))
      .map(cle)
      .filter((k) => !(k in ATTENDUS_HORS_GRAPHE))
      .sort()

    expect(
      orphelins,
      'Ces fichiers ne sont atteints par AUCUN écran. Un fichier mort ne laisse\n' +
        'aucune trace : il compile, il passe le lint, aucun grep ne le trouve.\n' +
        'C’est pour ça que les passes de nettoyage le ratent — et c’est ainsi\n' +
        'qu’un correctif a été posé dans du code mort le 2026-08-26.\n\n' +
        'Deux réponses possibles, jamais une troisième :\n' +
        '  • le supprimer (c’est presque toujours la bonne) ;\n' +
        '  • l’ajouter à ATTENDUS_HORS_GRAPHE avec la raison, s’il est\n' +
        '    réellement chargé autrement (convention du framework, test).\n\n' +
        orphelins.map((o) => `  '${o}': '…',`).join('\n'),
    ).toEqual([])
  })

  it('aucune déclaration ne désigne un fichier disparu', () => {
    // L'exigence porte dans les DEUX sens, comme pour les registres de Filou et
    // du tableau : une exemption orpheline vieillit sans qu'on le voie, et
    // finirait par couvrir un fichier qui n'existe plus.
    const fantomes = Object.keys(ATTENDUS_HORS_GRAPHE).filter(
      (k) => !FICHIERS.some((f) => cle(f) === k),
    )
    expect(
      fantomes,
      `Ces fichiers exemptés n’existent plus — retire-les de ATTENDUS_HORS_GRAPHE :\n${fantomes.join('\n')}`,
    ).toEqual([])
  })

  it('aucune déclaration ne couvre un fichier en réalité atteignable', () => {
    // Une exemption inutile est un mensonge tranquille : elle laisse croire
    // qu'un fichier vit hors du graphe alors qu'il y est entré depuis.
    const inutiles = Object.keys(ATTENDUS_HORS_GRAPHE).filter((k) =>
      FICHIERS.some((f) => cle(f) === k && atteints.has(f)),
    )
    expect(
      inutiles,
      `Ces fichiers sont maintenant atteints normalement : l’exemption n’a plus lieu d’être.\n${inutiles.join('\n')}`,
    ).toEqual([])
  })
})
