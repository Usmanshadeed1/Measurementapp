# GHL Workflow State — Maximus (Remodeling)

Record of everything built and verified in the GoHighLevel sub-account.
Last verified: **19 Aug 2026**.

Location ID: `Ga7nrS4d8EFtep9LkHS3`

---

## The two halves of this system

These are separate and should not be confused with each other:

| Half | Lives in | Purpose |
|---|---|---|
| **Sales** | GoHighLevel | CSV → Contact → Job → pipeline stages → sold or dead |
| **Field work** | The measurement app | Open a Job → record rooms, walls, openings, electrical, plumbing + photos |

They meet at exactly one point: **the Job**. GHL creates it; the app hangs
measurements underneath it.

---

## Pipeline — "Remodeling Sales" ✅ BUILT

1. New Lead
2. 1st Client Visit
3. Design Meeting Scheduled
4. Need Revision
5. Proposal Sent
6. Dead Lead
7. Hired Maximus *(won)*
8. Material Ordering

**Data model:** a **Job = one Opportunity = one address.** One Contact may own
several Jobs over time. Rooms are child custom-object records under the Job.

---

## Custom fields ✅ BUILT

Three **Dropdown (single)** fields on the **Opportunity** object,
folder "Opportunity Details":

| Field | Merge key | Options |
|---|---|---|
| Design Status | `{{opportunity.design_status}}` | Pending · In Progress · Done |
| Pricing Status | `{{opportunity.pricing_status}}` | Pending · In Progress · Done |
| Meeting Status | `{{opportunity.meeting_status}}` | Pending · Scheduled · Held |

**Why these exist:** the client's #1 requirement is seeing, across all
customers, who has completed designs / pricing / the virtual meeting and who
is still pending. GHL's Kanban board cannot answer that — a card's stage does
not encode per-step completion, and tasks cannot be listed into a table.
These fields turn status into **queryable data** the measurement app can read
over the API.

An earlier version of this project pointed the client at the GHL board as
"the dashboard." That was wrong and is the reason these fields exist.

---

## WF-1 — "Auto Job Creation" ✅ BUILT & VERIFIED

**Trigger:** Contact Created (no filters)

**Actions, in order:**
1. **Create/Update Opportunity** → pipeline `Remodeling Sales`, stage `New Lead`,
   name = `{{contact.first_name}} {{contact.last_name}} - {{contact.address1}}`,
   source `CSV Import`
2. **Update Opportunity** → `Property Address` = Contact · Full Address
3. **Add owner to opportunity** → Usman 2 Usman 2 *(test user)*

### ⚠️ Bug found and fixed 19 Aug 2026
Action 2 had shipped **with no fields configured** — it ran and silently did
nothing, so Property Address was always empty and the address only ever
existed glued inside the opportunity name. Fixed by adding the field and
mapping it to Contact · Full Address. Re-tested: address and owner both
populate correctly.

---

## WF-2 — "1st Client Visit Tasks" ✅ BUILT & VERIFIED

**Trigger:** Pipeline stage changed → in pipeline `Remodeling Sales`,
stage is `1st Client Visit`

**Actions, in order:**
1. Create Task — **Make Designs**
2. Create Task — **Create Pricing for Opportunity**
3. Create Task — **Schedule Virtual Meeting**
4. **Update Opportunity** — "Set 3 Statuses to Pending" → sets all three
   status fields above to `Pending` in a single action

**Task settings:** due `1 Day` at **5:00 PM**, assigned to Usman 2 (test user).

### Why 5:00 PM and not 7:00 AM
The due date is a **deadline, not a start time** — GHL has no start time.
A 7:00 AM deadline means the work must be finished before anyone arrives, and
the task shows as overdue the moment staff start their day. 5:00 PM gives a
full working day.

---

## WF-3 — "Design Meeting Scheduled" ✅ BUILT & VERIFIED

**Trigger:** Pipeline stage changed → in pipeline `Remodeling Sales`,
stage is `Design Meeting Scheduled`

**Actions:**
1. **Update Opportunity** — "Set Design and Pricing Done, Meeting Scheduled":
   `Design Status` = Done, `Pricing Status` = Done, `Meeting Status` = Scheduled
2. **Create Task** — *Prepare for design meeting* → sales rep, due 1 day,
   5:00 PM, skip weekends ON

### The reasoning behind action 1
Moving a card to this stage *means* designs and pricing are finished — you
would not book the design meeting without them. So one drag sets all three
statuses, rather than three people each remembering to change a dropdown.

This was chosen over the alternative: GHL **does** offer a "Task completed"
trigger (confirmed present in the trigger list, alongside "Task added" and
"Task reminder"), which could set each status as its own task is ticked off.
That path was not taken because it depends on every staff member having their
own GHL login and actually ticking tasks — the stage move is a single action
the owner already performs.

Verified end-to-end 2026-08-19: dragging a card to this stage set all three
statuses and created the task; the dashboard reflected it on refresh.

---

## Date-driven progress (Aug 2026 direction change)

The client clarified he does **not** want to work in GoHighLevel: *"I'm not
using GoHighLevel, I'm using a dashboard that we're creating."* Work is driven
by entering **dates** in the app, and each date entered surfaces the next step.

**Date fields on Opportunity** (all Date picker):

| Field | Key | Id |
|---|---|---|
| Appointment Date | `opportunity.appointment_date` | `MIs9bBh66P2gsXjDNfOQ` |
| Measurement Completed Date | `opportunity.measurement_completed_date` | `iM2aDumKi2NctsUP80bd` |
| Proposal Sent Date | `opportunity.proposal_sent_date` | `wwLRthpRhQLmMcSOLnaH` |

**No workflow drives these.** GHL has no "opportunity custom field changed"
trigger, so a workflow cannot see a date typed in the app. Instead the app
writes the date *and* moves the stage in one action; the stage move is what
fires the existing workflow. Saving Measurement Completed moves the job to
**1st Client Visit**, which fires WF-2.

**API asymmetry to remember:** writes take `customFields: [{id, value}]`, but
reads return `fieldValue` for dates and `fieldValueString` for dropdowns.
`api.oppField()` handles both.

**Stage changes from the API fire workflows exactly like a drag in GHL** —
verified 2026-08-20 by moving a job via PUT and watching WF-3 set all three
statuses. This is what makes the app able to replace the GHL board.

---

## Confirmed impossible without extra infrastructure

- **Staff logging in with GoHighLevel credentials.** No SSO, and no API that
  verifies a GHL email/password. Individual logins need their own auth.
- **A full history of who changed what.** The app writes with one shared
  Private Integration Token, so every change looks identical to GHL. GHL's
  own audit log is also only retained 60 days. Full history needs its own
  database.

Everything else the client described — date chain, task list, stage control
from the app — is buildable with what exists.

---

## Verified GHL limitation — task assignment

**`Create Task` cannot dynamically assign to the Opportunity's owner.**

The Assign To field requires a literal `userId` string. GHL's custom-value
picker exposes Contact, Company, User, Appointment, Calendar, Message and
Account categories — but **no Opportunity category**. `{{opportunity.assigned_to}}`
is rejected with *"Users added using custom picker should be string userId."*

This is a platform limitation, not a configuration mistake. Options:

1. **Fixed specialist per task type** — designer always gets Make Designs,
   estimator always gets Pricing, sales rep always gets the Meeting.
   *This is the chosen approach.* Exceptions are reassigned by hand.
2. If/Else branch per staff member — dynamic, but must be rebuilt whenever
   staff change.
3. Assign everything to one default user; a manager redistributes.

**Opportunity owner is set by hand, not by workflow.** WF-1's "Assign User"
action does not populate `assignedTo` — jobs come out unassigned. Since the
client wants to choose who takes each job anyway, assignment is done manually
on the opportunity's Owner dropdown. The dashboard shows an "Unassigned"
count, a red "Unassigned" label per row, and a filter, so nothing is missed.
The dead action in WF-1 should be deleted so it cannot later override a
manual choice.

**Where the client reassigns a task:** open the task on the Opportunity or
Contact record → change the **Assigned to** dropdown → save. Takes seconds.
This is what he meant by "change it later from the dashboard."

**Open question for the client:** does he have one person who always does
designs, one who always prices, and one who always books meetings? If yes,
set each task permanently to that person and reassignment becomes rare.

---

## Important behaviours to preserve

- **Workflows only fire at the moment of creation.** A card created before a
  fix stays broken — it will not repair itself. Adding an address to a contact
  afterwards does **not** re-fire WF-1.
- **CSV imports only trigger workflows if the *"allow this import to trigger
  workflows"* option is ticked at import time.**
- Test data still in the account: `Test Job1`, `Michael Reynolds`,
  `Jennifer Parker`, `David Martinez`, `Usmans Shadeeds`, and their
  opportunities. The `Usmans Shadeeds` card has an empty Property Address
  because it predates the WF-1 fix.

---

## Verified working end-to-end

A test contact with a full address was created, and:

- ✅ Job card appeared in **New Lead**
- ✅ **Property Address** populated
- ✅ **Owner** assigned
- ✅ Dragging to **1st Client Visit** created all 3 tasks, due tomorrow 5:00 PM
- ✅ All 3 status fields set to **Pending**

**The GHL foundation is complete.**

---

## What is NOT built yet

| Item | Status |
|---|---|
| Automation for stages 4–8 (Need Revision → Material Ordering) | ❌ No automation on any of these yet |
| Proposal follow-up chasing | ❌ Nothing chases a sent proposal today |
| The ~20 post-sale project tasks | ❌ **Blocked** — client has not supplied the list, assignees, or timing |
| Materials tracking | ❌ Undesigned. Recommend a `Material` custom object (consistent with the existing Room/Wall model, and queryable by the app) |
| Task reminder workflow | ❌ Not built. Must use **Send Internal Notification**, never Send Email — Send Email targets the *contact*, i.e. it would message the homeowner about staff's overdue paperwork |

---

## Security — still open

The measurement app originally had a Private Integration Token (`pit-...`)
hardcoded in client-side JavaScript, visible in page source, and it was also
pasted into chat logs.

**Fixed:** the token now lives server-side in a Netlify function
(`GHL_API_KEY` env var). No token remains in any file or in git history.

**Still required:**
- **Rotate the old token in GHL** — Settings → Private Integrations. Moving
  the new key server-side does not invalidate the old exposed one.
- **The proxy has no authentication of its own.** Anyone who can reach the
  Netlify URL can proxy arbitrary calls to the GHL location. Smaller hole
  than a public token, but still an open door.

---

## Recommended next decisions

1. **Build the dashboard** — the client's #1 ask, currently at zero.
2. **Separate Production pipeline** for the build phase rather than extending
   Remodeling Sales with Installation → In Progress → Completed. Sales and
   production have different owners and cadence; mixing them makes both boards
   hard to read. *Not yet discussed with the client.*
3. **Collect the 20 project tasks** from the client with assignee and due-date
   rule for each — everything post-sale is blocked on this.

---

## Note for anyone picking this up

Do **not** use GHL's built-in AI workflow builder to create actions. In this
account it repeatedly produced wrong action types — `Add Notes` instead of
`Create Task`, and a ClickUp premium integration the client does not own —
leaving required fields blank. Build actions by hand.
