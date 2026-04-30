// /api/category-interest.js
// Handles "notify me when [category] launches" signups from the homepage roadmap.
// Writes to public.category_interest in Supabase using the service_role key,
// so the client-facing anon key never sees write access to this table.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { email, category } = req.body || {};

    // Basic validation
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    if (!['hair', 'makeup', 'supplements'].includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid category' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Missing Supabase env vars');
      return res.status(500).json({ success: false, error: 'Server misconfiguration' });
    }

    // Insert via REST API. The unique (email, category) constraint will reject
    // duplicates — we treat that as success ("already subscribed") rather than error.
    const response = await fetch(`${SUPABASE_URL}/rest/v1/category_interest`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ email: trimmedEmail, category })
    });

    if (response.ok) {
      return res.status(200).json({ success: true, alreadyRegistered: false });
    }

    // Duplicate (email/category combo already exists) — treat as success
    if (response.status === 409) {
      return res.status(200).json({ success: true, alreadyRegistered: true });
    }

    const errorBody = await response.text();
    console.error('Supabase insert failed:', response.status, errorBody);
    return res.status(500).json({ success: false, error: 'Could not register interest' });
  } catch (err) {
    console.error('category-interest handler error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}
