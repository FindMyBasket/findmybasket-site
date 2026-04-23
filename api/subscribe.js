export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const LIST_ID = '7adbac12f5';
  const DC = 'us9';

  try {
    const response = await fetch(
      `https://${DC}.api.mailchimp.com/3.0/lists/${LIST_ID}/members`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: email,
          status: 'subscribed',
        }),
      }
    );

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json({ success: true });
    }

    if (data.title === 'Member Exists') {
      return res.status(200).json({ success: true, existing: true });
    }

    return res.status(400).json({ error: data.detail || 'Signup failed' });

  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
