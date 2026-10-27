# ANFAC Media System

The web dashboard uses Express, Vercel Functions, and Neon Postgres for shared
data. The browser assets are in `public/`.

## Local development

1. Install dependencies with `npm ci`.
2. Set `DATABASE_URL` to a Neon Postgres connection string. Keep credentials in
   an ignored `.env.local` file; never commit environment secrets.
3. Start the server with `npm start`. Set `PORT` first if another port is needed.

The deployment database must contain a provisioned administrator account.
The application does not create a default-password administrator.

## Client portal

Client accounts are created by an administrator in **Clients & Media
Partners**, where each login is linked directly to an existing client profile.
Administrators share the username and temporary password with the client
securely. Clients use **Client? Sign in to your portal** on the sign-in screen
to access their linked projects, campaigns, and bookings; request bookings or
services; chat with their account team; and update their account settings.
Administrators can reply to client conversations in **Clients & Media
Partners**. Conversations are stored with the linked client profile and refresh
automatically while each side is signed in. Administrators can add campaign
artwork when creating or editing a campaign; non-completed campaigns with
artwork appear in that client's rotating home slider. Clients must enter their
current password to save profile changes. The portal does not expose billing
or payment records.

## Deploying

Link the repository to the Vercel project and configure `DATABASE_URL` for its
Preview and Production environments. Use `vercel` for a Preview deployment and
`vercel --prod` only when intentionally releasing to Production.
