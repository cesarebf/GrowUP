begin;

-- Attempts are separate from current memberships. No backfill or changes to
-- historical migrations, roles, settings combinations, or ownership constraints.
create table public.community_membership_requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete no action,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_display_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  -- Audit snapshot, deliberately not an FK: reviewer deletion cannot erase or
  -- rewrite another account's history or take an Auth FK lock during cancellation.
  resolved_by_user_id uuid,
  cancellation_reason text,
  constraint membership_requests_name_valid check (
    char_length(requester_display_name) between 1 and 80
    and requester_display_name = btrim(requester_display_name)
    and requester_display_name !~ '[[:cntrl:]]'
    and requester_display_name !~ U&'[\0080-\009F]'
  ),
  constraint membership_requests_status_valid check (
    status in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')
  ),
  constraint membership_requests_resolution_valid check (
    (status = 'pending' and resolved_at is null and resolved_by_user_id is null and cancellation_reason is null)
    or (status in ('approved', 'rejected') and resolved_at is not null
      and resolved_by_user_id is not null and resolved_by_user_id <> requester_user_id and cancellation_reason is null)
    or (status = 'withdrawn' and resolved_at is not null
      and resolved_by_user_id is not null and resolved_by_user_id = requester_user_id and cancellation_reason is null)
    or (status = 'cancelled' and resolved_at is not null and resolved_by_user_id is null
      and cancellation_reason is not null and cancellation_reason in ('policy_changed', 'already_member', 'requester_unavailable'))
  ),
  constraint membership_requests_time_valid check (resolved_at is null or resolved_at >= created_at)
);
create unique index membership_requests_pending_unique
  on public.community_membership_requests(community_id, requester_user_id) where status = 'pending';
create index membership_requests_pending_queue
  on public.community_membership_requests(community_id, created_at, id) where status = 'pending';
create index membership_requests_requester_community_history
  on public.community_membership_requests(requester_user_id, community_id, created_at desc, id desc);
create index membership_requests_requester_history
  on public.community_membership_requests(requester_user_id, created_at desc, id desc);
create index membership_requests_community_idx on public.community_membership_requests(community_id);

alter table public.community_membership_requests enable row level security;
alter table public.community_membership_requests force row level security;
revoke all on public.community_membership_requests from public, anon, authenticated;
revoke all (id, community_id, requester_user_id, requester_display_name, status,
  created_at, resolved_at, resolved_by_user_id, cancellation_reason)
  on public.community_membership_requests from public, anon, authenticated;
-- Intentionally no direct-read/write policies. Only authorized projections below.

create function public.guard_community_membership_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' then
      raise exception 'Requests must start pending' using errcode = '23514';
    end if;
  elsif old.status <> 'pending' or new.status is not distinct from old.status
    or new.id is distinct from old.id
    or new.community_id is distinct from old.community_id
    or new.requester_user_id is distinct from old.requester_user_id
    or new.requester_display_name is distinct from old.requester_display_name
    or new.created_at is distinct from old.created_at then
    raise exception 'Request history is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_community_membership_request() from public, anon, authenticated;
create trigger membership_requests_lifecycle before insert or update on public.community_membership_requests
  for each row execute function public.guard_community_membership_request();

create function public.cancel_ineligible_community_membership_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'private' or new.join_policy <> 'approval_required' then
    -- Already holding the community write lock. Never acquire Auth/membership
    -- locks here; request operations cannot pass their community SHARE lock.
    update public.community_membership_requests
      set status = 'cancelled', cancellation_reason = 'policy_changed',
          resolved_at = greatest(clock_timestamp(), created_at), resolved_by_user_id = null
      where community_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;
revoke all on function public.cancel_ineligible_community_membership_requests() from public, anon, authenticated;
create trigger communities_cancel_ineligible_requests after update of visibility, join_policy on public.communities
  for each row execute function public.cancel_ineligible_community_membership_requests();

create function public.request_community_membership(p_community_id uuid, p_display_name text)
returns table (request_id uuid, status text, outcome text, cancellation_reason text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target public.communities%rowtype;
  attempt public.community_membership_requests%rowtype;
  shared_name text := btrim(p_display_name);
begin
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  if p_community_id is null or shared_name is null or char_length(shared_name) not between 1 and 80
    or shared_name ~ '[[:cntrl:]]' or shared_name ~ U&'[\0080-\009F]' then
    raise exception 'Invalid request arguments' using errcode = '22023';
  end if;
  perform 1 from public.communities where id = p_community_id for share;
  select * into target from public.communities where id = p_community_id;
  if not found or target.visibility not in ('public', 'unlisted') or target.join_policy <> 'approval_required' then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  perform 1 from public.community_memberships where community_id = p_community_id and user_id = actor for share;
  if found then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  select * into attempt from public.community_membership_requests r
    where r.community_id = p_community_id and r.requester_user_id = actor and r.status = 'pending' for update;
  if found then
    return query select attempt.id, attempt.status, 'already_pending'::text, attempt.cancellation_reason;
    return;
  end if;
  insert into public.community_membership_requests(community_id, requester_user_id, requester_display_name)
    values (p_community_id, actor, shared_name) returning * into attempt;
  return query select attempt.id, attempt.status, 'created'::text, attempt.cancellation_reason;
end;
$$;
revoke all on function public.request_community_membership(uuid, text) from public, anon, authenticated;
grant execute on function public.request_community_membership(uuid, text) to authenticated;

create function public.withdraw_community_membership_request(p_community_id uuid, p_request_id uuid)
returns table (request_id uuid, status text, outcome text, cancellation_reason text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  attempt public.community_membership_requests%rowtype;
begin
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  if p_community_id is null or p_request_id is null then
    raise exception 'Invalid request arguments' using errcode = '22023';
  end if;
  perform 1 from public.communities where id = p_community_id for share;
  -- Withdrawal has no membership effect or policy eligibility prerequisite.
  select * into attempt from public.community_membership_requests r
    where r.id = p_request_id and r.community_id = p_community_id and r.requester_user_id = actor for update;
  if not found then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  if attempt.status <> 'pending' then
    return query select attempt.id, attempt.status, 'already_resolved'::text, attempt.cancellation_reason;
    return;
  end if;
  update public.community_membership_requests r set status = 'withdrawn',
    resolved_at = greatest(clock_timestamp(), r.created_at), resolved_by_user_id = actor
    where r.id = attempt.id returning * into attempt;
  return query select attempt.id, attempt.status, 'resolved'::text, attempt.cancellation_reason;
end;
$$;
revoke all on function public.withdraw_community_membership_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_community_membership_request(uuid, uuid) to authenticated;

-- Internal implementation shared by the two fixed-decision entry points. It is
-- not client executable. No supplied identity/role, even at this internal layer.
create function public.review_community_membership_request(p_community_id uuid, p_request_id uuid, p_approve boolean)
returns table (request_id uuid, status text, outcome text, cancellation_reason text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  requester uuid;
  target public.communities%rowtype;
  reviewer_role text;
  attempt public.community_membership_requests%rowtype;
  reason text;
begin
  if p_community_id is null or p_request_id is null or p_approve is null then
    raise exception 'Invalid request arguments' using errcode = '22023';
  end if;
  -- Routing hint only. Identity, tenant, status and authority are re-read below.
  select r.requester_user_id into requester from public.community_membership_requests r
    where r.id = p_request_id and r.community_id = p_community_id;
  perform 1 from auth.users where id in (actor, requester) order by id for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  perform 1 from public.communities where id = p_community_id for share;
  select * into target from public.communities where id = p_community_id;
  if not found then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  perform 1 from public.community_memberships
    where community_id = p_community_id and user_id in (actor, requester)
    order by community_id, user_id for share;
  select m.role into reviewer_role from public.community_memberships m
    where m.community_id = p_community_id and m.user_id = actor;
  if reviewer_role is null or reviewer_role not in ('owner', 'admin')
    or (reviewer_role = 'owner' and target.owner_user_id <> actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  select * into attempt from public.community_membership_requests r
    where r.id = p_request_id and r.community_id = p_community_id for update;
  if not found or attempt.requester_user_id is distinct from requester or requester = actor then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  if attempt.status <> 'pending' then
    return query select attempt.id, attempt.status, 'already_resolved'::text,
      case when attempt.cancellation_reason = 'requester_unavailable' then 'cannot_be_admitted' else attempt.cancellation_reason end;
    return;
  end if;
  if target.visibility not in ('public', 'unlisted') or target.join_policy <> 'approval_required' then
    reason := 'policy_changed';
  elsif p_approve and not exists (
    select 1 from auth.users u where u.id = requester
      and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  ) then
    reason := 'requester_unavailable';
  elsif exists (select 1 from public.community_memberships m where m.community_id = p_community_id and m.user_id = requester) then
    reason := 'already_member';
  elsif p_approve then
    insert into public.community_memberships(community_id, user_id, role)
      values (p_community_id, requester, 'member') on conflict (community_id, user_id) do nothing;
    if not found then reason := 'already_member'; end if;
  end if;
  update public.community_membership_requests r
    set status = case when reason is not null then 'cancelled' when p_approve then 'approved' else 'rejected' end,
        resolved_at = greatest(clock_timestamp(), r.created_at),
        resolved_by_user_id = case when reason is null then actor else null end,
        cancellation_reason = reason
    where r.id = attempt.id returning * into attempt;
  -- Cancellation is a committed business result, never an exception/rollback.
  return query select attempt.id, attempt.status,
    case when reason is not null then 'cancelled' else 'resolved' end,
    case when reason = 'requester_unavailable' then 'cannot_be_admitted' else reason end;
end;
$$;
revoke all on function public.review_community_membership_request(uuid, uuid, boolean) from public, anon, authenticated;

create function public.approve_community_membership_request(p_community_id uuid, p_request_id uuid)
returns table (request_id uuid, status text, outcome text, cancellation_reason text)
language sql security definer set search_path = '' as $$
  select * from public.review_community_membership_request(p_community_id, p_request_id, true);
$$;
revoke all on function public.approve_community_membership_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_community_membership_request(uuid, uuid) to authenticated;

create function public.reject_community_membership_request(p_community_id uuid, p_request_id uuid)
returns table (request_id uuid, status text, outcome text, cancellation_reason text)
language sql security definer set search_path = '' as $$
  select * from public.review_community_membership_request(p_community_id, p_request_id, false);
$$;
revoke all on function public.reject_community_membership_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reject_community_membership_request(uuid, uuid) to authenticated;

create function public.get_my_community_membership_requests(
  p_community_id uuid default null, p_before_created_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 20
)
returns table (request_id uuid, community_id uuid, requester_display_name text, status text,
  created_at timestamptz, resolved_at timestamptz, cancellation_reason text, community_name text, community_slug text)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid request arguments' using errcode = '22023';
  end if;
  return query select r.id, r.community_id, r.requester_display_name, r.status,
    r.created_at, r.resolved_at, r.cancellation_reason, c.name, c.slug
    from public.community_membership_requests r
    left join public.communities c on c.id = r.community_id and (
      c.visibility in ('public', 'unlisted') or exists (
        select 1 from public.community_memberships m where m.community_id = c.id and m.user_id = actor
      )
    )
    where r.requester_user_id = actor and (p_community_id is null or r.community_id = p_community_id)
      and (p_before_created_at is null or (r.created_at, r.id) < (p_before_created_at, p_before_id))
    order by r.created_at desc, r.id desc limit p_limit;
end;
$$;
revoke all on function public.get_my_community_membership_requests(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_my_community_membership_requests(uuid, timestamptz, uuid, integer) to authenticated;

create function public.list_community_membership_requests(
  p_community_id uuid, p_after_created_at timestamptz default null,
  p_after_id uuid default null, p_limit integer default 20
)
returns table (request_id uuid, requester_display_name text, status text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_owner uuid;
  reviewer_role text;
begin
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  if p_community_id is null or p_limit is null or p_limit not between 1 and 50
    or (p_after_created_at is null) <> (p_after_id is null)
    or (p_after_created_at is not null and not isfinite(p_after_created_at)) then
    raise exception 'Invalid request arguments' using errcode = '22023';
  end if;
  perform 1 from public.communities where id = p_community_id for share;
  select c.owner_user_id into target_owner from public.communities c where c.id = p_community_id;
  perform 1 from public.community_memberships where community_id = p_community_id and user_id = actor for share;
  select m.role into reviewer_role from public.community_memberships m where m.community_id = p_community_id and m.user_id = actor;
  if target_owner is null or reviewer_role is null or reviewer_role not in ('owner', 'admin')
    or (reviewer_role = 'owner' and target_owner <> actor) then
    raise exception 'Request unavailable' using errcode = '42501';
  end if;
  return query select r.id, r.requester_display_name, r.status, r.created_at
    from public.community_membership_requests r where r.community_id = p_community_id and r.status = 'pending'
      and (p_after_created_at is null or (r.created_at, r.id) > (p_after_created_at, p_after_id))
    order by r.created_at, r.id limit p_limit;
end;
$$;
revoke all on function public.list_community_membership_requests(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_community_membership_requests(uuid, timestamptz, uuid, integer) to authenticated;

commit;
