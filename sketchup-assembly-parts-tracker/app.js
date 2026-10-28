// Assembly Parts Tracker — one table row per top-level Group / ComponentInstance.
//
// Part data lives in an attribute dictionary on each entity (DICT below), so
// edits persist in the .skp. Writes go through model.performOperation; reads
// don't. Clicking a row calls model.updateSelection to highlight the part in
// the model (a Selection call, not a mutation).

const DICT = 'AssemblyParts';
const STATUSES = ['Pending', 'Ordered', 'Onsite', 'Installed'];
const BASE_MATERIALS = ['4x8 Douglas Fir', '6x6 HSS', '6x12 HSS'];
const STATUS_COLOR = {
  Pending: 'var(--muted)', Ordered: 'var(--info)', Onsite: 'var(--warn)', Installed: 'var(--ok)',
};
const LIVE_UPDATE_DEBOUNCE_MS = 300;

const el = (id) => document.getElementById(id);

let model = null;
let parts = [];        // [{ entity, id, uniqueId, partNumber, material, cutLength, supplier, installer, status }]
let filter = 'All';
let query = '';
let selectedId = null;
let liveHandle = null;
let liveTimer = null;

function showError(msg) {
  el('error').textContent = msg;
  el('error').hidden = !msg;
}

function readAttr(entity, key, fallback = '') {
  try {
    return entity.attributes.findValue(DICT, key, { default: fallback });
  } catch {
    return fallback;
  }
}

async function loadParts() {
  const children = await model.entities.get();
  const materials = await model.getMaterials();
  parts = [];
  for (const entity of children) {
    const type = entity?.constructor?.name;
    if (type !== 'Group' && type !== 'ComponentInstance') continue;
    const modelMaterial = entity.materialId != null
      ? (materials.findMaterialById(entity.materialId)?.name ?? '') : '';
    parts.push({
      entity,
      id: entity.id,
      uniqueId: `P-${String(entity.id).padStart(3, '0')}`,
      partNumber: readAttr(entity, 'partNumber', entity.name || ''),
      material: readAttr(entity, 'material', modelMaterial),
      cutLength: readAttr(entity, 'cutLength'),
      supplier: readAttr(entity, 'supplier'),
      installer: readAttr(entity, 'installer'),
      status: readAttr(entity, 'status', 'Pending'),
    });
  }
}

function visibleParts() {
  const q = query.trim().toLowerCase();
  return parts.filter((p) => {
    if (filter !== 'All' && p.status !== filter) return false;
    if (!q) return true;
    return [p.uniqueId, p.partNumber, p.material, p.cutLength, p.supplier, p.installer]
      .join(' ').toLowerCase().includes(q);
  });
}

function textCell(part, key, mono) {
  const td = document.createElement('td');
  if (mono) td.className = 'mono';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = part[key];
  input.setAttribute('aria-label', `${key} for ${part.uniqueId}`);
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', () => saveField(part, key, input.value));
  td.appendChild(input);
  return td;
}

function selectCell(part, key, options) {
  const td = document.createElement('td');
  const select = document.createElement('select');
  const values = options.includes(part[key]) || !part[key] ? options : [part[key], ...options];
  for (const v of values) select.add(new Option(v, v));
  select.value = part[key] || values[0];
  select.setAttribute('aria-label', `${key} for ${part.uniqueId}`);
  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', () => saveField(part, key, select.value));
  td.appendChild(select);
  if (key === 'status') {
    td.className = 'status';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = STATUS_COLOR[part.status] || STATUS_COLOR.Pending;
    td.insertBefore(dot, select);
  }
  return td;
}

function render() {
  const shown = visibleParts();
  const tbody = el('rows');
  tbody.replaceChildren();
  for (const part of shown) {
    const tr = document.createElement('tr');
    tr.dataset.id = part.id;
    tr.classList.toggle('selected', part.id === selectedId);
    const idCell = document.createElement('td');
    idCell.className = 'id';
    idCell.textContent = part.uniqueId;
    tr.append(
      idCell,
      textCell(part, 'partNumber', true),
      selectCell(part, 'material', BASE_MATERIALS),
      textCell(part, 'cutLength', true),
      textCell(part, 'supplier'),
      textCell(part, 'installer'),
      selectCell(part, 'status', STATUSES),
    );
    tr.addEventListener('click', () => selectPart(part));
    tbody.appendChild(tr);
  }
  el('empty').hidden = shown.length > 0;

  const chips = el('chips');
  chips.replaceChildren();
  for (const label of ['All', ...STATUSES]) {
    const count = label === 'All' ? parts.length : parts.filter((p) => p.status === label).length;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(filter === label));
    chip.textContent = `${label} (${count})`;
    chip.addEventListener('click', () => { filter = label; render(); });
    chips.appendChild(chip);
  }

  const installed = parts.filter((p) => p.status === 'Installed').length;
  const pct = parts.length ? Math.round((installed / parts.length) * 100) : 0;
  el('progress-text').textContent = `${installed} of ${parts.length} parts`;
  el('progress-fill').style.width = `${pct}%`;
  el('footer').textContent = `Showing ${shown.length} of ${parts.length} parts. Edits are saved to the model as you make them.`;
}

async function selectPart(part) {
  selectedId = part.id;
  for (const tr of el('rows').children) tr.classList.toggle('selected', tr.dataset.id === String(part.id));
  try {
    await model.updateSelection([part.entity], 'replace');
  } catch (e) {
    console.error('[Parts Tracker] select failed', e);
    showError(`Could not select the part in the model: ${e.message}`);
  }
}

async function saveField(part, key, value) {
  part[key] = value;
  try {
    await model.performOperation(async (op) => {
      op.entitySetAttribute(part.entity, [DICT], key, value);
    }, 'Edit Part');
    showError('');
  } catch (e) {
    console.error('[Parts Tracker] save failed', e);
    showError(`Could not save ${key}: ${e.message}`);
  }
  render();
}

// Demo helper: fills only EMPTY fields so a bare model shows a believable table.
async function seedDemoData() {
  const suppliers = ['Supplier A', 'Supplier B', 'Supplier C'];
  const crews = ['Crew 1', 'Crew 2', 'Crew 3'];
  try {
    await model.performOperation(async (op) => {
      parts.forEach((p, i) => {
        const defaults = {
          material: BASE_MATERIALS[i % BASE_MATERIALS.length],
          cutLength: `${8 + (i % 4) * 2}'-0"`,
          supplier: suppliers[i % 3],
          installer: crews[i % 3],
          status: STATUSES[i % STATUSES.length],
        };
        for (const [key, value] of Object.entries(defaults)) {
          const stored = p.entity.attributes.hasValue(DICT, key);
          if (!stored || !p[key]) op.entitySetAttribute(p.entity, [DICT], key, value);
        }
      });
    }, 'Fill Demo Part Data');
    await refresh();
  } catch (e) {
    showError(`Could not fill demo data: ${e.message}`);
  }
}

async function refresh() {
  try {
    await loadParts();
    showError('');
    render();
  } catch (e) {
    console.error('[Parts Tracker] load failed', e);
    showError(`Could not read the model: ${e.message}`);
  }
}

// Live updates: re-read when the model changes, but never while the user is
// mid-edit in a cell (that would swallow their typing).
function startLiveUpdates() {
  try {
    liveHandle = SketchUpApi.observeActiveModel(async (streamModel) => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(async () => {
        if (el('rows').contains(document.activeElement)) return;
        model = await streamModel.getModel();
        await refresh();
      }, LIVE_UPDATE_DEBOUNCE_MS);
    });
  } catch (e) {
    console.warn('[Parts Tracker] live updates unavailable; use Refresh', e);
  }
}

el('search').addEventListener('input', (e) => { query = e.target.value; render(); });
el('refresh').addEventListener('click', refresh);
el('seed').addEventListener('click', seedDemoData);

async function init() {
  try {
    await SketchUpApi.connect();
    model = await SketchUpApi.getActiveModel();
    el('refresh').disabled = false;
    el('seed').disabled = false;
    await refresh();
    startLiveUpdates();
  } catch (e) {
    console.error('[Parts Tracker] connection failed', e);
    el('footer').textContent = 'Not connected';
    showError(`Not connected to SketchUp (${e.message}). This panel only works inside SketchUp.`);
  }
}

window.addEventListener('beforeunload', () => {
  clearTimeout(liveTimer);
  liveHandle?.stop?.();
  SketchUpApi.disconnect();
});

init();
