// ============================================================
// GUARDVETO — Une classe sans regle ne casse rien, elle rend nu (B-163b ③)
// ============================================================
// 🔴 DEUXIEME OCCURRENCE EN CINQ JOURS.
//
//   09/10 (B-157a) — une variable CSS hors de portee et 11 classes orphelines.
//                    Une SONDE est ecrite ce jour-la pour les trouver.
//   14/10 (B-163b) — MiKL : « la fenetre est plus que degueu niveau visuel ».
//                    Les 9 classes `cpm-*` de `CellulePresenceModale` n'avaient
//                    AUCUNE regle, nulle part, depuis sa livraison le 06/10.
//
// 🔑 LA SONDE DU 09/10 EXISTAIT ET AURAIT TROUVE CELLES-LA AUSSI. Elle n'a
//    simplement jamais ete rejouee. **Un outil de detection qu'on n'execute pas
//    vaut exactement zero** — et c'est la raison d'etre de ce fichier : la
//    transformer en test, c'est-a-dire en quelque chose qui s'execute SANS
//    qu'on y pense.
//
// ⚠️ CE QUE CE TEST NE PEUT PAS FAIRE, et qu'il ne faut pas lui preter :
//    • il ne verifie PAS que la feuille est importee par la page (c'est l'autre
//      moitie du piege, celle de B-157b : « un style ne suit pas son composant,
//      il suit sa FEUILLE ») ;
//    • il ne verifie PAS que la regle est JOLIE, ni qu'elle s'applique
//      reellement (specificite, ordre) ;
//    • il ne voit que les classes ecrites en clair. Une classe construite par
//      concatenation (`` `pv2-${x}` ``) lui echappe.
//    Il attrape le cas le plus bete et le plus frequent : la regle qui n'a
//    jamais ete ecrite. C'est deja deux incidents sur deux.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = join(process.cwd(), 'src', 'styles')
const CHANTIER = join(process.cwd(), 'src', 'components', 'chantier')

/**
 * Les prefixes des classes « maison » du chantier.
 *
 * ⚠️ On ne releve QUE celles-la. Les classes shadcn et les utilitaires Tailwind
 *    n'ont par construction aucune regle dans nos feuilles : les inclure
 *    noierait le vrai signal sous des centaines de faux positifs, et un test
 *    qui crie tout le temps cesse d'etre lu.
 */
// ⚠️ `jdb-` AJOUTE LE 16/10, EN MEME TEMPS QUE LA FENETRE QU'IL SURVEILLE
//    (B-165, le tableau de bord journalier). Un registre de prefixes se
//    comporte comme tout registre : il recense ce qu'on a pense a y inscrire.
//    Livrer une fenetre dont le prefixe n'y figure pas, c'est la livrer sans
//    gardien — et le gardien serait VERT, ce qui est pire que pas de gardien
//    du tout. Meme mecanisme qu'au 14/10 (registre des juges, 5e occurrence).
const PREFIXES = ['pv2-', 'pv2h-', 'cpm-', 'gjc-', 'cl3-', 'lg-', 'plan-', 'crise-', 'jdb-']

function toutLeCss(): string {
  return readdirSync(STYLES)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(STYLES, f), 'utf8'))
    .join('\n')
}

/** Les classes maison citees par les composants du chantier, avec leur fichier. */
function classesDuChantier(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const noter = (classe: string, fichier: string) => {
    if (!PREFIXES.some((p) => classe.startsWith(p))) return
    if (!out.has(classe)) out.set(classe, new Set())
    out.get(classe)!.add(fichier)
  }

  for (const f of readdirSync(CHANTIER).filter((x) => x.endsWith('.tsx'))) {
    const source = readFileSync(join(CHANTIER, f), 'utf8')
    // `className="a b c"` et `className={cond ? 'a' : 'b'}`
    for (const m of source.matchAll(/className=(?:"([^"]*)"|\{[^}]*?'([^']*)')/g)) {
      for (const bloc of [m[1], m[2]]) {
        if (bloc) bloc.split(/\s+/).forEach((c) => noter(c, f))
      }
    }
    // Les classes empilees : `classes.push('pv2-x')`, `[...].join(' ')`
    for (const m of source.matchAll(/(?:push|join)\(\s*'([a-z0-9\- ]+)'/g)) {
      m[1].split(/\s+/).forEach((c) => noter(c, f))
    }
  }
  return out
}

describe('Les classes du chantier ont toutes une regle CSS', () => {
  it('🔦 aucune classe maison n’est orpheline', () => {
    const css = toutLeCss()
    const orphelines: string[] = []
    for (const [classe, fichiers] of classesDuChantier()) {
      if (!css.includes('.' + classe)) {
        orphelines.push(`${classe}  (cite par ${[...fichiers].sort().join(', ')})`)
      }
    }
    expect(
      orphelines,
      'Ces classes sont ecrites dans le JSX et n’ont AUCUNE regle CSS.\n'
        + 'Elles ne cassent rien — elles rendent l’ecran NU, en silence :\n  '
        + orphelines.join('\n  '),
    ).toEqual([])
  })

  it('la sonde releve bien quelque chose — sinon elle passerait a vide', () => {
    // ⚠️ Un test qui ne trouve RIEN a verifier passe au vert pour la mauvaise
    //    raison. Si le releve tombe a zero, c'est l'extracteur qui est casse,
    //    pas le code qui est devenu parfait.
    expect(classesDuChantier().size).toBeGreaterThan(50)
  })
})
