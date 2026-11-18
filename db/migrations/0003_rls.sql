-- =====================================================================
-- 0003: Row Level Security + visões mínimas para escola/família
-- Princípio: negar por padrão. anon não acessa nada.
-- =====================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

do $$
declare t text;
begin
  foreach t in array array['profiles','invitations','patients','access_links','anamneses','growth_measurements',
    'growth_reference_lms','food_diary_entries','school_meal_records','questionnaire_responses','food_repertoire',
    'sessions','documents','therapeutic_plans','plan_goals','guidances','publications','audit_log',
    'app_settings','deletion_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Tabelas escritas somente por funções do servidor/RPC
revoke insert, update, delete on public.publications, public.audit_log, public.deletion_log from authenticated;

-- ---------- profiles --------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_master()
  or (public.is_staff() and role in ('master_alana','master_cores','supervisionado'))
);
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_master() or (id = auth.uid() and active))
  with check (public.is_master() or id = auth.uid());
-- sem INSERT/DELETE para usuários: perfis nascem do convite (gatilho) e somem com a conta

-- ---------- invitations (somente master; nunca cria master) -----------
create policy invitations_select on public.invitations for select to authenticated using (public.is_master());
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.is_master() and role in ('supervisionado','escola','familia') and status = 'pendente');
create policy invitations_update on public.invitations for update to authenticated
  using (public.is_master()) with check (public.is_master() and role in ('supervisionado','escola','familia'));

-- ---------- patients --------------------------------------------------
create policy patients_select on public.patients for select to authenticated using (public.is_staff());
create policy patients_insert on public.patients for insert to authenticated with check (public.is_master());
create policy patients_update on public.patients for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
-- sem DELETE: exclusão definitiva só pela RPC delete_patient_permanently

-- ---------- vínculos --------------------------------------------------
create policy links_select on public.access_links for select to authenticated
  using (user_id = auth.uid() or public.is_master());
create policy links_insert on public.access_links for insert to authenticated with check (
  public.is_master() and exists (select 1 from public.profiles p where p.id = user_id and p.role in ('escola','familia'))
);
create policy links_update on public.access_links for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- ---------- registros clínicos: somente equipe -------------------------
do $$
declare t text;
begin
  foreach t in array array['anamneses','growth_measurements','food_diary_entries','questionnaire_responses',
    'food_repertoire','sessions','documents','therapeutic_plans','plan_goals','guidances']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t||'_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())', t||'_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t||'_update', t);
  end loop;
end $$;

-- ---------- área escolar ----------------------------------------------
create policy school_rec_select on public.school_meal_records for select to authenticated
  using (public.is_staff() or (public.is_school() and public.has_link(patient_id)));
create policy school_rec_insert on public.school_meal_records for insert to authenticated
  with check (public.is_staff() or (public.is_school() and public.has_link(patient_id)));
create policy school_rec_update on public.school_meal_records for update to authenticated
  using (public.is_staff()
         or (public.is_school() and public.has_link(patient_id) and created_by = auth.uid() and reviewed_at is null))
  with check (public.is_staff()
         or (public.is_school() and public.has_link(patient_id) and created_by = auth.uid()));

-- ---------- referência de crescimento ---------------------------------
create policy lms_select on public.growth_reference_lms for select to authenticated using (public.is_staff());
create policy lms_insert on public.growth_reference_lms for insert to authenticated with check (public.is_master());
create policy lms_update on public.growth_reference_lms for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- ---------- publicações -----------------------------------------------
create policy publications_select on public.publications for select to authenticated using (
  public.is_staff()
  or (status = 'ativo' and public.has_link(patient_id)
      and ((audience = 'familia' and public.is_family()) or (audience = 'escola' and public.is_school())))
);

-- ---------- auditoria, configurações, exclusões ------------------------
create policy audit_select on public.audit_log for select to authenticated using (public.is_master());
create policy deletion_select on public.deletion_log for select to authenticated using (public.is_master());
create policy settings_select on public.app_settings for select to authenticated using (public.is_staff());
create policy settings_insert on public.app_settings for insert to authenticated with check (public.is_master());
create policy settings_update on public.app_settings for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- ---------- Visão mínima para escola e família -------------------------
-- Colunas estritamente de identificação. Sem diagnóstico, anamnese, notas.
create view public.linked_patients with (security_barrier = true) as
  select p.id, p.full_name, p.preferred_name, p.birth_date, p.class_name, p.school_photo_authorized
    from public.patients p
   where public.has_link(p.id) and (public.is_school() or public.is_family());
revoke all on public.linked_patients from public, anon;
grant select on public.linked_patients to authenticated;
