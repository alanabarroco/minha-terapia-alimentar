-- Remove TODOS os dados de demonstração (pacientes marcados is_demo e usuários @demo.invalid).
-- Execute no SQL Editor do Supabase ANTES de usar dados reais.
-- Depois, apague também os usuários demo em Authentication > Users (ou rode scripts/seed-demo.ts --remove).
delete from public.patients where is_demo = true;          -- cascata remove registros clínicos
delete from public.publications where patient_id not in (select id from public.patients);
delete from public.invitations where email like '%@demo.invalid';
delete from public.profiles where email like '%@demo.invalid' and role not in ('master_alana','master_cores');
-- Contas master demo: apague-as manualmente (a proteção impede desativação pelo aplicativo)
-- delete from auth.users where email like '%@demo.invalid';
