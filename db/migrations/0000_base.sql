-- =====================================================================
-- MINHA TERAPIA ALIMENTAR — 0000: base de identidade e armazenamento
-- Autenticação própria do aplicativo (senha com hash, sessões e tokens de uso único)
-- dentro do PostgreSQL. Usa PostgreSQL puro (13+): não depende de Supabase.
-- Os esquemas "auth" e "storage" seguem a mesma forma do Supabase de propósito,
-- para que as políticas de segurança (0003/0004) sejam as mesmas.
-- ATENÇÃO: não execute em um projeto Supabase existente (conflita com o esquema auth dele).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  password_hash      text,                       -- argon2id (Bun.password); nunca em texto puro
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create unique index auth_users_email_uq on auth.users (lower(email));

-- Identidade da requisição: o servidor define request.jwt.claims dentro de cada transação
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))
$$;

-- Sessões (somente o hash do token fica no banco)
create table auth.sessions (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  user_id      uuid not null references auth.users(id) on delete cascade,
  csrf         text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index auth_sessions_user_idx on auth.sessions(user_id);

-- Tokens de uso único: convite e recuperação de senha (somente o hash é guardado)
create table auth.tokens (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  kind       text not null check (kind in ('convite','recuperacao')),
  email      text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index auth_tokens_email_idx on auth.tokens(lower(email), kind);

-- Caixa de saída: quando o envio de e-mail não está configurado, o link fica aqui
-- (visível apenas para master na tela "Usuários e acessos") para ser entregue manualmente.
create table auth.outbox (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  kind       text not null,
  subject    text not null,
  link       text not null,
  token_id   uuid references auth.tokens(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

-- Armazenamento privado: índice de arquivos (os bytes ficam em disco privado, fora de /public)
create schema if not exists storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  mime_type text,
  size_bytes bigint,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
$$;

-- Privilégios: authenticated só enxerga o que as políticas liberarem; anon nada.
grant usage on schema auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;      -- somente o servidor
grant all on all tables in schema storage to service_role;
grant select, insert on storage.objects to authenticated;     -- RLS decide quais linhas
grant select on storage.buckets to authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
