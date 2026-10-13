// Decisive cloud config — fill these two values to turn on online accounts.
//
// Both values are SAFE TO COMMIT: the anon key is the browser-side public key,
// and your data is protected by Supabase Row Level Security, not by secrecy.
//
// 1. Create a free project at https://supabase.com
// 2. Project Settings -> API -> copy "Project URL" and "anon public" key here.
// 3. Run docs/cloud-schema.sql in the SQL editor.
// 4. Enable the Google provider under Authentication -> Providers (see
//    docs/cloud-setup.md for the full walkthrough).
window.DECISIVE_CLOUD = {
  url: '',
  anonKey: '',
};
