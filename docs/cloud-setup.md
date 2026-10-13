# Decisive cloud accounts (Supabase) — setup runbook

Free, roughly 15 minutes. Google is the primary sign-in. Until this is done the
app keeps working in local mode exactly as before.

## 1. Create the Supabase project

1. Sign up at https://supabase.com (free plan).
2. Create a project (any name, closest region).
3. Project Settings -> API: copy the **Project URL** and the **anon public** key.

## 2. Create the table and security policy

1. Supabase dashboard -> SQL Editor -> New query.
2. Paste the contents of `docs/cloud-schema.sql` and run it.

This creates one `tasks` table and one Row Level Security policy: every row is
owned by the signed-in user, so accounts can never read each other's tasks.

## 3. Turn on Google sign-in

1. Google Cloud console (https://console.cloud.google.com) -> APIs & Services
   -> Credentials -> Create credentials -> OAuth client ID -> Web application.
2. Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client Secret.
4. Supabase dashboard -> Authentication -> Providers -> Google: enable, paste
   the Client ID and Secret, save.
5. Supabase dashboard -> Authentication -> URL Configuration:
   - Site URL: your app URL (e.g. `https://decisive-three.vercel.app`)
   - Redirect URLs (add all you use):
     - `https://decisive-three.vercel.app/**`
     - `http://localhost:4322/**` (local preview)
     - `http://127.0.0.1:4321/**` (packaged macOS app, optional)

## 4. Point the app at the project

Edit `cloud-config.js` and fill in the two values:

```js
window.DECISIVE_CLOUD = {
  url: 'https://<your-project>.supabase.co',
  anonKey: '<your-anon-public-key>',
};
```

Both values are safe to commit: the anon key is the browser-side public key and
your data is protected by the database policy, not by secrecy.

## 5. Deploy and test

1. Commit and push. Vercel serves the updated files (no build step).
2. Open the app, click the gear (settings), use **Sign in with Google**.
3. You should land back signed in, and the board reads and writes your account.
4. Sign out to return to local mode.

## Good to know

- Free tier: 500 MB database, 50,000 users, unlimited API requests. Plenty.
- Free projects pause after ~7 days without activity; data is kept and one
  dashboard click resumes them. A weekly ping (Hermes cron) keeps it awake.
- Free tier has no automatic backups; the local app already writes dated
  snapshots, and you can add a weekly export at any time.
- Vercel's free plan is non-commercial. If Decisive becomes a paid product,
  move the frontend to Cloudflare Pages (free, commercial-friendly): create a
  Pages project from this repo, leave the build command empty, set the output
  directory to the repo root, and point your domain at it. The app and the
  Supabase config need no changes.
- The `decisive` CLI and local agents keep working against the local app; they
  do not touch cloud accounts.
