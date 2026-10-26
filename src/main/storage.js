const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_COLORS = new Set(['indigo', 'emerald', 'amber', 'rose', 'violet', 'cyan', 'pink', 'teal']);

function sanitizeColor(color) {
  const c = String(color || '').trim().toLowerCase();
  return ALLOWED_COLORS.has(c) ? c : 'indigo';
}

function normalizeSafeHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let candidate = rawUrl.trim();
  if (!candidate) return null;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate)) {
    candidate = 'https://' + candidate;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

class StorageManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.filePath = path.join(this.dataDir, 'blink-store.json');
    this.backupFilePath = path.join(this.dataDir, 'blink-store.backup.json');
    this.sessionKey = null; // 32-byte Buffer derived from user's password via scrypt (only in RAM while unlocked)
    this.unlockedVault = null; // { categories: [], bookmarks: [] } (only in RAM while unlocked)
    this.failedAuthAttempts = 0;
    this.authLockoutUntil = 0;
    this.diskState = this._load();
  }

  _getDefaultSettings() {
    return {
      theme: 'dark',
      alwaysOnTop: true,
      autoCollapseOnBlur: true,
      keepExpanded: true,
      closeToOrb: true,
      openMode: 'auto',
      fontSize: 'normal',
      fontScale: 100,
      cardLayout: 'list',
      panelBounds: { width: 400, height: 650, x: null, y: null },
      orbPosition: { x: null, y: null }
    };
  }

  _getDefaultVault() {
    return {
      categories: [],
      bookmarks: []
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
    try {
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        v: 2,
        alg: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64')
      };
    } finally {
      plaintext.fill(0);
    }
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
    try {
      return JSON.parse(decrypted.toString('utf8'));
    } finally {
      decrypted.fill(0);
    }
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

    const candidatePaths = [this.filePath, this.backupFilePath];
    for (const candidatePath of candidatePaths) {
      try {
        if (candidatePath && fs.existsSync(candidatePath)) {
          const raw = fs.readFileSync(candidatePath, 'utf-8');
          const parsed = JSON.parse(raw);

          const auth = { ...defaultAuth, ...(parsed.auth || {}) };
          if (!auth.encryptionSalt) {
            auth.encryptionSalt = crypto.randomBytes(16).toString('hex');
          }
          const settings = { ...defaultSettings, ...(parsed.settings || {}) };
          if (typeof settings.closeToOrb !== 'boolean') {
            settings.closeToOrb = true;
          }
          if (!Number.isFinite(settings.fontScale)) {
            settings.fontScale = settings.fontSize === 'large' ? 115 : 100;
          } else {
            settings.fontScale = Math.max(70, Math.min(180, Math.round(settings.fontScale)));
          }

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
          } else if (candidatePath === this.backupFilePath) {
            // Restored from backup file -> write back primary store immediately
            this._writeStateToDisk(state);
          }

          return state;
        }
      } catch (err) {
        console.error(`Failed to load store from ${candidatePath}:`, err);
      }
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
      const serialized = JSON.stringify(cleanDiskPayload, null, 2);
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, serialized, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);

      // Keep automatic redundant backup whenever an initialized encrypted vault is present
      if (cleanDiskPayload.auth && cleanDiskPayload.auth.isInitialized && cleanDiskPayload.encryptedVault) {
        try {
          const bakTmp = this.backupFilePath + '.tmp';
          fs.writeFileSync(bakTmp, serialized, 'utf-8');
          fs.renameSync(bakTmp, this.backupFilePath);
        } catch {}
      }
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

    const now = Date.now();
    if (this.authLockoutUntil > now) {
      const waitSec = Math.ceil((this.authLockoutUntil - now) / 1000);
      return { ok: false, error: `密码连续错误次数过多，请等待 ${waitSec} 秒后再试` };
    }

    let derivedKey = null;
    try {
      const auth = this.diskState.auth;
      const expected = Buffer.from(auth.passwordHash, 'hex');
      const actual = Buffer.from(this._hashPassword(password, auth.passwordSalt), 'hex');
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        this.failedAuthAttempts = (this.failedAuthAttempts || 0) + 1;
        if (this.failedAuthAttempts >= 5) {
          this.authLockoutUntil = Date.now() + 30 * 1000;
          return { ok: false, error: '密码连续错误 5 次，已临时锁定 30 秒' };
        }
        return { ok: false, error: '密码不正确，请重试' };
      }

      this.failedAuthAttempts = 0;
      this.authLockoutUntil = 0;

      if (!auth.encryptionSalt) {
        auth.encryptionSalt = crypto.randomBytes(16).toString('hex');
      }

      derivedKey = this._deriveEncryptionKey(password, auth.encryptionSalt);

      if (this.diskState.encryptedVault) {
        this.unlockedVault = this._decryptPayload(this.diskState.encryptedVault, derivedKey);
        this.sessionKey = derivedKey;
      } else if (this.diskState.legacySealedVault) {
        // Migrate from transitional sealed vault to pure user-password-derived AES-256-GCM vault
        const transKey = this._deriveTransitionalKey(auth.passwordHash, auth.passwordSalt);
        try {
          this.unlockedVault = this._decryptPayload(this.diskState.legacySealedVault, transKey);
        } finally {
          transKey.fill(0);
        }
        this.sessionKey = derivedKey;
        this._save(); // Re-encrypts with derivedKey and removes legacySealedVault permanently
      } else {
        this.unlockedVault = this._getDefaultVault();
        this.sessionKey = derivedKey;
        this._save();
      }

      // Remove hardcoded demo bookmarks (bm_demo_1, bm_demo_2, bm_demo_3) if present, while preserving 100% of user bookmarks
      if (this.unlockedVault && Array.isArray(this.unlockedVault.bookmarks)) {
        const DEMO_IDS = new Set(['bm_demo_1', 'bm_demo_2', 'bm_demo_3']);
        const beforeCount = this.unlockedVault.bookmarks.length;
        this.unlockedVault.bookmarks = this.unlockedVault.bookmarks.filter(
          b => b && !DEMO_IDS.has(b.id)
        );
        if (this.unlockedVault.bookmarks.length !== beforeCount) {
          this._save();
        }
      }

      return { ok: true };
    } catch (err) {
      if (derivedKey && Buffer.isBuffer(derivedKey) && this.sessionKey !== derivedKey) {
        derivedKey.fill(0);
      }
      console.error('Password verification / vault decryption error:', err);
      return { ok: false, error: '密码或加密库校验失败，请重试' };
    }
  }

  changePassword(oldPassword, newPassword, newHint = '') {
    const check = this.verifyPassword(oldPassword);
    if (!check.ok) {
      return { ok: false, error: check.error || '原密码输入错误' };
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
    if (!partial || typeof partial !== 'object') {
      return this.diskState.settings;
    }
    const next = { ...this.diskState.settings };
    if (partial.theme === 'light' || partial.theme === 'dark') {
      next.theme = partial.theme;
    }
    if (typeof partial.alwaysOnTop === 'boolean') {
      next.alwaysOnTop = partial.alwaysOnTop;
    }
    if (typeof partial.autoCollapseOnBlur === 'boolean') {
      next.autoCollapseOnBlur = partial.autoCollapseOnBlur;
    }
    if (typeof partial.keepExpanded === 'boolean') {
      next.keepExpanded = partial.keepExpanded;
    }
    if (typeof partial.closeToOrb === 'boolean') {
      next.closeToOrb = partial.closeToOrb;
    }
    if (partial.openMode === 'auto' || partial.openMode === 'hotkey' || partial.openMode === 'cmdline') {
      next.openMode = partial.openMode;
    }
    if (partial.fontSize === 'normal' || partial.fontSize === 'large') {
      next.fontSize = partial.fontSize;
    }
    if (Number.isFinite(partial.fontScale)) {
      next.fontScale = Math.max(70, Math.min(180, Math.round(partial.fontScale)));
      next.fontSize = next.fontScale >= 110 ? 'large' : 'normal';
    }
    if (partial.panelBounds && typeof partial.panelBounds === 'object') {
      const pb = partial.panelBounds;
      next.panelBounds = {
        width: Number.isFinite(pb.width) ? Math.round(pb.width) : 400,
        height: Number.isFinite(pb.height) ? Math.round(pb.height) : 650,
        x: Number.isFinite(pb.x) ? Math.round(pb.x) : null,
        y: Number.isFinite(pb.y) ? Math.round(pb.y) : null
      };
    }
    if (partial.orbPosition && typeof partial.orbPosition === 'object') {
      const op = partial.orbPosition;
      next.orbPosition = {
        x: Number.isFinite(op.x) ? Math.round(op.x) : null,
        y: Number.isFinite(op.y) ? Math.round(op.y) : null
      };
    }
    this.diskState.settings = next;
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
    const color = sanitizeColor(cat.color);

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
    this.unlockedVault.categories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.unlockedVault.categories.forEach((cat, idx) => { cat.order = idx; });
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

    const cleanUrl = normalizeSafeHttpUrl(String(bm.url));
    if (!cleanUrl) {
      return { ok: false, error: '仅支持有效的 http:// 或 https:// 网页链接' };
    }

    const cleanTitle = String(bm.title).trim();
    const cleanNote = String(bm.note || '').trim();
    const color = sanitizeColor(bm.color);
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
    const target = this.unlockedVault.bookmarks.find(b => b.id === movedId);
    if (newCategoryId !== undefined && newCategoryId !== null && target) {
      target.categoryId = newCategoryId === 'UNCATEGORIZED' ? '' : String(newCategoryId);
    }

    if (Array.isArray(orderedIds) && orderedIds.length > 0) {
      const bmById = new Map(this.unlockedVault.bookmarks.map(b => [b.id, b]));

      // Sync pinned state if movedId crossed the boundary between pinned and unpinned items
      if (target) {
        const movedPos = orderedIds.indexOf(movedId);
        if (movedPos !== -1) {
          const hasPinnedAfter = orderedIds.slice(movedPos + 1).some(id => bmById.get(id)?.pinned);
          const hasUnpinnedBefore = orderedIds.slice(0, movedPos).some(id => bmById.get(id) && !bmById.get(id).pinned);
          if (hasPinnedAfter && !target.pinned) {
            target.pinned = true;
          } else if (hasUnpinnedBefore && target.pinned) {
            target.pinned = false;
          }
        }
      }

      // Merge subset order (e.g. within a category) or full order into the global sorted list
      const fullSorted = [...this.unlockedVault.bookmarks].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) {
          return a.pinned ? -1 : 1;
        }
        return (a.order ?? 0) - (b.order ?? 0);
      });

      const subsetSet = new Set(orderedIds);
      const orderedItems = orderedIds.map(id => bmById.get(id)).filter(Boolean);
      let takeIdx = 0;

      for (let i = 0; i < fullSorted.length; i++) {
        if (subsetSet.has(fullSorted[i].id) && takeIdx < orderedItems.length) {
          fullSorted[i] = orderedItems[takeIdx++];
        }
      }

      fullSorted.forEach((b, idx) => {
        b.order = idx;
      });
      this.unlockedVault.bookmarks = fullSorted;
    }

    this._save();
    return { ok: true, data: this.getAllData() };
  }

  moveBookmarkToTop(bookmarkId) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    const minOrder = this.unlockedVault.bookmarks.reduce((min, item) => Math.min(min, item.order ?? 0), 0);
    const target = this.unlockedVault.bookmarks.find(b => b.id === bookmarkId);
    if (target) {
      const hasAnyPinned = this.unlockedVault.bookmarks.some(
        b => b.id !== bookmarkId && b.pinned && (b.categoryId === target.categoryId || !target.categoryId)
      );
      if (hasAnyPinned) {
        target.pinned = true;
      }
      target.order = minOrder - 1;
      const sorted = [...this.unlockedVault.bookmarks].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) {
          return a.pinned ? -1 : 1;
        }
        return (a.order ?? 0) - (b.order ?? 0);
      });
      sorted.forEach((b, idx) => { b.order = idx; });
      this.unlockedVault.bookmarks = sorted;
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
      if (!item || !item.url || !item.title) continue;

      const safeUrl = normalizeSafeHttpUrl(String(item.url));
      if (!safeUrl) continue;

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
        url: safeUrl,
        categoryId: cat.id,
        color: sanitizeColor(cat.color || palette[i % palette.length]),
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

  // Export all categories & bookmarks for cross-computer migration
  getExportPayload() {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁后再导出' };
    const categories = [...this.unlockedVault.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const bookmarks = [...this.unlockedVault.bookmarks].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      return (a.order ?? 0) - (b.order ?? 0);
    });
    return {
      ok: true,
      categories,
      bookmarks
    };
  }

  // Lossless Import from Blink Backup File (恢复全部分类夹、颜色、备注、置顶与排序，不覆盖已有书签)
  importBlinkBackup(backupPayload, options = {}) {
    if (!this.isUnlocked()) return { ok: false, error: '书签库已上锁，请先解锁' };
    if (!backupPayload || !Array.isArray(backupPayload.bookmarks)) {
      return { ok: false, error: '无效的 Blink 书签备份文件' };
    }

    const palette = ['indigo', 'emerald', 'amber', 'violet', 'rose', 'cyan', 'pink', 'teal'];
    let addedBookmarks = 0;
    let addedCategories = 0;
    const now = Date.now();

    const categoryNameMap = new Map();
    this.unlockedVault.categories.forEach(c => {
      if (c && c.name) {
        categoryNameMap.set(String(c.name).trim().toLowerCase(), c);
      }
    });

    const oldCatIdToNewId = new Map();
    const rawCategories = Array.isArray(backupPayload.categories)
      ? [...backupPayload.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      : [];

    for (let i = 0; i < rawCategories.length; i++) {
      const srcCat = rawCategories[i];
      if (!srcCat || !srcCat.name || !String(srcCat.name).trim()) continue;
      const cleanName = String(srcCat.name).trim();
      const key = cleanName.toLowerCase();

      let targetCat = categoryNameMap.get(key);
      if (!targetCat) {
        targetCat = {
          id: 'cat_bak_' + now + '_' + addedCategories + '_' + Math.random().toString(36).slice(2, 6),
          name: cleanName,
          color: sanitizeColor(srcCat.color || palette[(this.unlockedVault.categories.length + addedCategories) % palette.length]),
          order: this.unlockedVault.categories.length,
          createdAt: Number(srcCat.createdAt) || now
        };
        this.unlockedVault.categories.push(targetCat);
        categoryNameMap.set(key, targetCat);
        addedCategories++;
      }

      if (srcCat.id) {
        oldCatIdToNewId.set(String(srcCat.id), targetCat.id);
      }
    }

    // Optional override folder if user specified one for uncategorized items
    let fallbackCat = null;
    if (options.defaultFolderName && String(options.defaultFolderName).trim()) {
      const fbName = String(options.defaultFolderName).trim();
      const fbKey = fbName.toLowerCase();
      fallbackCat = categoryNameMap.get(fbKey);
      if (!fallbackCat) {
        fallbackCat = {
          id: 'cat_bak_' + now + '_' + addedCategories + '_' + Math.random().toString(36).slice(2, 6),
          name: fbName,
          color: palette[(this.unlockedVault.categories.length + addedCategories) % palette.length],
          order: this.unlockedVault.categories.length,
          createdAt: now
        };
        this.unlockedVault.categories.push(fallbackCat);
        categoryNameMap.set(fbKey, fallbackCat);
        addedCategories++;
      }
    }

    let maxOrder = this.unlockedVault.bookmarks.reduce((max, item) => Math.max(max, item.order ?? 0), -1);
    const sortedBookmarks = [...backupPayload.bookmarks].sort((a, b) => {
      if (Boolean(a?.pinned) !== Boolean(b?.pinned)) {
        return a?.pinned ? -1 : 1;
      }
      return (a?.order ?? 0) - (b?.order ?? 0);
    });

    for (let i = 0; i < sortedBookmarks.length; i++) {
      const item = sortedBookmarks[i];
      if (!item || !item.url) continue;
      const safeUrl = normalizeSafeHttpUrl(String(item.url));
      if (!safeUrl) continue;

      const cleanTitle = (item.title && String(item.title).trim()) || safeUrl;
      const cleanNote = item.note ? String(item.note).trim() : '';

      let resolvedCategoryId = '';
      if (item.categoryId && oldCatIdToNewId.has(String(item.categoryId))) {
        resolvedCategoryId = oldCatIdToNewId.get(String(item.categoryId));
      } else if (fallbackCat) {
        resolvedCategoryId = fallbackCat.id;
      }

      maxOrder++;
      const newBm = {
        id: 'bm_bak_' + now + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
        title: cleanTitle,
        note: cleanNote,
        url: safeUrl,
        categoryId: resolvedCategoryId,
        color: sanitizeColor(item.color || palette[i % palette.length]),
        pinned: Boolean(item.pinned),
        order: maxOrder,
        createdAt: Number(item.createdAt) || (now + i)
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

module.exports = { StorageManager, normalizeSafeHttpUrl, sanitizeColor };

