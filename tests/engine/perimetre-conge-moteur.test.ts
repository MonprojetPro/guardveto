// ============================================================
// Le moteur LIT le périmètre d'une absence (B-163)
// ============================================================
// L'EXIGENCE — MiKL, le 13/10 : « la journée ça n'est pas la nuit, ce sont
// 2 choses distinctes », et « il est possible qu'un véto soit absent la journée
// mais pas la nuit, ou juste la nuit ».
//
// 🔴 CE FICHIER EST LE GARDIEN DE L'ERREUR DE B-043.
//    En août, le formulaire des congés offrait « Matin / Après-midi / Journée /
//    Soirée » et `checkR16Conge` ne lisait pas le champ : quelqu'un posant une
//    matinée perdait sa garde du soir, en silence. Le champ a été supprimé
//    plutôt que corrigé — faute de test, personne n'avait vu qu'il mentait.
//
//    Les cas ci-dessous échouent si le moteur redevient aveugle au périmètre.
//    C'est la seule chose qui empêche la troisième occurrence.
//
// ── CE QU'IL VÉRIFIE, EN TROIS TEMPS ───────────────────────────────────────
//
//  ① LA RÈGLE DURE (`checkR16Conge`) distingue les six périmètres.
//  ② LE VALIDATEUR dit la MÊME chose que la règle dure. Sans cela, le
//     validateur déclarerait invalide un planning que le moteur vient de
//     produire — il accuserait le moteur d'une faute commise par le validateur.
//  ③ LE REPLI protège l'existant : un congé sans périmètre bloque tout, comme
//     avant ce lot.
// ============================================================

import { describe, expect, it } from 'vitest'
import { checkR16Conge, estVeilleDeRepos, estWeekEndAvantVacances } from '../../src/engine/rules/hard-constraints'
import type { CongeEngine, SlotGarde, VetEngine } from '../../src/engine/types'
import type { PerimetreAbsence } from '../../src/lib/absences/perimetre'

/** Un véto réduit à ce dont R16 a besoin. */
function vetAvecConge(conge: CongeEngine): VetEngine {
  return {
    id: 'v1',
    prenom: 'Manon',
    statut: 'salarie',
    dernier_recours: false,
    tags: [],
    contraintes: [],
    conges: [conge],
  } as unknown as VetEngine
}

function conge(perimetre: PerimetreAbsence | undefined): CongeEngine {
  return { date_debut: '2026-11-02', date_fin: '2026-11-03', type: 'vacances', perimetre }
}

/** Un soir de semaine DANS la fenêtre du congé. */
const SLOT_SOIR: SlotGarde = {
  date: '2026-11-02',
  type: 'semaine_soir',
  saison: 'hiver',
} as unknown as SlotGarde

describe('R16 — ce qu’un congé interdit réellement', () => {
  it('« journée » LAISSE la garde de nuit — le cœur de la demande du 13/10', () => {
    // Si ce test tombe, le produit est revenu au comportement d'avant le 13/10
    // et la décision de MiKL a été annulée sans que personne ne l'ait prise.
    const r = checkR16Conge(vetAvecConge(conge('journee')), SLOT_SOIR)
    expect(r.valid).toBe(true)
  })

  it('« nuit » interdit la garde', () => {
    const r = checkR16Conge(vetAvecConge(conge('nuit')), SLOT_SOIR)
    expect(r.valid).toBe(false)
  })

  it('« journée et nuit » interdit la garde — comportement historique', () => {
    const r = checkR16Conge(vetAvecConge(conge('journee-et-nuit')), SLOT_SOIR)
    expect(r.valid).toBe(false)
  })

  it('« matin » et « après-midi » laissent la garde', () => {
    expect(checkR16Conge(vetAvecConge(conge('matin')), SLOT_SOIR).valid).toBe(true)
    expect(checkR16Conge(vetAvecConge(conge('apres-midi')), SLOT_SOIR).valid).toBe(true)
  })

  it('un ponctuel de deux heures n’interdit rien', () => {
    expect(checkR16Conge(vetAvecConge(conge('ponctuel')), SLOT_SOIR).valid).toBe(true)
  })

  it('un congé SANS périmètre interdit la garde — le repli protège l’existant', () => {
    // Les 50 congés en base (mesure du 13/10) ont été acceptés sous « un congé
    // bloque tout ». Un repli permissif les rendrait soudain compatibles avec
    // une garde que personne n'a acceptée.
    expect(checkR16Conge(vetAvecConge(conge(undefined)), SLOT_SOIR).valid).toBe(false)
  })

  it('hors de la fenêtre de dates, aucun périmètre n’interdit quoi que ce soit', () => {
    const hors = { ...SLOT_SOIR, date: '2026-11-10' } as SlotGarde
    for (const p of ['nuit', 'journee-et-nuit'] as const) {
      expect(checkR16Conge(vetAvecConge(conge(p)), hors).valid).toBe(true)
    }
  })
})

describe('Ce que le moteur appelle un repos', () => {
  it('un ponctuel la veille ne vaut pas repos', () => {
    // Sinon le produit refuserait une garde au motif que la personne a un
    // rendez-vous de 14h à 16h le lendemain — un refus fondé sur rien. C'est la
    // famille du défaut du 20/09, où une préférence fondait une interdiction.
    const vet = vetAvecConge({ date_debut: '2026-11-03', date_fin: '2026-11-03', perimetre: 'ponctuel' })
    expect(estVeilleDeRepos(SLOT_SOIR, vet)).toBe(false)
  })

  it('un congé de journée la veille vaut repos', () => {
    const vet = vetAvecConge({ date_debut: '2026-11-03', date_fin: '2026-11-03', perimetre: 'journee' })
    expect(estVeilleDeRepos(SLOT_SOIR, vet)).toBe(true)
  })

  it('un ponctuel n’est pas un départ en vacances', () => {
    const samedi: SlotGarde = { date: '2026-11-07', type: 'weekend', saison: 'hiver' } as unknown as SlotGarde
    const ponctuel = vetAvecConge({
      date_debut: '2026-11-10',
      date_fin: '2026-11-10',
      type: 'vacances',
      perimetre: 'ponctuel',
    })
    const vraies = vetAvecConge({
      date_debut: '2026-11-10',
      date_fin: '2026-11-14',
      type: 'vacances',
      perimetre: 'journee-et-nuit',
    })
    expect(estWeekEndAvantVacances(samedi, ponctuel)).toBe(false)
    expect(estWeekEndAvantVacances(samedi, vraies)).toBe(true)
  })
})

describe('Le validateur ne contredit pas la règle dure', () => {
  it('les deux portent la même condition, lue dans le même fichier', () => {
    // ⚠️ CE TEST EST STRUCTUREL, ET C'EST ASSUMÉ. Faire tourner le validateur
    //    sur un planning complet est déjà couvert par les bancs d'essai ; ce
    //    qu'on protège ici, c'est que personne ne corrige l'un des deux
    //    endroits en oubliant l'autre. Les deux doivent lire `toucheLesGardes`,
    //    pas réécrire le test à la main — une condition recopiée est une
    //    condition qui divergera.
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const SRC = join(__dirname, '..', '..', 'src')

    for (const f of ['engine/rules/hard-constraints.ts', 'engine/validation/validerPlanning.ts']) {
      const code = readFileSync(join(SRC, f), 'utf8')
      expect(code, `${f} doit décider via l'autorité unique du périmètre`).toContain(
        'toucheLesGardes(lirePerimetre(conge.perimetre))',
      )
    }
  })
})
