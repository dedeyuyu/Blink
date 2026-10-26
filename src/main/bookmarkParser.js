const fs = require('fs');

const MAX_BOOKMARK_FILE_BYTES = 32 * 1024 * 1024; // 32 MB max import file size
const MAX_LINE_LENGTH = 32768; // Guard against regex backtracking on giant single-line payloads

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html) {
  if (!html) return '';
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, '')).trim();
}

/**
 * Parses Netscape-Bookmark-file-1 HTML exported by Chrome, Brave, Edge, Firefox, etc.
 * Returns an array of { title, url, folder, note }
 */
function parseBookmarkHtml(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') return [];
  if (htmlContent.length > MAX_BOOKMARK_FILE_BYTES) {
    throw new Error('书签文件体积过大（超过 32MB 限制）');
  }

  const results = [];
  const folderStack = [];
  const lines = htmlContent.split(/\r?\n/);

  let lastFolderHeader = null;
  let lastBookmark = null;

  const genericRoots = new Set([
    'bookmarks bar', '书签栏', '收藏夹栏', 'bookmarks', '书签',
    'other bookmarks', '其他书签', '其它书签', 'mobile bookmarks', '移动设备书签',
    'menu', '书签菜单', 'favorites bar'
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length > MAX_LINE_LENGTH) continue;

    // Check for folder opening <H3 ...>Folder Name</H3>
    const h3Match = line.match(/<H3[^>]*>([\s\S]*?)<\/H3>/i);
    if (h3Match) {
      lastFolderHeader = stripTags(h3Match[1]) || '未命名文件夹';
    }

    // Check if a <DL> opens on this line
    if (/<DL\b/i.test(line)) {
      if (lastFolderHeader !== null) {
        folderStack.push(lastFolderHeader);
        lastFolderHeader = null;
      } else {
        folderStack.push('');
      }
    }

    // Check for bookmark link <A HREF="...">Title</A>
    const aMatch = line.match(/<A\b([^>]*)>([\s\S]*?)<\/A>/i);
    if (aMatch) {
      const attrs = aMatch[1] || '';
      const rawTitle = stripTags(aMatch[2]);
      const hrefMatch = attrs.match(/\bHREF\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const rawHref = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '') : '';
      const url = decodeHtmlEntities(rawHref).trim();

      if (url && /^https?:\/\//i.test(url)) {
        // Determine effective category name from folderStack
        const meaningfulFolders = folderStack.filter(f => f && !genericRoots.has(f.toLowerCase()));
        let folderName = '浏览器导入';
        if (meaningfulFolders.length > 0) {
          folderName = meaningfulFolders[meaningfulFolders.length - 1];
        } else {
          const nonEmpty = folderStack.filter(Boolean);
          if (nonEmpty.length > 0) {
            folderName = nonEmpty[nonEmpty.length - 1];
          }
        }

        const item = {
          title: rawTitle || url,
          url,
          folder: folderName,
          note: ''
        };
        results.push(item);
        lastBookmark = item;
      }
    }

    // Check for <DD> description following a bookmark
    const ddMatch = line.match(/<DD>([\s\S]*?)(?:<\/DD>|$)/i);
    if (ddMatch && lastBookmark && !/<(DT|H3|DL|A)\b/i.test(line)) {
      const desc = stripTags(ddMatch[1]);
      if (desc) {
        lastBookmark.note = desc;
      }
    }

    // Check if </DL> closes on this line
    if (/<\/DL>/i.test(line)) {
      if (folderStack.length > 0) {
        folderStack.pop();
      }
      lastFolderHeader = null;
    }
  }

  return results;
}

function parseBookmarkHtmlFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BOOKMARK_FILE_BYTES) {
    throw new Error('所选书签文件体积超过 32MB 安全上限');
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseBookmarkHtml(content);
}

function escapeHtmlEntities(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Checks if raw file content (either .html with embedded BLINK-BACKUP-DATA meta tag or .json backup)
 * contains a full lossless Blink backup payload ({ categories, bookmarks }).
 * Returns { categories, bookmarks } if detected, or null otherwise.
 */
function parseBlinkBackupFromContent(content) {
  if (!content || typeof content !== 'string') return null;
  if (content.length > MAX_BOOKMARK_FILE_BYTES) {
    throw new Error('备份文件体积超过 32MB 安全上限');
  }

  const trimmed = content.trim();

  // 1. Check if it is a JSON backup file
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && Array.isArray(parsed.bookmarks)) {
        return {
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
          bookmarks: parsed.bookmarks
        };
      }
    } catch {
      // Not valid JSON, continue checking HTML meta tag
    }
  }

  // 2. Check if it is a Blink-exported HTML file with <META NAME="BLINK-BACKUP-DATA" CONTENT="...">
  const metaMatch = content.match(/<META\s+NAME=["']BLINK-BACKUP-DATA["']\s+CONTENT=["']([A-Za-z0-9+/=]+)["']\s*\/?>/i);
  if (metaMatch && metaMatch[1]) {
    try {
      const jsonStr = Buffer.from(metaMatch[1], 'base64').toString('utf-8');
      const parsed = JSON.parse(jsonStr);
      if (parsed && Array.isArray(parsed.bookmarks)) {
        return {
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
          bookmarks: parsed.bookmarks
        };
      }
    } catch {
      // Fallback to standard HTML bookmark parser
    }
  }

  return null;
}

/**
 * Generates a dual-compatible Netscape-Bookmark-file-1 HTML file that:
 * 1) Embeds 100% lossless Blink metadata (categories, colors, order, notes, pinned state) in <META NAME="BLINK-BACKUP-DATA">
 * 2) Renders standard <DL>/<DT>/<H3>/<A>/<DD> structure compatible with Chrome, Edge, Brave, Firefox, Safari, etc.
 */
function generateBlinkExportHtml(categories = [], bookmarks = [], appVersion = '1.0.1') {
  const nowSec = Math.floor(Date.now() / 1000);
  const backupPayload = {
    app: 'Blink',
    format: 'blink-backup-v1',
    version: appVersion,
    exportedAt: new Date().toISOString(),
    categories,
    bookmarks
  };
  const base64Payload = Buffer.from(JSON.stringify(backupPayload), 'utf-8').toString('base64');

  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated backup file by Blink (灵动书签).',
    '     Can be imported directly into Blink on a new computer (restores all categories, colors, notes & order)',
    '     or imported into Chrome / Edge / Brave / Safari. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<META NAME="BLINK-BACKUP-DATA" CONTENT="${base64Payload}">`,
    '<TITLE>Blink 灵动书签备份</TITLE>',
    '<H1>Blink 灵动书签备份</H1>',
    '<DL><p>'
  ];

  const byCat = new Map();
  const uncategorized = [];
  const validCatIds = new Set(categories.map(c => c.id));

  for (const bm of bookmarks) {
    if (!bm || !bm.url) continue;
    if (bm.categoryId && validCatIds.has(bm.categoryId)) {
      if (!byCat.has(bm.categoryId)) byCat.set(bm.categoryId, []);
      byCat.get(bm.categoryId).push(bm);
    } else {
      uncategorized.push(bm);
    }
  }

  for (const cat of categories) {
    if (!cat || !cat.name) continue;
    const catAddDate = cat.createdAt ? Math.floor(Number(cat.createdAt) / 1000) : nowSec;
    lines.push(`    <DT><H3 ADD_DATE="${catAddDate}" LAST_MODIFIED="${nowSec}" BLINK_COLOR="${escapeHtmlEntities(cat.color || 'indigo')}">${escapeHtmlEntities(cat.name)}</H3>`);
    lines.push('    <DL><p>');
    const items = byCat.get(cat.id) || [];
    for (const bm of items) {
      const addDate = bm.createdAt ? Math.floor(Number(bm.createdAt) / 1000) : nowSec;
      const pinnedAttr = bm.pinned ? ' BLINK_PINNED="1"' : '';
      const colorAttr = bm.color ? ` BLINK_COLOR="${escapeHtmlEntities(bm.color)}"` : '';
      lines.push(`        <DT><A HREF="${escapeHtmlEntities(bm.url)}" ADD_DATE="${addDate}"${colorAttr}${pinnedAttr}>${escapeHtmlEntities(bm.title || bm.url)}</A>`);
      if (bm.note && String(bm.note).trim()) {
        lines.push(`        <DD>${escapeHtmlEntities(String(bm.note).trim())}`);
      }
    }
    lines.push('    </DL><p>');
  }

  for (const bm of uncategorized) {
    const addDate = bm.createdAt ? Math.floor(Number(bm.createdAt) / 1000) : nowSec;
    const pinnedAttr = bm.pinned ? ' BLINK_PINNED="1"' : '';
    const colorAttr = bm.color ? ` BLINK_COLOR="${escapeHtmlEntities(bm.color)}"` : '';
    lines.push(`    <DT><A HREF="${escapeHtmlEntities(bm.url)}" ADD_DATE="${addDate}"${colorAttr}${pinnedAttr}>${escapeHtmlEntities(bm.title || bm.url)}</A>`);
    if (bm.note && String(bm.note).trim()) {
      lines.push(`    <DD>${escapeHtmlEntities(String(bm.note).trim())}`);
    }
  }

  lines.push('</DL><p>');
  lines.push('');
  return lines.join('\r\n');
}

function generateBlinkExportJson(categories = [], bookmarks = [], appVersion = '1.0.1') {
  return JSON.stringify(
    {
      app: 'Blink',
      format: 'blink-backup-v1',
      version: appVersion,
      exportedAt: new Date().toISOString(),
      categories,
      bookmarks
    },
    null,
    2
  );
}

module.exports = {
  parseBookmarkHtml,
  parseBookmarkHtmlFile,
  parseBlinkBackupFromContent,
  generateBlinkExportHtml,
  generateBlinkExportJson
};


