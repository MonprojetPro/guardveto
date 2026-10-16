// ============================================================
// GUARDVETO — Le build ne doit dependre d'AUCUN appel reseau (B-166)
// ============================================================
// MiKL, 16/10 : « ca fait plusieurs fois que je recois des erreurs de
// deploiement ». Cause PROUVEE par le log Vercel du deploiement en echec
// (`vercel inspect --logs`) :
//
//   Error: Turbopack build failed with 32 errors:
//   Module not found: Can't resolve
//     '@vercel/turbopack-next/internal/font/google/font'
//   Error while looking up import map: next/font/google queries have
//     exactly one entry
//
// `next/font/google` telecharge les fichiers de police PENDANT LE BUILD. Dix
// variantes etaient demandees (6 Figtree + 4 Noto Sans) : dix occasions de
// faire sortir le build en 1 si Google repond mal.
//
// 🔑 POURQUOI UN TEST, ET PAS SEULEMENT UN CORRECTIF.
//
//    La panne etait INTERMITTENTE : sur les 15 derniers deploiements, un seul
//    en erreur, et celui d'apres reussissait SUR LE MEME CODE. Une panne qui
//    ne se reproduit pas ne se corrige pas durablement par la vigilance — elle
//    revient le jour ou quelqu'un reecrit `import { Inter } from
//    'next/font/google'` en toute bonne foi, et il faudra TOUT reprendre
//    depuis le mail d'echec.
//
// ⚠️ ET LE SYMPTOME ETAIT DEJA VISIBLE EN LOCAL LE MATIN MEME : le build
//    affichait des dizaines de `module-not-found` sur
//    `[next]/internal/font/google/figtree_….module.css`, ecartees comme « du
//    bruit de fetch hors-ligne » parce que la ligne `Compiled successfully`
//    suivait. **Un build qui reussit peut crier** — et ce test transforme ce
//    cri en rouge, c'est-a-dire en quelque chose qui s'execute sans qu'on y
//    pense.
//
// ⚠️ CE QUE CE TEST NE COUVRE PAS : les autres facons de dependre du reseau au
//    build (un `fetch` en haut d'un module de page, un plugin qui va chercher
//    une ressource). Il attrape le cas qui s'est REELLEMENT produit, et il est
//    ecrit pour qu'on puisse lui en ajouter d'autres.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function fichiersSource(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...fichiersSource(p))
    else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

/**
 * Les lignes de code, commentaires retires.
 *
 * ⚠️ NECESSAIRE, pas cosmetique : `layout.tsx` CITE `next/font/google` dans le
 *    commentaire qui explique pourquoi il ne l'utilise plus. Un test qui
 *    rougirait sur sa propre explication serait neutralise dans la semaine.
 */
function codeSeul(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

describe('🔦 Aucun appel reseau pendant le build', () => {
  it('⛔ personne n’importe `next/font/google` — les polices vivent dans le depot', () => {
    const fautifs = fichiersSource(SRC).filter((f) =>
      /from\s+['"]next\/font\/google['"]/.test(codeSeul(readFileSync(f, 'utf8'))),
    )

    expect(
      fautifs.map((f) => f.replace(process.cwd(), '')),
      'next/font/google telecharge les polices PENDANT le build : le build devient\n' +
        'dependant du reseau, donc non reproductible, et il tombe par intermittence\n' +
        '(log Vercel du 16/10 : « Turbopack build failed with 32 errors »).\n' +
        'Utiliser `next/font/local` avec les woff2 de `src/fonts/`.',
    ).toEqual([])
  })

  it('les dix variantes attendues sont bien presentes dans le depot', () => {
    // Si un fichier manquait, `next/font/local` echouerait au build — mais
    // seulement au build. Le dire ici, c'est le dire en 2 secondes.
    const attendus = [
      ...[300, 400, 500, 600, 700, 800].map((p) => `figtree-${p}.woff2`),
      ...[300, 400, 500, 700].map((p) => `noto-sans-${p}.woff2`),
    ]
    const presents = readdirSync(join(SRC, 'fonts'))
    for (const a of attendus) expect(presents, `${a} manque`).toContain(a)
  })

  it('ce sont de vrais woff2, pas des pages d’erreur enregistrees par erreur', () => {
    // Un telechargement qui rend du HTML (403, captcha, redirection) produit un
    // fichier de la bonne TAILLE et du mauvais TYPE. La signature ne ment pas.
    const dossier = join(SRC, 'fonts')
    for (const f of readdirSync(dossier).filter((x) => x.endsWith('.woff2'))) {
      const entete = readFileSync(join(dossier, f)).subarray(0, 4).toString('latin1')
      expect(entete, `${f} n’est pas un woff2`).toBe('wOF2')
    }
  })
})
