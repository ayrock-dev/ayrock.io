import { html } from 'hono/html';

const client_script = `
const api = (path, init) =>
  fetch('/api' + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const el = (id) => document.getElementById(id);
const friendly_name = { busybar: 'Busy Bar', spotify: 'Spotify' };

function badge(label, on) {
  const cls = on
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-slate-100 text-slate-400';
  return (
    '<span class="rounded-full px-2 py-0.5 text-xs font-medium ' +
    cls +
    '">' +
    label +
    (on ? ' ✓' : '') +
    '</span>'
  );
}

function render_devices(devices) {
  const list = el('device-list');
  if (devices.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-500">No devices yet.</p>';
    return;
  }
  list.innerHTML = devices
    .map(
      (d) =>
        '<div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">' +
        '<div class="flex items-center justify-between">' +
        '<span class="font-medium text-slate-900">' +
        (d.name ?? '(unnamed)') +
        '</span>' +
        '<code class="text-xs text-slate-400">' +
        d.id +
        '</code></div>' +
        '<div class="mt-2">' +
        badge('Busy Bar', d.busybar) +
        '</div></div>',
    )
    .join('');
}

function render_connections(conns) {
  const list = el('conn-list');
  if (conns.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-500">No connections yet.</p>';
    return;
  }
  list.innerHTML = conns
    .map((conn) => {
      let right = '';
      if (conn.type === 'spotify') {
        const img = conn.image_url
          ? '<img class="size-8 rounded-full" src="' + conn.image_url + '" alt="" />'
          : '<div class="size-8 rounded-full bg-slate-200"></div>';
        right =
          '<div class="flex items-center gap-2">' +
          img +
          '<span class="text-sm text-slate-600">' +
          (conn.display_name ?? 'Linked') +
          '</span></div>';
      }
      return (
        '<div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">' +
        '<span class="text-sm font-medium text-slate-900">' +
        (friendly_name[conn.type] ?? conn.type) +
        '</span>' +
        right +
        '</div>'
      );
    })
    .join('');
}

async function load() {
  const [dres, cres] = await Promise.all([api('/devices'), api('/connections')]);
  if (dres.ok) render_devices(await dres.json());
  if (cres.ok) render_connections(await cres.json());
}

async function add_device(e) {
  e.preventDefault();
  const name = el('device-name').value.trim();
  const token = el('device-token').value.trim();
  const body = { name: name || null };
  if (token) body.busybar_auth = token;
  const res = await api('/devices', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.ok) {
    el('device-name').value = '';
    el('device-token').value = '';
    await load();
  }
}

function link_spotify() {
  window.location.href = '/api/connections/spotify/authorize';
}

document.addEventListener('DOMContentLoaded', () => {
  el('add-device-form').addEventListener('submit', add_device);
  el('link-spotify').addEventListener('click', link_spotify);
  load();
});
`;

function Layout() {
  const card = 'rounded-xl border border-slate-200 bg-white p-6 shadow-sm';
  const label = 'block text-sm font-medium text-slate-700';
  const input =
    'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none';
  const button =
    'cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700';
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>busy</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" />
      </head>
      <body class="min-h-screen bg-slate-50 text-slate-900">
        <div class="mx-auto max-w-sm px-4 py-10">
          <header class="mb-8">
            <h1 class="font-semibold text-2xl">busy</h1>
            <p class="text-slate-500 text-sm">
              Manage devices and connections.
            </p>
          </header>

          <section class="mb-8">
            <h2 class="mb-3 font-medium text-lg">Devices</h2>
            <div id="device-list" class="mb-4 grid gap-3" />
            <form id="add-device-form" class={card}>
              <label class={label} for="device-name">
                Add device
              </label>
              <div class="mt-1 grid gap-2">
                <input
                  id="device-name"
                  class={input}
                  placeholder="Device name (optional)"
                />
                <input
                  id="device-token"
                  class={input}
                  placeholder="Busy Bar token (optional)"
                />
                <button class={button} type="submit">
                  Add
                </button>
              </div>
            </form>
          </section>

          <section>
            <h2 class="mb-3 font-medium text-lg">Connections</h2>
            <div id="conn-list" class="mb-4 grid gap-3" />
            <div class={card}>
              <span class={label}>Add connection</span>
              <button id="link-spotify" class={`mt-2 ${button}`} type="button">
                Link Spotify
              </button>
            </div>
          </section>
        </div>
        <script dangerouslySetInnerHTML={{ __html: client_script }} />
      </body>
    </html>
  );
}

export function render_page() {
  return html`<!doctype html>${<Layout />}`;
}
