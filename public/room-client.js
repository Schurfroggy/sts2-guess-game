export const byId = (id) => document.getElementById(id);

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function roomRequest(path = '', data) {
  const response = await fetch('/api/room' + path, {
    cache: 'no-store', signal: AbortSignal.timeout(8000),
    ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '房间服务暂时不可用。');
  return result;
}

export function readPreference(name) {
  try { return localStorage.getItem('spire.' + name) ?? ''; } catch { return ''; }
}

export function savePreference(name, value) {
  try { localStorage.setItem('spire.' + name, value); } catch {}
}
