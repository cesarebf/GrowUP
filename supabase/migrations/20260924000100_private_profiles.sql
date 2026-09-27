-- Account-private data only. Future public and community-facing profiles must
-- use separate tables/policies; never broaden this table's SELECT policy.
begin;

create table public.private_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  constraint private_profiles_display_name_length check (
    display_name is null or (
      char_length(display_name) between 1 and 80
      and display_name = btrim(display_name)
      and display_name !~ '[[:cntrl:]]'
    )
  )
);

alter table public.private_profiles enable row level security;
alter table public.private_profiles force row level security;
revoke all on public.private_profiles from public, anon, authenticated;
grant select on public.private_profiles to authenticated;
grant update (display_name) on public.private_profiles to authenticated;

-- auth.users is not exposed to API callers. This narrow helper checks the
-- current identity, confirmation, and ban state without exposing account data.
create function public.is_private_profile_owner(profile_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select profile_user_id = (select auth.uid()) and exists (
    select 1 from auth.users
    where id = profile_user_id
      and email_confirmed_at is not null
      and not coalesce(is_anonymous, false)
      and deleted_at is null
      and (banned_until is null or banned_until <= now())
  );
$$;
revoke all on function public.is_private_profile_owner(uuid) from public, anon, authenticated;
grant execute on function public.is_private_profile_owner(uuid) to authenticated;

create policy private_profiles_select_own
on public.private_profiles for select to authenticated
using (public.is_private_profile_owner(user_id));

create policy private_profiles_update_own
on public.private_profiles for update to authenticated
using (public.is_private_profile_owner(user_id))
with check (public.is_private_profile_owner(user_id));

-- Trust only the Auth primary key. Never copy user-supplied identity/role
-- metadata or provider profile fields into account data automatically.
create function public.create_private_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null then
    insert into public.private_profiles (user_id) values (new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.create_private_profile() from public, anon, authenticated;

create trigger on_auth_user_created_private_profile
after insert on auth.users
for each row execute function public.create_private_profile();

-- Supabase also supports soft deletion. Remove account-private data when Auth
-- marks the user deleted; a hard deletion is covered by the foreign key cascade.
create function public.delete_private_profile()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.private_profiles where user_id = new.id;
  return new;
end;
$$;
revoke all on function public.delete_private_profile() from public, anon, authenticated;

create trigger on_auth_user_deleted_private_profile
after update of deleted_at on auth.users
for each row when (new.deleted_at is not null)
execute function public.delete_private_profile();

-- Cover pre-existing Auth users when applying this migration to a project.
insert into public.private_profiles (user_id)
select id from auth.users where deleted_at is null
on conflict (user_id) do nothing;

commit;
