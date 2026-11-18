-- =====================================================================
-- 0002: funções auxiliares, gatilhos, auditoria, RPCs
-- =====================================================================

-- ---------- Funções de identidade (SECURITY DEFINER, sem recursão RLS) --
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('master_alana','master_cores'), false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('master_alana','master_cores','supervisionado'), false)
$$;

create or replace function public.is_school() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'escola', false)
$$;

create or replace function public.is_family() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'familia', false)
$$;

-- Master sempre; supervisionado somente com autorização explícita de um master
create or replace function public.can_publish() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role in ('master_alana','master_cores') or (p.role = 'supervisionado' and p.can_publish))
  )
$$;

-- Vínculo ativo, usuário ativo e paciente ativo (paciente arquivado corta o acesso externo)
create or replace function public.has_link(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.access_links l
    join public.profiles p on p.id = l.user_id
    join public.patients pt on pt.id = l.patient_id
    where l.user_id = auth.uid() and l.patient_id = pid
      and l.active and p.active and p.role in ('escola','familia') and pt.status = 'ativo'
  )
$$;

create or replace function public.school_photo_ok(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select school_photo_authorized from public.patients where id = pid and status = 'ativo'), false)
$$;

-- Primeiro segmento do caminho do arquivo = id do paciente
create or replace function public.storage_patient_id(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return nullif(split_part(p_name, '/', 1), '')::uuid;
exception when others then
  return null;
end $$;

create or replace function public.valid_answers(a jsonb) returns boolean
language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(a) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(a) loop
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'number' then return false; end if;
    if (v::text)::numeric not in (0,1,2,3,4) then return false; end if;
  end loop;
  return true;
end $$;

alter table public.questionnaire_responses
  add constraint quest_answers_valid check (public.valid_answers(answers));

-- ---------- Autoria e datas ------------------------------------------
create or replace function public.tg_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

create or replace function public.tg_touch_settings() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','patients','access_links','anamneses','growth_measurements',
    'food_diary_entries','school_meal_records','questionnaire_responses','food_repertoire','sessions',
    'documents','therapeutic_plans','plan_goals','guidances']
  loop
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.tg_touch()', t);
  end loop;
end $$;

create trigger touch before insert or update on public.app_settings
  for each row execute function public.tg_touch_settings();

-- ---------- Proteção de perfis (anti-escalada) -------------------------
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql as $$
declare is_service boolean := current_user in ('postgres','service_role','supabase_admin');
begin
  if is_service then return new; end if;

  if new.id is distinct from old.id or new.email is distinct from old.email or new.role is distinct from old.role then
    raise exception 'Papel, e-mail e identificador não podem ser alterados.' using errcode = '42501';
  end if;

  if not public.is_master() then
    -- usuário comum: somente dados cadastrais do próprio perfil
    if new.active is distinct from old.active or new.can_publish is distinct from old.can_publish
       or new.school_name is distinct from old.school_name then
      raise exception 'Alteração de permissões não autorizada.' using errcode = '42501';
    end if;
  end if;

  if old.role in ('master_alana','master_cores') and new.active = false then
    raise exception 'Contas master não podem ser desativadas pelo aplicativo.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard before update on public.profiles for each row execute function public.tg_profiles_guard();

-- ---------- Proteção de pacientes -------------------------------------
create or replace function public.tg_patients_guard() returns trigger
language plpgsql as $$
declare is_service boolean := current_user in ('postgres','service_role','supabase_admin');
begin
  if tg_op = 'UPDATE' then
    if not (is_service or public.is_master()) then
      if new.status is distinct from old.status
         or new.school_photo_authorized is distinct from old.school_photo_authorized
         or new.is_demo is distinct from old.is_demo then
        raise exception 'Somente master arquiva pacientes ou autoriza fotos escolares.' using errcode = '42501';
      end if;
    end if;
    if new.status = 'arquivado' and old.status <> 'arquivado' then new.archived_at := now();
    elsif new.status = 'ativo' then new.archived_at := null; end if;
  end if;
  return new;
end $$;
create trigger guard before update on public.patients for each row execute function public.tg_patients_guard();

-- plan_goals herda o paciente do plano
create or replace function public.tg_goal_patient() returns trigger
language plpgsql as $$
begin
  select patient_id into new.patient_id from public.therapeutic_plans where id = new.plan_id;
  if new.patient_id is null then raise exception 'Plano inexistente.'; end if;
  return new;
end $$;
create trigger goal_patient before insert or update on public.plan_goals for each row execute function public.tg_goal_patient();

-- Foto precisa estar na pasta do próprio paciente
create or replace function public.tg_photo_path_guard() returns trigger
language plpgsql as $$
declare j jsonb := to_jsonb(new); p text;
begin
  foreach p in array array['photo_path','photo_before_path','photo_after_path'] loop
    if j ->> p is not null and public.storage_patient_id(j ->> p) is distinct from new.patient_id then
      raise exception 'Caminho de arquivo não pertence ao paciente.' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
create trigger photo_guard before insert or update on public.food_diary_entries for each row execute function public.tg_photo_path_guard();
create trigger photo_guard before insert or update on public.school_meal_records for each row execute function public.tg_photo_path_guard();

-- Escola: não pode alterar vínculo, autoria nem revisão; fotos só se autorizadas
create or replace function public.tg_school_record_guard() returns trigger
language plpgsql as $$
begin
  if public.is_school() then
    if tg_op = 'INSERT' then
      new.reviewed_by := null; new.reviewed_at := null;
    else
      if new.patient_id is distinct from old.patient_id or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at then
        raise exception 'Campos de revisão e vínculo não podem ser alterados pela escola.' using errcode = '42501';
      end if;
    end if;
    if new.photo_path is not null and not public.school_photo_ok(new.patient_id) then
      raise exception 'Foto não autorizada para este paciente.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger school_guard before insert or update on public.school_meal_records
  for each row execute function public.tg_school_record_guard();

-- Publicações: conteúdo imutável; só se pode retirar
create or replace function public.tg_publications_immutable() returns trigger
language plpgsql as $$
begin
  if (new.patient_id, new.kind, new.audience, new.title, new.source_table, new.source_id, new.content,
      new.file_path, new.version, new.published_by, new.published_at)
     is distinct from
     (old.patient_id, old.kind, old.audience, old.title, old.source_table, old.source_id, old.content,
      old.file_path, old.version, old.published_by, old.published_at) then
    raise exception 'Conteúdo publicado é imutável; publique uma nova versão.' using errcode = '42501';
  end if;
  if old.status = 'retirado' and new.status = 'ativo' then
    raise exception 'Liberação retirada não pode ser reativada; publique novamente.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger immutable before update on public.publications for each row execute function public.tg_publications_immutable();

-- ---------- Auditoria --------------------------------------------------
-- Tabelas clínicas: apenas NOMES dos campos alterados (sem conteúdo clínico).
-- Tabelas de permissão/publicação: valores antigos e novos.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_changed text[]; v_pid uuid;
  v_mode text := coalesce(tg_argv[0], 'fields');
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_pid := case when tg_table_name = 'patients' then (v_row ->> 'id')::uuid else (v_row ->> 'patient_id')::uuid end;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    select array_agg(n.key order by n.key) into v_changed
      from jsonb_each(v_new) n
      where (v_old -> n.key) is distinct from n.value and n.key not in ('updated_at','updated_by');
    if v_changed is null then return new; end if;
  end if;

  insert into public.audit_log(actor, action, table_name, record_id, patient_id, changed_fields, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name, (v_row ->> 'id')::uuid, v_pid, v_changed,
          case when v_mode = 'full' and tg_op <> 'INSERT' then
               case when tg_op = 'DELETE' then to_jsonb(old) else v_old end end,
          case when v_mode = 'full' and tg_op <> 'DELETE' then to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients','anamneses','growth_measurements','food_diary_entries','school_meal_records',
    'questionnaire_responses','food_repertoire','sessions','documents','therapeutic_plans','plan_goals','guidances']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row(%L)', t, 'fields');
  end loop;
  foreach t in array array['profiles','invitations','access_links','publications','app_settings']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row(%L)', t, 'full');
  end loop;
end $$;

-- ---------- Convite obrigatório (bloqueia cadastro público no banco) ---
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations
   where lower(email) = lower(new.email) and status = 'pendente'
   order by created_at desc limit 1;
  if not found then
    raise exception 'Cadastro permitido somente por convite.' using errcode = 'P0001';
  end if;

  insert into public.profiles(id, email, full_name, role, can_publish, school_name)
  values (new.id, new.email, coalesce(inv.full_name, ''), inv.role,
          inv.can_publish and inv.role = 'supervisionado', inv.school_name);

  if inv.role in ('escola','familia') then
    insert into public.access_links(user_id, patient_id, created_by)
    select new.id, p.id, inv.invited_by from public.patients p where p.id = any(inv.patient_ids);
  end if;

  if new.email_confirmed_at is not null then
    update public.invitations set status = 'aceito', accepted_at = now() where id = inv.id;
  end if;
  return new;
end $$;

create or replace function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.invitations set status = 'aceito', accepted_at = now()
     where lower(email) = lower(new.email) and status = 'pendente';
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

-- ---------- Publicação para família/escola (RPC) -----------------------
-- O instantâneo é montado NO BANCO, sem notas internas, a partir do registro-fonte.
create or replace function public.publish_record(
  p_patient_id uuid, p_source_table text, p_source_id uuid, p_audience text, p_title text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_content jsonb; v_kind text; v_file text; v_title text; v_ver int; v_id uuid;
  r record;
begin
  if not public.can_publish() then
    raise exception 'Sem permissão para liberar conteúdo.' using errcode = '42501';
  end if;
  if p_audience not in ('familia','escola') then raise exception 'Destinatário inválido.'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id) then
    raise exception 'Paciente inexistente.';
  end if;

  if p_source_table = 'guidances' then
    select * into r from public.guidances where id = p_source_id and patient_id = p_patient_id;
    if not found then raise exception 'Orientação inexistente.'; end if;
    if r.audience <> p_audience then raise exception 'Destinatário diferente do definido na orientação.'; end if;
    v_kind := 'orientacao'; v_title := coalesce(p_title, r.title);
    v_content := jsonb_build_object('titulo', r.title, 'texto', r.body);

  elsif p_source_table = 'sessions' then
    if p_audience <> 'familia' then raise exception 'Evolução só pode ser liberada para a família.'; end if;
    select * into r from public.sessions where id = p_source_id and patient_id = p_patient_id;
    if not found then raise exception 'Sessão inexistente.'; end if;
    v_kind := 'evolucao'; v_title := coalesce(p_title, 'Evolução da sessão de ' || to_char(r.session_date, 'DD/MM/YYYY'));
    v_content := jsonb_strip_nulls(jsonb_build_object(
      'data', r.session_date, 'local', r.location, 'objetivos', r.objectives, 'alimentos', r.foods,
      'atividades', r.activities, 'habilidades', r.skills, 'resultados', r.outcomes,
      'orientacoes', r.guidance, 'proximos_passos', r.next_steps));

  elsif p_source_table = 'therapeutic_plans' then
    select * into r from public.therapeutic_plans where id = p_source_id and patient_id = p_patient_id;
    if not found then raise exception 'Planejamento inexistente.'; end if;
    v_kind := 'planejamento'; v_title := coalesce(p_title, r.title);
    if p_audience = 'escola' then
      v_content := jsonb_strip_nulls(jsonb_build_object('titulo', r.title, 'orientacoes_escola', r.school_guidance));
    else
      v_content := jsonb_strip_nulls(jsonb_build_object(
        'titulo', r.title, 'atividades', r.activities, 'alimentos', r.foods, 'materiais', r.materials,
        'orientacoes_familia', r.family_guidance, 'revisao', r.review_date,
        'metas', (select coalesce(jsonb_agg(jsonb_build_object('prazo', g.term, 'descricao', g.description,
                                                              'andamento', g.progress) order by g.sort_order, g.created_at), '[]'::jsonb)
                    from public.plan_goals g where g.plan_id = r.id)));
    end if;

  elsif p_source_table = 'growth_measurements' then
    if p_audience <> 'familia' then raise exception 'Crescimento só pode ser liberado para a família.'; end if;
    p_source_id := null; v_kind := 'crescimento'; v_title := coalesce(p_title, 'Medidas de crescimento');
    v_content := jsonb_build_object('medidas',
      (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('data', measured_on, 'peso_kg', weight_kg,
              'altura_cm', height_cm, 'tipo', measure_type, 'imc', bmi, 'observacoes', notes))
              order by measured_on), '[]'::jsonb)
         from public.growth_measurements where patient_id = p_patient_id));

  elsif p_source_table = 'documents' then
    select * into r from public.documents where id = p_source_id and patient_id = p_patient_id;
    if not found then raise exception 'Documento inexistente.'; end if;
    v_kind := 'documento'; v_title := coalesce(p_title, r.title); v_file := r.storage_path;
    v_content := jsonb_build_object('titulo', r.title);
  else
    raise exception 'Tipo de registro não publicável.';
  end if;

  update public.publications
     set status = 'retirado', withdrawn_by = auth.uid(), withdrawn_at = now()
   where patient_id = p_patient_id and source_table = p_source_table
     and source_id is not distinct from p_source_id and audience = p_audience and status = 'ativo';

  select coalesce(max(version), 0) + 1 into v_ver from public.publications
   where patient_id = p_patient_id and source_table = p_source_table
     and source_id is not distinct from p_source_id and audience = p_audience;

  insert into public.publications(patient_id, kind, audience, title, source_table, source_id, content, file_path, version, published_by)
  values (p_patient_id, v_kind, p_audience, v_title, p_source_table, p_source_id, v_content, v_file, v_ver, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.withdraw_publication(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_publish() then
    raise exception 'Sem permissão para retirar liberações.' using errcode = '42501';
  end if;
  update public.publications set status = 'retirado', withdrawn_by = auth.uid(), withdrawn_at = now()
   where id = p_id and status = 'ativo';
end $$;

-- ---------- Exclusão definitiva controlada (somente master) -----------
create or replace function public.delete_patient_permanently(p_patient uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_status text;
begin
  if not public.is_master() then
    raise exception 'Somente master pode excluir definitivamente.' using errcode = '42501';
  end if;
  select full_name, status into v_name, v_status from public.patients where id = p_patient;
  if not found then raise exception 'Paciente inexistente.'; end if;
  if v_status <> 'arquivado' then raise exception 'Arquive o paciente antes de excluir.'; end if;
  if trim(p_confirm_name) is distinct from v_name then raise exception 'Nome de confirmação não confere.'; end if;
  insert into public.deletion_log(patient_id, deleted_by) values (p_patient, auth.uid());
  delete from public.patients where id = p_patient;
end $$;

-- Execução: somente usuários autenticados
revoke execute on function public.publish_record(uuid,text,uuid,text,text) from public, anon;
revoke execute on function public.withdraw_publication(uuid) from public, anon;
revoke execute on function public.delete_patient_permanently(uuid,text) from public, anon;
grant execute on function public.publish_record(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.withdraw_publication(uuid) to authenticated;
grant execute on function public.delete_patient_permanently(uuid,text) to authenticated;

revoke execute on function public.app_role(), public.is_master(), public.is_staff(), public.is_school(),
  public.is_family(), public.can_publish(), public.has_link(uuid), public.school_photo_ok(uuid) from public, anon;
grant execute on function public.app_role(), public.is_master(), public.is_staff(), public.is_school(),
  public.is_family(), public.can_publish(), public.has_link(uuid), public.school_photo_ok(uuid) to authenticated, service_role;
