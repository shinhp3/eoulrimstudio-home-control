const WORKER_BASE = 'https://eoulrimstudio-upload.eoulrimstudio.workers.dev';
const SITE_BASE = 'https://www.eoulrimstudio.com';
const AUTH_COOKIE = 'eoulrim_admin_auth';
const AUTH_MAX_AGE = 30 * 24 * 60 * 60;

let portfolioSha = '';
let portfolioItems = [];
let editingId = null;
/** @type {Array<{type:'existing',path:string}|{type:'new',file:File,preview:string}>} */
let formImages = [];
let formDirty = false;
let imageDragIndex = null;

// ── DOM refs ──
const authScreen = document.getElementById('auth-screen');
const appEl = document.getElementById('app');
const authForm = document.getElementById('auth-form');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const itemGrid = document.getElementById('item-grid');
const itemCount = document.getElementById('item-count');
const formPanel = document.getElementById('form-panel');
const formTitle = document.getElementById('form-title');
const editorMode = document.getElementById('editor-mode');
const itemForm = document.getElementById('item-form');
const btnAdd = document.getElementById('btn-add');
const btnCancel = document.getElementById('btn-cancel');
const btnCancelFooter = document.getElementById('btn-cancel-footer');
const formDirtyBadge = document.getElementById('form-dirty-badge');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const imagePreviews = document.getElementById('image-previews');
const loadingOverlay = document.getElementById('loading-overlay');
const toastContainer = document.getElementById('toast-container');

// ── Cookie ──
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setAuthCookie() {
  document.cookie = `${AUTH_COOKIE}=1; max-age=${AUTH_MAX_AGE}; path=/; SameSite=Lax`;
}

function isAuthenticated() {
  return getCookie(AUTH_COOKIE) === '1';
}

// ── UI helpers ──
function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}

function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function setFormDirty(dirty) {
  formDirty = dirty;
  if (formDirtyBadge) {
    formDirtyBadge.classList.toggle('hidden', !dirty);
  }
}

function markFormDirty() {
  setFormDirty(true);
}

function markFormClean() {
  setFormDirty(false);
}

async function persistOrder(items, successMessage = '순서가 저장되었습니다.') {
  const previousItems = [...portfolioItems];
  portfolioItems = items;
  renderList();

  try {
    await fetchPortfolio();
    await savePortfolio(items, portfolioSha);
    showToast(successMessage);
    return true;
  } catch (err) {
    portfolioItems = previousItems;
    renderList();
    showToast(err.message || '저장 실패', 'error');
    return false;
  }
}

function imageUrl(path) {
  const clean = path.replace(/^\//, '');
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return `${SITE_BASE}/${clean}`;
  }
  return `/${clean}`;
}

// ── API ──
async function apiFetch(path, options = {}) {
  const res = await fetch(`${WORKER_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
}

async function checkAuthStatus() {
  const res = await apiFetch('/auth/status');
  if (!res.ok) throw new Error('인증 상태 확인 실패');
  return res.json();
}

async function verifyPassword(password) {
  const res = await apiFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error('인증 요청 실패');
  return res.json();
}

async function fetchPortfolio() {
  const res = await apiFetch('/portfolio');
  if (!res.ok) throw new Error(`포트폴리오 조회 실패 (${res.status})`);
  const sha = res.headers.get('X-GitHub-Content-Sha') || '';
  const data = await res.json();
  portfolioSha = sha;
  portfolioItems = Array.isArray(data.items) ? data.items : [];
  return { items: portfolioItems, sha: portfolioSha };
}

async function savePortfolio(items, sha) {
  const res = await apiFetch('/portfolio', {
    method: 'PUT',
    body: JSON.stringify({ items, sha }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`저장 실패 (${res.status})${text ? ': ' + text : ''}`);
  }
  const newSha = res.headers.get('X-GitHub-Content-Sha');
  if (newSha) portfolioSha = newSha;
  portfolioItems = items;
}

async function uploadPortfolioImage(projectId, filename, file) {
  const base64 = await fileToBase64(file);
  const res = await apiFetch('/portfolio-image', {
    method: 'POST',
    body: JSON.stringify({ projectId, filename, content: base64 }),
  });
  if (!res.ok) throw new Error(`이미지 업로드 실패: ${filename}`);
  const data = await res.json();
  if (!data.success || !data.path) throw new Error(`이미지 업로드 실패: ${filename}`);
  return data.path;
}

async function deletePortfolioImage(path) {
  const res = await apiFetch('/portfolio-image', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`이미지 삭제 실패: ${path}`);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = typeof result === 'string' ? result.split(',')[1] : '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── ID / filename helpers ──
function nextId(items) {
  const max = items.reduce((m, it) => Math.max(m, parseInt(it.id, 10) || 0), 0);
  return String(max + 1).padStart(2, '0');
}

function numericId(id) {
  return parseInt(id, 10);
}

function imageFilename(numId, index) {
  if (index === 0) return `pj_${numId}_main.png`;
  return `pj_${numId}_sub_${index}.png`;
}

function isItemHidden(item) {
  return item?.hidden === true;
}

function applyHiddenField(item, hidden) {
  const next = { ...item };
  if (hidden) {
    next.hidden = true;
  } else {
    delete next.hidden;
  }
  return next;
}

// ── Auth flow ──
async function initAuth() {
  try {
    if (isAuthenticated()) {
      showApp();
      return;
    }
    const status = await checkAuthStatus();
    if (!status.passwordRequired) {
      setAuthCookie();
      showApp();
      return;
    }
    authScreen.classList.remove('hidden');
  } catch (err) {
    authError.textContent = err.message === 'Failed to fetch'
      ? '서버에 연결할 수 없습니다. 네트워크 또는 CORS 설정을 확인해 주세요.'
      : (err.message || '연결 오류');
    authScreen.classList.remove('hidden');
  }
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const password = authPassword.value;
  try {
    const result = await verifyPassword(password);
    if (result.ok) {
      setAuthCookie();
      authScreen.classList.add('hidden');
      showApp();
    } else {
      authError.textContent = '비밀번호가 올바르지 않습니다.';
    }
  } catch (err) {
    authError.textContent = err.message || '인증 오류';
  }
});

async function showApp() {
  authScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  showLoading(true);
  try {
    await fetchPortfolio();
    renderList();
  } catch (err) {
    showToast(err.message || '데이터 로드 실패', 'error');
  } finally {
    showLoading(false);
  }
}

// ── List ──
function renderList() {
  const hiddenCount = portfolioItems.filter(isItemHidden).length;
  const visibleCount = portfolioItems.length - hiddenCount;
  const lastIndex = portfolioItems.length - 1;

  if (itemCount) {
    itemCount.innerHTML = hiddenCount
      ? `${portfolioItems.length}개 <span class="item-count-detail">(공개 ${visibleCount} · 숨김 ${hiddenCount})</span>`
      : `${portfolioItems.length}개`;
  }

  if (portfolioItems.length === 0) {
    itemGrid.innerHTML = '<p class="empty-list">등록된 항목이 없습니다. 우측 상단 <strong>+ 새 항목</strong>으로 추가하세요.</p>';
    return;
  }

  itemGrid.innerHTML = portfolioItems
    .map((item, index) => {
      const thumb = item.images?.[0] ? imageUrl(item.images[0]) : '';
      const hidden = isItemHidden(item);
      return `
        <article class="item-card${hidden ? ' is-hidden' : ''}" data-id="${item.id}">
          <div class="item-card-top">
            <span class="item-card-order">${index + 1}</span>
            <div class="item-card-order-controls">
              <button type="button" class="btn-icon" data-action="move-up" data-id="${item.id}" aria-label="앞으로" ${index === 0 ? 'disabled' : ''}>←</button>
              <button type="button" class="btn-icon" data-action="move-down" data-id="${item.id}" aria-label="뒤로" ${index === lastIndex ? 'disabled' : ''}>→</button>
              <button type="button" class="item-card-drag" data-drag-handle draggable="true" aria-label="드래그하여 순서 변경">⠿</button>
            </div>
          </div>
          ${thumb ? `<img class="item-card-thumb" src="${thumb}" alt="">` : '<div class="item-card-thumb"></div>'}
          <div class="item-card-body">
            <div class="item-card-id">#${item.id}</div>
            <span class="item-card-status">숨김</span>
            <div class="item-card-title">${escapeHtml(item.title)}</div>
            <div class="item-card-actions">
              <button type="button" class="btn btn-sm" data-action="edit" data-id="${item.id}">수정</button>
              <button type="button" class="btn btn-sm btn-muted" data-action="toggle-hidden" data-id="${item.id}">
                ${hidden ? '공개' : '숨기기'}
              </button>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-id="${item.id}">삭제</button>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

function reorderPortfolioItems(fromId, toId) {
  const fromIndex = portfolioItems.findIndex((it) => it.id === fromId);
  const toIndex = portfolioItems.findIndex((it) => it.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  const items = [...portfolioItems];
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  return items;
}

function movePortfolioItem(id, direction) {
  const index = portfolioItems.findIndex((it) => it.id === id);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= portfolioItems.length) return null;
  const items = [...portfolioItems];
  [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
  return items;
}

let dragId = null;

function initListDragDrop() {
  if (itemGrid.dataset.dragInit) return;
  itemGrid.dataset.dragInit = '1';

  itemGrid.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('[data-drag-handle]');
    if (!handle) {
      e.preventDefault();
      return;
    }
    const card = handle.closest('.item-card');
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  itemGrid.addEventListener('dragend', () => {
    dragId = null;
    itemGrid.querySelectorAll('.item-card').forEach((card) => {
      card.classList.remove('is-dragging', 'is-drag-over');
    });
  });

  itemGrid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const card = e.target.closest('.item-card');
    itemGrid.querySelectorAll('.item-card.is-drag-over').forEach((el) => {
      if (el !== card) el.classList.remove('is-drag-over');
    });
    if (card && card.dataset.id !== dragId) {
      card.classList.add('is-drag-over');
    }
  });

  itemGrid.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.item-card');
    if (card && !card.contains(e.relatedTarget)) {
      card.classList.remove('is-drag-over');
    }
  });

  itemGrid.addEventListener('drop', async (e) => {
    e.preventDefault();
    const targetCard = e.target.closest('.item-card');
    if (!targetCard || !dragId) return;

    const targetId = targetCard.dataset.id;
    targetCard.classList.remove('is-drag-over');
    if (targetId === dragId) return;

    const reordered = reorderPortfolioItems(dragId, targetId);
    if (!reordered) return;

    dragId = null;
    targetCard.classList.add('is-busy');
    await persistOrder(reordered);
    targetCard.classList.remove('is-busy');
  });
}

itemGrid.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') openEditForm(id);
  if (action === 'toggle-hidden') toggleItemVisibility(id);
  if (action === 'delete') deleteItem(id);

  if (action === 'move-up' || action === 'move-down') {
    const reordered = movePortfolioItem(id, action === 'move-up' ? 'up' : 'down');
    if (!reordered) return;
    btn.closest('.item-card')?.classList.add('is-busy');
    await persistOrder(reordered);
    btn.closest('.item-card')?.classList.remove('is-busy');
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Form ──
function openEditor() {
  formPanel.classList.remove('hidden');
  formPanel.querySelector('.editor-body')?.scrollTo(0, 0);
  document.body.style.overflow = 'hidden';
  setTimeout(() => itemForm.elements.title?.focus(), 50);
}

function tryCloseForm() {
  if (formDirty && !confirm('저장하지 않은 변경사항이 있습니다. 목록으로 돌아가시겠습니까?')) {
    return;
  }
  closeForm();
}

function closeForm() {
  formPanel.classList.add('hidden');
  document.body.style.overflow = '';
  editingId = null;
  formImages.forEach((img) => {
    if (img.type === 'new' && img.preview) URL.revokeObjectURL(img.preview);
  });
  formImages = [];
  itemForm.reset();
  markFormClean();
}

function openAddForm() {
  editingId = null;
  if (editorMode) editorMode.textContent = 'NEW';
  formTitle.textContent = '새 항목 추가';
  itemForm.reset();
  formImages = [];
  renderImagePreviews();
  markFormClean();
  openEditor();
}

function openEditForm(id) {
  const item = portfolioItems.find((it) => it.id === id);
  if (!item) return;

  editingId = id;
  if (editorMode) editorMode.textContent = `EDIT · #${id}`;
  formTitle.textContent = item.title || `항목 #${id}`;
  itemForm.elements.title.value = item.title || '';
  itemForm.elements.year.value = item.year || '';
  itemForm.elements.type.value = item.type || '';
  itemForm.elements.service.value = item.service || '';
  itemForm.elements.kicker.value = item.kicker || '';
  itemForm.elements.description.value = item.description || '';
  itemForm.elements.hidden.checked = isItemHidden(item);
  formImages = (item.images || []).map((path) => ({ type: 'existing', path }));
  renderImagePreviews();
  markFormClean();
  openEditor();
}

btnAdd.addEventListener('click', openAddForm);
btnCancel.addEventListener('click', tryCloseForm);
btnCancelFooter?.addEventListener('click', tryCloseForm);

itemForm.addEventListener('input', markFormDirty);
itemForm.addEventListener('change', markFormDirty);

document.addEventListener('keydown', (e) => {
  if (formPanel.classList.contains('hidden')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    tryCloseForm();
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (typeof itemForm.requestSubmit === 'function') {
      itemForm.requestSubmit();
    } else {
      itemForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }
});

// ── Image upload ──
function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    formImages.push({ type: 'new', file, preview: URL.createObjectURL(file) });
  }
  renderImagePreviews();
  markFormDirty();
}

function reorderFormImages(fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  const [moved] = formImages.splice(fromIndex, 1);
  formImages.splice(toIndex, 0, moved);
  renderImagePreviews();
  markFormDirty();
}

function renderImagePreviews() {
  imagePreviews.innerHTML = formImages
    .map((img, i) => {
      const src = img.type === 'existing' ? imageUrl(img.path) : img.preview;
      const label = i === 0 ? 'MAIN' : `SUB ${i}`;
      const mainClass = i === 0 ? ' is-main' : '';
      return `
        <div class="image-preview${mainClass}" data-index="${i}" draggable="true">
          <img src="${src}" alt="" draggable="false">
          <span class="image-preview-label">${label}</span>
          <button type="button" data-remove="${i}" title="제거" aria-label="이미지 제거">&times;</button>
        </div>`;
    })
    .join('');
}

function initImageDragDrop() {
  if (imagePreviews.dataset.dragInit) return;
  imagePreviews.dataset.dragInit = '1';

  imagePreviews.addEventListener('dragstart', (e) => {
    if (e.target.closest('[data-remove]')) {
      e.preventDefault();
      return;
    }
    const preview = e.target.closest('.image-preview');
    if (!preview) return;
    imageDragIndex = parseInt(preview.dataset.index, 10);
    preview.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  imagePreviews.addEventListener('dragend', () => {
    imageDragIndex = null;
    imagePreviews.querySelectorAll('.image-preview').forEach((el) => {
      el.classList.remove('is-dragging', 'is-drag-over');
    });
  });

  imagePreviews.addEventListener('dragover', (e) => {
    e.preventDefault();
    const preview = e.target.closest('.image-preview');
    imagePreviews.querySelectorAll('.image-preview.is-drag-over').forEach((el) => {
      if (el !== preview) el.classList.remove('is-drag-over');
    });
    if (preview) preview.classList.add('is-drag-over');
  });

  imagePreviews.addEventListener('drop', (e) => {
    e.preventDefault();
    const preview = e.target.closest('.image-preview');
    if (!preview || imageDragIndex === null) return;
    const toIndex = parseInt(preview.dataset.index, 10);
    preview.classList.remove('is-drag-over');
    reorderFormImages(imageDragIndex, toIndex);
    imageDragIndex = null;
  });
}

imagePreviews.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.remove, 10);
  const removed = formImages[idx];
  if (removed?.type === 'new' && removed.preview) URL.revokeObjectURL(removed.preview);
  formImages.splice(idx, 1);
  renderImagePreviews();
  markFormDirty();
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

// ── Save ──
itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = itemForm.elements.title.value.trim();
  if (!title) {
    showToast('제목을 입력해 주세요.', 'error');
    return;
  }

  showLoading(true);
  const wasEdit = !!editingId;
  try {
    const id = editingId || nextId(portfolioItems);
    const numId = numericId(id);
    const oldItem = editingId ? portfolioItems.find((it) => it.id === editingId) : null;
    const oldImages = oldItem?.images || [];

    const imagePaths = [];
    for (let i = 0; i < formImages.length; i++) {
      const img = formImages[i];
      if (img.type === 'existing') {
        imagePaths.push(img.path);
      } else {
        const filename = imageFilename(numId, i);
        const path = await uploadPortfolioImage(id, filename, img.file);
        imagePaths.push(path);
      }
    }

    const newItem = applyHiddenField({
      id,
      title,
      year: itemForm.elements.year.value.trim(),
      type: itemForm.elements.type.value.trim(),
      service: itemForm.elements.service.value.trim(),
      images: imagePaths,
      kicker: itemForm.elements.kicker.value.trim(),
      description: itemForm.elements.description.value.trim(),
    }, itemForm.elements.hidden.checked);

    const removedPaths = oldImages.filter((p) => !imagePaths.includes(p));
    for (const path of removedPaths) {
      try {
        await deletePortfolioImage(path);
      } catch (err) {
        console.warn('이미지 삭제 실패 (무시):', path, err);
      }
    }

    let updatedItems;
    if (editingId) {
      updatedItems = portfolioItems.map((it) => (it.id === editingId ? newItem : it));
    } else {
      updatedItems = [...portfolioItems, newItem];
    }

    await fetchPortfolio();
    await savePortfolio(updatedItems, portfolioSha);

    closeForm();
    renderList();
    showToast(wasEdit ? '수정되었습니다.' : '추가되었습니다.');
    markFormClean();
  } catch (err) {
    showToast(err.message || '저장 실패', 'error');
  } finally {
    showLoading(false);
  }
});

// ── Hide / Show ──
async function toggleItemVisibility(id) {
  const item = portfolioItems.find((it) => it.id === id);
  if (!item) return;

  const willHide = !isItemHidden(item);

  const row = itemGrid.querySelector(`[data-id="${id}"]`);
  row?.classList.add('is-busy');
  try {
    await fetchPortfolio();
    const updatedItems = portfolioItems.map((it) =>
      it.id === id ? applyHiddenField(it, willHide) : it
    );
    await savePortfolio(updatedItems, portfolioSha);
    renderList();
    showToast(willHide ? '항목이 숨겨졌습니다.' : '항목이 공개되었습니다.');
  } catch (err) {
    showToast(err.message || '상태 변경 실패', 'error');
  } finally {
    row?.classList.remove('is-busy');
  }
}

// ── Delete ──
async function deleteItem(id) {
  const item = portfolioItems.find((it) => it.id === id);
  if (!item) return;
  if (!confirm(`"${item.title}" 항목을 정말 삭제하시겠습니까?`)) return;

  showLoading(true);
  try {
    await fetchPortfolio();

    for (const path of item.images || []) {
      await deletePortfolioImage(path);
    }

    const updatedItems = portfolioItems.filter((it) => it.id !== id);
    await fetchPortfolio();
    await savePortfolio(updatedItems, portfolioSha);

    if (editingId === id) closeForm();
    renderList();
    showToast('삭제되었습니다.');
  } catch (err) {
    showToast(err.message || '삭제 실패', 'error');
  } finally {
    showLoading(false);
  }
}

// ── Init ──
initListDragDrop();
initImageDragDrop();
initAuth();
