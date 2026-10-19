(() => {
  const COLORS = [
    { id: 'indigo', name: '极光蓝', hex: '#6366f1' },
    { id: 'emerald', name: '翡翠绿', hex: '#10b981' },
    { id: 'amber', name: '琥珀金', hex: '#f59e0b' },
    { id: 'rose', name: '珊瑚红', hex: '#f43f5e' },
    { id: 'violet', name: '星云紫', hex: '#8b5cf6' },
    { id: 'cyan', name: '冰川青', hex: '#06b6d4' },
    { id: 'pink', name: '霓虹粉', hex: '#ec4899' },
    { id: 'teal', name: '青碧绿', hex: '#14b8a6' }
  ];

  // State
  let appData = {
    settings: {
      theme: 'dark',
      alwaysOnTop: true,
      autoCollapseOnBlur: true,
      keepExpanded: true,
      openMode: 'auto',
      fontSize: 'normal'
    },
    categories: [],
    bookmarks: [],
    auth: { isInitialized: false, passwordHint: '' }
  };

  let isUnlocked = false;
  let currentWindowMode = 'panel'; // 'panel' | 'orb'
  let activeCategoryId = 'ALL';
  let activeColorFilter = 'ALL';
  let searchQuery = '';

  let batchMode = false;
  let selectedBookmarkIds = new Set();

  let selectedBmColor = 'indigo';
  let selectedCatColor = 'indigo';
  let draggedBookmarkId = null;
  let pendingDeleteCatId = null;

  let currentBrowserTarget = {
    hasTarget: false,
    hwnd: '',
    friendlyName: '',
    title: ''
  };

  // DOM Elements
  const orbView = document.getElementById('orbView');
  const orbCountBadge = document.getElementById('orbCountBadge');
  const panelView = document.getElementById('panelView');

  const btnAlwaysOnTop = document.getElementById('btnAlwaysOnTop');
  const btnKeepExpanded = document.getElementById('btnKeepExpanded');
  const btnCollapseToOrb = document.getElementById('btnCollapseToOrb');
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const btnLockNow = document.getElementById('btnLockNow');
  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const btnCloseApp = document.getElementById('btnCloseApp');

  // Auth DOM
  const authOverlay = document.getElementById('authOverlay');
  const authTitle = document.getElementById('authTitle');
  const authDesc = document.getElementById('authDesc');
  const authForm = document.getElementById('authForm');
  const authPasswordInput = document.getElementById('authPasswordInput');
  const authConfirmGroup = document.getElementById('authConfirmGroup');
  const authConfirmInput = document.getElementById('authConfirmInput');
  const authHintGroup = document.getElementById('authHintGroup');
  const authHintInput = document.getElementById('authHintInput');
  const authHintDisplay = document.getElementById('authHintDisplay');
  const authErrorMsg = document.getElementById('authErrorMsg');
  const authSubmitBtn = document.getElementById('authSubmitBtn');

  // Workspace DOM
  const mainWorkspace = document.getElementById('mainWorkspace');
  const browserTargetBar = document.getElementById('browserTargetBar');
  const targetStatusDot = document.getElementById('targetStatusDot');
  const targetBrowserText = document.getElementById('targetBrowserText');

  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const btnAddBookmark = document.getElementById('btnAddBookmark');
  const categoryTabs = document.getElementById('categoryTabs');
  const btnAddCategory = document.getElementById('btnAddCategory');
  const colorFilterBar = document.getElementById('colorFilterBar');
  const btnQuickImport = document.getElementById('btnQuickImport');
  const btnToggleBatch = document.getElementById('btnToggleBatch');

  const batchActionBar = document.getElementById('batchActionBar');
  const batchSelectAll = document.getElementById('batchSelectAll');
  const batchSelectedCount = document.getElementById('batchSelectedCount');
  const batchMoveCategorySelect = document.getElementById('batchMoveCategorySelect');
  const btnBatchDelete = document.getElementById('btnBatchDelete');
  const btnExitBatch = document.getElementById('btnExitBatch');

  const bookmarkList = document.getElementById('bookmarkList');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptySubtitle = document.getElementById('emptySubtitle');
  const btnEmptyAdd = document.getElementById('btnEmptyAdd');
  const btnEmptyImport = document.getElementById('btnEmptyImport');

  // Modals
  const bookmarkModal = document.getElementById('bookmarkModal');
  const bmModalTitle = document.getElementById('bmModalTitle');
  const bookmarkForm = document.getElementById('bookmarkForm');
  const bmIdInput = document.getElementById('bmIdInput');
  const bmTitleInput = document.getElementById('bmTitleInput');
  const bmUrlInput = document.getElementById('bmUrlInput');
  const bmNoteInput = document.getElementById('bmNoteInput');
  const bmCategorySelect = document.getElementById('bmCategorySelect');
  const bmPinnedInput = document.getElementById('bmPinnedInput');
  const bmColorPicker = document.getElementById('bmColorPicker');

  const categoryModal = document.getElementById('categoryModal');
  const categoryForm = document.getElementById('categoryForm');
  const catIdInput = document.getElementById('catIdInput');
  const catNameInput = document.getElementById('catNameInput');
  const catColorPicker = document.getElementById('catColorPicker');
  const btnCancelCatEdit = document.getElementById('btnCancelCatEdit');
  const btnSaveCategory = document.getElementById('btnSaveCategory');
  const categoryManageList = document.getElementById('categoryManageList');

  const deleteCategoryModal = document.getElementById('deleteCategoryModal');
  const delCatModalTitle = document.getElementById('delCatModalTitle');
  const delCatModalDesc = document.getElementById('delCatModalDesc');
  const delCatWithItemsBox = document.getElementById('delCatWithItemsBox');
  const btnDelCatKeepBm = document.getElementById('btnDelCatKeepBm');
  const btnDelCatRemoveBm = document.getElementById('btnDelCatRemoveBm');
  const delCatEmptyBox = document.getElementById('delCatEmptyBox');
  const btnDelCatEmptyConfirm = document.getElementById('btnDelCatEmptyConfirm');

  const browserModal = document.getElementById('browserModal');
  const openBrowsersList = document.getElementById('openBrowsersList');
  const btnRefreshBrowsers = document.getElementById('btnRefreshBrowsers');

  const settingsModal = document.getElementById('settingsModal');
  const importDefaultFolderInput = document.getElementById('importDefaultFolderInput');
  const btnSettingsImportFile = document.getElementById('btnSettingsImportFile');
  const setAlwaysOnTop = document.getElementById('setAlwaysOnTop');
  const setAutoCollapse = document.getElementById('setAutoCollapse');
  const setFontSize = document.getElementById('setFontSize');
  const setOpenMode = document.getElementById('setOpenMode');
  const changePwdForm = document.getElementById('changePwdForm');
  const oldPwdInput = document.getElementById('oldPwdInput');
  const newPwdInput = document.getElementById('newPwdInput');
  const confirmNewPwdInput = document.getElementById('confirmNewPwdInput');
  const newPwdHintInput = document.getElementById('newPwdHintInput');
  const changePwdMsg = document.getElementById('changePwdMsg');

  const toastContainer = document.getElementById('toastContainer');

  // ==================== INITIALIZATION ====================
  async function init() {
    bindEvents();
    renderColorPickers();
    renderColorFilterBar();

    const [authStatus, fullData, targetInfo] = await Promise.all([
      window.blinkAPI.getAuthStatus(),
      window.blinkAPI.getAllData(),
      window.blinkAPI.getBrowserTarget()
    ]);

    appData = fullData;
    isUnlocked = Boolean(authStatus.isUnlocked);
    applySettingsToUI(appData.settings);
    updateBrowserTargetUI(targetInfo);
    updateAuthScreen(authStatus);
    if (isUnlocked) {
      renderAll();
    } else {
      purgeRendererVaultMemory();
    }

    // Subscribe to live browser window changes
    window.blinkAPI.onBrowserTargetUpdated((target) => {
      updateBrowserTargetUI(target);
    });

    window.blinkAPI.onBrowserListUpdated((list) => {
      renderOpenBrowsersModalList(list);
    });

    window.blinkAPI.onWindowModeChanged((mode) => {
      currentWindowMode = mode;
      if (mode === 'orb') {
        panelView.classList.add('hidden');
        orbView.classList.remove('hidden');
      } else {
        orbView.classList.add('hidden');
        panelView.classList.remove('hidden');
      }
    });

    if (window.blinkAPI.onLocked) {
      window.blinkAPI.onLocked(() => {
        isUnlocked = false;
        purgeRendererVaultMemory();
        updateAuthScreen(appData.auth);
        showToast('🔒 书签库已上锁，内存缓存已擦除');
      });
    }
  }

  function purgeRendererVaultMemory() {
    appData.categories = [];
    appData.bookmarks = [];
    selectedBookmarkIds.clear();
    batchMode = false;
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (btnClearSearch) btnClearSearch.classList.add('hidden');
    if (bookmarkList) bookmarkList.innerHTML = '';
    if (categoryTabs) categoryTabs.innerHTML = '';
    if (categoryManageList) categoryManageList.innerHTML = '';
    if (orbCountBadge) orbCountBadge.textContent = '🔒';
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  }

  // ==================== AUTH & PASSWORD LOCK ====================
  function updateAuthScreen(authStatus) {
    const initialized = Boolean(authStatus.isInitialized);
    authErrorMsg.classList.add('hidden');
    authPasswordInput.value = '';
    authConfirmInput.value = '';

    if (isUnlocked) {
      authOverlay.classList.add('hidden');
      mainWorkspace.classList.remove('hidden');
      btnLockNow.classList.remove('hidden');
      btnOpenSettings.classList.remove('hidden');
      btnCollapseToOrb.classList.remove('hidden');
      return;
    }

    purgeRendererVaultMemory();
    mainWorkspace.classList.add('hidden');
    authOverlay.classList.remove('hidden');
    btnLockNow.classList.add('hidden');
    btnOpenSettings.classList.add('hidden');
    btnCollapseToOrb.classList.add('hidden');

    if (!initialized) {
      authTitle.textContent = '欢迎使用 Blink · 初始化加密密码';
      authDesc.textContent = '首次打开请设置您的专属访问密码，所有书签将采用 AES-256-GCM 进行本地全量加密';
      authConfirmGroup.classList.remove('hidden');
      authHintGroup.classList.remove('hidden');
      authHintDisplay.classList.add('hidden');
      authSubmitBtn.textContent = '设置密码并加密书签库';
    } else {
      authTitle.textContent = 'Blink 加密书签库已加锁';
      authDesc.textContent = '请输入您的访问密码以解密并查看书签';
      authConfirmGroup.classList.add('hidden');
      authHintGroup.classList.add('hidden');
      if (authStatus.passwordHint) {
        authHintDisplay.textContent = '💡 密码提示: ' + authStatus.passwordHint;
        authHintDisplay.classList.remove('hidden');
      } else {
        authHintDisplay.classList.add('hidden');
      }
      authSubmitBtn.textContent = '立即解密并进入';
    }

    setTimeout(() => authPasswordInput.focus(), 60);
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    authErrorMsg.classList.add('hidden');

    const pwd = authPasswordInput.value;
    const isSetupMode = !authConfirmGroup.classList.contains('hidden');

    if (isSetupMode) {
      const confirmPwd = authConfirmInput.value;
      if (!pwd) {
        showAuthError('密码不能为空');
        return;
      }
      if (pwd !== confirmPwd) {
        showAuthError('两次输入的密码不一致，请重新确认');
        return;
      }
      const res = await window.blinkAPI.setupPassword(pwd, authHintInput.value);
      if (!res.ok) {
        showAuthError(res.error || '设置密码失败');
        return;
      }
      isUnlocked = true;
      appData = await window.blinkAPI.getAllData();
      updateAuthScreen(appData.auth);
      renderAll();
      showToast('🔓 密码设置成功，欢迎使用 Blink！');
    } else {
      const res = await window.blinkAPI.verifyPassword(pwd);
      if (!res.ok) {
        showAuthError(res.error || '密码错误');
        authPasswordInput.select();
        return;
      }
      isUnlocked = true;
      appData = await window.blinkAPI.getAllData();
      updateAuthScreen(appData.auth);
      renderAll();
    }
  }

  function showAuthError(msg) {
    authErrorMsg.textContent = msg;
    authErrorMsg.classList.remove('hidden');
  }

  // ==================== SETTINGS & APPEARANCE ====================
  function applySettingsToUI(settings) {
    if (!settings) return;

    document.body.classList.toggle('theme-light', settings.theme === 'light');
    document.body.classList.toggle('theme-dark', settings.theme !== 'light');
    document.body.classList.toggle('font-large', settings.fontSize === 'large');
    document.body.classList.toggle('font-normal', settings.fontSize !== 'large');

    btnAlwaysOnTop.classList.toggle('active', Boolean(settings.alwaysOnTop));
    btnKeepExpanded.classList.toggle('active', Boolean(settings.keepExpanded));
    btnKeepExpanded.title = settings.keepExpanded
      ? '当前：已锁定展开面板（点击切换为：失去焦点时自动缩回悬浮球）'
      : '当前：点击面板外部自动缩回悬浮球（点击可锁定保持展开）';

    setAlwaysOnTop.checked = Boolean(settings.alwaysOnTop);
    setAutoCollapse.checked = Boolean(settings.autoCollapseOnBlur);
    setFontSize.value = settings.fontSize || 'normal';
    setOpenMode.value = settings.openMode || 'auto';
  }

  function updateBrowserTargetUI(target) {
    currentBrowserTarget = target || { hasTarget: false };
    if (target && target.hasTarget && (target.title || target.friendlyName)) {
      targetStatusDot.classList.remove('inactive');
      targetStatusDot.classList.add('pulse');
      const displayTitle = target.title || target.friendlyName;
      targetBrowserText.textContent = displayTitle;
    } else {
      targetStatusDot.classList.remove('pulse');
      targetStatusDot.classList.add('inactive');
      targetBrowserText.textContent = '默认浏览器（点击任意浏览器窗口即可自动锁定）';
    }
  }

  // ==================== RENDERING ====================
  function renderAll() {
    orbCountBadge.textContent = String(appData.bookmarks.length);
    renderCategories();
    renderBookmarks();
  }

  function getColorHex(colorId) {
    const found = COLORS.find(c => c.id === colorId);
    return found ? found.hex : '#6366f1';
  }

  function getSafeColorId(colorId) {
    const found = COLORS.find(c => c.id === colorId);
    return found ? found.id : 'indigo';
  }

  function renderCategories() {
    const counts = new Map();
    appData.bookmarks.forEach(b => {
      counts.set(b.categoryId, (counts.get(b.categoryId) || 0) + 1);
    });

    let html = `
      <button class="cat-pill ${activeCategoryId === 'ALL' ? 'active' : ''}" data-cat-id="ALL" title="查看全部书签（含未分类书签）">
        <span>全部</span>
        <span class="cat-count">${appData.bookmarks.length}</span>
      </button>
    `;

    appData.categories.forEach(cat => {
      const cnt = counts.get(cat.id) || 0;
      const isActive = activeCategoryId === cat.id;
      const hex = getColorHex(cat.color);
      html += `
        <button class="cat-pill ${isActive ? 'active' : ''}" data-cat-id="${escapeHtml(cat.id)}" title="左键切换分类 · 点击 × 或右键可删除该分类夹">
          <span class="cat-dot" style="background:${hex};box-shadow:0 0 6px ${hex}"></span>
          <span>${escapeHtml(cat.name)}</span>
          <span class="cat-count">${cnt}</span>
          <span class="cat-pill-del" data-del-cat-id="${escapeHtml(cat.id)}" title="删除分类夹「${escapeHtml(cat.name)}」">×</span>
        </button>
      `;
    });

    categoryTabs.innerHTML = html;

    // Bind inline × delete buttons on category pills
    categoryTabs.querySelectorAll('.cat-pill-del').forEach(delBtn => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delId = delBtn.getAttribute('data-del-cat-id');
        if (delId) {
          promptDeleteCategory(delId);
        }
      });
    });

    // Bind click, right-click, and drag-drop onto category pills (for quick cross-category归类)
    categoryTabs.querySelectorAll('.cat-pill').forEach(pill => {
      const catId = pill.getAttribute('data-cat-id');
      pill.addEventListener('click', () => {
        activeCategoryId = catId;
        renderAll();
      });

      if (catId !== 'ALL') {
        pill.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          promptDeleteCategory(catId);
        });
      }

      pill.addEventListener('dragover', (e) => {
        if (!draggedBookmarkId) return;
        e.preventDefault();
        pill.classList.add('cat-drop-target');
      });
      pill.addEventListener('dragleave', () => {
        pill.classList.remove('cat-drop-target');
      });
      pill.addEventListener('drop', async (e) => {
        e.preventDefault();
        pill.classList.remove('cat-drop-target');
        if (!draggedBookmarkId) return;
        const targetCatParam = catId === 'ALL' ? 'UNCATEGORIZED' : catId;
        const res = await window.blinkAPI.reorderBookmarks(draggedBookmarkId, null, targetCatParam);
        if (res.ok) {
          appData = res.data;
          renderAll();
          if (catId === 'ALL') {
            showToast('📁 已设为未分类（保存在「全部」中）');
          } else {
            const targetCat = appData.categories.find(c => c.id === catId);
            showToast(`📁 已归类至「${targetCat ? targetCat.name : '新分类'}」`);
          }
        }
      });
    });

    // Also update category select dropdowns
    const optionsHtml =
      `<option value="">未分类（仅显示在全部中）</option>` +
      appData.categories
        .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
        .join('');
    bmCategorySelect.innerHTML = optionsHtml;
    batchMoveCategorySelect.innerHTML =
      `<option value="">批量移至分类...</option><option value="UNCATEGORIZED">📁 未分类（仅显示在全部）</option>` +
      appData.categories
        .map(c => `<option value="${escapeHtml(c.id)}">📁 ${escapeHtml(c.name)}</option>`)
        .join('');
  }

  function renderColorFilterBar() {
    let html = `
      <button class="color-dot-btn color-dot-all ${activeColorFilter === 'ALL' ? 'active' : ''}" data-color="ALL">
        全色
      </button>
    `;
    COLORS.forEach(c => {
      const isAct = activeColorFilter === c.id;
      html += `
        <button class="color-dot-btn ${isAct ? 'active' : ''}"
                data-color="${c.id}"
                title="筛选${c.name}标记的书签"
                style="background:${c.hex};color:${c.hex}"></button>
      `;
    });
    colorFilterBar.innerHTML = html;

    colorFilterBar.querySelectorAll('.color-dot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.getAttribute('data-color');
        activeColorFilter = (activeColorFilter === col && col !== 'ALL') ? 'ALL' : col;
        renderColorFilterBar();
        renderBookmarks();
      });
    });
  }

  function getFilteredBookmarks() {
    const catMap = new Map(appData.categories.map(c => [c.id, c]));
    const q = searchQuery.trim().toLowerCase();

    return appData.bookmarks
      .filter(bm => {
        if (activeCategoryId !== 'ALL' && bm.categoryId !== activeCategoryId) {
          return false;
        }
        if (activeColorFilter !== 'ALL' && bm.color !== activeColorFilter) {
          return false;
        }
        if (q) {
          const catName = (catMap.get(bm.categoryId)?.name || '未分类').toLowerCase();
          const inTitle = (bm.title || '').toLowerCase().includes(q);
          const inNote = (bm.note || '').toLowerCase().includes(q);
          const inUrl = (bm.url || '').toLowerCase().includes(q);
          const inCat = catName.includes(q);
          return inTitle || inNote || inUrl || inCat;
        }
        return true;
      })
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) {
          return a.pinned ? -1 : 1;
        }
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  function renderBookmarks() {
    const filtered = getFilteredBookmarks();
    const catMap = new Map(appData.categories.map(c => [c.id, c]));

    if (filtered.length === 0) {
      bookmarkList.classList.add('hidden');
      emptyState.classList.remove('hidden');
      if (searchQuery.trim() || activeColorFilter !== 'ALL') {
        emptyTitle.textContent = '没有找到匹配的书签';
        emptySubtitle.textContent = '尝试更换搜索关键词或清除颜色筛选条件';
      } else {
        emptyTitle.textContent = '当前分类下还没有书签';
        emptySubtitle.textContent = '点击右上角「新增」创建书签，或「导入书签」导入谷歌浏览器收藏夹';
      }
      return;
    }

    emptyState.classList.add('hidden');
    bookmarkList.classList.remove('hidden');

    const showCatBadge = activeCategoryId === 'ALL' || Boolean(searchQuery.trim());

    bookmarkList.innerHTML = filtered.map(bm => {
      const cat = catMap.get(bm.categoryId);
      const catBadgeName = cat ? cat.name : '未分类';
      const colorClass = `color-${getSafeColorId(bm.color)}`;
      const isChecked = selectedBookmarkIds.has(bm.id);

      const titleHtml = highlightText(bm.title, searchQuery);
      const noteHtml = bm.note ? highlightText(bm.note, searchQuery) : '';

      return `
        <div class="bookmark-card ${colorClass}"
             draggable="true"
             data-bm-id="${escapeHtml(bm.id)}">

          ${batchMode ? `
            <input type="checkbox" class="bm-batch-check toggle-checkbox" data-id="${escapeHtml(bm.id)}" ${isChecked ? 'checked' : ''} />
          ` : `
            <div class="drag-handle" title="按住上下拖动排序，或拖到上方分类夹归类">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/>
                <circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/>
                <circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/>
              </svg>
            </div>
          `}

          <div class="bm-content">
            <div class="bm-title-row">
              ${bm.pinned ? `<span class="bm-pin-badge" title="已置顶">★</span>` : ''}
              <div class="bm-title">${titleHtml}</div>
            </div>
            ${showCatBadge || noteHtml ? `
              <div class="bm-meta-row">
                ${showCatBadge ? `<span class="bm-cat-tag">${escapeHtml(catBadgeName)}</span>` : ''}
                ${noteHtml ? `<span class="bm-note">${noteHtml}</span>` : ''}
              </div>
            ` : ''}
          </div>

          <div class="bm-actions">
            <button class="bm-act-btn act-top" data-id="${escapeHtml(bm.id)}" title="移到最上面">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            </button>
            <button class="bm-act-btn act-edit" data-id="${escapeHtml(bm.id)}" title="编辑备注/颜色/分类">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </button>
            <button class="bm-act-btn del act-del" data-id="${escapeHtml(bm.id)}" title="删除书签">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    bindBookmarkCardEvents();
  }

  function bindBookmarkCardEvents() {
    const cards = bookmarkList.querySelectorAll('.bookmark-card');

    cards.forEach(card => {
      const bmId = card.getAttribute('data-bm-id');
      const bm = appData.bookmarks.find(b => b.id === bmId);
      if (!bm) return;

      // Click on card opens link in last active browser window (or toggles checkbox in batch mode)
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.bm-actions') || e.target.closest('.drag-handle')) {
          return;
        }
        if (batchMode) {
          if (!e.target.classList.contains('bm-batch-check')) {
            toggleBatchSelection(bmId);
          }
          return;
        }

        const res = await window.blinkAPI.openBookmark(bm.url);
        const targetLabel = (res?.target?.hasTarget && res.target.title)
          ? res.target.title
          : (currentBrowserTarget.hasTarget ? currentBrowserTarget.title : '当前浏览器');
        showToast(`🚀 已在「${targetLabel}」打开: ${bm.title}`);
      });

      // Batch checkbox change
      const chk = card.querySelector('.bm-batch-check');
      if (chk) {
        chk.addEventListener('change', () => {
          toggleBatchSelection(bmId, chk.checked);
        });
      }

      // Move to top button
      const btnTop = card.querySelector('.act-top');
      if (btnTop) {
        btnTop.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await window.blinkAPI.moveBookmarkToTop(bmId);
          if (res.ok) {
            appData = res.data;
            renderAll();
            showToast('⬆️ 已移至列表最上方');
          }
        });
      }

      // Edit button
      const btnEdit = card.querySelector('.act-edit');
      if (btnEdit) {
        btnEdit.addEventListener('click', (e) => {
          e.stopPropagation();
          openBookmarkModal(bm);
        });
      }

      // Delete button
      const btnDel = card.querySelector('.act-del');
      if (btnDel) {
        btnDel.addEventListener('click', async (e) => {
          e.stopPropagation();
          const res = await window.blinkAPI.deleteBookmarks([bmId]);
          if (res.ok) {
            appData = res.data;
            renderAll();
            showToast('🗑️ 已删除书签');
          }
        });
      }

      // Drag and drop sorting
      card.addEventListener('dragstart', (e) => {
        draggedBookmarkId = bmId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', bmId);
      });

      card.addEventListener('dragend', () => {
        draggedBookmarkId = null;
        card.classList.remove('dragging');
        bookmarkList.querySelectorAll('.bookmark-card').forEach(c => {
          c.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      card.addEventListener('dragover', (e) => {
        if (!draggedBookmarkId || draggedBookmarkId === bmId) return;
        e.preventDefault();
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          card.classList.add('drag-over-top');
          card.classList.remove('drag-over-bottom');
        } else {
          card.classList.add('drag-over-bottom');
          card.classList.remove('drag-over-top');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        const placeBefore = card.classList.contains('drag-over-top');
        card.classList.remove('drag-over-top', 'drag-over-bottom');

        if (!draggedBookmarkId || draggedBookmarkId === bmId) return;

        // Compute new global order
        const currentOrdered = [...appData.bookmarks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const fromIdx = currentOrdered.findIndex(b => b.id === draggedBookmarkId);
        if (fromIdx === -1) return;
        const [movedItem] = currentOrdered.splice(fromIdx, 1);

        let toIdx = currentOrdered.findIndex(b => b.id === bmId);
        if (!placeBefore) toIdx += 1;
        currentOrdered.splice(toIdx, 0, movedItem);

        const newOrderedIds = currentOrdered.map(b => b.id);
        const newCatId = (activeCategoryId !== 'ALL') ? activeCategoryId : bm.categoryId;

        const res = await window.blinkAPI.reorderBookmarks(draggedBookmarkId, newOrderedIds, newCatId);
        if (res.ok) {
          appData = res.data;
          renderAll();
        }
      });
    });
  }

  // ==================== BATCH ORGANIZE & DELETE ====================
  function toggleBatchMode(forceState) {
    batchMode = typeof forceState === 'boolean' ? forceState : !batchMode;
    selectedBookmarkIds.clear();
    batchSelectAll.checked = false;
    btnToggleBatch.classList.toggle('active', batchMode);
    batchActionBar.classList.toggle('hidden', !batchMode);
    updateBatchCountLabel();
    renderBookmarks();
  }

  function toggleBatchSelection(bmId, forceChecked) {
    const shouldSelect = typeof forceChecked === 'boolean'
      ? forceChecked
      : !selectedBookmarkIds.has(bmId);

    if (shouldSelect) {
      selectedBookmarkIds.add(bmId);
    } else {
      selectedBookmarkIds.delete(bmId);
    }
    updateBatchCountLabel();
    renderBookmarks();
  }

  function updateBatchCountLabel() {
    batchSelectedCount.textContent = `已选 ${selectedBookmarkIds.size} 项`;
  }

  // ==================== BOOKMARK MODAL ====================
  function renderColorPickers() {
    bmColorPicker.innerHTML = COLORS.map(c => `
      <button type="button" class="color-choice" data-color="${c.id}" style="background:${c.hex}">
        <span>${c.name}</span>
      </button>
    `).join('');

    bmColorPicker.querySelectorAll('.color-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedBmColor = btn.getAttribute('data-color');
        updateColorPickerSelection(bmColorPicker, selectedBmColor);
      });
    });

    catColorPicker.innerHTML = COLORS.map(c => `
      <button type="button" class="color-choice" data-color="${c.id}" title="${c.name}" style="background:${c.hex}"></button>
    `).join('');

    catColorPicker.querySelectorAll('.color-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCatColor = btn.getAttribute('data-color');
        updateColorPickerSelection(catColorPicker, selectedCatColor);
      });
    });
  }

  function updateColorPickerSelection(container, activeColor) {
    container.querySelectorAll('.color-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.getAttribute('data-color') === activeColor);
    });
  }

  function openBookmarkModal(bm = null) {
    if (bm) {
      bmModalTitle.textContent = '编辑书签备注与归类';
      bmIdInput.value = bm.id;
      bmTitleInput.value = bm.title || '';
      bmUrlInput.value = bm.url || '';
      bmNoteInput.value = bm.note || '';
      bmCategorySelect.value = bm.categoryId || '';
      bmPinnedInput.checked = Boolean(bm.pinned);
      selectedBmColor = bm.color || 'indigo';
    } else {
      bmModalTitle.textContent = '新建书签';
      bmIdInput.value = '';
      bmTitleInput.value = '';
      bmUrlInput.value = '';
      bmNoteInput.value = '';
      const defaultCatId = activeCategoryId !== 'ALL'
        ? activeCategoryId
        : (appData.categories[0]?.id || '');
      bmCategorySelect.value = defaultCatId;
      bmPinnedInput.checked = false;
      const defaultCat = appData.categories.find(c => c.id === defaultCatId);
      selectedBmColor = defaultCat?.color || 'indigo';
    }

    updateColorPickerSelection(bmColorPicker, selectedBmColor);
    bookmarkModal.classList.remove('hidden');
    setTimeout(() => bmTitleInput.focus(), 50);
  }

  // ==================== CATEGORY MODAL & DELETION ====================
  function openCategoryModal() {
    resetCategoryForm();
    renderCategoryManageList();
    categoryModal.classList.remove('hidden');
    setTimeout(() => catNameInput.focus(), 50);
  }

  function resetCategoryForm() {
    catIdInput.value = '';
    catNameInput.value = '';
    selectedCatColor = 'indigo';
    updateColorPickerSelection(catColorPicker, selectedCatColor);
    btnSaveCategory.textContent = '+ 添加分类';
    btnCancelCatEdit.classList.add('hidden');
  }

  function renderCategoryManageList() {
    if (!appData.categories || appData.categories.length === 0) {
      categoryManageList.innerHTML = `<div class="helper-note">当前暂无自定义分类夹，所有书签均保存在「全部（未分类）」中。您可以在上方新建分类夹。</div>`;
      return;
    }

    const counts = new Map();
    appData.bookmarks.forEach(b => {
      counts.set(b.categoryId, (counts.get(b.categoryId) || 0) + 1);
    });

    categoryManageList.innerHTML = appData.categories.map(cat => {
      const hex = getColorHex(cat.color);
      const cnt = counts.get(cat.id) || 0;
      return `
        <div class="cat-manage-item">
          <div class="cat-manage-info">
            <span class="cat-dot" style="background:${hex};width:10px;height:10px"></span>
            <span>${escapeHtml(cat.name)}</span>
            <span class="cat-count">(${cnt} 个书签)</span>
          </div>
          <div class="cat-manage-actions">
            <button type="button" class="cat-manage-btn cat-edit-btn" data-id="${escapeHtml(cat.id)}" title="重命名或修改颜色">✎ 编辑</button>
            <button type="button" class="cat-manage-btn del cat-del-btn" data-id="${escapeHtml(cat.id)}" title="删除此分类夹">🗑 删除</button>
          </div>
        </div>
      `;
    }).join('');

    categoryManageList.querySelectorAll('.cat-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const cat = appData.categories.find(c => c.id === id);
        if (!cat) return;
        catIdInput.value = cat.id;
        catNameInput.value = cat.name;
        selectedCatColor = cat.color || 'indigo';
        updateColorPickerSelection(catColorPicker, selectedCatColor);
        btnSaveCategory.textContent = '保存修改';
        btnCancelCatEdit.classList.remove('hidden');
        catNameInput.focus();
      });
    });

    categoryManageList.querySelectorAll('.cat-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          promptDeleteCategory(id);
        }
      });
    });
  }

  function promptDeleteCategory(catId) {
    const cat = appData.categories.find(c => c.id === catId);
    if (!cat) return;

    pendingDeleteCatId = catId;
    const count = appData.bookmarks.filter(b => b.categoryId === catId).length;

    delCatModalTitle.textContent = `删除分类夹「${cat.name}」`;

    if (count > 0) {
      delCatModalDesc.innerHTML = `该分类夹中当前有 <strong>${count} 个书签</strong>，请选择删除该分类夹时的处理方式：`;
      delCatWithItemsBox.classList.remove('hidden');
      delCatEmptyBox.classList.add('hidden');
    } else {
      delCatModalDesc.innerHTML = `分类夹「<strong>${escapeHtml(cat.name)}</strong>」当前为空（没有任何书签），确认直接删除该分类夹吗？`;
      delCatWithItemsBox.classList.add('hidden');
      delCatEmptyBox.classList.remove('hidden');
    }

    deleteCategoryModal.classList.remove('hidden');
  }

  async function executeDeleteCategory(deleteBookmarksInside) {
    if (!pendingDeleteCatId) return;
    const catId = pendingDeleteCatId;
    const cat = appData.categories.find(c => c.id === catId);
    const catName = cat ? cat.name : '分类夹';

    const res = await window.blinkAPI.deleteCategory(catId, Boolean(deleteBookmarksInside));
    if (!res.ok) {
      showToast('❌ ' + (res.error || '删除分类失败'));
      return;
    }

    appData = res.data;
    if (activeCategoryId === catId) {
      activeCategoryId = 'ALL';
    }
    pendingDeleteCatId = null;
    deleteCategoryModal.classList.add('hidden');
    if (catIdInput.value === catId) {
      resetCategoryForm();
    }
    if (!categoryModal.classList.contains('hidden')) {
      renderCategoryManageList();
    }
    renderAll();

    if (deleteBookmarksInside) {
      showToast(`🗑️ 已删除分类夹「${catName}」及其中的所有书签`);
    } else {
      showToast(`📁 已删除分类夹「${catName}」（原书签已保留在「全部」未分类中）`);
    }
  }

  // ==================== BROWSER LIST MODAL ====================
  function renderOpenBrowsersModalList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      openBrowsersList.innerHTML = `<div class="helper-note">暂未检测到已打开的浏览器窗口，请先打开任意浏览器（如 Chrome / Brave / Edge）。</div>`;
      return;
    }

    openBrowsersList.innerHTML = list.map(item => {
      const isAct = String(item.hwnd) === String(currentBrowserTarget.hwnd);
      return `
        <div class="browser-win-item ${isAct ? 'active' : ''}" data-hwnd="${escapeHtml(item.hwnd)}">
          <div>
            <div class="bw-title">${escapeHtml(item.title || item.friendlyName)}</div>
            <div class="bw-sub">${escapeHtml(item.friendlyName)} · 窗口句柄 #${escapeHtml(item.hwnd)}</div>
          </div>
          ${isAct ? `<span class="bm-cat-tag" style="color:#34d399;border-color:#10b981">当前锁定</span>` : `<span class="bm-cat-tag">点击切换</span>`}
        </div>
      `;
    }).join('');

    openBrowsersList.querySelectorAll('.browser-win-item').forEach(row => {
      row.addEventListener('click', async () => {
        const hwnd = row.getAttribute('data-hwnd');
        await window.blinkAPI.selectBrowserTarget(hwnd);
        browserModal.classList.add('hidden');
        showToast('🎯 已切换目标响应浏览器窗口');
      });
    });
  }

  // ==================== IMPORT BOOKMARKS ====================
  async function triggerImportBookmarks(defaultFolder = '') {
    const res = await window.blinkAPI.importBookmarksFromFile(defaultFolder);
    if (!res || res.canceled) return;
    if (!res.ok) {
      showToast('❌ ' + (res.error || '导入失败'));
      return;
    }
    appData = res.data;
    renderAll();
    showToast(`🎉 成功新增导入 ${res.addedBookmarks} 个书签！`);
  }

  // ==================== FLOATING ORB DRAG & EXPAND ====================
  function setupFloatingOrbInteraction() {
    let isDraggingOrb = false;
    let movedDistance = 0;
    let startScreenX = 0;
    let startScreenY = 0;
    let winStartX = 0;
    let winStartY = 0;

    orbView.addEventListener('mousedown', async (e) => {
      if (e.button !== 0) return;
      isDraggingOrb = true;
      movedDistance = 0;
      startScreenX = e.screenX;
      startScreenY = e.screenY;
      const pos = await window.blinkAPI.getWindowPosition();
      winStartX = pos.x;
      winStartY = pos.y;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDraggingOrb) return;
      const dx = e.screenX - startScreenX;
      const dy = e.screenY - startScreenY;
      movedDistance = Math.hypot(dx, dy);
      if (movedDistance > 3) {
        window.blinkAPI.setWindowPosition(winStartX + dx, winStartY + dy);
      }
    });

    window.addEventListener('mouseup', async () => {
      if (!isDraggingOrb) return;
      isDraggingOrb = false;
      if (movedDistance < 6) {
        // Clicked without dragging -> expand to Panel!
        await window.blinkAPI.setWindowMode('panel');
      }
    });
  }

  // ==================== EVENT BINDINGS ====================
  function bindEvents() {
    setupFloatingOrbInteraction();

    authForm.addEventListener('submit', handleAuthSubmit);

    // Titlebar controls
    btnAlwaysOnTop.addEventListener('click', async () => {
      const next = !appData.settings.alwaysOnTop;
      const updated = await window.blinkAPI.setAlwaysOnTop(next);
      appData.settings = updated;
      applySettingsToUI(updated);
      showToast(next ? '📌 已开启窗口始终置顶' : '已取消窗口置顶');
    });

    btnKeepExpanded.addEventListener('click', async () => {
      const next = !appData.settings.keepExpanded;
      const updated = await window.blinkAPI.updateSettings({ keepExpanded: next });
      appData.settings = updated;
      applySettingsToUI(updated);
      showToast(next ? '🔒 已锁定展开状态（不会自动缩回小圆圈）' : '✨ 已开启点击外部自动缩回小圆圈');
    });

    btnCollapseToOrb.addEventListener('click', async () => {
      await window.blinkAPI.setWindowMode('orb');
    });

    btnThemeToggle.addEventListener('click', async () => {
      const nextTheme = appData.settings.theme === 'light' ? 'dark' : 'light';
      const updated = await window.blinkAPI.updateSettings({ theme: nextTheme });
      appData.settings = updated;
      applySettingsToUI(updated);
    });

    btnLockNow.addEventListener('click', async () => {
      await window.blinkAPI.verifyPassword('__LOCK__');
      isUnlocked = false;
      updateAuthScreen(appData.auth);
      showToast('🔒 书签库已安全上锁');
    });

    btnOpenSettings.addEventListener('click', () => {
      changePwdMsg.classList.add('hidden');
      settingsModal.classList.remove('hidden');
    });

    btnCloseApp.addEventListener('click', () => {
      window.blinkAPI.closeWindow();
    });

    // Search
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      btnClearSearch.classList.toggle('hidden', !searchQuery);
      renderBookmarks();
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.classList.add('hidden');
      renderBookmarks();
      searchInput.focus();
    });

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && isUnlocked) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
      }
    });

    // Add Bookmark & Category triggers
    btnAddBookmark.addEventListener('click', () => openBookmarkModal(null));
    btnEmptyAdd.addEventListener('click', () => openBookmarkModal(null));
    btnAddCategory.addEventListener('click', () => openCategoryModal());

    // Mouse wheel horizontal scrolling on category tabs
    categoryTabs.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        categoryTabs.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Quick Import
    btnQuickImport.addEventListener('click', () => triggerImportBookmarks(''));
    btnEmptyImport.addEventListener('click', () => triggerImportBookmarks(''));
    btnSettingsImportFile.addEventListener('click', () => {
      triggerImportBookmarks(importDefaultFolderInput.value.trim());
    });

    // Batch Mode
    btnToggleBatch.addEventListener('click', () => toggleBatchMode());
    btnExitBatch.addEventListener('click', () => toggleBatchMode(false));

    batchSelectAll.addEventListener('change', () => {
      const visible = getFilteredBookmarks();
      if (batchSelectAll.checked) {
        visible.forEach(b => selectedBookmarkIds.add(b.id));
      } else {
        visible.forEach(b => selectedBookmarkIds.delete(b.id));
      }
      updateBatchCountLabel();
      renderBookmarks();
    });

    batchMoveCategorySelect.addEventListener('change', async () => {
      const targetCatId = batchMoveCategorySelect.value;
      if (!targetCatId || selectedBookmarkIds.size === 0) {
        batchMoveCategorySelect.value = '';
        return;
      }
      for (const bmId of selectedBookmarkIds) {
        await window.blinkAPI.reorderBookmarks(bmId, null, targetCatId);
      }
      appData = await window.blinkAPI.getAllData();
      batchMoveCategorySelect.value = '';
      showToast(`📁 已将 ${selectedBookmarkIds.size} 个书签移至所选分类`);
      toggleBatchMode(false);
      renderAll();
    });

    btnBatchDelete.addEventListener('click', async () => {
      if (selectedBookmarkIds.size === 0) {
        showToast('请先勾选需要删除的书签');
        return;
      }
      const count = selectedBookmarkIds.size;
      const res = await window.blinkAPI.deleteBookmarks(Array.from(selectedBookmarkIds));
      if (res.ok) {
        appData = res.data;
        toggleBatchMode(false);
        renderAll();
        showToast(`🗑️ 已批量删除 ${count} 个书签`);
      }
    });

    // Browser Target Bar Modal
    browserTargetBar.addEventListener('click', async () => {
      browserModal.classList.remove('hidden');
      const list = await window.blinkAPI.listOpenBrowsers();
      renderOpenBrowsersModalList(list);
    });

    btnRefreshBrowsers.addEventListener('click', async () => {
      const list = await window.blinkAPI.listOpenBrowsers();
      renderOpenBrowsersModalList(list);
    });

    // Bookmark Form Submit
    bookmarkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        id: bmIdInput.value || undefined,
        title: bmTitleInput.value.trim(),
        url: bmUrlInput.value.trim(),
        note: bmNoteInput.value.trim(),
        categoryId: bmCategorySelect.value,
        pinned: bmPinnedInput.checked,
        color: selectedBmColor
      };
      const res = await window.blinkAPI.saveBookmark(payload);
      if (!res.ok) {
        showToast('❌ ' + (res.error || '保存失败'));
        return;
      }
      appData = res.data;
      bookmarkModal.classList.add('hidden');
      renderAll();
      showToast('✅ 书签已保存');
    });

    // Category Form Submit
    categoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        id: catIdInput.value || undefined,
        name: catNameInput.value.trim(),
        color: selectedCatColor
      };
      const res = await window.blinkAPI.saveCategory(payload);
      if (!res.ok) {
        showToast('❌ ' + (res.error || '保存分类失败'));
        return;
      }
      appData = res.data;
      resetCategoryForm();
      renderCategoryManageList();
      renderAll();
      showToast('✅ 分类已保存');
    });

    btnCancelCatEdit.addEventListener('click', () => resetCategoryForm());

    if (btnDelCatKeepBm) {
      btnDelCatKeepBm.addEventListener('click', () => executeDeleteCategory(false));
    }
    if (btnDelCatRemoveBm) {
      btnDelCatRemoveBm.addEventListener('click', () => executeDeleteCategory(true));
    }
    if (btnDelCatEmptyConfirm) {
      btnDelCatEmptyConfirm.addEventListener('click', () => executeDeleteCategory(false));
    }

    // Settings Controls
    setAlwaysOnTop.addEventListener('change', async () => {
      const updated = await window.blinkAPI.setAlwaysOnTop(setAlwaysOnTop.checked);
      appData.settings = updated;
      applySettingsToUI(updated);
    });

    setAutoCollapse.addEventListener('change', async () => {
      const updated = await window.blinkAPI.updateSettings({
        autoCollapseOnBlur: setAutoCollapse.checked
      });
      appData.settings = updated;
      applySettingsToUI(updated);
    });

    setFontSize.addEventListener('change', async () => {
      const updated = await window.blinkAPI.updateSettings({
        fontSize: setFontSize.value
      });
      appData.settings = updated;
      applySettingsToUI(updated);
    });

    setOpenMode.addEventListener('change', async () => {
      const updated = await window.blinkAPI.updateSettings({
        openMode: setOpenMode.value
      });
      appData.settings = updated;
      applySettingsToUI(updated);
    });

    // Change Password Form
    changePwdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      changePwdMsg.classList.add('hidden');
      const oldPwd = oldPwdInput.value;
      const newPwd = newPwdInput.value;
      const confirmNew = confirmNewPwdInput.value;
      const newHint = newPwdHintInput.value.trim();

      if (newPwd !== confirmNew) {
        changePwdMsg.textContent = '两次输入的新密码不一致';
        changePwdMsg.className = 'pwd-msg err';
        return;
      }

      const res = await window.blinkAPI.changePassword(oldPwd, newPwd, newHint);
      if (!res.ok) {
        changePwdMsg.textContent = res.error || '修改密码失败';
        changePwdMsg.className = 'pwd-msg err';
        return;
      }

      oldPwdInput.value = '';
      newPwdInput.value = '';
      confirmNewPwdInput.value = '';
      changePwdMsg.textContent = '✅ 密码修改成功！下次启动将使用新密码。';
      changePwdMsg.className = 'pwd-msg ok';
      appData = await window.blinkAPI.getAllData();
      showToast('🔐 密码修改成功');
    });

    // Close modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-close');
        document.getElementById(targetId)?.classList.add('hidden');
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          backdrop.classList.add('hidden');
        }
      });
    });
  }

  // ==================== UTILITIES ====================
  function showToast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 2400);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlightText(text, query) {
    const safe = escapeHtml(text);
    const q = (query || '').trim();
    if (!q) return safe;
    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${escapedQ})`, 'gi'), '<mark class="hl">$1</mark>');
  }

  init();
})();
