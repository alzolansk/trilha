-- Trilha · ajustes aplicados ao projeto real em 6 out 2026 (após o verificador de segurança).
-- Só restringe permissões e completa perfis: nada é apagado.

-- Funções de gatilho não devem ser chamadas pela API (/rest/v1/rpc).
revoke execute on function public.handle_new_user(), public.handle_new_trip(), public.keep_one_organizer(),
  public.bump_version(), public.protect_document_fields(), public.check_expense_people()
  from authenticated, anon, public;

-- Analytics: o app só insere; uso de IA: o app só lê o próprio (incremento via consume_ai_call).
revoke all on public.analytics_events, public.ai_usage from anon, authenticated;
grant insert on public.analytics_events to authenticated;
grant select on public.ai_usage to authenticated;
revoke all on public.document_offline_prefs, public.trip_retros, public.notification_prefs,
  public.push_subscriptions from anon;

-- Contas criadas antes do gatilho de perfis ganham perfil.
insert into public.profiles (id, display_name)
select u.id,
       left(coalesce(
         nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
         nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
         nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
         split_part(coalesce(u.email, 'viajante'), '@', 1)
       ), 60)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);
