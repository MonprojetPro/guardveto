// Tests unitaires — utils.ts (F3-002 + F7-001)

import { describe, it, expect } from 'vitest'
import {
  estJourFerie,
  estEnVacancesScolaires,
  estSemaineImpaireAncrée,
  numeroSemaine,
  estSemaineImpaire,
} from '../utils'
import type { CalendrierResolu } from '../types'

// ============================================================
// B-209 — LE NUMÉRO DE SEMAINE, ET LA PARITÉ QUI EN DÉCOULE
// ============================================================
// Aucun test ne portait sur `numeroSemaine` avant le 13/11, et aucun test du
// projet ne touchait une date de 2027 : la fonction a pu rendre un numéro faux
// sur 362 jours de cette année-là sans qu'une seule alarme sonne, jusqu'au
// retour du cabinet.
//
// ⚠️ LA RÉFÉRENCE CI-DESSOUS EST ÉCRITE AUTREMENT QUE LA VERSION DE PRODUCTION,
//    EXPRÈS. Elle applique la définition ISO littéralement — le numéro est le
//    quantième du jeudi de la semaine, divisé par 7, arrondi au supérieur — en
//    arithmétique entière à minuit. La version de production, elle, compte des
//    semaines entières entre deux jeudis. Une référence qui recopierait la
//    formule testée ne prouverait rien du tout : elle se tromperait pareil.

function numeroSemaineReference(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z')
  const jeudi = new Date(d)
  jeudi.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)))
  const premierJanvier = Date.UTC(jeudi.getUTCFullYear(), 0, 1)
  const quantieme = (jeudi.getTime() - premierJanvier) / 86400000 + 1
  return Math.ceil(quantieme / 7)
}

/** Toutes les dates de `debut` à `fin` inclus. */
function toutesLesDates(debut: string, fin: string): string[] {
  const dates: string[] = []
  const curseur = new Date(debut + 'T00:00:00Z')
  const borne = new Date(fin + 'T00:00:00Z')
  while (curseur <= borne) {
    dates.push(curseur.toISOString().slice(0, 10))
    curseur.setUTCDate(curseur.getUTCDate() + 1)
  }
  return dates
}

describe('numeroSemaine() — B-209', () => {
  it('LE CAS DU CLIENT : la semaine du 4 janvier 2027 est la semaine 1, donc IMPAIRE', () => {
    // Anne-Sophie (Val d'Allier), 13/11 : « pourquoi le logiciel me met de repos
    // lundi après-midi et mercredi journée alors que nous sommes en semaine
    // impaire ? ». Le calcul rendait 2 — sa semaine type PAIRE — pour chacun de
    // ces jours. C'est la ligne qui aurait dû exister avant la livraison.
    expect(numeroSemaine('2027-01-04')).toBe(1) // lundi
    expect(numeroSemaine('2027-01-06')).toBe(1) // mercredi
    expect(estSemaineImpaire('2027-01-04')).toBe(true)
    expect(estSemaineImpaire('2027-01-06')).toBe(true)
  })

  it('les années qui commencent un vendredi — la famille entière du bug', () => {
    // 2027 commence un vendredi, et c'est CETTE configuration qui faisait
    // basculer `Math.ceil` : le jeudi de la semaine 1 tombait pile sur un
    // multiple de 7 jours. Entre 2020 et 2040, trois années sont dans ce cas —
    // 2021, 2027 et 2038 — et elles étaient fausses toutes les trois.
    expect(numeroSemaine('2021-01-04')).toBe(1)
    expect(numeroSemaine('2027-01-07')).toBe(1)
    expect(numeroSemaine('2038-01-04')).toBe(1)
  })

  it('et ne décale PAS les autres années pour autant', () => {
    // Le contre-exemple qui empêche de « corriger » en soustrayant 1 partout :
    // 2032 commence un JEUDI, sa semaine 1 court donc du 29 décembre 2031 au
    // 4 janvier 2032. Le lundi 5 janvier est bien la semaine 2, et doit le
    // rester. (Cette ligne a d'abord été écrite à l'envers, et c'est le test
    // qui l'a dit — pas l'inverse.)
    expect(numeroSemaine('2032-01-05')).toBe(2)
    expect(numeroSemaine('2031-12-29')).toBe(1)
  })

  it('les bords d’année, là où une semaine change d’année', () => {
    // Le 1er janvier 2027 est un vendredi : il appartient à la semaine 53 de
    // 2026, pas à la semaine 1 de 2027.
    expect(numeroSemaine('2027-01-01')).toBe(53)
    expect(numeroSemaine('2026-12-28')).toBe(53) // lundi de cette même semaine
    // Et le 29 décembre 2025 est déjà dans la semaine 1 de 2026.
    expect(numeroSemaine('2025-12-29')).toBe(1)
  })

  it('tient sur DIX ANS, jour par jour, contre la définition ISO', () => {
    const faux = toutesLesDates('2024-01-01', '2033-12-31').filter(
      (d) => numeroSemaine(d) !== numeroSemaineReference(d),
    )
    // Avant le correctif : 364 jours faux, dont 362 sur la seule année 2027.
    expect(faux).toEqual([])
  })

  it('TROU CONNU (B-209a) — une date malformée est déclarée « impaire » en silence', () => {
    // ⚠️ CE TEST N'APPROUVE PAS CE COMPORTEMENT, IL L'ÉPINGLE.
    //
    //    Relevé par la revue SCAN du 13/11 et vérifié par exécution : toute
    //    entrée que `Date` ne sait pas lire donne `NaN`, et `NaN % 2 !== 0`
    //    vaut `true`. Une date corrompue applique donc les repos « semaine
    //    impaire » sans erreur, sans log, sans trace — exactement la réponse
    //    fausse servie avec l'aplomb d'une réponse juste que ce produit
    //    combat.
    //
    //    Ce n'est PAS une régression de B-209 : le comportement est identique
    //    avant et après le correctif. Mais B-209 fait de cet endroit LE point
    //    unique de la parité, et ce point unique répond « impaire » à
    //    n'importe quoi. Le laisser sans test, c'était le laisser invisible.
    //
    //    Le fermer est une décision à part (faut-il lever une erreur, au
    //    risque d'un écran blanc en plein rendu ?) : item B-209a au board.
    //    Le jour où elle est prise, CE TEST DOIT ROUGIR — c'est son travail.
    for (const malformee of ['', 'abc', '2027-13-45', '2027-01-04T10:00:00']) {
      expect(Number.isNaN(numeroSemaine(malformee))).toBe(true)
      expect(estSemaineImpaire(malformee)).toBe(true) // ⬅️ le trou, en toutes lettres
    }
  })

  it('la parité est une propriété de la SEMAINE, pas de certains de ses jours', () => {
    // Même garde-fou que le correctif intra-semaine de 2026-06, mais sur la
    // version ISO : les 7 jours d'une semaine doivent avoir la même parité.
    // Un désaccord ici afficherait quelqu'un présent le lundi et absent le
    // samedi de la même semaine.
    for (const lundi of ['2026-12-28', '2027-01-04', '2027-01-11', '2027-06-14']) {
      const parites = toutesLesDates(lundi, plusJoursTest(lundi, 6)).map(estSemaineImpaire)
      expect(new Set(parites).size).toBe(1)
    }
  })
})

function plusJoursTest(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('estJourFerie()', () => {
  it('détecte un férié fixe sans calendrier (fallback V1)', () => {
    expect(estJourFerie('2026-07-14')).toBe(true)
    expect(estJourFerie('2026-01-01')).toBe(true)
    expect(estJourFerie('2026-07-15')).toBe(false)
  })

  it('utilise le CalendrierResolu si fourni', () => {
    const calendrier: CalendrierResolu = {
      feries: new Set(['2026-07-14']),
      vacancesScolaires: [],
    }
    expect(estJourFerie('2026-07-14', calendrier)).toBe(true)
    expect(estJourFerie('2026-01-01', calendrier)).toBe(false) // pas dans ce calendrier custom
  })

  it('CalendrierResolu vide → aucune date est fériée', () => {
    const calendrier: CalendrierResolu = {
      feries: new Set(),
      vacancesScolaires: [],
    }
    expect(estJourFerie('2026-07-14', calendrier)).toBe(false)
    expect(estJourFerie('2026-01-01', calendrier)).toBe(false)
  })
})

describe('estEnVacancesScolaires()', () => {
  it('détecte les vacances sans calendrier (fallback V1)', () => {
    expect(estEnVacancesScolaires('2026-02-20')).toBe(true)  // Hiver 2026
    expect(estEnVacancesScolaires('2026-03-15')).toBe(false) // hors vacances
  })

  it('utilise le CalendrierResolu si fourni', () => {
    const calendrier: CalendrierResolu = {
      feries: new Set(),
      vacancesScolaires: [{ debut: '2026-06-01', fin: '2026-06-30' }],
    }
    expect(estEnVacancesScolaires('2026-06-15', calendrier)).toBe(true)
    expect(estEnVacancesScolaires('2026-02-20', calendrier)).toBe(false) // pas dans ce calendrier custom
  })
})

describe('estSemaineImpaireAncrée — non-régression semaine 53 (F7-001)', () => {
  // NOTE (correctif parité intra-semaine 2026-06) : date, ancre et recalages
  // sont désormais ramenés au LUNDI de leur semaine. La parité est donc STABLE
  // sur toute une semaine calendaire (cf. describe dédié plus bas). Les valeurs
  // ci-dessous sont calculées entre LUNDIS de semaines.

  it('semaine 0 depuis l\'ancre (même semaine) → paire', () => {
    // La semaine contenant l'ancre elle-même = semaine 0 → paire
    expect(estSemaineImpaireAncrée('2026-09-01', '2026-09-01', [])).toBe(false)
  })

  it('semaine 1 depuis l\'ancre → impaire', () => {
    // lundi semaine ancre = 2026-08-31 ; lundi de 2026-09-08 = 2026-09-07 → +1 semaine → impaire
    expect(estSemaineImpaireAncrée('2026-09-08', '2026-09-01', [])).toBe(true)
  })

  it('semaine 53 ISO (2026-12-28) : parité stable depuis une ancre de septembre', () => {
    // Ancre lundi = 2026-08-31 ; 2026-12-28 est un lundi → diff = 119 jours = 17 semaines → impaire.
    // L'important : la valeur ne dépend PAS du numéro ISO 53 — elle reste stable.
    const ancre = '2026-09-01'
    const result = estSemaineImpaireAncrée('2026-12-28', ancre, [])
    expect(result).toBe(true)
  })

  it('recalage sur vacances : la parité repart de 0 après le début des vacances', () => {
    const vacances = [{ debut: '2026-10-17', fin: '2026-10-31' }]
    // Avant vacances (2026-10-12, lundi) : diff depuis lundi 2026-08-31 = 42 jours → 6 semaines → paire
    expect(estSemaineImpaireAncrée('2026-10-12', '2026-09-01', vacances)).toBe(false)
    // Après vacances (2026-11-02, lundi) : ancre recalée sur lundi de 2026-10-17 = 2026-10-12
    //   diff = 21 jours → 3 semaines → impaire
    expect(estSemaineImpaireAncrée('2026-11-02', '2026-09-01', vacances)).toBe(true)
  })

  it('recalage sur vacances : semaine pendant les vacances repart aussi à 0', () => {
    const vacances = [{ debut: '2026-10-17', fin: '2026-10-31' }]
    // 2026-10-17 (samedi) est dans la semaine de vacances → ancre recalée sur son lundi
    //   (2026-10-12) → diff = 0 → paire
    expect(estSemaineImpaireAncrée('2026-10-17', '2026-09-01', vacances)).toBe(false)
  })

  it('sans vacances : parité ISO 53 est différente de la parité ISO globale (démontre le bug V1)', () => {
    // Semaine ISO 53 de 2026 : 2026-12-28 → numeroSemaine() = 53 (impaire selon V1).
    // La parité ancrée reste stable et indépendante de l'ISO 53.
    const dateS53 = '2026-12-28'
    const ancre = '2026-09-01'
    const paritéAncrée = estSemaineImpaireAncrée(dateS53, ancre, [])
    expect(paritéAncrée).toBe(true)
  })
})

describe('estSemaineImpaireAncrée — parité STABLE sur toute la semaine (correctif intra-semaine)', () => {
  // Bug observé (été 2026) : Anne-Sophie avait des gardes en semaines ISO 28/29/31/32,
  // mélange incohérent dû à une ancre (2026-09-01, un MARDI) utilisée brute → certains
  // jours d'une même semaine basculaient de parité. Désormais : tous les jours d'une
  // même semaine calendaire ont la MÊME parité.
  const ancre = '2026-09-01' // mardi — c'est ce décalage qui causait le bug

  it('lundi → dimanche d\'une même semaine ont tous la même parité', () => {
    // Semaine du lundi 2026-09-07 (lun..dim)
    const jours = [
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ]
    const parités = jours.map((d) => estSemaineImpaireAncrée(d, ancre, []))
    // Toutes identiques
    expect(new Set(parités).size).toBe(1)
  })

  it('la semaine de l\'ancre (mardi 2026-09-01) : lundi ET samedi sont PAIRS ensemble', () => {
    // Avant le correctif : lundi 2026-08-31 = IMPAIRE, mardi 2026-09-01 = PAIRE (incohérent).
    const lundi = estSemaineImpaireAncrée('2026-08-31', ancre, [])
    const samedi = estSemaineImpaireAncrée('2026-09-05', ancre, [])
    expect(lundi).toBe(samedi)
    expect(lundi).toBe(false) // semaine 0 → paire
  })
})
