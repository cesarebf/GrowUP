begin;

-- Prerequisite: pgcrypto in extensions (already present in development).
-- Hash-only capabilities; no account FKs for historical audit snapshots.
create table public.community_invitations (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  token_hash bytea not null unique,
  created_by_user_id uuid not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  accepted_at timestamptz,
  accepted_by_user_id uuid,
  constraint invitations_hash_valid check (octet_length(token_hash) = 32),
  constraint invitations_expiration_valid check (
    isfinite(created_at) and isfinite(expires_at) and expires_at > created_at
    and expires_at = created_at + interval '168 hours'
  ),
  constraint invitations_resolution_valid check (
    (revoked_at is null) = (revoked_by_user_id is null)
    and (accepted_at is null) = (accepted_by_user_id is null)
    and (accepted_at is null or revoked_at is null)
    and (revoked_at is null or (isfinite(revoked_at) and revoked_at >= created_at and revoked_at < expires_at))
    and (accepted_at is null or (isfinite(accepted_at) and accepted_at >= created_at and accepted_at < expires_at))
  )
);
create index invitations_community_history on public.community_invitations(community_id, created_at desc, id desc);
alter table public.community_invitations enable row level security;
alter table public.community_invitations force row level security;
revoke all on public.community_invitations from public, anon, authenticated;
revoke all (id, community_id, token_hash, created_by_user_id, created_at, expires_at,
  revoked_at, revoked_by_user_id, accepted_at, accepted_by_user_id)
  on public.community_invitations from public, anon, authenticated;

create function public.guard_community_invitation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.accepted_at is not null or new.revoked_at is not null then
      raise exception 'Invitation must start unresolved' using errcode = '23514';
    end if;
  elsif old.accepted_at is not null or old.revoked_at is not null
    or (new.accepted_at is null and new.revoked_at is null)
    or new.id is distinct from old.id
    or new.community_id is distinct from old.community_id
    or new.token_hash is distinct from old.token_hash
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'Invitation history is immutable' using errcode = '23514';
  end if;
  -- Resolution constraints enforce the decision timestamp, not commit time.
  return new;
end;
$$;
revoke all on function public.guard_community_invitation() from public, anon, authenticated;
create trigger invitations_lifecycle before insert or update on public.community_invitations
  for each row execute function public.guard_community_invitation();

-- Internal authorization/lock prefix shared by manager operations. Never grants
-- authority from an input UUID; identity comes exclusively from auth.uid().
create function public.authorize_community_invitation_manager(p_community_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); owner_id uuid; manager_role text;
begin
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
  if p_community_id is null then
    raise exception 'Invalid invitation arguments' using errcode = '22023';
  end if;
  perform 1 from public.communities where id = p_community_id for share;
  select c.owner_user_id into owner_id from public.communities c where c.id = p_community_id;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  perform 1 from public.community_memberships where community_id = p_community_id and user_id = actor for share;
  select m.role into manager_role from public.community_memberships m where m.community_id = p_community_id and m.user_id = actor;
  if manager_role is null or manager_role not in ('owner', 'admin')
    or (manager_role = 'owner' and owner_id <> actor) then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.authorize_community_invitation_manager(uuid) from public, anon, authenticated;

create function public.create_community_invitation(p_community_id uuid, p_token_hash text)
returns table (invitation_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare invitation public.community_invitations%rowtype; decision_time timestamptz;
begin
  perform public.authorize_community_invitation_manager(p_community_id);
  if p_token_hash is null or char_length(p_token_hash) <> 64 or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation arguments' using errcode = '22023';
  end if;
  decision_time := clock_timestamp();
  insert into public.community_invitations(community_id, token_hash, created_by_user_id, created_at, expires_at)
    values (p_community_id, decode(p_token_hash, 'hex'), auth.uid(), decision_time, decision_time + interval '168 hours')
    returning * into invitation;
  return query select invitation.id, invitation.created_at, invitation.expires_at;
end;
$$;
revoke all on function public.create_community_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.create_community_invitation(uuid, text) to authenticated;

create function public.list_community_invitations(
  p_community_id uuid, p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 20
)
returns table (invitation_id uuid, status text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare decision_time timestamptz;
begin
  perform public.authorize_community_invitation_manager(p_community_id);
  if p_limit is null or p_limit not between 1 and 50
    or (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'Invalid invitation arguments' using errcode = '22023';
  end if;
  decision_time := clock_timestamp();
  return query select i.id,
    case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
      when decision_time >= i.expires_at then 'expired' else 'active' end,
    i.created_at, i.expires_at, i.accepted_at, i.revoked_at
    from public.community_invitations i where i.community_id = p_community_id
      and (p_before_id is null or (i.created_at, i.id) < (p_before_created_at, p_before_id))
    order by i.created_at desc, i.id desc limit p_limit;
end;
$$;
revoke all on function public.list_community_invitations(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_community_invitations(uuid, timestamptz, uuid, integer) to authenticated;

create function public.revoke_community_invitation(p_community_id uuid, p_invitation_id uuid)
returns table (invitation_id uuid, status text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare invitation public.community_invitations%rowtype; decision_time timestamptz; current_status text;
begin
  perform public.authorize_community_invitation_manager(p_community_id);
  if p_invitation_id is null then raise exception 'Invalid invitation arguments' using errcode = '22023'; end if;
  perform 1 from public.community_invitations where id = p_invitation_id and community_id = p_community_id for update;
  select * into invitation from public.community_invitations where id = p_invitation_id and community_id = p_community_id;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  decision_time := greatest(clock_timestamp(), invitation.created_at);
  current_status := case when invitation.accepted_at is not null then 'accepted' when invitation.revoked_at is not null then 'revoked'
    when decision_time >= invitation.expires_at then 'expired' else 'active' end;
  if current_status = 'active' then
    update public.community_invitations set revoked_at = decision_time, revoked_by_user_id = auth.uid()
      where id = invitation.id returning * into invitation;
    current_status := 'revoked';
  end if;
  return query select invitation.id, current_status, invitation.created_at, invitation.expires_at, invitation.accepted_at, invitation.revoked_at;
end;
$$;
revoke all on function public.revoke_community_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_community_invitation(uuid, uuid) to authenticated;

create function public.get_community_invitation_preview(p_token text)
returns table (outcome text, community_name text, community_description text, expires_at timestamptz, already_member boolean, community_slug text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or char_length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation arguments' using errcode = '22023';
  end if;
  -- Single limited snapshot; no preview is admission authority. Ineligible
  -- signed-in accounts fail closed rather than falling back to anonymous.
  return query
    with viewer as (select auth.uid() as id, public.is_private_profile_owner(auth.uid()) as eligible),
    capability as (
      select i.*, c.name, c.description, c.slug,
        (v.eligible and exists(select 1 from public.community_memberships m where m.community_id = c.id and m.user_id = v.id)) as member,
        v.id as viewer_id, v.eligible
      from public.community_invitations i join public.communities c on c.id = i.community_id cross join viewer v
      where i.token_hash = extensions.digest(p_token, 'sha256') and (v.id is null or v.eligible)
    ), permitted as (
      select * from capability i where (i.accepted_at is null and i.revoked_at is null and clock_timestamp() < i.expires_at)
        or (i.accepted_at is not null and i.eligible and i.accepted_by_user_id = i.viewer_id)
    )
    select case when i.accepted_at is null then 'active' else 'accepted' end,
      case when i.accepted_at is null or i.member then i.name end,
      case when i.accepted_at is null or i.member then i.description end,
      case when i.accepted_at is null or i.member then i.expires_at end,
      case when i.accepted_at is null or i.member then i.member end,
      case when i.accepted_at is not null and i.member then i.slug end
    from permitted i
    union all select 'unavailable'::text, null::text, null::text, null::timestamptz, null::boolean, null::text
      where not exists(select 1 from permitted);
end;
$$;
revoke all on function public.get_community_invitation_preview(text) from public, anon, authenticated;
grant execute on function public.get_community_invitation_preview(text) to anon, authenticated;

create function public.accept_community_invitation(p_token text)
returns table (outcome text, community_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); digest bytea; hint_id uuid; hint_community uuid;
  invitation public.community_invitations%rowtype; target public.communities%rowtype;
  pending_request uuid; is_member boolean; decision_time timestamptz; admitted boolean := false;
begin
  if p_token is null or char_length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation arguments' using errcode = '22023';
  end if;
  digest := extensions.digest(p_token, 'sha256');
  -- Unlocked immutable routing hint, never authority or a row-lock inversion.
  select i.id, i.community_id into hint_id, hint_community from public.community_invitations i where i.token_hash = digest;
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Invitation unavailable' using errcode = '42501';
  end if;
  if hint_id is null then return query select 'unavailable'::text, null::text; return; end if;
  perform 1 from public.communities where id = hint_community for share;
  select * into target from public.communities where id = hint_community;
  if not found then return query select 'unavailable'::text, null::text; return; end if;
  perform 1 from public.community_memberships where community_id = hint_community and user_id = actor for share;
  is_member := exists(select 1 from public.community_memberships where community_id = hint_community and user_id = actor);
  select r.id into pending_request from public.community_membership_requests r
    where r.community_id = hint_community and r.requester_user_id = actor and r.status = 'pending' for update;
  perform 1 from public.community_invitations where id = hint_id for update;
  select * into invitation from public.community_invitations where id = hint_id;
  if not found or invitation.community_id is distinct from hint_community or invitation.token_hash is distinct from digest then
    return query select 'unavailable'::text, null::text; return;
  end if;
  if invitation.accepted_at is not null then
    if invitation.accepted_by_user_id = actor then
      return query select 'accepted'::text, case when is_member then target.slug end;
    else return query select 'unavailable'::text, null::text; end if;
    return;
  end if;
  -- Fresh time after ALL lock waits. This is the admission linearization point.
  decision_time := greatest(clock_timestamp(), invitation.created_at);
  if invitation.revoked_at is not null or decision_time >= invitation.expires_at then
    return query select 'unavailable'::text, null::text; return;
  end if;
  if not is_member then
    insert into public.community_memberships(community_id, user_id, role)
      values (target.id, actor, 'member') on conflict (community_id, user_id) do nothing;
    admitted := found;
  end if;
  if pending_request is not null then
    update public.community_membership_requests r set status = 'cancelled', cancellation_reason = 'already_member',
      resolved_at = greatest(decision_time, r.created_at), resolved_by_user_id = null
      where r.id = pending_request and r.community_id = target.id and r.requester_user_id = actor and r.status = 'pending';
  end if;
  if admitted then
    update public.community_invitations set accepted_at = decision_time, accepted_by_user_id = actor where id = invitation.id;
  end if;
  return query select case when admitted then 'accepted' else 'already_member' end, target.slug;
end;
$$;
revoke all on function public.accept_community_invitation(text) from public, anon, authenticated;
grant execute on function public.accept_community_invitation(text) to authenticated;

commit;
