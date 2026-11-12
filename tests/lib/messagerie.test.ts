// ============================================================
// B-193 — La messagerie tient-elle ses promesses ?
// ============================================================
// Trois familles, de la moins grave à la plus grave :
//
// ① La logique pure : fusion sans doublon, liens cliquables sûrs, aperçu de
//    la liste, brouillon conservé.
// ② Les bornes ne divergent pas entre l'écran et la base (4000 caractères,
//    3 pièces, 10 Mo, formats) — deux copies d'une même vérité qui se
//    désynchronisent en silence, c'est le mode de panne de ce projet.
// ③ La migration porte les protections déjà payées ailleurs : isolation
//    RESTRICTIVE, `anon` sans droits, fonctions retirées à PUBLIC, tables
//    écoutées dans la publication temps réel, notification écrite par la base
//    (pas par l'expéditeur), module vérifié EN BASE.
//
// Aucune connexion réseau : on lit des fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  LONGUEUR_MESSAGE_MAX,
  NB_PIECES_MAX,
  apercuConversation,
  cheminDansConversation,
  cheminPiece,
  chiffreNonLus,
  decouperLiens,
  fusionnerMessage,
  initiales,
  libelleEnvoiMail,
  libelleJour,
  nomConversation,
  piecesDe,
  refusMessage,
  type ConversationListe,
  type MessageFil,
} from '@/lib/messagerie/regles'
import {
  AGE_MAX_BROUILLON_MS,
  effacerBrouillon,
  enregistrerBrouillon,
  lireBrouillon,
  type StockageBrouillon,
} from '@/lib/messagerie/brouillon'
import { FORMATS_ACCEPTES, TAILLE_MAX_OCTETS } from '@/lib/support/contraintes'
import { corpsMailMessage, sujetMailMessage } from '@/lib/emails/message'

const RACINE = join(__dirname, '..', '..')
const SQL = readFileSync(join(RACINE, 'supabase/migrations/20261106120000_b193_messagerie.sql'), 'utf8')
// Les commentaires retirés avant toute lecture : un commentaire qui contient
// le mot cherché a déjà rendu un gardien vert à tort (B-190, 05/11).
const SQL_CODE = SQL.split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')

const CAB = '3f1a2062-0512-4a83-b097-1801a8b90e5e'
const CONV = '11111111-2222-3333-4444-555555555555'

function msg(id: string, creeLe: string, extra: Partial<MessageFil> = {}): MessageFil {
  return {
    id,
    conversationId: CONV,
    auteurUserId: 'u1',
    auteurNom: 'Anne-Sophie Martin',
    corps: 'ok',
    pieces: [],
    creeLe,
    modifieLe: null,
    retireLe: null,
    mailEnvoyeA: null,
    mailEchecs: null,
    ...extra,
  }
}

function conv(extra: Partial<ConversationListe> = {}): ConversationListe {
  return {
    id: CONV,
    genre: 'equipe',
    autreUserId: null,
    autreNom: null,
    autreActif: true,
    dernierLe: '2026-11-06T10:00:00Z',
    dernierExtrait: 'Qui peut échanger le 12 ?',
    dernierAuteurNom: 'Fanny Durand',
    dernierDeMoi: false,
    dernierRetire: false,
    nbNonLus: 0,
    ...extra,
  }
}

function stockageMemoire(): StockageBrouillon & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>()
  return {
    donnees,
    getItem: (c) => donnees.get(c) ?? null,
    setItem: (c, v) => void donnees.set(c, v),
    removeItem: (c) => void donnees.delete(c),
  }
}

describe('① la fusion du fil', () => {
  it('le message optimiste et son retour temps réel ne font qu’UN (même identifiant)', () => {
    const optimiste = msg('a', '2026-11-06T10:00:00.000Z', { enEnvoi: true })
    const serveur = msg('a', '2026-11-06T10:00:00.400Z')
    const fil = fusionnerMessage(fusionnerMessage([], optimiste), serveur)
    expect(fil).toHaveLength(1)
    expect(fil[0].enEnvoi).toBeUndefined()
  })

  it('deux « ok » d’affilée restent DEUX messages (jamais de fusion sur le texte)', () => {
    const fil = fusionnerMessage([msg('a', '2026-11-06T10:00:00Z')], msg('b', '2026-11-06T10:00:01Z'))
    expect(fil.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('remet dans l’ordre chronologique un message arrivé en retard', () => {
    const fil = fusionnerMessage([msg('b', '2026-11-06T10:05:00Z')], msg('a', '2026-11-06T10:00:00Z'))
    expect(fil.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('① les liens d’un message', () => {
  it('rend cliquables les seules adresses http(s), ponctuation finale exclue', () => {
    const m = decouperLiens('Voir https://exemple.fr/planning. Merci')
    expect(m).toEqual([
      { texte: 'Voir ', lien: false },
      { texte: 'https://exemple.fr/planning', lien: true },
      { texte: '. Merci', lien: false },
    ])
  })

  it('ne rend JAMAIS cliquable un « javascript: »', () => {
    expect(decouperLiens('javascript:alert(1)').some((x) => x.lien)).toBe(false)
  })
})

describe('① la liste des conversations', () => {
  it('montre le DERNIER message et qui l’a écrit, au prénom', () => {
    expect(apercuConversation(conv())).toBe('Fanny : Qui peut échanger le 12 ?')
  })
  it('dit « Vous » pour son propre dernier message', () => {
    expect(apercuConversation(conv({ dernierDeMoi: true }))).toBe('Vous : Qui peut échanger le 12 ?')
  })
  it('ne montre pas le texte d’un message retiré', () => {
    expect(apercuConversation(conv({ dernierRetire: true }))).toBe('Message retiré')
  })
  it('une pièce jointe seule se lit « Pièce jointe »', () => {
    expect(apercuConversation(conv({ genre: 'privee', dernierExtrait: '' }))).toBe('Pièce jointe')
  })
  it('nomme le fil d’équipe et un ancien membre sans nom', () => {
    expect(nomConversation({ genre: 'equipe', autreNom: null })).toBe('Toute l’équipe')
    expect(nomConversation({ genre: 'privee', autreNom: null })).toBe('Ancien membre')
  })
  it('initiales et pastilles', () => {
    expect(initiales('Anne-Sophie Martin')).toBe('AM')
    expect(initiales('Secrétariat')).toBe('SE')
    expect(chiffreNonLus(0)).toBeNull()
    expect(chiffreNonLus(3)).toBe('3')
    expect(chiffreNonLus(250)).toBe('99+')
  })
  it('« Aujourd’hui », « Hier »', () => {
    const maintenant = new Date(2026, 10, 6, 15, 0)
    expect(libelleJour(new Date(2026, 10, 6, 9, 0).toISOString(), maintenant)).toBe('Aujourd’hui')
    expect(libelleJour(new Date(2026, 10, 5, 9, 0).toISOString(), maintenant)).toBe('Hier')
  })
})

describe('① le brouillon survit à la fermeture', () => {
  it('se relit, puis s’efface après envoi', () => {
    const s = stockageMemoire()
    enregistrerBrouillon(s, CONV, 'Je ne peux pas le 12')
    expect(lireBrouillon(s, CONV)).toBe('Je ne peux pas le 12')
    effacerBrouillon(s, CONV)
    expect(lireBrouillon(s, CONV)).toBeNull()
  })
  it('un texte vide efface au lieu d’enregistrer du vide', () => {
    const s = stockageMemoire()
    enregistrerBrouillon(s, CONV, 'abc')
    enregistrerBrouillon(s, CONV, '   ')
    expect(s.donnees.size).toBe(0)
  })
  it('un brouillon trop vieux ou corrompu est jeté', () => {
    const s = stockageMemoire()
    const t0 = new Date('2026-11-01T00:00:00Z')
    enregistrerBrouillon(s, CONV, 'vieux', () => t0)
    expect(lireBrouillon(s, CONV, () => new Date(t0.getTime() + AGE_MAX_BROUILLON_MS + 1))).toBeNull()
    s.setItem(`gv-messagerie-brouillon:${CONV}`, '{pas du json')
    expect(lireBrouillon(s, CONV)).toBeNull()
    expect(s.donnees.size).toBe(0)
  })
})

describe('② les refus et les chemins', () => {
  it('refuse le vide, le trop long, le trop de pièces — en français', () => {
    expect(refusMessage({ corps: '  ', nbPieces: 0 })).toMatch(/vide/)
    expect(refusMessage({ corps: '', nbPieces: 1 })).toBeNull()
    expect(refusMessage({ corps: 'x'.repeat(LONGUEUR_MESSAGE_MAX + 1), nbPieces: 0 })).toMatch(/trop long/)
    expect(refusMessage({ corps: 'ok', nbPieces: NB_PIECES_MAX + 1 })).toMatch(/Trois/)
  })

  it('un chemin n’est accepté que dans SA conversation de SON cabinet', () => {
    const bon = cheminPiece(CAB, CONV, 'ab12cd34', 'capture.png')
    expect(cheminDansConversation(bon, CAB, CONV)).toBe(true)
    expect(cheminDansConversation(bon, '00000000-0000-0000-0000-000000000001', CONV)).toBe(false)
    expect(cheminDansConversation(`${CAB}/${CONV}/../autre/x.png`, CAB, CONV)).toBe(false)
    expect(cheminDansConversation(`${CAB}/autre-conv/x.png`, CAB, CONV)).toBe(false)
  })

  it('ignore une pièce mal formée plutôt que de casser l’affichage', () => {
    expect(piecesDe([{ chemin: 'a/b/c', nom: 'x.png', taille: 3, type: 'image/png' }, { nom: 'sans chemin' }, null])).toHaveLength(1)
    expect(piecesDe('pas un tableau')).toEqual([])
  })

  it('les bornes de l’écran sont celles de la base', () => {
    expect(SQL_CODE).toContain(`char_length(corps) <= ${LONGUEUR_MESSAGE_MAX}`)
    expect(SQL_CODE).toContain(`jsonb_array_length(pieces_jointes) <= ${NB_PIECES_MAX}`)
    expect(SQL_CODE).toMatch(new RegExp(`'messagerie', 'messagerie', false, ${TAILLE_MAX_OCTETS}`))
    for (const f of FORMATS_ACCEPTES) expect(SQL_CODE).toContain(`'${f}'`)
  })
})

describe('③ la migration porte les protections déjà payées', () => {
  const TABLES = ['conversations', 'conversation_membres', 'messages', 'messagerie_lectures']

  it.each(TABLES)('%s : RLS active et isolation RESTRICTIVE', (t) => {
    expect(SQL_CODE).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    expect(SQL_CODE).toMatch(new RegExp(`CREATE POLICY ${t}_cabinet_isolation ON public\\.${t}\\s+AS RESTRICTIVE`))
  })

  it.each(TABLES)('%s : aucun droit pour le visiteur non connecté (anon)', (t) => {
    expect(SQL_CODE).toMatch(new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon`))
  })

  it('aucune policy ne s’ouvre à tout authentifié (USING (true))', () => {
    expect(SQL_CODE).not.toMatch(/USING\s*\(\s*true\s*\)/i)
    expect(SQL_CODE).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i)
  })

  it('aucune écriture directe sur conversations, membres, lectures (seules les fonctions écrivent)', () => {
    for (const t of ['conversations', 'conversation_membres', 'messagerie_lectures']) {
      expect(SQL_CODE).not.toMatch(new RegExp(`ON public\\.${t}\\s+FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated(?![\\s\\S]{0,40}RESTRICTIVE)`))
    }
  })

  it('aucune suppression de message (on retire, on n’efface pas)', () => {
    expect(SQL_CODE).not.toMatch(/ON public\.messages\s+FOR DELETE/)
  })

  it('les fonctions sont retirées à PUBLIC et anon', () => {
    expect(SQL_CODE).toContain("REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon")
    const declarees = [...SQL_CODE.matchAll(/CREATE OR REPLACE FUNCTION public\.(messagerie_\w+)\(/g)].map((m) => m[1])
    const triggers = ['messagerie_avant_insertion', 'messagerie_avant_modification', 'messagerie_apres_insertion']
    // Internes : retirées à TOUT LE MONDE, y compris aux comptes connectés.
    const internes = ['messagerie_membre_actif', 'messagerie_nom_de']
    for (const f of internes) {
      expect(SQL_CODE).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
      expect(SQL_CODE, `${f} ne doit jamais être accordée`).not.toMatch(new RegExp(`'${f}\\(`))
    }
    for (const f of declarees) {
      if (triggers.includes(f) || internes.includes(f)) continue
      expect(SQL_CODE, `${f} doit figurer dans la boucle de REVOKE`).toMatch(new RegExp(`'${f}\\(`))
    }
  })

  it('les trois tables écoutées par l’écran sont dans la publication temps réel', () => {
    expect(SQL_CODE).toContain("ARRAY['messages', 'conversations', 'messagerie_lectures']")
    expect(SQL_CODE).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE')
  })

  it('le module `chat` est vérifié EN BASE, pas seulement à l’écran', () => {
    expect(SQL_CODE).toMatch(/'chat' = ANY \(c\.modules_actifs\)/)
  })

  it('une pièce jointe ne peut désigner qu’un fichier de SA conversation (contrôle en base)', () => {
    expect(SQL_CODE).toContain("COALESCE(p->>'chemin', '') LIKE v_cab::text || '/' || NEW.conversation_id::text || '/%'")
  })

  it('un message retiré ne reste pas lisible dans la cloche', () => {
    expect(SQL_CODE).toMatch(/NEW\.retire_le IS NOT NULL THEN[\s\S]*?UPDATE notifications[\s\S]*?Message retiré/)
  })

  it('l’auteur est posé par la base, jamais cru du client', () => {
    expect(SQL_CODE).toContain('NEW.auteur_user_id := auth.uid();')
    expect(SQL_CODE).toContain('NEW.auteur_nom := messagerie_nom_de(auth.uid());')
  })

  it('la cloche est alimentée par un trigger SECURITY DEFINER (pas sous l’identité de l’expéditeur)', () => {
    expect(SQL_CODE).toMatch(/FUNCTION public\.messagerie_apres_insertion\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?INSERT INTO notifications/)
  })
})

describe('③ les actions serveur', () => {
  const ACTIONS = readFileSync(join(RACINE, 'src/app/(v2)/messagerie/actions.ts'), 'utf8')

  it('chaque action passe par `ouvrir()`, donc par exigerModule(chat)', () => {
    expect(ACTIONS).toContain("await exigerModule(supabase, 'chat')")
    const exportees = [...ACTIONS.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    expect(exportees.length).toBeGreaterThan(5)
    for (const nom of exportees) {
      const corps = ACTIONS.slice(ACTIONS.indexOf(`export async function ${nom}`))
      const suivante = corps.indexOf('\nexport ', 10)
      expect(corps.slice(0, suivante > 0 ? suivante : undefined), `${nom} doit appeler ouvrir()`).toContain('await ouvrir()')
    }
  })

  it('n’écrit aucune notification elle-même (le trigger le fait)', () => {
    expect(ACTIONS).not.toMatch(/from\('notifications'\)/)
    expect(ACTIONS).not.toMatch(/creerNotification/)
  })
})

describe('④ le style de l’écran ne se fait pas redessiner par une autre feuille', () => {
  // 06/11 : la racine s'appelait `.msg`, nom déjà pris par la rangée d'une bulle
  // de Filou (`align-items: flex-end`) → tout l'écran tombait en bas de la page.
  const DOSSIER = join(RACINE, 'src/styles')
  // Les commentaires retirés : on juge les RÈGLES, pas le texte qui en parle.
  const sansCommentaires = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const MIENNE = sansCommentaires(readFileSync(join(DOSSIER, 'v2-messagerie.css'), 'utf8'))
  // `v2-boutons.css` est exclue (B-206) : c'est la feuille UNIQUE du dessin des
  // boutons, elle cite les familles `msg-*` EXPRÈS pour les raccorder à leur
  // rôle, et tout y vit derrière la porte de chantier `boutons-relief`. Ce test
  // traque le redessin ACCIDENTEL par un nom déjà pris ; celui-là est déclaré,
  // et gardé par `boutons-relief.test.ts`.
  const AUTRES = readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.css') && f !== 'v2-messagerie.css' && f !== 'v2-boutons.css')
    .map((f) => ({ f, css: sansCommentaires(readFileSync(join(DOSSIER, f), 'utf8')) }))
  const classes = [...new Set([...MIENNE.matchAll(/\.((?:messagerie|msg)[\w-]*)/g)].map((m) => m[1]))]
  const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, (x) => '\\' + x)

  it('la racine de l’écran est `.messagerie`', () => {
    expect(readFileSync(join(RACINE, 'src/components/v2/MessagerieV2.tsx'), 'utf8')).toContain('className={`messagerie rise')
  })

  it.each(classes)('la classe .%s n’est définie par aucune autre feuille', (c) => {
    const motif = new RegExp('\\.' + echapper(c) + '(?![\\w-])')
    const coupables = AUTRES.filter(({ css }) => motif.test(css)).map(({ f }) => f)
    expect(coupables, `.${c} est aussi stylée ailleurs`).toEqual([])
  })
})

describe('⑤ B-193c — prévenir aussi par mail', () => {
  const SQL2 = readFileSync(join(RACINE, 'supabase/migrations/20261110120000_b193c_messagerie_mail.sql'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  const ACTIONS = readFileSync(join(RACINE, 'src/app/(v2)/messagerie/actions.ts'), 'utf8')

  it('la mention d’envoi dit les échecs, jamais un total trompeur', () => {
    expect(libelleEnvoiMail(3, 0)).toBe('envoyé aussi par mail à 3 personnes')
    expect(libelleEnvoiMail(1, 0)).toBe('envoyé aussi par mail à 1 personne')
    expect(libelleEnvoiMail(2, 1)).toBe('envoyé aussi par mail à 2 personnes · 1 échec')
    expect(libelleEnvoiMail(0, 2)).toBe('le mail n’est pas parti')
  })

  it('le mail échappe le texte, porte le lien EN TEXTE et le nom des pièces', () => {
    const html = corpsMailMessage({
      auteur: 'Anne-Sophie Blanchard',
      cabinet: 'Cabinet Démo',
      equipe: true,
      corps: 'Réunion <b>jeudi</b>\n\nà 13h',
      pieces: [{ nom: 'ordre-du-jour.pdf' }],
      lien: 'https://guardveto.vercel.app/messagerie?c=abc',
    })
    expect(html).toContain('&lt;b&gt;jeudi&lt;/b&gt;')
    expect(html).not.toContain('<b>jeudi</b>')
    expect(html).toContain('https://guardveto.vercel.app/messagerie?c=abc')
    expect(html).not.toMatch(/<a\s/i)
    expect(html).toContain('ordre-du-jour.pdf')
    expect(html).toContain('répondez dans GuardVeto')
    expect(sujetMailMessage({ auteur: 'Anne-Sophie', cabinet: 'Cabinet Démo', equipe: true })).toContain('à l’équipe')
  })

  it('la trace d’envoi est verrouillée : seule la fonction dédiée l’écrit', () => {
    expect(SQL2).toMatch(/NEW\.mail_envoye_a IS DISTINCT FROM OLD\.mail_envoye_a[\s\S]*?current_setting\('messagerie\.noter_mail', true\) IS DISTINCT FROM 'oui'/)
    expect(SQL2).toMatch(/FUNCTION public\.messagerie_noter_envoi_mail[\s\S]*?get_user_role\(\) IS DISTINCT FROM 'admin'[\s\S]*?m\.auteur_user_id = auth\.uid\(\)/)
    expect(SQL2).toMatch(/REVOKE EXECUTE ON FUNCTION public\.messagerie_noter_envoi_mail\(uuid, integer, integer\) FROM PUBLIC, anon/)
  })

  it('le journal des mails accepte le type « message », sans perdre les anciens', () => {
    for (const t of ['planning_publie', 'garde_modifiee', 'rappel_publication', 'appel_volontaires', 'depannage_confirme', 'conge_valide', 'conge_refuse', 'email_test', 'conge_demande', 'message']) {
      expect(SQL2).toContain(`'${t}'`)
    }
  })

  it('l’annuaire dit QUI a une adresse, jamais l’adresse', () => {
    expect(SQL2).toMatch(/RETURNS TABLE \(user_id UUID, nom TEXT, role TEXT, a_email BOOLEAN\)/)
    const corps = SQL2.slice(SQL2.indexOf('CREATE FUNCTION public.messagerie_annuaire'))
    expect(corps.slice(0, corps.indexOf('$$;', corps.indexOf('$$') + 2))).not.toMatch(/SELECT[^;]*\bv\.email\s*,/)
  })

  it('le mail passe par sendBrevoEmail, jamais par un appel direct', () => {
    expect(ACTIONS).toContain('await sendBrevoEmail(')
    expect(ACTIONS).not.toContain('api.brevo.com')
  })

  it('les droits et les destinataires sont vérifiés AVANT de publier le message', () => {
    expect(ACTIONS).toContain("moi.role_app !== 'admin'")
    expect(ACTIONS).toContain('uniques.some((u) => !permis.has(u))')
    expect(ACTIONS.indexOf('preparation = await preparerMail(')).toBeLessThan(ACTIONS.indexOf(".from('messages')\n    .insert("))
  })

  it('le journal « message » a un libellé dans les Réglages', () => {
    // B-202 — le dictionnaire vit dans `lib/reglages/libelles.ts`, lu par le
    // journal de l'onglet Réglages (l'ancien écran est retiré depuis B-202b).
    expect(readFileSync(join(RACINE, 'src/lib/reglages/libelles.ts'), 'utf8')).toMatch(/message: 'Message de la messagerie'/)
    expect(readFileSync(join(RACINE, 'src/components/v2/reglages/ReglagesSectionSuivi.tsx'), 'utf8')).toContain('TYPE_EMAIL')
  })
})

describe('⑥ B-193b — l’administratrice allume et éteint la messagerie', () => {
  it('chaque module réglable dit OÙ il s’allume, et la messagerie s’allume dans Réglages', async () => {
    const { MODULES_REGLABLES_PAR_ADMIN, OU_ALLUMER } = await import('@/lib/produit/modules')
    for (const m of MODULES_REGLABLES_PAR_ADMIN) expect(OU_ALLUMER[m], m).toBeTruthy()
    expect(MODULES_REGLABLES_PAR_ADMIN).toContain('chat')
    expect(OU_ALLUMER.chat).toContain('Réglages')
  })

  it('la base garde « au moins un PLANNING allumé » : la messagerie seule ne compte pas', () => {
    const sql = readFileSync(join(RACINE, 'supabase/migrations/20261110180000_b193b_messagerie_interrupteur.sql'), 'utf8')
    expect(sql).toContain("p_module NOT IN ('gardes', 'planning-journee', 'chat')")
    expect(sql).toContain("IF NOT (v_modules && ARRAY['gardes', 'planning-journee']) THEN")
    expect(sql).toContain("role_app = 'admin'")
  })

  it('l’interrupteur n’est donné que dans la partie ADMIN de Réglages', () => {
    // B-202b — la carte de l'ancien écran est retirée ; c'est la section
    // « Messagerie » de l'onglet refondu qui porte l'interrupteur.
    const page = readFileSync(join(RACINE, 'src/app/(v2)/reglages/page.tsx'), 'utf8')
    const avant = page.slice(0, page.indexOf('messagerieAllumee:'))
    // La partie admin commence là où la page exige un vétérinaire administrateur.
    expect(avant).toContain('exigerVeterinaire(supabase)')
    expect(avant).toContain('<BarreV2 prenom={vet.prenom} estAdmin dock={dock} />')
    expect(page.match(/messagerieAllumee:/g)?.length).toBe(1)
  })

  it('l’écran « non activé » et le refus serveur lisent la même phrase', () => {
    expect(readFileSync(join(RACINE, 'src/components/v2/ModuleEteint.tsx'), 'utf8')).toContain('OU_ALLUMER[module]')
    expect(readFileSync(join(RACINE, 'src/lib/produit/modules-serveur.ts'), 'utf8')).toContain('OU_ALLUMER[module]')
  })
})

describe('⑦ B-207 — Filou suit le fil « MonProjetPro »', () => {
  it('sa description de la Messagerie cite le fil MonProjetPro — sinon elle est incomplète et se croit complète', () => {
    const agent = readFileSync(join(RACINE, 'src/lib/ia/agentFilou.ts'), 'utf8')
    const bloc = agent.slice(agent.indexOf('export async function blocMessagerie'), agent.indexOf('export async function faireTravaillerFilou'))
    expect(bloc).toContain('LA MESSAGERIE DU CABINET')
    expect(bloc).toContain('fil « MonProjetPro »')
  })
})
