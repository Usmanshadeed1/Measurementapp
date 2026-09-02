# How This App Works

A plain-language reference for what this app does, where its data lives,
and how the pieces connect. Written for discussion, not as a spec —
update it as we make decisions.

Last updated: 24 August 2026.

## The one core idea

**Two systems, each holding what it is good at.**

**GoHighLevel** holds the customer-facing record: Contacts, Jobs
(Opportunities), Rooms, Walls, Photos, Notes, and the pipeline the
client already works in. Anything the client can see in GHL lives there.

**Supabase** holds what GHL structurally cannot do: staff logins and
roles, tasks attached to a *job*, task templates, job access, and the
activity history. This was added once it became clear GHL had no way
to store them (see "Why we added a second database" below).

The app is a custom frontend over both. If neither system can store
something, the app cannot show it.

## What a "Job" actually is

A **Job** in this app = an **Opportunity** in GHL (GHL's built-in deal/pipeline
object). Not a Contact.

- Every Opportunity in GHL is linked to exactly one Contact.
- The app displays `opportunity.contact.name` as the Job's title — so it
  *looks* like a contact list, but it's actually an opportunity list
  showing contact names.
- A Contact that has no Opportunity created for them **will not appear**
  in this app at all, no matter how many contacts exist in GHL.
- The app currently fetches Opportunities with **no status filter** —
  so Open, Won, Lost, and Abandoned all show up. GHL's own Opportunities
  board defaults to showing only "Open," which is why counts can look
  different between the two places.

**To make a new customer appear in the app:** create an Opportunity for
them in GHL (Contacts → open contact → Add Opportunity, or
Opportunities → Add opportunity). The app has no "create new job" button
today — that would be a new feature.

## The data hierarchy

Everything below the Job level is a **GHL Custom Object** your client
already set up, connected via GHL's **Associations** feature (a link
record connecting two records, e.g. "this Room belongs to this Job").

```
Job (Opportunity)
 └─ Room                         custom_objects.room
     ├─ Wall                     custom_objects.wall
     │   ├─ Opening (window/door)  custom_objects.wall_opening
     │   ├─ Appliance               custom_objects.appliance
     │   ├─ Electrical (outlet/switch)  custom_objects.electrical
     │   └─ Plumbing                 custom_objects.plumbing
     ├─ Island                   custom_objects.island
     │   └─ Plumbing                 custom_objects.plumbing
     ├─ Lighting Fixture         custom_objects.lighting_fixture
     └─ Photos / Videos          custom_objects.photo / custom_objects.video
```

Photos/Videos are a little different: instead of an Association, each
photo/video record just stores `job_id`, `room_id`, and `wall_id` as
plain fields on itself. That's how one uploaded photo can show up in
three different galleries (Wall, Room, and Job) without uploading it
three times.

## What happens when you click things (the actual flow)

| You do this | The app does this |
|---|---|
| Open Jobs screen | `POST /opportunities/search` — fetch all Opportunities |
| Tap a Job | `GET` the Rooms associated with that Opportunity's ID |
| Tap "+ Add Room" | `POST` a new Room record, then `POST` an Association linking it to the Job |
| Tap a Room | `GET` the Walls / Islands / Lighting Fixtures associated with that Room |
| Tap "+ Add Wall" | `POST` a new Wall record, then link it to the Room |
| Open a Wall, tap "+ Add" under Openings/Appliances/Electrical/Plumbing | Same pattern, one level deeper — new record + association to that Wall |
| Tap Camera/Upload | Uploads the file to GHL's media endpoint, then creates a Photo/Video record tagged with job_id/room_id/wall_id |
| Tap Delete on anything | `DELETE` that record from GHL directly (no undo) |

Every save/delete talks to GHL immediately — there's no local-only state
and no offline queue. If the request fails, you'll see an error popup
and nothing is saved.

## Where the code lives

| File | What it's responsible for |
|---|---|
| `index.html` | Markup only — the screens and modal |
| `css/styles.css` | All styling — dark/light theme tokens, layout, accessibility (large type, contrast, tap targets) |
| `js/api.js` | Every call to GHL — routed through our own `/api/*` proxy, not GHL directly |
| `js/utils.js` | Shared helpers: the accordion widget, form field builders, dirty-state tracking, font size + theme controls |
| `js/media.js` | Photo/video thumbnails, upload, and keeping a photo in sync across 3 galleries |
| `js/entities.js` | The 4 leaf-level accordions: Plumbing, Electrical, Appliance, Opening |
| `js/walls.js` | Wall and Island accordions (these contain the entities above) |
| `js/lighting.js` | Lighting Fixture accordion |
| `js/contacts.js` | Contacts tab: list, detail view, and admin-only editing |
| `js/dashboard.js` | The dashboard work list: stage groups, filters, search, staff and stage pickers |
| `js/jobsteps.js` | The 7-step date chain that drives the pipeline |
| `js/newjob.js` | Creating another job for an existing customer |
| `js/notes.js` | Per-job notes, kept in GHL against the opportunity |
| `js/tasks.js` | Tasks on a job |
| `js/tasklists.js` | Reusable task-list templates |
| `js/mytasks.js` | A worker's own task list — their home screen |
| `js/jobaccess.js` | Which jobs a worker may open |
| `js/activity.js` | Activity history, with worker and customer filters |
| `js/auth.js` | Supabase login, roles, and token refresh |
| `js/measure.js` | Room Measurement picker (screen kept, nav link removed) |
| `js/app.js` | Screens, navigation, Job detail, wiring everything together, app boot |
| `api/proxy.js` | Server-side proxy — holds the real GHL token so it never reaches the browser |
| `vercel.json` | Rewrites every `/api/*` call to that proxy |
| `netlify/functions/ghl-proxy.js` | The same proxy for Netlify, kept so the project can host on either platform |

## Why there's a proxy function at all

The original single-file version called GHL directly from the browser
with the API token hardcoded in plain text — visible to anyone who
viewed the page source. Now the browser calls our own `/api/*` on the
same domain, which the host silently forwards to the proxy function,
which attaches the real token server-side. The token lives only in the
host's environment variables (`GHL_API_KEY`), never in any file.

The app now runs on **Vercel** after Netlify's free tier ran out of
deploy credits. Both proxies are kept in the repo so it can move back if
needed.

Nothing in the code names the host: every call is a relative `/api/...`
path, so the app works under whatever domain Vercel serves it from. The
Vercel project was renamed to `maximusmeasure` on 2 September 2026; the
live URL is whatever the project's Domains page lists, since a clean
`.vercel.app` subdomain is only granted when it is free across all of
Vercel.

## Contacts tab

A second top-level tab, separate from Jobs. This talks to GHL's
**Contacts** API directly (`GET /contacts/`) — not Opportunities — so it
shows every Contact in the location, including ones with no Opportunity
attached (unlike the Jobs tab).

- View + search + **create**. Editing/deleting an existing contact is
  still not available from the app — only viewing and adding new ones.
- Search matches name/phone/email (whatever GHL's `query` param covers).
- Tapping a contact shows a detail view: name, phone, email, business,
  tags, created date. No link to that contact's Job/Opportunity yet —
  possible future addition.

### Add Contact

"+ Add Contact" opens a form (First Name, Last Name, Email, Phone,
Business Name, Street Address, City, State, Postal Code, Country,
Contact Type, Tags) and calls `POST /contacts/` directly — this creates
a real contact in GHL, same as adding one manually in the GHL UI.

**Address is 5 separate fields, not one** — confirmed with GHL: there's
no combined "address" field and no `address2` (no suite/unit line).
Field names are `address1`, `city`, `state`, `postalCode`, `country`.
State and Country are recommended as 2-letter codes (e.g. `NJ`, `US`) —
the form uppercases whatever's typed and defaults Country to `US`. None
of the address fields are required by the API.

Important behavior, confirmed against GHL's own docs: **this call
upserts, it does not reject duplicates.** If the email or phone you
submit already matches an existing contact, GHL updates that contact
with whatever fields you submitted instead of creating a new one — no
error is raised either way. The form shows a hint about this so it
doesn't surprise anyone. Only First Name is enforced as required by the
app's own form (the API itself requires nothing, but a nameless contact
isn't useful).

**Tags are a multi-select dropdown, not free text.** The form calls
`GET /locations/{locationId}/tags` when it opens and shows every
existing tag in the account as a checkbox list inside a dropdown panel
— click the button to open it, check any number of tags, click outside
to close. Selection only, no way to create a new tag from this form
(deliberately — avoids the typo/near-duplicate problem free-text
tagging would cause, e.g. "follow-up" vs "Follow Up" ending up as two
different tags). New tags still need to be created in GHL directly.

**Required GHL scopes:** the Private Integration Token needs
`contacts.readonly` (for the list + tag picker) and `contacts.write`
(to create a contact) explicitly enabled — these are not covered by the
Opportunities/Custom Objects scopes the original app used. If you add
another new GHL API area later (e.g. Calendars, Conversations), check
its required scope the same way before assuming the existing token
covers it — a 401 "token is not authorized for this scope" means go add
the scope in Settings → Private Integrations and rotate the token.

Two custom fields exist on Contacts in this account (Wall Length,
Ceiling Height — both FLOAT) that the form deliberately does **not**
include, since they look like a mismatch with a generic "add contact"
flow. Worth asking your client what those are actually for before
wiring them up anywhere.

### Import Contacts (CSV)

"Import CSV" sits next to "+ Add Contact" on the Contacts screen and
opens a 4-step wizard, similar to GHL's own native Import flow, but
built by this app talking to the Contacts API directly (GHL exposes no
bulk-import endpoint — this loops one API call per row):

1. **Upload** — pick a `.csv` file. Parsed entirely client-side
   (`js/csv.js`, a small dependency-free parser — no library pulled in).
2. **Map** — each CSV column gets a dropdown to map it to a contact
   field (First/Last Name, Email, Phone, Business Name, Street Address,
   City, State, Postal Code, Country, Contact Type, Tags), or "do not
   import." Common header names are auto-guessed (e.g. a column
   literally named "Email" auto-maps to Email, "Zip" maps to Postal Code).
3. **Review** — shows row counts, a warning that any GHL workflow
   triggered on "Contact Created" will fire once per row this import
   creates, and a required consent checkbox (mirrors GHL's own
   compliance checkbox) that must be checked before Start Import is
   enabled.
4. **Import** — runs at a throttled ~4 rows/second (GHL's documented
   ceiling is ~10 req/sec, and each row can cost 2 calls, so this stays
   well under it), with a live progress bar. A "Stop Import" button lets
   you abort mid-run — rows already processed stay processed, nothing
   in progress is rolled back.

**Duplicate handling:** before creating each row, the app calls
`GET /contacts/search/duplicate` to check for an existing contact
matching that email/phone. If one is found, the row is **skipped** —
this import never updates or overwrites an existing contact, unlike a
plain `POST /contacts/` call which would silently upsert. This costs
one extra API call per row but was chosen deliberately for safety.

**Final summary** shows created / skipped / failed counts plus a
per-row detail list (e.g. "Row 4: skipped — Already exists
(jane@example.com)"), so nothing about the import is a silent black box.

**Known limitations:** no way to add imported contacts to a Smartlist
or enroll them in a Workflow yet (GHL's AI confirmed there's no direct
API for Smartlists — that would need a tag applied at import time, then
a Smartlist filter built manually in GHL on that tag). No resumable
import — closing the modal mid-run stops it, and there's no "continue
where I left off."

**Note on GHL's own native CSV import erroring on a file this app
already imported:** if you import a CSV through this app first, then
try the *same* file through GHL's own native Import UI, GHL's importer
will likely reject rows as duplicates (error codes 1010/1011 — "already
exists" / "duplicate within file") since those contacts already exist
in the account. This is expected, not a bug in this app — the two
import paths are hitting the same underlying contact data, so importing
a file twice (once via each path) will always look like a duplicate
conflict on the second pass.

## Why we added a second database

Three things the client asked for turned out to be impossible in GHL,
each tested against the live account rather than assumed:

- **Staff logins.** GHL has no SSO endpoint, so staff cannot sign into
  this app with their GHL credentials.
- **Tasks attached to a job.** A GHL task belongs to a *contact*. See
  the findings section below.
- **A full change history.** GHL keeps 60 days of audit data, and every
  write from this app uses one shared token, so every change would look
  identical anyway.

Supabase covers exactly those gaps and nothing more. Customer-facing
data stays in GHL so the client keeps working the way they already do.

## What has been built

**Dashboard** — one work list grouped by pipeline stage, built from the
stages GHL actually returns rather than a hardcoded list, so adding a
stage in GHL shows up here automatically. Search, filters, staff
assignment, and stage changes are all done from the row.

**Jobs** — a 7-step date chain drives the pipeline. Entering a date
moves the job to the matching stage, which fires the same GHL workflows
as dragging the card in GHL. Overview, progress, history, notes, tasks
and crew are accordions.

**+ New** — adds a customer (GHL's workflow then creates their first
job) or adds another job for an existing customer, named
`Customer Name - Address` to match what the workflow produces.

**Tasks** — created per job, assigned to staff, chained so one task can
depend on another, and built from reusable task-list templates.

**Staff** — email/password logins with two roles. Admins see everything;
workers see only jobs they are on, either by being assigned to the job
or by holding a task on it. The database enforces this, not just the UI.

**Open Conversation** — opens the customer in GoHighLevel, where calling,
texting and email all live. Explained under "Calling and messaging".

**Room measurement** — the original tool, unchanged.

## Calling and messaging

**Why the app does not place calls itself.** GoHighLevel has no API for
making a call — the entire phone-system API is: list numbers, buy
numbers. A plain `tel:` link dials from the staff member's own SIM, so
the customer sees a personal number and GHL never records the call.

**What the app does instead.** The green **Open Conversation** button
opens that customer in GoHighLevel. The staff member is signed in there
as themselves, so the call, text or email goes out on their own business
number and is recorded against them. A smaller **Direct call** button
sits beside it for a quick call where none of that matters.

**Verified by reading the live account (August 2026):**

| Question | Answer |
|---|---|
| Can the app read message history? | Yes — SMS, email, calls, webchat |
| Is the sender recorded? | Yes, when sent from GHL's own app |
| Are staff using separate numbers? | Yes — two different sender numbers seen in one thread |
| Could the app send SMS/email? | Yes — it can choose the sender number or address |
| Can messages be split per job? | **No** — see below |
| Can the app record *who* sent it? | **No** — the send API accepts no user field |

**The limit worth telling the client:** a conversation belongs to the
**customer**, not the job. One test customer has three jobs and exactly
one conversation thread. Checked across every contact: never more than
one thread each. So if messaging is ever built into the app, a customer's
Kitchen and Bathroom messages will appear together and cannot be
separated.

## Findings: tasks cannot be linked to a job in GHL

The client asked for tasks to sync both ways with GoHighLevel. They
cannot, and the reason is worth keeping because it will come up again.

GoHighLevel's own interface *does* show a task attached to an
opportunity — there is an "Associated objects" panel on the task. But
that link is not reachable through the API:

- Task endpoints exist only under `/contacts/{id}/tasks`.
- The `TaskCreate` webhook carries `contactId` and no opportunity.
- Task search filters by contact; sending `opportunityId` is rejected
  outright: *"property opportunityId should not exist"*.
- Attempting to create a task↔opportunity association returns GHL's own
  error: *"Only 'contact, opportunity, business' object key(s) can be
  used as standard object key for creating associations"*.

The association API itself works — the same call correctly returns the
Room↔Job links this app creates. It returns nothing for tasks because
tasks are not part of that system.

**This is not a scopes problem.** All four association scopes were added
and are what made the testing above possible.

**Consequence:** tasks created in GHL cannot be pulled into the app
against the right job, and tasks created in the app cannot be pushed
onto the opportunity. This is why tasks live in Supabase, attached to
the job — which is what the business actually needs.

## Known gaps / things not built yet

- Messaging inside the app — possible, with the two limits noted above
- Call recordings — readable in principle, endpoint not yet confirmed
- Cascade dates: shifting one task does not shift the ones after it
- CSV import has no Smartlist/Workflow enrollment options, and isn't
  resumable if interrupted mid-run
- Task reminders/notifications
- The GHL token exposed early in the project has still not been rotated
- The proxy has no authentication of its own: anyone who knows the URL
  can call the GHL API through it
