# How This App Works

A plain-language reference for what this app does, where its data lives,
and how the pieces connect. Written for discussion, not as a spec —
update it as we make decisions.

## The one core idea

**This app has no database of its own.** Every piece of data you see —
Jobs, Rooms, Walls, Photos, everything — lives inside your client's GHL
account. The app is a custom frontend that reads and writes to GHL's
API. If GHL doesn't have it, the app can't show it.

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

## Where the code lives (post-rebuild structure)

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
| `js/contacts.js` | Contacts tab: read-only list + detail view, pulled from GHL's `/contacts/` endpoint (separate from Opportunities) |
| `js/app.js` | Screens, navigation, tab bar, Jobs list, Room detail, wiring everything together, app boot |
| `netlify/functions/ghl-proxy.js` | Server-side proxy — holds the real GHL API token so it's never exposed in the browser |
| `netlify.toml` | Tells Netlify to rewrite `/api/*` calls to that proxy function |

## Why there's a proxy function at all

The original single-file version called GHL directly from the browser
with the API token hardcoded in plain text — visible to anyone who
viewed the page source. Now the browser calls our own `/api/*` on the
same domain, which Netlify silently forwards to the proxy function,
which attaches the real token server-side. The token lives only in
Netlify's environment variables (`GHL_API_KEY`), never in any file.

## Contacts tab

A second top-level tab, separate from Jobs. This talks to GHL's
**Contacts** API directly (`GET /contacts/`) — not Opportunities — so it
shows every Contact in the location, including ones with no Opportunity
attached (unlike the Jobs tab).

- Read-only: view + search only. No create/edit/delete from the app.
- Search matches name/phone/email (whatever GHL's `query` param covers).
- Tapping a contact shows a detail view: name, phone, email, business,
  tags, created date. No link to that contact's Job/Opportunity yet —
  possible future addition.

## Known gaps / things not built yet

- No "create a new Job" flow from inside the app (must be done in GHL directly)
- No filter for Job status (Open/Won/Lost) — shows everything
- Contacts tab is view-only — no create/edit/delete, and no link from a
  contact to their Job even if one exists
- No leads dashboard, filters, or reporting — this is purely the
  measurement capture tool, unchanged in scope from the original build
