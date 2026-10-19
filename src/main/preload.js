const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blinkAPI', {
  // Auth & Lock
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  setupPassword: (password, hint) => ipcRenderer.invoke('auth:setup', { password, hint }),
  verifyPassword: (password) => ipcRenderer.invoke('auth:verify', { password }),
  changePassword: (oldPassword, newPassword, newHint) =>
    ipcRenderer.invoke('auth:change', { oldPassword, newPassword, newHint }),
  onLocked: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('auth:locked', handler);
    return () => ipcRenderer.removeListener('auth:locked', handler);
  },

  // Data & Settings
  getAllData: () => ipcRenderer.invoke('data:getAll'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),

  // Categories
  saveCategory: (category) => ipcRenderer.invoke('category:save', category),
  deleteCategory: (categoryId, deleteBookmarksInside) =>
    ipcRenderer.invoke('category:delete', { categoryId, deleteBookmarksInside }),
  reorderCategories: (orderedIds) => ipcRenderer.invoke('category:reorder', orderedIds),

  // Bookmarks
  saveBookmark: (bookmark) => ipcRenderer.invoke('bookmark:save', bookmark),
  deleteBookmarks: (ids) => ipcRenderer.invoke('bookmark:delete', ids),
  reorderBookmarks: (movedId, orderedIds, newCategoryId) =>
    ipcRenderer.invoke('bookmark:reorder', { movedId, orderedIds, newCategoryId }),
  moveBookmarkToTop: (bookmarkId) => ipcRenderer.invoke('bookmark:moveToTop', bookmarkId),
  openBookmark: (url, explicitHwnd) => ipcRenderer.invoke('bookmark:open', { url, explicitHwnd }),

  // Import HTML Bookmarks (Additive)
  importBookmarksFromFile: (defaultFolderName) =>
    ipcRenderer.invoke('bookmark:importFile', { defaultFolderName }),
  importBookmarksFromHtml: (htmlContent, defaultFolderName) =>
    ipcRenderer.invoke('bookmark:importHtml', { htmlContent, defaultFolderName }),

  // Browser Target Tracking
  getBrowserTarget: () => ipcRenderer.invoke('browser:getTarget'),
  listOpenBrowsers: () => ipcRenderer.invoke('browser:list'),
  selectBrowserTarget: (hwnd) => ipcRenderer.invoke('browser:select', hwnd),
  onBrowserTargetUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('browser:target-updated', handler);
    return () => ipcRenderer.removeListener('browser:target-updated', handler);
  },
  onBrowserListUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('browser:list-updated', handler);
    return () => ipcRenderer.removeListener('browser:list-updated', handler);
  },

  // Window & Floating Orb Controls
  setWindowMode: (mode) => ipcRenderer.invoke('window:setMode', mode), // 'panel' | 'orb'
  moveWindowBy: (dx, dy) => ipcRenderer.send('window:moveBy', { dx, dy }),
  getWindowPosition: () => ipcRenderer.invoke('window:getPosition'),
  setWindowPosition: (x, y) => ipcRenderer.send('window:setPosition', { x, y }),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onWindowModeChanged: (callback) => {
    const handler = (_, mode) => callback(mode);
    ipcRenderer.on('window:mode-changed', handler);
    return () => ipcRenderer.removeListener('window:mode-changed', handler);
  }
});
