const { contextBridge, ipcRenderer } = require('electron');

// Pre-bind IPC primitives before any renderer code runs (mitigates GHSA-h7rp-cf8h-j98x Function.prototype.bind hijack)
const invoke = Function.prototype.bind.call(ipcRenderer.invoke, ipcRenderer);
const send = Function.prototype.bind.call(ipcRenderer.send, ipcRenderer);
const on = Function.prototype.bind.call(ipcRenderer.on, ipcRenderer);
const removeListener = Function.prototype.bind.call(ipcRenderer.removeListener, ipcRenderer);

const api = Object.freeze({
  // Auth & Lock
  getAuthStatus: () => invoke('auth:status'),
  setupPassword: (password, hint) => invoke('auth:setup', { password, hint }),
  verifyPassword: (password) => invoke('auth:verify', { password }),
  changePassword: (oldPassword, newPassword, newHint) =>
    invoke('auth:change', { oldPassword, newPassword, newHint }),
  onLocked: (callback) => {
    const handler = () => callback();
    on('auth:locked', handler);
    return () => removeListener('auth:locked', handler);
  },

  // Data & Settings
  getAllData: () => invoke('data:getAll'),
  updateSettings: (settings) => invoke('settings:update', settings),

  // Categories
  saveCategory: (category) => invoke('category:save', category),
  deleteCategory: (categoryId, deleteBookmarksInside) =>
    invoke('category:delete', { categoryId, deleteBookmarksInside }),
  reorderCategories: (orderedIds) => invoke('category:reorder', orderedIds),

  // Bookmarks
  saveBookmark: (bookmark) => invoke('bookmark:save', bookmark),
  deleteBookmarks: (ids) => invoke('bookmark:delete', ids),
  reorderBookmarks: (movedId, orderedIds, newCategoryId) =>
    invoke('bookmark:reorder', { movedId, orderedIds, newCategoryId }),
  moveBookmarkToTop: (bookmarkId) => invoke('bookmark:moveToTop', bookmarkId),
  openBookmark: (url, explicitHwnd) => invoke('bookmark:open', { url, explicitHwnd }),

  // Import HTML Bookmarks (Additive)
  importBookmarksFromFile: (defaultFolderName) =>
    invoke('bookmark:importFile', { defaultFolderName }),
  importBookmarksFromHtml: (htmlContent, defaultFolderName) =>
    invoke('bookmark:importHtml', { htmlContent, defaultFolderName }),

  // Browser Target Tracking
  getBrowserTarget: () => invoke('browser:getTarget'),
  listOpenBrowsers: () => invoke('browser:list'),
  selectBrowserTarget: (hwnd) => invoke('browser:select', hwnd),
  onBrowserTargetUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    on('browser:target-updated', handler);
    return () => removeListener('browser:target-updated', handler);
  },
  onBrowserListUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    on('browser:list-updated', handler);
    return () => removeListener('browser:list-updated', handler);
  },

  // Window & Floating Orb Controls
  setWindowMode: (mode) => invoke('window:setMode', mode), // 'panel' | 'orb'
  moveWindowBy: (dx, dy) => send('window:moveBy', { dx, dy }),
  getWindowPosition: () => invoke('window:getPosition'),
  setWindowPosition: (x, y) => send('window:setPosition', { x, y }),
  setAlwaysOnTop: (flag) => invoke('window:setAlwaysOnTop', flag),
  minimizeWindow: () => invoke('window:minimize'),
  closeWindow: () => invoke('window:close'),
  onWindowModeChanged: (callback) => {
    const handler = (_, mode) => callback(mode);
    on('window:mode-changed', handler);
    return () => removeListener('window:mode-changed', handler);
  }
});

contextBridge.exposeInMainWorld('blinkAPI', api);

