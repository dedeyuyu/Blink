const { app, BrowserWindow, ipcMain, dialog, screen, shell, Tray, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { StorageManager, normalizeSafeHttpUrl } = require('./storage');
const { parseBookmarkHtml, parseBookmarkHtmlFile } = require('./bookmarkParser');

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

function getDataDirectory() {
  if (app.isPackaged) {
    try {
      const portableDataDir = path.join(path.dirname(process.execPath), 'data');
      if (fs.existsSync(path.join(portableDataDir, 'blink-store.json'))) {
        return portableDataDir;
      }
    } catch {}
    const userDataDir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(userDataDir, { recursive: true });
    return userDataDir;
  }
  try {
    const localDataDir = path.join(app.getAppPath(), 'data');
    fs.mkdirSync(localDataDir, { recursive: true });
    return localDataDir;
  } catch {
    return path.join(app.getPath('userData'), 'data');
  }
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
    appTray.setToolTip('Blink · 灵动书签 (AES-256 加密保护)');

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
