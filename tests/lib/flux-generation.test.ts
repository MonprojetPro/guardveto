// ============================================================
// B-060 — le flux de progression de la génération
// ============================================================
// La génération répond désormais en NDJSON : une ligne par étape, la dernière
// portant le résultat. C'est la pièce que je ne peux pas recetter à l'écran, et
// c'est celle dont la panne est la plus vicieuse — si elle rate la ligne de
// résultat, le parcours tourne indéfiniment sans jamais rien dire.
//
// Le cas piégeux, testé ici : un objet JSON coupé en deux paquets réseau. C'est
// la situation NORMALE d'un flux, pas un cas limite.
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { lireLeFlux } from '@/components/v2/ParcoursGeneration'

/** Fabrique une réponse en flux à partir de morceaux bruts. */
function reponseFlux(morceaux: string[]): Response {
  const encodeur = new TextEncoder()
  const flux = new ReadableStream({
    start(c) {
      for (const m of morceaux) c.enqueue(encodeur.encode(m))
      c.close()
    },
  })
  return new Response(flux, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

const LF = String.fromCharCode(10)

describe('lireLeFlux', () => {
  it('remonte chaque progrès et rend le résultat final', async () => {
    const vus: string[] = []
    const data = await lireLeFlux(
      reponseFlux([
        JSON.stringify({ type: 'progres', message: 'Je relis les règles…' }) + LF,
        JSON.stringify({ type: 'progres', message: 'Jean peut finalement prendre le 14/10' }) + LF,
        JSON.stringify({ type: 'resultat', status: 200, corps: { success: true, nbGardes: 43 } }) + LF,
      ]),
      (m) => vus.push(m),
    )

    expect(vus).toEqual(['Je relis les règles…', 'Jean peut finalement prendre le 14/10'])
    expect(data.success).toBe(true)
    expect(data.nbGardes).toBe(43)
    expect(data.__status).toBe(200)
  })

  it('recolle un objet coupé entre deux paquets', async () => {
    const ligne = JSON.stringify({ type: 'resultat', status: 200, corps: { issue: 'partiel' } }) + LF
    const coupe = Math.floor(ligne.length / 2)

    const data = await lireLeFlux(
      reponseFlux([ligne.slice(0, coupe), ligne.slice(coupe)]),
      () => {},
    )

    expect(data.issue).toBe('partiel')
  })

  it('porte le vrai code HTTP, que le flux ne peut plus dire dans son entête', async () => {
    const data = await lireLeFlux(
      reponseFlux([JSON.stringify({ type: 'resultat', status: 422, corps: { error: 'Aucun vétérinaire mobilisable' } }) + LF]),
      () => {},
    )

    expect(data.__status).toBe(422)
    expect(data.error).toBe('Aucun vétérinaire mobilisable')
  })

  it('ne laisse JAMAIS le parcours sans réponse si le flux se coupe', async () => {
    // Fonction serveur tuée en plein travail : aucune ligne de résultat. Sans
    // ce filet, l'écran tournerait pour toujours.
    const data = await lireLeFlux(
      reponseFlux([JSON.stringify({ type: 'progres', message: 'Je cherche…' }) + LF]),
      () => {},
    )

    expect(typeof data.error).toBe('string')
    expect(data.error as string).toMatch(/interrompue/i)
  })

  it('ignore une ligne corrompue sans perdre le résultat', async () => {
    const data = await lireLeFlux(
      reponseFlux([
        '{ceci n est pas du json}' + LF,
        JSON.stringify({ type: 'resultat', status: 200, corps: { success: true } }) + LF,
      ]),
      () => {},
    )

    expect(data.success).toBe(true)
  })
})
