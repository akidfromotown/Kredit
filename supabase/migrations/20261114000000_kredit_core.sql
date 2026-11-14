-- Kredit core schema: policies, businesses, decisions and an append-only, hash-chained audit log.
-- Reads are public (demo data is synthetic). All writes go through security-definer functions that only
-- the service role (used by the kredit-api Edge Function and the seed script) may execute.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table public.policies (
  version       text primary key,
  published_at  timestamptz not null,
  published_by  text not null,
  note          text not null,
  body          jsonb not null
);

create table public.businesses (
  id          text primary key,
  source      text not null check (source in ('synthetic', 'onboarded')),
  name        text not null,
  applied_on  date not null,
  body        jsonb not null,
  created_at  timestamptz not null default now()
);

create table public.decisions (
  id              text primary key,
  business_id     text not null unique references public.businesses (id),
  policy_version  text not null references public.policies (version),
  engine_outcome  text not null check (engine_outcome in ('APPROVE', 'DECLINE', 'REVIEW')),
  decided_at      timestamptz not null,
  body            jsonb not null,
  human           jsonb,
  human_at        timestamptz,
  constraint decline_has_reasons check (
    engine_outcome <> 'DECLINE' or jsonb_array_length(body -> 'reasons') > 0
  ),
  constraint human_decline_has_reasons check (
    human is null or human ->> 'action' <> 'DECLINE' or jsonb_array_length(human -> 'reasons') > 0
  )
);

create table public.audit_log (
  seq         bigint generated always as identity primary key,
  at          timestamptz not null,
  actor       text not null,
  actor_type  text not null check (actor_type in ('system', 'human', 'ai')),
  type        text not null check (type in (
                'APPLICATION_SUBMITTED', 'KYC_COMPLETED', 'DECISION', 'REVIEW_RESOLVED',
                'OVERRIDE', 'POLICY_PUBLISHED', 'AI_OUTPUT', 'DEMO_RESET')),
  ref         text not null,
  summary     text not null,
  payload     jsonb not null,
  prev_hash   text not null,
  hash        text not null
);

create index decisions_policy_version_idx on public.decisions (policy_version);
create index audit_log_ref_idx on public.audit_log (ref);

-- ---------------------------------------------------------------- audit hash chain

create or replace function public.kredit_audit_hash(
  p_prev text, p_seq bigint, p_at timestamptz, p_actor text, p_actor_type text,
  p_type text, p_ref text, p_summary text, p_payload jsonb
) returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(
    concat_ws('|', p_prev, p_seq::text, (extract(epoch from p_at) * 1000)::bigint::text,
              p_actor, p_actor_type, p_type, p_ref, p_summary, p_payload::text),
    'sha256'), 'hex');
$$;

create or replace function public.kredit_audit_chain() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prev text;
begin
  -- serialise appends so the chain has exactly one tail
  perform pg_advisory_xact_lock(hashtext('kredit.audit_log'));
  select hash into v_prev from public.audit_log order by seq desc limit 1;
  new.prev_hash := coalesce(v_prev, repeat('0', 64));
  new.hash := public.kredit_audit_hash(new.prev_hash, new.seq, new.at, new.actor, new.actor_type,
                                       new.type, new.ref, new.summary, new.payload);
  return new;
end;
$$;

create trigger audit_log_chain before insert on public.audit_log
  for each row execute function public.kredit_audit_chain();

create or replace function public.kredit_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('kredit.allow_reset', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'audit_log is append-only (% blocked)', tg_op using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.kredit_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.kredit_append_only();

-- Decisions are immutable except for one human action (review or override), recorded once.
create or replace function public.kredit_decision_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('kredit.allow_reset', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'decisions cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  if old.human is not null then
    raise exception 'decision % already has a human action', old.id using errcode = 'unique_violation';
  end if;
  if (new.id, new.business_id, new.policy_version, new.engine_outcome, new.decided_at, new.body)
     is distinct from (old.id, old.business_id, old.policy_version, old.engine_outcome, old.decided_at, old.body) then
    raise exception 'decision % engine fields are immutable', old.id using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger decisions_guard before update or delete on public.decisions
  for each row execute function public.kredit_decision_guard();

-- ---------------------------------------------------------------- write functions (service role only)

create or replace function public.kredit_append_audit(p_entries jsonb) returns setof public.audit_log
language plpgsql security definer
set search_path = ''
as $$
declare
  e jsonb;
begin
  for e in select value from jsonb_array_elements(p_entries) with ordinality order by ordinality loop
    return query
      insert into public.audit_log (at, actor, actor_type, type, ref, summary, payload, prev_hash, hash)
      values ((e ->> 'at')::timestamptz, e ->> 'actor', e ->> 'actorType', e ->> 'type', e ->> 'ref',
              e ->> 'summary', coalesce(e -> 'payload', '{}'::jsonb), '', '')
      returning *;
  end loop;
end;
$$;

create or replace function public.kredit_record_application(p_business jsonb, p_decision jsonb, p_audit jsonb)
returns setof public.audit_log
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.businesses (id, source, name, applied_on, body)
  values (p_business ->> 'id', p_business ->> 'source', p_business ->> 'name',
          (p_business -> 'application' ->> 'appliedOn')::date, p_business);
  insert into public.decisions (id, business_id, policy_version, engine_outcome, decided_at, body, human, human_at)
  values (p_decision ->> 'id', p_decision ->> 'businessId', p_decision ->> 'policyVersion',
          p_decision ->> 'engineOutcome', (p_decision ->> 'decidedAt')::timestamptz,
          p_decision - 'human', p_decision -> 'human', (p_decision -> 'human' ->> 'at')::timestamptz);
  return query select * from public.kredit_append_audit(p_audit);
end;
$$;

create or replace function public.kredit_record_human(p_decision_id text, p_human jsonb, p_audit jsonb)
returns setof public.audit_log
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.decisions set human = p_human, human_at = (p_human ->> 'at')::timestamptz
  where id = p_decision_id;
  if not found then
    raise exception 'decision % not found', p_decision_id using errcode = 'no_data_found';
  end if;
  return query select * from public.kredit_append_audit(p_audit);
end;
$$;

create or replace function public.kredit_publish_policy(p_policy jsonb, p_audit jsonb)
returns setof public.audit_log
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.policies (version, published_at, published_by, note, body)
  values (p_policy ->> 'version', (p_policy ->> 'publishedAt')::timestamptz, p_policy ->> 'publishedBy',
          p_policy ->> 'note', p_policy);
  return query select * from public.kredit_append_audit(p_audit);
end;
$$;

-- Wipes the demo so the seed script can rebuild it. Service role only; the reset is itself not logged
-- because the log is being emptied. Never expose this in a production system.
create or replace function public.kredit_admin_reset() returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform set_config('kredit.allow_reset', 'on', true);
  truncate public.audit_log restart identity;
  delete from public.decisions;
  delete from public.businesses;
  delete from public.policies;
  perform set_config('kredit.allow_reset', 'off', true);
end;
$$;

-- ---------------------------------------------------------------- read helpers (public)

create or replace function public.kredit_verify_audit() returns table (ok boolean, entries bigint, broken_at bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  r public.audit_log;
  v_prev text := repeat('0', 64);
  n bigint := 0;
begin
  for r in select * from public.audit_log order by seq loop
    n := n + 1;
    if r.prev_hash <> v_prev or r.hash <> public.kredit_audit_hash(r.prev_hash, r.seq, r.at, r.actor,
         r.actor_type, r.type, r.ref, r.summary, r.payload) then
      return query select false, n, r.seq;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, n, null::bigint;
end;
$$;

-- ---------------------------------------------------------------- access

alter table public.policies enable row level security;
alter table public.businesses enable row level security;
alter table public.decisions enable row level security;
alter table public.audit_log enable row level security;

create policy "demo data is readable" on public.policies for select to anon, authenticated using (true);
create policy "demo data is readable" on public.businesses for select to anon, authenticated using (true);
create policy "demo data is readable" on public.decisions for select to anon, authenticated using (true);
create policy "demo data is readable" on public.audit_log for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.policies, public.businesses, public.decisions, public.audit_log
  from anon, authenticated;

revoke execute on function public.kredit_append_audit(jsonb) from public, anon, authenticated;
revoke execute on function public.kredit_record_application(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.kredit_record_human(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.kredit_publish_policy(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.kredit_admin_reset() from public, anon, authenticated;
grant execute on function public.kredit_append_audit(jsonb) to service_role;
grant execute on function public.kredit_record_application(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.kredit_record_human(text, jsonb, jsonb) to service_role;
grant execute on function public.kredit_publish_policy(jsonb, jsonb) to service_role;
grant execute on function public.kredit_admin_reset() to service_role;
grant execute on function public.kredit_verify_audit() to anon, authenticated, service_role;
