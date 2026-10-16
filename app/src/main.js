const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain,
  powerMonitor, Notification, desktopCapturer, screen, shell
} = require('electron')
const path = require('path')
const crypto = require('crypto')
const cfg = require('./lib/config')
const sb = require('./lib/supabase')
const { ventanaActiva } = require('./lib/tracker')
const { categoria } = require('./lib/categorias')
let autoUpdater = null
try { autoUpdater = require('electron-updater').autoUpdater } catch { /* dev sin dep */ }

let tray = null
let win = null
let pollTimer = null
let flushTimer = null
let captureTimer = null
let sesionId = null

// Acumulador en memoria: clave = app|categoria → segundos.
let buckets = new Map()
let lastCapture = 0

// Resumen del día (para mostrar en la UI, se guarda local).
let diaKey = hoy()
let diaResumen = {}

function hoy () { return new Date().toISOString().slice(0, 10) }

// ───────────────────────── Ventana + Tray ─────────────────────────

function crearVentana () {
  win = new BrowserWindow({
    width: 460, height: 620, resizable: false, show: false,
    title: 'NJ Watch Team',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  })
  const c = cfg.load()
  win.loadFile(path.join(__dirname, c.consentAccepted ? 'renderer.html' : 'consent.html'))
  win.once('ready-to-show', () => win.show())
  win.on('close', (e) => { // cerrar = minimizar a tray, no salir
    if (!app.isQuitting) { e.preventDefault(); win.hide() }
  })
}

function iconTemplate () {
  // Icono simple 16x16 generado en runtime (punto verde/gris según estado).
  const c = cfg.load()
  const on = c.monitoring
  const size = 16
  const png = nativeImage.createEmpty()
  // fallback: usar emoji vía título; icono vacío + tooltip es suficiente multiplataforma
  return png.isEmpty() ? nativeImage.createFromDataURL(dotDataUrl(on)) : png
}

function dotDataUrl (on) {
  const color = on ? '23c55e' : '9ca3af'
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='6' fill='%23${color}'/></svg>`
  return 'data:image/svg+xml,' + svg
}

function crearTray () {
  tray = new Tray(iconTemplate())
  actualizarTray()
  tray.on('click', () => { if (win) win.isVisible() ? win.hide() : win.show() })
}

function actualizarTray () {
  const c = cfg.load()
  tray.setToolTip(`NJ Watch Team · ${c.monitoring ? 'Midiendo (activo)' : 'En pausa'}`)
  tray.setImage(iconTemplate())
  const menu = Menu.buildFromTemplate([
    { label: c.monitoring ? '● Midiendo tu trabajo' : '○ En pausa', enabled: false },
    { type: 'separator' },
    { label: c.monitoring ? 'Desactivar' : 'Activar', click: () => toggle() },
    { label: 'Abrir ventana', click: () => win && win.show() },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu)
}

// Auto-inicio con el sistema (abierto en segundo plano al prender el PC).
function aplicarLoginItem (activar) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!activar, openAsHidden: true, args: ['--autostart'] })
  } catch (e) { console.warn('[loginItem]', e.message) }
}

// ───────────────────────── Registro empleado ─────────────────────────

async function registrarEmpleadoSiFalta () {
  const c = cfg.load()
  if (c.empleadoId) return
  const id = crypto.randomUUID()
  await sb.insert('empleados', {
    id, nombre: c.nombre || 'Sin nombre', email: c.email || null,
    device_id: c.deviceId, os: process.platform
  })
  cfg.set({ empleadoId: id })
}

// ───────────────────────── Monitoreo ─────────────────────────

async function toggle () {
  const c = cfg.load()
  c.monitoring ? await detener() : iniciar()
  actualizarTray()
  if (win) win.webContents.send('estado', estado())
}

// Activa SIN bloquear por red: cambia el estado y arranca los timers al instante;
// el registro en Supabase va en segundo plano (si no hay red, queda en cola).
function iniciar () {
  const c = cfg.load()
  if (!c.consentAccepted) return
  sesionId = crypto.randomUUID()
  cfg.set({ monitoring: true })
  buckets = new Map()
  const s = c.settings
  pollTimer = setInterval(poll, s.pollSeconds * 1000)
  flushTimer = setInterval(flush, s.flushSeconds * 1000)
  if (s.captureScreens) captureTimer = setInterval(maybeCapture, 30 * 1000)
  try { new Notification({ title: 'NJ Watch Team', body: 'Medición ACTIVADA. Puedes desactivarla cuando quieras.' }).show() } catch {}
  registrarYSesion().catch(e => console.warn('[iniciar bg]', e.message))
}

// Registro en segundo plano: empleado + sesión. sb.insert encola si no hay red.
async function registrarYSesion () {
  await registrarEmpleadoSiFalta()
  const cc = cfg.load()
  await sb.insert('sesiones', {
    id: sesionId, empleado_id: cc.empleadoId,
    inicio: new Date().toISOString(), app_version: app.getVersion(), os: process.platform
  })
}

async function detener () {
  cfg.set({ monitoring: false })
  clearInterval(pollTimer); clearInterval(flushTimer); clearInterval(captureTimer)
  pollTimer = flushTimer = captureTimer = null
  await flush()
  new Notification({ title: 'NJ Watch Team', body: 'Medición en pausa.' }).show()
}

async function poll () {
  const c = cfg.load()
  const idleSeg = powerMonitor.getSystemIdleTime()
  const paso = c.settings.pollSeconds
  if (idleSeg >= c.settings.idleThresholdSeg) {
    acumular('(inactivo)', 'idle', paso, true)
    return
  }
  let w = null
  try { w = await ventanaActiva() } catch (e) { console.warn('[poll]', e.message) }
  if (w && w.app) {
    acumular(w.app, categoria(w.app), paso, false, c.settings.captureTitles ? w.title : null)
  } else {
    // No se pudo leer la app (permiso/compatibilidad), pero el usuario ESTÁ
    // activo: igual contamos el tiempo para no perder el dato.
    acumular('(activo)', 'otros', paso, false)
  }
}

function acumular (appName, cat, seg, idle, titulo = null) {
  const key = `${appName}|${cat}|${idle}`
  const b = buckets.get(key) || { app: appName, categoria: cat, idle, titulo, seg: 0 }
  b.seg += seg
  if (titulo) b.titulo = titulo
  buckets.set(key, b)
  // resumen del día (por categoría) para la UI
  if (diaKey !== hoy()) { diaKey = hoy(); diaResumen = {} }
  if (!idle) diaResumen[cat] = (diaResumen[cat] || 0) + seg
}

async function flush () {
  const c = cfg.load()
  // Espera a tener empleadoId (lo pone el registro en segundo plano); mientras,
  // los datos se acumulan en memoria y no se pierden.
  if (!buckets.size || !sesionId || !c.empleadoId) return
  const ts = new Date().toISOString()
  const filas = [...buckets.values()].map(b => ({
    id: crypto.randomUUID(), sesion_id: sesionId, empleado_id: c.empleadoId,
    ts, app: b.app, categoria: b.categoria, titulo: b.titulo || null,
    duracion_seg: b.seg, teclas_min: null, idle: b.idle
  }))
  buckets = new Map()
  await sb.insert('eventos', filas)
  await sb.flushQueue()
}

// Captura ANUNCIADA (solo si el usuario activó screenshots).
async function maybeCapture () {
  const c = cfg.load()
  if (!c.monitoring || !c.settings.captureScreens) return
  const ahora = Date.now()
  if (ahora - lastCapture < c.settings.captureIntervalMin * 60 * 1000) return
  lastCapture = ahora
  try {
    const { width, height } = screen.getPrimaryDisplay().size
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width / 2), height: Math.round(height / 2) } })
    if (!sources[0]) return
    // Anuncio visible ANTES de guardar.
    new Notification({ title: 'NJ Watch Team', body: 'Captura de pantalla tomada (medición activa).' }).show()
    const png = sources[0].thumbnail.toPNG()
    if (!c.empleadoId) return
    const filePath = `${c.empleadoId}/${Date.now()}.png`
    const ok = await sb.uploadFile('capturas', filePath, png, 'image/png')
    if (ok) {
      await sb.insert('capturas', {
        id: crypto.randomUUID(), sesion_id: sesionId, empleado_id: c.empleadoId,
        ts: new Date().toISOString(), storage_path: filePath, categoria: null
      })
    }
  } catch (e) { console.warn('[captura]', e.message) }
}

// ───────────────────────── IPC (UI) ─────────────────────────

function estado () {
  const c = cfg.load()
  return {
    monitoring: c.monitoring, nombre: c.nombre, email: c.email,
    consentAccepted: c.consentAccepted, settings: c.settings,
    dia: diaResumen
  }
}

ipcMain.handle('getState', () => estado())
ipcMain.handle('toggle', () => toggle())
ipcMain.handle('saveProfile', (_e, { nombre, email }) => cfg.set({ nombre, email }))
ipcMain.handle('aceptarConsent', async (_e, { nombre, email }) => {
  cfg.set({ consentAccepted: true, nombre: nombre || '', email: email || '' })
  aplicarLoginItem(true)                 // desde ahora arranca con el PC
  win.loadFile(path.join(__dirname, 'renderer.html'))
  const c = cfg.load()
  if (c.settings.autoStart && !c.monitoring) { iniciar(); actualizarTray() }
})
ipcMain.handle('setSetting', (_e, patch) => {
  const c = cfg.load()
  cfg.set({ settings: { ...c.settings, ...patch } })
  return estado()
})
ipcMain.handle('rechazarConsent', () => { app.isQuitting = true; app.quit() })

// ───────────────────────── Ciclo de vida ─────────────────────────

const unico = app.requestSingleInstanceLock()
if (!unico) { app.quit() } else {
  app.on('second-instance', () => { if (win) win.show() })
  app.whenReady().then(async () => {
    crearVentana()
    crearTray()
    // Buffer offline: reintenta subir lo encolado cada 30 s y apenas arranca,
    // así lo guardado sin internet se manda en cuanto vuelve el wifi.
    sb.flushQueue()
    setInterval(() => sb.flushQueue(), 30 * 1000)
    // Y al despertar/desbloquear el equipo (típico cuando vuelve la red).
    powerMonitor.on('resume', () => sb.flushQueue())
    powerMonitor.on('unlock-screen', () => sb.flushQueue())

    const c = cfg.load()
    // Auto-inicio al prender el PC (solo si ya consintió).
    aplicarLoginItem(c.consentAccepted)
    // Auto-reanudar la medición en cada arranque (sigue visible y pausable).
    if (c.consentAccepted && c.settings.autoStart && !c.monitoring) {
      iniciar()
      actualizarTray()
    }
    // Auto-actualización desde GitHub Releases (solo app empaquetada).
    if (autoUpdater && app.isPackaged) {
      autoUpdater.autoDownload = true
      autoUpdater.on('update-downloaded', () => {
        new Notification({ title: 'NJ Watch Team', body: 'Actualización lista, se aplicará al reiniciar.' }).show()
      })
      autoUpdater.checkForUpdates().catch(() => {})
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000)
    }
  })
  app.on('window-all-closed', (e) => { /* vive en tray */ })
}
