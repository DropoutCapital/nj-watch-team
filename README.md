# NJ Watch Team

Medidor de tareas laborales **con consentimiento**. Mide **en qué apps y cuánto tiempo**
trabaja el equipo, para detectar **qué tareas repetitivas conviene automatizar**.

## Qué hace y qué NO hace

**Mide** (solo cuando el empleado activa la medición): app/ventana activa, categoría
(planilla, correo, navegador…), tiempo por app, y si está activo o inactivo.

**No hace, nunca:** registrar lo que se escribe, capturar contraseñas/credenciales, ni
medir nada mientras está en pausa. No hay keylogger de contenido — por diseño.

> Diseñado así a propósito: este grupo opera banco y SII. Un registro de teclas que
> capture claves y las mande a una base sería una brecha para ustedes mismos. Aquí
> solo viajan metadatos de uso, nunca el contenido.

## Estructura

```
app/        App de escritorio (Electron) — Windows y Mac. Botón activar/desactivar.
web/        Landing estática con botón de descarga (Win/Mac).
supabase/   schema.sql — tablas + RLS (la app solo INSERTA con la anon key).
analysis/   analyze.mjs — DeepSeek lee los datos (service_role, en servidor) y
            recomienda qué automatizar.
```

## Puesta en marcha

### 1. Supabase
1. Crea el proyecto y corre `supabase/schema.sql` en el SQL Editor.
2. Copia **URL** y **anon key** (Project Settings → API).
3. Pégalas en `app/src/config/supabase.public.json`.
   - La `anon key` es pública por diseño (va en el cliente) y con RLS solo puede INSERTAR.
   - ⚠️ **La `service_role` NUNCA va en la app.** Solo se usa en `analysis/` (servidor).
   - Si pegaste la `service_role` en algún chat/repositorio, **rótala** en Supabase ya.

### 2. App de escritorio
```bash
cd app
npm install
npm start               # probar en local
npm run dist:mac        # genera .dmg
npm run dist:win        # genera .exe (NSIS)
```
Sube los instaladores a **GitHub Releases** y la landing (`web/`) ya apunta ahí.

**Permisos macOS:** la primera vez pide **Accesibilidad** y **Grabación de pantalla**
(Ajustes → Privacidad y seguridad) para leer la app activa. Si no se conceden, no mide.

### 3. Análisis (qué automatizar)
```bash
cd analysis && npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE=... DEEPSEEK_API_KEY=... node analyze.mjs --dias=7
```
Escribe en la tabla `analisis`: horas por categoría, top apps y recomendaciones de
automatización. Ideal correrlo semanal (cron).

## Endurecer la ingesta (recomendado para producción)
En vez de INSERT directo con la anon key, crear una **Edge Function `ingest`** que valide
un token por dispositivo y escriba con service_role del lado servidor. Así la anon key ni
siquiera puede insertar datos basura. (El esquema actual ya funciona; esto es el siguiente
nivel de seguridad.)

## Privacidad / consentimiento
La app muestra una pantalla de consentimiento al primer arranque, un icono visible siempre
que está activa, y el empleado puede pausarla en cualquier momento desde la ventana o el
icono de la barra. Es monitoreo transparente, no vigilancia encubierta.
