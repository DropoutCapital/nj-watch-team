// Estado persistente de la app (en userData/config.json).
// Guarda identidad del empleado, consentimiento y ajustes. Nada sensible.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

const FILE = () => path.join(app.getPath('userData'), 'config.json')

const DEFAULTS = {
  deviceId: null,
  empleadoId: null,
  nombre: '',
  email: '',
  consentAccepted: false,
  monitoring: false,          // SIEMPRE arranca apagado
  settings: {
    autoStart: true,          // arranca a medir sola en cada encendido (tras consentir)
    pollSeconds: 15,          // cada cuánto mira la app activa
    idleThresholdSeg: 60,     // si no hay actividad N s, cuenta como inactivo
    flushSeconds: 60,         // cada cuánto sube eventos a Supabase
    captureTitles: false,     // capturar título de ventana (puede filtrar datos) — apagado
    captureScreens: false,    // screenshots anunciadas — apagado por defecto
    captureIntervalMin: 10
  }
}

let cache = null

function load () {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) }
    cache.settings = { ...DEFAULTS.settings, ...(cache.settings || {}) }
  } catch {
    cache = structuredClone(DEFAULTS)
  }
  if (!cache.deviceId) {
    cache.deviceId = crypto.randomUUID()
    save()
  }
  return cache
}

function save () {
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2))
}

function set (patch) {
  cache = { ...load(), ...patch }
  save()
  return cache
}

module.exports = { load, save, set }
