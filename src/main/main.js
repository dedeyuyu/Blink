const { app, BrowserWindow, ipcMain, dialog, screen, shell, Tray, Menu, session, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFile, execFileSync } = require('child_process');
const { StorageManager, normalizeSafeHttpUrl } = require('./storage');
const {
  parseBookmarkHtml,
  parseBookmarkHtmlFile,
  parseBlinkBackupFromContent,
  generateBlinkExportHtml,
  generateBlinkExportJson
} = require('./bookmarkParser');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const APP_VERSION = app.getVersion() || '1.0.2';
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

const ORB_SIZE = 40;
const DEFAULT_PANEL_WIDTH = 400;
const DEFAULT_PANEL_HEIGHT = 650;

function buildOrbShapeRects(size = ORB_SIZE) {
  const rects = [];
  const center = size / 2;
  const radius = (size / 2) - 1;
  for (let y = 0; y < size; y++) {
    const dy = (y + 0.5) - center;
    if (Math.abs(dy) <= radius) {
      const halfChord = Math.sqrt(radius * radius - dy * dy);
      let xStart = Math.max(0, Math.floor(center - halfChord));
      let xEnd = Math.min(size, Math.ceil(center + halfChord));
      // Allow top-right mini count badge area
      if (y >= 1 && y <= 15) {
        xEnd = Math.max(xEnd, size - 1);
      }
      if (xEnd > xStart) {
        rects.push({ x: xStart, y, width: xEnd - xStart, height: 1 });
      }
    }
  }
  return rects;
}

const ORB_SHAPE_RECTS = buildOrbShapeRects(ORB_SIZE);

function applyWindowShape(rects) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (IS_WIN || process.platform === 'linux') {
    try {
      mainWindow.setShape(rects);
    } catch {}
  }
}

function getIconPath() {
  const candidates = IS_MAC
    ? ['logo.png', 'logo.icns', 'logo.ico']
    : ['logo.ico', 'logo.png'];
  for (const name of candidates) {
    const rootCandidate = path.join(__dirname, '..', '..', name);
    if (fs.existsSync(rootCandidate)) return rootCandidate;
    try {
      const appCandidate = path.join(app.getAppPath(), name);
      if (fs.existsSync(appCandidate)) return appCandidate;
    } catch {}
  }
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

let macBridgeTimer = null;
let macExplicitBrowserApp = '';

const MAC_KNOWN_BROWSERS = [
  { appName: 'Safari', friendlyName: 'Apple Safari' },
  { appName: 'Google Chrome', friendlyName: 'Google Chrome' },
  { appName: 'Arc', friendlyName: 'Arc Browser' },
  { appName: 'Microsoft Edge', friendlyName: 'Microsoft Edge' },
  { appName: 'Brave Browser', friendlyName: 'Brave Browser' },
  { appName: 'Firefox', friendlyName: 'Mozilla Firefox' },
  { appName: 'Vivaldi', friendlyName: 'Vivaldi' },
  { appName: 'Opera', friendlyName: 'Opera' }
];

function pollMacBrowsers() {
  if (!IS_MAC) return;
  const jxa = `
    const se = Application('System Events');
    const known = ${JSON.stringify(MAC_KNOWN_BROWSERS)};
    const out = [];
    for (const b of known) {
      try {
        const procs = se.processes.whose({ name: b.appName });
        if (procs.length > 0) {
          const p = procs[0];
          let winTitle = b.friendlyName;
          try {
            if (p.windows.length > 0 && p.windows[0].name()) {
              winTitle = p.windows[0].name();
            }
          } catch (e) {}
          out.push({
            hwnd: b.appName,
            pid: Number(p.unixId()) || 0,
            processName: b.appName,
            friendlyName: b.friendlyName,
            title: winTitle,
            frontmost: Boolean(p.frontmost())
          });
        }
      } catch (e) {}
    }
    JSON.stringify(out);
  `;
  execFile('osascript', ['-l', 'JavaScript', '-e', jxa], { timeout: 2500 }, (err, stdout) => {
    if (err || !stdout) return;
    try {
      const items = JSON.parse(stdout.trim());
      if (!Array.isArray(items)) return;
      latestBrowserList = items;

      const front = items.find(i => i.frontmost);
      if (front) {
        macExplicitBrowserApp = front.hwnd;
      }
      const chosen = items.find(i => i.hwnd === macExplicitBrowserApp) || front || items[0];
      if (chosen) {
        latestBrowserTarget = {
          type: 'target',
          hasTarget: true,
          hwnd: chosen.hwnd,
          pid: chosen.pid,
          processName: chosen.processName,
          friendlyName: chosen.friendlyName,
          title: chosen.title
        };
      } else {
        latestBrowserTarget = {
          type: 'target',
          hasTarget: false,
          hwnd: '',
          pid: 0,
          processName: '',
          friendlyName: '',
          title: ''
        };
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser:target-updated', latestBrowserTarget);
        mainWindow.webContents.send('browser:list-updated', latestBrowserList);
      }
    } catch {}
  });
}

function startBrowserBridge() {
  if (IS_MAC) {
    pollMacBrowsers();
    if (!macBridgeTimer) {
      macBridgeTimer = setInterval(pollMacBrowsers, 2500);
    }
    return;
  }
  if (!IS_WIN) return;

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
  if (IS_MAC && payload && typeof payload === 'object') {
    if (payload.cmd === 'status' || payload.cmd === 'list') {
      pollMacBrowsers();
      return true;
    }
    if (payload.cmd === 'select' && payload.hwnd) {
      macExplicitBrowserApp = String(payload.hwnd);
      pollMacBrowsers();
      return true;
    }
    if (payload.cmd === 'open' && payload.url) {
      const targetApp = payload.hwnd || latestBrowserTarget.hwnd || '';
      if (targetApp) {
        const args = payload.mode === 'new-window'
          ? ['-na', targetApp, '--args', '--new-window', payload.url]
          : ['-a', targetApp, payload.url];
        execFile('open', args, (err) => {
          if (err) {
            shell.openExternal(payload.url).catch(() => {});
          }
        });
        return true;
      }
      return false;
    }
  }
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
    mainWindow.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
    if (IS_MAC) {
      try {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch {}
    }
  } else {
    mainWindow.setAlwaysOnTop(false);
    if (IS_MAC) {
      try {
        mainWindow.setVisibleOnAllWorkspaces(false);
      } catch {}
    }
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

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }

    windowMode = 'orb';
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(ORB_SIZE, ORB_SIZE);
    mainWindow.setBounds({
      x: clampedOrb.x,
      y: clampedOrb.y,
      width: ORB_SIZE,
      height: ORB_SIZE
    });
    mainWindow.setContentSize(ORB_SIZE, ORB_SIZE);
    mainWindow.setResizable(false);
    applyWindowShape(ORB_SHAPE_RECTS);
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
    mainWindow.setIgnoreMouseEvents(false);
    applyWindowShape([]);
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
    let trayIcon = iconPath;
    if (IS_MAC) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        trayIcon = img.resize({ width: 18, height: 18 });
      }
    }
    appTray = new Tray(trayIcon);
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
      const saved = storage.getSettings().panelBounds || {};
      storage.updateSettings({
        panelBounds: {
          x: b.x,
          y: b.y,
          width: saved.width || DEFAULT_PANEL_WIDTH,
          height: saved.height || DEFAULT_PANEL_HEIGHT
        }
      });
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
    if (IS_MAC && app.dock) {
      try {
        const iconPath = getIconPath();
        if (iconPath) {
          const dockImg = nativeImage.createFromPath(iconPath);
          if (!dockImg.isEmpty()) app.dock.setIcon(dockImg);
        }
      } catch {}
    }
    purgePlaintextLogsAndCaches();
    storage = new StorageManager(getDataDirectory());
    startBrowserBridge();
    createSystemTray();
    createMainWindow();

    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (windowMode === 'orb') switchWindowMode('panel');
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

app.on('before-quit', () => {
  if (macBridgeTimer) {
    clearInterval(macBridgeTimer);
    macBridgeTimer = null;
  }
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

ipcMain.handle('bookmark:copyUrl', (_, url) => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '书签库已锁定' };
  }
  const targetUrl = normalizeSafeHttpUrl(url);
  if (!targetUrl) {
    return { ok: false, error: '无效的书签链接' };
  }
  try {
    clipboard.writeText(targetUrl);
    return { ok: true, url: targetUrl };
  } catch (err) {
    return { ok: false, error: '复制失败: ' + err.message };
  }
});

// Import & Export Bookmarks (支持跨电脑迁移 Blink 完整备份文件 & 浏览器 HTML 书签)
ipcMain.handle('bookmark:importFile', async (_, { defaultFolderName } = {}) => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '请先输入密码解锁后再导入书签' };
  }
  isDialogOpen = true;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Blink 书签备份文件或浏览器导出的 HTML 书签文件（增量导入，不覆盖现有书签）',
      filters: [
        { name: '书签备份与浏览器书签 (*.html; *.htm; *.json)', extensions: ['html', 'htm', 'json', 'blink'] },
        { name: 'HTML 书签文件 (*.html; *.htm)', extensions: ['html', 'htm'] },
        { name: 'Blink JSON 备份 (*.json)', extensions: ['json', 'blink'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    let totalAddedBookmarks = 0;
    let totalAddedCategories = 0;
    let allHtmlParsed = [];

    for (const filePath of result.filePaths) {
      const stat = fs.statSync(filePath);
      if (stat.size > 32 * 1024 * 1024) {
        return { ok: false, error: '所选书签文件体积超过 32MB 安全上限' };
      }
      const rawContent = fs.readFileSync(filePath, 'utf-8');
      const blinkBackup = parseBlinkBackupFromContent(rawContent);
      if (blinkBackup) {
        const res = storage.importBlinkBackup(blinkBackup, { defaultFolderName });
        if (res && res.ok) {
          totalAddedBookmarks += res.addedBookmarks || 0;
          totalAddedCategories += res.addedCategories || 0;
        }
      } else {
        const items = parseBookmarkHtml(rawContent);
        allHtmlParsed = allHtmlParsed.concat(items);
      }
    }

    if (allHtmlParsed.length > 0) {
      const res = storage.importBookmarksAdditive(allHtmlParsed, { defaultFolderName });
      if (res && res.ok) {
        totalAddedBookmarks += res.addedBookmarks || 0;
        totalAddedCategories += res.addedCategories || 0;
      }
    }

    if (totalAddedBookmarks === 0 && totalAddedCategories === 0) {
      return { ok: false, error: '未在所选文件中解析到有效书签链接' };
    }

    syncVaultToAllSafeLocations();
    return {
      ok: true,
      addedBookmarks: totalAddedBookmarks,
      addedCategories: totalAddedCategories,
      data: storage.getAllData()
    };
  } catch (err) {
    return { ok: false, error: '导入失败: ' + err.message };
  } finally {
    setTimeout(() => {
      isDialogOpen = false;
    }, 300);
  }
});

ipcMain.handle('bookmark:importHtml', (_, { htmlContent, defaultFolderName } = {}) => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '请先输入密码解锁后再导入书签' };
  }
  try {
    const blinkBackup = parseBlinkBackupFromContent(htmlContent);
    if (blinkBackup) {
      const res = storage.importBlinkBackup(blinkBackup, { defaultFolderName });
      syncVaultToAllSafeLocations();
      return res;
    }
    const items = parseBookmarkHtml(htmlContent);
    if (items.length === 0) {
      return { ok: false, error: '未能解析到书签内容' };
    }
    const res = storage.importBookmarksAdditive(items, { defaultFolderName });
    syncVaultToAllSafeLocations();
    return res;
  } catch (err) {
    return { ok: false, error: '导入失败: ' + err.message };
  }
});

ipcMain.handle('bookmark:exportFile', async () => {
  if (!isUnlocked || !storage.isUnlocked()) {
    return { ok: false, error: '请先输入密码解锁后再导出书签' };
  }
  const payload = storage.getExportPayload();
  if (!payload || !payload.ok) {
    return payload || { ok: false, error: '获取书签数据失败' };
  }

  const { categories, bookmarks } = payload;
  if ((!bookmarks || bookmarks.length === 0) && (!categories || categories.length === 0)) {
    return { ok: false, error: '当前书签库为空，暂无可导出的书签' };
  }

  isDialogOpen = true;
  try {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const defaultFileName = `Blink-书签备份-${yyyy}-${mm}-${dd}.html`;
    const desktopDir = app.getPath('desktop') || app.getPath('documents') || '';

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出全部书签备份（换新电脑时点击「导入书签」即可一键恢复）',
      defaultPath: desktopDir ? path.join(desktopDir, defaultFileName) : defaultFileName,
      filters: [
        { name: 'Blink 完整书签备份 (兼容浏览器 HTML)', extensions: ['html'] },
        { name: 'Blink 专属数据备份 (JSON)', extensions: ['json'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    const savePath = result.filePath;
    const isJson = savePath.toLowerCase().endsWith('.json');
    const fileContent = isJson
      ? generateBlinkExportJson(categories, bookmarks, APP_VERSION)
      : generateBlinkExportHtml(categories, bookmarks, APP_VERSION);

    fs.writeFileSync(savePath, fileContent, 'utf-8');
    return {
      ok: true,
      exportedBookmarks: bookmarks.length,
      exportedCategories: categories.length,
      filePath: savePath
    };
  } catch (err) {
    return { ok: false, error: '导出失败: ' + err.message };
  } finally {
    setTimeout(() => {
      isDialogOpen = false;
    }, 300);
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
  if (windowMode === 'orb') {
    mainWindow.setBounds({
      x: Math.round(b.x + dx),
      y: Math.round(b.y + dy),
      width: ORB_SIZE,
      height: ORB_SIZE
    });
    applyWindowShape(ORB_SHAPE_RECTS);
  } else {
    const saved = storage.getSettings().panelBounds || {};
    mainWindow.setBounds({
      x: Math.round(b.x + dx),
      y: Math.round(b.y + dy),
      width: saved.width || DEFAULT_PANEL_WIDTH,
      height: saved.height || DEFAULT_PANEL_HEIGHT
    });
  }
});

ipcMain.handle('window:getPosition', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

ipcMain.on('window:setPosition', (_, { x, y } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (windowMode === 'orb') {
    mainWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: ORB_SIZE,
      height: ORB_SIZE
    });
    applyWindowShape(ORB_SHAPE_RECTS);
  } else {
    const saved = storage.getSettings().panelBounds || {};
    mainWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: saved.width || DEFAULT_PANEL_WIDTH,
      height: saved.height || DEFAULT_PANEL_HEIGHT
    });
  }
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

function getDefaultReleaseAssetName(ver) {
  if (IS_MAC) {
    const archTag = process.arch === 'arm64' ? 'AppleSilicon-arm64' : 'Intel-x64';
    return `Blink-MacOS-${archTag}-${ver}.zip`;
  }
  return `Blink-Setup-${ver}.exe`;
}

function selectPlatformReleaseAsset(assets = []) {
  if (!Array.isArray(assets)) return null;
  if (IS_MAC) {
    const isArm = process.arch === 'arm64';
    const archPattern = isArm ? /(arm64|applesilicon|m1)/i : /(x64|intel)/i;
    const macDmg = assets.find(a => a && a.name && /\.dmg$/i.test(a.name) && archPattern.test(a.name))
      || assets.find(a => a && a.name && /\.dmg$/i.test(a.name));
    if (macDmg) return macDmg;
    const macZip = assets.find(a => a && a.name && /mac/i.test(a.name) && /\.zip$/i.test(a.name) && archPattern.test(a.name))
      || assets.find(a => a && a.name && /mac/i.test(a.name) && /\.zip$/i.test(a.name));
    if (macZip) return macZip;
    return null;
  }
  return assets.find(a => a && a.name && /\.exe$/i.test(a.name)) || null;
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
            downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${getDefaultReleaseAssetName(ver)}`,
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
        const matchedAsset = selectPlatformReleaseAsset(release.assets);
        if (matchedAsset && matchedAsset.browser_download_url) {
          downloadUrl = matchedAsset.browser_download_url;
        }
      }
      if (!downloadUrl && tagName && latestVersion) {
        downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tagName}/${getDefaultReleaseAssetName(latestVersion)}`;
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
    const sendProgress = (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:progress', payload);
      }
    };

    sendProgress({ stage: 'downloading', percent: 1, downloadedMb: '0.0', totalMb: '...' });

    if (IS_MAC) {
      const ext = /\.dmg($|\?)/i.test(downloadUrl) ? '.dmg' : '.zip';
      let targetDir = app.getPath('temp');
      try {
        targetDir = app.getPath('downloads') || targetDir;
      } catch {}
      const macPkgPath = path.join(targetDir, `Blink-MacOS-${cleanVer}-${Date.now()}${ext}`);
      await downloadFileWithProgress(downloadUrl, macPkgPath, sendProgress);
      const stat = fs.statSync(macPkgPath);
      if (!stat || stat.size < 1024 * 1024) {
        try { fs.unlinkSync(macPkgPath); } catch {}
        return { ok: false, error: '下载的 macOS 安装包不完整，请重试' };
      }
      syncVaultToAllSafeLocations();
      sendProgress({ stage: 'installing', percent: 100 });
      await shell.openPath(macPkgPath);
      return { ok: true };
    }

    const tempExePath = path.join(app.getPath('temp'), `Blink-Setup-${cleanVer}-${Date.now()}.exe`);
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
