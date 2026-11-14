-- Matriz de documentos da Turma (planning §5.7, ressalva da Fase 7).
-- Documento privado de outra pessoa não chega ao cliente (RLS de public.documents), então a matriz
-- mostrava "—" mesmo quando a pessoa já tinha enviado. Esta função devolve só "quem tem qual categoria",
-- sem título, arquivo, validade ou id: nada que identifique o documento.
-- Aditiva: o app chama a função como opcional e, sem ela, continua contando só o que a RLS mostra.

create or replace function public.trip_document_presence(p_trip uuid)
returns table (owner_id uuid, category public.doc_category)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct d.owner_id, d.category
    from public.documents d
    join public.trip_members m on m.trip_id = d.trip_id and m.user_id = d.owner_id
   where d.trip_id = p_trip
     and d.status = 'ready'
     and public.is_trip_member(p_trip);
$$;

revoke all on function public.trip_document_presence(uuid) from public, anon;
grant execute on function public.trip_document_presence(uuid) to authenticated;
