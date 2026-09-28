begin;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  -- Constant discriminator lets a deferred FK require a matching owner role.
  owner_role text generated always as ('owner'::text) stored,
  name text not null,
  slug text not null unique,
  description text not null default '',
  visibility text not null,
  join_policy text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communities_name_valid check (
    char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'
  ),
  constraint communities_slug_valid check (
    char_length(slug) between 3 and 48
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and slug not in ('new', 'admin', 'api', 'auth', 'account', 'communities', 'settings', 'support', 'help', 'growup', 'www')
  ),
  constraint communities_description_valid check (
    char_length(description) <= 500 and description = btrim(description) and description !~ '[[:cntrl:]]'
  ),
  constraint communities_visibility_valid check (visibility in ('public', 'unlisted', 'private')),
  constraint communities_join_policy_valid check (join_policy in ('instant', 'approval_required', 'invitation_only'))
);
create index communities_owner_idx on public.communities(owner_user_id);

-- Existence means current membership. Pending requests/invitations and other
-- lifecycle states are intentionally not represented as memberships yet.
create table public.community_memberships (
  community_id uuid not null references public.communities(id) on delete no action,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('member', 'moderator', 'admin', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (community_id, user_id),
  unique (community_id, user_id, role)
);
create index community_memberships_user_idx on public.community_memberships(user_id, community_id);
create unique index community_memberships_one_owner_idx
  on public.community_memberships(community_id) where role = 'owner';

-- At least one matching owner, plus the unique index above = exactly one.
-- Deferred checking permits creation and future accepted transfers atomically.
alter table public.communities add constraint communities_owner_membership_fk
  foreign key (id, owner_user_id, owner_role)
  references public.community_memberships(community_id, user_id, role)
  deferrable initially deferred;

alter table public.communities enable row level security;
alter table public.communities force row level security;
alter table public.community_memberships enable row level security;
alter table public.community_memberships force row level security;
revoke all on public.communities, public.community_memberships from public, anon, authenticated;
grant select on public.communities, public.community_memberships to authenticated;

create policy community_memberships_select_own on public.community_memberships
  for select to authenticated using (public.is_private_profile_owner(user_id));
create policy communities_select_member on public.communities
  for select to authenticated using (exists (
    select 1 from public.community_memberships m
    where m.community_id = communities.id and m.user_id = (select auth.uid())
  ));
-- No INSERT/UPDATE/DELETE policies or grants, including for community owners.

create function public.community_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.community_set_updated_at() from public, anon, authenticated;
create trigger communities_updated_at before update on public.communities
  for each row execute function public.community_set_updated_at();
create trigger community_memberships_updated_at before update on public.community_memberships
  for each row execute function public.community_set_updated_at();

-- Hard deletion is blocked by owner_user_id's FK. Also guard Supabase's soft
-- deletion path. Creation locks the same Auth row to serialize against deletion.
create function public.prevent_community_owner_soft_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.communities where owner_user_id = new.id) then
    raise exception 'Community ownership must be resolved before account deletion' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_community_owner_soft_delete() from public, anon, authenticated;
create trigger auth_user_community_owner_soft_delete
  before update of deleted_at on auth.users
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.prevent_community_owner_soft_delete();

-- The only client-callable write. Caller supplies metadata, never owner/role/ID.
create function public.create_community(
  p_name text, p_slug text, p_description text, p_visibility text, p_join_policy text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  community uuid;
begin
  perform 1 from auth.users where id = actor for update;
  if actor is null or not public.is_private_profile_owner(actor) then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  insert into public.communities(owner_user_id, name, slug, description, visibility, join_policy)
    values (actor, btrim(p_name), lower(btrim(p_slug)), btrim(p_description), p_visibility, p_join_policy)
    returning id into community;
  insert into public.community_memberships(community_id, user_id, role)
    values (community, actor, 'owner');
  return community;
end;
$$;
revoke all on function public.create_community(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_community(text, text, text, text, text) to authenticated;

-- Exact-link landing projection only: no roster, owner identity, timestamps,
-- or future member content. Base tables cannot enumerate unlisted communities.
-- Private communities deliberately return no metadata to nonmembers.
create function public.get_community_landing(p_slug text)
returns table (
  id uuid, name text, slug text, description text, visibility text, join_policy text, viewer_role text
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.slug, c.description, c.visibility, c.join_policy, m.role
  from public.communities c
  left join public.community_memberships m
    on m.community_id = c.id and m.user_id = auth.uid()
    and public.is_private_profile_owner(auth.uid())
  where c.slug = p_slug
    and (c.visibility in ('public', 'unlisted') or m.user_id is not null);
$$;
revoke all on function public.get_community_landing(text) from public, anon, authenticated;
grant execute on function public.get_community_landing(text) to anon, authenticated;

commit;
