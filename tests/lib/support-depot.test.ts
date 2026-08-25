// ============================================================
// Le dépôt d'une demande de support tient-il ses promesses ?
// ============================================================
// Deux choses sont gardées ici, et la seconde compte plus que la première.
//
// ① LES REFUS SONT EN FRANÇAIS ET NOMMENT LE FAUTIF. Un « fichier invalide »
//    quand on en a sélectionné trois oblige à recommencer à l'aveugle.
//
// ② LES LIMITES NE PEUVENT PAS DIVERGER. La taille maximale et la liste des
//    formats existent en DEUX endroits : dans `lib/support/contraintes.ts`
//    (le confort, contournable en dix secondes avec les outils de
//    développement) et dans le bucket `support` de la migration
//    20260825120000 (la sécurité, hors d'atteinte du navigateur). Cette
//    duplication est volontaire — mais le jour où l'une bouge sans l'autre,
//    l'écran annonce une limite que le stockage refuse, ou l'inverse. C'est
//    exactement le mode de panne de ce projet : deux copies d'une même vérité
//    qui se désynchronisent en silence. Le test lit le SQL et compare.
//
// Aucune connexion réseau : on lit des fichiers, comme
// `vues-security-invoker.test.ts`.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FORMATS_ACCEPTES,
  NB_PIECES_MAX,
  nomDeFichierSur,
  poidsLisible,
  refusDemande,
  refusFichier,
  TAILLE_MAX_OCTETS,
} from '@/lib/support/contraintes'

const MIGRATION = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260825120000_support_demandes.sql',
)

describe('Les limites du navigateur et celles du bucket disent la même chose', () => {
  const sql = readFileSync(MIGRATION, 'utf8')

  it('la taille maximale du bucket est celle annoncée à l’écran', () => {
    // `file_size_limit` est la valeur qui compte : c'est elle qui refusera un
    // fichier trafiqué. Si elle diverge de TAILLE_MAX_OCTETS, l'écran ment.
    const trouve = sql.match(/^\s*(\d+),\s*--\s*10 Mo/m)
    expect(trouve, 'file_size_limit introuvable dans la migration').not.toBeNull()
    expect(Number(trouve![1])).toBe(TAILLE_MAX_OCTETS)
  })

  it('chaque format accepté à l’écran est accepté par le bucket', () => {
    // Un format proposé par le formulaire mais absent du bucket produit un
    // refus incompréhensible : la personne choisit un fichier que l'interface
    // lui a explicitement offert, et le dépôt échoue.
    const bloc = sql.slice(sql.indexOf('allowed_mime_types'))
    for (const format of FORMATS_ACCEPTES) {
      expect(bloc, `${format} manque dans allowed_mime_types`).toContain(`'${format}'`)
    }
  })

  it('le plafond de trois pièces jointes est aussi une contrainte de table', () => {
    // Sans la contrainte en base, « trois » ne veut dire trois que pour les
    // gens qui n'ouvrent pas les outils de développement.
    expect(sql).toContain(`cardinality(pieces_jointes) <= ${NB_PIECES_MAX}`)
  })

  it('la table n’accorde ni DELETE ni UPDATE libre', () => {
    // Une demande de support est un fait daté. Le seul UPDATE autorisé est
    // celui de l'auteur, et le trigger le borne aux colonnes d'envoi.
    expect(sql).not.toMatch(/CREATE POLICY[^;]*demandes_support[^;]*FOR DELETE/i)
    expect(sql).toContain('demandes_support_update_restreint')
  })

  it('l’isolation entre cabinets est RESTRICTIVE, jamais permissive', () => {
    // Une permissive `FOR ALL` rouvrirait l'escalade intra-cabinet fermée par
    // les migrations 20260617153000 et 20260618120000.
    const isolation = sql.slice(sql.indexOf('demandes_support_cabinet_isolation'))
    expect(isolation.slice(0, 400)).toContain('AS RESTRICTIVE')
  })

  it('le chemin de stockage est borné au cabinet, en dépôt comme en lecture', () => {
    // C'est le premier dossier du chemin qui sépare deux cabinets. Sans cette
    // comparaison, n'importe quel authentifié lirait les captures d'écran des
    // autres — la faille `security_invoker` du 22/08, transposée au stockage.
    const occurrences = sql.match(/\(storage\.foldername\(name\)\)\[1\] = public\.auth_cabinet_actif\(\)::text/g)
    expect(occurrences?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
})

describe('Un fichier refusé sait dire pourquoi', () => {
  it('accepte une capture d’écran ordinaire', () => {
    expect(refusFichier({ name: 'capture.png', size: 850_000, type: 'image/png' })).toBeNull()
  })

  it('accepte une photo d’iPhone (HEIC) — sinon la moitié de l’équipe est bloquée', () => {
    expect(refusFichier({ name: 'IMG_0421.heic', size: 2_400_000, type: 'image/heic' })).toBeNull()
  })

  it('refuse un format non prévu en nommant le fichier', () => {
    const refus = refusFichier({ name: 'planning.xlsx', size: 12_000, type: 'application/vnd.ms-excel' })
    expect(refus).toContain('planning.xlsx')
    expect(refus).toMatch(/image|PDF/)
  })

  it('juge le format AVANT le poids', () => {
    // Un tableur de 30 Mo ne sera jamais accepté : lui reprocher son poids
    // enverrait le compresser pour rien.
    const refus = refusFichier({ name: 'gros.xlsx', size: 30 * 1024 * 1024, type: 'application/vnd.ms-excel' })
    expect(refus).not.toContain('trop lourd')
  })

  it('refuse un fichier trop lourd en disant de combien', () => {
    const refus = refusFichier({ name: 'photo.jpg', size: 14 * 1024 * 1024, type: 'image/jpeg' })
    expect(refus).toContain('14,0 Mo')
    expect(refus).toContain('10,0 Mo')
  })

  it('refuse un fichier vide sans accuser la personne', () => {
    const refus = refusFichier({ name: 'vide.png', size: 0, type: 'image/png' })
    expect(refus).toContain('vide.png')
  })

  it('accepte le fichier qui pèse exactement la limite', () => {
    expect(refusFichier({ name: 'pile.png', size: TAILLE_MAX_OCTETS, type: 'image/png' })).toBeNull()
  })
})

describe('Le nom d’un fichier survit au voyage vers le stockage', () => {
  it('retire les accents, les espaces et les apostrophes', () => {
    // Le vrai nom d'une capture d'écran française. Supabase Storage refuse ou
    // mutile ces caractères ; le nom d'origine, lui, part dans l'e-mail.
    const sur = nomDeFichierSur("Capture d'écran 2026-08-25 à 10.10.12.png")
    expect(sur).toBe('capture-d-ecran-2026-08-25-a-10-10-12.png')
    expect(sur).toMatch(/^[a-z0-9.-]+$/)
  })

  it('garde l’extension, en minuscules', () => {
    expect(nomDeFichierSur('RAPPORT.PDF')).toBe('rapport.pdf')
  })

  it('ne rend jamais un nom vide', () => {
    expect(nomDeFichierSur('———.png')).toBe('fichier.png')
    expect(nomDeFichierSur('')).toBe('fichier.bin')
  })

  it('ne laisse pas remonter d’un dossier', () => {
    // `../../` dans un nom de fichier composerait un chemin hors du dossier du
    // cabinet. La policy du bucket le refuserait, mais autant ne pas le
    // fabriquer.
    const sur = nomDeFichierSur('../../secret.png')
    expect(sur).not.toContain('/')
    expect(sur).not.toContain('..')
  })
})

describe('Une demande incomplète est refusée avec des mots', () => {
  const bonne = { titre: 'Le planning est vide', description: 'Depuis ce matin je ne vois plus rien.' }

  it('laisse passer une demande normale', () => {
    expect(refusDemande(bonne)).toBeNull()
  })

  it('refuse un titre absent ou trop court', () => {
    expect(refusDemande({ ...bonne, titre: '  ' })).toContain('titre')
    expect(refusDemande({ ...bonne, titre: 'ok' })).toContain('titre')
  })

  it('refuse une description qui ne dit rien', () => {
    expect(refusDemande({ ...bonne, description: 'bug' })).toMatch(/Décris/)
  })

  it('refuse un titre à rallonge en disant de combien il dépasse', () => {
    const refus = refusDemande({ ...bonne, titre: 'a'.repeat(200) })
    expect(refus).toContain('200')
    expect(refus).toContain('140')
  })

  it('compte sur le texte détouré, pas sur les espaces', () => {
    expect(refusDemande({ titre: '   ok   ', description: `   ${'x'.repeat(5)}   ` })).not.toBeNull()
  })
})

describe('Un poids s’affiche comme on le lit', () => {
  it('parle en octets, kilo-octets et méga-octets', () => {
    expect(poidsLisible(512)).toBe('512 o')
    expect(poidsLisible(2048)).toBe('2 Ko')
    expect(poidsLisible(3_565_158)).toBe('3,4 Mo')
  })

  it('utilise la virgule française, jamais le point', () => {
    expect(poidsLisible(1_500_000)).not.toContain('.')
  })
})
