-- Financial crime alert dispositions are recorded as audit entries (append-only, hash-chained).
alter table public.audit_log drop constraint if exists audit_log_type_check;
alter table public.audit_log add constraint audit_log_type_check check (type in (
  'APPLICATION_SUBMITTED', 'KYC_COMPLETED', 'DECISION', 'REVIEW_RESOLVED',
  'OVERRIDE', 'POLICY_PUBLISHED', 'AI_OUTPUT', 'FINCRIME_DISPOSITION', 'DEMO_RESET'));
create index if not exists audit_log_type_idx on public.audit_log (type);
