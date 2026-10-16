-- ANFAC client portal cloud tables.
-- Run this script in Supabase Dashboard -> SQL Editor as the project owner.
-- Create Auth users separately, then link each auth user in public.profiles.

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    role text not null check (role in ('admin', 'client')),
    client_id text unique,
    full_name text not null,
    created_at timestamptz not null default now(),
    constraint profiles_role_client_id_check check (
        (role = 'admin' and client_id is null)
        or (role = 'client' and client_id is not null)
    )
);

create table if not exists public.projects (
    id text primary key,
    client_user_id uuid not null references public.profiles (id) on delete cascade,
    title text not null,
    category text not null default 'Project',
    deadline date,
    status text not null default 'Planning',
    progress integer not null default 0 check (progress between 0 and 100),
    progress_note text not null default '',
    updated_at timestamptz not null default now()
);

create table if not exists public.client_messages (
    id text primary key,
    client_user_id uuid not null references public.profiles (id) on delete cascade,
    sender_user_id uuid not null references public.profiles (id) on delete cascade,
    sender_role text not null check (sender_role in ('admin', 'client')),
    sender_name text not null,
    body text not null check (char_length(body) between 1 and 2000),
    read_by_admin boolean not null default false,
    read_by_client boolean not null default false,
    created_at timestamptz not null default now(),
    constraint client_message_sender_role_check check (
        (sender_role = 'admin' and sender_user_id <> client_user_id)
        or (sender_role = 'client' and sender_user_id = client_user_id)
    )
);

alter table public.client_messages
    add column if not exists read_by_admin boolean not null default false,
    add column if not exists read_by_client boolean not null default false;

create index if not exists projects_client_updated_idx
    on public.projects (client_user_id, updated_at desc);

create index if not exists client_messages_thread_idx
    on public.client_messages (client_user_id, created_at);

create or replace function public.is_anfac_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'
    );
$$;

revoke all on function public.is_anfac_admin() from public, anon;
grant execute on function public.is_anfac_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.client_messages enable row level security;

drop policy if exists "Users read their own profile or admins read all" on public.profiles;
create policy "Users read their own profile or admins read all"
    on public.profiles for select to authenticated
    using (id = (select auth.uid()) or (select public.is_anfac_admin()));

drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Admins manage profiles"
    on public.profiles for all to authenticated
    using ((select public.is_anfac_admin()))
    with check ((select public.is_anfac_admin()));

drop policy if exists "Clients read their projects and admins read all" on public.projects;
create policy "Clients read their projects and admins read all"
    on public.projects for select to authenticated
    using (client_user_id = (select auth.uid()) or (select public.is_anfac_admin()));

drop policy if exists "Admins manage projects" on public.projects;
create policy "Admins manage projects"
    on public.projects for all to authenticated
    using ((select public.is_anfac_admin()))
    with check ((select public.is_anfac_admin()));

drop policy if exists "Clients read their messages and admins read all" on public.client_messages;
create policy "Clients read their messages and admins read all"
    on public.client_messages for select to authenticated
    using (client_user_id = (select auth.uid()) or (select public.is_anfac_admin()));

drop policy if exists "Authenticated users send authorized messages" on public.client_messages;
create policy "Authenticated users send authorized messages"
    on public.client_messages for insert to authenticated
    with check (
        sender_user_id = (select auth.uid())
        and (
            (sender_role = 'admin' and (select public.is_anfac_admin()))
            or (sender_role = 'client' and client_user_id = (select auth.uid()))
        )
    );

drop policy if exists "Admins mark client messages read" on public.client_messages;
create policy "Admins mark client messages read"
    on public.client_messages for update to authenticated
    using ((select public.is_anfac_admin()) and sender_role = 'client')
    with check ((select public.is_anfac_admin()) and sender_role = 'client');

drop policy if exists "Clients mark admin messages read" on public.client_messages;
create policy "Clients mark admin messages read"
    on public.client_messages for update to authenticated
    using (client_user_id = (select auth.uid()) and sender_role = 'admin')
    with check (client_user_id = (select auth.uid()) and sender_role = 'admin');

revoke all on public.profiles, public.projects, public.client_messages from anon, public;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert on public.client_messages to authenticated;
revoke update on public.client_messages from authenticated;
grant update (read_by_admin, read_by_client) on public.client_messages to authenticated;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'projects'
        ) then
            execute 'alter publication supabase_realtime add table public.projects';
        end if;
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'client_messages'
        ) then
            execute 'alter publication supabase_realtime add table public.client_messages';
        end if;
    end if;
end;
$$;
