// Mapea el nombre de la app a una categoría de trabajo. Esto es lo que permite
// después decir "pasa 3h/día en planillas → candidato a automatizar".
// Ajusta libremente a las apps reales del equipo.

const REGLAS = [
  { cat: 'hoja_calculo',   re: /excel|numbers|sheets|libreoffice calc|google sheets/i },
  { cat: 'correo',         re: /outlook|mail|gmail|thunderbird|spark/i },
  { cat: 'navegador',      re: /chrome|safari|firefox|edge|brave|arc|opera/i },
  { cat: 'mensajeria',     re: /whatsapp|slack|teams|telegram|discord|messages/i },
  { cat: 'documento',      re: /word|pages|docs|writer|notion|obsidian/i },
  { cat: 'pdf',            re: /acrobat|preview|pdf/i },
  { cat: 'erp_contable',   re: /sap|odoo|defontana|nubox|softland|bsale|manager/i },
  { cat: 'banco_sii',      re: /santander|banco|sii|tesoreria/i },
  { cat: 'diseno',         re: /photoshop|illustrator|figma|canva|premiere|final cut/i },
  { cat: 'desarrollo',     re: /code|xcode|terminal|iterm|intellij|pycharm|cursor/i },
  { cat: 'reuniones',      re: /zoom|meet|webex|teams/i }
]

function categoria (app = '') {
  for (const r of REGLAS) if (r.re.test(app)) return r.cat
  return 'otros'
}

module.exports = { categoria }
