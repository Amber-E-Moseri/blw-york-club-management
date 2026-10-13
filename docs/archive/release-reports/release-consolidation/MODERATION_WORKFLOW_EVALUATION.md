# Restricted moderation workflow for inactive and rejected authors' prayers: evaluation

**Status: evaluation only. Nothing is implemented, and no permission has changed.**

## 1. The problem

Under D2 and migration 047, prayers from inactive or rejected authors are hidden from ordinary members and from the leadership feed. Coordinators and admins can read only prayers they are allowed to read (active authors, see 047). So:

- an administrator cannot review a prayer from a deactivated author, even to remove it;
- the stored prayers stay in the table, still referencing the author;
- `prayers_coordinator_manage` (UPDATE) cannot act on those rows, because an UPDATE needs the row to be visible through SELECT.

Live check, on the final replay: an active coordinator's update of a prayer by an inactive author returns 0 rows (matrix H15). The current behaviour is deliberate. This document evaluates whether a restricted path is needed and, if so, what it should look like.

## 2. Options

| Option | What it does | Exposure | Changes | Verdict |
|---|---|---|---|---|
| **A. Leave as is** | Hidden prayers stay hidden. No one can act on them. | None added | None | Acceptable for release. The data stays hidden from everyone who should not see it. |
| **B. Restricted moderation RPC** | A security-definer function for active admins and coordinators. It returns metadata only (id, created_at, visibility, author active or not, author id). It can deactivate a prayer (`is_active = false`) and writes an audit row. It never returns the prayer text. | Metadata only, to staff | New function, new audit table, new grants | Viable. Needs a product decision and a review before any migration. |
| **C. Staff read of inactive authors' prayers** | Adds a SELECT policy so staff can read and moderate content of inactive authors. | Full text to staff | New SELECT policy | **Not recommended.** It expands read access to restricted records, which D2 forbids. |
| **D. Lifecycle purge** | Deletes or anonymises prayers when an author is deactivated, after a retention period. | Removes data | Destructive; a data-retention decision | Out of scope for this release. Needs a retention policy first. |

## 3. Recommended path, if moderation is needed

Option B, with these constraints:

1. **Metadata only.** The function returns no prayer text. A moderator who needs the text must ask the author or follow a separate, documented process.
2. **Narrow action.** The only write is `is_active = false` on the prayer, plus an audit row (`actor`, `prayer id`, `action`, `at`). No edit of content, no change of author.
3. **Staff only, active only.** `is_admin_or_coordinator()` (status-gated). Cell leaders and members have no path.
4. **Audit table.** Append-only, readable by admins only, with its own RLS.
5. **No change to existing policies.** `prayers_shared_read`, `prayers_leadership_read`, `prayers_own` and `prayers_coordinator_manage` stay as they are.

## 4. What the review must confirm before any migration

- A product owner has confirmed the moderation need, and the text-access rule (point 1).
- The retention rule for hidden prayers (option D is separate).
- The audit table's retention and who can read it.
- A test matrix: active and inactive staff, an author in each status, cross-cell staff, members. Expected: metadata visible to active staff only; text never returned; the write only changes `is_active`; an audit row is written in the same transaction.

## 5. Decision requested

Choose one: **A** (recommended for this release), or **B** as a follow-up after its own review. Do not implement C.
