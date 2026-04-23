/* ══════════════════════════════════════════════════════════════════════════════
   PCB Test Manager — App.js
   ══════════════════════════════════════════════════════════════════════════════ */

const App = (() => {

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  project:    null,
  activeTab:  'steps',
  saveTimer:  null,
  dirty:      false,
  editStepId: null,
  editIssueId: null,
  editTpId:   null,
  valueType:  'range',
  confirmCb:  null,
  // diagram
  fabricCanvas: null,
  diagramStepId: null,
  diagramTool:  'select',
  diagramHistory: [],
  // test points canvas
  tpFabric:   null,
  activeTpImg: null,
  placingTp:  false,
  selectedTpId: null,
};

const TP_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E',
                   '#06B6D4','#3B82F6','#8B5CF6','#EC4899','#14B8A6','#F43F5E'];

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
  async get(url)           { const r = await fetch(url); return r.json(); },
  async post(url, body)    { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return r.json(); },
  async put(url, body)     { const r = await fetch(url, { method:'PUT',  headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return r.json(); },
  async del(url)           { const r = await fetch(url, { method:'DELETE' }); return r.json(); },
  async upload(url, file)  {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch(url, { method:'POST', body: fd }); return r.json();
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const $  = id => document.getElementById(id);
const fmtDate = iso => iso ? new Date(iso).toLocaleString() : '';

function setDirty() {
  S.dirty = true;
  $('save-status').textContent = 'Unsaved…';
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(autoSave, 1200);
}

async function autoSave() {
  if (!S.project || !S.dirty) return;
  // sync editable fields
  const nameEl = $('sb-project-name'), descEl = $('sb-project-desc');
  if (nameEl) S.project.name = nameEl.textContent.trim() || S.project.name;
  if (descEl) S.project.description = descEl.textContent.trim();
  await api.put(`/api/projects/${S.project.id}`, S.project);
  S.dirty = false;
  $('save-status').textContent = 'Saved ✓';
  setTimeout(() => { if ($('save-status')) $('save-status').textContent = 'Saved'; }, 2000);
}

function updateBadges() {
  if (!S.project) return;
  $('nb-steps').textContent  = S.project.steps.length;
  $('nb-tp').textContent     = S.project.test_points.length;
  $('nb-issues').textContent = S.project.issues.length;
}

// ── Screen navigation ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('#screen-home, #screen-editor').forEach(el => el.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

async function goHome() {
  if (S.dirty) await autoSave();
  if (S.fabricCanvas) { S.fabricCanvas.dispose(); S.fabricCanvas = null; }
  if (S.tpFabric)     { S.tpFabric.dispose();     S.tpFabric = null; }
  S.project = null;
  showScreen('screen-home');
  await loadHome();
}

async function loadHome() {
  const projects = await api.get('/api/projects');
  const grid = $('project-list');
  const empty = $('home-empty');
  if (!projects.length) {
    grid.innerHTML = ''; empty.style.display = 'flex'; return;
  }
  empty.style.display = 'none';
  grid.innerHTML = projects.map(p => `
    <div class="project-card" onclick="App.openProject('${p.id}')">
      <div class="pc-rev">Rev ${p.revision || 1}</div>
      <div class="pc-name">${esc(p.name)}</div>
      <div class="pc-desc">${esc(p.description || '')}</div>
      <div class="pc-meta">
        <span>📋 ${p.step_count} steps</span>
        <span>⚠ ${p.issue_count} issues</span>
        <span>🕒 ${fmtDate(p.updated_at)}</span>
      </div>
      <button class="pc-delete" onclick="event.stopPropagation();App.deleteProject('${p.id}',this.closest('.project-card'))"
        title="Delete project">🗑</button>
    </div>`).join('');
}

async function openProject(pid) {
  S.project = await api.get(`/api/projects/${pid}`);
  showScreen('screen-editor');
  $('sb-project-name').textContent = S.project.name;
  $('sb-project-desc').textContent = S.project.description || '';
  // setup editable title/desc watchers
  $('sb-project-name').addEventListener('input', setDirty);
  $('sb-project-desc').addEventListener('input', setDirty);
  switchTab('steps');
  updateBadges();
  renderCustomTabsNav();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  S.activeTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item[data-tab]').forEach(el => el.classList.remove('active'));
  const content = $(`tab-${tab}`);
  const navBtn  = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (content) content.classList.remove('hidden');
  if (navBtn)  navBtn.classList.add('active');
  if (tab === 'steps')       renderSteps();
  if (tab === 'testpoints')  renderTestPointsTab();
  if (tab === 'issues')      renderIssues();
}

function addCustomTab() {
  const name = prompt('Tab name:');
  if (!name) return;
  const id = 'ct_' + uid();
  S.project.custom_tabs = S.project.custom_tabs || [];
  S.project.custom_tabs.push({ id, name, content: '' });
  setDirty(); renderCustomTabsNav(); switchTab(id);
}

function renderCustomTabsNav() {
  const nav = $('custom-tabs-nav');
  const cc  = $('custom-tabs-content');
  if (!nav || !S.project) return;
  nav.innerHTML = (S.project.custom_tabs || []).map(t => `
    <button class="nav-item" data-tab="${t.id}" onclick="App.switchTab('${t.id}')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>
      ${esc(t.name)}
    </button>`).join('');
  cc.innerHTML = (S.project.custom_tabs || []).map(t => `
    <div id="tab-${t.id}" class="tab-content hidden">
      <div class="tab-toolbar"><h2>${esc(t.name)}</h2></div>
      <div style="padding:20px">
        <textarea class="input textarea-lg" style="min-height:300px"
          placeholder="Notes for this tab…"
          oninput="App.updateCustomTab('${t.id}',this.value)">${esc(t.content || '')}</textarea>
      </div>
    </div>`).join('');
}

function updateCustomTab(id, val) {
  const t = (S.project.custom_tabs || []).find(x => x.id === id);
  if (t) { t.content = val; setDirty(); }
}

// ── Steps ─────────────────────────────────────────────────────────────────────
function renderSteps(filter) {
  if (!S.project) return;
  const list  = $('steps-list');
  const empty = $('steps-empty');
  let steps = S.project.steps;
  if (filter) steps = steps.filter(s =>
    s.name.toLowerCase().includes(filter) || (s.detail || '').toLowerCase().includes(filter));
  if (!steps.length) {
    list.innerHTML = ''; empty.style.display = 'flex'; return;
  }
  empty.style.display = 'none';
  list.innerHTML = steps.map((s, i) => {
    const range = formatRange(s);
    const thumb = s.diagram_thumbnail
      ? `<div class="step-diagram-preview" onclick="event.stopPropagation();App.openDiagramEditorById('${s.id}')"><img src="${s.diagram_thumbnail}"></div>` : '';
    return `
    <div class="step-card${s.diagram_json ? ' has-diagram' : ''}" data-id="${s.id}">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <div class="step-num">${i + 1}</div>
      <div class="step-body">
        <div class="step-name">${esc(s.name)}</div>
        ${s.detail ? `<div class="step-detail-text">${esc(s.detail)}</div>` : ''}
        <div class="step-meta">
          ${s.measurement_point ? `<span>📍 ${esc(s.measurement_point)}</span>` : ''}
          ${s.unit ? `<span class="step-range">${range} ${esc(s.unit)}</span>` : range ? `<span class="step-range">${range}</span>` : ''}
          <span class="badge-type ${s.type === 'user_added' ? 'badge-user' : 'badge-customer'}">${s.type === 'user_added' ? 'User' : 'Spec'}</span>
        </div>
      </div>
      ${thumb}
      <div class="step-actions">
        <button class="icon-btn" onclick="App.openStepModal('${s.id}')" title="Edit">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3-7 7H2V9L9 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn" onclick="App.duplicateStep('${s.id}')" title="Duplicate">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="icon-btn danger" onclick="App.deleteStep('${s.id}')" title="Delete">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M5 6v5M9 6v5M3 4l1 8h6l1-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  // Sortable
  if (list._sortable) list._sortable.destroy();
  list._sortable = Sortable.create(list, {
    handle: '.drag-handle', animation: 150,
    ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
    onEnd: () => {
      const newOrder = [...list.querySelectorAll('.step-card')].map(el => el.dataset.id);
      S.project.steps.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      setDirty(); renderSteps();
    }
  });
}

function filterSteps(val) { renderSteps(val.toLowerCase()); }

function formatRange(s) {
  if (s.value_type === 'pass_fail') return 'PASS/FAIL';
  if (s.value_type === 'formula')   return `=${s.formula || '?'}`;
  if (s.min !== undefined && s.max !== undefined) return `${s.min} ~ ${s.max}`;
  return '';
}

function openStepModal(stepId) {
  S.editStepId = stepId || null;
  const step = stepId ? S.project.steps.find(x => x.id === stepId) : null;
  $('step-modal-title').textContent = step ? 'Edit Step' : 'Add Step';

  // populate form
  $('s-name').value   = step?.name || '';
  $('s-detail').value = step?.detail || '';
  $('s-mp').value     = step?.measurement_point || '';
  $('s-unit').value   = step?.unit || '';
  $('s-notes').value  = step?.notes || '';
  $('s-type').value   = step?.type || 'customer_spec';

  // datalists
  updateDatalist('dl-mp',   S.project.dropdowns?.measurement_points || []);
  updateDatalist('dl-unit', S.project.dropdowns?.units || []);

  // value type
  const vt = step?.value_type || 'range';
  setValueType(vt, document.querySelector(`.vt-btn[data-vt="${vt}"]`));

  $('s-min').value     = step?.min ?? '';
  $('s-max').value     = step?.max ?? '';
  $('s-center').value  = step?.center ?? '';
  $('s-tol').value     = step?.tolerance_percent ?? '';
  $('s-formula').value = step?.formula ?? '';
  $('s-ftol').value    = step?.formula_tol ?? '';
  if (step?.center && step?.tolerance_percent) calcCenterRange();

  // diagram thumb
  const thumbImg  = $('diagram-thumb-img');
  const thumbHint = $('diagram-thumb-hint');
  if (step?.diagram_thumbnail) {
    thumbImg.innerHTML = `<img src="${step.diagram_thumbnail}" style="width:100%;height:100%;object-fit:contain">`;
    thumbHint.style.display = 'none';
  } else {
    thumbImg.innerHTML = '';
    thumbHint.style.display = 'flex';
  }

  openModal('modal-step');
  setTimeout(() => $('s-name').focus(), 50);
}

function updateDatalist(dlId, items) {
  const dl = $(dlId);
  if (!dl) return;
  dl.innerHTML = items.map(v => `<option value="${esc(v)}">`).join('');
}

function setValueType(vt, btn) {
  S.valueType = vt;
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['range','center','formula','pass_fail'].forEach(t => {
    const el = $(`vt-${t}`);
    if (el) el.classList.toggle('hidden', t !== vt);
  });
}

function calcCenterRange() {
  const c   = parseFloat($('s-center').value);
  const tol = parseFloat($('s-tol').value);
  const preview = $('s-center-preview');
  if (!isNaN(c) && !isNaN(tol)) {
    const mn = +(c * (1 - tol/100)).toFixed(4);
    const mx = +(c * (1 + tol/100)).toFixed(4);
    preview.textContent = `${mn} ~ ${mx}`;
  } else preview.textContent = '—';
}

function saveStep() {
  const name = $('s-name').value.trim();
  if (!name) { $('s-name').focus(); return; }

  // persist new dropdown items
  addToDropdown('measurement_points', $('s-mp').value.trim());
  addToDropdown('units', $('s-unit').value.trim());

  let min, max;
  const vt = S.valueType;
  if (vt === 'range') {
    min = parseFloat($('s-min').value); max = parseFloat($('s-max').value);
  } else if (vt === 'center') {
    const c = parseFloat($('s-center').value), tol = parseFloat($('s-tol').value);
    if (!isNaN(c) && !isNaN(tol)) { min = +(c*(1-tol/100)).toFixed(6); max = +(c*(1+tol/100)).toFixed(6); }
  }

  const step = {
    id:                  S.editStepId || uid(),
    name,
    detail:              $('s-detail').value.trim(),
    measurement_point:   $('s-mp').value.trim(),
    unit:                $('s-unit').value.trim(),
    notes:               $('s-notes').value.trim(),
    type:                $('s-type').value,
    value_type:          vt,
    min:                 isNaN(min)  ? undefined : min,
    max:                 isNaN(max)  ? undefined : max,
    center:              parseFloat($('s-center').value) || undefined,
    tolerance_percent:   parseFloat($('s-tol').value)    || undefined,
    formula:             $('s-formula').value.trim()     || undefined,
    formula_tol:         parseFloat($('s-ftol').value)   || undefined,
    created_at:          S.editStepId ? undefined : now(),
    updated_at:          now(),
    diagram_json:        undefined,
    diagram_thumbnail:   undefined,
  };

  // preserve diagram if editing
  if (S.editStepId) {
    const existing = S.project.steps.find(x => x.id === S.editStepId);
    if (existing) { step.diagram_json = existing.diagram_json; step.diagram_thumbnail = existing.diagram_thumbnail; step.created_at = existing.created_at; }
    S.project.steps = S.project.steps.map(x => x.id === S.editStepId ? step : x);
  } else {
    S.project.steps.push(step);
  }

  closeModal('modal-step');
  setDirty(); updateBadges(); renderSteps();
}

function addToDropdown(key, val) {
  if (!val) return;
  const arr = S.project.dropdowns[key] || [];
  if (!arr.includes(val)) { arr.push(val); S.project.dropdowns[key] = arr; }
}

function deleteStep(id) {
  confirm2('Delete this step?', () => {
    S.project.steps = S.project.steps.filter(x => x.id !== id);
    setDirty(); updateBadges(); renderSteps();
  });
}

function duplicateStep(id) {
  const s = S.project.steps.find(x => x.id === id);
  if (!s) return;
  const copy = { ...s, id: uid(), name: s.name + ' (copy)', created_at: now(), updated_at: now() };
  const idx = S.project.steps.findIndex(x => x.id === id);
  S.project.steps.splice(idx + 1, 0, copy);
  setDirty(); updateBadges(); renderSteps();
}

// ── Diagram Editor ────────────────────────────────────────────────────────────
function openDiagramEditor() {
  if (!S.editStepId) {
    // auto-save step first
    saveStep();
    return;
  }
  openDiagramEditorById(S.editStepId);
}

function openDiagramEditorById(stepId) {
  S.diagramStepId = stepId;
  const step = S.project.steps.find(x => x.id === stepId);
  $('diagram-modal-title').textContent = `Wiring Diagram — ${step?.name || ''}`;
  openModal('modal-diagram');
  setTimeout(() => initDiagramCanvas(step), 80);
}

function initDiagramCanvas(step) {
  const wrap = document.querySelector('.diagram-canvas-wrap');
  const w = wrap.clientWidth - 20, h = wrap.clientHeight - 20;
  const canvasEl = $('diagram-canvas');
  canvasEl.width  = w;
  canvasEl.height = h;

  if (S.fabricCanvas) { S.fabricCanvas.dispose(); S.fabricCanvas = null; }
  S.fabricCanvas = new fabric.Canvas('diagram-canvas', {
    width: w, height: h,
    backgroundColor: '#ffffff',
    selection: true,
  });

  // Load saved state
  if (step?.diagram_json) {
    S.fabricCanvas.loadFromJSON(step.diagram_json, () => S.fabricCanvas.renderAll());
  }

  S.diagramHistory = [];
  pushDiagramHistory();
  bindDiagramEvents();
  setDiagramTool('select');
  renderDiagramTpPanel();
}

function bindDiagramEvents() {
  const fc = S.fabricCanvas;
  fc.on('mouse:wheel', opt => {
    const delta = opt.e.deltaY;
    let zoom = fc.getZoom() * (delta > 0 ? 0.95 : 1.05);
    zoom = Math.max(0.2, Math.min(10, zoom));
    fc.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    opt.e.preventDefault(); opt.e.stopPropagation();
  });
  fc.on('object:modified', pushDiagramHistory);
  fc.on('object:added', pushDiagramHistory);

  // Line drawing state
  let lineStart = null, activeLine = null;
  fc.on('mouse:down', opt => {
    if (S.diagramTool === 'line' || S.diagramTool === 'arrow') {
      const p = fc.getPointer(opt.e);
      lineStart = p;
      activeLine = new fabric.Line([p.x, p.y, p.x, p.y], {
        stroke: $('tool-color').value,
        strokeWidth: parseInt($('tool-stroke').value),
        selectable: false, evented: false,
      });
      fc.add(activeLine);
    }
    if (S.diagramTool === 'text') {
      const p = fc.getPointer(opt.e);
      const t = new fabric.IText('Text', {
        left: p.x, top: p.y, fontSize: 16, fill: $('tool-color').value,
        fontFamily: 'system-ui, sans-serif',
      });
      fc.add(t); fc.setActiveObject(t); t.enterEditing();
      setDiagramTool('select');
    }
    if (S.diagramTool === 'rect') {
      const p = fc.getPointer(opt.e);
      const r = new fabric.Rect({
        left: p.x, top: p.y, width: 80, height: 50,
        fill: 'transparent', stroke: $('tool-color').value,
        strokeWidth: parseInt($('tool-stroke').value),
      });
      fc.add(r); fc.setActiveObject(r);
      setDiagramTool('select');
    }
  });
  fc.on('mouse:move', opt => {
    if (!activeLine) return;
    const p = fc.getPointer(opt.e);
    activeLine.set({ x2: p.x, y2: p.y }); fc.renderAll();
  });
  fc.on('mouse:up', () => {
    if (activeLine && (S.diagramTool === 'line' || S.diagramTool === 'arrow')) {
      activeLine.set({ selectable: true, evented: true });
      if (S.diagramTool === 'arrow') addArrowHead(activeLine);
      pushDiagramHistory();
      setDiagramTool('select');
    }
    activeLine = null; lineStart = null;
  });
}

function addArrowHead(line) {
  const fc = S.fabricCanvas;
  const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI;
  const tri = new fabric.Triangle({
    left: line.x2, top: line.y2,
    width: 12, height: 14,
    fill: $('tool-color').value,
    angle: angle + 90,
    originX: 'center', originY: 'center',
  });
  fc.add(tri);
}

function setDiagramTool(tool) {
  S.diagramTool = tool;
  document.querySelectorAll('.tool-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  $(`tool-${tool}`)?.classList.add('active');
  const fc = S.fabricCanvas;
  if (!fc) return;
  fc.isDrawingMode = (tool === 'pencil');
  if (fc.isDrawingMode) {
    fc.freeDrawingBrush.color = $('tool-color').value;
    fc.freeDrawingBrush.width = parseInt($('tool-stroke').value);
  }
  fc.selection = (tool === 'select');
  $('tool-color').oninput = () => { if (fc.isDrawingMode) fc.freeDrawingBrush.color = $('tool-color').value; };
  $('tool-stroke').oninput = () => { if (fc.isDrawingMode) fc.freeDrawingBrush.width = parseInt($('tool-stroke').value); };
}

function pushDiagramHistory() {
  if (!S.fabricCanvas) return;
  S.diagramHistory.push(JSON.stringify(S.fabricCanvas));
  if (S.diagramHistory.length > 30) S.diagramHistory.shift();
}

function undoDiagram() {
  if (S.diagramHistory.length < 2) return;
  S.diagramHistory.pop();
  const prev = S.diagramHistory[S.diagramHistory.length - 1];
  S.fabricCanvas.loadFromJSON(prev, () => S.fabricCanvas.renderAll());
}

function clearDiagram() {
  confirm2('Clear the entire diagram?', () => {
    S.fabricCanvas.clear(); S.fabricCanvas.backgroundColor = '#ffffff';
    S.fabricCanvas.renderAll(); pushDiagramHistory();
  });
}

function diagramZoom(factor) {
  const fc = S.fabricCanvas;
  const z = Math.max(0.2, Math.min(10, fc.getZoom() * factor));
  fc.setZoom(z);
}

function diagramFit() {
  const fc = S.fabricCanvas;
  fc.setZoom(1); fc.setViewportTransform([1,0,0,1,0,0]);
}

function saveDiagram() {
  if (!S.fabricCanvas || !S.diagramStepId) return;
  const json  = JSON.stringify(S.fabricCanvas);
  const thumb = S.fabricCanvas.toDataURL({ format: 'png', multiplier: 0.4 });
  const step  = S.project.steps.find(x => x.id === S.diagramStepId);
  if (step) { step.diagram_json = json; step.diagram_thumbnail = thumb; }
  setDirty(); closeDiagramEditor();
  // update thumbnail in open step modal if still open
  const thumbImg  = $('diagram-thumb-img');
  const thumbHint = $('diagram-thumb-hint');
  if (thumbImg && step?.diagram_thumbnail) {
    thumbImg.innerHTML = `<img src="${step.diagram_thumbnail}" style="width:100%;height:100%;object-fit:contain">`;
    if (thumbHint) thumbHint.style.display = 'none';
  }
  renderSteps();
}

function closeDiagramEditor() {
  closeModal('modal-diagram');
}

function renderDiagramTpPanel() {
  const list = $('diagram-tp-list');
  if (!list) return;
  list.innerHTML = (S.project.test_points || []).map(tp => `
    <div class="diagram-tp-item" onclick="App.placeTpOnDiagram('${tp.id}')">
      <div class="tp-dot" style="background:${tp.color}"></div>
      <span>${esc(tp.name)}</span>
    </div>`).join('') || '<div style="padding:8px;font-size:12px;color:#94A3B8">No test points defined</div>';
}

function placeTpOnDiagram(tpId) {
  const tp = S.project.test_points.find(x => x.id === tpId);
  if (!tp || !S.fabricCanvas) return;
  const fc = S.fabricCanvas;
  const cx = fc.width / 2, cy = fc.height / 2;
  const circle = new fabric.Circle({ left: cx-16, top: cy-16, radius: 14, fill: tp.color, stroke: '#fff', strokeWidth: 2 });
  const label  = new fabric.Text(tp.name, { left: cx, top: cy, fontSize: 11, fill: '#fff', fontWeight: 'bold', originX: 'center', originY: 'center' });
  const group  = new fabric.Group([circle, label], { left: cx - 16, top: cy - 16 });
  fc.add(group); fc.setActiveObject(group); fc.renderAll();
  pushDiagramHistory();
}

function importDiagramImage() { $('diagram-img-input').click(); }

function onDiagramImageSelected(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    fabric.Image.fromURL(e.target.result, img => {
      const fc = S.fabricCanvas;
      const scale = Math.min(fc.width / img.width, fc.height / img.height, 1) * 0.8;
      img.set({ left: 20, top: 20, scaleX: scale, scaleY: scale });
      fc.add(img); fc.sendToBack(img); fc.renderAll();
      pushDiagramHistory();
    });
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ── Test Points Tab ───────────────────────────────────────────────────────────
function renderTestPointsTab() {
  if (!S.project) return;
  renderTpList();
  renderTpImageSelector();
  if (S.project.images.length > 0 && !S.activeTpImg)
    setActiveTpImage(S.project.images[0]);
  else if (S.activeTpImg) initTpCanvas();
}

function renderTpList() {
  const list = $('tp-list');
  if (!list) return;
  $('tp-count').textContent = S.project.test_points.length;
  list.innerHTML = S.project.test_points.map(tp => `
    <div class="tp-item${S.selectedTpId === tp.id ? ' selected' : ''}" onclick="App.selectTp('${tp.id}')">
      <div class="tp-dot" style="background:${tp.color};width:14px;height:14px;border-radius:50%"></div>
      <div>
        <div class="tp-item-name">${esc(tp.name)}</div>
        ${tp.description ? `<div class="tp-item-desc">${esc(tp.description)}</div>` : ''}
      </div>
      <div style="display:flex;gap:4px;margin-left:auto">
        <button class="icon-btn" onclick="event.stopPropagation();App.openEditTp('${tp.id}')" title="Edit">✏</button>
        <button class="icon-btn danger" onclick="event.stopPropagation();App.deleteTp('${tp.id}')" title="Delete">🗑</button>
      </div>
    </div>`).join('') || '<div style="padding:12px;color:#94A3B8;font-size:12px">No test points yet</div>';
}

function renderTpImageSelector() {
  const sel = $('tp-image-selector');
  if (!sel) return;
  sel.innerHTML = S.project.images.map(img => `
    <div class="tp-img-thumb${S.activeTpImg?.id === img.id ? ' active' : ''}"
         onclick="App.setActiveTpImage_id('${img.id}')" title="${esc(img.label)}">
      <img src="/api/projects/${S.project.id}/images/${img.filename}">
    </div>`).join('');
}

function setActiveTpImage_id(imgId) {
  const img = S.project.images.find(x => x.id === imgId);
  if (img) setActiveTpImage(img);
}

function setActiveTpImage(img) {
  S.activeTpImg = img;
  initTpCanvas();
  renderTpImageSelector();
}

function initTpCanvas() {
  const wrap = $('tp-canvas-wrap');
  const hint = $('tp-canvas-hint');
  if (!S.activeTpImg) { if (hint) hint.style.display = 'flex'; return; }
  if (hint) hint.style.display = 'none';

  const imgUrl = `/api/projects/${S.project.id}/images/${S.activeTpImg.filename}`;
  const canvasEl = $('tp-canvas');
  const maxW = wrap.clientWidth - 20, maxH = wrap.clientHeight - 20;

  if (S.tpFabric) { S.tpFabric.dispose(); S.tpFabric = null; }

  fabric.Image.fromURL(imgUrl, fImg => {
    const scale = Math.min(maxW / fImg.width, maxH / fImg.height, 1);
    const w = Math.round(fImg.width * scale), h = Math.round(fImg.height * scale);
    canvasEl.width = w; canvasEl.height = h;
    S.tpFabric = new fabric.Canvas('tp-canvas', { width: w, height: h, selection: false });
    fImg.set({ left: 0, top: 0, scaleX: scale, scaleY: scale, selectable: false, evented: false });
    S.tpFabric.add(fImg); S.tpFabric.sendToBack(fImg);
    drawTpMarkers();
    S.tpFabric.on('mouse:down', opt => {
      if (S.placingTp) { finishPlaceTp(opt); return; }
    });
    S.tpFabric.renderAll();
  });
}

function drawTpMarkers() {
  if (!S.tpFabric) return;
  const fc = S.tpFabric;
  // remove old markers
  fc.getObjects().forEach(o => { if (o._isTpMarker) fc.remove(o); });
  const cw = fc.width, ch = fc.height;
  S.project.test_points.forEach(tp => {
    if (tp.x_pct === undefined) return;
    const x = tp.x_pct * cw, y = tp.y_pct * ch;
    const circle = new fabric.Circle({ left: x-10, top: y-10, radius: 10, fill: tp.color, stroke: '#fff', strokeWidth: 2, selectable: false, evented: true, hoverCursor: 'pointer' });
    const label  = new fabric.Text(tp.name, { left: x, top: y - 12, fontSize: 10, fill: '#fff', fontWeight: 'bold', originX: 'center', originY: 'bottom', selectable: false });
    circle._isTpMarker = label._isTpMarker = true;
    circle._tpId = tp.id;
    circle.on('mousedown', () => selectTp(tp.id));
    fc.add(circle); fc.add(label);
  });
  fc.renderAll();
}

function selectTp(id) { S.selectedTpId = id; renderTpList(); }

function openAddTestPoint() {
  S.editTpId = null;
  S.placingTp = false;
  $('tp-modal-title').textContent = 'Add Test Point';
  $('tp-name').value = '';
  $('tp-desc').value = '';
  $('tp-color').value = TP_COLORS[S.project.test_points.length % TP_COLORS.length];
  openModal('modal-tp');
}

function openEditTp(id) {
  const tp = S.project.test_points.find(x => x.id === id);
  if (!tp) return;
  S.editTpId = id;
  $('tp-modal-title').textContent = 'Edit Test Point';
  $('tp-name').value  = tp.name;
  $('tp-desc').value  = tp.description || '';
  $('tp-color').value = tp.color;
  openModal('modal-tp');
}

function saveTestPoint() {
  const name = $('tp-name').value.trim();
  if (!name) { $('tp-name').focus(); return; }
  if (S.editTpId) {
    const tp = S.project.test_points.find(x => x.id === S.editTpId);
    if (tp) { tp.name = name; tp.description = $('tp-desc').value.trim(); tp.color = $('tp-color').value; }
  } else {
    const tp = { id: uid(), name, description: $('tp-desc').value.trim(), color: $('tp-color').value };
    S.project.test_points.push(tp);
    // prompt to place on canvas
    if (S.activeTpImg && S.tpFabric) {
      S.pendingTp = tp;
      S.placingTp = true;
      alert('Click on the image to place this test point, then confirm placement.');
    }
  }
  closeModal('modal-tp');
  setDirty(); updateBadges(); renderTpList(); drawTpMarkers();
}

function finishPlaceTp(opt) {
  if (!S.pendingTp || !S.tpFabric) return;
  const p = S.tpFabric.getPointer(opt.e);
  S.pendingTp.x_pct = p.x / S.tpFabric.width;
  S.pendingTp.y_pct = p.y / S.tpFabric.height;
  S.placingTp = false; S.pendingTp = null;
  setDirty(); drawTpMarkers();
}

function deleteTp(id) {
  confirm2('Delete this test point?', () => {
    S.project.test_points = S.project.test_points.filter(x => x.id !== id);
    setDirty(); updateBadges(); renderTpList(); drawTpMarkers();
  });
}

// ── Upload Image ──────────────────────────────────────────────────────────────
function openUploadImageModal() { openModal('modal-upload-image'); }

async function uploadImage(input) {
  const file = input.files[0]; if (!file) return;
  const obj = await api.upload(`/api/projects/${S.project.id}/images`, file);
  S.project.images.push(obj);
  setDirty(); closeModal('modal-upload-image'); input.value = '';
  if (!S.activeTpImg) setActiveTpImage(obj);
  else { renderTpImageSelector(); }
}

// ── Issues ────────────────────────────────────────────────────────────────────
function renderIssues() {
  if (!S.project) return;
  const filter = $('issue-filter')?.value || 'all';
  const list  = $('issues-list');
  const empty = $('issues-empty');
  let issues = S.project.issues;
  if (filter !== 'all') issues = issues.filter(i => i.status === filter);
  if (!issues.length) { list.innerHTML = ''; empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  list.innerHTML = issues.map(i => {
    const stepRefs = (i.step_refs || []).map(sid => {
      const s = S.project.steps.find(x => x.id === sid);
      return s ? `<span class="issue-step-ref">${esc(s.name)}</span>` : '';
    }).join('');
    const attCount = (i.attachments || []).length;
    const cmtCount = (i.comments || []).length;
    return `<div class="issue-card" onclick="App.openIssueModal('${i.id}')">
      <div class="issue-top">
        <div class="issue-title">${esc(i.title)}</div>
        <span class="issue-status status-${i.status}">${i.status.replace('_',' ')}</span>
      </div>
      ${i.description ? `<div class="issue-desc">${esc(i.description)}</div>` : ''}
      <div class="issue-footer">
        ${stepRefs}
        ${attCount ? `<span>📎 ${attCount}</span>` : ''}
        ${cmtCount ? `<span>💬 ${cmtCount}</span>` : ''}
        <span style="margin-left:auto">${fmtDate(i.updated_at || i.created_at)}</span>
      </div>
    </div>`;
  }).join('');
}

function openIssueModal(issueId) {
  S.editIssueId = issueId || null;
  const issue = issueId ? S.project.issues.find(x => x.id === issueId) : null;
  $('issue-modal-title').textContent = issue ? 'Edit Issue' : 'New Issue';
  $('i-title').value  = issue?.title || '';
  $('i-status').value = issue?.status || 'open';
  $('i-desc').value   = issue?.description || '';

  // Step refs multi-select
  renderIssueStepSelect(issue?.step_refs || []);

  // Attachments
  renderIssueAttachments(issue?.attachments || []);

  // Thread
  renderIssueThread(issue?.comments || []);

  openModal('modal-issue');
  setTimeout(() => $('i-title').focus(), 50);
}

function renderIssueStepSelect(selected) {
  const wrap = $('i-steps-select');
  const tags = selected.map(sid => {
    const s = S.project.steps.find(x => x.id === sid);
    return s ? `<span class="ms-tag" onclick="App.removeStepRef('${sid}')">${esc(s.name)} ✕</span>` : '';
  }).join('');
  const opts = S.project.steps.filter(s => !selected.includes(s.id)).map(s =>
    `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  wrap.innerHTML = tags + (opts ? `<select class="select-sm" style="border:none;flex:1" onchange="App.addStepRef(this)"><option value="">+ Add step ref</option>${opts}</select>` : '');
  wrap._selected = selected;
}

function addStepRef(sel) {
  if (!sel.value) return;
  const wrap = $('i-steps-select');
  const selected = [...(wrap._selected || []), sel.value];
  renderIssueStepSelect(selected);
}

function removeStepRef(sid) {
  const wrap = $('i-steps-select');
  renderIssueStepSelect((wrap._selected || []).filter(x => x !== sid));
}

function renderIssueAttachments(attachments) {
  const list = $('i-attachments-list');
  if (!list) return;
  list._attachments = attachments;
  list.innerHTML = attachments.map(a => {
    const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename);
    return `<div class="attach-item">
      ${isImg ? `<img class="attach-img-preview" src="/api/projects/${S.project.id}/attachments/${a.filename}" onclick="App.viewImg(this.src)" title="${esc(a.original)}">` : `<span>📎 ${esc(a.original)}</span>`}
      <a href="/api/projects/${S.project.id}/attachments/${a.filename}" target="_blank" style="font-size:11px;color:#3B82F6">${esc(a.original)}</a>
      <button class="icon-btn danger" onclick="App.removeAttachment('${a.id}')">✕</button>
    </div>`;
  }).join('');
}

async function attachFiles(input) {
  const attachments = $('i-attachments-list')._attachments || [];
  for (const file of input.files) {
    const obj = await api.upload(`/api/projects/${S.project.id}/attachments`, file);
    obj.original = file.name;
    attachments.push(obj);
  }
  renderIssueAttachments(attachments);
  input.value = '';
}

function removeAttachment(id) {
  const list = $('i-attachments-list');
  list._attachments = (list._attachments || []).filter(a => a.id !== id);
  renderIssueAttachments(list._attachments);
}

function renderIssueThread(comments) {
  const thread = $('i-thread');
  if (!thread) return;
  thread._comments = comments;
  thread.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-meta">${fmtDate(c.created_at)}</div>
      <div class="comment-text">${esc(c.text)}</div>
    </div>`).join('') || '<div style="color:#94A3B8;font-size:12px;padding:4px 0">No comments yet</div>';
}

function addComment() {
  const text = $('i-comment').value.trim();
  if (!text) return;
  const thread = $('i-thread');
  const comments = [...(thread._comments || []), { id: uid(), text, created_at: now() }];
  renderIssueThread(comments);
  $('i-comment').value = '';
}

function saveIssue() {
  const title = $('i-title').value.trim();
  if (!title) { $('i-title').focus(); return; }
  const stepRefs   = $('i-steps-select')._selected || [];
  const attachments = $('i-attachments-list')._attachments || [];
  const comments   = $('i-thread')._comments || [];
  const issue = {
    id:          S.editIssueId || uid(),
    title,
    status:      $('i-status').value,
    description: $('i-desc').value.trim(),
    step_refs:   stepRefs,
    attachments,
    comments,
    created_at:  S.editIssueId ? undefined : now(),
    updated_at:  now(),
  };
  if (S.editIssueId) {
    const ex = S.project.issues.find(x => x.id === S.editIssueId);
    if (ex) issue.created_at = ex.created_at;
    S.project.issues = S.project.issues.map(x => x.id === S.editIssueId ? issue : x);
  } else {
    S.project.issues.push(issue);
  }
  closeModal('modal-issue');
  setDirty(); updateBadges(); renderIssues();
}

// ── Revisions ─────────────────────────────────────────────────────────────────
async function openRevisions() {
  const revs = await api.get(`/api/projects/${S.project.id}/revisions`);
  const list = $('rev-list');
  list.innerHTML = revs.length ? revs.map(r => `
    <div class="rev-item">
      <div class="rev-info">
        <div class="rev-label">${esc(r.label || 'Unnamed')}</div>
        <div class="rev-meta">Rev ${r.revision} · ${r.step_count} steps · ${fmtDate(r.created_at)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="App.restoreRevision('${r.id}')">Restore</button>
      <a class="btn btn-secondary btn-sm" href="/api/projects/${S.project.id}/revisions/${r.id}" target="_blank">View</a>
    </div>`).join('') : '<div style="color:#94A3B8;font-size:13px;padding:8px">No saved revisions yet</div>';
  openModal('modal-revisions');
}

async function saveRevision() {
  const label = $('rev-label').value.trim() || 'Manual save';
  await api.post(`/api/projects/${S.project.id}/revisions`, { label });
  $('rev-label').value = '';
  await openRevisions();
}

async function restoreRevision(rid) {
  confirm2('Restore this revision? Current changes will be overwritten.', async () => {
    await fetch(`/api/projects/${S.project.id}/revisions/${rid}/restore`, { method: 'POST' });
    S.project = await api.get(`/api/projects/${S.project.id}`);
    closeModal('modal-revisions');
    renderSteps(); renderTpList(); renderIssues(); updateBadges();
  });
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportHTML() {
  window.open(`/api/projects/${S.project.id}/export/html`, '_blank');
}

// ── Create / Delete project ───────────────────────────────────────────────────
function openCreateProject() {
  $('cp-name').value = '';
  $('cp-desc').value = '';
  openModal('modal-create-project');
  setTimeout(() => $('cp-name').focus(), 50);
}

async function createProject() {
  const name = $('cp-name').value.trim();
  if (!name) { $('cp-name').focus(); return; }
  const proj = await api.post('/api/projects', { name, description: $('cp-desc').value.trim() });
  closeModal('modal-create-project');
  await openProject(proj.id);
}

function deleteProject(id, cardEl) {
  confirm2('Delete this project permanently?', async () => {
    await api.del(`/api/projects/${id}`);
    cardEl?.remove();
    const remaining = document.querySelectorAll('.project-card').length;
    if (!remaining) { $('home-empty').style.display = 'flex'; }
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  $(id).classList.remove('hidden');
  $(id).addEventListener('click', e => { if (e.target === $(id)) closeModal(id); }, { once: true });
}

function closeModal(id) { $(id).classList.add('hidden'); }

function confirm2(msg, cb) {
  $('confirm-msg').textContent = msg;
  S.confirmCb = cb;
  openModal('modal-confirm');
}
function confirmAccept() { closeModal('modal-confirm'); if (S.confirmCb) S.confirmCb(); S.confirmCb = null; }
function confirmReject() { closeModal('modal-confirm'); S.confirmCb = null; }

function viewImg(src) {
  const w = window.open('', '_blank');
  w.document.write(`<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${src}" style="max-width:100%;max-height:100vh"></body>`);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));
  }
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); autoSave();
  }
  // Diagram tool shortcuts
  if (!$('modal-diagram')?.classList.contains('hidden')) {
    if (!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      if (e.key === 'v' || e.key === 'V') setDiagramTool('select');
      if (e.key === 'p' || e.key === 'P') setDiagramTool('pencil');
      if (e.key === 'l' || e.key === 'L') setDiagramTool('line');
      if (e.key === 'a' || e.key === 'A') setDiagramTool('arrow');
      if (e.key === 'r' || e.key === 'R') setDiagramTool('rect');
      if (e.key === 't' || e.key === 'T') setDiagramTool('text');
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')
          S.fabricCanvas?.getActiveObjects().forEach(o => S.fabricCanvas.remove(o));
      }
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  showScreen('screen-home');
  await loadHome();
}

init();

// ── Public API ────────────────────────────────────────────────────────────────
return {
  goHome, openProject, loadHome,
  switchTab, addCustomTab, updateCustomTab,
  renderSteps, filterSteps,
  openStepModal, setValueType, calcCenterRange, saveStep, deleteStep, duplicateStep,
  openDiagramEditor, openDiagramEditorById, saveDiagram, closeDiagramEditor,
  setDiagramTool, undoDiagram, clearDiagram, diagramZoom, diagramFit,
  importDiagramImage, onDiagramImageSelected, placeTpOnDiagram,
  renderTestPointsTab, setActiveTpImage_id, selectTp,
  openAddTestPoint, openEditTp, saveTestPoint, deleteTp,
  openUploadImageModal, uploadImage,
  renderIssues, openIssueModal, saveIssue, addComment,
  addStepRef, removeStepRef, attachFiles, removeAttachment, viewImg,
  openRevisions, saveRevision, restoreRevision,
  exportHTML,
  openCreateProject, createProject, deleteProject,
  openModal, closeModal,
  confirmAccept, confirmReject,
};

})();
