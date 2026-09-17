const BASE = "";

interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function api<T = unknown>(
  url: string,
  options?: ApiOptions
): Promise<T> {
  const { body, ...rest } = options || {};
  const res = await fetch(`${BASE}${url}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...rest?.headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    let message = err;
    try { const parsed = JSON.parse(err); message = typeof parsed.error === 'string' ? parsed.error : typeof parsed.message === 'string' ? parsed.message : err; } catch { /* Non-JSON server response. */ }
    throw new Error(message || `Request failed (${res.status}).`);
  }
  return res.json();
}
