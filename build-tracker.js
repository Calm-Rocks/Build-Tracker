/* ============================================================
   Build Tracker — Application Logic
   ============================================================ */

let builds  = [];
let clients = [];

async function loadData() {
  try {
    const [buildsRes, clientsRes] = await Promise.all([
      fetch('/api/builds'),
      fetch('/api/clients'),
    ]);

    if (buildsRes.ok && clientsRes.ok) {
      const buildsData  = await buildsRes.json();
      const clientsData = await clientsRes.json();
      builds  = buildsData.builds  || [];
      clients = clientsData.clients || [];
    } else if (buildsRes.status === 401 || clientsRes.status === 401) {
      window.location.href = '/auth/login';
    }
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

let currentView     = 'all';
let currentClientId = null;
let currentFilter   = 'all';
let currentBuildId  = null;
let editBuildId     = null;
let editClientId    = null;
let extractedItems  = [];
let ctxId           = null;

const PALETTE = ['#378ADD','#1D9E75','#D85A30','#D4537E','#7F77DD','#639922','#BA7517','#E24B4A','#0F6E56','#888780'];

/* ─── SAVE ─── */
async function saveBuildToApi(build) {
  const payload = {
    id:             build.id,
    title:          build.title,
    type:           build.type,
    status:         build.status,
    clientId:       build.clientId       || '',
    parentBuildId:  build.parentBuildId  || '',
    description:    build.desc           || '',
    startDate:      build.startDate      || '',
    endDate:        build.endDate        || '',
    demoDate:       build.demoDate       || '',
    notes:          build.notes          || '',
    milestones:     build.milestones     || [],
    tweaks:         build.tweaks         || [],
    createdAt:      build.createdAt      || Date.now(),
  };

  const res = await fetch(`/api/builds/${build.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  // If 404 it doesn't exist yet — POST instead
  if (res.status === 404) {
    await fetch('/api/builds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
}

async function saveClientToApi(client) {
  const payload = {
    id:        client.id,
    name:      client.name,
    color:     client.color,
    emoji:     client.emoji  || '',
    notes:     client.notes  || '',
    createdAt: client.createdAt || Date.now(),
  };

  const res = await fetch(`/api/clients/${client.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  if (res.status === 404) {
    await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
}

function save() {
  updateStats();
  renderFolders();
}
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function fmtDate(d) {
  if (!d) return '—';
  const [y,m,day]=d.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]+' '+parseInt(day)+', '+y;
}
function daysUntil(d) {
  if (!d) return null;
  const t=new Date(); t.setHours(0,0,0,0);
  return Math.round((new Date(d+'T00:00:00')-t)/86400000);
}
function clientOf(cid) { return clients.find(c=>c.id===cid)||null; }
function clientColor(cid) { const c=clientOf(cid); return c?c.color:'var(--border-strong)'; }
function clientName(cid)  { const c=clientOf(cid); return c?c.name:''; }

function badgeCls(b) {
  if (b.type==='tweak') return 'badge-tweak';
  return {todo:'badge-todo','in-progress':'badge-in-progress','demo-ready':'badge-demo-ready',done:'badge-done'}[b.status]||'badge-todo';
}
function badgeLbl(b) {
  if (b.type==='tweak') return 'Tweak';
  return {todo:'To Do','in-progress':'In Progress','demo-ready':'Demo Ready',done:'Done'}[b.status]||b.status;
}

/* ─── STATS ─── */
function updateStats() {
  const el=id=>document.getElementById(id);
  el('stat-total').textContent  = builds.length;
  el('stat-active').textContent = builds.filter(b=>b.status==='in-progress').length;
  el('stat-demo').textContent   = builds.filter(b=>b.demoDate).length;
  el('count-all').textContent    = builds.length;
  el('count-tweaks').textContent = builds.filter(b=>b.type==='tweak').length;
  el('count-demos').textContent  = builds.filter(b=>b.demoDate).length;
}

/* ─── SIDEBAR FOLDERS ─── */
function renderFolders() {
  const el = document.getElementById('folder-list');
  if (!clients.length) {
    el.innerHTML='<div style="font-size:12px;color:var(--text-faint);padding:4px 8px 2px;">No clients yet</div>';
    return;
  }
  el.innerHTML = clients.map(c=>{
    const n=builds.filter(b=>b.clientId===c.id).length;
    const active=currentView==='client'&&currentClientId===c.id;
    return `<div class="folder-row">
      <button class="folder-btn${active?' active':''}" onclick="showClientView('${c.id}')">
        ${c.emoji?`<span class="folder-emoji">${c.emoji}</span>`:`<div class="folder-dot" style="background:${c.color}"></div>`}
        <span class="folder-name">${esc(c.name)}</span>
        <span class="folder-count">${n}</span>
      </button>
      <button class="folder-kebab" onclick="openCtx(event,'${c.id}')">···</button>
    </div>`;
  }).join('');
}

/* ─── VIEWS ─── */
function showView(v) {
  currentView=v; currentClientId=null; closeDetail();
  const titles={all:'All Builds',tweaks:'Tweaks Only',upcoming:'Upcoming Demos',daily:'Daily Todo'};
  document.getElementById('page-title').textContent=titles[v]||v;
  ['all','tweaks','upcoming','daily'].forEach(n=>document.getElementById('nav-'+n)?.classList.toggle('active',n===v));
  document.getElementById('filter-row').style.display=(v==='all')?'':'none';
  // Show/hide panels
  document.getElementById('view-board').style.display = (v==='daily') ? 'none' : '';
  const dp = document.getElementById('view-daily');
  dp.style.display = (v==='daily') ? 'flex' : 'none';
  renderFolders();
  if (v==='daily') renderDaily(); else renderBoard();
}

function renderDaily() {
  const dp = document.getElementById('view-daily');
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0,10);

  // Active = not done
  const active = builds.filter(b => b.status !== 'done');
  if (!active.length) {
    dp.innerHTML = '<div class="daily-empty"><h3>All clear! 🎉</h3><p>No active builds or tweaks right now.</p></div>';
    return;
  }

  // Score each build for urgency
  function urgencyScore(b) {
    const d = daysUntil(b.endDate);
    if (d === null) return 999;
    return d;
  }

  function daysLabel(b) {
    const d = daysUntil(b.endDate);
    if (d === null) return { label: 'No end date', cls: 'none' };
    if (d < 0)  return { label: Math.abs(d) + 'd overdue', cls: 'overdue' };
    if (d === 0) return { label: 'Due today', cls: 'urgent' };
    if (d <= 3) return { label: 'Due in ' + d + 'd', cls: 'urgent' };
    return { label: 'Due in ' + d + 'd', cls: 'fine' };
  }

  function pendingMilestones(b) {
    return (b.milestones || []).filter(m => !m.done);
  }

  const sorted = active.slice().sort((a,b) => urgencyScore(a) - urgencyScore(b));

  // Split into sections
  const overdue  = sorted.filter(b => { const d=daysUntil(b.endDate); return d!==null && d<0; });
  const today_   = sorted.filter(b => { const d=daysUntil(b.endDate); return d===0; });
  const thisWeek = sorted.filter(b => { const d=daysUntil(b.endDate); return d!==null && d>0 && d<=7; });
  const later    = sorted.filter(b => { const d=daysUntil(b.endDate); return d===null || d>7; });

  // Update nav badge
  const urgentCount = overdue.length + today_.length;
  const badge = document.getElementById('count-daily');
  if (badge) {
    badge.textContent = urgentCount;
    badge.style.display = urgentCount > 0 ? '' : 'none';
  }

  function buildRow(b) {
    const dl = daysLabel(b);
    const pms = pendingMilestones(b);
    const c = clientOf(b.clientId);
    const col = c ? c.color : 'var(--border-strong)';
    const cname = c ? c.name : '';
    const isOverdue = dl.cls === 'overdue';
    const isUrgent  = dl.cls === 'urgent';

    const msAlerts = pms.length ? `
      <div class="milestone-alert">
        ${pms.map(m => `<div class="ms-alert-row"><div class="ms-alert-dot"></div>${esc(m.label)}${m.date ? ' — due ' + fmtDate(m.date) : ' — no date set'}</div>`).join('')}
      </div>` : '';

    const twPending = (b.tweaks||[]).filter(t=>!t.done).length;
    const twTotal   = (b.tweaks||[]).length;

    return `<div class="todo-row${isOverdue?' overdue':isUrgent?' urgent':''}" onclick="openDetail('${b.id}')">
      <div class="todo-left">
        <div class="todo-title">${esc(b.title)}</div>
        <div class="todo-meta">
          <span class="badge ${badgeCls(b)}">${badgeLbl(b)}</span>
          ${cname ? `<span class="todo-client"><div class="todo-client-dot" style="background:${col}"></div>${esc(cname)}</span>` : ''}
          ${twTotal > 0 ? `<span style="font-size:11px;color:var(--text-faint);font-weight:600;">${twPending} task${twPending===1?'':'s'} remaining</span>` : ''}
        </div>
        ${msAlerts}
      </div>
      <div class="todo-right">
        <div class="todo-days ${dl.cls}">${dl.label}</div>
      </div>
    </div>`;
  }

  function section(title, color, items) {
    if (!items.length) return '';
    return `<div class="daily-section">
      <div class="daily-section-title" style="color:${color};">
        ${title}
        <span class="dscount">${items.length}</span>
      </div>
      ${items.map(buildRow).join('')}
    </div>`;
  }

  const dateLabel = today.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  dp.innerHTML = `
    <div class="daily-header-bar">
      <span class="daily-date-label">${dateLabel}</span>
    </div>
    ${section('Overdue', '#F28082', overdue)}
    ${section('Due Today', '#FEE75C', today_)}
    ${section('This Week', '#57F287', thisWeek)}
    ${section('Later', 'var(--text-faint)', later)}
  `;
}

function showClientView(cid) {
  currentView='client'; currentClientId=cid; closeDetail();
  const c=clientOf(cid);
  document.getElementById('page-title').textContent=c?c.name:'Client';
  ['all','tweaks','upcoming'].forEach(n=>document.getElementById('nav-'+n)?.classList.remove('active'));
  document.getElementById('filter-row').style.display='';
  renderFolders(); renderBoard();
}

/* ─── BOARD ─── */
function setFilter(f,el) {
  currentFilter=f;
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active'); renderBoard();
}

function renderBoard() {
  const q=(document.getElementById('search-input').value||'').toLowerCase();
  const cont=document.getElementById('board-content');
  let list=builds.slice();
  if (currentView==='tweaks')   list=list.filter(b=>b.type==='tweak');
  if (currentView==='upcoming') list=list.filter(b=>b.demoDate).sort((a,b)=>a.demoDate.localeCompare(b.demoDate));
  if (currentView==='client')   list=list.filter(b=>b.clientId===currentClientId);
  if (currentFilter!=='all') {
    if (currentFilter==='tweak') list=list.filter(b=>b.type==='tweak');
    else list=list.filter(b=>b.status===currentFilter&&b.type!=='tweak');
  }
  if (q) list=list.filter(b=>(b.title||'').toLowerCase().includes(q)||(b.desc||'').toLowerCase().includes(q)||(clientName(b.clientId)||'').toLowerCase().includes(q));

  if (!list.length) {
    cont.innerHTML=`<div class="empty"><h3>No builds here</h3><p>${currentView==='client'?'Assign builds to this client when creating them.':'Add a build manually or import a transcript.'}</p></div>`;
    return;
  }

  // Group by client in all/tweaks views
  if (currentView==='all'||currentView==='tweaks') {
    const groups=[];
    clients.forEach(c=>{ const items=list.filter(b=>b.clientId===c.id); if(items.length) groups.push({c,items}); });
    const unassigned=list.filter(b=>!b.clientId||!clientOf(b.clientId));
    if (unassigned.length) groups.push({c:null,items:unassigned});

    if (groups.length===1&&!groups[0].c) {
      cont.innerHTML=`<div class="build-grid">${list.map(cardHtml).join('')}</div>`;
    } else {
      cont.innerHTML=groups.map(({c,items})=>`
        <div class="client-section">
          <div class="client-section-header">
            ${c&&c.emoji?`<span style="font-size:14px;line-height:1;">${c.emoji}</span>`:`<div class="client-section-dot" style="background:${c?c.color:'var(--border-strong)'}"></div>`}
            <span class="client-section-name">${esc(c?c.name:'Unassigned')}</span>
            <span class="client-section-count">${items.length} item${items.length===1?'':'s'}</span>
            ${c?`<button class="btn btn-sm" style="margin-left:auto;padding:3px 9px;" onclick="showClientView('${c.id}')">View folder →</button>`:''}
          </div>
          <div class="build-grid">${items.map(cardHtml).join('')}</div>
        </div>`).join('');
    }
  } else if (currentView==='client') {
    // In client view: builds first with nested tweaks, then unlinked tweaks
    const clientBuilds = list.filter(b=>b.type==='build');
    const linkedTweaks = list.filter(b=>b.type==='tweak'&&b.parentBuildId&&clientBuilds.find(cb=>cb.id===b.parentBuildId));
    const unlinkedTweaks = list.filter(b=>b.type==='tweak'&&(!b.parentBuildId||!clientBuilds.find(cb=>cb.id===b.parentBuildId)));

    let html = '';

    if (clientBuilds.length || linkedTweaks.length) {
      html += '<div style="display:flex;flex-direction:column;gap:12px;">';
      clientBuilds.forEach(b => {
        const children = linkedTweaks.filter(t=>t.parentBuildId===b.id);
        html += `<div class="build-with-tweaks">
          <div class="parent-card-wrap">${cardHtml(b)}</div>`;
        if (children.length) {
          html += `<div class="nested-tweaks">${children.map(t=>tweakCardHtml(t)).join('')}</div>`;
        }
        html += '</div>';
      });
      html += '</div>';
    }

    if (unlinkedTweaks.length) {
      if (clientBuilds.length) html += `<div style="margin-top:20px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-faint);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);">Standalone Tweaks</div><div class="build-grid">${unlinkedTweaks.map(cardHtml).join('')}</div></div>`;
      else html += `<div class="build-grid">${unlinkedTweaks.map(cardHtml).join('')}</div>`;
    }

    cont.innerHTML = html || `<div class="empty"><h3>No builds here</h3><p>Assign builds to this client when creating them.</p></div>`;
  } else {
    cont.innerHTML=`<div class="build-grid">${list.map(cardHtml).join('')}</div>`;
  }
}

function cardHtml(b) {
  const ms=b.milestones||[], tw=b.tweaks||[];
  const twDone=tw.filter(t=>t.done).length;
  const dd=daysUntil(b.demoDate);
  const col=clientColor(b.clientId);
  const cname=clientName(b.clientId);

  let demoBadge='';
  if (b.demoDate) {
    let cls='meta-value',txt=fmtDate(b.demoDate);
    if(dd!==null&&dd<0){cls+=' overdue';txt=Math.abs(dd)+'d ago';}
    else if(dd!==null&&dd<=3){cls+=' soon';txt=dd===0?'Today!':dd+'d';}
    demoBadge=`<div class="meta-item"><div class="meta-label">Demo</div><div class="${cls}">${txt}</div></div>`;
  }
  const pips=ms.length?`<div class="meta-item"><div class="meta-label">Milestones</div><div class="milestone-mini" style="margin-top:3px;">${ms.map(m=>`<div class="milestone-pip${m.done?' done':''}${m.standard?' standard':''}" title="${esc(m.label)}"></div>`).join('')}</div></div>`:'';

  return `<div class="build-card" onclick="openDetail('${b.id}')">
    <div class="build-card-accent" style="background:${col};opacity:0.75;"></div>
    <div class="card-top"><div class="card-title">${esc(b.title)}</div><span class="badge ${badgeCls(b)}">${badgeLbl(b)}</span></div>
    ${b.desc?`<div class="card-desc">${esc(b.desc)}</div>`:''}
    <div class="card-meta">
      ${b.startDate?`<div class="meta-item"><div class="meta-label">Start</div><div class="meta-value">${fmtDate(b.startDate)}</div></div>`:''}
      ${b.endDate?`<div class="meta-item"><div class="meta-label">End</div><div class="meta-value">${fmtDate(b.endDate)}</div></div>`:''}
      ${demoBadge}${pips}
      ${tw.length?`<div class="meta-item"><div class="meta-label">Tasks</div><div class="meta-value">${twDone}/${tw.length}</div></div>`:''}
    </div>
    ${cname?`<div style="font-size:11px;color:var(--text-faint);margin-top:6px;display:flex;align-items:center;gap:5px;">${clientOf(b.clientId)&&clientOf(b.clientId).emoji?`<span style="font-size:11px;line-height:1;">${clientOf(b.clientId).emoji}</span>`:`<span style="width:6px;height:6px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0;"></span>`}${esc(cname)}</div>`:''}
    ${(()=>{if(b.type==='tweak'&&b.parentBuildId){const pb=builds.find(x=>x.id===b.parentBuildId);return pb?`<div style="font-size:11px;color:var(--accent-text);margin-top:4px;display:flex;align-items:center;gap:4px;"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h8M9 5l3 3-3 3"/></svg>${esc(pb.title)}</div>`:''}return '';})()}
  </div>`;
}

function tweakCardHtml(b) {
  const tw=b.tweaks||[];
  const twDone=tw.filter(t=>t.done).length;
  const dd=daysUntil(b.endDate);
  let dateStr='';
  if(b.endDate){
    if(dd!==null&&dd<0) dateStr=`<span style="font-size:11px;color:var(--danger-text);font-weight:700;">${Math.abs(dd)}d overdue</span>`;
    else if(dd===0) dateStr=`<span style="font-size:11px;color:var(--warn-text);font-weight:700;">Due today</span>`;
    else dateStr=`<span style="font-size:11px;color:var(--text-faint);">Due ${fmtDate(b.endDate)}</span>`;
  }
  return `<div class="tweak-card" onclick="openDetail('${b.id}')">
    <div class="tweak-card-title">${esc(b.title)}</div>
    <div class="tweak-card-meta">
      ${dateStr}
      ${tw.length?`<span style="font-size:11px;color:var(--text-faint);">${twDone}/${tw.length} tasks</span>`:''}
      <span class="badge badge-tweak">Tweak</span>
      <span class="badge ${badgeCls(b)}">${badgeLbl(b)}</span>
    </div>
  </div>`;
}

/* ─── CLIENT MODAL ─── */
const CM_EMOJIS=['🏢','🚀','⭐','💼','🎯','🔧','🎨','💡','🌐','📱','🛒','🏗','🎵','🏥','📚','🔬','🌿','💰','🎮','✈️','🏠','🤝','📊','🔑'];
let cmColor='#378ADD';
let cmEmoji='';

function openClientModal(eid) {
  editClientId=eid||null;
  const c=eid?clientOf(eid):null;
  document.getElementById('cm-title').textContent=c?'Edit Client':'New Client Folder';
  document.getElementById('cm-name').value=c?c.name:'';
  document.getElementById('cm-notes').value=c?(c.notes||''):'';
  cmColor=c?c.color:PALETTE[clients.length%PALETTE.length];
  cmEmoji=c?(c.emoji||''):'';
  const hexInp = document.getElementById('cm-hex-input');
  if (hexInp) hexInp.value = cmColor;
  const hexDot = document.getElementById('cm-hex-preview');
  if (hexDot) { hexDot.style.background = cmColor; hexDot.style.borderColor = cmColor; }
  document.getElementById('cm-custom-emoji').value=cmEmoji;
  document.getElementById('cm-colors').innerHTML=PALETTE.map(col=>
    `<div class="color-swatch${col===cmColor?' selected':''}" style="background:${col}" data-col="${col}" onclick="pickColor(this)"></div>`
  ).join('');
  document.getElementById('cm-emojis').innerHTML=CM_EMOJIS.map(e=>
    `<button class="emoji-btn${e===cmEmoji?' selected':''}" onclick="pickEmoji('${e}')" title="${e}">${e}</button>`
  ).join('');
  updateCmPreview();
  document.getElementById('client-modal').classList.add('open');
  setTimeout(()=>document.getElementById('cm-name').focus(),50);
}
function closeClientModal() { document.getElementById('client-modal').classList.remove('open'); editClientId=null; }

function pickColor(el) {
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
  el.classList.add('selected');
  cmColor=el.dataset.col;
  const hexInp = document.getElementById('cm-hex-input');
  if (hexInp) hexInp.value = cmColor;
  const hexDot = document.getElementById('cm-hex-preview');
  if (hexDot) { hexDot.style.background = cmColor; hexDot.style.borderColor = cmColor; }
  updateCmPreview();
}
function pickHexColor(val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  const dot = document.getElementById('cm-hex-preview');
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    cmColor = hex;
    if (dot) { dot.style.background = hex; dot.style.borderColor = hex; }
    document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
    updateCmPreview();
  } else {
    if (dot) dot.style.background = 'var(--surface3)';
  }
}
function pickEmoji(e) {
  cmEmoji=e;
  document.getElementById('cm-custom-emoji').value='';
  document.querySelectorAll('.emoji-btn').forEach(b=>b.classList.toggle('selected',b.textContent===e));
  updateCmPreview();
}
function pickCustomEmoji(val) {
  const trimmed=[...val.trim()].slice(0,2).join('');
  cmEmoji=trimmed;
  document.querySelectorAll('.emoji-btn').forEach(b=>b.classList.remove('selected'));
  updateCmPreview();
}
function clearEmoji() {
  cmEmoji='';
  document.getElementById('cm-custom-emoji').value='';
  document.querySelectorAll('.emoji-btn').forEach(b=>b.classList.remove('selected'));
  updateCmPreview();
}
function updateCmPreview() {
  const preview=document.getElementById('cm-preview');
  const name=document.getElementById('cm-name').value.trim();
  preview.style.background=cmColor;
  if (cmEmoji) {
    preview.textContent=cmEmoji;
    preview.style.fontSize='22px';
  } else if (name) {
    preview.textContent=name[0].toUpperCase();
    preview.style.fontSize='18px';
    preview.style.color='white';
    preview.style.fontWeight='500';
  } else {
    preview.textContent='';
  }
}

async function saveClient() {
  const name=document.getElementById('cm-name').value.trim();
  if (!name) { document.getElementById('cm-name').focus(); return; }
  const notes=document.getElementById('cm-notes').value.trim();
  if (editClientId) {
    const idx=clients.findIndex(c=>c.id===editClientId);
    if (idx!==-1) clients[idx]={...clients[idx],name,color:cmColor,emoji:cmEmoji,notes};
    await saveClientToApi(clients[idx]);
  } else {
    clients.push({id:uid(),name,color:cmColor,emoji:cmEmoji,notes,createdAt:Date.now()});
    await saveClientToApi(clients[clients.length-1]);
  }
  save(); closeClientModal(); refreshSelects();
}

function refreshSelects() {
  ['f-client-id','import-client-id'].forEach(sid=>{
    const sel=document.getElementById(sid); if(!sel) return;
    const cur=sel.value;
    sel.innerHTML='<option value="">— No client —</option>'+clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (cur) sel.value=cur;
  });
}

/* ─── CONTEXT MENU ─── */
function openCtx(e,cid) {
  e.stopPropagation(); ctxId=cid;
  const m=document.getElementById('ctx-menu');
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px';
  m.classList.add('open');
}
function closeCtx() { document.getElementById('ctx-menu').classList.remove('open'); ctxId=null; }
async function ctxDo(action) {
  closeCtx(); if(!ctxId) return;
  if (action==='edit'||action==='color') { openClientModal(ctxId); return; }
  if (action==='delete') {
    const c=clientOf(ctxId);
    const n=builds.filter(b=>b.clientId===ctxId).length;
    var msg = 'Delete "' + (c ? c.name : '') + '"?' + (n ? ' ' + n + ' build' + (n===1?'':'s') + ' will become unassigned.' : '');
    if (!window.confirm(msg)) return;
    await fetch(`/api/clients/${ctxId}`, { method: 'DELETE' });
    clients=clients.filter(x=>x.id!==ctxId);
    builds.forEach(async b=>{ if(b.clientId===ctxId){ b.clientId=''; await saveBuildToApi(b); } });
    save(); refreshSelects();
    if (currentClientId===ctxId) showView('all');
    else { renderFolders(); renderBoard(); }
  }
}
document.addEventListener('click',e=>{ if(!e.target.closest('#ctx-menu')&&!e.target.closest('.folder-kebab')) closeCtx(); });

/* ─── ADD/EDIT BUILD ─── */
function populateParentSelect(clientId, selectedId) {
  const wrap = document.getElementById('f-parent-wrap');
  const sel  = document.getElementById('f-parent-id');
  const type = document.getElementById('f-type').value;
  if (type !== 'tweak') { wrap.style.display = 'none'; return; }
  const parentBuilds = builds.filter(b => b.type === 'build' && (!clientId || b.clientId === clientId));
  sel.innerHTML = '<option value="">— Standalone tweak —</option>' +
    parentBuilds.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join('');
  if (selectedId) sel.value = selectedId;
  wrap.style.display = parentBuilds.length ? '' : 'none';
}
function onTypeChange() {
  const cid = document.getElementById('f-client-id').value;
  populateParentSelect(cid, '');
}
function onClientChange() {
  const cid = document.getElementById('f-client-id').value;
  const type = document.getElementById('f-type').value;
  if (type === 'tweak') populateParentSelect(cid, '');
}
function openAddModal(prefill) {
  editBuildId=null;
  document.getElementById('modal-title').textContent='New Build';
  document.getElementById('f-title').value=prefill?.title||'';
  document.getElementById('f-desc').value=prefill?.desc||'';
  document.getElementById('f-type').value=prefill?.type||'build';
  document.getElementById('f-status').value=prefill?.status||'todo';
  document.getElementById('f-start').value=prefill?.startDate||'';
  document.getElementById('f-end').value=prefill?.endDate||'';
  document.getElementById('f-demo').value=prefill?.demoDate||'';
  refreshSelects();
  document.getElementById('f-client-id').value=prefill?.clientId||currentClientId||'';
  populateParentSelect(document.getElementById('f-client-id').value, prefill?.parentBuildId||'');
  document.getElementById('add-modal').classList.add('open');
}
function editCurrentBuild() {
  const b=builds.find(x=>x.id===currentBuildId); if(!b) return;
  editBuildId=b.id;
  document.getElementById('modal-title').textContent='Edit Build';
  document.getElementById('f-title').value=b.title||'';
  document.getElementById('f-type').value=b.type||'build';
  document.getElementById('f-status').value=b.status||'todo';
  document.getElementById('f-desc').value=b.desc||'';
  document.getElementById('f-start').value=b.startDate||'';
  document.getElementById('f-end').value=b.endDate||'';
  document.getElementById('f-demo').value=b.demoDate||'';
  refreshSelects();
  document.getElementById('f-client-id').value=b.clientId||'';
  populateParentSelect(b.clientId||'', b.parentBuildId||'');
  document.getElementById('add-modal').classList.add('open');
}
function closeAddModal() { document.getElementById('add-modal').classList.remove('open'); editBuildId=null; }
async function saveBuild() {
  const title=document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }
  const fType=document.getElementById('f-type').value;
  const data={title,type:fType,status:document.getElementById('f-status').value,clientId:document.getElementById('f-client-id').value,desc:document.getElementById('f-desc').value.trim(),startDate:document.getElementById('f-start').value,endDate:document.getElementById('f-end').value,demoDate:document.getElementById('f-demo').value,parentBuildId:fType==='tweak'?(document.getElementById('f-parent-id').value||''):'',};
  if (editBuildId) { const idx=builds.findIndex(b=>b.id===editBuildId); if(idx!==-1) builds[idx]={...builds[idx],...data}; }
  else builds.unshift({id:uid(),tweaks:[],milestones:defaultMilestones(data.demoDate),notes:'',createdAt:Date.now(),...data});
  const buildIndex = editBuildId ? builds.findIndex(b=>b.id===editBuildId) : 0;
  await saveBuildToApi(builds[buildIndex]);
  save(); closeAddModal();
  if (currentBuildId) openDetail(currentBuildId); else renderBoard();
}

/* ─── DETAIL ─── */
function openDetail(id) {
  currentBuildId=id;
  const b=builds.find(x=>x.id===id); if(!b) return;
  document.getElementById('view-board').style.display='none';
  document.getElementById('view-daily').style.display='none';
  document.getElementById('view-detail').style.display='flex';
  document.getElementById('detail-title').textContent=b.title;
  const badge=document.getElementById('detail-badge');
  badge.textContent=badgeLbl(b); badge.className='badge '+badgeCls(b);
  const cname=clientName(b.clientId), col=clientColor(b.clientId);
  const cl=document.getElementById('detail-client-lbl');
  const cc=clientOf(b.clientId);
  cl.innerHTML=cname?`<span style="display:inline-flex;align-items:center;gap:5px;">${cc&&cc.emoji?`<span style="font-size:13px;line-height:1;">${cc.emoji}</span>`:`<span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;"></span>`}${esc(cname)}</span>`:'';
  const parentEl=document.getElementById('detail-parent-link');
  if(parentEl){
    if(b.type==='tweak'&&b.parentBuildId){
      const pb=builds.find(x=>x.id===b.parentBuildId);
      parentEl.style.display=pb?'':'none';
      if(pb) parentEl.innerHTML=`<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h8M9 5l3 3-3 3"/></svg><span style="cursor:pointer;text-decoration:underline;" onclick="openDetail('${pb.id}')">${esc(pb.title)}</span>`;
    } else { parentEl.style.display='none'; }
  }

  const mkDate=(lbl,val)=>{
    if(!val) return '';
    const d=daysUntil(val);
    let sub='';
    if(d!==null){if(d<0)sub=`<div class="ds" style="color:var(--danger-text)">${Math.abs(d)} days ago</div>`;else if(d===0)sub=`<div class="ds" style="color:var(--warn-text)">Today</div>`;else sub=`<div class="ds">${d} days away</div>`;}
    return `<div class="date-block"><div class="dl">${lbl}</div><div class="dv">${fmtDate(val)}</div>${sub}</div>`;
  };
  document.getElementById('detail-dates').innerHTML=mkDate('Start',b.startDate)+mkDate('End',b.endDate)+mkDate('Demo',b.demoDate);
  document.getElementById('detail-desc').textContent=b.desc||'No description added.';
  document.getElementById('desc-section').style.display=b.desc?'':'none';
  document.getElementById('notes-edit').value=b.notes||'';
  renderTweaks(b); renderMilestones(b); updateProgress(b);
  switchTab('overview',document.querySelector('.tab-btn'));
}
function closeDetail() {
  currentBuildId=null;
  document.getElementById('view-detail').style.display='none';
  if (currentView === 'daily') {
    document.getElementById('view-daily').style.display='flex';
    renderDaily();
  } else {
    document.getElementById('view-board').style.display='';
    renderBoard();
  }
}
function updateProgress(b) {
  const tw=b.tweaks||[];
  const pct=tw.length?Math.round(tw.filter(t=>t.done).length/tw.length*100):0;
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-pct').textContent=pct+'%';
}
function switchTab(tab,el) {
  ['overview','tweaks','notes'].forEach(t=>{ document.getElementById('tab-'+t).style.display=t===tab?'':'none'; });
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
}
async function deleteCurrentBuild() {
  var btn = document.getElementById('btn-delete');
  if (btn.dataset.confirming === '1') {
    await fetch(`/api/builds/${currentBuildId}`, { method: 'DELETE' });
    builds = builds.filter(function(b){ return b.id !== currentBuildId; });
    save(); closeDetail();
  } else {
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm?';
    btn.style.color = 'var(--danger-text)';
    btn.style.borderColor = 'var(--danger-text)';
    btn.style.background = 'var(--danger-bg)';
    setTimeout(function() {
      if (btn.dataset.confirming === '1') {
        btn.dataset.confirming = '0';
        btn.textContent = 'Delete';
        btn.style.color = '';
        btn.style.borderColor = '';
        btn.style.background = '';
      }
    }, 3000);
  }
}

/* ─── TWEAKS ─── */
function renderTweaks(b) {
  const list=document.getElementById('tweak-list'), tw=b.tweaks||[];
  if(!tw.length){list.innerHTML='<div style="font-size:13px;color:var(--text-faint);padding:6px 0;">No tasks yet.</div>';return;}
  list.innerHTML=tw.map((t,i)=>`<div class="tweak-item">
    <div class="tweak-check${t.done?' checked':''}" onclick="toggleTweak(${i})"></div>
    <span class="tweak-text${t.done?' done':''}">${esc(t.text)}</span>
    <button class="btn btn-sm" style="padding:2px 8px;color:var(--text-faint);" onclick="removeTweak(${i})">×</button>
  </div>`).join('');
}
async function toggleTweak(i){const b=builds.find(x=>x.id===currentBuildId);if(!b)return;b.tweaks[i].done=!b.tweaks[i].done;save();await saveBuildToApi(b);renderTweaks(b);updateProgress(b);}
async function removeTweak(i){const b=builds.find(x=>x.id===currentBuildId);if(!b)return;b.tweaks.splice(i,1);save();await saveBuildToApi(b);renderTweaks(b);updateProgress(b);}
async function addTweak(){
  const inp=document.getElementById('new-tweak-input'),text=inp.value.trim();if(!text)return;
  const b=builds.find(x=>x.id===currentBuildId);if(!b)return;
  if(!b.tweaks)b.tweaks=[];b.tweaks.push({text,done:false});save();await saveBuildToApi(b);inp.value='';renderTweaks(b);updateProgress(b);
}
async function saveNotes(){
  const b=builds.find(x=>x.id===currentBuildId);if(!b)return;
  b.notes=document.getElementById('notes-edit').value;save();await saveBuildToApi(b);
  const btn=event.target;btn.textContent='Saved ✓';setTimeout(()=>btn.textContent='Save Notes',1500);
}

/* ─── MILESTONES ─── */
const STD_MS=[
  {key:'requirements', label:'Requirements provided by client'},
  {key:'qa_raised',    label:'QA raised'},
  {key:'design',       label:'Design approved'},
  {key:'dev_start',    label:'Development started'},
  {key:'qa_passed',    label:'QA passed'},
  {key:'client_review',label:'Client review complete'},
  {key:'deployed',     label:'Deployed to production'},
];
const DEFAULT_MS_KEYS=['requirements','qa_raised','client_review'];
function defaultMilestones(demoDate){
  return DEFAULT_MS_KEYS.map(k=>{
    const s=STD_MS.find(x=>x.key===k);
    let date='';
    if(k==='qa_raised'&&demoDate){
      const d=new Date(demoDate+'T00:00:00');
      d.setDate(d.getDate()-1);
      date=d.toISOString().slice(0,10);
    }
    return{id:uid(),key:s.key,label:s.label,standard:true,done:false,date};
  });
}

function renderMilestones(b) {
  if(!b.milestones)b.milestones=[];
  const track=document.getElementById('m-track');
  const chips=document.getElementById('tpl-chips');
  const used=b.milestones.map(m=>m.key).filter(Boolean);
  chips.innerHTML=STD_MS.map(s=>`<button class="tpl-chip${used.includes(s.key)?' used':''}" onclick="addStdMs('${s.key}')">${s.label}</button>`).join('');
  if(!b.milestones.length){track.innerHTML='<div style="font-size:13px;color:var(--text-faint);padding:8px 0;">No milestones yet.</div>';return;}
  track.innerHTML=b.milestones.map((m,i)=>`<div class="milestone-row">
    <div class="m-dot${m.done?' done':''}${m.standard?' std':''}" onclick="toggleMs(${i})" title="${m.done?'Mark incomplete':'Mark complete'}"></div>
    <div class="m-content">
      <div class="m-name${m.done?' done':''}">${esc(m.label)}</div>
      <div class="m-meta">
        <input type="date" class="m-date" value="${m.date||''}" onchange="setMsDate(${i},this.value)" />
        ${m.standard?'<span class="m-tag">Standard</span>':''}
        ${m.date&&m.done?`<span style="font-size:11px;color:var(--success-text);">Completed ${fmtDate(m.date)}</span>`:''}
        ${m.date&&!m.done?`<span style="font-size:11px;color:var(--text-faint);">Due ${fmtDate(m.date)}</span>`:''}
      </div>
    </div>
    <div class="m-actions"><button class="btn btn-sm" style="padding:2px 8px;color:var(--text-faint);" onclick="removeMs(${i})">×</button></div>
  </div>`).join('');
}

async function addStdMs(key){
  const b=builds.find(x=>x.id===currentBuildId);if(!b)return;
  if(!b.milestones)b.milestones=[];
  if(b.milestones.find(m=>m.key===key))return;
  const def=STD_MS.find(s=>s.key===key);if(!def)return;
  b.milestones.push({id:uid(),key:def.key,label:def.label,standard:true,done:false,date:''});save();await saveBuildToApi(b);renderMilestones(b);
}
async function addMilestone(){
  const inp=document.getElementById('new-m-input'),text=inp.value.trim();if(!text)return;
  const b=builds.find(x=>x.id===currentBuildId);if(!b)return;
  if(!b.milestones)b.milestones=[];
  b.milestones.push({id:uid(),label:text,standard:false,done:false,date:''});save();await saveBuildToApi(b);inp.value='';renderMilestones(b);
}
async function toggleMs(i){const b=builds.find(x=>x.id===currentBuildId);if(!b||!b.milestones[i])return;b.milestones[i].done=!b.milestones[i].done;if(b.milestones[i].done&&!b.milestones[i].date)b.milestones[i].date=new Date().toISOString().slice(0,10);save();await saveBuildToApi(b);renderMilestones(b);}
async function setMsDate(i,v){const b=builds.find(x=>x.id===currentBuildId);if(!b)return;b.milestones[i].date=v;save();await saveBuildToApi(b);renderMilestones(b);}
async function removeMs(i){const b=builds.find(x=>x.id===currentBuildId);if(!b)return;b.milestones.splice(i,1);save();await saveBuildToApi(b);renderMilestones(b);}

/* ─── IMPORT ─── */
function openImportModal(){
  document.getElementById('import-modal').classList.add('open');
  document.getElementById('import-text').value='';
  document.getElementById('import-preview-wrap').style.display='none';
  document.getElementById('extracted-wrap').style.display='none';
  document.getElementById('ai-loading-wrap').style.display='none';
  document.getElementById('btn-extract').style.display='';
  document.getElementById('btn-import-save').style.display='none';
  refreshSelects();
  document.getElementById('import-client-id').value=currentClientId||'';
  extractedItems=[];
}
function closeImportModal(){document.getElementById('import-modal').classList.remove('open');}
function handleDragOver(e){e.preventDefault();document.getElementById('import-zone').classList.add('drag-over');}
function handleDrop(e){e.preventDefault();document.getElementById('import-zone').classList.remove('drag-over');const f=e.dataTransfer.files[0];if(f)readFile(f);}
function handleFile(e){const f=e.target.files[0];if(f)readFile(f);}
function readFile(file){const r=new FileReader();r.onload=e=>{const t=e.target.result;document.getElementById('import-text').value=t;document.getElementById('import-preview').textContent=t.slice(0,400)+(t.length>400?'...':'');document.getElementById('import-preview-wrap').style.display='';};r.readAsText(file);}

async function extractItems(){
  const text=document.getElementById('import-text').value.trim();
  if(!text){alert('Please paste or upload some text first.');return;}
  document.getElementById('ai-loading-wrap').style.display='';
  document.getElementById('btn-extract').style.display='none';
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:'You are a project management assistant. Extract all action items, tasks, builds, tweaks, or follow-up items from the text. Return ONLY a JSON array, no markdown. Each item: {"title":"short 3-8 word title","desc":"one sentence","type":"build or tweak"}',messages:[{role:'user',content:`Extract:\n\n${text.slice(0,4000)}`}]})});
    const data=await res.json();
    const raw=data.content?.map(i=>i.text||'').join('');
    extractedItems=JSON.parse(raw.replace(/```json|```/g,'').trim());
  }catch(err){
    extractedItems=text.split('\n').filter(l=>l.match(/^[-*•]\s+.{10,}|^\d+\.\s+.{10,}/)).slice(0,12).map(l=>({title:l.replace(/^[-*•\d.]\s+/,'').slice(0,60).trim(),desc:'',type:l.match(/fix|tweak|small|minor|update|adjust/i)?'tweak':'build'})).filter(i=>i.title.length>4);
    if(!extractedItems.length){alert('Could not extract items automatically. Try pasting cleaner text.');document.getElementById('ai-loading-wrap').style.display='none';document.getElementById('btn-extract').style.display='';return;}
  }
  document.getElementById('ai-loading-wrap').style.display='none';
  document.getElementById('extracted-list').innerHTML=extractedItems.map((item,i)=>`<div class="action-item-row"><input type="checkbox" id="ei-${i}" checked /><div><div style="font-size:13px;font-weight:500;">${esc(item.title)}</div>${item.desc?`<div style="font-size:12px;color:var(--text-faint);margin-top:2px;">${esc(item.desc)}</div>`:''}<span class="badge ${item.type==='tweak'?'badge-tweak':'badge-todo'}" style="margin-top:4px;display:inline-flex;">${item.type==='tweak'?'Tweak':'Build'}</span></div></div>`).join('');
  document.getElementById('extracted-wrap').style.display='';
  document.getElementById('btn-import-save').style.display='';
}

async function importSelected(){
  const cid=document.getElementById('import-client-id').value;
  const startDate=document.getElementById('import-start').value;
  const endDate=document.getElementById('import-end').value;
  const demoDate=document.getElementById('import-demo').value;
  let count=0;
  const promises=[];
  extractedItems.forEach((item,i)=>{
    const chk=document.getElementById('ei-'+i);
    if(chk&&chk.checked){
      const newBuild={id:uid(),title:item.title,desc:item.desc||'',type:item.type||'build',status:'todo',clientId:cid,startDate,endDate,demoDate,tweaks:[],milestones:defaultMilestones(demoDate),notes:'',createdAt:Date.now()};
      builds.unshift(newBuild);
      promises.push(saveBuildToApi(newBuild));
      count++;
    }
  });
  await Promise.all(promises);
  save();closeImportModal();renderBoard();
  if(count>0){const m=document.createElement('div');m.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--text);color:var(--surface);padding:10px 18px;border-radius:8px;font-size:13px;z-index:999;';m.textContent=`${count} item${count===1?'':'s'} imported`;document.body.appendChild(m);setTimeout(()=>m.remove(),2800);}
}

/* ─── THEME ─── */
function toggleTheme() {
  const html = document.documentElement;
  const isLight = html.classList.toggle('light');
  localStorage.setItem('bt_theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-btn').textContent = isLight ? '🌙' : '☀️';
}
(function() {
  const t = localStorage.getItem('bt_theme');
  if (t === 'light') {
    document.documentElement.classList.add('light');
    document.addEventListener('DOMContentLoaded', () => {
      const b = document.getElementById('theme-btn');
      if (b) b.textContent = '🌙';
    });
  }
})();

/* ─── EXPORT / IMPORT BACKUP ─── */
function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    builds,
    clients
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `build-tracker-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data.builds) || !Array.isArray(data.clients)) {
        toast('Invalid backup file — missing builds or clients', true); return;
      }
      const bCount = data.builds.length;
      const cCount = data.clients.length;
      // Save all to API
      await Promise.all(data.clients.map(c => saveClientToApi(c)));
      await Promise.all(data.builds.map(b => saveBuildToApi(b)));
      builds  = data.builds;
      clients = data.clients;
      save();
      refreshSelects();
      renderBoard();
      toast(`Restored ${bCount} build${bCount===1?'':'s'} and ${cCount} client${cCount===1?'':'s'}`);
    } catch(err) {
      toast('Could not read backup file — is it valid JSON?', true);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function toast(msg, isError) {
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed','bottom:24px','right:24px','z-index:999',
    'padding:10px 16px','border-radius:8px','font-size:13px','font-weight:600',
    'background:' + (isError ? 'var(--danger)' : 'var(--accent)'),
    'color:white','box-shadow:0 4px 16px rgba(0,0,0,0.4)'
  ].join(';');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ─── DEMO DATA ─── */
function loadDemoData() {
  if (builds.length > 0 || clients.length > 0) {
    var btn = document.getElementById('btn-demo');
    if (btn.dataset.confirm === '1') {
      btn.dataset.confirm = '0';
      btn.textContent = 'Load Demo Data';
      btn.style.color = '#EB459E';
    } else {
      btn.dataset.confirm = '1';
      btn.innerHTML = '⚠ Confirm? Replaces data';
      btn.style.color = '#FEE75C';
      setTimeout(function() {
        if (btn.dataset.confirm === '1') {
          btn.dataset.confirm = '0';
          btn.innerHTML = '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3l10 5-10 5V3z"/></svg> Load Demo Data';
          btn.style.color = '#EB459E';
        }
      }, 3500);
      return;
    }
  }
  _injectDemo();
}

async function _injectDemo() {
  var now = Date.now();
  function uid2() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
  function dateStr(offsetDays) {
    var d = new Date(); d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0,10);
  }
  function ms(key, label, done, daysOffset) {
    return { id: uid2(), key: key, label: label, standard: !!key, done: done,
             date: done ? dateStr(daysOffset - 5) : (daysOffset != null ? dateStr(daysOffset) : '') };
  }
  function tw(text, done) { return { text: text, done: done }; }

  // ── CLIENTS ──
  var portalId, novaId, apexDashId, lumBookId, driftCampId, skyFleetId;
  var c1 = { id: uid2(), name: 'Acme Corp',        color: '#5865F2', emoji: '🏢', notes: 'Enterprise SaaS client. Main contact: Sarah.',  createdAt: now };
  var c2 = { id: uid2(), name: 'Nova Retail',       color: '#57F287', emoji: '🛒', notes: 'E-commerce platform redesign project.',         createdAt: now };
  var c3 = { id: uid2(), name: 'Apex Financial',    color: '#FEE75C', emoji: '💰', notes: 'Fintech dashboard and reporting suite.',        createdAt: now };
  var c4 = { id: uid2(), name: 'Luminary Health',   color: '#EB459E', emoji: '🏥', notes: 'Patient portal and booking system.',            createdAt: now };
  var c5 = { id: uid2(), name: 'Drift Agency',      color: '#ED4245', emoji: '🎨', notes: 'Creative agency — multiple micro projects.',    createdAt: now };
  var c6 = { id: uid2(), name: 'Skyline Logistics', color: '#1D9E75', emoji: '✈️', notes: 'Fleet tracking and operations dashboard.',      createdAt: now };

  clients = [c1, c2, c3, c4, c5, c6];

  // ── BUILDS ──
  builds = [

    // ── ACME CORP ──
    {
      id: (portalId=uid2()), title: 'Client Portal Redesign', type: 'build', status: 'in-progress',
      clientId: c1.id, desc: 'Full redesign of the client-facing portal including new dashboard, reporting views, and a refreshed design system.',
      startDate: dateStr(-14), endDate: dateStr(12), demoDate: dateStr(14),
      notes: 'Sarah confirmed the new brand guidelines are locked in. Use the teal/indigo palette.',
      createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true,  -12),
        ms('design',        'Design approved',                 true,  -5),
        ms('dev_start',     'Development started',             true,  -3),
        ms('qa_raised',     'QA raised',                       false, 11),
        ms('client_review', 'Client review complete',          false, 13),
        ms('deployed',      'Deployed to production',          false, 15),
      ],
      tweaks: [tw('Update header nav with new logo', true), tw('Migrate old user data to new schema', true),
               tw('Responsive breakpoints for tablet', false), tw('Dark mode toggle', false), tw('Export to CSV button', false)]
    },
    {
      id: uid2(), title: 'SSO Integration', type: 'build', status: 'todo',
      clientId: c1.id, desc: 'Implement single sign-on via Okta for all enterprise users.',
      startDate: dateStr(5), endDate: dateStr(35), demoDate: dateStr(40),
      notes: '', createdAt: now,
      milestones: [
        ms('requirements', 'Requirements provided by client', false, 6),
        ms('qa_raised',    'QA raised',                       false, 34),
        ms('client_review','Client review complete',          false, 38),
      ],
      tweaks: [tw('Confirm Okta tenant details with client', false), tw('Set up dev environment', false)]
    },
    {
      id: uid2(), title: 'Fix broken CSV export on reports page', type: 'tweak', status: 'in-progress',
      parentBuildId: portalId,
      clientId: c1.id, desc: 'Export button throws a 500 when date range spans more than 90 days.',
      startDate: dateStr(-2), endDate: dateStr(1), demoDate: '',
      notes: 'Reproduced locally — looks like a query timeout issue.', createdAt: now,
      milestones: [],
      tweaks: [tw('Identify query causing timeout', true), tw('Add pagination to export', false), tw('Test with 180-day range', false)]
    },

    // ── NOVA RETAIL ──
    {
      id: (novaId=uid2()), title: 'E-Commerce Platform Overhaul', type: 'build', status: 'in-progress',
      clientId: c2.id, desc: 'Complete rebuild of storefront, checkout flow, and product catalogue system on Next.js.',
      startDate: dateStr(-30), endDate: dateStr(-2), demoDate: dateStr(3),
      notes: 'We are past the end date — client approved a 2-week extension but havent updated the system yet.',
      createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true,  -28),
        ms('design',        'Design approved',                 true,  -20),
        ms('dev_start',     'Development started',             true,  -18),
        ms('qa_raised',     'QA raised',                       true,  -4),
        ms('client_review', 'Client review complete',          false, -1),
        ms('deployed',      'Deployed to production',          false, 5),
      ],
      tweaks: [tw('Product image optimisation', true), tw('Checkout Stripe integration', true),
               tw('Guest checkout flow', true), tw('Abandoned cart emails', false), tw('Mobile nav hamburger fix', false)]
    },
    {
      id: uid2(), title: 'Update product image gallery', type: 'tweak', status: 'todo',
      parentBuildId: novaId,
      clientId: c2.id, desc: 'Replace the current single-image display with a swipeable multi-image gallery.',
      startDate: dateStr(3), endDate: dateStr(10), demoDate: '',
      notes: '', createdAt: now, milestones: [],
      tweaks: [tw('Source lightbox library', false), tw('Handle video thumbnails', false)]
    },
    {
      id: uid2(), title: 'Inventory Management Module', type: 'build', status: 'done',
      clientId: c2.id, desc: 'Stock level tracking, low-stock alerts, and supplier order generation.',
      startDate: dateStr(-60), endDate: dateStr(-20), demoDate: dateStr(-18),
      notes: 'Shipped and signed off. Client very happy.', createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true, -58),
        ms('design',        'Design approved',                 true, -50),
        ms('dev_start',     'Development started',             true, -48),
        ms('qa_raised',     'QA raised',                       true, -22),
        ms('client_review', 'Client review complete',          true, -21),
        ms('deployed',      'Deployed to production',          true, -20),
      ],
      tweaks: [tw('CSV import for stock', true), tw('Email alert threshold config', true), tw('Bulk edit UI', true)]
    },

    // ── APEX FINANCIAL ──
    {
      id: (apexDashId=uid2()), title: 'Regulatory Reporting Dashboard', type: 'build', status: 'demo-ready',
      clientId: c3.id, desc: 'Automated generation of FCA-compliant reports with audit trail and export to PDF.',
      startDate: dateStr(-20), endDate: dateStr(0), demoDate: dateStr(2),
      notes: 'Demo with compliance team on Thursday at 2pm.', createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true,  -18),
        ms('design',        'Design approved',                 true,  -10),
        ms('dev_start',     'Development started',             true,  -8),
        ms('qa_raised',     'QA raised',                       true,  -2),
        ms('client_review', 'Client review complete',          false, 1),
        ms('deployed',      'Deployed to production',          false, 4),
      ],
      tweaks: [tw('PDF watermark for draft reports', true), tw('Role-based access to report types', true),
               tw('Date range picker UX fix', true), tw('Print stylesheet', false)]
    },
    {
      id: uid2(), title: 'Fix incorrect rounding on P&L summaries', type: 'tweak', status: 'todo',
      parentBuildId: apexDashId,
      clientId: c3.id, desc: 'Totals on the P&L summary page are rounding to 1dp instead of 2dp.',
      startDate: dateStr(0), endDate: dateStr(2), demoDate: '',
      notes: 'Spotted during demo prep — must fix before Thursday.', createdAt: now, milestones: [],
      tweaks: [tw('Locate formatting utility', false), tw('Fix and add unit test', false), tw('Verify on staging', false)]
    },
    {
      id: uid2(), title: 'Two-Factor Authentication', type: 'build', status: 'todo',
      clientId: c3.id, desc: 'Add TOTP-based 2FA to all user logins with recovery code flow.',
      startDate: dateStr(10), endDate: dateStr(40), demoDate: dateStr(45),
      notes: '', createdAt: now,
      milestones: [
        ms('requirements', 'Requirements provided by client', false, 11),
        ms('qa_raised',    'QA raised',                       false, 39),
        ms('client_review','Client review complete',          false, 43),
      ],
      tweaks: []
    },

    // ── LUMINARY HEALTH ──
    {
      id: (lumBookId=uid2()), title: 'Patient Booking System', type: 'build', status: 'in-progress',
      clientId: c4.id, desc: 'Self-service appointment booking with GP availability calendar, SMS reminders, and cancellation flow.',
      startDate: dateStr(-10), endDate: dateStr(20), demoDate: dateStr(25),
      notes: 'GDPR compliance review needed before launch. Legal sign-off outstanding.',
      createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true,  -9),
        ms('design',        'Design approved',                 true,  -4),
        ms('dev_start',     'Development started',             true,  -2),
        ms('qa_raised',     'QA raised',                       false, 19),
        ms('client_review', 'Client review complete',          false, 23),
        ms('deployed',      'Deployed to production',          false, 26),
      ],
      tweaks: [tw('Availability calendar component', true), tw('SMS reminder via Twilio', false),
               tw('Cancellation reason dropdown', false), tw('Admin override for bookings', false)]
    },
    {
      id: uid2(), title: 'Update privacy policy consent banner', type: 'tweak', status: 'in-progress',
      parentBuildId: lumBookId,
      clientId: c4.id, desc: 'Replace existing banner with granular consent options per GDPR Article 7.',
      startDate: dateStr(-3), endDate: dateStr(4), demoDate: '',
      notes: '', createdAt: now, milestones: [],
      tweaks: [tw('Consent categories defined by legal', false), tw('Persist preferences to DB', false), tw('Re-prompt on policy change', false)]
    },

    // ── DRIFT AGENCY ──
    {
      id: uid2(), title: 'Brand Microsite', type: 'build', status: 'done',
      clientId: c5.id, desc: 'Animated landing page for new product launch. Three sections, video hero, and contact form.',
      startDate: dateStr(-45), endDate: dateStr(-15), demoDate: dateStr(-12),
      notes: 'Live at launch.driftexample.com — client loved it.', createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true, -43),
        ms('design',        'Design approved',                 true, -35),
        ms('dev_start',     'Development started',             true, -30),
        ms('qa_raised',     'QA raised',                       true, -17),
        ms('client_review', 'Client review complete',          true, -16),
        ms('deployed',      'Deployed to production',          true, -15),
      ],
      tweaks: [tw('Add cookie banner', true), tw('OG meta tags', true), tw('Form spam protection', true)]
    },
    {
      id: uid2(), title: 'Fix hero video autoplay on iOS Safari', type: 'tweak', status: 'todo',
      parentBuildId: driftCampId,
      clientId: c5.id, desc: 'Video does not autoplay on iOS due to missing muted + playsinline attributes.',
      startDate: dateStr(0), endDate: dateStr(3), demoDate: '',
      notes: 'Quick fix — should be 30 mins max.', createdAt: now, milestones: [],
      tweaks: [tw('Add muted + playsinline to video tag', false), tw('Test on iPhone 14 Safari', false)]
    },
    {
      id: (driftCampId=uid2()), title: 'Q3 Campaign Landing Pages', type: 'build', status: 'todo',
      clientId: c5.id, desc: 'Three new campaign pages for summer product push. Templated from brand microsite.',
      startDate: dateStr(7), endDate: dateStr(28), demoDate: dateStr(30),
      notes: '', createdAt: now,
      milestones: [
        ms('requirements', 'Requirements provided by client', false, 8),
        ms('qa_raised',    'QA raised',                       false, 27),
        ms('client_review','Client review complete',          false, 29),
      ],
      tweaks: []
    },

    // ── SKYLINE LOGISTICS ──
    {
      id: (skyFleetId=uid2()), title: 'Fleet Tracking Dashboard', type: 'build', status: 'in-progress',
      clientId: c6.id, desc: 'Real-time map view of all vehicles, driver status, ETA calculations, and incident logging.',
      startDate: dateStr(-8), endDate: dateStr(18), demoDate: dateStr(22),
      notes: 'Using Mapbox GL. API keys provided — need to restrict to production domain.',
      createdAt: now,
      milestones: [
        ms('requirements',  'Requirements provided by client', true,  -7),
        ms('design',        'Design approved',                 true,  -2),
        ms('dev_start',     'Development started',             true,  -1),
        ms('qa_raised',     'QA raised',                       false, 17),
        ms('client_review', 'Client review complete',          false, 20),
        ms('deployed',      'Deployed to production',          false, 23),
      ],
      tweaks: [tw('Mapbox tile layer setup', true), tw('Driver status colour coding', false),
               tw('ETA algorithm', false), tw('Incident form modal', false), tw('Export trip report to PDF', false)]
    },
    {
      id: uid2(), title: 'Update driver onboarding email sequence', type: 'tweak', status: 'todo',
      parentBuildId: skyFleetId,
      clientId: c6.id, desc: 'Three-email welcome sequence needs rewriting to reflect new app UI and features.',
      startDate: dateStr(2), endDate: dateStr(9), demoDate: '',
      notes: '', createdAt: now, milestones: [],
      tweaks: [tw('Write email 1 — welcome + login', false), tw('Write email 2 — key features', false), tw('Write email 3 — support resources', false)]
    },
  ];

  // Save all demo data to API
  await Promise.all(clients.map(c => saveClientToApi(c)));
  await Promise.all(builds.map(b => saveBuildToApi(b)));

  save();
  refreshSelects();
  renderFolders();
  renderBoard();

  // Hide demo button after load
  var btn = document.getElementById('btn-demo');
  if (btn) btn.style.display = 'none';

  toast('Demo data loaded — ' + builds.length + ' builds across ' + clients.length + ' clients');
}

/* ─── INIT ─── */
async function init() {
  await loadData();
  refreshSelects();
  updateStats();
  renderFolders();
  renderBoard();
}

init();