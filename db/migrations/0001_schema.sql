-- =====================================================================
-- MINHA TERAPIA ALIMENTAR — 0001: esquema de tabelas
-- Compatível com Supabase (Postgres 15/16). Todas as tabelas recebem RLS
-- em 0003. Nenhuma tabela é exposta sem política.
-- =====================================================================

-- ---------- Perfis e acesso -----------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  full_name          text not null default '',
  role               text not null check (role in ('master_alana','master_cores','supervisionado','escola','familia')),
  active             boolean not null default true,
  can_publish        boolean not null default false,   -- só supervisionado usa; master sempre pode
  crn                text,                             -- configurável; nunca preenchido pelo sistema
  professional_title text,
  school_name        text,                             -- para contas de escola
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid
);
-- Exatamente um acesso master por identidade (Alana / CoReS)
create unique index profiles_unique_master_alana on public.profiles(role) where role = 'master_alana';
create unique index profiles_unique_master_cores on public.profiles(role) where role = 'master_cores';
create index profiles_role_idx on public.profiles(role);

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  full_name    text,
  role         text not null check (role in ('master_alana','master_cores','supervisionado','escola','familia')),
  patient_ids  uuid[] not null default '{}',
  school_name  text,
  can_publish  boolean not null default false,
  status       text not null default 'pendente' check (status in ('pendente','aceito','cancelado')),
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  send_count   int not null default 0,
  accepted_at  timestamptz
);
create unique index invitations_one_pending_per_email on public.invitations (lower(email)) where status = 'pendente';

-- ---------- Pacientes -------------------------------------------------
create table public.patients (
  id                      uuid primary key default gen_random_uuid(),
  full_name               text not null,
  preferred_name          text,
  birth_date              date not null check (birth_date <= current_date),
  sex_growth              text check (sex_growth in ('F','M')),   -- sexo usado na referência de crescimento
  guardians               jsonb not null default '[]'::jsonb,       -- [{nome, parentesco, telefone, email}]
  school_name             text,
  class_name              text,
  diagnoses               text,
  allergies               text,
  restrictions            text,
  medications             text,
  supplements             text,
  professionals           text,
  reason                  text,
  clinical_notes          text,                                     -- nota clínica interna
  school_photo_authorized boolean not null default false,
  status                  text not null default 'ativo' check (status in ('ativo','arquivado')),
  archived_at             timestamptz,
  is_demo                 boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid
);
create index patients_status_idx on public.patients(status);

-- Vínculo explícito usuário (escola/família) -> paciente
create table public.access_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (user_id, patient_id)
);
create index access_links_patient_idx on public.access_links(patient_id);

-- ---------- Registros clínicos (somente equipe) -----------------------
create table public.anamneses (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  recorded_on    date not null default current_date,
  answers        jsonb not null default '{}'::jsonb,
  status         text not null default 'rascunho' check (status in ('rascunho','finalizada')),
  internal_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

create table public.growth_measurements (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  measured_on    date not null check (measured_on <= current_date),
  weight_kg      numeric(6,3) check (weight_kg > 0 and weight_kg < 300),
  height_cm      numeric(5,1) check (height_cm > 0 and height_cm < 250),
  measure_type   text check (measure_type in ('comprimento','altura')),
  bmi            numeric(5,2) generated always as (
                   case when weight_kg is not null and height_cm is not null
                        then round((weight_kg / ((height_cm/100.0)*(height_cm/100.0)))::numeric, 2) end) stored,
  notes          text,
  internal_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  check (weight_kg is not null or height_cm is not null)
);
create index growth_patient_idx on public.growth_measurements(patient_id, measured_on);

-- Tabelas de referência (LMS) — vazia até importação de fonte oficial
create table public.growth_reference_lms (
  id         bigserial primary key,
  source     text not null,          -- ex.: "OMS"
  version    text not null,          -- ex.: ano/versão da tabela
  indicator  text not null,          -- ex.: "peso_idade", "estatura_idade", "imc_idade"
  sex        text not null check (sex in ('F','M')),
  x_value    numeric not null,       -- idade em meses (ou outra abscissa documentada)
  l numeric not null, m numeric not null, s numeric not null,
  unique (source, version, indicator, sex, x_value)
);

create table public.food_diary_entries (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id) on delete cascade,
  entry_date       date not null,
  entry_time       time,
  meal             text,
  location         text,
  companions       text,
  foods_served     text,      -- OFERECIDO
  foods_accepted   text,      -- CONSUMIDO / aceito
  qty_offered      numeric,
  qty_consumed     numeric,
  qty_unit         text,
  brand_presentation text,
  texture          text,
  temperature      text,
  utensils         text,
  help_needed      text,
  screen_use       text,
  duration_min     int check (duration_min is null or duration_min between 0 and 600),
  behavior_before  text, behavior_during text, behavior_after text,
  hunger_cues      text, satiety_cues text,
  refusal_events   text,
  milk_type        text, formula_name text,
  milk_volume_ml   numeric, milk_frequency text, container text,
  night_offers     text, dilution_info text,
  photo_before_path text, photo_after_path text,
  observations     text,
  internal_notes   text,
  status           text not null default 'rascunho' check (status in ('rascunho','final')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid,
  check (qty_consumed is null or qty_offered is null or qty_unit is not null)
);
create index diary_patient_idx on public.food_diary_entries(patient_id, entry_date);

-- Área escolar: tabela própria (a escola nunca toca em tabelas clínicas)
create table public.school_meal_records (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  record_date   date not null,
  record_time   time,
  meal          text,
  foods_offered text,
  foods_consumed text,
  qty_offered   numeric, qty_consumed numeric, qty_unit text,
  environment   text, companions text,
  duration_min  int check (duration_min is null or duration_min between 0 and 600),
  help_needed   text,
  behavior      text, discomfort text,
  photo_path    text,
  notes         text,
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index school_rec_patient_idx on public.school_meal_records(patient_id, record_date);

create table public.questionnaire_responses (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete cascade,
  age_band           text not null check (age_band in ('menor_2','2_5','6_9','10_12','13_17','18_mais')),
  version            text not null,
  answered_on        date not null default current_date,
  interviewee        text,
  answers            jsonb not null default '{}'::jsonb,  -- { itemId: 0..4 | null(não se aplica) }
  clinical_reasoning text,
  referral_areas     text[] not null default '{}'
                       check (referral_areas <@ array['fonoaudiologia','terapia_ocupacional','psicologia','medicina']),
  status             text not null default 'rascunho' check (status in ('rascunho','finalizado')),
  internal_notes     text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index quest_patient_idx on public.questionnaire_responses(patient_id, answered_on);

create table public.food_repertoire (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id) on delete cascade,
  food_name        text not null,
  food_group       text,
  acceptance       text not null check (acceptance in ('aceito','recusado','em_exploracao')),
  textures         text, temperatures text, brands text, preparations text,
  context_notes    text,
  last_observed_on date,
  internal_notes   text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index repertoire_patient_idx on public.food_repertoire(patient_id);

create table public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete cascade,
  session_date       date not null,
  start_time         time,
  location           text check (location in ('consultorio','domicilio','escola','online','externo')),
  professional_id    uuid references public.profiles(id) on delete set null,
  objectives         text, foods text, activities text, skills text, supports text,
  observed_responses text, outcomes text, guidance text, next_steps text,
  exploration        jsonb not null default '[]'::jsonb,   -- [{alimento, etapas:[tolerou,...]}] sem ordem obrigatória
  status             text not null default 'rascunho' check (status in ('agendada','rascunho','finalizada')),
  internal_notes     text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index sessions_patient_idx on public.sessions(patient_id, session_date);

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  title        text not null,
  kind         text not null check (kind in ('anexo','relatorio','documento')),
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint,
  session_id   uuid references public.sessions(id) on delete set null,
  internal_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

create table public.therapeutic_plans (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  title           text not null,
  status          text not null default 'rascunho' check (status in ('rascunho','ativo','encerrado')),
  activities      text, foods text, materials text,
  family_guidance text, school_guidance text,
  review_date     date,
  based_on_id     uuid references public.therapeutic_plans(id) on delete set null,
  internal_notes  text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

create table public.plan_goals (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.therapeutic_plans(id) on delete cascade,
  patient_id     uuid not null references public.patients(id) on delete cascade,
  term           text not null check (term in ('curto','medio','longo')),
  description    text not null,
  progress       text not null default 'nao_iniciada' check (progress in ('nao_iniciada','em_andamento','alcancada','suspensa')),
  progress_notes text,
  sort_order     int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

create table public.guidances (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  audience       text not null check (audience in ('familia','escola')),
  title          text not null,
  body           text not null,
  internal_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

-- ---------- Conteúdo publicado (versões imutáveis) --------------------
create table public.publications (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  kind         text not null check (kind in ('orientacao','evolucao','planejamento','crescimento','documento')),
  audience     text not null check (audience in ('familia','escola')),
  title        text not null,
  source_table text not null,
  source_id    uuid,
  content      jsonb not null default '{}'::jsonb,    -- instantâneo; nunca contém notas internas
  file_path    text,                                  -- documentos/relatórios liberados
  version      int not null default 1,
  status       text not null default 'ativo' check (status in ('ativo','retirado')),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  withdrawn_by uuid references public.profiles(id) on delete set null,
  withdrawn_at timestamptz
);
create index publications_patient_idx on public.publications(patient_id, status);
create index publications_file_idx on public.publications(file_path) where file_path is not null;

-- ---------- Auditoria, configurações, exclusões ------------------------
create table public.audit_log (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  actor          uuid,
  action         text not null,
  table_name     text not null,
  record_id      uuid,
  patient_id     uuid,
  changed_fields text[],
  old_data       jsonb,      -- apenas para tabelas não clínicas (permissões/publicações)
  new_data       jsonb
);
create index audit_patient_idx on public.audit_log(patient_id, at desc);
create index audit_table_idx on public.audit_log(table_name, at desc);

create table public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.deletion_log (
  id         bigserial primary key,
  patient_id uuid not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);
