# IONSTORM account setup

Account sync is optional. The game remains playable as a guest and keeps local
progression when the cloud link is unavailable.

## 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com). In the Supabase
dashboard, open **SQL Editor**, paste the contents of
[`supabase/schema.sql`](../supabase/schema.sql), and run it once.

The schema creates:

- `profiles` for a callsign linked to `auth.users`
- `pilot_saves` for the versioned progression snapshot
- `runs` for the authenticated pilot's individual run archive

Every table has RLS enabled and policies that restrict rows to
`(select auth.uid())`. The browser never receives a service-role credential.

## 2. Configure the browser client

Copy the project URL and the publishable/anon key from **Project Settings →
API**, then edit `src/account-config.js`:

```js
window.IONSTORM_SUPABASE_CONFIG = Object.freeze({
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR-PUBLISHABLE-OR-ANON-KEY'
});
```

The publishable/anon key is intended for browser use. Never use a
`service_role`, `sb_secret`, or other secret key in this file.

## 3. Enable authentication

In **Authentication → Providers**:

1. Keep Email enabled for email/password accounts.
2. Enable Google if Google sign-in is desired and enter the Google OAuth web
   client credentials.
3. In **Authentication → URL Configuration**, set the site URL and add the
   exact redirect URLs used by the game, for example:

   - `http://localhost:4173/`
   - `https://ionstorm.vercel.app/`

The Google provider redirect URI shown by Supabase must also be registered in
the Google Cloud OAuth client. OAuth redirects must match the allow list.

## 4. Run and verify locally

From the repository root:

```bash
npm ci
npm run check
npm run serve
```

Open `http://localhost:4173/`, choose **SYNC PILOT**, and create a test
account. Existing local progression is merged into the first cloud save. The
merge keeps the highest score, upgrade levels, scrap, achievements, daily
bests, and top records; settings stay device-local.

If the Supabase CDN or project is unavailable, the account panel reports the
problem and **PLAY AS GUEST** remains available. A future server-validated
leaderboard should not trust a client-submitted score; the `runs` table is an
authenticated archive, not anti-cheat validation.
