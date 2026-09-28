begin;

-- Membership is current participation only. These operations do not grant
-- tiers/resource entitlements or represent requests, invitations, or history.
create function public.join_community(p_community_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target public.communities%rowtype;
begin
  -- Serialize this account's join/leave retries and Auth eligibility changes.
  -- A separate statement after the lock rechecks current eligibility.
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Verified account required' using errcode = '42501';
  end if;

  -- Prevent configuration changes/deletion through admission commit. SHARE
  -- permits different accounts to join concurrently without lock upgrades.
  select * into target from public.communities where id = p_community_id for share;
  if not found then
    raise exception 'Community cannot be joined' using errcode = '42501';
  end if;

  -- A retry never changes an existing role, even after admission closes.
  if exists (select 1 from public.community_memberships
    where community_id = target.id and user_id = actor) then
    return target.slug;
  end if;
  if target.visibility not in ('public', 'unlisted') or target.join_policy <> 'instant' then
    raise exception 'Community cannot be joined' using errcode = '42501';
  end if;

  insert into public.community_memberships(community_id, user_id, role)
    values (target.id, actor, 'member')
    on conflict (community_id, user_id) do nothing;
  return target.slug;
end;
$$;
revoke all on function public.join_community(uuid) from public, anon, authenticated;
grant execute on function public.join_community(uuid) to authenticated;

create function public.leave_community(p_community_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  membership_role text;
begin
  -- Same lock order as join: account, community, own membership.
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  perform 1 from public.communities where id = p_community_id for share;
  select role into membership_role from public.community_memberships
    where community_id = p_community_id and user_id = actor for update;
  if membership_role = 'owner' then
    raise exception 'Owners cannot leave their community' using errcode = '42501';
  end if;
  -- Missing, inaccessible, and already-absent targets all return the same result.
  -- Admission policy is irrelevant to voluntary departure.
  delete from public.community_memberships
    where community_id = p_community_id and user_id = actor and role in ('member', 'moderator', 'admin');
end;
$$;
revoke all on function public.leave_community(uuid) from public, anon, authenticated;
grant execute on function public.leave_community(uuid) to authenticated;

-- Existing table grants, RLS, and owner constraints remain unchanged.
commit;
