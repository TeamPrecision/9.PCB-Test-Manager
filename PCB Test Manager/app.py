from flask import Flask, request, jsonify, render_template, send_from_directory, abort, Response
import json, os, uuid, shutil, base64, mimetypes
from datetime import datetime
from pathlib import Path
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB

BASE_DIR   = Path(__file__).parent
PROJ_DIR   = BASE_DIR / 'projects'
PROJ_DIR.mkdir(exist_ok=True)

IMG_EXTS  = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'}
FILE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.pdf', '.docx', '.xlsx',
             '.txt', '.zip', '.csv', '.bmp', '.webp'}

def pdir(pid):  return PROJ_DIR / pid
def pfile(pid): return pdir(pid) / 'project.json'
def imgdir(pid): return pdir(pid) / 'images'
def attdir(pid): return pdir(pid) / 'attachments'
def revdir(pid): return pdir(pid) / 'revisions'

def load(pid):
    if not pfile(pid).exists(): abort(404)
    return json.loads(pfile(pid).read_text('utf-8'))

def save(pid, data):
    data['updated_at'] = datetime.now().isoformat()
    pfile(pid).write_text(json.dumps(data, indent=2, ensure_ascii=False), 'utf-8')

def uid(): return str(uuid.uuid4())[:8]

def now(): return datetime.now().isoformat()

# ── Serve app ─────────────────────────────────────────────────────────────────
@app.route('/')
def index(): return render_template('index.html')

# ── Projects ──────────────────────────────────────────────────────────────────
@app.route('/api/projects')
def list_projects():
    out = []
    for d in PROJ_DIR.iterdir():
        f = d / 'project.json'
        if not f.exists(): continue
        try:
            p = json.loads(f.read_text('utf-8'))
            out.append({
                'id': p['id'], 'name': p['name'],
                'description': p.get('description', ''),
                'updated_at': p.get('updated_at', ''),
                'step_count': len(p.get('steps', [])),
                'issue_count': len(p.get('issues', [])),
                'revision': p.get('revision', 1),
            })
        except Exception: pass
    return jsonify(sorted(out, key=lambda x: x['updated_at'], reverse=True))

@app.route('/api/projects', methods=['POST'])
def create_project():
    pid = uid()
    body = request.json or {}
    for d in [pdir(pid), imgdir(pid), attdir(pid), revdir(pid)]:
        d.mkdir(parents=True, exist_ok=True)
    data = {
        'id': pid,
        'name': body.get('name', 'Untitled Project'),
        'description': body.get('description', ''),
        'created_at': now(), 'updated_at': now(),
        'revision': 1,
        'images': [],
        'test_points': [],
        'steps': [],
        'issues': [],
        'custom_tabs': [],
        'dropdowns': {
            'units': ['V', 'A', 'W', 'Ω', 'mV', 'mA', 'mW', 'μA', 'μΩ', '%', '°C', 'Hz', 'kHz', 'MHz'],
            'measurement_points': [],
            'step_types': ['customer_spec', 'user_added'],
        }
    }
    save(pid, data)
    return jsonify(data), 201

@app.route('/api/projects/<pid>')
def get_project(pid): return jsonify(load(pid))

@app.route('/api/projects/<pid>', methods=['PUT'])
def update_project(pid):
    data = request.json
    data['id'] = pid
    save(pid, data)
    return jsonify({'ok': True, 'updated_at': data['updated_at']})

@app.route('/api/projects/<pid>', methods=['DELETE'])
def delete_project(pid):
    if pdir(pid).exists(): shutil.rmtree(pdir(pid))
    return jsonify({'ok': True})

# ── Images ────────────────────────────────────────────────────────────────────
@app.route('/api/projects/<pid>/images', methods=['POST'])
def upload_image(pid):
    proj = load(pid)
    f = request.files.get('file')
    if not f: abort(400)
    ext = Path(f.filename).suffix.lower()
    if ext not in IMG_EXTS: abort(400, 'Unsupported image type')
    iid = uid()
    fname = iid + ext
    f.save(imgdir(pid) / fname)
    obj = {'id': iid, 'filename': fname, 'label': f.filename}
    proj['images'].append(obj)
    save(pid, proj)
    return jsonify(obj), 201

@app.route('/api/projects/<pid>/images/<fname>')
def serve_image(pid, fname):
    return send_from_directory(imgdir(pid), fname)

@app.route('/api/projects/<pid>/images/<iid>', methods=['DELETE'])
def delete_image(pid, iid):
    proj = load(pid)
    proj['images'] = [i for i in proj['images'] if i['id'] != iid]
    for img in list((imgdir(pid)).glob(f'{iid}.*')):
        img.unlink(missing_ok=True)
    save(pid, proj)
    return jsonify({'ok': True})

# ── Attachments ───────────────────────────────────────────────────────────────
@app.route('/api/projects/<pid>/attachments', methods=['POST'])
def upload_attachment(pid):
    load(pid)
    f = request.files.get('file')
    if not f: abort(400)
    ext = Path(f.filename).suffix.lower()
    if ext not in FILE_EXTS: abort(400, 'Unsupported file type')
    aid = uid()
    fname = aid + ext
    f.save(attdir(pid) / fname)
    return jsonify({'id': aid, 'filename': fname, 'original': f.filename,
                    'ext': ext, 'uploaded_at': now()}), 201

@app.route('/api/projects/<pid>/attachments/<fname>')
def serve_attachment(pid, fname):
    return send_from_directory(attdir(pid), fname)

# ── Revisions ─────────────────────────────────────────────────────────────────
@app.route('/api/projects/<pid>/revisions')
def list_revisions(pid):
    out = []
    for f in sorted(revdir(pid).glob('*.json'), reverse=True):
        try:
            d = json.loads(f.read_text('utf-8'))
            out.append({'id': f.stem, 'label': d.get('label', ''),
                        'created_at': d.get('saved_at', ''),
                        'revision': d.get('revision', 1),
                        'step_count': len(d.get('steps', [])),
                        'issue_count': len(d.get('issues', []))})
        except Exception: pass
    return jsonify(out)

@app.route('/api/projects/<pid>/revisions', methods=['POST'])
def create_revision(pid):
    proj = load(pid)
    label = (request.json or {}).get('label', 'Manual save')
    rid = datetime.now().strftime('%Y%m%d_%H%M%S')
    snapshot = {**proj, 'label': label, 'saved_at': now()}
    (revdir(pid) / f'{rid}.json').write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False), 'utf-8')
    proj['revision'] = proj.get('revision', 1) + 1
    save(pid, proj)
    return jsonify({'id': rid, 'label': label}), 201

@app.route('/api/projects/<pid>/revisions/<rid>')
def get_revision(pid, rid):
    f = revdir(pid) / f'{rid}.json'
    if not f.exists(): abort(404)
    return jsonify(json.loads(f.read_text('utf-8')))

@app.route('/api/projects/<pid>/revisions/<rid>/restore', methods=['POST'])
def restore_revision(pid, rid):
    f = revdir(pid) / f'{rid}.json'
    if not f.exists(): abort(404)
    snap = json.loads(f.read_text('utf-8'))
    for k in ('label', 'saved_at'): snap.pop(k, None)
    save(pid, snap)
    return jsonify({'ok': True})

# ── Export ────────────────────────────────────────────────────────────────────
def to_b64(path):
    if not Path(path).exists(): return None
    mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
    return f"data:{mime};base64,{base64.b64encode(Path(path).read_bytes()).decode()}"

@app.route('/api/projects/<pid>/export/html')
def export_html(pid):
    proj = load(pid)
    img_map = {}
    for img in proj.get('images', []):
        b64 = to_b64(imgdir(pid) / img['filename'])
        if b64: img_map[img['id']] = b64
    att_map = {}
    for issue in proj.get('issues', []):
        for att in issue.get('attachments', []):
            ext = Path(att['filename']).suffix.lower()
            if ext in IMG_EXTS:
                b64 = to_b64(attdir(pid) / att['filename'])
                if b64: att_map[att['id']] = b64
    html = render_template('export.html', proj=proj, img_map=img_map, att_map=att_map,
                           generated=datetime.now().strftime('%Y-%m-%d %H:%M'))
    safe = proj['name'].replace(' ', '_').replace('/', '-')
    return Response(html, mimetype='text/html',
        headers={'Content-Disposition': f'attachment; filename="{safe}_report.html"'})

if __name__ == '__main__':
    print('\n  PCB Test Manager running at  http://localhost:5000\n')
    app.run(debug=True, port=5000, use_reloader=False)
