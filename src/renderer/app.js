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
      closeToOrb: true,
      openMode: 'auto',
      fontSize: 'normal',
      fontScale: 100
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

  let currentAppVersion = '1.0.2';
  let latestUpdateInfo = null;
  let suppressNextCatClick = false;
  let suppressNextBmClick = false;
  let catDragState = null;
  let bmDragState = null;

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
  const btnVersionBadge = document.getElementById('btnVersionBadge');

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
  const btnQuickExport = document.getElementById('btnQuickExport');
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
  const settingsCurrentVer = document.getElementById('settingsCurrentVer');
  const btnCheckUpdate = document.getElementById('btnCheckUpdate');
  const updateStatusBox = document.getElementById('updateStatusBox');
  const updateStatusText = document.getElementById('updateStatusText');
  const updateNotesBox = document.getElementById('updateNotesBox');
  const updateProgressWrap = document.getElementById('updateProgressWrap');
  const updateProgressBar = document.getElementById('updateProgressBar');
  const updateProgressText = document.getElementById('updateProgressText');
  const btnPerformUpdate = document.getElementById('btnPerformUpdate');
  const importDefaultFolderInput = document.getElementById('importDefaultFolderInput');
  const btnSettingsExportFile = document.getElementById('btnSettingsExportFile');
  const btnSettingsImportFile = document.getElementById('btnSettingsImportFile');
  const setAlwaysOnTop = document.getElementById('setAlwaysOnTop');
  const setAutoCollapse = document.getElementById('setAutoCollapse');
  const setCloseToOrb = document.getElementById('setCloseToOrb');
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

    const [authStatus, fullData, targetInfo, versionInfo] = await Promise.all([
      window.blinkAPI.getAuthStatus(),
      window.blinkAPI.getAllData(),
      window.blinkAPI.getBrowserTarget(),
      window.blinkAPI.getAppVersion ? window.blinkAPI.getAppVersion() : Promise.resolve({ version: '1.0.1' })
    ]);

    if (versionInfo && versionInfo.version) {
      currentAppVersion = versionInfo.version;
      if (btnVersionBadge) btnVersionBadge.textContent = `v${currentAppVersion}`;
      if (settingsCurrentVer) settingsCurrentVer.textContent = `v${currentAppVersion}`;
    }

    appData = fullData;
    isUnlocked = Boolean(authStatus.isUnlocked);
    applySettingsToUI(appData.settings);
    updateBrowserTargetUI(targetInfo);
    updateAuthScreen(authStatus);
    if (isUnlocked) {
      renderAll();
      setTimeout(() => handleCheckUpdate(true), 2500);
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

    if (window.blinkAPI.onUpdateProgress) {
      window.blinkAPI.onUpdateProgress((prog) => {
        if (!prog || !updateProgressWrap) return;
        updateProgressWrap.classList.remove('hidden');
        const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
        if (updateProgressBar) updateProgressBar.style.width = `${pct}%`;
        if (updateProgressText) {
          if (prog.stage === 'installing') {
            updateProgressText.textContent = '✅ 下载完成，正在备份书签并启动安装程序，即将自动重启...';
          } else {
            updateProgressText.textContent = `正在下载新版本安装包... ${pct}% (${prog.downloadedMb || 0} MB / ${prog.totalMb || '...'} MB)`;
          }
        }
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
      setTimeout(() => handleCheckUpdate(true), 2500);
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
      setTimeout(() => handleCheckUpdate(true), 2500);
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

    const rawScale = Number.isFinite(settings.fontScale)
      ? settings.fontScale
      : (settings.fontSize === 'large' ? 115 : 100);
    const fontScale = Math.max(70, Math.min(180, Math.round(rawScale)));
    const ratio = fontScale / 100;

    document.body.classList.toggle('font-large', fontScale >= 110);
    document.body.classList.toggle('font-normal', fontScale < 110);

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--bm-title-size', `${(15 * ratio).toFixed(2)}px`);
    rootStyle.setProperty('--bm-note-size', `${(12.5 * ratio).toFixed(2)}px`);
    rootStyle.setProperty('--cat-pill-size', `${(12.5 * ratio).toFixed(2)}px`);
    rootStyle.setProperty('--bm-tag-size', `${(10.5 * ratio).toFixed(2)}px`);
    rootStyle.setProperty('--search-font-size', `${(13 * ratio).toFixed(2)}px`);

    btnAlwaysOnTop.classList.toggle('active', Boolean(settings.alwaysOnTop));
    btnKeepExpanded.classList.toggle('active', Boolean(settings.keepExpanded));
    btnKeepExpanded.title = settings.keepExpanded
      ? '当前：已锁定展开面板（点击切换为：失去焦点时自动缩回悬浮球）'
      : '当前：点击面板外部自动缩回悬浮球（点击可锁定保持展开）';

    const closeToOrb = settings.closeToOrb !== false;
    if (setCloseToOrb) {
      setCloseToOrb.checked = closeToOrb;
    }
    if (btnCloseApp) {
      btnCloseApp.title = closeToOrb
        ? '缩小为小悬浮球（可在设置中改为直接关闭软件）'
        : '退出软件';
    }

    setAlwaysOnTop.checked = Boolean(settings.alwaysOnTop);
    setAutoCollapse.checked = Boolean(settings.autoCollapseOnBlur);

    if (setFontSize) {
      const strScale = String(fontScale);
      const hasPreset = Array.from(setFontSize.options).some(
        opt => opt.value === strScale && opt.id !== 'customFontScaleOpt'
      );
      let customOpt = document.getElementById('customFontScaleOpt');
      if (!hasPreset) {
        if (!customOpt) {
          customOpt = document.createElement('option');
          customOpt.id = 'customFontScaleOpt';
          setFontSize.appendChild(customOpt);
        }
        customOpt.value = strScale;
        customOpt.textContent = `滚轮自定义 (${fontScale}%)`;
      } else if (customOpt) {
        customOpt.remove();
      }
      setFontSize.value = strScale;
    }

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
        <button class="cat-pill cat-pill-movable ${isActive ? 'active' : ''}" data-cat-id="${escapeHtml(cat.id)}" title="左键切换分类 · 按住可左右拖动调整分类顺序 · 右键或点 × 删除分类">
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
      delBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delId = delBtn.getAttribute('data-del-cat-id');
        if (delId) {
          promptDeleteCategory(delId);
        }
      });
    });

    // Bind click, right-click, and horizontal pointer drag-reorder on category pills (随时可左右拖动排序)
    categoryTabs.querySelectorAll('.cat-pill').forEach(pill => {
      const catId = pill.getAttribute('data-cat-id');
      pill.addEventListener('click', (e) => {
        if (suppressNextCatClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        activeCategoryId = catId;
        renderAll();
      });

      if (catId !== 'ALL') {
        pill.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          promptDeleteCategory(catId);
        });

        pill.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || e.target.closest('.cat-pill-del')) return;
          const initialOrder = Array.from(categoryTabs.querySelectorAll('.cat-pill'))
            .map(el => el.getAttribute('data-cat-id'))
            .filter(id => id && id !== 'ALL');

          catDragState = {
            pill,
            catId,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            initialOrder
          };
        });
      }
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
        <div class="bookmark-card ${colorClass} ${batchMode ? 'organize-mode' : ''}"
             data-bm-id="${escapeHtml(bm.id)}"
             title="${batchMode ? '整理模式：按住卡片可上下拖动排序，或拖到上方分类夹归类' : '点击在目标浏览器中打开此书签'}">

          ${batchMode ? `
            <div class="drag-handle" title="按住上下拖动调整顺序，或拖到上方分类夹归类">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/>
                <circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/>
                <circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/>
              </svg>
            </div>
            <input type="checkbox" class="bm-batch-check toggle-checkbox" data-id="${escapeHtml(bm.id)}" ${isChecked ? 'checked' : ''} title="勾选以批量移动或删除" />
          ` : ''}

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
            <button class="bm-act-btn act-copy" data-id="${escapeHtml(bm.id)}" title="复制书签链接">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
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

      // Click on card opens link ONLY when NOT in organize (batchMode) mode
      card.addEventListener('click', async (e) => {
        if (suppressNextBmClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
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
        chk.addEventListener('mousedown', (e) => e.stopPropagation());
        chk.addEventListener('change', () => {
          toggleBatchSelection(bmId, chk.checked);
        });
      }

      // Copy link button
      const btnCopy = card.querySelector('.act-copy');
      if (btnCopy) {
        btnCopy.addEventListener('mousedown', (e) => e.stopPropagation());
        btnCopy.addEventListener('click', async (e) => {
          e.stopPropagation();
          let copiedOk = false;
          if (window.blinkAPI.copyBookmarkUrl) {
            const res = await window.blinkAPI.copyBookmarkUrl(bm.url);
            copiedOk = Boolean(res && res.ok);
          }
          if (!copiedOk && navigator.clipboard && navigator.clipboard.writeText) {
            try {
              await navigator.clipboard.writeText(bm.url);
              copiedOk = true;
            } catch {}
          }
          if (copiedOk) {
            btnCopy.classList.add('copied');
            const origHtml = btnCopy.innerHTML;
            btnCopy.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            `;
            setTimeout(() => {
              btnCopy.classList.remove('copied');
              btnCopy.innerHTML = origHtml;
            }, 1200);
            showToast(`📋 已复制链接：${bm.title}`);
          } else {
            showToast('❌ 复制链接失败');
          }
        });
      }

      // Move to top button
      const btnTop = card.querySelector('.act-top');
      if (btnTop) {
        btnTop.addEventListener('mousedown', (e) => e.stopPropagation());
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
        btnEdit.addEventListener('mousedown', (e) => e.stopPropagation());
        btnEdit.addEventListener('click', (e) => {
          e.stopPropagation();
          openBookmarkModal(bm);
        });
      }

      // Delete button
      const btnDel = card.querySelector('.act-del');
      if (btnDel) {
        btnDel.addEventListener('mousedown', (e) => e.stopPropagation());
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

      // Pointer-based up/down drag sorting (ONLY enabled when user turns on "整理" mode)
      card.addEventListener('mousedown', (e) => {
        if (!batchMode) return;
        if (e.button !== 0) return;
        if (e.target.closest('.bm-actions') || e.target.classList.contains('bm-batch-check')) {
          return;
        }

        const initialOrder = Array.from(bookmarkList.querySelectorAll('.bookmark-card'))
          .map(el => el.getAttribute('data-bm-id'))
          .filter(Boolean);

        bmDragState = {
          card,
          bmId,
          startX: e.clientX,
          startY: e.clientY,
          active: false,
          hoveredCatPill: null,
          initialOrder
        };
      });
    });
  }

  // ==================== BATCH ORGANIZE & DELETE ====================
  function toggleBatchMode(forceState) {
    batchMode = typeof forceState === 'boolean' ? forceState : !batchMode;
    selectedBookmarkIds.clear();
    batchSelectAll.checked = false;
    btnToggleBatch.classList.toggle('active', batchMode);
    btnToggleBatch.textContent = batchMode ? '✓ 完成整理' : '⇅ 整理';
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

    categoryManageList.innerHTML = appData.categories.map((cat, idx) => {
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
            <button type="button" class="cat-manage-btn cat-move-up" data-idx="${idx}" title="左移/上移分类" ${idx === 0 ? 'disabled style="opacity:0.35;cursor:default"' : ''}>↑</button>
            <button type="button" class="cat-manage-btn cat-move-down" data-idx="${idx}" title="右移/下移分类" ${idx === appData.categories.length - 1 ? 'disabled style="opacity:0.35;cursor:default"' : ''}>↓</button>
            <button type="button" class="cat-manage-btn cat-edit-btn" data-id="${escapeHtml(cat.id)}" title="重命名或修改颜色">✎ 编辑</button>
            <button type="button" class="cat-manage-btn del cat-del-btn" data-id="${escapeHtml(cat.id)}" title="删除此分类夹">🗑 删除</button>
          </div>
        </div>
      `;
    }).join('');

    const moveCategoryAtIndex = async (fromIdx, toIdx) => {
      if (toIdx < 0 || toIdx >= appData.categories.length) return;
      const ids = appData.categories.map(c => c.id);
      const [moved] = ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, moved);
      const res = await window.blinkAPI.reorderCategories(ids);
      if (res && res.ok) {
        appData = res.data;
        renderCategoryManageList();
        renderAll();
      }
    };

    categoryManageList.querySelectorAll('.cat-move-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        moveCategoryAtIndex(idx, idx - 1);
      });
    });

    categoryManageList.querySelectorAll('.cat-move-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        moveCategoryAtIndex(idx, idx + 1);
      });
    });

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

  // ==================== IMPORT & EXPORT BOOKMARKS ====================
  async function triggerImportBookmarks(defaultFolder = '') {
    const res = await window.blinkAPI.importBookmarksFromFile(defaultFolder);
    if (!res || res.canceled) return;
    if (!res.ok) {
      showToast('❌ ' + (res.error || '导入失败'));
      return;
    }
    appData = res.data;
    renderAll();
    const catNote = res.addedCategories > 0 ? `（含 ${res.addedCategories} 个分类夹）` : '';
    showToast(`🎉 成功导入 ${res.addedBookmarks} 个书签${catNote}！`);
  }

  async function triggerExportBookmarks() {
    if (!window.blinkAPI.exportBookmarksToFile) return;
    const res = await window.blinkAPI.exportBookmarksToFile();
    if (!res || res.canceled) return;
    if (!res.ok) {
      showToast('❌ ' + (res.error || '导出失败'));
      return;
    }
    showToast(`📤 已成功导出 ${res.exportedBookmarks} 个书签！复制到新电脑点击「导入」即可恢复`);
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

  // ==================== PHYSICS-BASED POINTER DRAG SORTING ====================
  // 包含：1. 悬浮放大跟随卡片 (Magnified Floating Avatar + 惯性微倾角)
  //       2. 临近上下/左右元素自动缩小退让 (Proximity Neighbor Scale-Down)
  //       3. FLIP 丝滑换位过渡动画 (First-Last-Invert-Play Smooth Swap)
  //       4. 松手磁吸回落动画 (Magnetic Snap-to-Slot Landing)
  function clearBookmarkNeighborEffects() {
    bookmarkList.querySelectorAll('.bookmark-card').forEach(c => {
      c.style.removeProperty('--neighbor-scale');
      c.style.removeProperty('--neighbor-opacity');
      c.style.removeProperty('--flip-y');
      c.classList.remove('bm-neighbor-immediate');
    });
  }

  function clearCategoryNeighborEffects() {
    categoryTabs.querySelectorAll('.cat-pill').forEach(p => {
      p.style.removeProperty('--neighbor-scale');
      p.style.removeProperty('--neighbor-opacity');
      p.style.removeProperty('--flip-x');
      p.classList.remove('cat-neighbor-immediate');
    });
  }

  function setupPointerDragSorting() {
    window.addEventListener('mousemove', (e) => {
      // 1. Horizontal Category Reordering (随时可左右拖动分类 · 悬浮放大 + 左右邻近分类缩小退让 + FLIP 丝滑换位)
      if (catDragState && catDragState.pill) {
        const dx = Math.abs(e.clientX - catDragState.startX);
        if (!catDragState.active && dx > 4) {
          catDragState.active = true;
          const rect = catDragState.pill.getBoundingClientRect();
          catDragState.offsetX = catDragState.startX - rect.left;
          catDragState.offsetY = catDragState.startY - rect.top;
          catDragState.lastX = e.clientX;
          catDragState.tilt = 0;
          catDragState.lastSwapTime = 0;

          const avatar = catDragState.pill.cloneNode(true);
          avatar.classList.add('drag-floating-avatar', 'cat-avatar');
          avatar.style.width = `${rect.width}px`;
          avatar.style.height = `${rect.height}px`;
          document.body.appendChild(avatar);
          catDragState.avatar = avatar;

          catDragState.pill.classList.add('cat-pill-placeholder');
          document.body.classList.add('is-dragging-cat');
        }

        if (catDragState.active) {
          // Update magnified floating category pill position & velocity tilt
          const vx = e.clientX - (catDragState.lastX ?? e.clientX);
          catDragState.lastX = e.clientX;
          catDragState.tilt = (catDragState.tilt || 0) * 0.65 + Math.max(-4, Math.min(4, vx * 0.25)) * 0.35;
          const ax = e.clientX - catDragState.offsetX;
          const ay = e.clientY - catDragState.offsetY;
          if (catDragState.avatar) {
            catDragState.avatar.style.transform = `translate3d(${ax}px, ${ay}px, 0) scale(1.13) rotate(${catDragState.tilt.toFixed(2)}deg)`;
          }

          const barRect = categoryTabs.getBoundingClientRect();
          if (e.clientX < barRect.left + 36) {
            categoryTabs.scrollLeft -= 8;
          } else if (e.clientX > barRect.right - 36) {
            categoryTabs.scrollLeft += 8;
          }

          const movablePills = Array.from(categoryTabs.querySelectorAll('.cat-pill')).filter(
            el => el.getAttribute('data-cat-id') !== 'ALL'
          );
          const myIdx = movablePills.indexOf(catDragState.pill);
          const now = Date.now();

          if (myIdx !== -1 && now - (catDragState.lastSwapTime || 0) > 65) {
            for (let i = 0; i < movablePills.length; i++) {
              const sib = movablePills[i];
              if (sib === catDragState.pill) continue;
              const rect = sib.getBoundingClientRect();
              const midX = rect.left + rect.width / 2;
              if ((myIdx < i && e.clientX > midX) || (myIdx > i && e.clientX < midX)) {
                // FLIP First: record old left positions
                const prevLefts = new Map();
                movablePills.forEach(p => {
                  if (p !== catDragState.pill) prevLefts.set(p, p.getBoundingClientRect().left);
                });

                // FLIP Last: swap in DOM
                if (myIdx < i) {
                  sib.after(catDragState.pill);
                } else {
                  sib.before(catDragState.pill);
                }

                // FLIP Invert & Play
                prevLefts.forEach((oldLeft, p) => {
                  const newLeft = p.getBoundingClientRect().left;
                  const deltaX = oldLeft - newLeft;
                  if (Math.abs(deltaX) > 1) {
                    p.style.transition = 'none';
                    p.style.setProperty('--flip-x', `${deltaX}px`);
                    void p.offsetWidth;
                    p.style.transition = '';
                    p.style.setProperty('--flip-x', '0px');
                  }
                });

                catDragState.lastSwapTime = now;
                break;
              }
            }
          }

          // Proximity scale-down on adjacent left/right category pills
          const updatedPills = Array.from(categoryTabs.querySelectorAll('.cat-pill')).filter(
            el => el.getAttribute('data-cat-id') !== 'ALL'
          );
          const slotIdx = updatedPills.indexOf(catDragState.pill);
          updatedPills.forEach((p, idx) => {
            if (p === catDragState.pill) return;
            const diff = Math.abs(idx - slotIdx);
            if (diff === 1) {
              p.style.setProperty('--neighbor-scale', '0.91');
              p.style.setProperty('--neighbor-opacity', '0.82');
              p.classList.add('cat-neighbor-immediate');
            } else if (diff === 2) {
              p.style.setProperty('--neighbor-scale', '0.96');
              p.style.setProperty('--neighbor-opacity', '0.92');
              p.classList.remove('cat-neighbor-immediate');
            } else {
              p.style.setProperty('--neighbor-scale', '1');
              p.style.setProperty('--neighbor-opacity', '1');
              p.classList.remove('cat-neighbor-immediate');
            }
          });
        }
        return;
      }

      // 2. Vertical Bookmark Reordering (开启「整理」后：拖拽项放大悬浮 + 临近上下书签自动缩小退让 + FLIP 丝滑换位)
      if (bmDragState && bmDragState.card && batchMode) {
        const dist = Math.hypot(e.clientX - bmDragState.startX, e.clientY - bmDragState.startY);
        if (!bmDragState.active && dist > 4) {
          bmDragState.active = true;
          const rect = bmDragState.card.getBoundingClientRect();
          bmDragState.offsetX = bmDragState.startX - rect.left;
          bmDragState.offsetY = bmDragState.startY - rect.top;
          bmDragState.lastY = e.clientY;
          bmDragState.tilt = 0;
          bmDragState.lastSwapTime = 0;

          const avatar = bmDragState.card.cloneNode(true);
          avatar.classList.add('drag-floating-avatar', 'bm-avatar');
          avatar.style.width = `${rect.width}px`;
          avatar.style.height = `${rect.height}px`;
          document.body.appendChild(avatar);
          bmDragState.avatar = avatar;

          bmDragState.card.classList.add('bm-card-placeholder');
          document.body.classList.add('is-dragging-bm');
        }

        if (bmDragState.active) {
          // Check if pointer is hovering over a category pill at the top
          categoryTabs.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('cat-drop-target'));
          const elUnder = document.elementFromPoint(e.clientX, e.clientY);
          const hoveredPill = elUnder ? elUnder.closest('.cat-pill') : null;

          // Update floating magnified card position & physical velocity tilt
          const vy = e.clientY - (bmDragState.lastY ?? e.clientY);
          bmDragState.lastY = e.clientY;
          bmDragState.tilt = (bmDragState.tilt || 0) * 0.65 + Math.max(-2.8, Math.min(2.8, vy * 0.2)) * 0.35;
          const ax = e.clientX - bmDragState.offsetX;
          const ay = e.clientY - bmDragState.offsetY;
          const avatarScale = hoveredPill ? 0.92 : 1.068;
          if (bmDragState.avatar) {
            bmDragState.avatar.style.transform = `translate3d(${ax}px, ${ay}px, 0) scale(${avatarScale}) rotate(${bmDragState.tilt.toFixed(2)}deg)`;
          }

          if (hoveredPill) {
            hoveredPill.classList.add('cat-drop-target');
            bmDragState.hoveredCatPill = hoveredPill;
            clearBookmarkNeighborEffects();
            return;
          }
          bmDragState.hoveredCatPill = null;

          // Auto-scroll bookmarkList when dragging near top or bottom edges
          const listRect = bookmarkList.getBoundingClientRect();
          if (e.clientY < listRect.top + 46) {
            bookmarkList.scrollTop -= 10;
          } else if (e.clientY > listRect.bottom - 46) {
            bookmarkList.scrollTop += 10;
          }

          const cards = Array.from(bookmarkList.querySelectorAll('.bookmark-card'));
          const myIdx = cards.indexOf(bmDragState.card);
          const now = Date.now();

          if (myIdx !== -1 && now - (bmDragState.lastSwapTime || 0) > 65) {
            for (let i = 0; i < cards.length; i++) {
              const sib = cards[i];
              if (sib === bmDragState.card) continue;
              const rect = sib.getBoundingClientRect();
              const midY = rect.top + rect.height / 2;
              if ((myIdx < i && e.clientY > midY) || (myIdx > i && e.clientY < midY)) {
                // FLIP First: record old top positions of all sibling cards
                const prevTops = new Map();
                cards.forEach(c => {
                  if (c !== bmDragState.card) prevTops.set(c, c.getBoundingClientRect().top);
                });

                // FLIP Last: move placeholder in DOM
                if (myIdx < i) {
                  sib.after(bmDragState.card);
                } else {
                  sib.before(bmDragState.card);
                }

                // FLIP Invert & Play: smoothly glide swapped siblings
                prevTops.forEach((oldTop, c) => {
                  const newTop = c.getBoundingClientRect().top;
                  const deltaY = oldTop - newTop;
                  if (Math.abs(deltaY) > 1) {
                    c.style.transition = 'none';
                    c.style.setProperty('--flip-y', `${deltaY}px`);
                    void c.offsetHeight;
                    c.style.transition = '';
                    c.style.setProperty('--flip-y', '0px');
                  }
                });

                bmDragState.lastSwapTime = now;
                break;
              }
            }
          }

          // Proximity Neighbor Scale-Down (临近的上下书签卡片自动缩小退让)
          const updatedCards = Array.from(bookmarkList.querySelectorAll('.bookmark-card'));
          const slotIdx = updatedCards.indexOf(bmDragState.card);
          updatedCards.forEach((c, idx) => {
            if (c === bmDragState.card) return;
            const cRect = c.getBoundingClientRect();
            const cCenterY = cRect.top + cRect.height / 2;
            const distY = Math.abs(e.clientY - cCenterY);
            const idxDiff = Math.abs(idx - slotIdx);

            if (idxDiff === 1) {
              // Immediate upper & lower neighbors shrink noticeably to yield space
              const proximityBoost = Math.max(0, 1 - distY / 110) * 0.022;
              const scaleVal = (0.942 - proximityBoost).toFixed(3);
              c.style.setProperty('--neighbor-scale', scaleVal);
              c.style.setProperty('--neighbor-opacity', '0.82');
              c.classList.add('bm-neighbor-immediate');
            } else if (idxDiff === 2) {
              c.style.setProperty('--neighbor-scale', '0.974');
              c.style.setProperty('--neighbor-opacity', '0.92');
              c.classList.remove('bm-neighbor-immediate');
            } else {
              c.style.setProperty('--neighbor-scale', '1');
              c.style.setProperty('--neighbor-opacity', '1');
              c.classList.remove('bm-neighbor-immediate');
            }
          });
        }
      }
    });

    window.addEventListener('mouseup', async () => {
      // Finish Category Drag with smooth magnetic snap-to-slot landing
      if (catDragState) {
        const state = catDragState;
        catDragState = null;
        if (state.active && state.pill) {
          suppressNextCatClick = true;
          setTimeout(() => { suppressNextCatClick = false; }, 140);
          clearCategoryNeighborEffects();

          const newOrderedIds = Array.from(categoryTabs.querySelectorAll('.cat-pill'))
            .map(el => el.getAttribute('data-cat-id'))
            .filter(id => id && id !== 'ALL');

          const changed = newOrderedIds.length === state.initialOrder.length &&
            newOrderedIds.some((id, idx) => id !== state.initialOrder[idx]);

          if (state.avatar) {
            const targetRect = state.pill.getBoundingClientRect();
            state.avatar.style.transition = 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease';
            state.avatar.style.transform = `translate3d(${targetRect.left}px, ${targetRect.top}px, 0) scale(1) rotate(0deg)`;
            await new Promise(r => setTimeout(r, 175));
            state.avatar.remove();
          }

          state.pill.classList.remove('cat-pill-placeholder');
          document.body.classList.remove('is-dragging-cat');

          if (changed) {
            const res = await window.blinkAPI.reorderCategories(newOrderedIds);
            if (res && res.ok) {
              appData = res.data;
              renderAll();
              showToast('↔️ 分类顺序已保存');
            }
          }
        }
      }

      // Finish Bookmark Drag with smooth magnetic snap-to-slot landing
      if (bmDragState) {
        const state = bmDragState;
        bmDragState = null;
        if (state.active && state.card) {
          suppressNextBmClick = true;
          setTimeout(() => { suppressNextBmClick = false; }, 140);
          categoryTabs.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('cat-drop-target'));
          clearBookmarkNeighborEffects();

          if (state.hoveredCatPill) {
            if (state.avatar) {
              const pillRect = state.hoveredCatPill.getBoundingClientRect();
              state.avatar.style.transition = 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease';
              state.avatar.style.transform = `translate3d(${pillRect.left}px, ${pillRect.top}px, 0) scale(0.35)`;
              state.avatar.style.opacity = '0';
              await new Promise(r => setTimeout(r, 175));
              state.avatar.remove();
            }
            state.card.classList.remove('bm-card-placeholder');
            document.body.classList.remove('is-dragging-bm');

            const targetCatId = state.hoveredCatPill.getAttribute('data-cat-id');
            const targetCatParam = targetCatId === 'ALL' ? 'UNCATEGORIZED' : targetCatId;
            const res = await window.blinkAPI.reorderBookmarks(state.bmId, null, targetCatParam);
            if (res && res.ok) {
              appData = res.data;
              renderAll();
              if (targetCatId === 'ALL') {
                showToast('📁 已设为未分类（保存在「全部」中）');
              } else {
                const targetCat = appData.categories.find(c => c.id === targetCatId);
                showToast(`📁 已归类至「${targetCat ? targetCat.name : '新分类'}」`);
              }
            }
          } else {
            const newOrderedIds = Array.from(bookmarkList.querySelectorAll('.bookmark-card'))
              .map(el => el.getAttribute('data-bm-id'))
              .filter(Boolean);

            const changed = newOrderedIds.length === state.initialOrder.length &&
              newOrderedIds.some((id, idx) => id !== state.initialOrder[idx]);

            if (state.avatar) {
              const slotRect = state.card.getBoundingClientRect();
              state.avatar.style.transition = 'transform 0.19s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.19s ease';
              state.avatar.style.transform = `translate3d(${slotRect.left}px, ${slotRect.top}px, 0) scale(1) rotate(0deg)`;
              await new Promise(r => setTimeout(r, 185));
              state.avatar.remove();
            }

            state.card.classList.remove('bm-card-placeholder');
            document.body.classList.remove('is-dragging-bm');

            if (changed) {
              const res = await window.blinkAPI.reorderBookmarks(state.bmId, newOrderedIds, null);
              if (res && res.ok) {
                appData = res.data;
                renderAll();
                showToast('↕️ 书签排序已保存');
              }
            }
          }
        }
      }
    });
  }

  // ==================== GITHUB AUTO-UPDATE ====================
  async function handleCheckUpdate(silent = false) {
    if (!window.blinkAPI.checkForUpdates) return;

    if (!silent) {
      if (btnCheckUpdate) {
        btnCheckUpdate.disabled = true;
        btnCheckUpdate.textContent = '正在检测...';
      }
      if (updateStatusBox) updateStatusBox.classList.remove('hidden');
      if (updateStatusText) updateStatusText.textContent = '🔄 正在连接 GitHub Releases 检测最新版本...';
      if (updateNotesBox) updateNotesBox.classList.add('hidden');
      if (btnPerformUpdate) btnPerformUpdate.classList.add('hidden');
    }

    try {
      const res = await window.blinkAPI.checkForUpdates();
      if (btnCheckUpdate) {
        btnCheckUpdate.disabled = false;
        btnCheckUpdate.textContent = '🔍 检测更新';
      }

      if (!res || !res.ok) {
        if (!silent) {
          if (updateStatusBox) updateStatusBox.classList.remove('hidden');
          if (updateStatusText) {
            updateStatusText.textContent = '⚠️ ' + (res?.error || '检测更新失败，请稍后重试');
          }
          showToast('⚠️ ' + (res?.error || '检测更新失败'));
        }
        return;
      }

      currentAppVersion = res.currentVersion || currentAppVersion;
      if (settingsCurrentVer) settingsCurrentVer.textContent = `v${currentAppVersion}`;

      if (res.hasUpdate) {
        latestUpdateInfo = res;
        if (btnVersionBadge) {
          btnVersionBadge.textContent = `v${currentAppVersion} · 🆕 v${res.latestVersion}`;
          btnVersionBadge.classList.add('has-update');
          btnVersionBadge.title = `发现新版本 v${res.latestVersion}！点击立即查看并一键更新`;
        }
        if (updateStatusBox) updateStatusBox.classList.remove('hidden');
        if (updateStatusText) {
          updateStatusText.innerHTML = `🎉 发现 GitHub 新版本 <strong>v${escapeHtml(res.latestVersion)}</strong>（当前版本 v${escapeHtml(currentAppVersion)}）`;
        }
        if (updateNotesBox && res.releaseNotes) {
          updateNotesBox.textContent = res.releaseNotes;
          updateNotesBox.classList.remove('hidden');
        }
        if (btnPerformUpdate) {
          btnPerformUpdate.textContent = `🚀 立即更新至 v${res.latestVersion}（自动保留全部书签）`;
          btnPerformUpdate.classList.remove('hidden');
          btnPerformUpdate.disabled = false;
        }
        if (silent) {
          showToast(`🆕 发现新版本 v${res.latestVersion}，点击顶部版本号即可一键更新`);
        }
      } else {
        latestUpdateInfo = null;
        if (btnVersionBadge) {
          btnVersionBadge.textContent = `v${currentAppVersion}`;
          btnVersionBadge.classList.remove('has-update');
        }
        if (!silent) {
          if (updateStatusBox) updateStatusBox.classList.remove('hidden');
          if (updateStatusText) {
            updateStatusText.textContent = `✅ 当前已是最新版本 (v${currentAppVersion})，无需更新。`;
          }
          if (updateNotesBox) updateNotesBox.classList.add('hidden');
          if (btnPerformUpdate) btnPerformUpdate.classList.add('hidden');
          showToast(`✅ 当前已是最新版本 v${currentAppVersion}`);
        }
      }
    } catch (err) {
      if (btnCheckUpdate) {
        btnCheckUpdate.disabled = false;
        btnCheckUpdate.textContent = '🔍 检测更新';
      }
      if (!silent) {
        showToast('❌ 检测更新出错');
      }
    }
  }

  async function handlePerformUpdate() {
    if (!latestUpdateInfo || !latestUpdateInfo.downloadUrl) {
      showToast('⚠️ 未获取到有效的更新包下载链接');
      return;
    }

    if (btnPerformUpdate) {
      btnPerformUpdate.disabled = true;
      btnPerformUpdate.textContent = '⏳ 正在下载更新并备份书签，请稍候...';
    }
    if (btnCheckUpdate) btnCheckUpdate.disabled = true;
    if (updateProgressWrap) updateProgressWrap.classList.remove('hidden');
    if (updateProgressBar) updateProgressBar.style.width = '2%';
    if (updateProgressText) updateProgressText.textContent = '正在自动备份加密书签并连接 GitHub 下载更新包...';

    const res = await window.blinkAPI.downloadAndInstallUpdate(
      latestUpdateInfo.downloadUrl,
      latestUpdateInfo.latestVersion
    );

    if (!res || !res.ok) {
      if (btnPerformUpdate) {
        btnPerformUpdate.disabled = false;
        btnPerformUpdate.textContent = `🚀 重新尝试更新至 v${latestUpdateInfo.latestVersion}`;
      }
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
      if (updateProgressText) {
        updateProgressText.textContent = '❌ ' + (res?.error || '下载或安装失败');
      }
      showToast('❌ ' + (res?.error || '更新失败'));
    } else {
      showToast('🚀 更新包下载完成，正在为您无缝升级并重启...');
    }
  }

  // ==================== EVENT BINDINGS ====================
  function bindEvents() {
    setupFloatingOrbInteraction();
    setupPointerDragSorting();

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

    if (btnVersionBadge) {
      btnVersionBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isUnlocked) {
          showToast(`当前版本 v${currentAppVersion} · 请先解锁后检测更新`);
          return;
        }
        changePwdMsg.classList.add('hidden');
        settingsModal.classList.remove('hidden');
        handleCheckUpdate(false);
      });
    }

    if (btnCheckUpdate) {
      btnCheckUpdate.addEventListener('click', () => handleCheckUpdate(false));
    }

    if (btnPerformUpdate) {
      btnPerformUpdate.addEventListener('click', () => handlePerformUpdate());
    }

    btnCloseApp.addEventListener('click', async () => {
      const closeToOrb = appData.settings?.closeToOrb !== false;
      if (closeToOrb && isUnlocked) {
        await window.blinkAPI.setWindowMode('orb');
      } else {
        window.blinkAPI.closeWindow();
      }
    });

    // Ctrl (Windows) / Command ⌘ (macOS) + Mouse Wheel / Keyboard (+/-) Font Zoom
    let fontZoomToastEl = null;
    let fontZoomToastTimer = null;
    function showFontZoomToast(scaleVal) {
      const pxVal = (15 * (scaleVal / 100)).toFixed(1).replace(/\.0$/, '');
      const text = `🔍 文字大小：${scaleVal}% (${pxVal}px) · Ctrl/⌘+滚轮调节`;
      if (!fontZoomToastEl || !fontZoomToastEl.isConnected) {
        fontZoomToastEl = document.createElement('div');
        fontZoomToastEl.className = 'toast';
        toastContainer.appendChild(fontZoomToastEl);
      }
      fontZoomToastEl.textContent = text;
      if (fontZoomToastTimer) clearTimeout(fontZoomToastTimer);
      fontZoomToastTimer = setTimeout(() => {
        if (fontZoomToastEl) {
          fontZoomToastEl.remove();
          fontZoomToastEl = null;
        }
      }, 1500);
    }

    async function setFontScaleValue(targetScale) {
      const curScale = Number.isFinite(appData.settings?.fontScale)
        ? appData.settings.fontScale
        : (appData.settings?.fontSize === 'large' ? 115 : 100);
      const nextScale = Math.max(70, Math.min(180, Math.round(targetScale)));
      if (nextScale === curScale) {
        showFontZoomToast(curScale);
        return;
      }
      appData.settings.fontScale = nextScale;
      applySettingsToUI(appData.settings);
      showFontZoomToast(nextScale);
      const updated = await window.blinkAPI.updateSettings({ fontScale: nextScale });
      appData.settings = updated;
    }

    window.addEventListener('wheel', (e) => {
      if (currentWindowMode === 'orb') return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY === 0) return;
        const curScale = Number.isFinite(appData.settings?.fontScale)
          ? appData.settings.fontScale
          : (appData.settings?.fontSize === 'large' ? 115 : 100);
        const step = e.deltaY < 0 ? 5 : -5;
        setFontScaleValue(curScale + step);
      }
    }, { passive: false });

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
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const cur = Number.isFinite(appData.settings?.fontScale) ? appData.settings.fontScale : 100;
        setFontScaleValue(cur + 5);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        const cur = Number.isFinite(appData.settings?.fontScale) ? appData.settings.fontScale : 100;
        setFontScaleValue(cur - 5);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setFontScaleValue(100);
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
      if (e.ctrlKey || e.metaKey) return;
      if (e.deltaY !== 0) {
        e.preventDefault();
        categoryTabs.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Quick Import & Export
    btnQuickImport.addEventListener('click', () => triggerImportBookmarks(''));
    if (btnQuickExport) {
      btnQuickExport.addEventListener('click', () => triggerExportBookmarks());
    }
    btnEmptyImport.addEventListener('click', () => triggerImportBookmarks(''));
    if (btnSettingsExportFile) {
      btnSettingsExportFile.addEventListener('click', () => triggerExportBookmarks());
    }
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

    if (setCloseToOrb) {
      setCloseToOrb.addEventListener('change', async () => {
        const updated = await window.blinkAPI.updateSettings({
          closeToOrb: setCloseToOrb.checked
        });
        appData.settings = updated;
        applySettingsToUI(updated);
        showToast(
          setCloseToOrb.checked
            ? '✨ 已设为：点右上角 × 自动缩小为小悬浮球'
            : '已设为：点右上角 × 直接关闭软件'
        );
      });
    }

    setFontSize.addEventListener('change', async () => {
      const scaleVal = parseInt(setFontSize.value, 10) || 100;
      const updated = await window.blinkAPI.updateSettings({
        fontScale: scaleVal
      });
      appData.settings = updated;
      applySettingsToUI(updated);
      showFontZoomToast(scaleVal);
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
