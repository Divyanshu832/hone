-- Hone storage schema for Supabase (Postgres 15+).
--
-- Design: every table keeps the full record in `doc` (jsonb), exactly as the API returns it, so the app
-- code stays simple. The fields you'd want to query, sort or chart are typed *generated* columns read
-- out of `doc`, so they can never drift from it. Every table belongs to a project and is deleted with it.
--
-- Security: row level security is on for every table with no policies, so only the backend's secret key
-- can read or write. The publishable key sees nothing. Connection credentials (n8n / Retell keys) are
-- never stored here; they stay in the backend's local file.

-- Projects: one agent under test.
create table if not exists hone_projects (
  id          text primary key,
  doc         jsonb not null,
  name        text generated always as (doc->>'name') stored,
  host        text generated always as (doc->>'host') stored,
  budget_usd  numeric generated always as ((doc->>'budgetUsd')::numeric) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Agent snapshots: what the agent looked like when it was tested. A new version is written only when
-- the prompt, model, tools or knowledge sources change (detected by `hash`), with a diff to the previous.
create table if not exists hone_agent_snapshots (
  id              text primary key,
  project_id      text not null references hone_projects(id) on delete cascade,
  doc             jsonb not null,
  version         int  generated always as ((doc->>'version')::int) stored,
  hash            text generated always as (doc->>'hash') stored,
  model           text generated always as (doc->'agent'->>'model') stored,
  change_summary  text generated always as (doc->>'changeSummary') stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, hash)
);
create index if not exists hone_agent_snapshots_project on hone_agent_snapshots (project_id, version desc);

-- Runs: one eval. Linked to the agent snapshot it tested and carrying the rubric it used.
create table if not exists hone_runs (
  id           text primary key,
  project_id   text not null references hone_projects(id) on delete cascade,
  doc          jsonb not null,
  snapshot_id  text generated always as (doc->>'snapshotId') stored references hone_agent_snapshots(id),
  agent_version int generated always as ((doc->>'agentVersion')::int) stored,
  status       text generated always as (doc->>'status') stored,
  split        text generated always as (doc->>'split') stored,
  k            int  generated always as ((doc->>'k')::int) stored,
  scenarios    int  generated always as ((doc->>'scenarios')::int) stored,
  pass_k       numeric generated always as ((doc->>'passK')::numeric) stored,
  pass_1       numeric generated always as ((doc->>'pass1')::numeric) stored,
  cost_usd     numeric generated always as ((doc->>'costUsd')::numeric) stored,
  budget_usd   numeric generated always as ((doc->>'budgetUsd')::numeric) stored,
  trusted      boolean generated always as ((doc->>'trusted')::boolean) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists hone_runs_project on hone_runs (project_id, created_at desc);

-- One scenario in a run, with every trial's transcript and per-criterion results.
create table if not exists hone_run_items (
  id          text primary key,                       -- "<run id>:<scenario id>"
  project_id  text not null references hone_projects(id) on delete cascade,
  doc         jsonb not null,
  run_id      text generated always as (split_part(id, ':', 1)) stored references hone_runs(id) on delete cascade,
  scenario    text generated always as (doc->'item'->>'scenario') stored,
  triage      text generated always as (doc->'item'->>'triage') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists hone_run_items_run on hone_run_items (run_id);

-- Recommended changes from a run, and what happened to them: applied in a later agent version or not,
-- and whether the criteria they targeted got better.
create table if not exists hone_recommendations (
  id                   text primary key,
  project_id           text not null references hone_projects(id) on delete cascade,
  doc                  jsonb not null,
  run_id               text generated always as (doc->>'runId') stored references hone_runs(id) on delete cascade,
  title                text generated always as (doc->>'title') stored,
  status               text generated always as (doc->>'status') stored,   -- open | applied | dismissed
  outcome              text generated always as (doc->>'outcome') stored,  -- improved | no_change | worse | null
  applied_in_snapshot  text generated always as (doc->>'appliedInSnapshot') stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists hone_recommendations_project on hone_recommendations (project_id, created_at desc);

-- Rubric (the current criteria list for a project; each run keeps its own copy).
create table if not exists hone_criteria (
  id          text primary key,                       -- project id
  project_id  text not null references hone_projects(id) on delete cascade,
  doc         jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Human labels used to calibrate judges.
create table if not exists hone_labels (
  id            text primary key,                     -- "<run>:<item>:<trial>:<criterion>"
  project_id    text not null references hone_projects(id) on delete cascade,
  doc           jsonb not null,
  criterion_id  text generated always as (doc->>'criterionId') stored,
  value         boolean generated always as ((doc->>'value')::boolean) stored,
  judge         boolean generated always as ((doc->>'judge')::boolean) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists hone_labels_project on hone_labels (project_id, criterion_id);

-- Inputs: knowledge base chunks, the scenario dataset (redacted), the parsed agent, gate settings.
create table if not exists hone_knowledge (
  id text primary key, project_id text not null references hone_projects(id) on delete cascade,
  doc jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists hone_datasets (
  id text primary key, project_id text not null references hone_projects(id) on delete cascade,
  doc jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists hone_agents (
  id text primary key, project_id text not null references hone_projects(id) on delete cascade,
  doc jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists hone_gates (
  id text primary key, project_id text not null references hone_projects(id) on delete cascade,
  doc jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Keep updated_at honest.
create or replace function hone_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['hone_projects','hone_agent_snapshots','hone_runs','hone_run_items','hone_recommendations',
                           'hone_criteria','hone_labels','hone_knowledge','hone_datasets','hone_agents','hone_gates']
  loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function hone_touch()', t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Handy view: one row per run with its agent version and what changed in that version.
create or replace view hone_run_history with (security_invoker = true) as
select r.project_id, r.id as run_id, r.created_at, r.status, r.split, r.k, r.scenarios,
       r.pass_k, r.pass_1, r.cost_usd, r.trusted,
       s.version as agent_version, s.change_summary
from hone_runs r
left join hone_agent_snapshots s on s.id = r.snapshot_id;

-- ---------------- Accounts ----------------
-- Sign-in is Supabase Auth (email + password). A profile belongs to at most one organization; an
-- organization has owners (can invite and remove people) and members. Invites are links with a random
-- token, shared by hand (no email is sent). Projects belong to an organization through doc->>'workspace'.
create table if not exists hone_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists hone_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  org_id uuid references hone_orgs(id) on delete set null,
  role text check (role in ('owner', 'member')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((org_id is null) = (role is null))
);
create index if not exists hone_profiles_org on hone_profiles(org_id);

create table if not exists hone_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  org_id uuid not null references hone_orgs(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index if not exists hone_invites_org on hone_invites(org_id);

alter table hone_projects add column if not exists workspace text generated always as (doc->>'workspace') stored;
create index if not exists hone_projects_workspace on hone_projects(workspace);

do $$
declare t text;
begin
  foreach t in array array['hone_orgs', 'hone_profiles'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function hone_touch()', t, t);
  end loop;
  foreach t in array array['hone_orgs', 'hone_profiles', 'hone_invites'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------- Who can see a project ----------------
-- Every project has an owner (the person who made it) and an organization. visibility 'private': only
-- the owner sees it. 'org': everyone in that organization does. People in other organizations never do.
-- Deleting the organization or the owner's account deletes the project and, by cascade, all its runs,
-- versions, recommendations, labels and settings.
alter table hone_projects add column if not exists owner_id uuid
  generated always as ((doc->>'ownerId')::uuid) stored references auth.users(id) on delete cascade;
alter table hone_projects add column if not exists org_id uuid
  generated always as ((doc->>'orgId')::uuid) stored references hone_orgs(id) on delete cascade;
alter table hone_projects add column if not exists visibility text
  generated always as (coalesce(doc->>'visibility', 'private')) stored check (visibility in ('private', 'org'));
create index if not exists hone_projects_owner on hone_projects(owner_id);
create index if not exists hone_projects_org on hone_projects(org_id);

-- ---------------- Keys ----------------
-- Connection details per project (n8n / Retell API keys, endpoints) and model keys per organization
-- (OpenRouter, TypeSafe). RLS on with no policies: only the server's secret key reads or writes them.
create table if not exists hone_secrets (
  id text primary key, project_id text not null references hone_projects(id) on delete cascade,
  doc jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists hone_org_keys (
  org_id uuid primary key references hone_orgs(id) on delete cascade,
  openrouter text, typesafe text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['hone_secrets', 'hone_org_keys'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function hone_touch()', t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
