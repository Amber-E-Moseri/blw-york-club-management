# BLW York Hub v2 — Prototype Gap Audit

> Compares `BLW_York_Hub_v2.html` against the production contracts defined in this branch.
> Categories: A = Prototype bug · B = Missing critical workflow · C = Misleading interaction · D = Production-only concern
> Only A–C may justify editing the prototype. D items belong in documentation.

---

## People

### P-1 · `D` · visit_count is a mutable state variable, not derived

**Finding:** `S.visits[id]` is initialized from `p.visits` on the contact record and incremented by `toggleCheckin()`. In production, visit count must be derived from `service_attendance`, never stored as an independently editable field.

**Impact on prototype:** The prototype correctly derives the *effect* (dots, "ready for membership" label) from `S.visits` and only increments it on check-in. The mental model is right.

**Disposition:** Production-only concern. No prototype change needed. The implementation note in `blw-state-authority.md` covers it.

---

### P-2 · `D` · People table does not distinguish "converted" members from original members

**Finding:** After `convertMember()`, the person's `type` is set to `'member'` in the JS array and they disappear from the Contacts tab. In production, the person's identity in `people` never changes — what changes is that `memberships` gains a row.

**Impact on prototype:** Prototype correctly demonstrates that the person is not deleted and history is preserved (toast: "full history preserved"). The visual result (they appear in Members tab) matches the intended behaviour.

**Disposition:** Production-only concern. Prototype conveys the right UX outcome.

---

### P-3 · `D` · No duplicate-person detection at "Add person"

**Finding:** The "Add person" modal has no duplicate-check step. In production, before creating a person, the system must search for matching email/phone and warn.

**Disposition:** Production-only concern. The modal is intentionally minimal in the prototype.

---

## Outreach CRM

### O-1 · `A` · Prototype bug — "Not coming" response toggle leaves contact on expected list

**Finding:** In `setResp()`, when response is toggled off (old === resp → sets null), the contact remains displayed in the Expected tab if their prior state was `confirmed` or `maybe`, because the UI re-renders but `isContactExpected()` checks for `confirmed || maybe`, not null.

**Actual behaviour:** Clicking "Not coming" on a confirmed contact correctly sets `sundayResp = 'not-coming'` and `isContactExpected()` returns false (correct). The issue is that clicking "Not coming" again (toggle) sets null — and null means they would NOT be expected either, since `isContactExpected` requires confirmed or maybe. So this is actually correct behaviour.

**Verdict on re-examination:** Not a bug. The toggle (null) correctly removes from expected list. No change needed.

---

### O-2 · `C` · Misleading — Sunday response buttons appear for all contacts regardless of which service is active

**Finding:** The CRM table always shows "Sunday Sep 20" as the column header, regardless of which service is selected in the Services page. If the current service changed to Oct 5, the CRM would still show "Sep 20."

**Impact:** Misleading to the user. In production, the response column must reflect the *current upcoming service*.

**Disposition:** `C` — Misleading interaction. However, since the prototype is a static demo locked to Sep 20, this is acceptable as intentional simulation. No prototype edit warranted; note for production implementation:
> The "Sunday response" column and buttons in the CRM must be service-aware, showing the next upcoming service dynamically.

---

### O-3 · `D` · Pipeline "Membership Review" column is derived from visits, not from a stage field

**Finding:** In the Kanban, items in "Membership Review" are placed there by `(S.visits[id]||0) >= 3 && !S.converted`. There is no `stage = 'membership_review'` set on the contact record.

**Disposition:** Production-only concern — and the right design decision. The "Membership Review" stage is derived, not manually set. The data model and state authority map reflect this.

---

## Services

### S-1 · `D` · Expected list is rebuilt from mutable JS state on every render

**Finding:** `expectedList()` recomputes from `PEOPLE + S.sundayResp + S.exceptions` on every render. In production, this must come from a database query against `service_expectations`.

**Disposition:** Production-only concern. The derivation logic is correct and the state authority map covers the production query.

---

### S-2 · `A` · Prototype bug — "Convert to member" button appears on the Expected list for members with `S.visits >= 3`

**Finding:** In `renderExpected()`, the check `!isContact && S.visits && S.visits[p.id] >= 3 && !S.converted.has(p.id)` renders a "Convert to member" button for members whose visits key exists and is ≥3. Since `S.visits` is only populated for contacts (`Object.fromEntries(PEOPLE.filter(p=>p.type==='contact')...)`), this condition can never be true in the current prototype data.

**Verdict:** Not currently triggered by the prototype data, but the conditional logic is wrong — it should only fire for contacts, not members. The outer `!isContact` guard means it only fires for members, which is the wrong population. This is dead code that would confuse a future developer.

**Disposition:** `A` — Prototype bug. Fix: remove the `!isContact && S.visits...` branch entirely from `renderExpected()`. Members should never show a "Convert to member" button — that button belongs only in the contact's profile drawer (where it already correctly appears for contacts with visits >= 3).

**File:** `BLW_York_Hub_v2.html:1003–1004`
**Recommended fix:** Remove lines 1003–1005:
```js
if(!isContact&&S.visits&&S.visits[p.id]>=3&&!S.converted.has(p.id)){
  ckBtn=`<button class="ckb rdy" onclick="convertMember('${p.id}')">Convert to member</button>`;
}
```

---

### S-3 · `D` · Past service selector does not load historical data

**Finding:** `selectService(id)` changes the title but does not re-render the Expected list or check-in data for past services. The Expected, Check-in, Exceptions, and After Service tabs always reflect the Sep 20 (upcoming) state regardless of which past service is selected.

**Disposition:** Production-only concern — historical views are out of scope for the prototype. The History tab is the correct entry point for past service data in the current prototype.

---

### S-4 · `D` · `updateDashboard()` hardcodes `63 + S.walkins.length` as "expected"

**Finding:** Dashboard "expected" count is `63 + walkins`, not derived from `expectedList().length` (which would be around 7 from the prototype data). This is intentional — the prototype simulates a full campus scenario with 63 expected members while only demoing 7 in the detail list.

**Disposition:** Production-only concern. The hardcoded 63 is a simulation placeholder. Production reads from `service_expectations` count.

---

### S-5 · `C` · Misleading — walk-in modal does not actually create a person or attendance record

**Finding:** `saveModal()` pushes to `S.walkins` array with a generated id (not a real person id). The walk-in appears in the "Walk-ins & unexpected arrivals" card but has no actual person record or attendance record created.

**Impact:** The interaction correctly shows that walk-ins need a rep assigned ("Walk-in · Visit 1 · Rep needed"), but does not simulate the new-person creation step.

**Disposition:** `C` — Misleading. Acceptable for prototype purposes since the focus is on the workflow concept, not the full data flow. Note for implementation:
> Walk-in flow must: (1) search for existing person by name/phone; (2) if not found, create `people` + `contacts` record; (3) create `service_attendance.is_walk_in = true`; (4) prompt rep assignment.

---

### S-6 · `D` · "Send confirmations" button is a toast stub

**Finding:** "Send confirmations" calls `showToast('Confirmation reminders queued for 31 people')`. The 31 count is hardcoded.

**Disposition:** Production-only concern.

---

## Expected List

### E-1 · `D` · Attendance pattern uses `p.pat` (last-8 array) hardcoded on each person

**Finding:** The prototype encodes 8-week attendance as `pat:[1,1,1,0,1,1,1,1]` directly on the person record. In production, this is derived dynamically from `service_attendance` lookback query.

**Disposition:** Production-only concern. The algorithm logic (`sum(pat) >= 5`) is correct.

---

### E-2 · `D` · Explanation text is not snapshotted — it's recomputed each render

**Finding:** The "Why expected" column computes `${cnt} of last 8 Sundays` at render time from `patSum(p.pat)`. In production, this explanation must be written into `service_expectations.explanation` at generation time and not recomputed.

**Disposition:** Production-only concern. The `attendance_pattern_snapshots` table in the data model addresses this.

---

### E-3 · `D` · Attendance mode is always "In person" (hardcoded badge)

**Finding:** Every row in the Expected tab shows `<span class="bx bx-df">In person</span>` regardless of actual mode.

**Disposition:** Production-only concern — online attendance mode is supported in the data model.

---

## Exceptions

### X-1 · `D` · Exception adds directly to `S.exceptions` Set without date context

**Finding:** `S.exceptions` is scoped to the current service (Sep 20) by convention, but there is no explicit service_id in the exception object. In production, exceptions are rows in `service_expectations` with `response = 'declined'` for a specific `service_id`.

**Disposition:** Production-only concern.

---

### X-2 · `C` · "Not coming this Sunday" in profile drawer sets reason as "Personal" with no user input

**Finding:** `openExceptionFor(id)` sets `S.exceptionReasons[id] = 'Personal'` without asking the user for a reason. The full exception modal (with reason select) is only accessible from the Exceptions tab.

**Impact:** Minor inconsistency — two entry points for exceptions, one of which skips the reason prompt.

**Disposition:** `C` — Misleading interaction. Acceptable for the prototype. Note for production:
> "Not coming this Sunday" from the profile drawer must prompt for a reason before saving.

---

## Check-in

### CI-1 · `A` · Prototype bug — toggling check-in twice increments visit count twice

**Finding:** `toggleCheckin()` increments `S.visits[id]` unconditionally when checking in. If a user checks in a contact, then unchecks, then checks in again, `S.visits[id]` increments a second time.

**Code:** `BLW_York_Hub_v2.html:1026–1028`
```js
S.checkedIn.add(id);
if(isContact){
  S.visits[id]=(S.visits[id]||0)+1;
```
The `was` guard removes from `S.checkedIn` but does not decrement `S.visits`.

**Impact:** A contact could reach "visit 3" without actually attending 3 services.

**Disposition:** `A` — Prototype bug. This would mislead implementation. **Fix:** Decrement `S.visits[id]` when removing from `checkedIn`, and add a guard to not decrement below the pre-session baseline.

**Recommended fix in `BLW_York_Hub_v2.html:1021–1034`:**
```js
function toggleCheckin(id,isContact){
  const was=S.checkedIn.has(id);
  if(was){
    S.checkedIn.delete(id);
    if(isContact) S.visits[id]=Math.max(0,(S.visits[id]||0)-1);
  } else {
    ...
  }
}
```

---

### CI-2 · `D` · Walk-in ids are generated with `'w'+Date.now()` and don't match person ids

**Finding:** Walk-ins get a local id (`w1726435200000`) not linked to any person record.

**Disposition:** Production-only concern.

---

## Visit Progression

### V-1 · `D` · Visit count does not exclude members from count

**Finding:** In production, only **Sunday services** (`service_type = 'sunday_morning'`) count toward contact visit progression. Bible Studies, Cell Meetings, and other events must not count. The prototype only tracks check-ins on the Services page, which implicitly simulates Sundays only.

**Disposition:** Production-only concern. The data model `service_type` filter handles this.

---

### V-2 · `D` · "Ready for membership" state surfacing

**Finding:** The prototype surfaces "Ready for membership" in: (a) After Service grid, (b) Kanban Membership Review column, (c) People directory stat chip, (d) CRM stat chip, (e) Profile drawer. All five correctly derive from `visits >= 3 && !converted`.

**Disposition:** Production-only concern — production must derive this from `service_attendance` count.

---

## Membership Conversion

### M-1 · `C` · Misleading — `convertMember()` mutates `p.type = 'member'` directly

**Finding:** The conversion function mutates the person object in the PEOPLE array (`p.type = 'member'`). This gives the correct visual result but implies that "type" is an intrinsic property of the person. In production, the person's identity does not change — the `memberships` table gains a row.

**Disposition:** `C` — Misleading for implementation. No prototype edit needed, but the implementation must NOT mirror this approach. The data model and state authority map are explicit.

---

### M-2 · `D` · No confirmation prompt before conversion

**Finding:** Clicking "Convert to member" executes immediately with no "Are you sure?" prompt.

**Disposition:** Production-only concern — production must include a confirmation step with authorization context.

---

## Cells

### C-1 · `B` · Missing critical workflow — cell card click has no interaction (toast stub)

**Finding:** Clicking a cell card shows a toast ("Phronesis cell details opened") but no actual detail view. There is no cell detail page showing member list, integration states, or cell attendance.

**Impact:** The cell detail workflow is entirely unspecified by the prototype.

**Disposition:** `B` — Missing critical workflow. However, this is a deliberate prototype scope decision (cells are secondary to the service + outreach flows). The detail interaction is acknowledged as not designed.

**Note for React implementation:** Cell detail must show: member list with integration states, cell leader contact, meeting history, upcoming cell meeting, contacts in the integration pipeline.

---

## Meetings

### MT-1 · `D` · Meetings page has no interactive state — all buttons are toast stubs

**Finding:** Join meeting, View agenda, Open minutes all call `showToast()`. The meeting data model (agenda items, action items, decisions, minutes) is not represented at all in the prototype JS.

**Disposition:** Production-only concern. Meetings are acknowledged as a non-interactive section in the prototype. The meeting hub UI is sufficient as a layout reference.

---

## Events

### EV-1 · `D` · Events are a static list with no RSVP interaction

**Finding:** RSVP counts are hardcoded (34 RSVPs, 51 expected, etc.). No RSVP action is available.

**Disposition:** Production-only concern.

---

## Growth

### G-1 · `D` · All growth state is hardcoded (streak, progress, prayer log)

**Finding:** The 15-day streak, 62% book progress, 5/7 prayer days are all hardcoded in the HTML.

**Disposition:** Production-only concern.

---

## Admin

### A-1 · `D` · Admin badge count (6) and all admin cards are stubs

**Finding:** All Admin cards show `showToast()` or static content. No actual approval, role management, or configuration interaction is implemented.

**Disposition:** Production-only concern. The Admin page is a layout reference.

---

## Mobile

### MB-1 · Mobile bottom nav missing Cells, Meetings, Events

**Finding:** The bottom nav has 5 buttons: Home / People / Outreach / Service / Growth. Cells, Meetings, and Events are not reachable from mobile without the sidebar.

**Impact:** On mobile (sidebar hidden), the user cannot navigate to Cells, Meetings, or Events via the bottom nav.

**Disposition:** `B` — Missing critical workflow. The prototype's mobile bottom nav omits three primary destinations. This needs to be addressed either by:
1. Adding a "More" overflow tab on mobile that exposes Cells, Meetings, Events
2. Or incorporating Cells into People, and Meetings + Events into a combined "Schedule" tab

**No prototype edit required** — this is a known gap that must be solved in the React implementation.

---

## Summary

| ID | Category | Severity | Needs prototype edit? |
|---|---|---|---|
| S-2 | A — Prototype bug | Medium | Yes — remove dead "Convert to member" branch for members |
| CI-1 | A — Prototype bug | High | Yes — fix double-increment on check-in toggle |
| O-2 | C — Misleading | Low | No — note for production |
| S-5 | C — Misleading | Low | No — note for production |
| X-2 | C — Misleading | Low | No — note for production |
| M-1 | C — Misleading | Low | No — covered in data model |
| C-1 | B — Missing workflow | Medium | No — cells detail out of scope for prototype |
| MB-1 | B — Missing workflow | Medium | No — resolve in React implementation |
| All others | D — Production-only | N/A | No |

### Prototype edits required: 2

1. **Fix CI-1:** `toggleCheckin()` in `BLW_York_Hub_v2.html:1021` — add visit decrement on uncheck.
2. **Fix S-2:** `renderExpected()` in `BLW_York_Hub_v2.html:1003` — remove dead "Convert to member" branch for members.

Both fixes are small (< 5 lines each) and correct misleading or incorrect behavior without changing any UX.
