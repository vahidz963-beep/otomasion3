begin;

-- Version 140.0.0 (part 2) — quick creation of metered tape / weighted glue
--    warehouse items (the «قلم چسب جدید» button inside the calculator center).
--    Split from Migration 140 so environments that already ran 140 can apply
--    just this file.
--    (the «قلم چسب جدید» button inside the calculator center). Split from
--    Migration 140 so environments that already ran 140 can apply just this.
-- ------------------------------------------------------------------
create or replace function public.fn_calculator_save_consumable(p_kind text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path=public,calculator as $$
declare v_unit text; v_name text; v_item jsonb; v_id uuid;
begin
  if not public.has_role(array['admin','warehouse']) then raise exception 'ایجاد قلم چسب فقط برای مدیر یا انبار مجاز است'; end if;
  if p_kind='tape' then v_unit:='متر'; v_name:='نوار مایلار (چسب دوازده)';
  elsif p_kind='glue' then v_unit:='گرم'; v_name:='چسب هسته';
  else raise exception 'نوع قلم چسب معتبر نیست'; end if;
  -- the unit is enforced server-side: tape is always metered, glue always grams
  v_item:=jsonb_set(coalesce(p_item,'{}'::jsonb),'{unit}',to_jsonb(v_unit));
  v_id:=calculator.resolve_warehouse_item(null::uuid,v_item,v_name,v_unit,'چسب و نوار مایلار');
  perform calculator.log_event('consumable_created','warehouse_item',v_id::text,jsonb_build_object('kind',p_kind,'unit',v_unit),auth.uid());
  return jsonb_build_object('warehouse_item_id',v_id,'unit',v_unit);
end $$;


notify pgrst,'reload schema';
commit;
