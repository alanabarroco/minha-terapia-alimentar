-- =====================================================================
-- Testes de autorização contra o banco (RLS, RPCs, storage). Cada bloco
-- assume a identidade de um usuário e consulta DIRETAMENTE o banco.
-- Convenção: t.count devolve -1 em caso de erro (sem privilégio) => "sem acesso".
-- =====================================================================

-- Objetos de arquivo fictícios (como se tivessem sido enviados)
insert into storage.objects(bucket_id, name) values
  ('clinical-files','a1000000-0000-4000-8000-000000000001/reports/rel1.pdf'),
  ('clinical-files','a1000000-0000-4000-8000-000000000001/reports/priv.pdf'),
  ('clinical-files','a1000000-0000-4000-8000-000000000001/diary/foto-antes-1.jpg'),
  ('clinical-files','a1000000-0000-4000-8000-000000000001/school/s1.jpg'),
  ('clinical-files','a1000000-0000-4000-8000-000000000002/reports/rel2.pdf'),
  ('clinical-files','a1000000-0000-4000-8000-000000000002/school/s2.jpg');

-- ---------- 1. Masters acessam todos os pacientes ------------------------
do $$ declare a bigint; c bigint; sa bigint; begin
  perform t.login('master.alana@demo.invalid'); a := t.count('select 1 from public.patients'); sa := t.count('select 1 from public.school_meal_records'); perform t.logout();
  perform t.login('master.cores@demo.invalid'); c := t.count('select 1 from public.patients'); perform t.logout();
  perform t.record('01 Master Alana e Master CoReS veem todos os 5 pacientes', a = 5 and c = 5, a||'/'||c);
  perform t.record('01b Master consulta registros escolares de todas as escolas', sa = 2, sa::text);
end $$;

do $$ declare r1 text; r2 text; r3 text; n bigint; begin
  perform t.login('master.cores@demo.invalid');
  r1 := t.try($q$insert into public.patients(id, full_name, birth_date, is_demo) values ('a1000000-0000-4000-8000-0000000000f1','Excluível Demo', '2020-01-01', true)$q$);
  r2 := t.try($q$update public.patients set preferred_name = 'Apelido' where id = 'a1000000-0000-4000-8000-0000000000f1'$q$);
  n := t.count('select 1 from public.audit_log');
  perform t.logout();
  perform t.record('01c Master cria e edita paciente', r1 = 'ok:1' and r2 = 'ok:1', r1||' '||r2);
  perform t.record('01d Master consulta histórico de alterações', n > 0, n::text);
end $$;

-- ---------- 2. Supervisionado: todos os pacientes, registra evolução -----
do $$ declare n bigint; r1 text; r2 text; r3 text; r4 text; cb uuid; sup uuid; alana uuid; aud bigint; begin
  select id into sup from public.profiles where email = 'supervisionada@demo.invalid';
  select id into alana from public.profiles where email = 'master.alana@demo.invalid';
  perform t.login('supervisionada@demo.invalid');
  n := t.count('select 1 from public.patients');
  -- tenta forjar a autoria (created_by = Alana)
  r1 := t.try(format($q$insert into public.sessions(id, patient_id, session_date, status, objectives, created_by)
        values ('b1000000-0000-4000-8000-0000000000aa','a1000000-0000-4000-8000-000000000003', current_date, 'rascunho','teste', %L)$q$, alana));
  r2 := t.try($q$insert into public.patients(full_name, birth_date) values ('Novo Paciente', '2020-01-01')$q$);
  r3 := t.try($q$delete from public.patients where id = 'a1000000-0000-4000-8000-000000000003'$q$);
  r4 := t.try($q$update public.patients set status = 'arquivado' where id = 'a1000000-0000-4000-8000-000000000003'$q$);
  aud := t.count('select 1 from public.audit_log');
  perform t.logout();
  select created_by into cb from public.sessions where id = 'b1000000-0000-4000-8000-0000000000aa';
  perform t.record('02 Supervisionado acessa todos os pacientes (5 da demo + 1 criado no teste 01c)', n = 6, n::text);
  perform t.record('02b Supervisionado registra sessão', r1 = 'ok:1', r1);
  perform t.record('02c Autoria é a do usuário logado (created_by não pode ser forjado)', cb = sup, coalesce(cb::text,'null'));
  perform t.record('02d Supervisionado NÃO cria paciente', r2 like 'err:%', r2);
  perform t.record('02e Supervisionado NÃO exclui paciente', r3 = 'ok:0' or r3 like 'err:%', r3);
  perform t.record('02f Supervisionado NÃO arquiva paciente', r4 like 'err:%', r4);
  perform t.record('02g Supervisionado NÃO lê histórico de alterações', aud <= 0, aud::text);
end $$;

-- ---------- 3. Escalada de privilégios -----------------------------------
do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; famA uuid; begin
  select id into famA from public.profiles where email = 'familia.a@demo.invalid';
  perform t.login('supervisionada@demo.invalid');
  r1 := t.try($q$update public.profiles set role = 'master_alana' where id = auth.uid()$q$);
  r2 := t.try($q$update public.profiles set can_publish = true where id = auth.uid()$q$);
  r3 := t.try($q$update public.profiles set role = 'master_cores' where email = 'familia.a@demo.invalid'$q$);
  r4 := t.try($q$insert into public.profiles(id, email, role) values (gen_random_uuid(), 'x@x.invalid', 'master_alana')$q$);
  r5 := t.try($q$insert into public.invitations(email, role) values ('novo@x.invalid', 'master_alana')$q$);
  r6 := t.try($q$update public.profiles set active = true, full_name = 'Nome Atualizado' where id = auth.uid()$q$);
  r7 := t.try(format($q$insert into public.access_links(user_id, patient_id) values (%L, 'a1000000-0000-4000-8000-000000000003')$q$, famA));
  perform t.logout();
  perform t.record('03 Supervisionado NÃO promove a si mesmo a master', r1 like 'err:%', r1);
  perform t.record('03b Supervisionado NÃO concede a si permissão de liberar', r2 like 'err:%', r2);
  perform t.record('03c Supervisionado NÃO altera papel de outro usuário', r3 = 'ok:0' or r3 like 'err:%', r3);
  perform t.record('03d Perfil não pode ser inserido diretamente', r4 like 'err:%', r4);
  perform t.record('03e Supervisionado NÃO cria convite de master', r5 like 'err:%', r5);
  perform t.record('03f Supervisionado edita apenas dados cadastrais do próprio perfil', r6 = 'ok:1', r6);
  perform t.record('03g Supervisionado NÃO cria vínculos de acesso', r7 like 'err:%', r7);
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; begin
  perform t.login('master.alana@demo.invalid');
  r1 := t.try($q$insert into public.invitations(email, role) values ('master3@x.invalid', 'master_alana')$q$);
  r2 := t.try($q$update public.profiles set role = 'master_alana' where email = 'supervisionada@demo.invalid'$q$);
  r3 := t.try($q$update public.profiles set active = false where email = 'master.cores@demo.invalid'$q$);
  r4 := t.try($q$update public.profiles set active = false where email = 'master.alana@demo.invalid'$q$);
  r5 := t.try($q$insert into public.invitations(email, role) values ('nova.familia@x.invalid', 'familia')$q$);
  perform t.logout();
  perform t.record('03h Nem master cria convite de master pelo aplicativo', r1 like 'err:%', r1);
  perform t.record('03i Nem master altera o papel de um usuário', r2 like 'err:%', r2);
  perform t.record('03j Contas master não podem ser desativadas pelo aplicativo', r3 like 'err:%' and r4 like 'err:%', r3||' '||r4);
  perform t.record('03k Master cria convite de supervisionado/escola/família', r5 = 'ok:1', r5);
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; begin
  r1 := t.try($q$insert into auth.users(email) values ('intruso@x.invalid')$q$);
  insert into public.invitations(email, role) values ('segunda.alana@x.invalid', 'master_alana');
  r2 := t.try($q$insert into auth.users(email, email_confirmed_at) values ('segunda.alana@x.invalid', now())$q$);
  perform t.anon();
  r3 := t.try($q$select public.publish_record('a1000000-0000-4000-8000-000000000001','sessions','b1000000-0000-4000-8000-000000000001','familia')$q$);
  r4 := t.count('select 1 from public.patients')::text;
  perform t.logout();
  perform t.record('03l Cadastro SEM convite é bloqueado no banco', r1 = 'err:P0001', r1);
  perform t.record('03m Não existe segundo acesso Master Alana', r2 like 'err:%', r2);
  perform t.record('03n Visitante anônimo não acessa nem libera nada', r3 like 'err:%' and r4::bigint <= 0, r3||' '||r4);
end $$;

-- ---------- 4-6. Escola ----------------------------------------------------
do $$ declare pt bigint; lp bigint; lid uuid; sr bigint; srB bigint; prof bigint; tabs text[]; tname text; tot bigint := 0; begin
  perform t.login('escola.a@demo.invalid');
  pt := t.count('select 1 from public.patients');
  lp := t.count('select 1 from public.linked_patients');
  select id into lid from public.linked_patients limit 1;
  sr := t.count('select 1 from public.school_meal_records');
  srB := t.count($q$select 1 from public.school_meal_records where patient_id = 'a1000000-0000-4000-8000-000000000002'$q$);
  prof := t.count('select 1 from public.profiles');
  foreach tname in array array['anamneses','growth_measurements','food_diary_entries','questionnaire_responses',
      'food_repertoire','sessions','documents','therapeutic_plans','plan_goals','guidances','audit_log','invitations'] loop
    tot := tot + greatest(t.count('select 1 from public.'||tname), 0);
  end loop;
  perform t.logout();
  perform t.record('04 Escola A não lê a tabela de pacientes (prontuário)', pt <= 0, pt::text);
  perform t.record('04b Escola A vê SOMENTE a criança vinculada', lp = 1 and lid = 'a1000000-0000-4000-8000-000000000001', lp::text);
  perform t.record('04c Escola A vê só registros escolares da criança vinculada', sr = 1 and srB = 0, sr||'/'||srB);
  perform t.record('04d Escola A vê só o próprio perfil', prof = 1, prof::text);
  perform t.record('06 Escola A não lê nenhuma tabela clínica/administrativa', tot = 0, tot::text);
end $$;

do $$ declare cols int; begin
  select count(*) into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'linked_patients'
     and column_name in ('diagnoses','allergies','restrictions','medications','clinical_notes','reason','guardians','supplements','professionals');
  perform t.record('06b Visão da escola/família não contém campos clínicos', cols = 0, cols::text);
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; r8 text; r9 text; mine uuid; begin
  perform t.login('escola.a@demo.invalid');
  r1 := t.try($q$insert into public.school_meal_records(patient_id, record_date, meal, foods_offered, foods_consumed, created_by)
        values ('a1000000-0000-4000-8000-000000000001', current_date, 'lanche', 'Fruta', 'Metade', 'a1000000-0000-4000-8000-000000000999')$q$);
  r2 := t.try($q$insert into public.school_meal_records(patient_id, record_date, meal) values ('a1000000-0000-4000-8000-000000000002', current_date, 'lanche')$q$);
  r3 := t.try($q$insert into public.food_diary_entries(patient_id, entry_date, meal) values ('a1000000-0000-4000-8000-000000000001', current_date, 'lanche')$q$);
  r4 := t.try($q$insert into public.sessions(patient_id, session_date) values ('a1000000-0000-4000-8000-000000000001', current_date)$q$);
  r5 := t.try($q$update public.patients set diagnoses = 'x' where id = 'a1000000-0000-4000-8000-000000000001'$q$);
  r6 := t.try($q$update public.school_meal_records set reviewed_at = now() where patient_id = 'a1000000-0000-4000-8000-000000000001'$q$);
  r7 := t.try($q$update public.school_meal_records set patient_id = 'a1000000-0000-4000-8000-000000000002' where patient_id = 'a1000000-0000-4000-8000-000000000001' and meal = 'lanche'$q$);
  r8 := t.try($q$insert into public.school_meal_records(patient_id, record_date, meal, photo_path) values ('a1000000-0000-4000-8000-000000000001', current_date, 'lanche', 'a1000000-0000-4000-8000-000000000001/school/novo.jpg')$q$);
  r9 := t.try($q$insert into public.access_links(user_id, patient_id) select auth.uid(), 'a1000000-0000-4000-8000-000000000002'$q$);
  perform t.logout();
  perform t.record('05 Escola preenche registro escolar da criança vinculada', r1 = 'ok:1', r1);
  perform t.record('05b Escola NÃO registra para criança de outra escola', r2 like 'err:%', r2);
  perform t.record('05c Escola NÃO escreve no diário clínico', r3 like 'err:%', r3);
  perform t.record('05d Escola NÃO cria sessão', r4 like 'err:%', r4);
  perform t.record('05e Escola NÃO altera paciente', r5 = 'ok:0' or r5 like 'err:%', r5);
  perform t.record('05f Escola NÃO marca registro como revisado', r6 like 'err:%', r6);
  perform t.record('05g Escola NÃO move registro para outra criança', r7 like 'err:%' or r7 = 'ok:0', r7);
  perform t.record('05h Escola anexa foto quando a criança tem autorização', r8 = 'ok:1', r8);
  perform t.record('05i Escola NÃO cria vínculos para si', r9 like 'err:%', r9);
end $$;

do $$ declare cb uuid; esc uuid; r1 text; r2 text; begin
  select id into esc from public.profiles where email = 'escola.a@demo.invalid';
  select created_by into cb from public.school_meal_records where meal = 'lanche' and patient_id = 'a1000000-0000-4000-8000-000000000001' and foods_consumed = 'Metade';
  perform t.record('05j Autoria do registro escolar é da escola logada', cb = esc, coalesce(cb::text,'null'));

  perform t.login('escola.b@demo.invalid');
  r1 := t.try($q$insert into public.school_meal_records(patient_id, record_date, meal, photo_path) values ('a1000000-0000-4000-8000-000000000002', current_date, 'lanche', 'a1000000-0000-4000-8000-000000000002/school/x.jpg')$q$);
  r2 := t.count($q$select 1 from public.school_meal_records where patient_id = 'a1000000-0000-4000-8000-000000000001'$q$)::text;
  perform t.logout();
  perform t.record('05k Escola B NÃO anexa foto sem autorização do paciente', r1 like 'err:%', r1);
  perform t.record('05l Escola B NÃO vê registros da escola A', r2::bigint = 0, r2);
end $$;

-- ---------- 7-10. Família ----------------------------------------------------
do $$ declare lp bigint; ids uuid[]; pubs bigint; pubsOther bigint; pubKinds text; lpOther bigint; tot bigint := 0; tname text; leak bigint; begin
  perform t.login('familia.a@demo.invalid');
  lp := t.count('select 1 from public.linked_patients');
  select array_agg(id order by id) into ids from public.linked_patients;
  pubs := t.count('select 1 from public.publications');
  select string_agg(kind, ',' order by kind) into pubKinds from public.publications;
  pubsOther := t.count($q$select 1 from public.publications where patient_id = 'a1000000-0000-4000-8000-000000000002'$q$);
  lpOther := t.count($q$select 1 from public.linked_patients where id = 'a1000000-0000-4000-8000-000000000002'$q$);
  foreach tname in array array['patients','anamneses','growth_measurements','food_diary_entries','school_meal_records','questionnaire_responses',
      'food_repertoire','sessions','documents','therapeutic_plans','plan_goals','guidances','audit_log','invitations'] loop
    tot := tot + greatest(t.count('select 1 from public.'||tname), 0);
  end loop;
  perform t.logout();
  select count(*) into leak from public.publications where content::text like '%SEGREDO-INTERNO%';
  perform t.record('07 Família A vê somente as duas crianças vinculadas', lp = 2 and ids = array['a1000000-0000-4000-8000-000000000001'::uuid,'a1000000-0000-4000-8000-000000000004'::uuid], lp::text);
  perform t.record('08 Família A vê somente liberações ATIVAS (4)', pubs = 4 and pubKinds = 'crescimento,documento,evolucao,planejamento', pubs||' '||coalesce(pubKinds,''));
  perform t.record('08b Família não lê nenhuma tabela clínica (prontuário, notas, rascunhos)', tot = 0, tot::text);
  perform t.record('10 Trocar o id para outro paciente não revela nada (API/consulta direta)', pubsOther = 0 and lpOther = 0, pubsOther||'/'||lpOther);
  perform t.record('08c Conteúdo liberado nunca contém notas internas', leak = 0, leak::text);
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; begin
  perform t.login('familia.a@demo.invalid');
  r1 := t.try($q$update public.sessions set outcomes = 'alterado pela família' where true$q$);
  r2 := t.try($q$insert into public.food_diary_entries(patient_id, entry_date) values ('a1000000-0000-4000-8000-000000000001', current_date)$q$);
  r3 := t.try($q$update public.publications set status = 'ativo', content = '{}' where true$q$);
  r4 := t.try($q$update public.patients set full_name = 'x' where true$q$);
  r5 := t.try($q$select public.publish_record('a1000000-0000-4000-8000-000000000001','sessions','b1000000-0000-4000-8000-000000000001','familia')$q$);
  r6 := t.try($q$delete from public.publications where true$q$);
  r7 := t.try($q$update public.profiles set role = 'master_alana' where id = auth.uid()$q$);
  perform t.logout();
  perform t.record('09 Família NÃO edita sessões/evoluções', r1 = 'ok:0' or r1 like 'err:%', r1);
  perform t.record('09b Família NÃO cria registros de diário', r2 like 'err:%', r2);
  perform t.record('09c Família NÃO altera publicações', r3 like 'err:%', r3);
  perform t.record('09d Família NÃO altera pacientes', r4 = 'ok:0' or r4 like 'err:%', r4);
  perform t.record('09e Família NÃO libera conteúdo', r5 like 'err:%', r5);
  perform t.record('09f Família NÃO apaga publicações', r6 like 'err:%', r6);
  perform t.record('09g Família NÃO se promove a master', r7 like 'err:%', r7);
end $$;

do $$ declare lp bigint; pubs bigint; arch bigint; begin
  perform t.login('familia.b@demo.invalid');
  lp := t.count('select 1 from public.linked_patients');
  pubs := t.count('select 1 from public.publications');
  arch := t.count($q$select 1 from public.linked_patients where id = 'a1000000-0000-4000-8000-000000000005'$q$);
  perform t.logout();
  perform t.record('07b Família B vê só Marina (paciente arquivado vinculado fica oculto)', lp = 1 and arch = 0, lp||'/'||arch);
  perform t.record('08d Família B vê só a própria liberação (1 PDF da Marina)', pubs = 1, pubs::text);
end $$;

do $$ declare pubs bigint; kinds text; begin
  perform t.login('escola.a@demo.invalid');
  pubs := t.count('select 1 from public.publications');
  select string_agg(distinct audience, ',') into kinds from public.publications;
  perform t.logout();
  perform t.record('06c Escola vê só orientações destinadas à escola (2, audiência escola)', pubs = 2 and kinds = 'escola', pubs||' '||coalesce(kinds,''));
end $$;

-- ---------- 11. Arquivos privados ------------------------------------------
do $$ declare a1 bigint; a2 bigint; a3 bigint; a4 bigint; a5 bigint; b1 bigint; e1 bigint; e2 bigint; e3 bigint; e4 bigint; e5 bigint; st bigint; an bigint; begin
  perform t.login('familia.a@demo.invalid');
  a1 := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf'$q$);
  a2 := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000001/reports/priv.pdf'$q$);
  a3 := t.count($q$select 1 from storage.objects where name like '%/diary/%'$q$);
  a4 := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000002/reports/rel2.pdf'$q$);
  a5 := t.count($q$select 1 from storage.objects where name like '%/school/%'$q$);
  perform t.logout();
  perform t.login('familia.b@demo.invalid');
  b1 := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf'$q$);
  perform t.logout();
  perform t.login('escola.a@demo.invalid');
  e1 := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000001/school/s1.jpg'$q$);
  e2 := t.count($q$select 1 from storage.objects where name like '%/diary/%'$q$);
  e3 := t.count($q$select 1 from storage.objects where name like '%/reports/%'$q$);
  e4 := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000002/school/s2.jpg'$q$);
  perform t.logout();
  perform t.login('supervisionada@demo.invalid');
  st := t.count($q$select 1 from storage.objects where bucket_id = 'clinical-files'$q$);
  perform t.logout();
  perform t.anon(); an := t.count('select 1 from storage.objects'); perform t.logout();
  perform t.record('11 Família A baixa só o PDF liberado da própria criança', a1 = 1 and a2 = 0 and a4 = 0, a1||'/'||a2||'/'||a4);
  perform t.record('11b Família NÃO acessa fotos do diário nem fotos escolares', a3 = 0 and a5 = 0, a3||'/'||a5);
  perform t.record('11c Família B NÃO acessa o PDF da família A', b1 = 0, b1::text);
  perform t.record('11d Escola A vê só foto escolar da criança vinculada', e1 = 1 and e4 = 0 and e2 = 0 and e3 = 0, e1||'/'||e4||'/'||e2||'/'||e3);
  perform t.record('11e Equipe acessa todos os arquivos', st = 6, st::text);
  perform t.record('11f Anônimo não acessa arquivos', an <= 0, an::text);
end $$;

do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; r8 text; begin
  perform t.login('escola.a@demo.invalid');
  r1 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000001/school/novo2.jpg')$q$);
  r2 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000001/diary/x.jpg')$q$);
  r3 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000002/school/x.jpg')$q$);
  perform t.logout();
  perform t.login('escola.b@demo.invalid');
  r4 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000002/school/y.jpg')$q$);
  perform t.logout();
  perform t.login('familia.a@demo.invalid');
  r5 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000001/diary/z.jpg')$q$);
  perform t.logout();
  perform t.login('supervisionada@demo.invalid');
  r6 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000003/diary/ok.jpg')$q$);
  r7 := t.try($q$insert into storage.objects(bucket_id, name) values ('clinical-files','a1000000-0000-4000-8000-000000000003/outra/x.jpg')$q$);
  r8 := t.try($q$delete from storage.objects where bucket_id = 'clinical-files'$q$);
  perform t.logout();
  perform t.record('11g Escola envia foto só na área escolar de criança vinculada e autorizada', r1 = 'ok:1' and r2 like 'err:%' and r3 like 'err:%', r1||' '||r2||' '||r3);
  perform t.record('11h Escola B NÃO envia foto (criança sem autorização)', r4 like 'err:%', r4);
  perform t.record('11i Família NÃO envia arquivos', r5 like 'err:%', r5);
  perform t.record('11j Equipe envia só para áreas válidas', r6 = 'ok:1' and r7 like 'err:%', r6||' '||r7);
  perform t.record('11k Equipe NÃO apaga arquivos (sem política de exclusão)', r8 = 'ok:0' or r8 like 'err:%', r8);
end $$;

-- ---------- 12. Retirar liberação -----------------------------------------
do $$ declare pid uuid; before_ bigint; after_ bigint; file_after bigint; vr int; actives bigint; olds bigint; r text; begin
  select id into pid from public.publications where file_path = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf' and status = 'ativo';
  perform t.login('familia.a@demo.invalid');
  before_ := t.count('select 1 from public.publications');
  perform t.logout();
  perform t.login('master.alana@demo.invalid');
  r := t.try(format('select public.withdraw_publication(%L)', pid));
  perform t.logout();
  perform t.login('familia.a@demo.invalid');
  after_ := t.count('select 1 from public.publications');
  file_after := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf'$q$);
  perform t.logout();
  perform t.record('12 Retirar a liberação impede novo acesso à publicação e ao arquivo', before_ = 4 and after_ = 3 and file_after = 0, before_||'->'||after_||' arquivo='||file_after);

  -- republicar cria versão nova; a antiga permanece retirada
  perform t.login('master.alana@demo.invalid');
  perform public.publish_record('a1000000-0000-4000-8000-000000000001','documents','e1000000-0000-4000-8000-000000000001','familia');
  perform t.logout();
  select max(version) into vr from public.publications where file_path = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf';
  select count(*) filter (where status = 'ativo'), count(*) filter (where status = 'retirado') into actives, olds
    from public.publications where file_path = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf';
  perform t.login('familia.a@demo.invalid');
  file_after := t.count($q$select 1 from storage.objects where name = 'a1000000-0000-4000-8000-000000000001/reports/rel1.pdf'$q$);
  perform t.logout();
  perform t.record('12b Nova liberação cria versão 2, mantém a anterior retirada e devolve o acesso', vr = 2 and actives = 1 and olds = 1 and file_after = 1, vr||' '||actives||' '||olds||' '||file_after);
end $$;

do $$ declare r1 text; r2 text; begin
  r1 := t.try($q$update public.publications set content = '{"adulterado":true}' where status = 'ativo'$q$);
  r2 := t.try($q$update public.publications set status = 'ativo' where status = 'retirado'$q$);
  perform t.record('12c Conteúdo publicado é imutável (nem o superusuário altera via gatilho)', r1 like 'err:%', r1);
  perform t.record('12d Liberação retirada não pode ser reativada', r2 like 'err:%', r2);
end $$;

-- ---------- 13. Versão publicada x rascunho; liberar por permissão ---------
do $$ declare c1 text; c2 text; c3 text; r1 text; r2 text; r3 text; begin
  perform t.login('supervisionada@demo.invalid');
  r1 := t.try($q$update public.sessions set outcomes = 'resultado ALTERADO', internal_notes = 'SEGREDO-INTERNO atualizado depois' where id = 'b1000000-0000-4000-8000-000000000001'$q$);
  perform t.logout();
  perform t.login('familia.a@demo.invalid');
  select content::text into c1 from public.publications where kind = 'evolucao';
  perform t.logout();
  perform t.record('13 Edição posterior do rascunho/nota interna NÃO aparece para a família',
     r1 = 'ok:1' and c1 like '%resultado inicial%' and c1 not like '%ALTERADO%' and c1 not like '%SEGREDO%', left(c1, 80));
  perform t.login('master.cores@demo.invalid');
  perform public.publish_record('a1000000-0000-4000-8000-000000000001','sessions','b1000000-0000-4000-8000-000000000001','familia');
  perform t.logout();
  perform t.login('familia.a@demo.invalid');
  select content::text into c2 from public.publications where kind = 'evolucao';
  perform t.logout();
  perform t.record('13b Após nova liberação a versão atualizada aparece, sem notas internas', c2 like '%ALTERADO%' and c2 not like '%SEGREDO%', left(c2, 80));

  perform t.login('supervisionada@demo.invalid');
  r2 := t.try($q$select public.publish_record('a1000000-0000-4000-8000-000000000001','guidances','d1000000-0000-4000-8000-000000000001','escola')$q$);
  perform t.logout();
  perform t.login('master.alana@demo.invalid');
  r3 := t.try($q$update public.profiles set can_publish = true where email = 'supervisionada@demo.invalid'$q$);
  perform t.logout();
  perform t.login('supervisionada@demo.invalid');
  c3 := t.try($q$select public.publish_record('a1000000-0000-4000-8000-000000000001','guidances','d1000000-0000-4000-8000-000000000001','escola')$q$);
  perform t.logout();
  perform t.login('master.alana@demo.invalid');
  perform t.try($q$update public.profiles set can_publish = false where email = 'supervisionada@demo.invalid'$q$);
  perform t.logout();
  perform t.record('13c Supervisionado só libera com autorização explícita de master', r2 like 'err:%' and r3 = 'ok:1' and c3 = 'ok:1', r2||' '||r3||' '||c3);
end $$;

-- ---------- Desativação de usuário e arquivamento --------------------------
do $$ declare r text; f1 bigint; f2 bigint; f3 bigint; s1 bigint; sp bigint; f4 bigint; begin
  perform t.login('master.alana@demo.invalid');
  r := t.try($q$update public.profiles set active = false where email in ('familia.a@demo.invalid','escola.a@demo.invalid','supervisionada@demo.invalid')$q$);
  perform t.logout();
  perform t.login('familia.a@demo.invalid');
  f1 := t.count('select 1 from public.publications'); f2 := t.count('select 1 from public.linked_patients');
  f3 := t.count($q$select 1 from storage.objects where name like '%rel1.pdf'$q$);
  perform t.logout();
  perform t.login('escola.a@demo.invalid'); s1 := t.count('select 1 from public.school_meal_records'); perform t.logout();
  perform t.login('supervisionada@demo.invalid'); sp := t.count('select 1 from public.patients'); f4 := t.count('select 1 from public.sessions'); perform t.logout();
  perform t.record('14 Desativar usuário bloqueia imediatamente todo acesso protegido',
     r = 'ok:3' and f1 = 0 and f2 = 0 and f3 = 0 and s1 = 0 and sp = 0 and f4 = 0, r||' '||f1||f2||f3||s1||sp||f4);
  perform t.login('master.alana@demo.invalid');
  perform t.try($q$update public.profiles set active = true where email in ('familia.a@demo.invalid','escola.a@demo.invalid','supervisionada@demo.invalid')$q$);
  perform t.logout();
end $$;

do $$ declare r text; f1 bigint; e1 bigint; f3 bigint; back bigint; begin
  perform t.login('master.alana@demo.invalid');
  r := t.try($q$update public.patients set status = 'arquivado' where id = 'a1000000-0000-4000-8000-000000000001'$q$);
  perform t.logout();
  perform t.login('familia.a@demo.invalid');
  f1 := t.count($q$select 1 from public.publications where patient_id = 'a1000000-0000-4000-8000-000000000001'$q$);
  f3 := t.count($q$select 1 from storage.objects where name like '%rel1.pdf'$q$);
  perform t.logout();
  perform t.login('escola.a@demo.invalid'); e1 := t.count('select 1 from public.linked_patients'); perform t.logout();
  perform t.record('14b Arquivar paciente corta acesso de família e escola', r = 'ok:1' and f1 = 0 and e1 = 0 and f3 = 0, r||' '||f1||e1||f3);
  perform t.login('master.alana@demo.invalid');
  perform t.try($q$update public.patients set status = 'ativo' where id = 'a1000000-0000-4000-8000-000000000001'$q$);
  perform t.logout();
  perform t.login('familia.a@demo.invalid'); back := t.count('select 1 from public.publications'); perform t.logout();
  perform t.record('14c Reativar paciente restaura o acesso às liberações ativas', back = 4, back::text);
end $$;

do $$ declare r text; f bigint; back bigint; begin
  perform t.login('master.alana@demo.invalid');
  r := t.try($q$update public.access_links set active = false where patient_id = 'a1000000-0000-4000-8000-000000000001' and user_id = (select id from public.profiles where email = 'familia.a@demo.invalid')$q$);
  perform t.logout();
  perform t.login('familia.a@demo.invalid'); f := t.count($q$select 1 from public.linked_patients where id = 'a1000000-0000-4000-8000-000000000001'$q$); perform t.logout();
  perform t.login('master.alana@demo.invalid');
  perform t.try($q$update public.access_links set active = true where patient_id = 'a1000000-0000-4000-8000-000000000001'$q$);
  perform t.logout();
  perform t.record('14d Desativar vínculo remove o acesso àquela criança', r = 'ok:1' and f = 0, r||' '||f);
end $$;

-- ---------- Exclusão controlada ---------------------------------------------
do $$ declare r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; gone bigint; lg bigint; begin
  perform t.login('supervisionada@demo.invalid');
  r1 := t.try($q$select public.delete_patient_permanently('a1000000-0000-4000-8000-0000000000f1','Excluível Demo')$q$);
  perform t.logout();
  perform t.login('master.alana@demo.invalid');
  r2 := t.try($q$delete from public.patients where id = 'a1000000-0000-4000-8000-0000000000f1'$q$);
  r3 := t.try($q$select public.delete_patient_permanently('a1000000-0000-4000-8000-0000000000f1','Excluível Demo')$q$);   -- ainda ativo
  r4 := t.try($q$update public.patients set status = 'arquivado' where id = 'a1000000-0000-4000-8000-0000000000f1'$q$);
  r5 := t.try($q$select public.delete_patient_permanently('a1000000-0000-4000-8000-0000000000f1','Nome Errado')$q$);
  r6 := t.try($q$select public.delete_patient_permanently('a1000000-0000-4000-8000-0000000000f1','Excluível Demo')$q$);
  perform t.logout();
  select count(*) into gone from public.patients where id = 'a1000000-0000-4000-8000-0000000000f1';
  select count(*) into lg from public.deletion_log where patient_id = 'a1000000-0000-4000-8000-0000000000f1';
  perform t.record('15 Exclusão definitiva: bloqueada p/ supervisionado, exige arquivar + confirmar nome, registrada',
     r1 like 'err:%' and r2 = 'ok:0' and r3 like 'err:%' and r4 = 'ok:1' and r5 like 'err:%' and r6 = 'ok:1' and gone = 0 and lg = 1,
     r1||' '||r2||' '||r3||' '||r4||' '||r5||' '||r6);
end $$;

-- ---------- Auditoria e validações -------------------------------------------
do $$ declare ch text[]; od jsonb; nd jsonb; actor_ok boolean; prof_od jsonb; begin
  select changed_fields, old_data, new_data, actor = (select id from public.profiles where email = 'supervisionada@demo.invalid')
    into ch, od, nd, actor_ok
    from public.audit_log where table_name = 'sessions' and action = 'UPDATE' and record_id = 'b1000000-0000-4000-8000-000000000001'
    order by id desc limit 1;
  select old_data into prof_od from public.audit_log where table_name = 'profiles' and action = 'UPDATE' order by id desc limit 1;
  perform t.record('16 Auditoria clínica guarda autor e NOMES de campos, sem conteúdo clínico',
     ch @> array['outcomes','internal_notes'] and od is null and nd is null and actor_ok, coalesce(ch::text,'null'));
  perform t.record('16b Auditoria de permissões guarda valores anterior/novo', prof_od is not null, left(coalesce(prof_od::text,'null'), 60));
end $$;

do $$ declare q1 text; q2 text; q3 text; g1 text; g2 text; g3 text; g4 text; d1 text; v_bmi numeric; begin
  perform t.login('supervisionada@demo.invalid');
  q1 := t.try($q$insert into public.questionnaire_responses(patient_id, age_band, version, answers) values ('a1000000-0000-4000-8000-000000000003','13_17','13_17-v1','{"13_17.A.1":7}')$q$);
  q2 := t.try($q$insert into public.questionnaire_responses(patient_id, age_band, version, answers) values ('a1000000-0000-4000-8000-000000000003','13_17','13_17-v1','{"13_17.A.1":4,"13_17.A.2":null}')$q$);
  q3 := t.try($q$insert into public.questionnaire_responses(patient_id, age_band, version, answers) values ('a1000000-0000-4000-8000-000000000003','6_12','x','{}')$q$);
  g1 := t.try($q$insert into public.growth_measurements(patient_id, measured_on, weight_kg, height_cm, measure_type) values ('a1000000-0000-4000-8000-000000000003', current_date, 12, 90, 'altura')$q$);
  g2 := t.try($q$insert into public.growth_measurements(patient_id, measured_on) values ('a1000000-0000-4000-8000-000000000003', current_date)$q$);
  g3 := t.try($q$insert into public.growth_measurements(patient_id, measured_on, weight_kg) values ('a1000000-0000-4000-8000-000000000003', current_date, 0)$q$);
  g4 := t.try($q$insert into public.growth_measurements(patient_id, measured_on, weight_kg) values ('a1000000-0000-4000-8000-000000000003', current_date + 5, 10)$q$);
  d1 := t.try($q$insert into public.food_diary_entries(patient_id, entry_date, qty_offered, qty_consumed) values ('a1000000-0000-4000-8000-000000000003', current_date, 100, 50)$q$);
  perform t.logout();
  select gm.bmi into v_bmi from public.growth_measurements gm where patient_id = 'a1000000-0000-4000-8000-000000000003' and weight_kg = 12;
  perform t.record('17 Respostas do questionário: só 0–4 ou nulo (não se aplica)', q1 like 'err:%' and q2 = 'ok:1', q1||' '||q2);
  perform t.record('17b Faixa etária inválida é rejeitada', q3 like 'err:%', q3);
  perform t.record('17c IMC calculado no banco (12 kg, 90 cm = 14,81)', g1 = 'ok:1' and v_bmi = 14.81, coalesce(v_bmi::text,'null'));
  perform t.record('17d Medidas inválidas rejeitadas (vazia, peso zero, data futura)', g2 like 'err:%' and g3 like 'err:%' and g4 like 'err:%', g2||' '||g3||' '||g4);
  perform t.record('17e Quantidade consumida exige unidade (oferecido x consumido)', d1 like 'err:%', d1);
end $$;

-- ---------- Convite → ativação -------------------------------------------------
do $$ declare r1 text; r2 text; role_ text; links int; st1 text; st2 text; seen bigint; begin
  perform t.login('master.alana@demo.invalid');
  r1 := t.try($q$insert into public.invitations(email, role, patient_ids, status) values ('familia.c@demo.invalid','familia', array['a1000000-0000-4000-8000-000000000003'::uuid], 'pendente')$q$);
  r2 := t.try($q$insert into public.invitations(email, role) values ('FAMILIA.C@demo.invalid','familia')$q$);   -- convite pendente duplicado
  perform t.logout();
  insert into auth.users(email) values ('familia.c@demo.invalid');
  select role into role_ from public.profiles where email = 'familia.c@demo.invalid';
  select count(*) into links from public.access_links l join public.profiles p on p.id = l.user_id
    where p.email = 'familia.c@demo.invalid' and l.patient_id = 'a1000000-0000-4000-8000-000000000003';
  select status into st1 from public.invitations where lower(email) = 'familia.c@demo.invalid' and role = 'familia';
  update auth.users set email_confirmed_at = now() where email = 'familia.c@demo.invalid';
  select status into st2 from public.invitations where lower(email) = 'familia.c@demo.invalid' and role = 'familia';
  perform t.login('familia.c@demo.invalid'); seen := t.count('select 1 from public.linked_patients'); perform t.logout();
  perform t.record('18 Convite cria perfil com o papel e os vínculos corretos; aceite é registrado',
     r1 = 'ok:1' and r2 like 'err:%' and role_ = 'familia' and links = 1 and st1 = 'pendente' and st2 = 'aceito' and seen = 1,
     r1||' '||r2||' '||coalesce(role_,'')||' '||links||' '||st1||'>'||st2||' vê='||seen);
end $$;
