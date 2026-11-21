# nullroute.diy/admin

The maintainer's console: grant applications with their milestones, references,
checklists and documents; the inbox the contact form on nullroute.diy delivers
to; and the project's state read live from GitHub, the site and DNS.

## Not the device, and not the website

This is a networked server holding a database password and a mail key. It has
its own `package-lock.json` and is not one of the root workspaces, so nothing it
installs enters `MANIFEST.lock` or moves the hash a user compares before
entering a PIN. Lint forbids it from importing device code
(`nullroute/no-cross-tier-import`), the same line the website is held to.

## Where it is served

At nullroute.diy/admin. This project builds with the base path `/admin`
(`src/base-path.ts`), and the site's deploy passes every request under
`/admin` through to it (`ADMIN_PATH` and `ADMIN_UPSTREAM` in
`tools/lib/site-headers.mjs`), leaving the site's own headers off those
responses so the console's nonce policy is the only one. There is no
subdomain and no DNS record of its own.

Sharing the site's origin means the console trusts what runs on the site's
pages: the site's own hashed inline scripts and the owner's visit counter
script. The session cookie is `HttpOnly`, so no script reads it, but a script
on a nullroute.diy page could send requests to `/admin` that carry it.

## How sign-in works

1. Only addresses in `OWNER_EMAILS` get a code. Anyone else gets the same
   answer, after the same 1.2 seconds, and no email.
2. The code is six digits, lives ten minutes, allows five tries, and is stored
   only as an HMAC under `CODE_SECRET`, bound to the browser that asked.
3. A session is a random token in a `__Host-` cookie. The database keeps its
   SHA-256, so a copy of the sessions table signs nobody in. Sessions end after
   seven idle days or thirty in total, and when the address leaves
   `OWNER_EMAILS`.
4. Every page carries a nonce Content-Security-Policy and cannot be framed.
   The audit log under Access records every sign-in, change and contact.

The flow is the maintainer's existing pattern: see [UPSTREAM.md](UPSTREAM.md).

## The contact form

nullroute.diy is a static site, so its contact page posts to
`/admin/api/contact`, on its own origin, which reaches this console. Only origins in `SITE_ORIGINS` may, as JSON, at most 16 KB.
A hidden field and a minimum time on the page catch simple bots, which get the
same reply as people. Messages are limited per network and per day, stored
first, then mailed to `CONTACT_TO` with the sender as reply-to. If the mail
fails, the message is still in the inbox, marked "Not mailed".

## The database

Postgres on Supabase, schema `nullroute`, reached through the transaction
pooler. The connection checks the server's certificate against Supabase's root,
pinned in `src/server/supabase-ca.ts`, rather than accepting any certificate.
The migration script revokes Supabase's API roles (`anon`, `authenticated`)
from the schema, so its public API keys cannot read a row of it. The database
password and Supabase's own dashboard still can.

```bash
npm run migrate   # apply db/migrations, from apps/admin
```

## Commands

From the repository root:

```bash
make admin-check        # types and unit tests
make admin-deploy       # local production build, deploy, then admin-live-check
make admin-live-check   # what a stranger sees: redirects, 401s, CSP, CORS
```

Locally, `cd apps/admin && npm run dev` serves it at http://localhost:3471/admin. Settings live
in `apps/admin/.env` (never committed); `MAIL_DIR` set there writes mail to
files instead of sending it. Production settings live in the Vercel project
`nullroute-admin`.
