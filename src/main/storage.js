const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class StorageManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.filePath = path.join(this.dataDir, 'blink-store.json');
    this.sessionKey = null; // 32-byte Buffer derived from user's password via scrypt (only in RAM while unlocked)
    this.unlockedVault = null; // { categories: [], bookmarks: [] } (only in RAM while unlocked)
    this.diskState = this._load();
  }

  _getDefaultSettings() {
    return {
      theme: 'dark',
      alwaysOnTop: true,
      autoCollapseOnBlur: true,
      keepExpanded: true,
      openMode: 'auto',
      fontSize: 'normal',
      cardLayout: 'list',
      panelBounds: { width: 400, height: 650, x: null, y: null },
      orbPosition: { x: null, y: null }
    };
  }

  _getDefaultVault() {
    const now = Date.now();
    return {
      categories: [
        { id: 'cat_common', name: '高频常用', color: 'indigo', order: 0, createdAt: now },
        { id: 'cat_work', name: '工作台', color: 'emerald', order: 1, createdAt: now },
        { id: 'cat_web3', name: '多开与项目', color: 'amber', order: 2, createdAt: now },
        { id: 'cat_ai', name: 'AI 工具箱', color: 'violet', order: 3, createdAt: now },
        { id: 'cat_read', name: '资料与灵感', color: 'rose', order: 4, createdAt: now }
      ],
      bookmarks: [
        {
          id: 'bm_demo_1',
          title: 'Google 搜索主页 · 常用检索入口',
          note: '点击即在您刚刚操作的浏览器窗口中新建标签页打开',
          url: 'https://www.google.com',
          categoryId: 'cat_common',
          color: 'indigo',
          pinned: true,
          order: 0,
          createdAt: now
        },
        {
          id: 'bm_demo_2',
          title: 'GitHub 开源代码仓库与项目管理',
          note: '日常开发代码托管平台',
          url: 'https://github.com',
          categoryId: 'cat_work',
          color: 'emerald',
          pinned: false,
          order: 1,
          createdAt: now
        },
        {
          id: 'bm_demo_3',
          title: '哔哩哔哩 Bilibili · 视频与教程参考',
          note: '学习资料与休闲视频收藏',
          url: 'https://www.bilibili.com',
          categoryId: 'cat_read',
          color: 'rose',
          pinned: false,
          order: 2,
          createdAt: now
        }
      ]
    };
  }

  // Derive 64-byte authentication hash from password + passwordSalt
  _hashPassword(password, salt) {
    return crypto.scryptSync(String(password), String(salt), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  }

  // Derive 32-byte (256-bit) AES-256-GCM encryption key from user's plaintext password + encryptionSalt
  _deriveEncryptionKey(password, encryptionSalt) {
    return crypto.scryptSync(
      'blink-vault-v2:' + String(password),
      String(encryptionSalt),
      32,
      { N: 16384, r: 8, p: 1 }
    );
  }

  // Transitional key used only once to seal pre-existing plaintext data before user's next login
  _deriveTransitionalKey(passwordHash, passwordSalt) {
    return crypto.scryptSync(
      'blink-migration-v1:' + String(passwordHash),
      String(passwordSalt),
      32,
      { N: 16384, r: 8, p: 1 }
    );
  }

  _encryptPayload(obj, keyBuffer) {
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 2,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    };
  }

  _decryptPayload(envelope, keyBuffer) {
    if (!envelope || !envelope.iv || !envelope.tag || !envelope.data) {
      throw new Error('Invalid encrypted vault envelope');
    }
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  _load() {
    const defaultSettings = this._getDefaultSettings();
    const defaultAuth = {
      isInitialized: false,
      passwordHash: '',
      passwordSalt: '',
      encryptionSalt: '',
      passwordHint: ''
    };

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);

        const auth = { ...defaultAuth, ...(parsed.auth || {}) };
        if (!auth.encryptionSalt) {
          auth.encryptionSalt = crypto.randomBytes(16).toString('hex');
        }
        const settings = { ...defaultSettings, ...(parsed.settings || {}) };

        const state = {
          auth,
          settings,
          encryptedVault: parsed.encryptedVault || null,
          legacySealedVault: parsed.legacySealedVault || null
        };

        // Seamless migration: if legacy plaintext categories/bookmarks exist on disk,
        // immediately seal them and wipe plaintext from disk!
        if (Array.isArray(parsed.categories) || Array.isArray(parsed.bookmarks)) {
          const legacyVault = {
            categories: Array.isArray(parsed.categories) ? parsed.categories : this._getDefaultVault().categories,
            bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : this._getDefaultVault().bookmarks
          };

          if (auth.isInitialized && auth.passwordHash && auth.passwordSalt) {
            const transKey = this._deriveTransitionalKey(auth.passwordHash, auth.passwordSalt);
            state.legacySealedVault = this._encryptPayload(legacyVault, transKey);
            transKey.fill(0);
          } else {
            this._pendingInitialVault = legacyVault;
          }

          this._writeStateToDisk(state);
        }

        return state;
      }
    } catch (err) {
      console.error('Failed to load store, initializing clean state:', err);
    }

    const initial = {
      auth: {
        ...defaultAuth,
        encryptionSalt: crypto.randomBytes(16).toString('hex')
      },
      settings: defaultSettings,
      encryptedVault: null,
      legacySealedVault: null
    };
    this._writeStateToDisk(initial);
    return initial;
  }

  _writeStateToDisk(stateToSave) {
    try {
      // Never write plaintext categories or bookmarks to disk
      const cleanDiskPayload = {
        auth: stateToSave.auth,
        settings: stateToSave.settings,
        encryptedVault: stateToSave.encryptedVault || null
      };
      if (stateToSave.legacySealedVault) {
        cleanDiskPayload.legacySealedVault = stateToSave.legacySealedVault;
      }
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(cleanDiskPayload, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('Failed to write encrypted store:', err);
    }
  }

  _save() {
    if (this.sessionKey && this.unlockedVault) {
      this.diskState.encryptedVault = this._encryptPayload(this.unlockedVault, this.sessionKey);
      this.diskState.legacySealedVault = null;
    }
    this._writeStateToDisk(this.diskState);
  }

  isUnlocked() {
    return Boolean(this.sessionKey && this.unlockedVault);
  }

  lock() {
    if (this.sessionKey && Buffer.isBuffer(this.sessionKey)) {
      this.sessionKey.fill(0);
    }
    this.sessionKey = null;
    if (this.unlockedVault) {
      this.unlockedVault.categories = [];
      this.unlockedVault.bookmarks = [];
      this.unlockedVault = null;
    }
  }

  hasPassword() {
    return Boolean(
      this.diskState.auth &&
      this.diskState.auth.isInitialized &&
      this.diskState.auth.passwordHash
    );
  }

  getAuthStatus() {
    return {
      isInitialized: this.hasPassword(),
      passwordHint: (this.diskState.auth && this.diskState.auth.passwordHint) || '',
      encryptionAlgorithm: 'AES-256-GCM (scrypt KDF)'
    };
  }

  setupPassword(password, hint = '') {
    if (!password || String(password).length < 1) {
      return { ok: false, error: '密码不能为空' };
    }
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const encryptionSalt = crypto.randomBytes(16).toString('hex');
    const hash = this._hashPassword(password, passwordSalt);

    if (this.sessionKey && Buffer.isBuffer(this.sessionKey)) {
      this.sessionKey.fill(0);
    }
    this.sessionKey = this._deriveEncryptionKey(password, encryptionSalt);

    if (!this.unlockedVault) {
      this.unlockedVault = this._pendingInitialVault || this._getDefaultVault();
      this._pendingInitialVault = null;
    }

    this.diskState.auth = {
      isInitialized: true,
      passwordHash: hash,
      passwordSalt,
      encryptionSalt,
      passwordHint: String(hint || '').trim()
    };

    this._save();
    return { ok: true };
  }

  verifyPassword(password) {
    if (!this.hasPassword()) return { ok: false, error: '尚未初始化密码' };
    if (!password) return { ok: false, error: '请输入密码' };

    try {
      const auth = this.diskState.auth;
      const expected = Buffer.from(auth.passwordHash, 'hex');
      const actual = Buffer.from(this._hashPassword(password, auth.passwordSalt), 'hex');
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return { ok: false, error: '密码不正确，请重试' };
      }

      if (!auth.encryptionSalt) {
        auth.encryptionSalt = crypto.randomBytes(16).toString('hex');
      }

      const derivedKey = this._deriveEncryptionKey(password, auth.encryptionSalt);

      if (this.diskState.encryptedVault) {
        this.unlockedVault = this._decryptPayload(this.diskState.encryptedVault, derivedKey);
        this.sessionKey = derivedKey;
      } else if (this.diskState.legacySealedVault) {
        // Migrate from transitional sealed vault to pure user-password-derived AES-256-GCM vault
        const transKey = this._deriveTransitionalKey(auth.passwordHash, auth.passwordSalt);
        this.unlockedVault = this._decryptPayload(this.diskState.legacySealedVault, transKey);
        transKey.fill(0);
        this.sessionKey = derivedKey;
        this._save(); // Re-encrypts with derivedKey and removes legacySealedVault permanently
      } else {
        this.unlockedVault = this._getDefaultVault();
        this.sessionKey = derivedKey;
        this._save();
      }

      return { ok: true };
    } catch (err) {
      console.error('Password verification / vault decryption error:', err);
      return { ok: false, error: '密码或加密库校验失败，请重试' };
    }
  }

  changePassword(oldPassword, newPassword, newHint = '') {
    const check = this.verifyPassword(oldPassword);
    if (!check.ok) {
      return { ok: false, error: '原密码输入错误' };
    }
    if (!newPassword || String(newPassword).length < 1) {
      return { ok: false, error: '新密码不能为空' };
    }
    return this.setupPassword(newPassword, newHint);
  }

  getSettings() {
    return { ...this.diskState.settings };
  }

  getAllData() {
    if (!this.isUnlocked()) {
      return {
        locked: true,
        settings: { ...this.diskState.settings },
        categories: [],
        bookmarks: [],
        auth: this.getAuthStatus()
      };
    }

    const categories = [...(this.unlockedVault.categories || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const bookmarks = [...(this.unlockedVault.bookmarks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return {
      locked: false,
      settings: { ...this.diskState.settings },
      categories,
      bookmarks,
      auth: this.getAuthStatus()
    };
  }

  updateSettings(partial) {
    this.diskState.settings = {
      ...this.diskState.settings,
      ...partial
    };
    this._writeStateToDisk(this.diskState);
    return this.diskState.settings;
  }

  // Category CRUD (requires unlocked vault)
  saveCategory(cat) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    if (!cat || !cat.name || !String(cat.name).trim()) {
      return { ok: false, error: '分类名称不能为空' };
    }
    const cleanName = String(cat.name).trim();
    const color = cat.color || 'indigo';

    if (cat.id) {
      const idx = this.unlockedVault.categories.findIndex(c => c.id === cat.id);
      if (idx !== -1) {
        this.unlockedVault.categories[idx] = {
          ...this.unlockedVault.categories[idx],
          name: cleanName,
          color
        };
        this._save();
        return { ok: true, category: this.unlockedVault.categories[idx], data: this.getAllData() };
      }
    }

    const newCat = {
      id: 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: cleanName,
      color,
      order: this.unlockedVault.categories.length,
      createdAt: Date.now()
    };
    this.unlockedVault.categories.push(newCat);
    this._save();
    return { ok: true, category: newCat, data: this.getAllData() };
  }

  deleteCategory(categoryId, deleteBookmarksInside = false) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    const idx = this.unlockedVault.categories.findIndex(c => c.id === categoryId);
    if (idx === -1) return { ok: false, error: '未找到该分类' };

    this.unlockedVault.categories.splice(idx, 1);

    if (deleteBookmarksInside) {
      this.unlockedVault.bookmarks = this.unlockedVault.bookmarks.filter(b => b.categoryId !== categoryId);
    } else {
      // Keep bookmarks and automatically place them in "全部" as uncategorized (未分类)
      this.unlockedVault.bookmarks.forEach(b => {
        if (b.categoryId === categoryId) {
          b.categoryId = '';
        }
      });
    }

    this._save();
    return { ok: true, data: this.getAllData() };
  }

  reorderCategories(orderedIds) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    if (!Array.isArray(orderedIds)) return { ok: false };
    const map = new Map(orderedIds.map((id, index) => [id, index]));
    this.unlockedVault.categories.forEach(cat => {
      if (map.has(cat.id)) {
        cat.order = map.get(cat.id);
      }
    });
    this._save();
    return { ok: true, data: this.getAllData() };
  }

  // Bookmark CRUD (requires unlocked vault)
  saveBookmark(bm) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    if (!bm || !bm.title || !String(bm.title).trim()) {
      return { ok: false, error: '请输入书签的备注名称' };
    }
    if (!bm.url || !String(bm.url).trim()) {
      return { ok: false, error: '请输入书签的链接地址' };
    }

    let cleanUrl = String(bm.url).trim();
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const cleanTitle = String(bm.title).trim();
    const cleanNote = String(bm.note || '').trim();
    const color = bm.color || 'indigo';
    const categoryId = (bm.categoryId !== undefined && bm.categoryId !== null)
      ? String(bm.categoryId)
      : (this.unlockedVault.categories[0] ? this.unlockedVault.categories[0].id : '');

    if (bm.id) {
      const idx = this.unlockedVault.bookmarks.findIndex(item => item.id === bm.id);
      if (idx !== -1) {
        this.unlockedVault.bookmarks[idx] = {
          ...this.unlockedVault.bookmarks[idx],
          title: cleanTitle,
          note: cleanNote,
          url: cleanUrl,
          categoryId,
          color,
          pinned: Boolean(bm.pinned)
        };
        this._save();
        return { ok: true, bookmark: this.unlockedVault.bookmarks[idx], data: this.getAllData() };
      }
    }

    const maxOrder = this.unlockedVault.bookmarks.reduce((max, item) => Math.max(max, item.order ?? 0), -1);
    const newBm = {
      id: 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title: cleanTitle,
      note: cleanNote,
      url: cleanUrl,
      categoryId,
      color,
      pinned: Boolean(bm.pinned),
      order: maxOrder + 1,
      createdAt: Date.now()
    };

    this.unlockedVault.bookmarks.push(newBm);
    this._save();
    return { ok: true, bookmark: newBm, data: this.getAllData() };
  }

  deleteBookmarks(ids) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    this.unlockedVault.bookmarks = this.unlockedVault.bookmarks.filter(b => !idSet.has(b.id));
    this._save();
    return { ok: true, data: this.getAllData() };
  }

  reorderBookmarks(orderedIds, targetCategoryId = null) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    if (!Array.isArray(orderedIds)) return { ok: false };
    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));

    this.unlockedVault.bookmarks.forEach(b => {
      if (orderMap.has(b.id)) {
        b.order = orderMap.get(b.id);
        if (targetCategoryId && b.id === orderedIds._movedId) {
          b.categoryId = targetCategoryId;
        }
      }
    });

    this._save();
    return { ok: true, data: this.getAllData() };
  }

  moveBookmarkOrderAndCategory(movedId, orderedIds, newCategoryId) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    if (newCategoryId !== undefined && newCategoryId !== null) {
      const target = this.unlockedVault.bookmarks.find(b => b.id === movedId);
      if (target) {
        target.categoryId = newCategoryId === 'UNCATEGORIZED' ? '' : String(newCategoryId);
      }
    }
    if (Array.isArray(orderedIds)) {
      const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
      this.unlockedVault.bookmarks.forEach(b => {
        if (orderMap.has(b.id)) {
          b.order = orderMap.get(b.id);
        }
      });
    }
    this._save();
    return { ok: true, data: this.getAllData() };
  }

  moveBookmarkToTop(bookmarkId) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    const minOrder = this.unlockedVault.bookmarks.reduce((min, item) => Math.min(min, item.order ?? 0), 0);
    const target = this.unlockedVault.bookmarks.find(b => b.id === bookmarkId);
    if (target) {
      target.order = minOrder - 1;
      const sorted = [...this.unlockedVault.bookmarks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      sorted.forEach((b, idx) => { b.order = idx; });
      this._save();
    }
    return { ok: true, data: this.getAllData() };
  }

  // Additive Import (每次导入都是新增，绝不覆盖现有书签)
  importBookmarksAdditive(parsedItems, options = {}) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    const palette = ['indigo', 'emerald', 'amber', 'violet', 'rose', 'cyan', 'pink', 'teal'];
    let addedBookmarks = 0;
    let addedCategories = 0;

    const categoryNameMap = new Map();
    this.unlockedVault.categories.forEach(c => {
      categoryNameMap.set(c.name.toLowerCase(), c);
    });

    let maxOrder = this.unlockedVault.bookmarks.reduce((max, item) => Math.max(max, item.order ?? 0), -1);
    const now = Date.now();

    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      if (!item.url || !item.title) continue;

      const folderName = (item.folder && String(item.folder).trim()) || options.defaultFolderName || '导入书签';
      let cat = categoryNameMap.get(folderName.toLowerCase());

      if (!cat) {
        const color = palette[(this.unlockedVault.categories.length + addedCategories) % palette.length];
        cat = {
          id: 'cat_imp_' + now + '_' + addedCategories + '_' + Math.random().toString(36).slice(2, 5),
          name: folderName,
          color,
          order: this.unlockedVault.categories.length,
          createdAt: now
        };
        this.unlockedVault.categories.push(cat);
        categoryNameMap.set(folderName.toLowerCase(), cat);
        addedCategories++;
      }

      maxOrder++;
      const newBm = {
        id: 'bm_imp_' + now + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
        title: String(item.title).trim(),
        note: item.note ? String(item.note).trim() : '',
        url: String(item.url).trim(),
        categoryId: cat.id,
        color: cat.color || palette[i % palette.length],
        pinned: false,
        order: maxOrder,
        createdAt: now + i
      };

      this.unlockedVault.bookmarks.push(newBm);
      addedBookmarks++;
    }

    this._save();
    return {
      ok: true,
      addedBookmarks,
      addedCategories,
      data: this.getAllData()
    };
  }
}

module.exports = { StorageManager };
