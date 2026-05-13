'use strict';

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    toast('Not authenticated — please log in via Authelia and reload', 'error');
    throw new Error('Unauthorised');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Sidebar mobile toggle ─────────────────────────────────────────────────
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('active');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

document.getElementById('sidebar-toggle').addEventListener('click', openSidebar);
document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// ── Admin logout ──────────────────────────────────────────────────────────
document.getElementById('admin-logout-link').addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = 'https://auth.schroth.ca/logout?rd=https://schroth.ca';
});

// ── Navigation ────────────────────────────────────────────────────────────
const navItems = document.querySelectorAll('.nav-item');
const panels   = document.querySelectorAll('.panel');

let metricsRefreshTimer = null;

function showPanel(id) {
  if (metricsRefreshTimer) { clearInterval(metricsRefreshTimer); metricsRefreshTimer = null; }
  panels.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));
  document.getElementById(`panel-${id}`).classList.add('active');
  document.querySelector(`[data-panel="${id}"]`).classList.add('active');
  if (id === 'live-metrics') {
    loadLiveMetrics();
    metricsRefreshTimer = setInterval(loadLiveMetrics, 30000);
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    showPanel(item.dataset.panel);
    closeSidebar();
  });
});

// ── Categories Panel ──────────────────────────────────────────────────────
let categories = [];

async function loadCategories() {
  categories = await api('GET', '/api/admin/categories');
  renderCategories();
}

function renderCategories() {
  const tbody = document.getElementById('cat-tbody');
  tbody.innerHTML = '';

  for (const cat of categories) {
    const tr = document.createElement('tr');
    tr.dataset.id = cat.id;
    tr.draggable = true;
    tr.innerHTML = `
      <td><span class="drag-handle">⠿</span></td>
      <td>
        <span class="colour-swatch" style="background:${cat.colour}"></span>
        ${escHtml(cat.name)}
      </td>
      <td>
        <code style="font-size:0.7rem;color:var(--text-dim)">${escHtml(cat.colour)}</code>
      </td>
      <td class="row-actions">
        <button class="btn btn-sm btn-secondary" onclick="editCategory(${cat.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCategory(${cat.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  setupDragSort(tbody, saveCategoryOrder);
}

function editCategory(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  document.getElementById('edit-cat-id').value = cat.id;
  document.getElementById('edit-cat-name').value = cat.name;
  document.getElementById('edit-cat-colour').value = cat.colour;
  document.getElementById('edit-cat-form').style.display = 'block';
  document.getElementById('edit-cat-form').scrollIntoView({ behavior: 'smooth' });
}

async function deleteCategory(id) {
  if (!confirm('Delete this category? Services in it will become uncategorised.')) return;
  try {
    await api('DELETE', `/api/admin/categories/${id}`);
    toast('Category deleted');
    await loadCategories();
    await loadServices();
  } catch (e) {
    toast('Error deleting category', 'error');
  }
}

async function saveCategoryOrder(items) {
  await api('POST', '/api/admin/categories/reorder', items);
}

// Add category form
document.getElementById('add-cat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name   = document.getElementById('new-cat-name').value.trim();
  const colour = document.getElementById('new-cat-colour').value;
  if (!name) return;
  try {
    await api('POST', '/api/admin/categories', { name, colour });
    toast('Category added');
    e.target.reset();
    document.getElementById('new-cat-colour').value = '#00e5ff';
    await loadCategories();
  } catch (err) {
    toast('Error adding category', 'error');
  }
});

// Edit category form
document.getElementById('edit-cat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id     = parseInt(document.getElementById('edit-cat-id').value);
  const name   = document.getElementById('edit-cat-name').value.trim();
  const colour = document.getElementById('edit-cat-colour').value;
  const cat    = categories.find(c => c.id === id);
  if (!cat) return;
  try {
    await api('PUT', `/api/admin/categories/${id}`, { name, colour, sort_order: cat.sort_order });
    toast('Category updated');
    document.getElementById('edit-cat-form').style.display = 'none';
    await loadCategories();
    await loadServices();
  } catch (err) {
    toast('Error updating category', 'error');
  }
});

document.getElementById('cancel-edit-cat').addEventListener('click', () => {
  document.getElementById('edit-cat-form').style.display = 'none';
});

// ── Services Panel ────────────────────────────────────────────────────────
let services = [];

async function loadServices() {
  services = await api('GET', '/api/admin/services');
  renderServices();
  populateCategorySelects();
}

function populateCategorySelects() {
  const selects = document.querySelectorAll('.cat-select');
  for (const sel of selects) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">— none —</option>';
    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (String(cat.id) === String(cur)) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function renderServices() {
  const tbody = document.getElementById('svc-tbody');
  tbody.innerHTML = '';

  for (const svc of services) {
    const tr = document.createElement('tr');
    tr.dataset.id = svc.id;
    tr.draggable = true;
    tr.innerHTML = `
      <td><span class="drag-handle">⠿</span></td>
      <td>${escHtml(svc.icon)}</td>
      <td>${escHtml(svc.name)}</td>
      <td style="color:var(--text-dim);font-size:0.75rem">${escHtml(svc.url)}</td>
      <td>
        ${svc.category_name
          ? `<span class="colour-swatch" style="background:${svc.category_colour}"></span>${escHtml(svc.category_name)}`
          : '<span style="color:var(--text-dim)">—</span>'}
      </td>
      <td>
        <span class="colour-swatch" style="background:${svc.accent_colour}"></span>
      </td>
      <td>${svc.requires_auth ? '<span class="auth-tag">Auth</span>' : ''}${svc.disable_when_offline ? `<span class="offline-detect-tag" title="Disabled when offline: ${escHtml(svc.host_name || '?')}">⊘</span>` : ''}</td>
      <td class="row-actions">
        <button class="btn btn-sm btn-secondary" onclick="editService(${svc.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteService(${svc.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  setupDragSort(tbody, saveSvcOrder);
}

function editService(id) {
  const svc = services.find(s => s.id === id);
  if (!svc) return;
  document.getElementById('edit-svc-id').value    = svc.id;
  document.getElementById('edit-svc-name').value  = svc.name;
  document.getElementById('edit-svc-url').value   = svc.url;
  document.getElementById('edit-svc-icon').value  = svc.icon;
  document.getElementById('edit-svc-accent').value = svc.accent_colour;
  document.getElementById('edit-svc-auth').checked = !!svc.requires_auth;
  document.getElementById('edit-svc-desc').value  = svc.description || '';
  document.getElementById('edit-svc-disable-offline').checked = !!svc.disable_when_offline;
  populateCategorySelects();
  document.getElementById('edit-svc-cat').value = svc.category_id || '';
  populateHostDropdown('edit-svc-host-name', svc.host_name || '');
  document.getElementById('edit-svc-form').style.display = 'block';
  document.getElementById('edit-svc-form').scrollIntoView({ behavior: 'smooth' });
}

async function deleteService(id) {
  if (!confirm('Delete this service?')) return;
  try {
    await api('DELETE', `/api/admin/services/${id}`);
    toast('Service deleted');
    await loadServices();
  } catch (e) {
    toast('Error', 'error');
  }
}

async function saveSvcOrder(items) {
  await api('POST', '/api/admin/services/reorder', items);
}

// Add service form
document.getElementById('add-svc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name:                 document.getElementById('new-svc-name').value.trim(),
    url:                  document.getElementById('new-svc-url').value.trim(),
    icon:                 document.getElementById('new-svc-icon').value.trim() || '🔗',
    category_id:          document.getElementById('new-svc-cat').value || null,
    accent_colour:        document.getElementById('new-svc-accent').value,
    requires_auth:        document.getElementById('new-svc-auth').checked,
    description:          document.getElementById('new-svc-desc').value.trim(),
    host_name:            document.getElementById('new-svc-host-name').value.trim(),
    disable_when_offline: document.getElementById('new-svc-disable-offline').checked,
  };
  if (!payload.name || !payload.url) return;
  try {
    await api('POST', '/api/admin/services', payload);
    toast('Service added');
    e.target.reset();
    document.getElementById('new-svc-accent').value = '#00e5ff';
    await loadServices();
  } catch (err) {
    toast('Error adding service', 'error');
  }
});

// Edit service form
document.getElementById('edit-svc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id  = parseInt(document.getElementById('edit-svc-id').value);
  const svc = services.find(s => s.id === id);
  const payload = {
    name:                 document.getElementById('edit-svc-name').value.trim(),
    url:                  document.getElementById('edit-svc-url').value.trim(),
    icon:                 document.getElementById('edit-svc-icon').value.trim(),
    category_id:          document.getElementById('edit-svc-cat').value || null,
    accent_colour:        document.getElementById('edit-svc-accent').value,
    sort_order:           svc ? svc.sort_order : 0,
    requires_auth:        document.getElementById('edit-svc-auth').checked,
    description:          document.getElementById('edit-svc-desc').value.trim(),
    host_name:            document.getElementById('edit-svc-host-name').value.trim(),
    disable_when_offline: document.getElementById('edit-svc-disable-offline').checked,
  };
  try {
    await api('PUT', `/api/admin/services/${id}`, payload);
    toast('Service updated');
    document.getElementById('edit-svc-form').style.display = 'none';
    await loadServices();
  } catch (err) {
    toast('Error', 'error');
  }
});

document.getElementById('cancel-edit-svc').addEventListener('click', () => {
  document.getElementById('edit-svc-form').style.display = 'none';
});

// ── Settings Panel ────────────────────────────────────────────────────────
// In-memory state for dynamic node/override/config lists
let metricsState = {
  nodeMappings:      [],
  thresholds:        {},
  overrides:         [],
  statusConfig:      {},
  panelConfig:       {},
  availableStorages: [],
  borgRepos:         [],
  borgRepoNames:     {},
  borgConnected:     false,
};

function getBorgDisplayName(repoName) {
  return metricsState.borgRepoNames[repoName] || repoName;
}

function parseJSON(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch (_) { return fallback; }
}

// ── Node mappings ─────────────────────────────────────────────────────────
function renderNodeMappings() {
  const container = document.getElementById('node-mappings-list');
  container.innerHTML = '';
  for (const node of metricsState.nodeMappings) {
    container.appendChild(buildNodeBlock(node.host, node.display, node.disk_storage || '', null, metricsState.availableStorages));
  }
}

function buildNodeBlock(host, display, diskStorage, availableHosts, availableStorages) {
  const thr = metricsState.thresholds[host] || { cpu: 85, ram: 90, disk: 90 };
  const block = document.createElement('div');
  block.className    = 'node-mapping-block';
  block.dataset.host = host;

  // If availableHosts is provided (new block), build a <select>; existing blocks show a read-only text field.
  let hostField;
  if (availableHosts) {
    const opts = availableHosts.length
      ? availableHosts.map(h => `<option value="${escHtml(h)}"${h === host ? ' selected' : ''}>${escHtml(h)}</option>`).join('')
      : `<option value="" disabled>No unassigned hosts</option>`;
    hostField = `<select class="node-host">${opts}</select>`;
  } else {
    hostField = `<input type="text" class="node-host" value="${escHtml(host)}" placeholder="proxmox" readonly>`;
  }

  const storageOpts = `<option value="">auto (aggregate local volumes)</option>` +
    (availableStorages || []).map(s =>
      `<option value="${escHtml(s)}"${diskStorage === s ? ' selected' : ''}>${escHtml(s)}</option>`
    ).join('');

  block.innerHTML = `
    <div class="node-mapping-row">
      <div class="form-group">
        <label>InfluxDB Host</label>
        ${hostField}
      </div>
      <div class="form-group">
        <label>Display Name</label>
        <input type="text" class="node-display" value="${escHtml(display)}" placeholder="TROPUS">
      </div>
      <div class="form-group" style="justify-content:flex-end;padding-bottom:0">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.node-mapping-block').remove(); syncNodeCheckboxes()">Remove</button>
      </div>
    </div>
    <div class="node-thresholds">
      <details>
        <summary>Thresholds &amp; Config</summary>
        <div class="node-thresholds-grid">
          <div class="form-group">
            <label>CPU %</label>
            <input type="number" class="node-thr-cpu" min="1" max="100" value="${thr.cpu}">
          </div>
          <div class="form-group">
            <label>RAM %</label>
            <input type="number" class="node-thr-ram" min="1" max="100" value="${thr.ram}">
          </div>
          <div class="form-group">
            <label>Disk %</label>
            <input type="number" class="node-thr-disk" min="1" max="100" value="${thr.disk}">
          </div>
        </div>
        <div class="node-mapping-row" style="margin-top:0.6rem">
          <div class="form-group">
            <label>Disk Source</label>
            <select class="node-disk-storage">${storageOpts}</select>
          </div>
        </div>
      </details>
    </div>
  `;
  block.querySelector('.node-host').addEventListener('change', syncNodeCheckboxes);
  block.querySelector('.node-display').addEventListener('change', syncNodeCheckboxes);
  return block;
}

document.getElementById('btn-add-node').addEventListener('click', async () => {
  const configuredHosts = new Set(getNodeMappingsFromDOM().map(n => n.host).filter(Boolean));
  let available = [];
  try {
    const data = await api('GET', '/api/influxdb-hosts');
    available = (data.hosts || []).filter(h => !configuredHosts.has(h));
  } catch (_) {}
  document.getElementById('node-mappings-list').appendChild(
    buildNodeBlock('', '', '', available, metricsState.availableStorages)
  );
  syncNodeCheckboxes();
});

function syncNodeCheckboxes() {
  const hosts = getNodeMappingsFromDOM().map(n => n.host).filter(Boolean);
  refreshCheckboxList('status-watch-nodes', hosts, metricsState.statusConfig.watch_nodes || hosts);
  refreshCheckboxList('panel-show-nodes',   hosts, metricsState.panelConfig.show_nodes   || hosts);
}

function refreshCheckboxList(containerId, hosts, checked) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const checkedSet = new Set(checked);
  el.innerHTML = '';
  for (const host of hosts) {
    const id  = `${containerId}-${host}`;
    const lbl = document.createElement('label');
    lbl.className = 'checkbox-item';
    lbl.innerHTML = `<input type="checkbox" id="${escHtml(id)}" value="${escHtml(host)}"${checkedSet.has(host) ? ' checked' : ''}> ${escHtml(host)}`;
    el.appendChild(lbl);
  }
}

function getNodeMappingsFromDOM() {
  return [...document.querySelectorAll('.node-mapping-block')].map(block => {
    const mapping = {
      host:    block.querySelector('.node-host').value.trim(),
      display: block.querySelector('.node-display').value.trim(),
    };
    const disk_storage = block.querySelector('.node-disk-storage')?.value?.trim() || '';
    if (disk_storage) mapping.disk_storage = disk_storage;
    return mapping;
  });
}

function getThresholdsFromDOM() {
  const result = {};
  document.querySelectorAll('.node-mapping-block').forEach(block => {
    const host = block.querySelector('.node-host').value.trim();
    if (!host) return;
    result[host] = {
      cpu:  parseFloat(block.querySelector('.node-thr-cpu').value)  || 85,
      ram:  parseFloat(block.querySelector('.node-thr-ram').value)  || 90,
      disk: parseFloat(block.querySelector('.node-thr-disk').value) || 90,
    };
  });
  return result;
}

// ── Host-name dropdown for offline detection ──────────────────────────────
async function populateHostDropdown(selectId, currentValue) {
  const el = document.getElementById(selectId);
  if (!el) return;

  let hosts = [];
  try {
    const data = await api('GET', '/api/metrics');
    const all = [
      ...(data.nodes      || []).map(n => n.host),
      ...(data.containers || []).map(c => c.host),
    ];
    hosts = [...new Set(all)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch (_) {}

  if (hosts.length === 0) {
    // Fall back to text input
    const input = document.createElement('input');
    input.type        = 'text';
    input.id          = selectId;
    input.placeholder = 'Enter host name manually';
    input.value       = currentValue || '';
    const note = document.createElement('div');
    note.className  = 'metrics-sub-desc';
    note.style.marginTop = '0.25rem';
    note.textContent = 'Could not load hosts — enter manually';
    el.replaceWith(input);
    input.insertAdjacentElement('afterend', note);
    return;
  }

  el.innerHTML = '<option value="">-- None (always online) --</option>';
  for (const host of hosts) {
    const opt = document.createElement('option');
    opt.value       = host;
    opt.textContent = host;
    if (host === currentValue) opt.selected = true;
    el.appendChild(opt);
  }

  // If saved value isn't in current list, add it with a note
  if (currentValue && !hosts.includes(currentValue)) {
    const opt = document.createElement('option');
    opt.value       = currentValue;
    opt.textContent = `${currentValue} (not currently in metrics)`;
    opt.selected    = true;
    el.insertBefore(opt, el.children[1]);
  }
}

// ── Status config ─────────────────────────────────────────────────────────
function renderStatusConfig() {
  const cfg   = metricsState.statusConfig;
  const hosts = metricsState.nodeMappings.map(n => n.host);

  refreshCheckboxList('status-watch-nodes', hosts, cfg.watch_nodes || hosts);

  const watchMetrics = new Set(cfg.watch_metrics || ['cpu', 'ram', 'disk']);
  document.getElementById('watch-cpu').checked     = watchMetrics.has('cpu');
  document.getElementById('watch-ram').checked     = watchMetrics.has('ram');
  document.getElementById('watch-disk').checked    = watchMetrics.has('disk');
  document.getElementById('watch-offline').checked = cfg.alert_on_offline !== false;

  renderStatusBorgSection();
}

function renderStatusBorgSection() {
  const group  = document.getElementById('status-borg-group');
  const listEl = document.getElementById('status-watch-borg');
  const noteEl = document.getElementById('status-borg-note');
  if (!group || !listEl || !noteEl) return;

  const borgEnabledChecked = document.getElementById('set-borg-enabled')?.checked ?? true;

  if (!borgEnabledChecked) {
    group.style.opacity       = '0.45';
    group.style.pointerEvents = 'none';
    noteEl.textContent = 'Enable Borg-UI in Backup Metrics settings to configure';
    noteEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }

  if (!metricsState.borgConnected && metricsState.borgRepos.length === 0) {
    group.style.opacity       = '0.45';
    group.style.pointerEvents = 'none';
    noteEl.textContent = 'Borg-UI unavailable';
    noteEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }

  group.style.opacity       = '';
  group.style.pointerEvents = '';
  noteEl.style.display      = 'none';

  const cfg       = metricsState.statusConfig;
  const watchBorg = cfg.watch_borg_repos;
  const watchSet  = new Set(Array.isArray(watchBorg) ? watchBorg : metricsState.borgRepos);

  // Union of currently-connected repos and any saved-but-now-missing repos
  const allRepos = new Set([...metricsState.borgRepos, ...(Array.isArray(watchBorg) ? watchBorg : [])]);

  listEl.innerHTML = '';
  for (const repoName of [...allRepos].sort()) {
    const missing     = !metricsState.borgRepos.includes(repoName);
    const displayName = getBorgDisplayName(repoName);
    const id = `status-borg-${repoName}`;
    const lbl = document.createElement('label');
    lbl.className = 'checkbox-item';
    if (missing) lbl.style.opacity = '0.5';
    const label = missing
      ? `${escHtml(displayName)} <span style="font-size:0.75em">(not currently found)</span>`
      : escHtml(displayName);
    lbl.innerHTML = `<input type="checkbox" id="${escHtml(id)}" value="${escHtml(repoName)}"${watchSet.has(repoName) ? ' checked' : ''}> ${label}`;
    listEl.appendChild(lbl);
  }
}

function getStatusConfigFromDOM() {
  const watchNodes   = [...document.querySelectorAll('#status-watch-nodes input:checked')].map(i => i.value);
  const watchMetrics = ['cpu','ram','disk'].filter(m => document.getElementById(`watch-${m}`).checked);
  const watchBorg    = [...document.querySelectorAll('#status-watch-borg input:checked')].map(i => i.value);
  return {
    watch_nodes:      watchNodes,
    watch_metrics:    watchMetrics,
    alert_on_offline: document.getElementById('watch-offline').checked,
    watch_borg_repos: watchBorg,
  };
}

// ── Panel config ──────────────────────────────────────────────────────────
function renderPanelConfig() {
  const cfg   = metricsState.panelConfig;
  const hosts = metricsState.nodeMappings.map(n => n.host);

  refreshCheckboxList('panel-show-nodes', hosts, cfg.show_nodes || hosts);

  const showMetrics = new Set(cfg.show_metrics || ['cpu', 'ram', 'disk', 'uptime']);
  ['cpu','ram','disk','uptime','loadavg'].forEach(m => {
    const el = document.getElementById(`panel-show-${m}`);
    if (el) el.checked = showMetrics.has(m);
  });

  renderBorgPanelCheckboxes();
}

function renderBorgPanelCheckboxes() {
  const cfg   = metricsState.panelConfig;
  const repos = metricsState.borgRepos || [];
  const el    = document.getElementById('panel-show-borg');
  if (!el) return;
  el.innerHTML = '';
  if (repos.length === 0) {
    el.innerHTML = '<span style="color:var(--text-dim);font-size:0.75rem">No repositories found</span>';
    return;
  }
  const showBorg = Array.isArray(cfg.show_borg) ? new Set(cfg.show_borg) : new Set(repos);
  for (const repoName of repos) {
    const id  = `panel-show-borg-${repoName}`;
    const lbl = document.createElement('label');
    lbl.className = 'checkbox-item';
    lbl.innerHTML = `<input type="checkbox" id="${escHtml(id)}" value="${escHtml(repoName)}"${showBorg.has(repoName) ? ' checked' : ''}> ${escHtml(getBorgDisplayName(repoName))}`;
    el.appendChild(lbl);
  }
}

function getPanelConfigFromDOM() {
  const showNodes   = [...document.querySelectorAll('#panel-show-nodes input:checked')].map(i => i.value);
  const showMetrics = ['cpu','ram','disk','uptime','loadavg'].filter(m => {
    const el = document.getElementById(`panel-show-${m}`);
    return el && el.checked;
  });
  const showBorg = [...document.querySelectorAll('#panel-show-borg input:checked')].map(i => i.value);
  return { show_nodes: showNodes, show_metrics: showMetrics, show_borg: showBorg };
}

// ── Borg repo display names ───────────────────────────────────────────────
function renderBorgRepoNames(repos, repoNames) {
  const container = document.getElementById('borg-repo-names-list');
  if (!container) return;
  container.innerHTML = '';
  if (!repos || repos.length === 0) {
    container.innerHTML = '<span style="color:var(--text-dim);font-size:0.75rem">No repositories found. Test connection to discover repositories.</span>';
    return;
  }
  for (const repoName of repos) {
    const row = document.createElement('div');
    row.className = 'form-row';
    row.style.marginTop = '0.5rem';
    row.innerHTML = `
      <div class="form-group" style="flex:0 0 180px">
        <label>Repository</label>
        <input type="text" value="${escHtml(repoName)}" readonly style="color:var(--text-dim);cursor:default">
      </div>
      <div class="form-group" style="flex:1 1 180px">
        <label>Display Name</label>
        <input type="text" class="borg-repo-display-name" data-repo="${escHtml(repoName)}" value="${escHtml(repoNames[repoName] || '')}" placeholder="${escHtml(repoName)}">
      </div>
    `;
    container.appendChild(row);
  }
}

// ── Field overrides ───────────────────────────────────────────────────────
const OVERRIDE_FIELDS = ['cpu', 'ram', 'disk', 'uptime', 'loadavg'];

function renderOverrides() {
  const container = document.getElementById('overrides-list');
  container.innerHTML = '';
  for (const ov of metricsState.overrides) {
    container.appendChild(buildOverrideBlock(ov.host, ov.field, ov.overrides || {}));
  }
}

function buildOverrideBlock(host, field, props) {
  const block = document.createElement('div');
  block.className = 'override-block';
  const fieldOpts = OVERRIDE_FIELDS.map(f => `<option value="${f}"${f === field ? ' selected' : ''}>${f}</option>`).join('');
  block.innerHTML = `
    <div class="override-row">
      <div class="form-group">
        <label>Host</label>
        <input type="text" class="ov-host" value="${escHtml(host)}" placeholder="proxmox">
      </div>
      <div class="form-group">
        <label>Field</label>
        <select class="ov-field">${fieldOpts}</select>
      </div>
      <div class="form-group" style="justify-content:flex-end;padding-bottom:0">
        <label>&nbsp;</label>
        <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.override-block').remove()">Remove</button>
      </div>
    </div>
    <div class="override-props">
      <details>
        <summary>Properties</summary>
        <div class="override-props-grid">
          <div class="form-group">
            <label>Exclude</label>
            <div class="checkbox-list">
              <label class="checkbox-item"><input type="checkbox" class="ov-exclude"${props.exclude ? ' checked' : ''}> Exclude field</label>
            </div>
          </div>
          <div class="form-group">
            <label>Divisor</label>
            <input type="number" class="ov-divisor" value="${props.divisor ?? ''}" placeholder="none">
          </div>
          <div class="form-group">
            <label>Max Value</label>
            <input type="number" class="ov-max" value="${props.max_value ?? ''}" placeholder="none">
          </div>
          <div class="form-group">
            <label>Decimal Places</label>
            <input type="number" class="ov-decimals" min="0" max="4" value="${props.decimal_places ?? ''}" placeholder="1">
          </div>
        </div>
      </details>
    </div>
  `;
  return block;
}

document.getElementById('btn-add-override').addEventListener('click', () => {
  document.getElementById('overrides-list').appendChild(buildOverrideBlock('', 'cpu', {}));
});

function getOverridesFromDOM() {
  return [...document.querySelectorAll('.override-block')].map(block => {
    const props = {};
    if (block.querySelector('.ov-exclude').checked) props.exclude = true;
    const divisor  = block.querySelector('.ov-divisor').value;
    const maxVal   = block.querySelector('.ov-max').value;
    const decimals = block.querySelector('.ov-decimals').value;
    if (divisor  !== '') props.divisor       = parseFloat(divisor);
    if (maxVal   !== '') props.max_value     = parseFloat(maxVal);
    if (decimals !== '') props.decimal_places = parseInt(decimals, 10);
    return {
      host:      block.querySelector('.ov-host').value.trim(),
      field:     block.querySelector('.ov-field').value,
      overrides: props,
    };
  }).filter(ov => ov.host);
}

document.getElementById('metrics-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nodeMappings  = getNodeMappingsFromDOM();
  const thresholds    = getThresholdsFromDOM();
  const overrides     = getOverridesFromDOM();
  const statusConfig  = getStatusConfigFromDOM();
  const panelConfig   = getPanelConfigFromDOM();

  const payload = {
    influxdb_url:             document.getElementById('set-influx-url').value.trim(),
    influxdb_token:           document.getElementById('set-influx-token').value.trim(),
    influxdb_org:             document.getElementById('set-influx-org').value.trim(),
    influxdb_bucket:          document.getElementById('set-influx-bucket').value.trim(),
    influxdb_refresh_interval: document.getElementById('set-influx-interval').value.trim(),
    influxdb_node_mappings:   JSON.stringify(nodeMappings),
    influxdb_thresholds:      JSON.stringify(thresholds),
    influxdb_overrides:       JSON.stringify(overrides),
    influxdb_status_config:   JSON.stringify(statusConfig),
    influxdb_panel_config:    JSON.stringify(panelConfig),
  };

  try {
    await api('PUT', '/api/admin/settings', payload);
    metricsState.nodeMappings = nodeMappings;
    metricsState.thresholds   = thresholds;
    metricsState.overrides    = overrides;
    metricsState.statusConfig = statusConfig;
    metricsState.panelConfig  = panelConfig;
    toast('Metrics settings saved');
  } catch (err) {
    toast('Error saving metrics settings', 'error');
  }
});

document.getElementById('borg-settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const repoNames = {};
  document.querySelectorAll('.borg-repo-display-name').forEach(input => {
    const name = input.value.trim();
    if (name) repoNames[input.dataset.repo] = name;
  });
  try {
    await api('PUT', '/api/admin/settings', {
      borg_url:                document.getElementById('set-borg-url').value.trim(),
      borg_token:              document.getElementById('set-borg-token').value.trim(),
      borg_refresh_interval:   document.getElementById('set-borg-interval').value.trim() || '60',
      borg_enabled:            document.getElementById('set-borg-enabled').checked ? 'true' : 'false',
      borg_repository_names:   JSON.stringify(repoNames),
    });
    toast('Backup settings saved');
  } catch (err) {
    toast('Error saving backup settings', 'error');
  }
});

document.getElementById('btn-test-borg').addEventListener('click', async () => {
  const resultEl = document.getElementById('borg-test-result');
  resultEl.value = 'Connecting...';
  try {
    const data = await api('GET', '/api/borg-status');
    resultEl.value = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.value = 'Error: ' + err.message;
  }
});

document.getElementById('btn-test-influx').addEventListener('click', async () => {
  const resultEl = document.getElementById('influx-test-result');
  resultEl.value = 'Connecting...';
  try {
    const data = await api('GET', '/api/metrics');
    resultEl.value = JSON.stringify(data, null, 2);
  } catch (err) {
    resultEl.value = 'Error: ' + err.message;
  }
});

// ── Live Metrics Panel ────────────────────────────────────────────────────
async function loadLiveMetrics() {
  try {
    const [data, borgData] = await Promise.all([
      api('GET', '/api/metrics'),
      api('GET', '/api/borg-status').catch(() => null),
    ]);
    renderLiveMetrics(data);
    renderBorgMetrics(borgData);
  } catch (err) {
    document.getElementById('metrics-status-badge').textContent = 'CONNECTION ERROR';
    document.getElementById('metrics-status-badge').className   = 'metrics-badge degraded';
  }
}

function fmtPct(val) {
  if (val === null || val === undefined) return '<span class="dim-text">N/A</span>';
  return `${val.toFixed(1)}%`;
}

function fmtDisk(val) {
  if (val === null || val === undefined) return '<span class="dim-text">Internal</span>';
  return `${val.toFixed(1)}%`;
}

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  return bytes + ' B';
}

function statusDot(online) {
  return `<span class="status-dot ${online ? 'online' : 'offline'}"></span>`;
}

function renderMetricsTable(tbody, rows, colCount, thr, isNode) {
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--text-dim)">No data</td></tr>`;
    return;
  }
  for (const item of rows) {
    const isOffline = item.uptime === '0m' && (item.ram === null || item.ram === 0);
    const nodeThr   = isNode ? { ...{ cpu: 85, ram: 90, disk: 90 }, ...(thr[item.host] || {}) } : { cpu: 101, ram: 101, disk: 101 };
    const cpuOver   = !isOffline && item.cpu  !== null && item.cpu  > nodeThr.cpu;
    const ramOver   = !isOffline && item.ram  !== null && item.ram  > nodeThr.ram;
    const diskOver  = !isOffline && item.disk !== null && item.disk > nodeThr.disk;
    const rowWarn   = cpuOver || ramOver || diskOver;

    const tr = document.createElement('tr');
    if (rowWarn) tr.className = 'metrics-warn';

    if (isOffline) {
      const nameCell = escHtml(item.display_name);
      const typeCell = isNode ? '' : `<td style="color:var(--text-dim);font-size:0.75rem">${escHtml(item.object || '—')}</td>`;
      const spanCols = isNode ? 5 : 4;
      tr.innerHTML = `
        <td>${statusDot(false)} ${nameCell}</td>
        ${typeCell}
        <td colspan="${spanCols}" style="color:#ef4444;font-size:0.75rem;font-family:var(--font-heading,'Orbitron'),sans-serif;letter-spacing:0.1em">OFFLINE</td>
      `;
    } else if (isNode) {
      tr.innerHTML = `
        <td>${statusDot(true)} ${escHtml(item.display_name)}</td>
        <td class="${cpuOver ? 'metric-over' : ''}">${fmtPct(item.cpu)}</td>
        <td class="${ramOver ? 'metric-over' : ''}">${fmtPct(item.ram)}</td>
        <td class="${diskOver ? 'metric-over' : ''}">${fmtDisk(item.disk)}</td>
        <td>${escHtml(item.uptime)}</td>
        <td>${item.loadavg !== null && item.loadavg !== undefined ? item.loadavg.toFixed(2) : '<span class="dim-text">—</span>'}</td>
      `;
    } else {
      tr.innerHTML = `
        <td>${statusDot(true)} ${escHtml(item.display_name)}</td>
        <td style="color:var(--text-dim);font-size:0.75rem">${escHtml(item.object || '—')}</td>
        <td>${fmtPct(item.cpu)}</td>
        <td>${fmtPct(item.ram)}</td>
        <td>${fmtDisk(item.disk)}</td>
        <td>${escHtml(item.uptime)}</td>
      `;
    }
    tbody.appendChild(tr);
  }
}

function renderStoragesTable(tbody, rows) {
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim)">No data</td></tr>';
    return;
  }
  for (const item of rows) {
    const diskOver = item.disk !== null && item.disk > 90;
    const tr = document.createElement('tr');
    if (diskOver) tr.className = 'metrics-warn';
    tr.innerHTML = `
      <td>${escHtml(item.name)}</td>
      <td style="color:var(--text-dim);font-size:0.75rem">${item.node ? escHtml(item.node) : '<span class="dim-text">shared</span>'}</td>
      <td>${fmtBytes(item.used_bytes)}</td>
      <td>${fmtBytes(item.total_bytes)}</td>
      <td class="${diskOver ? 'metric-over' : ''}">${fmtDisk(item.disk)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderLiveMetrics(data) {
  const badge = document.getElementById('metrics-status-badge');

  if (data.status === 'unconfigured') {
    badge.textContent = 'NOT CONFIGURED';
    badge.className   = 'metrics-badge dim';
    document.getElementById('metrics-nodes-tbody').innerHTML      = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">Configure InfluxDB in Settings</td></tr>';
    document.getElementById('metrics-containers-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">—</td></tr>';
    document.getElementById('metrics-storages-tbody').innerHTML   = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim)">—</td></tr>';
    return;
  }

  if (data.status === 'error') {
    badge.textContent = 'UNREACHABLE';
    badge.className   = 'metrics-badge degraded';
    document.getElementById('metrics-nodes-tbody').innerHTML      = `<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">${escHtml(data.message || 'Connection error')}</td></tr>`;
    document.getElementById('metrics-containers-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim)">—</td></tr>';
    document.getElementById('metrics-storages-tbody').innerHTML   = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim)">—</td></tr>';
    return;
  }

  badge.textContent = data.status === 'degraded' ? 'SYSTEMS DEGRADED' : 'SYSTEMS NOMINAL';
  badge.className   = `metrics-badge ${data.status === 'degraded' ? 'degraded' : 'nominal'}`;

  const thr = data.thresholds || metricsState.thresholds || {};
  renderMetricsTable(document.getElementById('metrics-nodes-tbody'),      data.nodes,      6, thr, true);
  renderMetricsTable(document.getElementById('metrics-containers-tbody'), data.containers, 6, thr, false);
  renderStoragesTable(document.getElementById('metrics-storages-tbody'),  data.storages || []);
}

document.getElementById('btn-refresh-metrics').addEventListener('click', loadLiveMetrics);

['nodes', 'containers', 'storages', 'backup'].forEach(key => {
  document.getElementById(`toggle-${key}`).addEventListener('change', function () {
    document.getElementById(`metrics-section-${key}`).style.display = this.checked ? '' : 'none';
  });
});

function renderBorgMetrics(data) {
  const badge     = document.getElementById('borg-status-badge');
  const container = document.getElementById('borg-repos-container');
  if (!badge || !container) return;

  if (!data || !data.connected) {
    badge.textContent = 'UNAVAILABLE';
    badge.className   = 'borg-status-badge dim';
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem">${escHtml(data?.error || 'Cannot reach Borg-UI')}</div>`;
    return;
  }

  const statusLabels = { healthy: 'HEALTHY', degraded: 'DEGRADED', warning: 'WARNING', unknown: 'UNKNOWN' };
  const statusClass  = { healthy: 'healthy', degraded: 'degraded', warning: 'warning', unknown: 'dim' };
  badge.textContent = statusLabels[data.status] || 'UNKNOWN';
  badge.className   = `borg-status-badge ${statusClass[data.status] || 'dim'}`;

  container.innerHTML = '';

  for (const repo of (data.repositories || [])) {
    const lb   = repo.last_backup;
    const lbSuccess = lb ? (lb.success ? '&#x2705; SUCCESS' : '&#x274C; FAILED') : '—';
    const lbSuccessClass = lb ? (lb.success ? '' : 'borg-failed') : '';
    const displayName = repo.display_name || repo.name;

    const div = document.createElement('div');
    div.className = 'borg-repo';
    div.innerHTML = `
      <div class="borg-repo-header">${escHtml(displayName)}</div>
      <div class="borg-repo-panels">
        <div class="borg-panel">
          <div class="borg-panel-title">Repository</div>
          <div class="borg-info-row"><span class="borg-info-label">Name</span><span class="borg-info-value">${escHtml(displayName)}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Path</span><span class="borg-info-value dim-text">${escHtml(repo.path)}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Total Size</span><span class="borg-info-value cyan-text">${escHtml(repo.size_display || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Archives</span><span class="borg-info-value">${repo.archive_count !== null ? repo.archive_count : '—'}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Last Check</span><span class="borg-info-value">${escHtml(repo.last_check?.time_ago || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Last Compact</span><span class="borg-info-value">${escHtml(repo.last_compact?.time_ago || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Active Jobs</span><span class="borg-info-value">${data.system?.active_jobs ?? '—'}</span></div>
        </div>
        <div class="borg-panel">
          <div class="borg-panel-title">Last Backup</div>
          <div class="borg-info-row"><span class="borg-info-label">Status</span><span class="borg-info-value ${lbSuccessClass}">${lbSuccess}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Time</span><span class="borg-info-value">${escHtml(lb?.time_ago || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Duration</span><span class="borg-info-value">${escHtml(lb?.duration_display || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Original Size</span><span class="borg-info-value">${escHtml(lb?.original_size_display || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Deduplicated</span><span class="borg-info-value cyan-text">${escHtml(lb?.deduplicated_size_display || '—')}</span></div>
          <div class="borg-info-row"><span class="borg-info-label">Dedup Ratio</span><span class="borg-info-value">${escHtml(lb?.dedup_ratio || '—')}</span></div>
        </div>
      </div>
      <div style="margin-top:1rem">
        <table class="data-table borg-jobs-table">
          <thead>
            <tr>
              <th>Backups Run</th><th>Failed</th><th>Orphaned</th>
              <th>Restores</th><th>Checks</th><th>Prunes</th><th>Compacts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${repo.jobs.backup_total}</td>
              <td class="${repo.jobs.backup_failed > 0 ? 'metric-over' : ''}">${repo.jobs.backup_failed}</td>
              <td class="${repo.jobs.backup_orphaned > 0 ? 'metric-over' : ''}">${repo.jobs.backup_orphaned}</td>
              <td>${repo.jobs.restore_total}</td>
              <td>${repo.jobs.check_total}</td>
              <td>${repo.jobs.prune_total}</td>
              <td>${repo.jobs.compact_total}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    container.appendChild(div);
  }
}

// ── Drag-to-reorder ────────────────────────────────────────────────────────
function setupDragSort(tbody, saveCallback) {
  let dragged = null;

  tbody.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('tr');
    if (dragged) dragged.classList.add('dragging');
  });

  tbody.addEventListener('dragover', (e) => {
    e.preventDefault();
    const over = e.target.closest('tr');
    if (over && over !== dragged) {
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      over.classList.add('drag-over');
    }
  });

  tbody.addEventListener('drop', (e) => {
    e.preventDefault();
    const over = e.target.closest('tr');
    tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
    if (!over || over === dragged) return;

    const rows = [...tbody.querySelectorAll('tr:not(.dragging)')];
    const overIdx = rows.indexOf(over);
    tbody.insertBefore(dragged, over);

    // Collect new order
    const newOrder = [...tbody.querySelectorAll('tr')].map((row, i) => ({
      id: parseInt(row.dataset.id),
      sort_order: i,
      category_id: row.dataset.categoryId ? parseInt(row.dataset.categoryId) : undefined,
    }));

    saveCallback(newOrder).catch(() => toast('Reorder failed', 'error'));
  });

  tbody.addEventListener('dragend', () => {
    if (dragged) dragged.classList.remove('dragging');
    dragged = null;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Media upload ──────────────────────────────────────────────────────────
const VIDEO_SLOT_LABELS = {
  background: 'Background Video',
  welcome:    'Character — Welcome Clip',
  idle:       'Character — Idle Loop',
  transition: 'Character — Transition Clip',
  browse:     'Character — Browse Idle',
};

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

async function loadVideos() {
  const container = document.getElementById('media-upload-list');
  if (!container) return;
  let videos = [];
  try { videos = await api('GET', '/api/admin/videos'); } catch (_) {}

  container.innerHTML = '';
  for (const v of videos) {
    const label = VIDEO_SLOT_LABELS[v.slot] || v.slot;
    const fileInfo = v.filename
      ? `Current: ${escHtml(v.filename)} — ${fmtSize(v.size)}`
      : 'No file uploaded';

    const row = document.createElement('div');
    row.className = 'media-upload-row';
    row.id = `media-row-${v.slot}`;
    row.innerHTML = `
      <div>
        <div class="media-slot-label">${escHtml(label)}</div>
        <div class="media-file-info" id="mfi-${escHtml(v.slot)}">${fileInfo}</div>
      </div>
      <div>
        <div class="media-actions">
          <input type="file" id="mf-${escHtml(v.slot)}" accept=".mp4,.webm" style="display:none">
          <label for="mf-${escHtml(v.slot)}" class="btn btn-secondary btn-sm" style="cursor:pointer">Choose File</label>
          <button type="button" class="btn btn-secondary btn-sm" id="mub-${escHtml(v.slot)}">Upload</button>
          ${v.filename ? `<button type="button" class="btn btn-secondary btn-sm" onclick="previewVideo('${escHtml(v.slot)}','${escHtml(v.filename)}')">Preview</button>` : ''}
          ${v.filename ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteVideo('${escHtml(v.slot)}')">Delete</button>` : ''}
        </div>
        <div class="upload-progress" id="mprog-${escHtml(v.slot)}">
          <div class="upload-progress-bar"><div class="upload-progress-fill" id="mprogfill-${escHtml(v.slot)}"></div></div>
          <span id="mprogpct-${escHtml(v.slot)}">0%</span>
        </div>
      </div>
    `;
    container.appendChild(row);

    document.getElementById(`mub-${v.slot}`).addEventListener('click', () => uploadVideo(v.slot));
  }
}

async function uploadVideo(slot) {
  const input = document.getElementById(`mf-${slot}`);
  if (!input || !input.files[0]) { toast('Choose a file first', 'error'); return; }
  const file    = input.files[0];
  const formData = new FormData();
  formData.append(slot, file);

  const progWrap = document.getElementById(`mprog-${slot}`);
  const progFill = document.getElementById(`mprogfill-${slot}`);
  const progPct  = document.getElementById(`mprogpct-${slot}`);
  if (progWrap) progWrap.style.display = 'flex';

  try {
    const result = await uploadFileXHR('/api/admin/upload/video', formData, (pct) => {
      if (progFill) progFill.style.width = `${Math.round(pct * 100)}%`;
      if (progPct)  progPct.textContent  = `${Math.round(pct * 100)}%`;
    });
    toast(`Uploaded: ${result.filename} (${fmtSize(result.size)})`);
    sessionStorage.setItem('firmament_force_boot', '1');
    await loadVideos();
  } catch (err) {
    toast('Upload failed: ' + err.message, 'error');
    if (progWrap) progWrap.style.display = 'none';
  }
}

async function deleteVideo(slot) {
  if (!confirm(`Delete the current video for slot "${slot}"?`)) return;
  try {
    await api('DELETE', `/api/admin/video/${slot}`);
    toast('Video deleted');
    await loadVideos();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

function previewVideo(slot, filename) {
  const modal  = document.getElementById('video-preview-modal');
  const player = document.getElementById('video-preview-player');
  const title  = document.getElementById('video-preview-title');
  if (!modal || !player) return;
  title.textContent = (VIDEO_SLOT_LABELS[slot] || slot).toUpperCase();
  player.src = `/videos/${filename}?v=${Date.now()}`;
  player.load();
  modal.style.display = 'flex';
}

function closeVideoPreview() {
  const modal  = document.getElementById('video-preview-modal');
  const player = document.getElementById('video-preview-player');
  if (modal) modal.style.display = 'none';
  if (player) { player.pause(); player.src = ''; }
}

// ── Font upload ───────────────────────────────────────────────────────────
const FONT_SLOT_LABELS = { heading_font: 'Custom Heading Font', body_font: 'Custom Body Font' };

async function loadFonts() {
  const container = document.getElementById('font-upload-list');
  if (!container) return;
  let fonts = {};
  try { fonts = await api('GET', '/api/admin/fonts'); } catch (_) {}

  container.innerHTML = '';
  for (const [slot, label] of Object.entries(FONT_SLOT_LABELS)) {
    const info = fonts[slot] || {};
    const fileInfo = info.filename ? `${escHtml(info.filename)} — ${fmtSize(info.size)}` : 'None';
    const row = document.createElement('div');
    row.className = 'font-upload-row';
    row.innerHTML = `
      <div>
        <div class="media-slot-label" style="font-size:0.58rem">${escHtml(label)}</div>
        <div class="media-file-info">${fileInfo}</div>
      </div>
      <div class="media-actions">
        <input type="file" id="ff-${escHtml(slot)}" accept=".woff2,.woff,.ttf" style="display:none">
        <label for="ff-${escHtml(slot)}" class="btn btn-secondary btn-sm" style="cursor:pointer">Choose File</label>
        <button type="button" class="btn btn-secondary btn-sm" onclick="uploadFont('${escHtml(slot)}')">Upload</button>
        ${info.filename ? `<button type="button" class="btn btn-danger btn-sm" onclick="deleteFont('${escHtml(slot)}')">Remove</button>` : ''}
      </div>
    `;
    container.appendChild(row);
  }
}

async function uploadFont(slot) {
  const input = document.getElementById(`ff-${slot}`);
  if (!input || !input.files[0]) { toast('Choose a file first', 'error'); return; }
  const formData = new FormData();
  formData.append(slot, input.files[0]);
  try {
    const result = await uploadFileXHR('/api/admin/upload/font', formData);
    toast(`Font uploaded: ${result.filename}`);
    await loadFonts();
  } catch (err) { toast('Upload failed: ' + err.message, 'error'); }
}

async function deleteFont(slot) {
  if (!confirm('Remove this custom font?')) return;
  try {
    await api('DELETE', `/api/admin/font/${slot}`);
    toast('Font removed');
    await loadFonts();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Favicon section (multi-slot) ──────────────────────────────────────────
const FAVICON_SLOT_INFO = {
  ico:    { label: 'favicon.ico',                   desc: 'Browser tab (16–32px)',  accept: '.ico' },
  png96:  { label: 'favicon-96x96.png',             desc: 'Standard HD (96px)',     accept: '.png' },
  apple:  { label: 'apple-touch-icon.png',          desc: 'iOS / Safari (180px)',   accept: '.png' },
  pwa192: { label: 'web-app-manifest-192x192.png',  desc: 'PWA icon (192px)',       accept: '.png' },
  pwa512: { label: 'web-app-manifest-512x512.png',  desc: 'PWA large (512px)',      accept: '.png' },
  svg:    { label: 'favicon.svg',                   desc: 'Scalable vector',        accept: '.svg' },
};

async function loadFaviconSection() {
  const container = document.getElementById('favicon-section');
  if (!container) return;
  let favicons = {};
  try { favicons = await api('GET', '/api/admin/favicons'); } catch (_) {}

  container.innerHTML = '';
  const ts = Date.now();

  for (const [slot, info] of Object.entries(FAVICON_SLOT_INFO)) {
    const fav  = favicons[slot] || {};
    const row  = document.createElement('div');
    row.className = 'media-upload-row';
    row.style.gridTemplateColumns = '200px 1fr';

    const preview = fav.filename
      ? `<img src="/${escHtml(fav.filename)}?v=${ts}" alt="${escHtml(slot)}" style="width:32px;height:32px;object-fit:contain">`
      : '<span style="font-size:1.1rem;color:var(--text-dim)">—</span>';

    row.innerHTML = `
      <div>
        <div class="media-slot-label" style="font-size:0.6rem">${escHtml(info.label)}</div>
        <div class="media-file-info">${escHtml(info.desc)}</div>
        ${fav.filename ? `<div class="media-file-info">${fmtSize(fav.size)}</div>` : '<div class="media-file-info" style="color:var(--text-dim)">Not uploaded</div>'}
      </div>
      <div>
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
          <div class="favicon-preview">${preview}</div>
          <div class="media-actions">
            <input type="file" id="fav-file-${escHtml(slot)}" accept="${escHtml(info.accept)}" style="display:none">
            <label for="fav-file-${escHtml(slot)}" class="btn btn-secondary btn-sm" style="cursor:pointer">Choose File</label>
            <button type="button" class="btn btn-secondary btn-sm" id="fav-upload-${escHtml(slot)}">Upload</button>
            ${fav.filename ? `<button type="button" class="btn btn-danger btn-sm" id="fav-delete-${escHtml(slot)}">Delete</button>` : ''}
          </div>
        </div>
      </div>
    `;
    container.appendChild(row);

    document.getElementById(`fav-upload-${slot}`).addEventListener('click', async () => {
      const input = document.getElementById(`fav-file-${slot}`);
      if (!input || !input.files[0]) { toast('Choose a file first', 'error'); return; }
      const fd = new FormData();
      fd.append(slot, input.files[0]);
      try {
        const result = await uploadFileXHR('/api/admin/upload/favicon', fd);
        toast(`Uploaded: ${result.filename}`);
        refreshFavicons();
        await loadFaviconSection();
      } catch (err) { toast('Upload failed: ' + err.message, 'error'); }
    });

    const delBtn = document.getElementById(`fav-delete-${slot}`);
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete ${info.label}?`)) return;
        try {
          await api('DELETE', `/api/admin/favicon/${slot}`);
          toast(`Deleted ${info.label}`);
          await loadFaviconSection();
        } catch (err) { toast('Error: ' + err.message, 'error'); }
      });
    }
  }
}

// ── Favicon cache-buster ──────────────────────────────────────────────────
function refreshFavicons() {
  const ts = Date.now();
  const links = document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]');
  links.forEach(link => {
    const url = new URL(link.href, window.location.origin);
    url.searchParams.set('v', ts);
    link.href = url.toString();
  });
}

// ── XHR upload helper with progress ──────────────────────────────────────
function uploadFileXHR(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }
    xhr.onload = () => {
      if (xhr.status === 401) { reject(new Error('Unauthorised')); return; }
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) {
          resolve(data);
        } else {
          reject(new Error(data.error || `HTTP ${xhr.status}`));
        }
      } catch { reject(new Error(`HTTP ${xhr.status}`)); }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

// ── Admin theme application ───────────────────────────────────────────────
const ADMIN_PRELOADED_FONTS = new Set(['Orbitron', 'Rajdhani', 'Share Tech Mono']);

function loadAdminGoogleFont(fontName) {
  if (!fontName) return;
  if (ADMIN_PRELOADED_FONTS.has(fontName)) return;
  if (document.querySelector(`link[data-font="${fontName}"]`)) return;
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.setAttribute('data-font', fontName);
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

async function applyAdminTheme() {
  try {
    const res   = await fetch('/api/theme');
    const theme = await res.json();
    const root  = document.documentElement;

    if (theme.theme_bg_primary)        root.style.setProperty('--bg',       theme.theme_bg_primary);
    if (theme.theme_bg_secondary)      root.style.setProperty('--bg2',      theme.theme_bg_secondary);
    if (theme.theme_accent_primary)    root.style.setProperty('--cyan',     theme.theme_accent_primary);
    if (theme.theme_accent_secondary)  root.style.setProperty('--purple',   theme.theme_accent_secondary);
    if (theme.theme_text_primary)      root.style.setProperty('--text',     theme.theme_text_primary);
    if (theme.theme_text_dim)          root.style.setProperty('--text-dim', theme.theme_text_dim);

    // Scanlines
    const scanlineEl = document.getElementById('scanline-style');
    if (scanlineEl) {
      if (theme.theme_scanlines !== 'false') {
        const intensity = parseFloat(theme.theme_scanline_intensity) || 0.012;
        scanlineEl.textContent = `body::before { opacity: ${intensity}; }`;
      } else {
        scanlineEl.textContent = 'body::before { display: none; }';
      }
    }

    // Custom CSS
    const customEl = document.getElementById('custom-css');
    if (customEl && theme.theme_custom_css) {
      customEl.textContent = theme.theme_custom_css;
    }

    // Fonts
    loadAdminGoogleFont(theme.theme_font_heading);
    loadAdminGoogleFont(theme.theme_font_body);
    loadAdminGoogleFont(theme.theme_font_mono);

    let fontCss = '';
    if (theme.theme_font_heading_custom) {
      fontCss += `@font-face { font-family: 'CustomHeading'; src: url('/fonts/${theme.theme_font_heading_custom}'); }\n`;
    }
    if (theme.theme_font_body_custom) {
      fontCss += `@font-face { font-family: 'CustomBody'; src: url('/fonts/${theme.theme_font_body_custom}'); }\n`;
    }
    const headingFont = theme.theme_font_heading_custom
      ? `'CustomHeading', '${theme.theme_font_heading || 'Orbitron'}'`
      : `'${theme.theme_font_heading || 'Orbitron'}'`;
    const bodyFont = theme.theme_font_body_custom
      ? `'CustomBody', '${theme.theme_font_body || 'Inter'}'`
      : `'${theme.theme_font_body || 'Inter'}'`;
    const monoFont = `'${theme.theme_font_mono || 'Share Tech Mono'}'`;
    fontCss += `:root { --font-heading: ${headingFont}, sans-serif; --font-body: ${bodyFont}, sans-serif; --font-mono: ${monoFont}, monospace; }\n`;

    let fontStyleEl = document.getElementById('admin-font-style');
    if (!fontStyleEl) {
      fontStyleEl = document.createElement('style');
      fontStyleEl.id = 'admin-font-style';
      document.head.appendChild(fontStyleEl);
    }
    fontStyleEl.textContent = fontCss;
  } catch (_) {}
}

// ── Theme presets ─────────────────────────────────────────────────────────
const THEME_PRESETS = {
  'firmament-dark': {
    theme_accent_primary:     '#00e5ff',
    theme_accent_secondary:   '#8b5cf6',
    theme_bg_primary:         '#04080f',
    theme_bg_secondary:       '#060d18',
    theme_text_primary:       '#c9d6e3',
    theme_text_dim:           '#5a7a99',
    theme_card_opacity:       '0.85',
    theme_scanlines:          'true',
    theme_scanline_intensity: '0.012',
  },
  'firmament-light': {
    theme_accent_primary:     '#0077aa',
    theme_accent_secondary:   '#6d28d9',
    theme_bg_primary:         '#f0f4f8',
    theme_bg_secondary:       '#e2e8f0',
    theme_text_primary:       '#1a2332',
    theme_text_dim:           '#4a6080',
    theme_card_opacity:       '0.90',
    theme_scanlines:          'false',
    theme_scanline_intensity: '0',
  },
  'ember': {
    theme_accent_primary:     '#ff6b2b',
    theme_accent_secondary:   '#fbbf24',
    theme_bg_primary:         '#0f0805',
    theme_bg_secondary:       '#1a0f08',
    theme_text_primary:       '#e8d5c4',
    theme_text_dim:           '#8a6a55',
    theme_card_opacity:       '0.85',
    theme_scanlines:          'true',
    theme_scanline_intensity: '0.010',
  },
  'verdant': {
    theme_accent_primary:     '#00ff9d',
    theme_accent_secondary:   '#34d399',
    theme_bg_primary:         '#030f09',
    theme_bg_secondary:       '#061a0f',
    theme_text_primary:       '#c4e8d5',
    theme_text_dim:           '#4a7a5a',
    theme_card_opacity:       '0.85',
    theme_scanlines:          'true',
    theme_scanline_intensity: '0.010',
  },
  'seraph': {
    theme_accent_primary:     '#fbbf24',
    theme_accent_secondary:   '#f472b6',
    theme_bg_primary:         '#0a0805',
    theme_bg_secondary:       '#130f08',
    theme_text_primary:       '#f0e6d3',
    theme_text_dim:           '#9a8060',
    theme_card_opacity:       '0.85',
    theme_scanlines:          'false',
    theme_scanline_intensity: '0',
  },
};

const COLOUR_FIELDS = [
  ['accent-primary',   'theme_accent_primary'],
  ['accent-secondary', 'theme_accent_secondary'],
  ['bg-primary',       'theme_bg_primary'],
  ['bg-secondary',     'theme_bg_secondary'],
  ['text-primary',     'theme_text_primary'],
  ['text-dim',         'theme_text_dim'],
];

function syncColourInputs(fieldId, value) {
  const picker = document.getElementById(`tc-${fieldId}`);
  const hex    = document.getElementById(`th-${fieldId}`);
  if (picker) picker.value = value;
  if (hex)    hex.value    = value;
  updateThemePreview();
}

function getColourValue(fieldId) {
  const hex = document.getElementById(`th-${fieldId}`);
  return hex ? hex.value.trim() : '#000000';
}

function setColourControlsDisabled(disabled) {
  COLOUR_FIELDS.forEach(([fid]) => {
    const picker = document.getElementById(`tc-${fid}`);
    const hex    = document.getElementById(`th-${fid}`);
    if (picker) picker.disabled = disabled;
    if (hex)    hex.disabled    = disabled;
  });
  const opacitySlider = document.getElementById('theme-card-opacity');
  if (opacitySlider) opacitySlider.disabled = disabled;
}

function updateThemePreview() {
  const bg  = getColourValue('bg-primary');
  const bg2 = getColourValue('bg-secondary');
  const acc = getColourValue('accent-primary');
  const txt = getColourValue('text-primary');
  const dim = getColourValue('text-dim');
  const op  = document.getElementById('theme-card-opacity')?.value || '0.85';

  const preview  = document.getElementById('theme-preview');
  const bgSwatch = document.getElementById('tp-bg-swatch');
  const card     = document.getElementById('tp-card');
  const nameEl   = document.getElementById('tp-name');
  const urlEl    = document.getElementById('tp-url');
  const descEl   = document.getElementById('tp-desc');
  const accentEl = document.getElementById('tp-accent');
  const textEl   = document.getElementById('tp-text');
  const dimEl    = document.getElementById('tp-dim');

  if (preview)  preview.style.background  = bg;
  if (bgSwatch) bgSwatch.style.background = bg2;
  if (card) {
    const r = parseInt(bg2.slice(1,3),16)||6;
    const g = parseInt(bg2.slice(3,5),16)||16;
    const b = parseInt(bg2.slice(5,7),16)||30;
    card.style.background   = `rgba(${r},${g},${b},${op})`;
    card.style.borderColor  = `rgba(${parseInt(acc.slice(1,3),16)||0},${parseInt(acc.slice(3,5),16)||229},${parseInt(acc.slice(5,7),16)||255},0.2)`;
  }
  if (nameEl)   nameEl.style.color   = txt;
  if (urlEl)    urlEl.style.color    = dim;
  if (descEl)   descEl.style.color   = dim;
  if (accentEl) accentEl.style.color = acc;
  if (textEl)   textEl.style.color   = txt;
  if (dimEl)    dimEl.style.color    = dim;
}

function loadAppearanceSettings(settings) {
  const preset = settings.theme_preset || 'firmament-dark';
  const presetEl = document.getElementById('theme-preset');
  if (presetEl) presetEl.value = preset;

  COLOUR_FIELDS.forEach(([fid, key]) => {
    syncColourInputs(fid, settings[key] || '');
  });

  const opacity = settings.theme_card_opacity || '0.85';
  const opacityEl = document.getElementById('theme-card-opacity');
  if (opacityEl) { opacityEl.value = opacity; document.getElementById('card-opacity-val').textContent = opacity; }

  const scanlines = settings.theme_scanlines !== 'false';
  const scanEl = document.getElementById('theme-scanlines');
  if (scanEl) scanEl.checked = scanlines;

  const scanIntensity = settings.theme_scanline_intensity || '0.012';
  const scanIntEl = document.getElementById('theme-scanline-intensity');
  if (scanIntEl) { scanIntEl.value = scanIntensity; document.getElementById('scanline-intensity-val').textContent = scanIntensity; }

  const cornersEl = document.getElementById('theme-corner-brackets');
  if (cornersEl) cornersEl.checked = settings.theme_corner_brackets !== 'false';

  const fontHeadEl = document.getElementById('theme-font-heading');
  if (fontHeadEl) fontHeadEl.value = settings.theme_font_heading || 'Orbitron';
  const fontBodyEl = document.getElementById('theme-font-body');
  if (fontBodyEl) fontBodyEl.value = settings.theme_font_body || 'Rajdhani';
  const fontMonoEl = document.getElementById('theme-font-mono');
  if (fontMonoEl) fontMonoEl.value = settings.theme_font_mono || 'Share Tech Mono';

  const customCssEl = document.getElementById('theme-custom-css');
  if (customCssEl) customCssEl.value = settings.theme_custom_css || '';

  setColourControlsDisabled(preset !== 'custom');
  updateThemePreview();
}

function initAppearanceForm() {
  // Preset change handler
  document.getElementById('theme-preset')?.addEventListener('change', function () {
    const data = THEME_PRESETS[this.value];
    if (data) {
      COLOUR_FIELDS.forEach(([fid, key]) => syncColourInputs(fid, data[key] || ''));
      const opEl = document.getElementById('theme-card-opacity');
      if (opEl) { opEl.value = data.theme_card_opacity || '0.85'; document.getElementById('card-opacity-val').textContent = opEl.value; }
    }
    setColourControlsDisabled(this.value !== 'custom');
    updateThemePreview();
  });

  // Colour picker ↔ hex sync
  COLOUR_FIELDS.forEach(([fid]) => {
    const picker = document.getElementById(`tc-${fid}`);
    const hex    = document.getElementById(`th-${fid}`);
    picker?.addEventListener('input', () => { if (hex) hex.value = picker.value; updateThemePreview(); });
    hex?.addEventListener('input', () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex.value.trim())) {
        if (picker) picker.value = hex.value.trim();
        updateThemePreview();
      }
    });
  });

  // Range sliders
  document.getElementById('theme-card-opacity')?.addEventListener('input', function () {
    document.getElementById('card-opacity-val').textContent = parseFloat(this.value).toFixed(2);
    updateThemePreview();
  });
  document.getElementById('theme-scanline-intensity')?.addEventListener('input', function () {
    document.getElementById('scanline-intensity-val').textContent = parseFloat(this.value).toFixed(3);
  });

  // Form submit
  document.getElementById('appearance-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const preset = document.getElementById('theme-preset')?.value || 'firmament-dark';
    const payload = { theme_preset: preset };
    COLOUR_FIELDS.forEach(([fid, key]) => { payload[key] = getColourValue(fid); });
    payload.theme_card_opacity       = document.getElementById('theme-card-opacity')?.value        || '0.85';
    payload.theme_scanlines          = document.getElementById('theme-scanlines')?.checked  ? 'true' : 'false';
    payload.theme_scanline_intensity = document.getElementById('theme-scanline-intensity')?.value   || '0.012';
    payload.theme_corner_brackets    = document.getElementById('theme-corner-brackets')?.checked ? 'true' : 'false';
    payload.theme_font_heading       = document.getElementById('theme-font-heading')?.value          || 'Orbitron';
    payload.theme_font_body          = document.getElementById('theme-font-body')?.value             || 'Rajdhani';
    payload.theme_font_mono          = document.getElementById('theme-font-mono')?.value             || 'Share Tech Mono';
    payload.theme_custom_css         = sanitiseCSS(document.getElementById('theme-custom-css')?.value || '');
    try {
      await api('PUT', '/api/admin/settings', payload);
      toast('Appearance saved');
    } catch (err) { toast('Error saving appearance', 'error'); }
  });
}

function sanitiseCSS(css) {
  return css
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript\s*:/gi, 'javascript_blocked:')
    .replace(/@import\b/gi, '/* @import blocked */')
    .slice(0, 50000);
}

// ── Character form ────────────────────────────────────────────────────────
function loadCharacterSettings(settings) {
  const el = (id) => document.getElementById(id);
  if (el('char-enabled'))      el('char-enabled').checked      = settings.character_enabled !== 'false';
  if (el('char-name'))         el('char-name').value           = settings.character_name    || 'ENGEL';
  if (el('char-tagline'))      el('char-tagline').value        = settings.character_tagline || 'GUARDIAN OF THE FIRMAMENT';
  if (el('char-panel-width'))  el('char-panel-width').value    = settings.character_panel_width  || '300';
  if (el('char-blend-mode'))   el('char-blend-mode').value     = settings.character_blend_mode   || 'screen';
  if (el('char-show-status'))  el('char-show-status').checked  = settings.character_show_status  !== 'false';
  if (el('char-show-metrics')) el('char-show-metrics').checked = settings.character_show_metrics !== 'false';
  const sideRight = el('char-side-right'), sideLeft = el('char-side-left');
  if (sideRight && sideLeft) {
    sideRight.checked = settings.character_panel_side !== 'left';
    sideLeft.checked  = settings.character_panel_side === 'left';
  }
  const mobileToggle = el('character-mobile-panel-toggle');
  if (mobileToggle) mobileToggle.checked = settings.character_mobile_panel === 'visible';
}

function initCharacterForm() {
  document.getElementById('character-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const side = document.querySelector('input[name="char-side"]:checked')?.value || 'right';
    const payload = {
      character_enabled:       document.getElementById('char-enabled')?.checked      ? 'true' : 'false',
      character_name:          document.getElementById('char-name')?.value.trim()     || 'ENGEL',
      character_tagline:       document.getElementById('char-tagline')?.value.trim()  || '',
      character_panel_width:   document.getElementById('char-panel-width')?.value      || '300',
      character_blend_mode:    document.getElementById('char-blend-mode')?.value       || 'screen',
      character_show_status:   document.getElementById('char-show-status')?.checked    ? 'true' : 'false',
      character_show_metrics:  document.getElementById('char-show-metrics')?.checked   ? 'true' : 'false',
      character_panel_side:    side,
      character_mobile_panel:  document.getElementById('character-mobile-panel-toggle')?.checked ? 'visible' : 'hidden',
    };
    try {
      await api('PUT', '/api/admin/settings', payload);
      toast('Character settings saved');
    } catch (err) { toast('Error saving character settings', 'error'); }
  });
}

// ── Hero & Layout form ────────────────────────────────────────────────────
function loadHeroSettings(settings) {
  const el = (id) => document.getElementById(id);
  // Site identity (now in LAYOUT section)
  if (el('set-title'))   el('set-title').value   = settings.title   || '';
  if (el('set-tagline')) el('set-tagline').value = settings.tagline || '';
  if (el('set-card-width-desktop')) el('set-card-width-desktop').value = settings.card_width_desktop || '200';
  if (el('set-card-width-mobile'))  el('set-card-width-mobile').value  = settings.card_width_mobile  || '1';
  if (el('hero-title'))               el('hero-title').value                = settings.hero_title            || 'THE FIRMAMENT';
  if (el('hero-subtitle'))            el('hero-subtitle').value             = settings.hero_subtitle         || 'SCHROTH.CA HOMELAB';
  if (el('hero-scroll-indicator'))    el('hero-scroll-indicator').checked   = settings.hero_show_scroll_indicator !== 'false';
  if (el('layout-card-style'))        el('layout-card-style').value         = settings.layout_card_style       || 'glass';
  if (el('layout-desktop-columns'))   el('layout-desktop-columns').value    = settings.layout_desktop_columns  || 'auto';
  if (el('layout-show-descriptions')) el('layout-show-descriptions').checked = settings.layout_show_descriptions !== 'false';
  if (el('layout-show-urls'))         el('layout-show-urls').checked        = settings.layout_show_urls         !== 'false';
  if (el('footer-text-input'))        el('footer-text-input').value         = settings.footer_text              || '';
  if (el('footer-show-link'))         el('footer-show-link').checked        = settings.footer_show_link         !== 'false';
  if (el('footer-link-url'))          el('footer-link-url').value           = settings.footer_link_url          || '';
  if (el('footer-link-label'))        el('footer-link-label').value         = settings.footer_link_label        || '';
  if (el('announce-enabled'))         el('announce-enabled').checked        = settings.announcement_enabled     === 'true';
  if (el('announce-dismissible'))     el('announce-dismissible').checked    = settings.announcement_dismissible !== 'false';
  if (el('announce-colour'))          el('announce-colour').value           = settings.announcement_colour       || '#fbbf24';
  if (el('announce-text'))            el('announce-text').value             = settings.announcement_text         || '';
}

function initHeroForm() {
  document.getElementById('hero-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = (id) => document.getElementById(id);
    const payload = {
      // Site identity (merged into LAYOUT)
      title:                       el('set-title')?.value.trim()             || '',
      tagline:                     el('set-tagline')?.value.trim()           || '',
      card_width_desktop:          el('set-card-width-desktop')?.value.trim() || '200',
      card_width_mobile:           el('set-card-width-mobile')?.value.trim()  || '1',
      hero_title:                  el('hero-title')?.value.trim()            || 'THE FIRMAMENT',
      hero_subtitle:               el('hero-subtitle')?.value.trim()         || '',
      hero_show_scroll_indicator:  el('hero-scroll-indicator')?.checked     ? 'true' : 'false',
      layout_card_style:           el('layout-card-style')?.value            || 'glass',
      layout_desktop_columns:      el('layout-desktop-columns')?.value       || 'auto',
      layout_show_descriptions:    el('layout-show-descriptions')?.checked  ? 'true' : 'false',
      layout_show_urls:            el('layout-show-urls')?.checked           ? 'true' : 'false',
      footer_text:                 el('footer-text-input')?.value.trim()     || '',
      footer_show_link:            el('footer-show-link')?.checked           ? 'true' : 'false',
      footer_link_url:             el('footer-link-url')?.value.trim()       || '',
      footer_link_label:           el('footer-link-label')?.value.trim()     || '',
      announcement_enabled:        el('announce-enabled')?.checked           ? 'true' : 'false',
      announcement_dismissible:    el('announce-dismissible')?.checked       ? 'true' : 'false',
      announcement_colour:         el('announce-colour')?.value               || '#fbbf24',
      announcement_text:           el('announce-text')?.value.trim()          || '',
    };
    try {
      await api('PUT', '/api/admin/settings', payload);
      toast('Hero & layout settings saved');
    } catch (err) { toast('Error saving settings', 'error'); }
  });
}

// ── Welcome modal form ────────────────────────────────────────────────────
function loadWelcomeSettings(settings) {
  const el = (id) => document.getElementById(id);
  if (el('welcome-enabled'))        el('welcome-enabled').checked        = settings.welcome_modal_enabled === 'true';
  if (el('welcome-once'))           el('welcome-once').checked           = settings.welcome_modal_once_per_session !== 'false';
  if (el('welcome-title'))          el('welcome-title').value            = settings.welcome_modal_title   || 'WELCOME TO THE FIRMAMENT';
  if (el('welcome-body'))           el('welcome-body').value             = settings.welcome_modal_body    || '';
  if (el('welcome-button'))         el('welcome-button').value           = settings.welcome_modal_button  || 'ENTER';
}

function initWelcomeForm() {
  document.getElementById('welcome-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = (id) => document.getElementById(id);
    const payload = {
      welcome_modal_enabled:          el('welcome-enabled')?.checked ? 'true' : 'false',
      welcome_modal_once_per_session: el('welcome-once')?.checked    ? 'true' : 'false',
      welcome_modal_title:            el('welcome-title')?.value.trim() || '',
      welcome_modal_body:             el('welcome-body')?.value.trim()  || '',
      welcome_modal_button:           el('welcome-button')?.value.trim() || 'ENTER',
    };
    try {
      await api('PUT', '/api/admin/settings', payload);
      toast('Welcome modal settings saved');
    } catch (err) { toast('Error saving settings', 'error'); }
  });
}

// ── Export / Import ───────────────────────────────────────────────────────
function initExportImport() {
  // Export: the link already points to the route, just needs auth header — using native nav works since auth is cookie-based
  document.getElementById('btn-export-settings')?.addEventListener('click', (e) => {
    // Native link navigation carries cookies; no JS needed. But for auth we just let it go.
  });

  document.getElementById('btn-import-settings')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  });

  document.getElementById('import-file-input')?.addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    if (!confirm('This will overwrite your current settings. Tokens will not be imported. Continue?')) {
      this.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api('POST', '/api/admin/settings/import', data);
      toast(`Imported ${result.imported} settings (${result.skipped} skipped)`);
      await loadSettings();
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
    this.value = '';
  });
}

async function loadSettings() {
  const [settings, storagesData, borgStatus] = await Promise.all([
    api('GET', '/api/admin/settings'),
    api('GET', '/api/influxdb-storages').catch(() => ({ storages: [] })),
    api('GET', '/api/borg-status').catch(() => null),
  ]);
  metricsState.availableStorages = storagesData.storages || [];
  metricsState.borgRepos     = (borgStatus?.repositories || []).map(r => r.name);
  metricsState.borgConnected = borgStatus?.connected ?? false;

  document.getElementById('set-influx-url').value      = settings.influxdb_url      || '';
  document.getElementById('set-influx-token').value    = settings.influxdb_token    || '';
  document.getElementById('set-influx-org').value      = settings.influxdb_org      || '';
  document.getElementById('set-influx-bucket').value   = settings.influxdb_bucket   || '';
  document.getElementById('set-influx-interval').value = settings.influxdb_refresh_interval || '30';

  document.getElementById('set-borg-url').value      = settings.borg_url              || '';
  document.getElementById('set-borg-token').value    = settings.borg_token            || '';
  document.getElementById('set-borg-interval').value = settings.borg_refresh_interval || '60';
  document.getElementById('set-borg-enabled').checked = settings.borg_enabled !== 'false';

  const noVidEl = document.getElementById('show-no-videos-message');
  if (noVidEl) noVidEl.checked = settings.show_no_videos_message !== 'false';

  const borgRepoNames = parseJSON(settings.borg_repository_names || '{}', {});
  metricsState.borgRepoNames = borgRepoNames;
  renderBorgRepoNames(metricsState.borgRepos, borgRepoNames);

  metricsState.nodeMappings = parseJSON(settings.influxdb_node_mappings, []);
  metricsState.thresholds   = parseJSON(settings.influxdb_thresholds,    {});
  metricsState.overrides    = parseJSON(settings.influxdb_overrides,      []);
  metricsState.statusConfig = parseJSON(settings.influxdb_status_config,  {});
  metricsState.panelConfig  = parseJSON(settings.influxdb_panel_config,   {});

  if (metricsState.borgRepos.length > 0) {
    const currentWatch = metricsState.statusConfig.watch_borg_repos;
    if (!Array.isArray(currentWatch)) {
      metricsState.statusConfig.watch_borg_repos = [...metricsState.borgRepos];
      api('PUT', '/api/admin/settings', { influxdb_status_config: JSON.stringify(metricsState.statusConfig) }).catch(() => {});
    }
  }

  renderNodeMappings();
  renderStatusConfig();
  renderPanelConfig();
  renderOverrides();
  populateHostDropdown('new-svc-host-name', '');

  // New sections
  loadAppearanceSettings(settings);
  loadCharacterSettings(settings);
  loadHeroSettings(settings);
  loadWelcomeSettings(settings);

}

// ── Init ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    await loadCategories();
    await loadServices();
    await loadSettings();

    // Init new form handlers
    initAppearanceForm();
    initCharacterForm();
    initHeroForm();
    initWelcomeForm();
    initExportImport();

    document.getElementById('show-no-videos-message')?.addEventListener('change', async function () {
      try {
        await api('PUT', '/api/admin/settings', { show_no_videos_message: this.checked ? 'true' : 'false' });
        toast(this.checked ? '"No videos" message enabled' : '"No videos" message disabled');
      } catch (_) { toast('Error saving setting', 'error'); }
    });

    // Load media sections
    await Promise.all([loadVideos(), loadFonts(), loadFaviconSection()]);

    showPanel('live-metrics');
    applyAdminTheme();
  } catch (err) {
    if (err.message === 'Unauthorised') {
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#f44;background:#0a0a12;flex-direction:column;gap:1rem">' +
        '<div style="font-size:1.4rem">⛔ Admin access requires Authelia authentication</div>' +
        '<div style="color:#aaa">Visit <a href="/admin" style="color:#0ef">/admin</a> through the NPMplus reverse proxy with Authelia configured, then reload.</div>' +
        '</div>';
    } else {
      console.error('[Admin init]', err);
      toast('Failed to load admin panel: ' + err.message, 'error');
      showPanel('live-metrics');
    }
  }
})();
