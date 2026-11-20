-- nullroute admin: sign-in (Admission's tables, see UPSTREAM.md), contact
-- messages, and grants. Everything lives in its own schema, and the migration
-- runner revokes Supabase's API roles from it: nothing here is for anon.

create schema if not exists nullroute;

-- Sign-in. Only an HMAC of (email, code) is stored, so a dump yields no usable
-- code; only a SHA-256 of a session token, so it yields no usable cookie.
create table nullroute.auth_codes (
  email_key  text        not null,
  asker      text        not null,
  mac        text        not null,
  expires_at timestamptz not null,
  tries      integer     not null default 0,
  primary key (email_key, asker)
);

create table nullroute.rate_limits (
  bucket   text        primary key,
  count    integer     not null,
  reset_at timestamptz not null
);

create table nullroute.sessions (
  id         text        primary key,
  token_hash text        not null unique,
  email      text        not null,
  created_at timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  idle_until timestamptz not null,
  ends_at    timestamptz not null,
  user_agent text,
  ip_prefix  text
);
create index sessions_email on nullroute.sessions (email);

create table nullroute.audit_log (
  id     bigserial   primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text        not null,
  detail jsonb
);
create index audit_log_at on nullroute.audit_log (at desc);

-- The public contact form. Stored before it is mailed, so a message survives a
-- mail outage; `mailed` says whether the notification went out.
create table nullroute.messages (
  id          text        primary key,
  received_at timestamptz not null default now(),
  name        text        not null,
  email       text        not null,
  topic       text        not null,
  body        text        not null,
  ip_prefix   text,
  status      text        not null default 'new'
              check (status in ('new', 'read', 'archived')),
  mailed      boolean     not null default false
);
create index messages_received on nullroute.messages (received_at desc);

-- Grants: one row per application, with its milestones, references,
-- documents and checklist.
create table nullroute.grants (
  id              text        primary key,
  funder          text        not null,
  program         text        not null,
  title           text        not null,
  status          text        not null default 'drafting'
                  check (status in ('idea', 'drafting', 'submitted', 'under_review',
                                    'awarded', 'declined', 'withdrawn', 'completed')),
  window_opens    date,
  window_closes   date,
  submitted_on    date,
  decided_on      date,
  amount_usd      integer     check (amount_usd is null or amount_usd >= 0),
  duration_months integer     check (duration_months is null or duration_months > 0),
  commitment      text        not null default '',
  url             text        not null default '',
  summary         text        not null default '',
  notes           text        not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table nullroute.grant_milestones (
  id           text        primary key,
  grant_id     text        not null references nullroute.grants (id) on delete cascade,
  position     integer     not null default 0,
  label        text        not null default '',
  title        text        not null,
  done_when    text        not null default '',
  status       text        not null default 'planned'
               check (status in ('planned', 'in_progress', 'done', 'dropped')),
  due_on       date,
  evidence_url text        not null default '',
  updated_at   timestamptz not null default now()
);
create index grant_milestones_grant on nullroute.grant_milestones (grant_id, position);

create table nullroute.grant_references (
  id         text        primary key,
  grant_id   text        not null references nullroute.grants (id) on delete cascade,
  name       text        not null,
  contact    text        not null default '',
  relation   text        not null default '',
  status     text        not null default 'to_ask'
             check (status in ('to_ask', 'asked', 'agreed', 'sent', 'received', 'declined')),
  notes      text        not null default '',
  updated_at timestamptz not null default now()
);
create index grant_references_grant on nullroute.grant_references (grant_id);

create table nullroute.grant_documents (
  id         text        primary key,
  grant_id   text        not null references nullroute.grants (id) on delete cascade,
  title      text        not null,
  kind       text        not null default 'draft'
             check (kind in ('draft', 'research', 'memo', 'summary', 'letter', 'report', 'other')),
  body       text        not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);
create index grant_documents_grant on nullroute.grant_documents (grant_id);

create table nullroute.grant_tasks (
  id       text    primary key,
  grant_id text    not null references nullroute.grants (id) on delete cascade,
  position integer not null default 0,
  title    text    not null,
  detail   text    not null default '',
  done     boolean not null default false
);
create index grant_tasks_grant on nullroute.grant_tasks (grant_id, position);
