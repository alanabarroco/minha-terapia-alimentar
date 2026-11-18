-- =====================================================================
-- DADOS INTEIRAMENTE FICTÍCIOS (demonstração/testes). Nenhuma pessoa real.
-- Pré-requisito: os 7 usuários demo já existem (scripts/seed-demo.ts cria
-- via API de administração; os testes locais os criam via convites).
-- Remoção: db/demo/remove_demo.sql
-- =====================================================================
do $$
declare
  alana uuid; cores uuid; sup uuid; escA uuid; escB uuid; famA uuid; famB uuid;
  p1 uuid := 'a1000000-0000-4000-8000-000000000001';
  p2 uuid := 'a1000000-0000-4000-8000-000000000002';
  p3 uuid := 'a1000000-0000-4000-8000-000000000003';
  p4 uuid := 'a1000000-0000-4000-8000-000000000004';
  p5 uuid := 'a1000000-0000-4000-8000-000000000005';
  s1 uuid := 'b1000000-0000-4000-8000-000000000001';
  pl1 uuid := 'c1000000-0000-4000-8000-000000000001';
  g_esc uuid := 'd1000000-0000-4000-8000-000000000001';
  g_fam uuid := 'd1000000-0000-4000-8000-000000000002';
  d_pub uuid := 'e1000000-0000-4000-8000-000000000001';
  d_priv uuid := 'e1000000-0000-4000-8000-000000000002';
  d_p2 uuid := 'e1000000-0000-4000-8000-000000000003';
begin
  select id into alana from public.profiles where email = 'master.alana@demo.invalid';
  select id into cores from public.profiles where email = 'master.cores@demo.invalid';
  select id into sup   from public.profiles where email = 'supervisionada@demo.invalid';
  select id into escA  from public.profiles where email = 'escola.a@demo.invalid';
  select id into escB  from public.profiles where email = 'escola.b@demo.invalid';
  select id into famA  from public.profiles where email = 'familia.a@demo.invalid';
  select id into famB  from public.profiles where email = 'familia.b@demo.invalid';
  if alana is null or famB is null then raise exception 'Usuários demo ausentes. Crie-os antes.'; end if;

  -- Pacientes (fictícios) ---------------------------------------------
  insert into public.patients(id, full_name, preferred_name, birth_date, sex_growth, guardians, school_name, class_name,
      diagnoses, allergies, restrictions, medications, reason, clinical_notes, school_photo_authorized, status, is_demo, created_by) values
   (p1,'Lucas Demo Almeida','Lucas', (current_date - interval '5 years 3 months')::date,'M',
      '[{"nome":"Responsável Demo A","parentesco":"mãe","telefone":"(00) 00000-0000","email":"familia.a@demo.invalid"}]',
      'Escola Demo A','Turma Demo 1','Seletividade alimentar (informada)','Nenhuma informada','',
      '', 'Recusa de vegetais e texturas mistas.', 'SEGREDO-INTERNO nota clínica do Lucas', true,'ativo',true,alana),
   (p2,'Marina Demo Souza','Mari',(current_date - interval '8 years 1 month')::date,'F',
      '[{"nome":"Responsável Demo B","parentesco":"pai","telefone":"(00) 00000-0001","email":"familia.b@demo.invalid"}]',
      'Escola Demo B','Turma Demo 2','', 'Alergia informada: leite de vaca','', '', 'Comer pouco e lentamente.',
      'SEGREDO-INTERNO nota clínica da Marina', false,'ativo',true,alana),
   (p3,'Pedro Demo Lima','Pedro',(current_date - interval '14 years 6 months')::date,'M','[]',null,null,
      '','','','','Ansiedade em refeições fora de casa.','SEGREDO-INTERNO nota clínica do Pedro',false,'ativo',true,alana),
   (p4,'Sofia Demo Almeida','Sofia',(current_date - interval '1 year 2 months')::date,'F','[]',null,null,
      '','','','','Introdução alimentar com dificuldades.','SEGREDO-INTERNO nota clínica da Sofia',false,'ativo',true,alana),
   (p5,'Paciente Demo Arquivado','Arq',(current_date - interval '10 years')::date,'F','[]',null,null,
      '','','','','Caso encerrado (fictício).','SEGREDO-INTERNO nota arquivada',false,'arquivado',true,alana);

  -- Vínculos (família A: Lucas e Sofia; família B: Marina e o arquivado; escolas A/B)
  insert into public.access_links(user_id, patient_id, created_by) values
    (famA,p1,alana),(famA,p4,alana),(famB,p2,alana),(famB,p5,alana),(escA,p1,alana),(escB,p2,alana);

  -- Anamnese e crescimento --------------------------------------------
  insert into public.anamneses(patient_id, answers, status, internal_notes, created_by) values
    (p1, '{"historia_alimentar":"Aceitava purês até 1 ano; recusa progressiva depois.","telas":"Usa tela no jantar."}',
     'finalizada','SEGREDO-INTERNO anamnese', sup);
  insert into public.growth_measurements(patient_id, measured_on, weight_kg, height_cm, measure_type, notes, internal_notes, created_by) values
    (p1, current_date - 180, 16.2, 104.0, 'altura', 'Aferição no consultório', 'SEGREDO-INTERNO medida', sup),
    (p1, current_date - 5,   17.0, 107.5, 'altura', null, null, sup),
    (p4, current_date - 10,   9.1,  74.0, 'comprimento', null, null, sup),
    (p2, current_date - 20,  25.4, 126.0, 'altura', null, null, sup);

  -- Diário (profissional) e escola ------------------------------------
  insert into public.food_diary_entries(patient_id, entry_date, entry_time, meal, location, foods_served, foods_accepted,
      qty_offered, qty_consumed, qty_unit, texture, utensils, help_needed, screen_use, duration_min, photo_before_path,
      observations, internal_notes, status, created_by) values
    (p1, current_date - 2, '19:00', 'jantar', 'casa', 'Arroz, frango desfiado, brócolis', 'Arroz e frango',
      150, 80, 'g', 'macia', 'colher', 'incentivo verbal', 'sim', 25, p1::text || '/diary/foto-antes-1.jpg',
      'Recusou o brócolis ao ver.', 'SEGREDO-INTERNO diário', 'final', sup),
    (p1, current_date - 1, '07:30', 'café da manhã', 'casa', 'Pão, leite', 'Pão', null, null, null, null, null, null, null, 15,
      null, null, null, 'rascunho', sup);
  insert into public.food_diary_entries(patient_id, entry_date, meal, milk_type, formula_name, milk_volume_ml, milk_frequency,
      container, night_offers, dilution_info, status, created_by)
    values (p4, current_date - 1, 'lanche', 'fórmula', 'Fórmula Demo', 150, '3x ao dia', 'mamadeira', '1 mamada às 3h', 'conforme rótulo (informado)', 'final', sup);

  insert into public.school_meal_records(patient_id, record_date, record_time, meal, foods_offered, foods_consumed, environment,
      companions, duration_min, help_needed, behavior, photo_path, created_by) values
    (p1, current_date - 3, '12:00', 'almoço', 'Arroz, feijão, legumes', 'Arroz e feijão', 'refeitório', 'colegas', 20,
     'nenhuma', 'Tranquilo.', p1::text || '/school/s1.jpg', escA),
    (p2, current_date - 3, '12:00', 'almoço', 'Macarrão', 'Metade', 'sala', 'colegas', 30, 'incentivo', 'Lenta.', null, escB);

  -- Questionário, repertório -------------------------------------------
  insert into public.questionnaire_responses(patient_id, age_band, version, interviewee, answers, clinical_reasoning, referral_areas, status, created_by) values
    (p1, '2_5', '2_5-v1', 'mãe', '{"2_5.A.1":1,"2_5.A.2":2,"2_5.B.1":4,"2_5.B.2":null}',
     'Avaliar necessidade de fonoaudiologia (julgamento profissional, demo).', array['fonoaudiologia'], 'finalizado', sup);
  insert into public.food_repertoire(patient_id, food_name, food_group, acceptance, textures, temperatures, brands, preparations, created_by) values
    (p1,'Arroz','cereais','aceito','soltinho','morno',null,'cozido',sup),
    (p1,'Brócolis','hortaliças','recusado','macio','morno',null,'cozido',sup),
    (p1,'Banana','frutas','em_exploracao','inteira','ambiente',null,'in natura',sup);

  -- Sessões ------------------------------------------------------------
  insert into public.sessions(id, patient_id, session_date, location, professional_id, objectives, foods, activities, skills,
      outcomes, guidance, next_steps, exploration, status, internal_notes, created_by) values
    (s1, p1, current_date - 7, 'consultorio', sup, 'Tolerar a presença do brócolis no prato', 'Brócolis',
     'Brincadeira de carimbo com legumes', 'Interação com alimento novo', 'resultado inicial: tocou e cheirou',
     'Oferecer sem pressão', 'Repetir a exploração', '[{"alimento":"Brócolis","etapas":["tolerou","interagiu","tocou","cheirou"]}]',
     'finalizada', 'SEGREDO-INTERNO sessão', sup),
    (gen_random_uuid(), p1, current_date + 7, 'consultorio', sup, 'Próxima exploração', null, null, null, null, null, null, '[]', 'agendada', null, alana),
    (gen_random_uuid(), p3, current_date - 1, 'online', sup, 'Conversa sobre refeições fora de casa', null, null, null, null, null, null, '[]', 'rascunho', null, sup);

  -- Planejamento, orientações ------------------------------------------
  insert into public.therapeutic_plans(id, patient_id, title, status, activities, foods, materials, family_guidance, school_guidance, review_date, internal_notes, created_by)
    values (pl1, p1, 'Plano de exploração — Lucas (demo)', 'ativo', 'Exploração sensorial lúdica', 'Brócolis, banana',
            'Pratos e carimbos', 'Manter refeições em horários regulares.', 'Oferecer o alimento sem insistência.', current_date + 30,
            'SEGREDO-INTERNO plano', sup);
  insert into public.plan_goals(plan_id, patient_id, term, description, progress, progress_notes, created_by) values
    (pl1, p1, 'curto', 'Permanecer à mesa por 15 minutos', 'em_andamento', 'SEGREDO-INTERNO meta', sup),
    (pl1, p1, 'medio', 'Tocar em 3 novos alimentos por semana', 'nao_iniciada', null, sup);
  insert into public.guidances(id, patient_id, audience, title, body, internal_notes, created_by) values
    (g_esc, p1, 'escola', 'Orientações para o lanche', 'Ofereça o lanche sem pressa e sem comentários sobre quanto foi comido.', 'SEGREDO-INTERNO orient esc', alana),
    (g_fam, p1, 'familia', 'Rotina da refeição (demo)', 'Mantenha horários regulares e a mesa sem telas.', 'SEGREDO-INTERNO orient fam', alana);

  -- Documentos (metadados; o teste cria os objetos no storage) ----------
  insert into public.documents(id, patient_id, title, kind, storage_path, mime_type, internal_notes, created_by) values
    (d_pub, p1, 'Relatório de acompanhamento (demo)', 'relatorio', p1::text || '/reports/rel1.pdf', 'application/pdf', 'SEGREDO-INTERNO doc', alana),
    (d_priv, p1, 'Rascunho interno (demo)', 'relatorio', p1::text || '/reports/priv.pdf', 'application/pdf', null, alana),
    (d_p2, p2, 'Relatório Marina (demo)', 'relatorio', p2::text || '/reports/rel2.pdf', 'application/pdf', null, alana);

  -- Liberações (feitas como Master Alana) -------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', alana, 'role', 'authenticated')::text, true);
  perform public.publish_record(p1, 'sessions', s1, 'familia');
  perform public.publish_record(p1, 'therapeutic_plans', pl1, 'familia');
  perform public.publish_record(p1, 'therapeutic_plans', pl1, 'escola');
  perform public.publish_record(p1, 'growth_measurements', null, 'familia');
  perform public.publish_record(p1, 'guidances', g_esc, 'escola');
  perform public.publish_record(p1, 'documents', d_pub, 'familia');
  perform public.publish_record(p2, 'documents', d_p2, 'familia');
  -- uma liberação já retirada (histórico)
  perform public.publish_record(p1, 'guidances', g_fam, 'familia');
  perform public.withdraw_publication((select id from public.publications where source_id = g_fam and status = 'ativo'));
  perform set_config('request.jwt.claims', '', true);
end $$;
