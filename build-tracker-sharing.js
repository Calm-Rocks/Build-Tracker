// ============================================================
// SHARED CLIENT FRONTEND PATCH
// Add these functions to build-tracker.js, and wire them in
// as described in the comments below.
// ============================================================

// ── CHANGE 1: Update loadData() in build-tracker.js ──
// The clients response now includes `role` and `ownerId` per client.
// The builds response now includes `createdBy` per build.
// No code change needed — these fields come through automatically.

// ── CHANGE 2: Update renderFolders() ──
// Replace the folder-btn inner HTML to show a share icon for owned clients.
// Find this section and update the folder-btn template:
//
//   ${c.role === 'owner'
//     ? `<button class="folder-share-btn" onclick="openShareModal(event,'${c.id}')" title="Share client">
//          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
//            <circle cx="12" cy="4" r="2"/><circle cx="4" cy="8" r="2"/><circle cx="12" cy="12" r="2"/>
//            <path d="M6 7l4-2M6 9l4 2"/>
//          </svg>
//        </button>`
//     : `<span class="folder-member-badge" title="Shared with you">👥</span>`
//   }

// ── CHANGE 3: In saveClient() ──
// After saving, the response now includes `role: 'owner'` in the refreshed client list.
// No code change needed.

// ── CHANGE 4: In clientOf() / renderBoard() ──
// Builds from shared clients have `createdBy !== currentUserId`.
// The card can optionally show a small "by other@email.com" label.
// (Optional UI enhancement — not required for core functionality.)

// ============================================================
// SHARING MODAL STATE
// ============================================================

let shareClientId  = null;
let shareModalData = null; // { members, pendingInvites }

function openShareModal(e, clientId) {
  e.stopPropagation();
  shareClientId = clientId;
  const c = clients.find(x => x.id === clientId);
  document.getElementById('sm-client-name').textContent = c ? c.name : '';
  document.getElementById('share-modal').classList.add('open');
  document.getElementById('sm-invite-url').value = '';
  document.getElementById('sm-invite-wrap').style.display = 'none';
  document.getElementById('sm-members-list').innerHTML =
    '<div style="font-size:13px;color:var(--text-faint);padding:8px 0;">Loading…</div>';
  loadShareData(clientId);
}

function closeShareModal() {
  document.getElementById('share-modal').classList.remove('open');
  shareClientId  = null;
  shareModalData = null;
}

async function loadShareData(clientId) {
  try {
    const res  = await apiFetch(`/api/clients/${clientId}/share`);
    const data = await res.json();
    if (!res.ok) { renderShareError(data.error); return; }
    shareModalData = data;
    renderShareMembers(data);
  } catch {
    renderShareError('Failed to load sharing data.');
  }
}

function renderShareError(msg) {
  document.getElementById('sm-members-list').innerHTML =
    `<div style="font-size:13px;color:var(--danger-text);">${msg}</div>`;
}

function renderShareMembers(data) {
  const list = document.getElementById('sm-members-list');
  if (!data.members.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-faint);">No members yet.</div>';
    return;
  }

  list.innerHTML = data.members.map(m => `
    <div class="share-member-row">
      <div class="share-member-avatar">${(m.email[0] || '?').toUpperCase()}</div>
      <div class="share-member-info">
        <div class="share-member-email">${esc(m.email)}</div>
        <div class="share-member-role">${m.role === 'owner' ? 'Owner' : 'Member'}</div>
      </div>
      ${m.role !== 'owner' ? `
        <button class="btn btn-sm" style="color:var(--danger-text);padding:3px 8px;"
          onclick="removeMember('${shareClientId}', ${m.userId}, '${esc(m.email)}')">Remove</button>
      ` : ''}
    </div>
  `).join('');
}

async function generateInviteLink() {
  const btn = document.getElementById('sm-generate-btn');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  try {
    const res  = await apiFetch(`/api/clients/${shareClientId}/share`, { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      toast(data.error || 'Failed to generate link.', true);
      return;
    }

    document.getElementById('sm-invite-url').value = data.invite_url;
    document.getElementById('sm-invite-wrap').style.display = '';
  } catch {
    toast('Network error.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate invite link';
  }
}

function copyInviteLink() {
  const inp = document.getElementById('sm-invite-url');
  inp.select();
  navigator.clipboard.writeText(inp.value).then(() => {
    toast('Invite link copied to clipboard');
  }).catch(() => {
    document.execCommand('copy');
    toast('Invite link copied');
  });
}

async function removeMember(clientId, userId, email) {
  if (!confirm(`Remove ${email} from this client?`)) return;

  try {
    const res = await apiFetch(`/api/clients/${clientId}/members/${userId}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      toast(data.error || 'Failed to remove member.', true);
      return;
    }

    toast(`${email} removed`);
    loadShareData(clientId); // refresh member list
  } catch {
    toast('Network error.', true);
  }
}
