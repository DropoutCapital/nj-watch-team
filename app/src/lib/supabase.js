// Cliente de ingesta. SOLO inserta (telemetría). Usa la anon key pública.
// Si no hay red, encola en disco y reintenta; así no se pierden eventos.
const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { createClient } = require('@supabase/supabase-js')

let client = null
let conf = null

function init () {
  if (client) return client
  try {
    conf = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', 'supabase.public.json'), 'utf8')
    )
  } catch {
    conf = {}
  }
  const url = process.env.SUPABASE_URL || conf.url
  const key = process.env.SUPABASE_ANON_KEY || conf.anonKey
  if (!url || !key || url.includes('TU-PROYECTO') || key.includes('PEGA_AQUI')) {
    console.warn('[supabase] falta configurar url/anonKey en src/config/supabase.public.json')
    return null
  }
  client = createClient(url, key, { auth: { persistSession: false } })
  return client
}

const QUEUE = () => path.join(app.getPath('userData'), 'queue.json')

function readQueue () {
  try { return JSON.parse(fs.readFileSync(QUEUE(), 'utf8')) } catch { return [] }
}
function writeQueue (q) {
  try { fs.writeFileSync(QUEUE(), JSON.stringify(q)) } catch {}
}

// Inserta una fila; si falla la deja en la cola de disco.
async function insert (tabla, filas) {
  const rows = Array.isArray(filas) ? filas : [filas]
  const c = init()
  if (!c) { enqueue(tabla, rows); return false }
  const { error } = await c.from(tabla).insert(rows)
  if (error) { console.warn('[supabase] insert', tabla, error.message); enqueue(tabla, rows); return false }
  return true
}

function enqueue (tabla, rows) {
  const q = readQueue()
  q.push({ tabla, rows })
  writeQueue(q.slice(-500)) // tope para no crecer sin fin
}

// Reintenta lo encolado. Llamar periódicamente.
async function flushQueue () {
  const c = init()
  if (!c) return
  let q = readQueue()
  if (!q.length) return
  const quedan = []
  for (const item of q) {
    const { error } = await c.from(item.tabla).insert(item.rows)
    if (error) quedan.push(item)
  }
  writeQueue(quedan)
}

module.exports = { init, insert, flushQueue }
