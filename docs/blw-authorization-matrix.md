# BLW York Hub — Authorization Matrix

> Defines what each role can do. Derived from the prototype's implied access patterns and production security requirements.

---

## Roles

| Role | Description | Who holds it |
|---|---|---|
| **Admin** | Full system access including configuration | Senior coordinator, IT lead |
| **Coordinator** | Ministry operations access — can see all people, convert members, manage services | Branch coordinator |
| **Cell Leader** | Can see their cell's members, manage their own contacts, run check-in | Cell leaders |
| **Contact Rep** | Can manage their own assigned contacts, record interactions, set service responses | Any assigned outreach leader |
| **Member** | Can access growth features and their own profile only | All active members |

> **Implementation note:** Roles are stored in `memberships.role`. A person may be a Cell Leader AND a Contact Rep. Authorization checks should be additive (if the user satisfies any role that grants a capability, they can act).

---

## Capability Matrix

`✓` = Allowed · `✗` = Denied · `Own` = Own records only · `Cell` = Own cell only

| Capability | Admin | Coordinator | Cell Leader | Contact Rep | Member |
|---|---|---|---|---|---|
| **People** | | | | | |
| View people directory | ✓ | ✓ | Cell | ✓ | ✗ |
| View person profile (drawer) | ✓ | ✓ | Cell | Own contacts | ✗ |
| Create person record | ✓ | ✓ | ✓ | ✓ | ✗ |
| Edit person (name, email, phone) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Merge duplicate people | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Contacts & Outreach** | | | | | |
| View all contacts | ✓ | ✓ | Cell | Own | ✗ |
| Create contact | ✓ | ✓ | ✓ | ✓ | ✗ |
| Assign / reassign contact rep | ✓ | ✓ | ✗ | ✗ | ✗ |
| Record interaction | ✓ | ✓ | Cell | Own | ✗ |
| Edit interaction | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage follow-up | ✓ | ✓ | Cell | Own | ✗ |
| View CRM pipeline | ✓ | ✓ | Cell | Own | ✗ |
| Export contacts | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Service Expectations** | | | | | |
| View expected list | ✓ | ✓ | ✓ | ✓ | ✗ |
| Set contact Sunday response (Coming/Maybe/Not coming) | ✓ | ✓ | Cell | Own contacts | ✗ |
| Add person to service manually | ✓ | ✓ | ✗ | ✗ | ✗ |
| Record weekly exception (member away) | ✓ | ✓ | Cell | ✗ | ✗ |
| Remove exception | ✓ | ✓ | Cell | ✗ | ✗ |
| Send confirmation reminders | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Check-in** | | | | | |
| Check in expected person | ✓ | ✓ | ✓ | ✓ | ✗ |
| Record walk-in | ✓ | ✓ | ✓ | ✓ | ✗ |
| Correct attendance (post-service) | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Membership Conversion** | | | | | |
| View "ready for membership" list | ✓ | ✓ | Cell | Own | ✗ |
| Convert contact to member | ✓ | ✓ | ✗ | ✗ | ✗ |
| Reverse membership conversion | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Cells** | | | | | |
| View all cells | ✓ | ✓ | ✓ | ✓ | ✗ |
| Create cell | ✓ | ✓ | ✗ | ✗ | ✗ |
| Edit cell name / description | ✓ | ✓ | Cell | ✗ | ✗ |
| Assign cell leader | ✓ | ✓ | ✗ | ✗ | ✗ |
| Assign member to cell | ✓ | ✓ | Cell | ✗ | ✗ |
| Update integration state | ✓ | ✓ | Cell | ✗ | ✗ |
| **Meetings** | | | | | |
| View meetings | ✓ | ✓ | ✓ | ✓ | ✗ |
| Schedule meeting | ✓ | ✓ | ✓ | ✗ | ✗ |
| Edit meeting | ✓ | ✓ | Cell (own) | ✗ | ✗ |
| Record minutes | ✓ | ✓ | Cell (own) | ✗ | ✗ |
| **Events** | | | | | |
| View events | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create event | ✓ | ✓ | ✗ | ✗ | ✗ |
| Edit event | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Growth (Personal)** | | | | | |
| View own devotional / habits / books | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mark own devotional complete | ✓ | ✓ | ✓ | ✓ | ✓ |
| Log own prayer | ✓ | ✓ | ✓ | ✓ | ✓ |
| Share testimony | ✓ | ✓ | ✓ | ✓ | ✓ |
| View others' testimonies | ✓ | ✓ | ✓ | ✓ | ✓ |
| View growth reports (aggregate) | ✓ | ✓ | Cell | ✗ | ✗ |
| **Reports** | | | | | |
| View attendance reports | ✓ | ✓ | Cell | ✗ | ✗ |
| View outreach reports | ✓ | ✓ | Cell (own) | Own | ✗ |
| View membership reports | ✓ | ✓ | ✗ | ✗ | ✗ |
| Export data | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Admin** | | | | | |
| Review pending signups | ✓ | ✓ | ✗ | ✗ | ✗ |
| Approve / reject signups | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage roles | ✓ | ✗ | ✗ | ✗ | ✗ |
| Change service configuration | ✓ | ✗ | ✗ | ✗ | ✗ |
| View audit log | ✓ | ✓ | ✗ | ✗ | ✗ |
| View email logs | ✓ | ✓ | ✗ | ✗ | ✗ |
| Cancel service | ✓ | ✓ | ✗ | ✗ | ✗ |
| Correct historical attendance | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Configuration** | | | | | |
| Update attendance threshold | ✓ | ✗ | ✗ | ✗ | ✗ |
| Update membership visit threshold | ✓ | ✗ | ✗ | ✗ | ✗ |
| Update service schedule config | ✓ | ✗ | ✗ | ✗ | ✗ |

---

## Row-Level Security Notes

When implementing with Supabase RLS:

**Contact Rep** (`contacts.rep_id = auth.uid()`) sees:
- Their assigned contacts in `contacts`
- Interactions for those contacts in `contact_interactions`
- Follow-ups where `owner_id = auth.uid()`
- Service expectations for their contacts

**Cell Leader** (`cells.leader_id = auth.uid()`) sees:
- All members in `person_cell_relationships WHERE cell_id = their cell`
- Their cell's integrating contacts
- Interactions for their cell members

**Coordinators and Admins** bypass row-level filters and see all records.

---

## Capability Definitions

| Capability | Definition |
|---|---|
| **View People** | Access the people directory and person profiles |
| **Edit People** | Update name, email, phone on existing person records |
| **Create Contact** | Add a new person as a contact, including logging first interaction |
| **Assign Contact Rep** | Set or change `contacts.rep_id` |
| **Record Interaction** | Insert into `contact_interactions` |
| **Manage Follow-Up** | Create, update, complete, cancel `follow_ups` |
| **Set Service Response** | Update `service_expectations.response` for a contact |
| **Record Weekly Exception** | Set `service_expectations.response = 'declined'` for a member for one service |
| **Check In** | Create or update `service_attendance` with `status = 'attended'` |
| **Correct Attendance** | Update `service_attendance` for a completed service (requires audit event) |
| **Create Walk-In** | Insert `service_attendance.is_walk_in = true` for an unexpected arrival |
| **Convert Contact to Member** | Insert into `memberships` + `membership_transitions`, requires coordinator |
| **Manage Cells** | Create, edit cells; manage `person_cell_relationships` |
| **Manage Services** | Create, update, cancel `services`; manage the expected list |
| **View Reports** | Access aggregate attendance, outreach, and membership data |
| **Manage Configuration** | Update `service_config` — admin only |
