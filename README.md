# Kent Axell — Psychological Illusionist

Static marketing site built to convert enquiries into bookings. No build step and no
front-end dependencies. Both forms feed GoHighLevel through a single serverless
function, so deploy to a host that runs functions — Netlify as configured here,
or Cloudflare Pages / Vercel with the handler moved and `ENDPOINT` in
`assets/js/main.js` repointed.

```
kent-axell-site/
├── index.html
├── assets/
│   ├── css/styles.css
│   ├── js/main.js
│   └── img/            ← 15 photos from the supplied media folder
├── netlify/
│   └── functions/
│       └── lead.mjs    ← form intake → GoHighLevel
├── netlify.toml
├── .env.example
└── README.md
```

Preview locally:

```
serve.cmd
```

Double-click it, or run `serve` from a terminal in this folder. It uses `netlify dev`
if the CLI is installed and falls back to a plain static server if not, either way on
**http://localhost:8181**.

The difference matters for the forms only. A static server renders the whole page
correctly, but submitting an enquiry will 404, because the form posts to
`/.netlify/functions/lead`. To exercise that path:

```bash
npm i -g netlify-cli
```

…then `serve.cmd` picks it up automatically. The equivalents by hand:

```bash
python -m http.server 8181     # markup, styles and behaviour only
netlify dev --port 8181        # adds the lead function
```

---

## Before this goes live

Ordered by how much each one matters.

### 1. Connect GoHighLevel — 15 minutes, then the forms are live

Both forms POST JSON to `/.netlify/functions/lead`, which upserts the contact into
GHL via the LeadConnector API v2. The code is written; it needs three things from
your GHL sub-account before it will do anything.

**a. Create the custom fields.** Settings → Custom Fields. The keys must match
exactly or the values arrive empty.

| Form input | GHL field key | Type |
|---|---|---|
| `name` | *(standard First / Last Name)* | — |
| `email` | *(standard Email)* | — |
| `phone` | *(standard Phone)* | — |
| `date` | `event_date` | Date |
| `type` | `event_type` | Dropdown — paste the six `<option>` values from `index.html` verbatim |
| `message` | `event_details` | Multi-line text |

**b. Create a Private Integration token.** Settings → Private Integrations → Create,
with scopes `contacts.write` and `contacts.readonly`. Copy the token once — GHL will
not show it again.

**c. Set the environment variables.** Netlify → Site configuration → Environment
variables:

```
GHL_TOKEN=pit-…
GHL_LOCATION_ID=…
GHL_WEBHOOK_URL=          # optional, see below
```

Locally, copy `.env.example` to `.env` and run `netlify dev` instead of
`python -m http.server` — the plain static server has no functions, so submissions
will 404.

#### Testing it

```bash
curl -X POST http://localhost:8888/.netlify/functions/lead   -H 'Content-Type: application/json'   -d '{"name":"Test Person","email":"test@example.com","phone":"702 555 0100",
       "date":"2026-11-02","type":"Gala or fundraiser","message":"Sample",
       "source":"Website — booking enquiry"}'
```

Then check, in order:

1. The contact exists in **Contacts** with the `booking-enquiry` and `website` tags.
2. Every custom field is *populated*, not merely present.
3. Submitting the same email twice updates one contact rather than creating two.
4. The phone stored is `+17025550100`. GHL rejects anything that is not E.164, and
   SMS workflow steps then fail silently — `toE164()` in `lead.mjs` handles the
   common formats and assumes US/Canada for bare 10-digit input.

If a request 502s, the function logs the GHL response body (Netlify → Functions →
`lead`). GHL names the offending field, which is the only reliable way to tell a bad
custom-field key from a bad token. If the custom fields come back empty, fetch
`GET /locations/{locationId}/customFields` and swap `key` for `{ id: '…' }` in
`CUSTOM_FIELDS` — `key` works in most accounts but not all.

#### Spam

Both forms carry a honeypot input (`name="company"`, `.hp` in the CSS) that is
off-canvas rather than `display:none`, because some bots skip anything not rendered.
The handler returns `200 {ok:true}` when it is filled, so the bot never learns the
difference. That stops the naive traffic. If a targeted spammer finds the form, add
Cloudflare Turnstile and verify the token at the top of `lead.mjs`.

#### The automations, in GHL

The `source` string and the tags set by `lead.mjs` are what the workflows key off.
Four worth building, in Automation → Workflows:

- **Booking enquiry — instant response.** Trigger: *Contact Tag Added →
  `booking-enquiry`*. Email the contact immediately → notify Kent internally → wait
  5 min → SMS "Got your enquiry, checking the date" → create an Opportunity in a
  *Bookings* pipeline at stage **Enquiry**.
- **Follow-up ladder.** Continue the same workflow: wait 2 days → If/Else on whether
  the opportunity moved past *Enquiry* → chase → wait 4 days → chase again → wait
  7 days → move to **Cold**. Add a goal or *Remove from workflow* condition on
  `Opportunity Status = Won`, so booked clients stop being chased. This is the step
  people skip and the one that makes an automation look amateur.
- **Date-aware nudge.** Trigger: *Contact Created*. Use a **Wait until** step set
  relative to the `event_date` field (e.g. 30 days before) to fire a pre-event
  logistics email on its own.
- **Newsletter.** Trigger: *Contact Tag Added → `newsletter`*. One welcome email,
  and nothing else. Keep it out of the booking sequence — a newsletter signup should
  never get chased about a booking they did not ask for.

Check the workflow's **Execution Logs** tab after the first real submission; failed
steps do not surface anywhere else.

#### Inbound webhook (optional)

Set `GHL_WEBHOOK_URL` to a workflow's *Inbound Webhook* trigger URL and `lead.mjs`
mirrors the raw payload there after the upsert, so a workflow can branch on fields
that never land on the contact record (`page`, for instance). It fires after the
contact is created and its failure is logged but never fails the request. GHL only
lets you map webhook fields after it has seen one real request, so send the curl
above before opening the mapping UI.

### 2. Replace the placeholder content

Everything below is written to the right length and tone — swap the words, keep the
structure and nothing will reflow badly.

- **Contact details** — `+1 (702) 555-0100` and `book@kentaxell.com` are made up.
  They appear in the utility bar, the booking section and the footer.
- **Testimonials** — three placeholder quotes marked with an HTML comment above them.
  Replace with real, attributable client quotes before launch.
- **Client logos** — ten `Logo` tiles in the references panel. Swap each `<li>Logo</li>
  ` for `<li><img src="assets/img/logos/acme.svg" alt="Acme"></li>`.
- **Showreel** — the three video cards are images with a play button that currently
  link to `#contact`. Point them at real YouTube/Vimeo URLs, or swap in a lightbox.
- **Social links** — Instagram and YouTube in the footer are `#`.
- **Legal** — Privacy and Imprint links are `#`.

### 3. Compress the images

`assets/img/` is **9.4 MB**. That is the one thing that will hurt this site. The worst
offender is `kent-portrait.png` at 2.5 MB.

No image tooling was available on this machine, so the originals were copied as-is.
Run them through [Squoosh](https://squoosh.app) or:

```bash
# WebP at ~82% typically takes this folder to well under 1.5 MB
for f in assets/img/*.jpg; do cwebp -q 82 "$f" -o "${f%.jpg}.webp"; done
```

Then either rename the references in `index.html`, or use `<picture>` with a JPEG
fallback. Keep `kent-portrait` as PNG or WebP — it needs its transparency.

---

## Design system

Lifted from the reference layout, adapted to Kent's own stage identity (his backdrop
logo is teal on near-black, so the ground tone leans green rather than neutral).

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0B120E` | page ground |
| `--ink-2` | `#0F1913` | utility bar, newsletter |
| `--panel` | `#33473C` | references + FAQ panels |
| `--gold` | `#D9A94B` | primary accent, all CTAs |
| `--gold-lite` | `#F0CE82` | hover |
| `--teal` | `#6FB6C8` | reserved — echo of the stage logo |
| `--cream` | `#F4EFE4` | body text |

**Type** — **Bricolage Grotesque** (300–800, variable, with a live optical-size axis)
for display; **Instrument Sans** (400–600) for body.

Bricolage is doing the heavy lifting: tight apertures, a squared-off grotesque
skeleton, and a genuinely heavy 800 that holds up at 98px. The optical-size axis is
switched on via `font-optical-sizing:auto`, so the same family tightens its spacing
and thins its joins automatically as the size drops — you get display-cut headlines
and text-cut labels from one file.

Display leading is `.98` — tight enough that multi-line caps headlines lock into a
block. That, more than the size, is what makes big type read as current.

Instrument Sans has no 300 weight, so body copy sits at 400. Don't write
`font-weight:300` on body text; it silently clamps to 400 and the CSS then lies about
what it renders.

Headings alternate light and heavy word-groups, which is the reference's signature
move. The heavy words are just `<strong>`:

```html
<h2>Moments <strong>that speak</strong> for themselves</h2>
```

### Two floors worth keeping

**Contrast** — dim text tints are floored at 52% opacity, which holds ≥5:1 against
`--ink`. Inside the lighter `--panel`, dim text is lifted to 70%. Don't introduce a
dimmer tint for text without re-checking it.

**Size** — no functional text sits below **11px**, including the tracked-caps micro
labels (brand descriptor, image captions, field labels, the scroll cue). Several of
these started at 8.5–10px and were raised; where that made a label too wide, the
letter-spacing came down rather than the size. If you add a new micro-label, 11px is
the floor.

FAQ questions are sentence case rather than uppercase — they're full sentences, and
all-caps costs real reading speed at that length. The uppercase treatment is kept for
the three service-row headings, which are short enough to carry it.

---

## Notes on behaviour

- **Sticky header** gains its background past 24px of scroll (`.stuck`).
- **Scroll reveal** via `IntersectionObserver`; stagger with `data-d="1..4"`.
- **Marquee bands** are pure CSS, duplicated twice for a seamless loop. If you edit
  the words, edit *both* `.marquee__set` blocks identically or the loop will jump.
- **Testimonials** are a 3-up grid on desktop and a snap-scroll rail with dots below
  820px. Dots are generated in JS from however many `<blockquote>`s exist.
- **FAQ** uses native `<details>`, with JS closing siblings so only one is open.
- **`prefers-reduced-motion`** kills the marquees, the hero drift and all reveals.

## Browser support

Evergreen Chrome, Edge, Firefox and Safari. Uses `:has()`-free CSS, but does rely on
`backdrop-filter`, `aspect-ratio`, `clamp()`, `rotate`/`translate` shorthands and
`100dvh`. `:user-invalid` on form fields degrades silently where unsupported.
