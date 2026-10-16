// The companion page: the same data as the pane, drawn as an architecture diagram and a trace.
// Inspirations: the layered Client → Controller → Service → Model → DB diagram (colored lanes,
// arrows), Figma's dotted canvas, GitHub Actions' status dots, Datadog/Vercel trace waterfalls,
// VS Code's tab strip and Linear's quiet type.
import type { FlowEdge, FlowFile, FlowNode } from '../types'
import { base, LAYERS, shortModel, took } from './model'

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const COL_W = 210
const COL_GAP = 80
const NODE_H = 40
const NODE_GAP = 14
const TOP = 64
const ROW_GAP = 36

// The map with `perRow` lanes to a row, wrapping in reading order (Client → API → Service, then the rest).
// The page draws one per row count and shows whichever fits the window largest.
export function layout(files: FlowFile[], edges: FlowEdge[], perRow: number) {
  const lanes = LAYERS.filter(l => files.some(f => f.layer === l.id))
  const cols = Math.max(1, Math.min(perRow, lanes.length))
  const rows = Math.max(1, ...lanes.map(l => files.filter(f => f.layer === l.id).length))
  const rowH = TOP + rows * (NODE_H + NODE_GAP) + 44 // room under the cards for arrows that skip a lane
  const at = (i: number) => ({ row: Math.floor(i / cols), col: i % cols, x: 24 + (i % cols) * (COL_W + COL_GAP), y: Math.floor(i / cols) * (rowH + ROW_GAP) })
  const pos = new Map<string, { x: number; y: number; row: number; col: number; color: string }>()
  lanes.forEach((l, i) => {
    const o = at(i)
    files.filter(f => f.layer === l.id).forEach((f, j) => pos.set(f.key, { ...o, y: o.y + TOP + j * (NODE_H + NODE_GAP), color: l.web }))
  })
  const nRows = Math.ceil(lanes.length / cols)
  const width = Math.max(600, 48 + cols * (COL_W + COL_GAP) - COL_GAP)
  const height = nRows * rowH + (nRows - 1) * ROW_GAP + 10
  const live = new Set(files.filter(f => f.active).map(f => f.key))

  const laneSvg = lanes
    .map((l, i) => {
      const o = at(i)
      return `<rect x="${o.x - 10}" y="${o.y + 14}" width="${COL_W + 20}" height="${rowH - 24}" rx="14" class="lane" style="--c:${l.web}"/>
<text x="${o.x + COL_W / 2}" y="${o.y + 40}" class="lane-t" style="fill:${l.web}">${esc(l.name)}</text>`
    })
    .join('\n')

  const edgeSvg = edges
    .map(e => {
      const a = pos.get(e.from)
      const b = pos.get(e.to)
      if (!a || !b) return ''
      const hot = live.has(e.from) || live.has(e.to)
      let d: string
      if (a.row !== b.row) {
        // Between rows: leave from the card's bottom (or top) and come in at the other's top (or bottom).
        const down = b.row > a.row
        const ax = a.x + COL_W / 2
        const bx = b.x + COL_W / 2
        const y1 = down ? a.y + NODE_H : a.y
        const y2 = down ? b.y : b.y + NODE_H
        const m = (y1 + y2) / 2
        d = `M${ax},${y1} C${ax},${m} ${bx},${m} ${bx},${y2}`
      } else if (Math.abs(a.col - b.col) > 1) {
        const channel = a.row * (rowH + ROW_GAP) + rowH - 22
        const ax = a.x + COL_W / 2
        const bx = b.x + COL_W / 2
        d = `M${ax},${a.y + NODE_H} C${ax},${channel} ${bx},${channel} ${bx},${b.y + NODE_H}`
      } else if (a.col === b.col) {
        const x = a.x + COL_W
        d = `M${x},${a.y + NODE_H / 2} C${x + 46},${a.y + NODE_H / 2} ${x + 46},${b.y + NODE_H / 2} ${x},${b.y + NODE_H / 2}`
      } else {
        const fwd = b.x > a.x
        const x1 = fwd ? a.x + COL_W : a.x
        const x2 = fwd ? b.x : b.x + COL_W
        const mid = (x1 + x2) / 2
        d = `M${x1},${a.y + NODE_H / 2} C${mid},${a.y + NODE_H / 2} ${mid},${b.y + NODE_H / 2} ${x2},${b.y + NODE_H / 2}`
      }
      return `<path d="${d}" class="edge${hot ? ' hot' : ''}${e.planned ? ' plan' : ''}" marker-end="url(#${hot ? 'ah' : 'a'})"><title>${esc(base(e.from))} → ${esc(base(e.to))}${e.label ? ` · ${esc(e.label)}` : ''}</title></path>`
    })
    .join('\n')

  const nodeSvg = files
    .map(f => {
      const p = pos.get(f.key)
      if (!p) return ''
      const icon = f.active === 'editing' ? '✎' : f.active === 'reading' ? '◉' : f.status === 'created' ? '+' : f.status === 'edited' ? '✓' : f.status === 'planned' ? '○' : '·'
      const tag = f.status === 'planned' ? (f.action === 'create' ? 'NEW' : f.action === 'delete' ? 'DEL' : 'PLAN') : f.status === 'created' ? 'NEW' : ''
      const name = base(f.path)
      return `<g class="node ${f.status}${f.active ? ' live' : ''}" transform="translate(${p.x},${p.y})" style="--c:${p.color}">
<title>${esc(f.path)}${f.note ? `\n${esc(f.note)}` : ''}${f.model ? `\n${esc(f.by ?? '')} · ${esc(f.model)}` : ''}</title>
<rect width="${COL_W}" height="${NODE_H}" rx="9"/>
<text x="12" y="25" class="ic">${icon}</text>
<text x="30" y="25" class="nm">${esc(name.length > 24 ? `${name.slice(0, 23)}…` : name)}</text>
${tag ? `<text x="${COL_W - 10}" y="25" class="tag">${tag}</text>` : ''}
${f.active ? `<text x="0" y="${NODE_H + 12}" class="who">${esc(f.by ?? 'main')} · ${esc(shortModel(f.model))}</text>` : ''}
</g>`
    })
    .join('\n')

  return { width, height, svg: `${laneSvg}\n${edgeSvg}\n${nodeSvg}` }
}

export function page(data: { files: FlowFile[]; edges: FlowEdge[]; nodes: FlowNode[]; project: string }, at = Date.now()) {
  const { files, edges, nodes, project } = data
  const n = LAYERS.filter(l => files.some(f => f.layer === l.id)).length
  const variants = [...new Set([n, Math.ceil(n / 2), Math.ceil(n / 3)])].filter(c => c >= 1).map(c => layout(files, edges, c))

  const now = files.find(f => f.active)
  const t0 = Math.min(at, ...nodes.map(n => n.start))
  const span = Math.max(1, at - t0)
  const trace = nodes
    .filter(n => n.kind !== 'tool' || n.family === 'edit' || n.family === 'shell')
    .slice(-60)
    .map(n => {
      const left = ((n.start - t0) / span) * 100
      const w = Math.max(0.6, (((n.end ?? at) - n.start) / span) * 100)
      return `<div class="tr ${n.kind}"><span class="dot ${n.status}"></span><span class="tl">${esc(n.kind === 'tool' ? `${n.family}: ${n.label}` : n.label)}</span>${n.model ? `<span class="chip">${esc(shortModel(n.model))}</span>` : '<span></span>'}<span class="bar"><i class="${n.status}" style="left:${left}%;width:${w}%"></i></span><span class="tt">${took(n, at)}</span></div>`
    })
    .join('\n')

  const counts = {
    planned: files.filter(f => f.status === 'planned').length,
    changed: files.filter(f => f.status === 'edited' || f.status === 'created').length,
    agents: nodes.filter(n => n.kind === 'agent').length,
    running: nodes.filter(n => n.kind === 'agent' && n.status === 'running').length,
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flowmap</title>
<style>
:root{--bg:#f6f6f4;--panel:#fff;--ink:#1d1d1f;--mute:#6b6b70;--line:#d9d9de;--accent:#e8743b;--ok:#2e9d5b;--bad:#d64545;--run:#d99a1e}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--panel:#1b1b1f;--ink:#ececf0;--mute:#8d8d96;--line:#2c2c33;--accent:#f08a50;--ok:#4cc27c;--bad:#ef6464;--run:#f2b84b}}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;gap:16px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
h1{font-size:15px;margin:0;font-weight:600}h1 small{color:var(--mute);font-weight:400;margin-left:6px}
nav{display:flex;gap:2px;background:var(--bg);border-radius:8px;padding:3px}
nav a{padding:5px 14px;border-radius:6px;color:var(--mute);text-decoration:none;font-weight:500}nav a.on{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px #0002}
.stats{display:flex;gap:14px;color:var(--mute);font-size:13px;margin-left:auto}.stats b{color:var(--ink)}
.now{margin:10px 16px 0;padding:9px 14px;border-radius:10px;background:var(--panel);border:1px solid var(--line);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.now .pulse{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent);animation:p 1.4s infinite}
@keyframes p{70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 0 transparent}}
.chip{font-size:11.5px;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);font-weight:600;white-space:nowrap}
.muted{color:var(--mute)}
.canvas{flex:1;min-height:0;position:relative;margin:10px 16px 16px;border-radius:12px;border:1px solid var(--line);overflow:hidden;background:var(--panel) radial-gradient(var(--line) 1px,transparent 1px) 0 0/18px 18px;cursor:grab;touch-action:none;user-select:none}
.canvas.drag{cursor:grabbing}
svg{display:block;width:100%;height:100%}
.ctl{position:absolute;right:12px;bottom:12px;display:flex;align-items:center;gap:2px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:4px;box-shadow:0 4px 14px #0002;cursor:default}
.ctl button{border:0;background:none;color:var(--ink);font:inherit;min-width:32px;height:30px;border-radius:7px;cursor:pointer;padding:0 8px}
.ctl button:hover{background:var(--bg)}.ctl #zl{min-width:52px;color:var(--mute);font-variant-numeric:tabular-nums}
.canvas .legend{position:absolute;left:12px;bottom:12px;padding:6px 12px;background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line);border-radius:10px;cursor:default}
.hint{position:absolute;left:12px;top:10px;color:var(--mute);font-size:12px;pointer-events:none}
.lane{fill:color-mix(in srgb,var(--c) 9%,transparent);stroke:color-mix(in srgb,var(--c) 35%,transparent)}
.lane-t{font-weight:600;font-size:13px;text-anchor:middle}
.node rect{fill:color-mix(in srgb,var(--c) 30%,var(--panel));stroke:color-mix(in srgb,var(--c) 70%,var(--ink) 10%);stroke-width:1.3}
.node.planned rect{fill:var(--panel);stroke-dasharray:5 4}.node.planned{opacity:.8}
.node.read rect{fill:color-mix(in srgb,var(--c) 12%,var(--panel))}
.node.live rect{stroke:var(--accent);stroke-width:2.4;filter:drop-shadow(0 0 7px var(--accent))}
.node text{fill:var(--ink)}.ic{font-size:13px;font-weight:700}.nm{font-size:12.5px;font-weight:500}
.tag{font-size:10px;font-weight:700;text-anchor:end;fill:var(--mute)!important;letter-spacing:.5px}
.who{font-size:10.5px;fill:var(--accent)!important;font-weight:600}
.edge{fill:none;stroke:var(--mute);stroke-width:1.4;opacity:.55}.edge.plan{stroke-dasharray:4 4}
.edge.hot{stroke:var(--accent);opacity:1;stroke-width:2;stroke-dasharray:6 5;animation:d 0.8s linear infinite}
@keyframes d{to{stroke-dashoffset:-11}}
.legend{display:flex;gap:16px;padding:0 20px;color:var(--mute);font-size:12.5px;flex-wrap:wrap}
.empty{padding:48px;text-align:center;color:var(--mute)}
section{display:none;flex:1;min-height:0;flex-direction:column}section.on{display:flex}
.trace{margin:10px 16px 16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px 0;overflow:auto;flex:1}
.tr{display:grid;grid-template-columns:14px minmax(140px,300px) 84px 1fr 60px;gap:10px;align-items:center;padding:5px 14px;font-size:13px}
.tr.agent{font-weight:600}.tr.main{font-weight:700}.tr.tool .tl{padding-left:14px;color:var(--mute)}
.tl{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.tt{text-align:right;color:var(--mute);font-variant-numeric:tabular-nums}
.bar{position:relative;height:8px;background:var(--bg);border-radius:4px}.bar i{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--ok)}
.bar i.running{background:var(--run)}.bar i.failed{background:var(--bad)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--ok)}.dot.running{background:var(--run);animation:p 1.4s infinite;box-shadow:0 0 0 0 var(--run)}.dot.failed{background:var(--bad)}
@media (max-width:640px){.tr{grid-template-columns:14px 1fr 50px}.tr .chip,.tr .bar{display:none}.stats{margin-left:0}}
</style></head><body>
<header><h1>Flowmap<small>${esc(project)}</small></h1>
<nav><a href="#files" id="tf">Files</a><a href="#agents" id="ta">Agents</a></nav>
<div class="stats"><span><b>${counts.changed}</b> changed</span><span><b>${counts.planned}</b> planned</span><span><b>${counts.running}</b>/${counts.agents} agents running</span></div></header>
${now ? `<div class="now"><span class="pulse"></span><span class="muted">${now.active === 'editing' ? 'Editing' : 'Reading'}</span><b>${esc(now.path)}</b><span class="chip">${esc(shortModel(now.model) || 'model ?')}</span><span class="muted">by ${esc(now.by ?? 'main')}</span></div>` : `<div class="now"><span class="muted">Idle · last update ${new Date(at).toLocaleTimeString()}</span></div>`}
<section id="files">
${files.length ? `<div class="canvas" id="cv"><svg id="map">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#8d8d96"/></marker>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#f08a50"/></marker></defs>
<g id="vp">
${variants.map((v, i) => `<g class="lay" data-w="${v.width}" data-h="${v.height}"${i ? ' style="display:none"' : ''}>\n${v.svg}\n</g>`).join('\n')}
</g></svg>
<div class="hint">Drag to move · scroll or pinch to zoom · double-click to fit</div>
<div class="legend"><span>○ planned</span><span>+ created</span><span>✓ edited</span><span>· read</span><span>✎ now (glow)</span><span>→ uses</span></div>
<div class="ctl"><button id="zo" title="Zoom out (-)">−</button><button id="zl" title="Actual size (0)">100%</button><button id="zi" title="Zoom in (+)">+</button><button id="zf" title="Fit to screen (f)">Fit</button></div>
</div>` : '<div class="empty">No files yet. They appear as Claude plans, reads and edits them.</div>'}
</section>
<section id="agents">
${nodes.length ? `<div class="trace">${trace}</div>` : '<div class="empty">No agents yet.</div>'}
</section>
<script>
var store={get:function(k){try{return sessionStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{sessionStorage.setItem(k,v)}catch(e){}}};
function tab(){var a=location.hash==='#agents';document.getElementById('tf').className=a?'':'on';document.getElementById('ta').className=a?'on':'';document.getElementById('files').classList.toggle('on',!a);document.getElementById('agents').classList.toggle('on',a);if(!a&&window.fitIfAuto)fitIfAuto()}
addEventListener('hashchange',tab);
var cv=document.getElementById('cv'),busy=false;
if(cv){
  var vp=document.getElementById('vp'),lays=[].slice.call(document.querySelectorAll('.lay')),W=0,H=0;
  // The view survives the 2-second refresh; until the user moves it, every refresh fits the map to the screen.
  var S={x:0,y:0,k:1,v:0,user:false};try{var s=JSON.parse(store.get('vp')||'null');if(s&&s.user&&lays[s.v])S=s}catch(e){}
  var show=function(v){S.v=v;lays.forEach(function(g,i){g.style.display=i===v?'':'none'});W=+lays[v].dataset.w;H=+lays[v].dataset.h};
  var apply=function(){vp.setAttribute('transform','translate('+S.x+','+S.y+') scale('+S.k+')');document.getElementById('zl').textContent=Math.round(S.k*100)+'%';store.set('vp',JSON.stringify(S))};
  // Fit: the wrapping (1, 2 or 3 rows of lanes) that the window shows largest.
  var scale=function(g,r){return Math.min(r.width/+g.dataset.w,(r.height-40)/+g.dataset.h,1.8)*0.97};
  var fit=function(){var r=cv.getBoundingClientRect();if(!r.width)return;var best=0;lays.forEach(function(g,i){if(scale(g,r)>scale(lays[best],r)+0.02)best=i});show(best);var k=scale(lays[best],r);S={k:k,v:best,x:(r.width-W*k)/2,y:Math.max(28,(r.height-H*k)/2),user:false};apply()};
  show(S.v);
  window.fitIfAuto=function(){if(!S.user)fit();else apply()};
  var zoomAt=function(f,px,py){var k=Math.max(0.2,Math.min(4,S.k*f));S.x=px-(px-S.x)*k/S.k;S.y=py-(py-S.y)*k/S.k;S.k=k;S.user=true;apply()};
  var mid=function(){var r=cv.getBoundingClientRect();return[r.width/2,r.height/2]};
  var local=function(e){var r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
  var P=new Map(),last=null,pinch=0;
  cv.addEventListener('pointerdown',function(e){if(e.target.closest('.ctl,.legend'))return;cv.setPointerCapture(e.pointerId);P.set(e.pointerId,local(e));busy=true;cv.classList.add('drag');last=local(e)});
  cv.addEventListener('pointermove',function(e){if(!P.has(e.pointerId))return;var p=local(e);P.set(e.pointerId,p);
    if(P.size===2){var v=[...P.values()],d=Math.hypot(v[0][0]-v[1][0],v[0][1]-v[1][1]);if(pinch)zoomAt(d/pinch,(v[0][0]+v[1][0])/2,(v[0][1]+v[1][1])/2);pinch=d;return}
    S.x+=p[0]-last[0];S.y+=p[1]-last[1];S.user=true;last=p;apply()});
  var up=function(e){P.delete(e.pointerId);pinch=0;if(P.size===1)last=[...P.values()][0];if(!P.size){busy=false;cv.classList.remove('drag')}};
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('wheel',function(e){e.preventDefault();var p=local(e);zoomAt(Math.exp(-e.deltaY*(e.ctrlKey?0.01:0.0015)),p[0],p[1])},{passive:false});
  cv.addEventListener('dblclick',function(e){if(!e.target.closest('.ctl'))fit()});
  document.getElementById('zi').onclick=function(){var m=mid();zoomAt(1.25,m[0],m[1])};
  document.getElementById('zo').onclick=function(){var m=mid();zoomAt(0.8,m[0],m[1])};
  document.getElementById('zl').onclick=function(){var m=mid();zoomAt(1/S.k,m[0],m[1])};
  document.getElementById('zf').onclick=fit;
  addEventListener('keydown',function(e){var m=mid();if(e.key==='f')fit();else if(e.key==='+'||e.key==='=')zoomAt(1.25,m[0],m[1]);else if(e.key==='-')zoomAt(0.8,m[0],m[1]);else if(e.key==='0')zoomAt(1/S.k,m[0],m[1])});
  addEventListener('resize',function(){if(!S.user)fit()});
}
tab();
// Live refresh, held while the user drags or pinches.
setInterval(function(){if(!busy)location.reload()},2000);
</script></body></html>`
}
