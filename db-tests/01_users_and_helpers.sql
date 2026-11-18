-- Usuários de teste via CONVITE (exercita o gatilho que bloqueia cadastro sem convite)
insert into public.invitations(email, full_name, role, school_name, can_publish) values
  ('master.alana@demo.invalid', 'Master Alana (demo)', 'master_alana', null, false),
  ('master.cores@demo.invalid', 'Master CoReS (demo)', 'master_cores', null, false),
  ('supervisionada@demo.invalid', 'Supervisionada Demo', 'supervisionado', null, false),
  ('escola.a@demo.invalid', 'Escola Demo A', 'escola', 'Escola Demo A', false),
  ('escola.b@demo.invalid', 'Escola Demo B', 'escola', 'Escola Demo B', false),
  ('familia.a@demo.invalid', 'Família Demo A', 'familia', null, false),
  ('familia.b@demo.invalid', 'Família Demo B', 'familia', null, false);

insert into auth.users(email, email_confirmed_at) values
  ('master.alana@demo.invalid', now()), ('master.cores@demo.invalid', now()),
  ('supervisionada@demo.invalid', now()), ('escola.a@demo.invalid', now()), ('escola.b@demo.invalid', now()),
  ('familia.a@demo.invalid', now()), ('familia.b@demo.invalid', now());

-- ---------- Auxiliares de teste ------------------------------------------
create schema t;
create table t.results (id serial primary key, name text not null, ok boolean not null, detail text);
grant usage on schema t to public;
grant all on t.results to public;
grant usage on all sequences in schema t to public;

-- Assume a identidade de um usuário exatamente como o PostgREST faz (papel + claims do JWT)
create function t.login(p_email text) returns void language plpgsql as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is null then raise exception 'usuário de teste % inexistente', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function t.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create function t.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Executa SQL com a identidade atual; devolve contagem de linhas ou o SQLSTATE do erro
create function t.count(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') x' into n;
  return n;
exception when others then
  return -1;   -- erro (ex.: sem privilégio) conta como "sem acesso"
end $$;

create function t.try(q text) returns text language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'ok:' || n;
exception when others then
  return 'err:' || sqlstate;
end $$;

create function t.record(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into t.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;
