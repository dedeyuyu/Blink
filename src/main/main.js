const { app, BrowserWindow, ipcMain, dialog, screen, shell, Tray, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFileSync } = require('child_process');
const { StorageManager, normalizeSafeHttpUrl } = require('./storage');
const { parseBookmarkHtml, parseBookmarkHtmlFile } = require('./bookmarkParser');

const APP_VERSION = app.getVersion() || '1.0.1';
const GITHUB_REPO = 'dedeyuyu/Blink';

// Disable Chromium HTTP & disk caches so no bookmark/UI residue is ever written to Chromium disk cache
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.blink.bookmark.manager');
}

let mainWindow = null;
let appTray = null;
let storage = null;
let bridgeProc = null;
let windowMode = 'panel'; // 'panel' | 'orb'
let isUnlocked = false;
let isDialogOpen = false;
let isTransitioning = false;

let latestBrowserTarget = {
  hasTarget: false,
  hwnd: '',
  pid: 0,
  processName: '',
  friendlyName: '',
  title: ''
};
let latestBrowserList = [];

const ORB_SIZE = 76;
const DEFAULT_PANEL_WIDTH = 400;
const DEFAULT_PANEL_HEIGHT = 650;

function getIconPath() {
  const rootIcon = path.join(__dirname, '..', '..', 'logo.ico');
  if (fs.existsSync(rootIcon)) return rootIcon;
  const appPathIcon = path.join(app.getAppPath(), 'logo.ico');
  if (fs.existsSync(appPathIcon)) return appPathIcon;
  return undefined;
}

function getVaultCipherLength(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return -1;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (parsed && parsed.auth && parsed.auth.isInitialized && parsed.encryptedVault && typeof parsed.encryptedVault.data === 'string') {
      return parsed.encryptedVault.data.length;
    }
    return 0;
  } catch {
    return -1;
  }
}

function ensureVaultIntegrityAndSync(primaryDir) {
  try {
    fs.mkdirSync(primaryDir, { recursive: true });
    const primaryStore = path.join(primaryDir, 'blink-store.json');
    const primaryLen = getVaultCipherLength(primaryStore);

    const userDataStore = path.join(app.getPath('userData'), 'data', 'blink-store.json');
    const preserveStore = path.join(app.getPath('temp'), 'blink-vault-preserve.json');
    const preUpdateBak = path.join(primaryDir, 'blink-store.pre-update.bak');
    const primaryBak = path.join(primaryDir, 'blink-store.backup.json');

    const candidates = [preserveStore, preUpdateBak, primaryBak, userDataStore];
    if (!app.isPackaged) {
      const localStore = path.join(app.getAppPath(), 'data', 'blink-store.json');
      candidates.push(localStore);
    }

    let bestCandidate = null;
    let bestLen = primaryLen;

    for (const cand of candidates) {
      if (cand === primaryStore) continue;
      const candLen = getVaultCipherLength(cand);
      // Restore if primary is missing/uninitialized OR if primary is just the tiny demo store (<= 2000) while a real backup (> 2000) exists
      if (candLen > 0 && (bestLen <= 0 || (bestLen <= 2000 && candLen > bestLen))) {
        bestLen = candLen;
        bestCandidate = cand;
      }
    }

    if (bestCandidate) {
      fs.copyFileSync(bestCandidate, primaryStore);
      fs.copyFileSync(bestCandidate, primaryBak);
    }
  } catch (err) {
    console.error('Vault integrity check warning:', err);
  }
}

function syncVaultToAllSafeLocations() {
  try {
    if (storage && storage.isUnlocked()) {
      storage._save();
    }
    const activeDir = getDataDirectory();
    const activeStore = path.join(activeDir, 'blink-store.json');
    if (getVaultCipherLength(activeStore) <= 0) return;

    const userDataDir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(userDataDir, { recursive: true });

    const targets = [
      path.join(activeDir, 'blink-store.backup.json'),
      path.join(activeDir, 'blink-store.pre-update.bak'),
      path.join(userDataDir, 'blink-store.json'),
      path.join(userDataDir, 'blink-store.backup.json'),
      path.join(userDataDir, 'blink-store.pre-update.bak'),
      path.join(app.getPath('temp'), 'blink-vault-preserve.json')
    ];

    for (const dst of targets) {
      try {
        if (path.resolve(dst) !== path.resolve(activeStore)) {
          fs.copyFileSync(activeStore, dst);
        }
      } catch {}
    }
  } catch {}
}

function getDataDirectory() {
  let targetDir;
  if (app.isPackaged) {
    try {
      const portableDataDir = path.join(path.dirname(process.execPath), 'data');
      if (fs.existsSync(path.join(portableDataDir, 'blink-store.json'))) {
        targetDir = portableDataDir;
      }
    } catch {}
    if (!targetDir) {
      targetDir = path.join(app.getPath('userData'), 'data');
    }
  } else {
    try {
      targetDir = path.join(app.getAppPath(), 'data');
    } catch {
      targetDir = path.join(app.getPath('userData'), 'data');
    }
  }
  ensureVaultIntegrityAndSync(targetDir);
  return targetDir;
}

function purgePlaintextLogsAndCaches() {
  try {
    const dataDir = getDataDirectory();
    for (const file of ['app.log', 'bridge.log']) {
      const p = path.join(dataDir, file);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  } catch {}

  try {
    if (session && session.defaultSession) {
      session.defaultSession.clearCache().catch(() => {});
      session.defaultSession.clearStorageData({
        storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
      }).catch(() => {});
    }
  } catch {}
}

function ensureNativeBridgeCompiled() {
  const exePath = path.join(__dirname, '..', 'native', 'BrowserBridge.exe');
  const csPath = path.join(__dirname, '..', 'native', 'BrowserBridge.cs');
  if (fs.existsSync(exePath)) return exePath;

  if (fs.existsSync(csPath)) {
    const csc64 = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    const csc32 = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe';
    const csc = fs.existsSync(csc64) ? csc64 : csc32;
    if (fs.existsSync(csc)) {
      try {
        execFileSync(csc, [
          '/nologo',
          '/optimize+',
          '/target:exe',
          `/out:${exePath}`,
          '/r:System.Management.dll',
          '/r:System.Windows.Forms.dll',
          csPath
        ]);
      } catch (err) {
        console.error('Failed to compile BrowserBridge.exe:', err);
      }
    }
  }
  return exePath;
}

function startBrowserBridge() {
  const exePath = ensureNativeBridgeCompiled();
  if (!fs.existsSync(exePath)) {
    return;
  }

  try {
    bridgeProc = spawn(exePath, [String(process.pid)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let buffer = '';
    bridgeProc.stdout.setEncoding('utf8');
    bridgeProc.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'target') {
            latestBrowserTarget = msg;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('browser:target-updated', latestBrowserTarget);
            }
          } else if (msg.type === 'browsers') {
            latestBrowserList = Array.isArray(msg.items) ? msg.items : [];
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('browser:list-updated', latestBrowserList);
            }
          }
        } catch {
          // ignore malformed line
        }
      }
    });

    bridgeProc.on('exit', () => {
      bridgeProc = null;
    });
  } catch (err) {
    console.error('Failed to spawn BrowserBridge.exe:', err);
  }
}

function sendBridgeCommand(payload) {
  if (bridgeProc && bridgeProc.stdin && !bridgeProc.stdin.destroyed) {
    try {
      bridgeProc.stdin.write(JSON.stringify(payload) + '\n');
      return true;
    } catch {}
  }
  return false;
}

function clampBoundsToScreen(bounds = {}) {
  const primary = screen.getPrimaryDisplay();
  let display = primary;
  if (
    bounds &&
    typeof bounds.x === 'number' && !Number.isNaN(bounds.x) &&
    typeof bounds.y === 'number' && !Number.isNaN(bounds.y) &&
    typeof bounds.width === 'number' && !Number.isNaN(bounds.width) &&
    typeof bounds.height === 'number' && !Number.isNaN(bounds.height)
  ) {
    try {
      display = screen.getDisplayMatching({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      }) || primary;
    } catch {
      display = primary;
    }
  }
  const workArea = display.workArea;

  const width = Math.min(Math.max(bounds?.width || DEFAULT_PANEL_WIDTH, 340), workArea.width);
  const height = Math.min(Math.max(bounds?.height || DEFAULT_PANEL_HEIGHT, 460), workArea.height);

  let x = bounds?.x;
  let y = bounds?.y;
  if (typeof x !== 'number' || Number.isNaN(x)) {
    x = workArea.x + workArea.width - width - 32;
  }
  if (typeof y !== 'number' || Number.isNaN(y)) {
    y = workArea.y + Math.round((workArea.height - height) / 2);
  }

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function clampOrbToScreen(pos = {}) {
  const primary = screen.getPrimaryDisplay();
  let display = primary;
  if (pos && typeof pos.x === 'number' && !Number.isNaN(pos.x) && typeof pos.y === 'number' && !Number.isNaN(pos.y)) {
    try {
      display = screen.getDisplayNearestPoint({ x: Math.round(pos.x), y: Math.round(pos.y) }) || primary;
    } catch {
      display = primary;
    }
  }
  const workArea = display.workArea;

  let x = typeof pos?.x === 'number' && !Number.isNaN(pos.x) ? pos.x : workArea.x + workArea.width - ORB_SIZE - 24;
  let y = typeof pos?.y === 'number' && !Number.isNaN(pos.y) ? pos.y : workArea.y + Math.round(workArea.height * 0.25);

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - ORB_SIZE));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - ORB_SIZE));

  return { x: Math.round(x), y: Math.round(y) };
}

function applyAlwaysOnTop(flag) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (flag) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
}

function switchWindowMode(targetMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return windowMode;
  if (targetMode === windowMode) return windowMode;

  isTransitioning = true;
  const settings = storage.getSettings();

  if (targetMode === 'orb') {
    const currentBounds = mainWindow.getBounds();
    if (currentBounds.width >= 300 && currentBounds.height >= 400) {
      storage.updateSettings({
        panelBounds: currentBounds
      });
    }

    let orbPos = settings.orbPosition;
    if (!orbPos || typeof orbPos.x !== 'number' || typeof orbPos.y !== 'number') {
      orbPos = {
        x: currentBounds.x + currentBounds.width - ORB_SIZE,
        y: currentBounds.y + 20
      };
    }
    const clampedOrb = clampOrbToScreen(orbPos);

    windowMode = 'orb';
    mainWindow.setMinimumSize(ORB_SIZE, ORB_SIZE);
    mainWindow.setResizable(false);
    mainWindow.setBounds({
      x: clampedOrb.x,
      y: clampedOrb.y,
      width: ORB_SIZE,
      height: ORB_SIZE
    });
    mainWindow.webContents.send('window:mode-changed', 'orb');
  } else {
    const currentOrbBounds = mainWindow.getBounds();
    storage.updateSettings({
      orbPosition: { x: currentOrbBounds.x, y: currentOrbBounds.y }
    });

    const savedPanel = settings.panelBounds || {};
    const pWidth = savedPanel.width || DEFAULT_PANEL_WIDTH;
    const pHeight = savedPanel.height || DEFAULT_PANEL_HEIGHT;

    const display = screen.getDisplayNearestPoint({ x: currentOrbBounds.x, y: currentOrbBounds.y }) || screen.getPrimaryDisplay();
    const wa = display.workArea;

    let targetX = currentOrbBounds.x;
    if (currentOrbBounds.x > wa.x + wa.width / 2) {
      targetX = currentOrbBounds.x + ORB_SIZE - pWidth;
    }
    let targetY = currentOrbBounds.y;

    const clampedPanel = clampBoundsToScreen({
      x: targetX,
      y: targetY,
      width: pWidth,
      height: pHeight
    });

    windowMode = 'panel';
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(340, 460);
    mainWindow.setBounds(clampedPanel);
    mainWindow.focus();
    mainWindow.webContents.send('window:mode-changed', 'panel');
  }

  setTimeout(() => {
    isTransitioning = false;
  }, 220);

  return windowMode;
}

function lockVaultNow() {
  isUnlocked = false;
  if (storage) {
    storage.lock();
  }
  purgePlaintextLogsAndCaches();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (windowMode === 'orb') {
      switchWindowMode('panel');
    }
    mainWindow.webContents.send('auth:locked');
  }
}

function createSystemTray() {
  const iconPath = getIconPath();
  if (!iconPath || appTray) return;

  try {
    appTray = new Tray(iconPath);
    appTray.setToolTip(`Blink · 灵动书签 v${APP_VERSION} (AES-256 加密保护)`);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '展开 Blink 书签面板',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (windowMode === 'orb') switchWindowMode('panel');
          mainWindow.show();
          mainWindow.focus();
        }
      },
      {
        label: '切换为桌面小圆圈悬浮球',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (isUnlocked) {
            mainWindow.show();
            switchWindowMode('orb');
          }
        }
      },
      { type: 'separator' },
      {
        label: '🔒 立即上锁并清除内存缓存',
        click: () => {
          lockVaultNow();
        }
      },
      { type: 'separator' },
      {
        label: '退出 Blink',
        click: () => {
          lockVaultNow();
          app.quit();
        }
      }
    ]);

    appTray.setContextMenu(contextMenu);
    appTray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (windowMode === 'orb') {
        switchWindowMode('panel');
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.error('Failed to create tray:', err);
  }
}

function createMainWindow() {
  const settings = storage.getSettings();
  const initialBounds = clampBoundsToScreen(settings.panelBounds || {
    width: DEFAULT_PANEL_WIDTH,
    height: DEFAULT_PANEL_HEIGHT
  });
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: 340,
    minHeight: 460,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    show: true,
    icon: iconPath,
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: false
    }
  });

  // Security hardening: prevent renderer navigation or popup window creation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });

  if (iconPath) {
    try {
      mainWindow.setIcon(iconPath);
    } catch {}
  }

  applyAlwaysOnTop(Boolean(settings.alwaysOnTop));
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    applyAlwaysOnTop(Boolean(storage.getSettings().alwaysOnTop));
    mainWindow.show();
    mainWindow.focus();
    if (latestBrowserTarget && latestBrowserTarget.hasTarget) {
      mainWindow.webContents.send('browser:target-updated', latestBrowserTarget);
    }
  });

  mainWindow.on('resized', () => {
    if (windowMode === 'panel' && !isTransitioning && mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      if (b.width >= 300 && b.height >= 400) {
        storage.updateSettings({ panelBounds: b });
      }
    }
  });

  mainWindow.on('moved', () => {
    if (isTransitioning || !mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    if (windowMode === 'panel' && b.width >= 300) {
      storage.updateSettings({ panelBounds: b });
    } else if (windowMode === 'orb') {
      storage.updateSettings({ orbPosition: { x: b.x, y: b.y } });
    }
  });

  mainWindow.on('blur', () => {
    if (isTransitioning || isDialogOpen || !isUnlocked) return;
    if (windowMode !== 'panel') return;
    const curSettings = storage.getSettings();
    if (curSettings.autoCollapseOnBlur && !curSettings.keepExpanded) {
      switchWindowMode('orb');
    }
  });
}

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (windowMode === 'orb') switchWindowMode('panel');
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
  });

  app.whenReady().then(() => {
    if (session && session.defaultSession) {
      session.defaultSession.setPermissionRequestHandler((_, __, callback) => {
        callback(false);
      });
    }
    purgePlaintextLogsAndCaches();
    storage = new StorageManager(getDataDirectory());
    startBrowserBridge();
    createSystemTray();
    createMainWindow();
  });
}

app.on('before-quit', () => {
  syncVaultToAllSafeLocations();
  if (storage) {
    storage.lock();
  }
  purgePlaintextLogsAndCaches();
});

app.on('window-all-closed', () => {
  if (storage) {
    storage.lock();
  }
  if (bridgeProc) {
    try { bridgeProc.kill(); } catch {}
  }
  if (appTray) {
    try { appTray.destroy(); } catch {}
    appTray = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== IPC Handlers ====================

// Auth
ipcMain.handle('auth:status', () => {
  return {
    ...storage.getAuthStatus(),
    isUnlocked: isUnlocked && storage.isUnlocked()
  };
});

ipcMain.handle('auth:setup', (_, { password, hint }) => {
  const res = storage.setupPassword(password, hint);
  if (res.ok) {
    isUnlocked = true;
  }
  return res;
});

ipcMain.handle('auth:verify', (_, { password }) => {
  if (password === '__LOCK__') {
    lockVaultNow();
    return { ok: true, locked: true };
  }
  const res = storage.verifyPassword(password);
  if (res.ok) {
    isUnlocked = true;
  }
  return res;
});

ipcMain.handle('auth:change', (_, { oldPassword, newPassword, newHint }) => {
  return storage.changePassword(oldPassword, newPassword, newHint);
});

// Data & Settings
ipcMain.handle('data:getAll', () => {
  return storage.getAllData();
});

ipcMain.handle('settings:update', (_, partial) => {
  const updated = storage.updateSettings(partial);
  if (typeof partial.alwaysOnTop === 'boolean') {
    applyAlwaysOnTop(partial.alwaysOnTop);
  }
  return updated;
});

// Categories
ipcMain.handle('category:save', (_, category) => {
  return storage.saveCategory(category);
});

ipcMain.handle('category:delete', (_, { categoryId, deleteBookmarksInside }) => {
  return storage.deleteCategory(categoryId, deleteBookmarksInside);
});

ipcMain.handle('category:reorder', (_, orderedIds) => {
  return storage.reorderCategories(orderedIds);
});

// Bookmarks
ipcMain.handle('bookmark:save', (_, bookmark) => {
  return storage.saveBookmark(bookmark);
});

ipcMain.handle('bookmark:delete', (_, ids) => {
  return storage.deleteBookmarks(ids);
});

ipcMain.handle('bookmark:reorder', (_, { movedId, orderedIds, newCategoryId }) => {
  return storage.moveBookmarkOrderAndCategory(movedId, orderedIds, newCategoryId);
});

ipcMain.handle('bookmark:moveToTop', (_, bookmarkId) => {
  return storage.moveBookmarkToTop(bookmarkId);
});

ipcMain.handle('bookmark:open', async (_, { url, explicitHwnd }) => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '书签库已锁定' };
  }
  const targetUrl = normalizeSafeHttpUrl(url);
  if (!targetUrl) {
    return { ok: false, error: '仅允许打开安全的 http:// 或 https:// 链接' };
  }

  const settings = storage.getSettings();
  const openMode = settings.openMode || 'auto';

  const sentToBridge = sendBridgeCommand({
    cmd: 'open',
    url: targetUrl,
    mode: openMode,
    hwnd: explicitHwnd ? String(explicitHwnd) : ''
  });

  if (!sentToBridge) {
    await shell.openExternal(targetUrl);
  }

  return { ok: true, target: latestBrowserTarget };
});

// Import HTML Bookmarks (Additive)
ipcMain.handle('bookmark:importFile', async (_, { defaultFolderName }) => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '请先输入密码解锁后再导入书签' };
  }
  isDialogOpen = true;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择浏览器导出的 HTML 书签文件（增量导入，不覆盖现有书签）',
      filters: [
        { name: 'HTML 书签文件', extensions: ['html', 'htm'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    let allParsed = [];
    for (const filePath of result.filePaths) {
      const items = parseBookmarkHtmlFile(filePath);
      allParsed = allParsed.concat(items);
    }

    if (allParsed.length === 0) {
      return { ok: false, error: '未在所选文件中解析到有效书签链接' };
    }

    return storage.importBookmarksAdditive(allParsed, { defaultFolderName });
  } catch (err) {
    return { ok: false, error: '导入失败: ' + err.message };
  } finally {
    setTimeout(() => {
      isDialogOpen = false;
    }, 300);
  }
});

ipcMain.handle('bookmark:importHtml', (_, { htmlContent, defaultFolderName }) => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '请先输入密码解锁后再导入书签' };
  }
  try {
    const items = parseBookmarkHtml(htmlContent);
    if (items.length === 0) {
      return { ok: false, error: '未能解析到书签内容' };
    }
    return storage.importBookmarksAdditive(items, { defaultFolderName });
  } catch (err) {
    return { ok: false, error: '导入失败: ' + err.message };
  }
});

// Browser Target Tracking
ipcMain.handle('browser:getTarget', () => {
  sendBridgeCommand({ cmd: 'status' });
  return latestBrowserTarget;
});

ipcMain.handle('browser:list', () => {
  sendBridgeCommand({ cmd: 'list' });
  return latestBrowserList;
});

ipcMain.handle('browser:select', (_, hwnd) => {
  sendBridgeCommand({ cmd: 'select', hwnd: String(hwnd) });
  return { ok: true };
});

// Window Controls
ipcMain.handle('window:setMode', (_, mode) => {
  return switchWindowMode(mode);
});

ipcMain.on('window:moveBy', (_, { dx, dy } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const b = mainWindow.getBounds();
  mainWindow.setBounds({
    x: Math.round(b.x + dx),
    y: Math.round(b.y + dy),
    width: b.width,
    height: b.height
  });
});

ipcMain.handle('window:getPosition', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

ipcMain.on('window:setPosition', (_, { x, y } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const b = mainWindow.getBounds();
  mainWindow.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: b.width,
    height: b.height
  });
});

ipcMain.handle('window:setAlwaysOnTop', (_, flag) => {
  const updated = storage.updateSettings({ alwaysOnTop: Boolean(flag) });
  applyAlwaysOnTop(Boolean(flag));
  return updated;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

// ==================== Version & GitHub Auto-Update ====================

function normalizeVersion(ver) {
  return String(ver || '')
    .trim()
    .replace(/^[vV]+/, '')
    .split('-')[0];
}

function compareSemver(verA, verB) {
  const a = normalizeVersion(verA).split('.').map(n => parseInt(n, 10) || 0);
  const b = normalizeVersion(verB).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const na = a[i] || 0;
    const nb = b[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function fetchJsonHttps(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `Blink-Bookmark-Manager/${APP_VERSION}`,
          Accept: 'application/vnd.github+json'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJsonHttps(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

function fetchLatestTagFromRedirect(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://github.com/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'User-Agent': `Blink-Bookmark-Manager/${APP_VERSION}` },
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        const loc = res.headers.location || '';
        const match = loc.match(/\/releases\/tag\/([^/?#]+)/i);
        if (match && match[1]) {
          const tag = decodeURIComponent(match[1]);
          const ver = normalizeVersion(tag);
          resolve({
            tag_name: tag,
            latestVersion: ver,
            downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/Blink-Setup-${ver}.exe`,
            html_url: `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
            body: `Blink v${ver} 版本更新`
          });
        } else {
          reject(new Error('未能从 GitHub Releases 获取版本标签'));
        }
      }
    );
    req.on('timeout', () => req.destroy(new Error('连接 GitHub 超时')));
    req.on('error', reject);
  });
}

ipcMain.handle('app:version', () => {
  return { version: APP_VERSION, repo: GITHUB_REPO };
});

ipcMain.handle('update:check', async () => {
  try {
    let latestVersion = '';
    let tagName = '';
    let releaseNotes = '';
    let downloadUrl = '';
    let releasePageUrl = `https://github.com/${GITHUB_REPO}/releases`;
    let publishedAt = '';

    try {
      const release = await fetchJsonHttps(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
      tagName = release.tag_name || '';
      latestVersion = normalizeVersion(tagName || release.name || '');
      releaseNotes = release.body || '';
      releasePageUrl = release.html_url || releasePageUrl;
      publishedAt = release.published_at || '';

      if (Array.isArray(release.assets)) {
        const exeAsset = release.assets.find(a => a && a.name && /\.exe$/i.test(a.name));
        if (exeAsset && exeAsset.browser_download_url) {
          downloadUrl = exeAsset.browser_download_url;
        }
      }
      if (!downloadUrl && tagName && latestVersion) {
        downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/Blink-Setup-${latestVersion}.exe`;
      }
    } catch {
      const fallback = await fetchLatestTagFromRedirect();
      tagName = fallback.tag_name;
      latestVersion = fallback.latestVersion;
      downloadUrl = fallback.downloadUrl;
      releasePageUrl = fallback.html_url;
      releaseNotes = fallback.body;
    }

    if (!latestVersion) {
      return {
        ok: false,
        currentVersion: APP_VERSION,
        error: '暂未检测到可用的 GitHub Release 版本信息'
      };
    }

    const hasUpdate = compareSemver(latestVersion, APP_VERSION) > 0;
    return {
      ok: true,
      currentVersion: APP_VERSION,
      latestVersion,
      tagName: tagName || `v${latestVersion}`,
      hasUpdate,
      releaseNotes,
      downloadUrl,
      releasePageUrl,
      publishedAt
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion: APP_VERSION,
      error: '连接 GitHub 检测更新失败: ' + (err.message || '网络异常')
    };
  }
});

function isAllowedGitHubDownloadUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function downloadFileWithProgress(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 6) {
      reject(new Error('下载重定向次数过多'));
      return;
    }
    if (!isAllowedGitHubDownloadUrl(url)) {
      reject(new Error('仅允许从官方 GitHub 域名下载更新包'));
      return;
    }

    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `Blink-Bookmark-Manager/${APP_VERSION}`,
          Accept: 'application/octet-stream,*/*'
        },
        timeout: 30000
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, url).toString();
          res.resume();
          downloadFileWithProgress(nextUrl, destPath, onProgress, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`下载失败 (HTTP ${res.statusCode})`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress) {
            const percent = totalBytes > 0
              ? Math.min(99, Math.round((downloadedBytes * 100) / totalBytes))
              : 50;
            onProgress({
              stage: 'downloading',
              percent,
              downloadedMb: (downloadedBytes / (1024 * 1024)).toFixed(1),
              totalMb: totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : '未知'
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });

        fileStream.on('error', (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('下载超时，请检查网络连接'));
    });

    req.on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

ipcMain.handle('update:downloadAndInstall', async (_, { downloadUrl, latestVersion } = {}) => {
  try {
    if (!downloadUrl || !isAllowedGitHubDownloadUrl(downloadUrl)) {
      return { ok: false, error: '无效的 GitHub 更新包下载地址' };
    }

    // 1. Critical step: Flush and triple-backup all user bookmarks before starting update!
    syncVaultToAllSafeLocations();

    const cleanVer = normalizeVersion(latestVersion || 'latest').replace(/[^0-9a-zA-Z._-]/g, '');
    const tempExePath = path.join(app.getPath('temp'), `Blink-Setup-${cleanVer}-${Date.now()}.exe`);

    const sendProgress = (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:progress', payload);
      }
    };

    sendProgress({ stage: 'downloading', percent: 1, downloadedMb: '0.0', totalMb: '...' });

    await downloadFileWithProgress(downloadUrl, tempExePath, sendProgress);

    // Verify downloaded file is a valid Windows PE executable (> 1 MB and starts with 'MZ')
    const stat = fs.statSync(tempExePath);
    if (!stat || stat.size < 1024 * 1024) {
      try { fs.unlinkSync(tempExePath); } catch {}
      return { ok: false, error: '下载的安装包文件不完整，请重试' };
    }
    const headerBuf = Buffer.alloc(2);
    const fd = fs.openSync(tempExePath, 'r');
    fs.readSync(fd, headerBuf, 0, 2, 0);
    fs.closeSync(fd);
    if (headerBuf[0] !== 0x4d || headerBuf[1] !== 0x5a) {
      try { fs.unlinkSync(tempExePath); } catch {}
      return { ok: false, error: '下载的文件不是有效的 Windows 安装程序' };
    }

    // 2. Re-sync vault right before quitting & launching installer
    syncVaultToAllSafeLocations();
    sendProgress({ stage: 'installing', percent: 100 });

    const installTargetDir = app.isPackaged
      ? path.dirname(process.execPath)
      : path.join(process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'), 'Programs', 'Blink');

    const child = spawn(tempExePath, ['/S', '/LAUNCH', `/D=${installTargetDir}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();

    setTimeout(() => {
      if (bridgeProc) {
        try { bridgeProc.kill(); } catch {}
      }
      app.quit();
    }, 400);

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: '更新下载或安装失败: ' + (err.message || '未知错误')
    };
  }
});
