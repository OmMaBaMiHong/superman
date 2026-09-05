import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('/Users/wade/work-space/deepseek-harness/feedfuse-data/feedfuse.sqlite', { readOnly: true })
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name)
console.log('tables:', tables.join(', '))
for (const t of ['feeds', 'articles', 'categories', 'recommended', 'works', 'materials', 'meta']) {
  try {
    const n = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get()
    console.log(t, '=', n.c)
  } catch (e) {
    console.log(t, 'ERR', e.message)
  }
}
console.log('--- meta ---')
for (const m of db.prepare('SELECT key, value FROM meta').all()) {
  console.log(m.key, '=>', String(m.value).slice(0, 160))
}
console.log('--- sample feeds ---')
for (const f of db.prepare('SELECT * FROM feeds LIMIT 4').all()) {
  console.log(f.id, '|', String(f.value).slice(0, 140))
}
console.log('--- sample articles ---')
for (const a of db.prepare('SELECT * FROM articles LIMIT 3').all()) {
  console.log(String(a.value).slice(0, 140))
}
console.log('--- sample works ---')
for (const w of db.prepare('SELECT * FROM works LIMIT 3').all()) {
  console.log(String(w.value).slice(0, 160))
}
console.log('--- sample materials ---')
for (const m of db.prepare('SELECT * FROM materials LIMIT 3').all()) {
  console.log(String(m.value).slice(0, 160))
}
db.close()
