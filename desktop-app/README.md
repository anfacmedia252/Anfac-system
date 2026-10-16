# ANFAC Media System Desktop

This folder contains the Electron desktop app, its web UI, and Windows icon.

## Run locally

```powershell
npm ci
npm start
```

## Build the Windows installer

```powershell
npm ci
npm run build:win
```

## Client project progress

As an administrator, open **Projects & Events**, create a project or edit an
existing one, and set the **Client Name** to exactly match the client's profile.
Update the status, client-visible progress percentage, and progress note, then
save. The client sees the matching project and updates under **My Projects &
Messages**. The progress slider and percentage field stay synchronized.

The client portal also includes an animated ANFAC Media service-poster slider.
Legacy username/password accounts and their data remain local to each
installation. Use Supabase Auth accounts for cloud-synced projects and chat.

## Preparing secure cloud sync

The source repository includes [`../supabase/setup.sql`](../supabase/setup.sql)
for project progress and client chat tables protected by Supabase Row Level
Security. Run or rerun it in the Supabase Dashboard's SQL Editor when schema
changes are made.

The app signs in with Supabase Auth when a user enters their cloud account's
email and password. An administrator account and a Supabase Auth account for
each client must exist first. Create each Auth account under **Authentication →
Users**, then use the SQL Editor to link its Auth UID in `public.profiles`.
Create the administrator profile with role `admin` and a `NULL` client ID.
Create each client profile with role `client`, its exact existing client
profile name as `client_id`, and the same name as `full_name`. Match the
project's **Client Name** to this `client_id`; use the existing Projects &
Events editor to publish its title, status, progress, deadline, and update.
Clients sign in with their Supabase Auth email/password.
New messages sent by signed-in cloud users sync between devices. Existing
local-only chat history is not automatically imported into Supabase.

After creating each Auth user, copy that user's **UID** from the Users screen
and run the matching statement in the SQL Editor (replace the example values):

```sql
insert into public.profiles (id, role, client_id, full_name)
values ('AUTH-USER-UID', 'admin', null, 'ANFAC Media Administrator')
on conflict (id) do update
set role = excluded.role, client_id = excluded.client_id, full_name = excluded.full_name;

insert into public.profiles (id, role, client_id, full_name)
values ('CLIENT-AUTH-USER-UID', 'client', 'Exact Client Name', 'Exact Client Name')
on conflict (id) do update
set role = excluded.role, client_id = excluded.client_id, full_name = excluded.full_name;
```

Only administrators can write projects and create Auth profiles through the
dashboard; clients can read only their own projects and messages. The
`sb_publishable_` key is public client configuration, not a password. Never
put a Supabase service-role key in the app or GitHub.
