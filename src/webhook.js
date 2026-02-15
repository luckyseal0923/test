export async function fireWebhook({ webhookUrl, payload }) {
  if (!webhookUrl) return { ok: true, skipped: true };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: text.slice(0, 2000) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

