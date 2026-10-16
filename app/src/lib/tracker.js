// Lee la ventana/app activa del sistema. En macOS requiere permisos de
// Accesibilidad/Grabación de pantalla (ver README). Devuelve solo nombre de app
// y, si el usuario lo activó, el título de la ventana.
const activeWin = require('active-win')

async function ventanaActiva () {
  try {
    const w = await activeWin()
    if (!w) return null
    return {
      app: (w.owner && w.owner.name) ? w.owner.name : 'desconocido',
      title: w.title || ''
    }
  } catch (e) {
    return null
  }
}

module.exports = { ventanaActiva }
