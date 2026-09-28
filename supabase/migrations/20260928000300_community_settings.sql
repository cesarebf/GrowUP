begin;

-- A locator is never authority. Only the eligible current owner can update
-- these four settings; no membership, ownership, or slug writes are exposed.
create function public.update_community_settings(p_community_id uuid, p_settings jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_slug text;
begin
  -- Match join/leave lock order. The exclusive community lock serializes
  -- settings changes with admission and rechecks ownership after waiting.
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  select slug into target_slug from public.communities
    where id = p_community_id and owner_user_id = actor for update;
  if not found then
    raise exception 'Community settings unavailable' using errcode = '42501';
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Invalid community settings' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_settings) as fields(key)
    where key not in ('name', 'description', 'visibility', 'join_policy'))
    or jsonb_typeof(p_settings -> 'name') is distinct from 'string'
    or jsonb_typeof(p_settings -> 'visibility') is distinct from 'string'
    or jsonb_typeof(p_settings -> 'join_policy') is distinct from 'string'
    or (p_settings ? 'description' and jsonb_typeof(p_settings -> 'description') is distinct from 'string') then
    raise exception 'Invalid community settings' using errcode = '22023';
  end if;

  -- Existing constraints enforce bounds, control-character exclusion and
  -- exact visibility/policy values atomically. Omitted description clears it.
  update public.communities
    set name = btrim(p_settings ->> 'name'),
        description = btrim(coalesce(p_settings ->> 'description', '')),
        visibility = p_settings ->> 'visibility',
        join_policy = p_settings ->> 'join_policy'
    where id = p_community_id and owner_user_id = actor;
  return target_slug;
end;
$$;
revoke all on function public.update_community_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_community_settings(uuid, jsonb) to authenticated;

-- Table privileges, RLS, admission logic, and ownership constraints unchanged.
commit;
