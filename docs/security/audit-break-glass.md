# Audit tables: break-glass repair

Applies to `cell_admin_audit`, `member_cell_audit` and `communication_audit` after migration 076.

## Why this exists

These tables are the record of who changed cells and who sent messages. Migration 076 removes UPDATE and DELETE from
the backend key (`service_role`) and refuses UPDATE and DELETE in a trigger for every role, including the table owner.
A correction is still sometimes needed, for example when a wrong cell was written by a bug. The repair path is
deliberate, rare, and recorded.

## Who may run it

Only the database owner (`postgres`), through the Supabase SQL editor or a direct owner connection. No API role can
run it. Two people should agree before it starts: the requester and the approver, each named in the record.

## Procedure

1. **Record the intent first.** Insert a row that says what is being repaired and why. Do this in its own transaction.
   The record goes into `cell_admin_audit` as an `action = 'repair_intent'` row, with the reason in `after_values`.
2. **Run the repair in one transaction.** `ALTER TABLE ... DISABLE TRIGGER` is transactional in PostgreSQL. Do not
   leave a session with the trigger disabled.
3. **Re-arm the trigger in the same transaction.**
4. **Commit, then verify** that the trigger is enabled (`tgenabled = 'O'`) and the repaired value is what you expect.

Template (replace the placeholders; the whole block runs as one transaction):

```sql
begin;
insert into public.cell_admin_audit (action, cell_id, actor_id, changed_at, after_values)
values ('repair_intent', '<cell uuid>', '<requester uuid>', now(),
        jsonb_build_object('reason', '<why>', 'approved_by', '<approver>', 'target_table', 'cell_admin_audit', 'target_id', <id>));
alter table public.cell_admin_audit disable trigger cell_admin_audit_append_only;
update public.cell_admin_audit set after_values = '<corrected json>' where id = <id>;
alter table public.cell_admin_audit enable trigger cell_admin_audit_append_only;
commit;
```

Then check:

```sql
select tgname, tgenabled from pg_trigger where tgname = 'cell_admin_audit_append_only';   -- tgenabled must be 'O'
```

Use the matching trigger name for `member_cell_audit` (`member_cell_audit_append_only`) or `communication_audit`
(`communication_audit_append_only`).

## Rules

- Never delete an audit row to fix it. Correct it with a new row that records the correction, or use the procedure above
  for an exceptional case that has been approved.
- Never leave a trigger disabled. If the transaction fails, it rolls back and the trigger stays armed.
- Keep the `repair_intent` row even if the repair fails. Its absence is the signal that someone changed the table.
- Every repair is a dated, named entry in the security log. Review the log monthly for `repair_intent` rows with no
  matching correction.

## What this process does not cover

Dropping or altering the trigger, or revoking the owner's rights, is a migration, not a repair. It needs a reviewed
migration.
