-- =====================================================================
-- 0004: armazenamento privado (bucket clinical-files) e suas políticas
-- Convenção de caminho:  {patient_id}/{area}/{uuid}.{ext}
--   area = diary | school | documents | reports
-- Nunca há URL pública. Downloads usam URLs assinadas de curta duração,
-- geradas com a sessão do usuário (portanto sujeitas a estas políticas).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-files', 'clinical-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy cf_select on storage.objects for select to authenticated using (
  bucket_id = 'clinical-files' and (
    public.is_staff()
    -- escola: apenas fotos da área escolar de crianças vinculadas
    or (public.is_school() and split_part(name, '/', 2) = 'school'
        and public.has_link(public.storage_patient_id(name)))
    -- escola/família: somente arquivos com liberação ATIVA para o seu papel
    or exists (
      select 1 from public.publications pb
       where pb.file_path = storage.objects.name and pb.status = 'ativo'
         and public.has_link(pb.patient_id)
         and ((pb.audience = 'familia' and public.is_family()) or (pb.audience = 'escola' and public.is_school())))
  )
);

create policy cf_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'clinical-files' and (
    (public.is_staff()
       and split_part(name, '/', 2) in ('diary','school','documents','reports')
       and exists (select 1 from public.patients p where p.id = public.storage_patient_id(name)))
    or (public.is_school()
       and split_part(name, '/', 2) = 'school'
       and public.has_link(public.storage_patient_id(name))
       and public.school_photo_ok(public.storage_patient_id(name)))
  )
);

-- Sem políticas de UPDATE/DELETE para usuários: arquivos são imutáveis pelo cliente.
-- A remoção ocorre apenas no fluxo administrativo de exclusão (chave de serviço, no servidor).
