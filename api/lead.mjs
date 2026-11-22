/* ═══════════════════════════════════════════
   Lead intake → GoHighLevel (LeadConnector API v2)

   Vercel Function, served at /api/lead. Both site forms POST JSON here.
   The token never reaches the browser.

   Environment variables (set in Vercel → Project → Settings → Environment
   Variables, or in a local .env for `vercel dev`). Configure either route,
   or both:

   Webhook route — a GHL workflow with an Inbound Webhook trigger receives
   every submission and creates the contact itself:
     GHL_WEBHOOK_URL  The trigger URL. Keep it out of the repo: anyone who has
                      it can post fake leads.

   API route — the contact is upserted directly, no workflow needed:
     GHL_TOKEN        Private Integration token, scopes: contacts.write,
                      contacts.readonly
     GHL_LOCATION_ID  Sub-account (location) ID

   With both set, the contact is upserted first and the webhook then gets a
   copy (including contactId); a webhook failure is only logged. With only the
   webhook set, a webhook failure fails the request so the visitor is told.
   ═══════════════════════════════════════════ */

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

/* Custom fields to create in GHL → Settings → Custom Fields.
   Keys must match exactly; types are what the dashboard should be set to. */
const CUSTOM_FIELDS = [
  ['event_date', 'date'],       // Date
  ['event_type', 'type'],       // Dropdown — options must match the <select>
  ['event_details', 'message']  // Multi-line text
];

const MAX_LEN = 5000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

/* GHL rejects anything that is not E.164, and SMS steps then fail silently.
   Bare 10-digit input is assumed US/Canada — adjust if that stops being true. */
const toE164 = (raw) => {
  if (!raw) return undefined;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.length > 7 ? digits : undefined;
  const d = digits.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length > 7 ? `+${d}` : undefined;
};

const clean = (v) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_LEN) : undefined;

const splitName = (full) => {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift(), lastName: parts.join(' ') || undefined };
};

/* Web-standard handler: Vercel routes POST /api/lead here; any other method
   gets an automatic 405. */
export async function POST(req) {
  const { GHL_TOKEN, GHL_LOCATION_ID, GHL_WEBHOOK_URL } = process.env;
  const useApi = Boolean(GHL_TOKEN && GHL_LOCATION_ID);
  if (!useApi && !GHL_WEBHOOK_URL) {
    console.error('lead: set GHL_WEBHOOK_URL, or GHL_TOKEN and GHL_LOCATION_ID');
    return json({ error: 'not configured' }, 500);
  }

  let d;
  try {
    d = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  /* Honeypot. Bots fill every field they find, so a value here means a bot.
     Answer 200 so it never learns the difference. */
  if (clean(d.company)) return json({ ok: true });

  const email = clean(d.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: 'a valid email is required' }, 400);
  }

  const isNewsletter = d.source === 'Website — newsletter';
  const { firstName, lastName } = splitName(clean(d.name));

  /* ── Marketing consent ────────────────────────────────────────────────
     A booking enquiry is NOT consent to marketing. The only two things that
     grant it are:
       1. submitting the newsletter form, whose sole purpose is marketing, or
       2. ticking the separate optional box on the booking form.
     Anything else gets the enquiry tags alone and must not be marketed to.
     Never infer consent from the presence of an email address.            */
  const marketingConsent = isNewsletter || d.marketingConsent === 'yes';

  const customFields = CUSTOM_FIELDS
    .map(([key, from]) => ({ key, field_value: clean(d[from]) }))
    .filter((f) => f.field_value);

  const tags = isNewsletter
    ? ['newsletter', 'website']
    : ['booking-enquiry', 'website'];

  /* Tag rather than a custom field so no dashboard setup is needed — an
     undefined custom-field key makes the whole upsert fail. Use this tag as
     the segment your marketing sends to; never send to 'website'. */
  if (marketingConsent) tags.push('marketing-consent');

  const payload = {
    locationId: GHL_LOCATION_ID,
    email,
    firstName,
    lastName,
    phone: toE164(clean(d.phone)),
    source: clean(d.source) || 'Website',
    tags,
    customFields
  };

  let contactId;
  if (useApi) {
    const res = await fetch(`${GHL_API}/contacts/upsert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: GHL_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      /* Log the body — GHL returns the offending field name, which is the
         only way to tell a bad custom-field key from a bad token. */
      console.error('lead: GHL upsert failed', res.status, await res.text());
      return json({ error: 'upstream' }, 502);
    }

    const contact = await res.json().catch(() => ({}));
    contactId = contact?.contact?.id;
  }

  if (GHL_WEBHOOK_URL) {
    const now = new Date().toISOString();
    /* Flat, already-cleaned fields so the workflow can map each one directly
       in its Create/Update Contact step. */
    const hook = {
      email,
      firstName,
      lastName,
      fullName: clean(d.name),
      phone: payload.phone,
      source: payload.source,
      formType: isNewsletter ? 'newsletter' : 'booking',
      tags: tags.join(','),
      eventDate: clean(d.date),
      eventType: clean(d.type),
      eventDetails: clean(d.message),
      page: clean(d.page),
      contactId,
      /* Consent evidence: you must be able to show WHAT was consented to
         and WHEN. Persist these fields wherever the webhook lands. */
      marketingConsent,
      consentRecordedAt: now,
      receivedAt: now
    };

    let ok = false;
    try {
      const r = await fetch(GHL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hook)
      });
      ok = r.ok;
      if (!ok) console.error('lead: webhook failed', r.status, await r.text());
    } catch (err) {
      console.error('lead: webhook failed', err);
    }

    /* Webhook-only: it is the sole record of the lead, so a failure must
       reach the visitor. With the API route the contact already exists. */
    if (!ok && !useApi) return json({ error: 'upstream' }, 502);
  }

  return json({ ok: true });
}
