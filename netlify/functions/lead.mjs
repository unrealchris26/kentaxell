/* ═══════════════════════════════════════════
   Lead intake → GoHighLevel (LeadConnector API v2)

   Both site forms POST JSON here. The token never reaches the browser.

   Required environment variables (set in Netlify → Site configuration →
   Environment variables, or in a local .env for `netlify dev`):

     GHL_TOKEN        Private Integration token, scopes: contacts.write,
                      contacts.readonly
     GHL_LOCATION_ID  Sub-account (location) ID

   Optional:
     GHL_WEBHOOK_URL  Inbound-webhook trigger URL. If set, the payload is
                      mirrored to it after the contact upsert, so a workflow
                      can react to fields that are not stored on the contact.
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

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const { GHL_TOKEN, GHL_LOCATION_ID, GHL_WEBHOOK_URL } = process.env;
  if (!GHL_TOKEN || !GHL_LOCATION_ID) {
    console.error('lead: GHL_TOKEN or GHL_LOCATION_ID is not set');
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

  const customFields = CUSTOM_FIELDS
    .map(([key, from]) => ({ key, field_value: clean(d[from]) }))
    .filter((f) => f.field_value);

  const payload = {
    locationId: GHL_LOCATION_ID,
    email,
    firstName,
    lastName,
    phone: toE164(clean(d.phone)),
    source: clean(d.source) || 'Website',
    tags: isNewsletter
      ? ['newsletter', 'website']
      : ['booking-enquiry', 'website'],
    customFields
  };

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
    /* Log the body — GHL returns the offending field name, which is the only
       way to tell a bad custom-field key from a bad token. */
    console.error('lead: GHL upsert failed', res.status, await res.text());
    return json({ error: 'upstream' }, 502);
  }

  const contact = await res.json().catch(() => ({}));

  /* Optional mirror to an Inbound Webhook workflow trigger. Failure here must
     not fail the request — the contact already exists at this point. */
  if (GHL_WEBHOOK_URL) {
    try {
      await fetch(GHL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...d,
          phone: payload.phone,
          contactId: contact?.contact?.id,
          receivedAt: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error('lead: webhook mirror failed', err);
    }
  }

  return json({ ok: true });
};
