// Análisis con DeepSeek: lee los eventos de Supabase (service_role, SOLO en el
// servidor de Ramón — NUNCA en la app) y produce, por empleado y período:
//   - resumen de tiempo por categoría / top apps
//   - recomendaciones de QUÉ AUTOMATIZAR (tareas repetitivas que comen tiempo)
// Guarda el resultado en la tabla `analisis`.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE=... DEEPSEEK_API_KEY=... \
//   node analysis/analyze.mjs --dias 7
//
// Las credenciales van por variable de entorno, no en el código.

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const SR  = process.env.SUPABASE_SERVICE_ROLE
const DS  = process.env.DEEPSEEK_API_KEY
const DIAS = Number((process.argv.find(a => a.startsWith('--dias='))?.split('=')[1]) || 7)

if (!URL || !SR) { console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE'); process.exit(1) }

const db = createClient(URL, SR, { auth: { persistSession: false } })

const desde = new Date(Date.now() - DIAS * 864e5).toISOString()
const hoy = new Date().toISOString().slice(0, 10)
const inicio = desde.slice(0, 10)

const { data: empleados, error: e1 } = await db.from('empleados').select('id,nombre')
if (e1) { console.error(e1.message); process.exit(1) }

for (const emp of empleados) {
  const { data: ev, error } = await db
    .from('eventos').select('app,categoria,duracion_seg,idle,ts')
    .eq('empleado_id', emp.id).gte('ts', desde)
  if (error) { console.error(emp.nombre, error.message); continue }
  if (!ev || !ev.length) { console.log(`· ${emp.nombre}: sin datos`); continue }

  // Agregados determinísticos (no dejamos los números a la IA).
  const porCat = {}, porApp = {}
  let activo = 0, idle = 0
  for (const r of ev) {
    if (r.idle) { idle += r.duracion_seg; continue }
    activo += r.duracion_seg
    porCat[r.categoria] = (porCat[r.categoria] || 0) + r.duracion_seg
    porApp[r.app] = (porApp[r.app] || 0) + r.duracion_seg
  }
  const horas = s => +(s / 3600).toFixed(1)
  const resumen = {
    dias: DIAS,
    horas_activas: horas(activo),
    horas_inactivas: horas(idle),
    por_categoria: Object.fromEntries(Object.entries(porCat).map(([k, v]) => [k, horas(v)])),
    top_apps: Object.entries(porApp).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([app, s]) => ({ app, horas: horas(s) }))
  }

  const recomendaciones = DS ? await recomendar(emp.nombre, resumen) : [{
    nota: 'Sin DEEPSEEK_API_KEY: solo se guardó el resumen cuantitativo.'
  }]

  await db.from('analisis').insert({
    empleado_id: emp.id, periodo_inicio: inicio, periodo_fin: hoy,
    resumen, recomendaciones
  })
  console.log(`✓ ${emp.nombre}: ${resumen.horas_activas}h activas · ${recomendaciones.length} reco`)
}

async function recomendar (nombre, resumen) {
  const prompt = `Eres analista de productividad. Con estos datos AGREGADOS de uso de apps de ${nombre} (nada de contenido tecleado), identifica tareas repetitivas candidatas a AUTOMATIZAR. Devuelve JSON { "recomendaciones": [{ "tarea": "...", "senal": "por qué se nota en los datos", "ahorro_est_h_sem": number, "como_automatizar": "..." }] }. Datos:\n${JSON.stringify(resumen)}`
  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }, temperature: 0.3
      })
    })
    const j = await r.json()
    const txt = j.choices?.[0]?.message?.content || '{}'
    return JSON.parse(txt).recomendaciones || []
  } catch (e) {
    return [{ error: 'DeepSeek falló: ' + e.message }]
  }
}
