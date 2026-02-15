export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function mustToken() {
  const token = qs('token') || '';
  if (!token) throw new Error('Missing token');
  return token;
}

export function getDocIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // /doc/:docId/config | /doc/:docId/dashboard | /sign/:docId
  if (parts[0] === 'doc') return parts[1];
  if (parts[0] === 'sign') return parts[1];
  return null;
}

export function el(id) {
  return document.getElementById(id);
}

export async function apiJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (json && json.error) ? json.error : `HTTP_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

