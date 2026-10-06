# Sheet → GoHighLevel lead sync

**Live since 5 Oct 2026.** Leads the marketing team types into the Google
Sheet become GoHighLevel contacts and jobs on their own, within about 10
minutes.

This is **not part of the app**. It is a Google Apps Script that lives inside
the Google Sheet and runs on Google's servers. The code lives **only** in
the sheet under **Extensions → Apps Script**. It is not kept in this repo.
To change it, open it there, or paste it into a chat so it can be edited.

---

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Google Sheet "Maximus Construction NJ LLC", tab **Sheet1** | Google Drive | The marketing team's leads. The script **reads** it and never writes to it |
| Apps Script (`Code.gs`) | Inside that sheet | Every 5 minutes: finds new rows, cleans them, and sends them |
| Groq AI, model `openai/gpt-oss-120b` | api.groq.com | Reads a messy row and pulls out name, phone, email, address and scope |
| Tab **Clean** | Same sheet | The tidy copy of each lead, its status, and the ON/OFF switch |
| Tab **_seen** (hidden) | Same sheet | The script's memory of rows already handled |
| GHL workflow **"Sheet leads (TEST)"** | GoHighLevel | Inbound Webhook → Create/Update Contact |
| WF-1 "Auto Job Creation" | GoHighLevel | Already existed: a new contact gets a job in New Lead |

**Groq API key:** from the **Maximus Digital Marketing** Groq account. It is
on Groq's free tier, so it costs nothing at this volume.

**Secrets live in Script Properties, never in the code**
(Apps Script → Project Settings → Script properties):

| Property | Value |
|---|---|
| `GROQ_KEY` | The Groq API key (Maximus Digital Marketing account) |
| `WEBHOOK_URL` | The Inbound Webhook URL from the GHL workflow trigger |

Anyone who has the webhook URL can create contacts in GoHighLevel, so it is
never pasted into chat or into the code.

---

## How a lead flows

```
Marketing types a row in Sheet1
        │
        ▼  (every 5 min, time trigger "checkNewRows")
Script sees a row it has never seen
        │
        ▼  waits until the row has stayed the same for 4+ minutes
Groq AI reads the whole row → name, phone, email, street, city, state, zip, scope
        │
        ▼  simple checks (code, not AI)
Written to the Clean tab:  "Ready"  or  "Needs check: <reason>"
        │
        ▼  only if Ready AND O1 = ON
POST to the GHL Inbound Webhook
        │
        ▼
GHL workflow: Create/Update Contact  ──►  WF-1 creates the job in New Lead
```

## Why an AI is used

The sheet is messy:
- **Two layouts.** Most rows keep the name in G and the phone in I. Some are
  shifted, with the name in I and the phone in K.
- **The address is free text in one cell**, e.g.
  `908 sherwood rd, bridgewater nj, Bridgewater 08007`, with the town twice.

Fixed columns get the shifted rows wrong, and rules get the addresses wrong.
So the AI reads the whole row with each cell labelled by its column letter,
and plain code checks its answer.

## The checks (in code, not AI)

A row is marked **Needs check** and is **never sent** when:
- the phone isn't 10 digits
- the email is malformed, or has a known typo (`.comk`, `.con`, `gmial`,
  `hotmial` and similar)
- it has no phone and no email
- it has no first name
- the zip isn't 5 digits, or the state isn't 2 letters

It also tidies the data:
- the phone is formatted as `(732) 555-0303`
- all-lowercase or ALL-CAPS names and towns are capitalised. Mixed case like
  "McDonald" is left alone.
- the state comes from the zip when it is missing (07xxx/08xxx → NJ)
- the zip is stored as text on the Clean tab, so `08840` keeps its 0

## Which rows count as "new"

- `setup()` marked all **80 rows** already in the sheet as seen on go-live.
  None of them were sent.
- Rows are recognised by their **content** (a SHA-256 of the cells), not by
  their row number. Inserting or sorting rows doesn't make old rows look new.
- **Editing an old row changes its content, so it counts as new and is sent
  again.** In GHL that **updates** the existing contact (matched by phone or
  email). There is no duplicate contact and no new job, because WF-1 only fires
  on *Contact Created*.
- **The 4-minute wait** stops half-typed rows from being sent. If someone
  leaves a row half-done for more than 4 minutes, it is cleaned as it is.
  With no phone or email it is held as Needs check. With a name and phone but
  no address, it is sent, and the job title won't have the street.
- On the Clean tab, the same phone or email updates the existing line rather
  than adding a second one.

## The ON/OFF switch

Cell **O1** on the **Clean** tab. Only **ON** sends anything. Type **OFF**
to stop at once, with no code change. `setup()` creates it as OFF.
Column **M** shows `Sent <time>` or `Failed: <reason>`.

## The GHL workflow

- **Trigger:** Inbound Webhook (premium). The mapping reference was taken
  from `sendSample()`.
- **Action:** Create/Update Contact. Each field is mapped from
  *Inbound Webhook Trigger*: first_name, last_name, phone, email, address1,
  city, state, postal_code, source.
- **No emails, SMS or other actions**, at the client's request.
- "Allow duplicate contacts" is **OFF** for the whole account. Leave it off.

Payload sent by the script:

```json
{ "first_name", "last_name", "phone", "email", "address1", "city",
  "state", "postal_code", "scope", "source": "Google Sheet", "sheet_row" }
```

## Known behaviour

- **The app shows only the street** for jobs created by WF-1, e.g. "5 Lake Dr"
  instead of the full address. The contact has the full address. Agreed: we
  don't change any workflow for this. It is the same for every WF-1 job.
- Up to 15 rows per run (Google's time limit). Any extra rows wait for the
  next run.
- If Groq or the network fails, the row is left unseen and retried on the
  next run.

## Functions

| Function | When to run |
|---|---|
| `setup()` | **Once**, when installing on a sheet. It marks every existing row as seen, creates the Clean tab, the switch and the 5-min trigger. Re-running it marks everything currently in the sheet as seen |
| `checkNewRows()` | Never by hand. The timer runs it |
| `testNow()` | Testing only: cleans new rows at once, without the 4-minute wait |
| `sendSample()` | Only when building a new GHL webhook trigger, to give it a mapping reference |

## Testing history

1. Tested on a **copy** of the sheet with O1 OFF: shifted rows, a
   single-cell address, a missing state, lowercase names and `.comk` emails
   were all handled.
2. Copy with O1 ON: "Test Lima" created a contact and a job. Then two fixes:
   the zip lost its leading 0 on the Clean tab (GHL itself was fine), and the
   Sent time used a different time zone.
3. Moved to the **real sheet** (the copy's trigger was removed, and the copy
   deleted). "Test Nora" went through end to end on the timer alone.

Test contacts are deleted from GHL afterwards. It's live data, so never test
on real customers.
