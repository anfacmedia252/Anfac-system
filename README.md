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

## Deploying

Link the repository to the Vercel project and configure `DATABASE_URL` for its
Preview and Production environments. Use `vercel` for a Preview deployment and
`vercel --prod` only when intentionally releasing to Production.
