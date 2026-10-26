// Vérification B-173 : le compte de service peut-il créer un agenda,
// le partager, y poser un événement, retirer un partage ? Et a-t-il le droit
// de gérer le partage de l'agenda du bac à sable ? Aucune clé n'est affichée.
const { createRequire } = require('module')
const projet = process.argv[2]
const req = createRequire(projet + '/package.json')
req('dotenv').config({ path: projet + '/.env.local', quiet: true })
const { google } = req('googleapis')

const CAL_BAC = 'mikl.globalprojects@gmail.com'
const res = (etape, ok, detail) => console.log(`${ok ? 'OK  ' : 'ECHEC'} ${etape}${detail ? ' — ' + detail : ''}`)
const err = (e) => `${e.code ?? ''} ${e.errors?.[0]?.reason ?? ''} ${e.message ?? ''}`.trim()

;(async () => {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim(),
    key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim().replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
  const cal = google.calendar({ version: 'v3', auth })
  console.log('Compte de service :', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim())

  // 1. Droit sur l'agenda du bac à sable (lecture seule)
  try {
    const l = await cal.calendarList.get({ calendarId: CAL_BAC })
    res('1. role du compte de service sur l’agenda du bac a sable', true, l.data.accessRole)
  } catch (e) { res('1. role sur l’agenda du bac a sable (calendarList)', false, err(e)) }
  try {
    const a = await cal.acl.list({ calendarId: CAL_BAC })
    res('1b. lire les partages de l’agenda du bac a sable', true, a.data.items.map((i) => `${i.scope.type}:${i.scope.value ?? ''}=${i.role}`).join(' | '))
  } catch (e) { res('1b. lire les partages de l’agenda du bac a sable', false, err(e)) }

  // 2. Créer un agenda test
  let id
  try {
    const c = await cal.calendars.insert({ requestBody: { summary: 'GuardVeto — test B-173 (a supprimer)', timeZone: 'Europe/Paris' } })
    id = c.data.id
    res('2. creer un agenda', true)
  } catch (e) { res('2. creer un agenda', false, err(e)); return }

  try {
    // 3. Le partager à MiKL
    try {
      const a = await cal.acl.insert({ calendarId: id, sendNotifications: true, requestBody: { role: 'reader', scope: { type: 'user', value: CAL_BAC } } })
      res('3. partager l’agenda a ' + CAL_BAC, true, 'role ' + a.data.role)
    } catch (e) { res('3. partager l’agenda', false, err(e)) }

    // 4. Y poser une journée (Matin 8h-12h) et une garde (journée entière)
    try {
      await cal.events.insert({ calendarId: id, requestBody: { summary: 'Matin', start: { dateTime: '2026-11-09T08:00:00', timeZone: 'Europe/Paris' }, end: { dateTime: '2026-11-09T12:00:00', timeZone: 'Europe/Paris' } } })
      await cal.events.insert({ calendarId: id, requestBody: { summary: 'garde-FL-1er', start: { date: '2026-11-09' }, end: { date: '2026-11-10' } } })
      const ev = await cal.events.list({ calendarId: id })
      res('4. poser une journee + une garde', ev.data.items.length === 2, ev.data.items.length + ' evenement(s) relus')
    } catch (e) { res('4. poser des evenements', false, err(e)) }

    // 5. Retirer le partage
    try {
      await cal.acl.delete({ calendarId: id, ruleId: 'user:' + CAL_BAC })
      const a = await cal.acl.list({ calendarId: id })
      const encore = a.data.items.some((i) => i.scope.value === CAL_BAC)
      res('5. retirer le partage', !encore, encore ? 'partage toujours present' : 'partage absent a la relecture')
    } catch (e) { res('5. retirer le partage', false, err(e)) }
  } finally {
    // 6. Nettoyage
    try { await cal.calendars.delete({ calendarId: id }); res('6. supprimer l’agenda test', true) }
    catch (e) { res('6. supprimer l’agenda test', false, err(e)) }
  }
})()
