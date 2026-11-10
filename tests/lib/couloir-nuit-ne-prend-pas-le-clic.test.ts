// B-194 ⑦ bis — le « ? » d'une place à pourvoir ne réagissait plus au clic.
// Mesuré le 10/11 dans un vrai navigateur (`elementFromPoint` au centre du
// bouton) : le clic tombait sur `.pv2-couloir`, le fond décoratif de la colonne
// Nuit, positionné et donc peint AU-DESSUS de la ligne « à pourvoir ».
// Ce test tient les deux verrous posés ce jour-là.
import { readFileSync } from 'fs'
import path from 'path'

const css = readFileSync(path.resolve(__dirname, '../../src/styles/chantier-planning-v2.css'), 'utf8')

function bloc(selecteur: string): string {
  const i = css.indexOf(`${selecteur} {`)
  if (i < 0) throw new Error(`règle ${selecteur} introuvable`)
  return css.slice(i, css.indexOf('}', i))
}

describe('Le couloir de nuit ne prend jamais un clic', () => {
  it('.pv2-couloir laisse passer les clics', () => {
    expect(bloc('.pv2-couloir')).toMatch(/pointer-events:\s*none/)
  })
  it('.pv2-pourvoir est positionnée, donc peinte au-dessus du couloir', () => {
    expect(bloc('.pv2-pourvoir')).toMatch(/position:\s*relative/)
  })
})
