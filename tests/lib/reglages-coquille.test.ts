// ============================================================
// B-202 — L'onglet Réglages refondu : ce qui décide, testé sans écran
// ============================================================
// Maquette validée par MiKL le 10/11 : `docs/maquettes/B-202-reglages.html`.
// On vérifie ici ce qui ne se voit pas à l'œil mais coûte cher quand c'est
// faux : qui voit quelle section, ce que signale le sommaire, ce qu'envoie
// chaque « Enregistrer », et que le chantier reste fermé chez le client.
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SECTIONS, attentions, nbEchecs, partagesAEnvoyer, sectionDemandee, sectionsPour,
} from '@/lib/reglages/coquille'
import { libelleZone, montrerRaison, estUnEchec } from '@/lib/reglages/libelles'
import { lireReponseResync, resynchroniserPeriode } from '@/lib/reglages/resynchroniser'
import { chantierOuvert } from '@/lib/produit/chantiers'

const RACINE = join(__dirname, '..', '..')
const lire = (f: string) => readFileSync(join(RACINE, f), 'utf8')

describe('Les sections, et qui les voit', () => {
  it('l’administratrice voit les cinq sections, dans l’ordre de la maquette', () => {
    expect(sectionsPour('admin').map((s) => s.id)).toEqual(['moi', 'cabinet', 'messagerie', 'connexions', 'suivi'])
  })

  it('un véto et le secrétariat ne voient que « Pour moi » — rien du cabinet', () => {
    expect(sectionsPour('veto').map((s) => s.id)).toEqual(['moi'])
    expect(sectionsPour('secretaire').map((s) => s.id)).toEqual(['moi'])
  })

  it('MiKL, 10/11 : la section s’appelle « Messagerie », plus « Fonctions de l’équipe »', () => {
    expect(SECTIONS.find((s) => s.id === 'messagerie')?.nom).toBe('Messagerie')
    expect(SECTIONS.map((s) => s.nom).join(' ')).not.toMatch(/Fonctions/)
  })

  it('MiKL, 11/11 : « Suivi » devient « Journal des e-mails » (l’adresse garde `?section=suivi`)', () => {
    expect(SECTIONS.find((s) => s.id === 'suivi')?.nom).toBe('Journal des e-mails')
    expect(SECTIONS.map((s) => s.nom)).not.toContain('Suivi')
    // Le bloc ne répète pas le nom de la section juste au-dessus.
    expect(lire('src/components/chantier/ReglagesSectionSuivi.tsx')).not.toContain('titre="Journal des e-mails"')
  })

  it('l’adresse ne peut pas ouvrir une section interdite ni inconnue', () => {
    expect(sectionDemandee('suivi', 'admin')).toBe('suivi')
    expect(sectionDemandee('cabinet', 'veto')).toBeNull()
    expect(sectionDemandee('suivi', 'secretaire')).toBeNull()
    expect(sectionDemandee('n-importe-quoi', 'admin')).toBeNull()
    expect(sectionDemandee(undefined, 'admin')).toBeNull()
    expect(sectionDemandee('moi', 'veto')).toBe('moi')
  })
})

describe('Ce que signale le sommaire', () => {
  const sain = { zoneConnue: true, envoiConfigure: true, agendaBranche: true, emails: [] }

  it('rien à signaler quand tout est réglé', () => {
    expect(attentions(sain)).toEqual({ cabinet: false, connexions: false, suivi: 0 })
  })

  it('un point sur « Le cabinet » si la zone ou l’envoi des e-mails manque', () => {
    expect(attentions({ ...sain, zoneConnue: false }).cabinet).toBe(true)
    expect(attentions({ ...sain, envoiConfigure: false }).cabinet).toBe(true)
  })

  it('un point sur « Connexions » si aucun agenda n’est branché', () => {
    expect(attentions({ ...sain, agendaBranche: false }).connexions).toBe(true)
  })

  it('le nombre d’e-mails qui ne sont PAS arrivés — pas ceux qui attendent ni ceux partis', () => {
    const emails = ['envoye', 'remis', 'differe', 'erreur', 'rejete', 'spam'].map((statut) => ({ statut }))
    expect(nbEchecs(emails)).toBe(3)
    expect(attentions({ ...sain, emails }).suivi).toBe(3)
  })

  it('l’état « En attente » montre sa raison, « Remis » jamais (la colonne y vaut « sent »)', () => {
    expect(montrerRaison({ statut: 'differe', erreur: 'rate limited' })).toBe(true)
    expect(montrerRaison({ statut: 'erreur', erreur: '403' })).toBe(true)
    expect(montrerRaison({ statut: 'remis', erreur: 'sent' })).toBe(false)
    expect(montrerRaison({ statut: 'erreur', erreur: null })).toBe(false)
    expect(estUnEchec('differe')).toBe(false)
  })

  it('la zone se lit « Zone A · Métropole », et rien tant qu’elle est inconnue', () => {
    expect(libelleZone('A', 'metropole')).toBe('Zone A · Métropole')
    expect(libelleZone('', 'metropole')).toBeNull()
  })
})

describe('🔴 Un « Enregistrer » n’enregistre que SON sujet', () => {
  // L'action serveur réécrit agenda + expéditeur d'un coup. L'écran actuel lui
  // passait l'état de saisie commun aux deux cartes.
  const enregistre = {
    googleCalendarId: 'ancien@group.calendar.google.com',
    brevoFromEmail: 'gardes@cabinet.fr',
    brevoFromName: 'Cabinet du Val d’Allier',
  }

  it('enregistrer l’expéditeur renvoie l’agenda ENREGISTRÉ, pas une saisie en cours', () => {
    expect(partagesAEnvoyer(enregistre, 'expediteur', '  Clinique des Sources ')).toEqual({
      googleCalendarId: 'ancien@group.calendar.google.com',
      brevoFromEmail: 'gardes@cabinet.fr',
      brevoFromName: 'Clinique des Sources',
    })
  })

  it('enregistrer l’agenda renvoie l’expéditeur ENREGISTRÉ', () => {
    expect(partagesAEnvoyer(enregistre, 'agenda', ' nouveau@group.calendar.google.com ')).toEqual({
      googleCalendarId: 'nouveau@group.calendar.google.com',
      brevoFromEmail: 'gardes@cabinet.fr',
      brevoFromName: 'Cabinet du Val d’Allier',
    })
  })

  it('l’adresse d’envoi (réglée par l’assistance) n’est jamais touchée', () => {
    for (const sujet of ['agenda', 'expediteur'] as const) {
      expect(partagesAEnvoyer(enregistre, sujet, 'x').brevoFromEmail).toBe('gardes@cabinet.fr')
    }
  })

  it('les sections passent par cette fonction, pas par une saisie partagée', () => {
    expect(lire('src/components/chantier/ReglagesSectionCabinet.tsx')).toContain("partagesAEnvoyer(partages, 'expediteur'")
    expect(lire('src/components/chantier/ReglagesSectionConnexions.tsx')).toContain("partagesAEnvoyer(partages, 'agenda'")
  })
})

describe('Renvoyer un planning : la phrase dit pourquoi', () => {
  it('succès, au pluriel juste', () => {
    expect(lireReponseResync(true, { synced: 61 })).toEqual({ ok: true, message: "61 gardes envoyées vers l'agenda." })
    expect(lireReponseResync(true, { synced: 1 })).toEqual({ ok: true, message: "1 garde envoyée vers l'agenda." })
  })

  it('rien d’envoyé : la raison du serveur, pas une panne de réglage inventée', () => {
    expect(lireReponseResync(true, { skipped: true, raison: 'Ce planning n’est pas publié.' }).message)
      .toBe('Ce planning n’est pas publié.')
  })

  it('échec partiel et refus de la route', () => {
    expect(lireReponseResync(true, { synced: 58, errors: ['403', '403', '403'] }))
      .toEqual({ ok: false, message: '58 envoyée(s), 3 en échec : 403' })
    expect(lireReponseResync(false, { error: 'Réservé à l’administratrice' }))
      .toEqual({ ok: false, message: 'Réservé à l’administratrice' })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('🔴 une réponse illisible n’est PAS « 0 garde envoyée » (SCAN, 10/11)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>délai dépassé</html>', { status: 200 })))
    const r = await resynchroniserPeriode('p1')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/n'a pas abouti/)
  })

  it('une réponse lisible est traduite telle quelle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ synced: 61 })))
    expect(await resynchroniserPeriode('p1')).toEqual({ ok: true, message: "61 gardes envoyées vers l'agenda." })
  })
})

describe('🔴 La porte du chantier — la leçon du 08/10 (B-151)', () => {
  it('fermé au Val d’Allier (pas un bac à sable), ouvert au bac à sable', () => {
    expect(chantierOuvert('reglages-v2', { estBacASable: false })).toBe(false)
    expect(chantierOuvert('reglages-v2', { estBacASable: true })).toBe(true)
  })

  it('la page consulte la porte avant de rendre l’onglet refondu', () => {
    const page = lire('src/app/(v2)/reglages/page.tsx')
    expect(page).toContain("chantierOuvertPourLeCabinet(supabase, 'reglages-v2')")
    // Les deux rendus du nouvel écran sont gardés par `refonte`.
    expect(page).toContain("if (identite.role !== 'admin' && refonte) {")
    expect(page).toContain('if (refonte) {')
  })

  it('hors administratrice, aucune donnée du cabinet n’est passée à l’écran', () => {
    const page = lire('src/app/(v2)/reglages/page.tsx')
    const brancheNonAdmin = page.slice(
      page.indexOf("if (identite.role !== 'admin' && refonte) {"),
      page.indexOf("if (identite.role !== 'admin') {"),
    )
    expect(brancheNonAdmin).toContain('cabinet={null}')
    expect(brancheNonAdmin).not.toContain('email_log')
    // La partie admin commence après `exigerVeterinaire` : les données du cabinet y vivent.
    expect(page.indexOf('messagerieAllumee:')).toBeGreaterThan(page.indexOf('exigerVeterinaire(supabase)'))
  })

  it('les anciennes adresses mènent à « Pour moi » là où la refonte est ouverte', () => {
    for (const f of ['src/app/(v2)/reglages/notifications/page.tsx', 'src/app/(v2)/reglages/agenda/page.tsx']) {
      expect(lire(f)).toContain("if (await chantierOuvertPourLeCabinet(supabase, 'reglages-v2')) redirect('/reglages?section=moi')")
    }
  })

  it('🔴 l’agenda de repli ne part pas vers le navigateur — un booléen, calculé pour CE cabinet (CERBÈRE)', () => {
    const page = lire('src/app/(v2)/reglages/page.tsx')
    const brancheRefonte = page.slice(page.indexOf('  if (refonte) {'), page.indexOf('// En parallèle : aucune lecture'))
    expect(brancheRefonte.length).toBeGreaterThan(200)
    expect(brancheRefonte).toContain('agendaDeRepliPour(cabinetId)')
    expect(brancheRefonte).toContain('repliDisponible: repli !== null')
    expect(brancheRefonte).not.toContain('process.env.GOOGLE_CALENDAR_ID')
  })

  it('« Mon agenda » peut lancer une mise à jour : la page porte le délai qu’il lui faut', () => {
    expect(lire('src/app/(v2)/reglages/page.tsx')).toContain('export const maxDuration = 300')
  })
})
