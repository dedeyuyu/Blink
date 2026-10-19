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

module.exports = {
  parseBookmarkHtml,
  parseBookmarkHtmlFile
};

