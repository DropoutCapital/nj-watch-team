// Ingesta a Supabase por REST directo con fetch. SOLO inserta (telemetría) con
// la anon key pública. No usa @supabase/supabase-js a propósito: esa librería
// inicializa un cliente "realtime" (WebSocket) que revienta dentro de Electron.
// Aquí solo hacemos POST al endpoint REST, que es todo lo que necesitamos.
// Si no hay red, encola en disco y reintenta; así no se pierden eventos.
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

let conf = null

function cfgSupabase () {
  if (conf) return conf
  let file = {}
  try {
    file = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', 'supabase.public.json'), 'utf8')
    )
  } catch { /* usa env */ }
  const url = (process.env.SUPABASE_URL || file.url || '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_ANON_KEY || file.anonKey
  const ok = url && key && !url.includes('TU-PROYECTO') && !key.includes('PEGA_AQUI')
  conf = ok ? { url, key } : null
  if (!conf) console.warn('[supabase] falta url/anonKey en src/config/supabase.public.json')
  return conf
}
// init() se mantiene por compatibilidad; devuelve la config o null.
function init () { return cfgSupabase() }

const QUEUE = () => path.join(app.getPath('userData'), 'queue.json')
function readQueue () { try { return JSON.parse(fs.readFileSync(QUEUE(), 'utf8')) } catch { return [] } }
function writeQueue (q) { try { fs.writeFileSync(QUEUE(), JSON.stringify(q)) } catch {} }
function enqueue (tabla, rows) { const q = readQueue(); q.push({ tabla, rows }); writeQueue(q.slice(-500)) }

// POST de filas a una tabla. Timeout corto para no colgarse si la red está mala.
async function postRows (c, tabla, rows) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(`${c.url}/rest/v1/${tabla}`, {
      method: 'POST',
      headers: {
        apikey: c.key,
        Authorization: `Bearer ${c.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(rows),
      signal: ctrl.signal
    })
    if (!r.ok) { console.warn('[supabase] insert', tabla, r.status, (await r.text()).slice(0, 160)); return false }
    return true
  } catch (e) {
    console.warn('[supabase] insert', tabla, e.message)
    return false
  } finally { clearTimeout(t) }
}

// Inserta filas; si falla, las deja en la cola de disco.
async function insert (tabla, filas) {
  const rows = Array.isArray(filas) ? filas : [filas]
  const c = cfgSupabase()
  if (!c) { enqueue(tabla, rows); return false }
  const ok = await postRows(c, tabla, rows)
  if (!ok) enqueue(tabla, rows)
  return ok
}

// Reintenta lo encolado, en orden (empleado -> sesión -> eventos).
async function flushQueue () {
  const c = cfgSupabase()
  if (!c) return
  const q = readQueue()
  if (!q.length) return
  const quedan = []
  for (const item of q) {
    const ok = await postRows(c, item.tabla, item.rows)
    if (!ok) quedan.push(item)
  }
  writeQueue(quedan)
}

// Sube un archivo a Storage (para capturas opcionales).
async function uploadFile (bucket, filePath, buffer, contentType) {
  const c = cfgSupabase()
  if (!c) return false
  try {
    const r = await fetch(`${c.url}/storage/v1/object/${bucket}/${filePath}`, {
      method: 'POST',
      headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': contentType },
      body: buffer
    })
    return r.ok
  } catch (e) { console.warn('[supabase] upload', e.message); return false }
}

module.exports = { init, insert, flushQueue, uploadFile }
