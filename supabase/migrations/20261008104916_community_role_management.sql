begin;

-- Volatile default backfills each existing lifetime once, without UPDATE or
-- changes to the composite PK, timestamps, roles, or ownership constraints.
alter table public.community_memberships
  add column membership_id uuid not null default gen_random_uuid(),
  add column management_display_name text,
  add constraint community_memberships_membership_id_key unique (membership_id),
  add constraint community_memberships_management_name_valid check (
    management_display_name is null or (
      char_length(management_display_name) between 1 and 80
      and management_display_name = btrim(management_display_name)
      and management_display_name !~ '[[:cntrl:]]'
    )
  );
create index community_memberships_roster_idx
  on public.community_memberships(community_id, created_at, membership_id);

create function public.guard_community_membership_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.membership_id is distinct from old.membership_id
    or new.community_id is distinct from old.community_id
    or new.user_id is distinct from old.user_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Membership identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_community_membership_identity() from public, anon, authenticated;
create trigger community_memberships_identity before update on public.community_memberships
  for each row execute function public.guard_community_membership_identity();

create table public.community_member_management_events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  target_membership_id uuid not null,
  old_role text not null check (old_role in ('member', 'moderator', 'admin')),
  new_role text check (new_role in ('member', 'moderator', 'admin')),
  occurred_at timestamptz not null default clock_timestamp() check (isfinite(occurred_at)),
  check (actor_user_id <> target_user_id),
  check (new_role is null or new_role <> old_role)
);
create index community_member_management_events_community_idx
  on public.community_member_management_events(community_id);
alter table public.community_member_management_events enable row level security;
alter table public.community_member_management_events force row level security;
revoke all on public.community_member_management_events from public, anon, authenticated;
revoke all (id, community_id, actor_user_id, target_user_id, target_membership_id, old_role, new_role, occurred_at)
  on public.community_member_management_events from public, anon, authenticated;

-- RLS still governs which communities are readable. Ownership IDs/discriminator
-- are not application read fields. Existing explicit safe projections work.
revoke select on public.communities from public, anon, authenticated;
revoke select (owner_user_id, owner_role) on public.communities from public, anon, authenticated;
grant select (id, name, slug, description, visibility, join_policy, created_at, updated_at)
  on public.communities to authenticated;

-- Internal mutation implementation, not a permission API. Wrappers fix the
-- operation. All current-state reads after waits use fresh READ COMMITTED
-- statements; the initial tenant lookup is only an account-lock routing hint.
create function public.mutate_community_member(
  p_community_id uuid, p_membership_id uuid, p_role text, p_remove boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  hinted_user uuid;
  current_owner uuid;
  actor_role text;
  target public.community_memberships%rowtype;
begin
  if p_community_id is null or p_membership_id is null or p_remove is null
    or (not p_remove and (p_role is null or p_role not in ('member', 'moderator', 'admin')))
    or (p_remove and p_role is not null) then
    raise exception 'Invalid management arguments' using errcode = '22023';
  end if;
  select m.user_id into hinted_user from public.community_memberships m
    where m.community_id = p_community_id and m.membership_id = p_membership_id;
  perform 1 from auth.users u where u.id in (actor, hinted_user) order by u.id for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for share;
  select c.owner_user_id into current_owner from public.communities c where c.id = p_community_id;
  perform 1 from public.community_memberships m
    where m.community_id = p_community_id and m.user_id in (actor, hinted_user)
    order by m.community_id, m.user_id for update;
  select m.role into actor_role from public.community_memberships m
    where m.community_id = p_community_id and m.user_id = actor;
  if current_owner is null or actor_role is null or actor_role not in ('owner', 'admin')
    or (actor_role = 'owner' and current_owner <> actor) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  select m.* into target from public.community_memberships m
    where m.community_id = p_community_id and m.user_id = hinted_user and m.membership_id = p_membership_id;
  if not found then
    if p_remove then return 'already_absent'; end if;
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  if target.user_id = actor or target.role = 'owner' or target.user_id = current_owner
    or (actor_role = 'admin' and (target.role = 'admin' or p_role = 'admin')) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  -- Authorization precedes no-op handling. No UPDATE, clock rewrite, or audit.
  if not p_remove and target.role = p_role then return 'unchanged'; end if;
  if not p_remove and (
    (target.role = 'member' and p_role in ('moderator', 'admin'))
    or (target.role = 'moderator' and p_role = 'admin')
  ) and not exists (
    select 1 from auth.users u where u.id = target.user_id
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  if p_remove then
    perform 1 from public.community_membership_requests r
      where r.community_id = p_community_id and r.requester_user_id = target.user_id
        and r.status = 'pending' for update;
    update public.community_membership_requests r
      set status = 'cancelled', cancellation_reason = 'already_member', resolved_by_user_id = null,
        resolved_at = greatest(clock_timestamp(), r.created_at)
      where r.community_id = p_community_id and r.requester_user_id = target.user_id and r.status = 'pending';
    delete from public.community_memberships m
      where m.community_id = p_community_id and m.user_id = target.user_id and m.membership_id = p_membership_id;
  else
    update public.community_memberships m set role = p_role
      where m.community_id = p_community_id and m.user_id = target.user_id and m.membership_id = p_membership_id;
  end if;
  -- No exception handler: any audit failure rolls back the entire operation.
  insert into public.community_member_management_events
    (community_id, actor_user_id, target_user_id, target_membership_id, old_role, new_role)
    values (p_community_id, actor, target.user_id, target.membership_id, target.role, p_role);
  return case when p_remove then 'removed' else 'changed' end;
end;
$$;
revoke all on function public.mutate_community_member(uuid, uuid, text, boolean) from public, anon, authenticated;

create function public.set_community_member_role(p_community_id uuid, p_membership_id uuid, p_role text)
returns table (outcome text) language sql security definer set search_path = '' as $$
  select public.mutate_community_member(p_community_id, p_membership_id, p_role, false);
$$;
revoke all on function public.set_community_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_community_member_role(uuid, uuid, text) to authenticated;

create function public.remove_community_member(p_community_id uuid, p_membership_id uuid)
returns table (outcome text) language sql security definer set search_path = '' as $$
  select public.mutate_community_member(p_community_id, p_membership_id, null, true);
$$;
revoke all on function public.remove_community_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;

create function public.set_my_community_management_name(
  p_community_id uuid, p_membership_id uuid, p_name text
)
returns table (management_display_name text) language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  normalized text := nullif(btrim(p_name), '');
  target public.community_memberships%rowtype;
begin
  if p_community_id is null or p_membership_id is null or (normalized is not null and (
    char_length(normalized) not between 1 and 80 or normalized ~ '[[:cntrl:]]'
  )) then
    raise exception 'Invalid management arguments' using errcode = '22023';
  end if;
  perform 1 from auth.users u where u.id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for share;
  perform 1 from public.community_memberships m where m.community_id = p_community_id and m.user_id = actor for update;
  select m.* into target from public.community_memberships m
    where m.community_id = p_community_id and m.user_id = actor and m.membership_id = p_membership_id;
  if not found then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  if target.management_display_name is distinct from normalized then
    update public.community_memberships m set management_display_name = normalized
      where m.community_id = p_community_id and m.user_id = actor and m.membership_id = p_membership_id;
  end if;
  return query select normalized;
end;
$$;
revoke all on function public.set_my_community_management_name(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_my_community_management_name(uuid, uuid, text) to authenticated;

create function public.list_community_members(
  p_community_id uuid, p_after_created_at timestamptz default null,
  p_after_membership_id uuid default null, p_limit integer default 20
)
returns table (membership_id uuid, management_display_name text, role text, joined_at timestamptz, is_self boolean)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_owner uuid;
  actor_role text;
begin
  if p_community_id is null or p_limit is null or p_limit not between 1 and 50
    or (p_after_created_at is null) <> (p_after_membership_id is null)
    or (p_after_created_at is not null and not isfinite(p_after_created_at)) then
    raise exception 'Invalid management arguments' using errcode = '22023';
  end if;
  perform 1 from auth.users u where u.id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for share;
  select c.owner_user_id into current_owner from public.communities c where c.id = p_community_id;
  perform 1 from public.community_memberships m where m.community_id = p_community_id and m.user_id = actor for share;
  select m.role into actor_role from public.community_memberships m where m.community_id = p_community_id and m.user_id = actor;
  if current_owner is null or actor_role is null or actor_role not in ('owner', 'admin')
    or (actor_role = 'owner' and current_owner <> actor) then
    raise exception 'Management unavailable' using errcode = '42501';
  end if;
  -- Only authority rows are locked. Names of ALL currently ineligible accounts
  -- are suppressed without an account-status field or reason in the projection.
  return query select m.membership_id,
    case when u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
      then m.management_display_name else null end,
    m.role, m.created_at, m.user_id = actor
    from public.community_memberships m join auth.users u on u.id = m.user_id
    where m.community_id = p_community_id
      and (p_after_created_at is null or (m.created_at, m.membership_id) > (p_after_created_at, p_after_membership_id))
    order by m.created_at, m.membership_id limit p_limit;
end;
$$;
revoke all on function public.list_community_members(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_community_members(uuid, timestamptz, uuid, integer) to authenticated;

commit;
