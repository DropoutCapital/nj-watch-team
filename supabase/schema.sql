-- nj-watch-team · esquema Supabase
-- Monitoreo laboral CON CONSENTIMIENTO. Mide USO DE APPS Y TIEMPO, nunca contenido
-- tecleado ni credenciales. La app usa SOLO la anon key; la service_role jamás va
-- dentro del ejecutable (se filtraría a todos los equipos).
--
-- Ejecutar en el SQL Editor del proyecto Supabase.

-- ───────────────────────── Tablas ─────────────────────────

create table if not exists public.empleados (
  id          uuid primary key,              -- lo genera la app (crypto.randomUUID)
  nombre      text not null,
  email       text,
  device_id   text not null,
  os          text,
  created_at  timestamptz not null default now()
);

create table if not exists public.sesiones (
  id          uuid primary key,              -- generado por la app al activar
  empleado_id uuid not null references public.empleados(id),
  inicio      timestamptz not null,
  app_version text,
  os          text
);

-- Un evento = "estuve X segundos en la app Y (categoría Z)". Sin texto tecleado.
create table if not exists public.eventos (
  id            uuid primary key,
  sesion_id     uuid not null references public.sesiones(id),
  empleado_id   uuid not null references public.empleados(id),
  ts            timestamptz not null,
  app           text not null,               -- p.ej. "Google Chrome", "Excel"
  categoria     text not null,               -- navegador, hoja_calculo, correo, ...
  titulo        text,                         -- OPCIONAL, apagado por defecto
  duracion_seg  int  not null default 0,
  teclas_min    int,                          -- MÉTRICA: pulsaciones/min (NO el texto)
  idle          boolean not null default false
);

-- Capturas de pantalla OPCIONALES y anunciadas. Apagadas por defecto.
create table if not exists public.capturas (
  id            uuid primary key,
  sesion_id     uuid not null references public.sesiones(id),
  empleado_id   uuid not null references public.empleados(id),
  ts            timestamptz not null,
  storage_path  text not null,
  categoria     text
);

-- Resultado del análisis de DeepSeek: qué tareas y qué conviene automatizar.
create table if not exists public.analisis (
  id              uuid primary key default gen_random_uuid(),
  empleado_id     uuid references public.empleados(id),
  periodo_inicio  date not null,
  periodo_fin     date not null,
  resumen         jsonb not null,            -- tiempo por categoría, top apps, etc.
  recomendaciones jsonb not null,            -- [{tarea, frecuencia, ahorro_est, como}]
  created_at      timestamptz not null default now()
);

create index if not exists eventos_empleado_ts on public.eventos (empleado_id, ts);
create index if not exists eventos_sesion       on public.eventos (sesion_id);

-- ───────────────────────── RLS ─────────────────────────
-- La anon key es pública: por eso la app SOLO puede INSERTAR (telemetría),
-- nunca leer ni borrar. Leer para análisis/dashboard se hace con service_role
-- (en el servidor de Ramón) o con usuarios autenticados del dashboard.

alter table public.empleados enable row level security;
alter table public.sesiones  enable row level security;
alter table public.eventos   enable row level security;
alter table public.capturas  enable row level security;
alter table public.analisis  enable row level security;

-- INSERT abierto a anon (ingesta). Sin SELECT/UPDATE/DELETE para anon.
create policy ins_empleados on public.empleados for insert to anon with check (true);
create policy ins_sesiones  on public.sesiones  for insert to anon with check (true);
create policy ins_eventos   on public.eventos   for insert to anon with check (true);
create policy ins_capturas  on public.capturas  for insert to anon with check (true);

-- Nota de endurecimiento (recomendado para producción):
--   En vez de INSERT directo con anon, usar una Edge Function "ingest" que valide
--   un token por dispositivo y escriba con service_role. Así la anon key ni siquiera
--   puede insertar basura. Ver README → "Endurecer la ingesta".

-- Storage para capturas (solo si activas screenshots):
--   1) Crear bucket privado "capturas".
--   2) Policy de INSERT para anon; sin lectura pública.
