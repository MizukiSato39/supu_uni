// ===========================
//  build.mjs
//  スプリング☆ユニバース
//  静的サイトジェネレーター
//
//  使い方:
//    node scripts/build.mjs
//
//  必要なもの:
//    Node.js 18+ (fs/path/process はネイティブ)
//    npm install gray-matter  ← Frontmatterパーサー
// ===========================

import fs   from 'fs';
import path from 'path';

// ===========================
//  パス定義
// ===========================

const ROOT      = path.resolve(process.cwd());
const CONTENT   = path.join(ROOT, 'content');
const TEMPLATES = path.join(ROOT, 'templates');
const PUBLIC    = path.join(ROOT, 'public');
const DIST      = path.join(ROOT, 'dist');

// ===========================
//  Frontmatter パーサー
//  gray-matter を使用
// ===========================

async function loadGrayMatter() {
  // 1. 通常のnpm installで入っている場合
  // 2. 既存グローバルパッケージ内のgray-matterを使う場合
  const candidates = [
    'gray-matter',
    '/home/claude/.npm-global/lib/node_modules/markdown-toc/node_modules/gray-matter/index.js',
  ];
  for (const mod of candidates) {
    try {
      const { default: gm } = await import(mod);
      return gm;
    } catch { /* 次を試す */ }
  }
  console.error('❌ gray-matter が見つかりません。\n   npm install gray-matter を実行してください。');
  process.exit(1);
}

// ===========================
//  Markdown → HTML 変換
//  （自作パーサー）
// ===========================

function renderMarkdown(content) {
  if (!content) return '';
  const lines = content.split('\n');
  let html = '';
  let inOl  = false;
  let inUl  = false;

  const close = () => {
    if (inOl) { html += '</ol>\n'; inOl = false; }
    if (inUl) { html += '</ul>\n'; inUl = false; }
  };

  for (const raw of lines) {
    const line = raw;

    if (line.startsWith('### ')) {
      close();
      html += `<h3>${esc(line.slice(4))}</h3>\n`;
    } else if (line.startsWith('## ')) {
      close();
      html += `<h2>${esc(line.slice(3))}</h2>\n`;
    } else if (line.startsWith('# ')) {
      close();
      html += `<h1>${esc(line.slice(2))}</h1>\n`;
    } else if (/^\d+\.\s/.test(line)) {
      if (inUl) { html += '</ul>\n'; inUl = false; }
      if (!inOl) { html += '<ol>\n'; inOl = true; }
      html += `  <li>${esc(line.replace(/^\d+\.\s/, ''))}</li>\n`;
    } else if (line.startsWith('- ')) {
      if (inOl) { html += '</ol>\n'; inOl = false; }
      if (!inUl) { html += '<ul>\n'; inUl = true; }
      html += `  <li>${esc(line.slice(2))}</li>\n`;
    } else if (line.trim() === '') {
      close();
      html += '\n';
    } else {
      close();
      html += `<p>${esc(line)}</p>\n`;
    }
  }
  close();
  return html;
}

// XSSエスケープ
function esc(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===========================
//  テンプレート処理
//  {{PLACEHOLDER}} を置換
// ===========================

function render(templateStr, vars) {
  let result = templateStr;
  for (const [key, val] of Object.entries(vars)) {
    // {{KEY}} をすべて置換（グローバル）
    result = result.replaceAll(`{{${key}}}`, val ?? '');
  }
  return result;
}

function readTemplate(relativePath) {
  const full = path.join(TEMPLATES, relativePath);
  if (!fs.existsSync(full)) {
    throw new Error(`テンプレートが見つかりません: ${full}`);
  }
  return fs.readFileSync(full, 'utf-8');
}

// ===========================
//  ファイル操作ユーティリティ
// ===========================

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  ✅ ${path.relative(ROOT, filePath)}`);
}

// public/ → dist/ に静的アセットをコピー
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// ===========================
//  記事一覧を読み込む
// ===========================

function loadPosts(blogSlug, matter) {
  const postsDir = path.join(CONTENT, 'blogs', blogSlug, 'posts');
  if (!fs.existsSync(postsDir)) return [];

  const posts = [];
  for (const file of fs.readdirSync(postsDir)) {
    if (!file.endsWith('.md')) continue;

    const raw    = fs.readFileSync(path.join(postsDir, file), 'utf-8');
    const parsed = matter(raw);
    const fm     = parsed.data;

    // --- Frontmatter バリデーション ---
    const missing = [];
    if (!fm.title)  missing.push('title');
    if (!fm.date)   missing.push('date');
    if (!fm.author) missing.push('author');
    if (missing.length) {
      console.error(`❌ Frontmatter必須項目不足: ${blogSlug}/posts/${file} (不足: ${missing.join(', ')})`);
      process.exit(1);
    }

    // draft: true はスキップ
    if (fm.draft) continue;

    const slug = file.replace(/\.md$/, '');
    posts.push({
      slug,
      title:   fm.title,
      date:    String(fm.date).slice(0, 10),
      author:  fm.author,
      excerpt: fm.excerpt || '',
      tags:    Array.isArray(fm.tags) ? fm.tags : [],
      content: parsed.content,
    });
  }

  // 日付降順ソート
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ===========================
//  テーマ別パーツ生成
// ===========================

// ----- 記事リスト HTML -----
function buildPostListHtml(posts, blogSlug, theme) {
  if (posts.length === 0) {
    return '<p style="color:#999;padding:20px 0">記事がまだありません</p>';
  }

  return posts.map(post => {
    const tags = post.tags.join(',');

    if (theme === 'retro-cosmic') {
      return `
<a href="posts/${esc(post.slug)}.html" class="cosmic-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="cosmic-card-title">${esc(post.title)}</div>
    <span style="font-size:0.85rem;color:#666;white-space:nowrap;margin-left:12px">📅 ${esc(post.date)}</span>
  </div>
  <p class="cosmic-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="cosmic-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="cosmic-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'gym-log') {
      return `
<a href="posts/${esc(post.slug)}.html" class="gym-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="gym-card-title">${esc(post.title)}</div>
    <span class="gym-card-date">📅 ${esc(post.date)}</span>
  </div>
  <p class="gym-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="gym-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="gym-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'love-column') {
      return `
<a href="posts/${esc(post.slug)}.html" class="love-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="love-card-title">${esc(post.title)}</div>
    <span class="love-card-date">📅 ${esc(post.date)}</span>
  </div>
  <p class="love-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="love-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="love-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'izakaya') {
      return `
<a href="posts/${esc(post.slug)}.html" class="izakaya-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="izakaya-card-title">${esc(post.title)}</div>
    <span class="izakaya-card-date">📅 ${esc(post.date)}</span>
  </div>
  <p class="izakaya-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="izakaya-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="izakaya-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'onsen-cosmos') {
      return `
<a href="posts/${esc(post.slug)}.html" class="onsen-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="onsen-card-title">${esc(post.title)}</div>
    <span class="onsen-card-date">🌙 ${esc(post.date)}</span>
  </div>
  <p class="onsen-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="onsen-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="onsen-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'comedy-zine') {
      return `
<a href="posts/${esc(post.slug)}.html" class="zine-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="zine-card-title">${esc(post.title)}</div>
    <span class="zine-card-date">${esc(post.date)}</span>
  </div>
  <p class="zine-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="zine-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="zine-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'academy-log') {
      return `
<a href="posts/${esc(post.slug)}.html" class="academy-post-card" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="academy-card-title">${esc(post.title)}</div>
    <span class="academy-card-date">📅 ${esc(post.date)}</span>
  </div>
  <p class="academy-card-excerpt">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <span class="academy-card-meta">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="academy-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'terminal') {
      return `
<a href="posts/${esc(post.slug)}.html" class="term-post-entry" data-post-tags="${esc(tags)}">
  <span class="term-post-date">${esc(post.date)}</span>
  <span class="term-post-author">${esc(post.author)}</span>
  <span class="term-post-title">${esc(post.title)}</span>
  <div class="term-post-excerpt">${esc(post.excerpt)}</div>
  <div class="term-post-tags">${post.tags.map(t => `<span class="term-tag">#${esc(t)}</span>`).join('')}</div>
</a>`.trim();

    } else if (theme === 'kawase-blog') {
      return `
<a href="posts/${esc(post.slug)}.html" class="kawase-post-card" data-post-tags="${esc(tags)}">
  <div class="kawase-card-date">📅 ${esc(post.date)}</div>
  <div class="kawase-card-title">${esc(post.title)}</div>
  <p class="kawase-card-excerpt">${esc(post.excerpt)}</p>
  <div class="kawase-card-footer">
    <span class="kawase-card-meta">✍️ ${esc(post.author)}</span>
    <div class="kawase-card-tags">${post.tags.map(t => `<span class="kawase-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else if (theme === 'sake-modern') {
      return `
<a href="posts/${esc(post.slug)}.html" class="sake-post-card" data-post-tags="${esc(tags)}">
  <div class="sake-card-date">📅 ${esc(post.date)}</div>
  <div class="sake-card-title">${esc(post.title)}</div>
  <p class="sake-card-excerpt">${esc(post.excerpt)}</p>
  <div class="sake-card-footer">
    <span class="sake-card-meta">✍️ ${esc(post.author)}</span>
    <div class="sake-card-tags">${post.tags.map(t => `<span class="sake-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();

    } else {
      // word-retro（デフォルト）
      return `
<a href="posts/${esc(post.slug)}.html" class="word-blog-entry" data-post-tags="${esc(tags)}">
  <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
    <div class="word-blog-entry-title">${esc(post.title)}</div>
    <span style="font-size:0.85rem;color:#666;white-space:nowrap;margin-left:12px">📅 ${esc(post.date)}</span>
  </div>
  <p class="word-blog-excerpt" style="margin-bottom:8px">${esc(post.excerpt)}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <span style="font-size:0.85rem;color:#666">✍️ ${esc(post.author)}</span>
    <div>${post.tags.map(t => `<span class="word-tag">#${esc(t)}</span>`).join('')}</div>
  </div>
</a>`.trim();
    }
  }).join('\n');
}

// ----- タグフィルター HTML -----
function buildTagFilterHtml(posts, theme) {
  const allTags = [...new Set(posts.flatMap(p => p.tags))];
  if (allTags.length === 0) return '';

  if (theme === 'retro-cosmic') {
    const allBtn  = `<button data-tag-btn="__all__" class="cosmic-tag cosmic-tag-active">すべて</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="cosmic-tag">#${esc(t)}</button>`).join('');
    return `<div class="cosmic-tag-filter">
  <div class="cosmic-tag-filter-heading">🏷️ タグで絞り込み</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">${allBtn}${tagBtns}</div>
</div>
<div class="retro-separator"></div>`;

  } else if (theme === 'gym-log') {
    const allBtn  = `<button data-tag-btn="__all__" class="gym-tag" style="border-color:#ff4400;color:#ff4400">ALL</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="gym-tag">#${esc(t)}</button>`).join('');
    return `<div class="gym-tag-filter">
  <div class="gym-tag-filter-heading">◆ FILTER BY TAG</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'love-column') {
    const allBtn  = `<button data-tag-btn="__all__" class="love-tag" style="background:#ff8fab;border-color:#ff8fab;color:white">すべて ♥</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="love-tag">#${esc(t)}</button>`).join('');
    return `<div class="love-tag-filter">
  <div class="love-tag-filter-heading">♥ タグで絞り込み</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'izakaya') {
    const allBtn  = `<button data-tag-btn="__all__" class="izakaya-tag" style="border-color:#d4a058;color:#f0b830">すべて</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="izakaya-tag">#${esc(t)}</button>`).join('');
    return `<div class="izakaya-tag-filter">
  <div class="izakaya-tag-filter-heading">〔 種類で絞り込む 〕</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'onsen-cosmos') {
    const allBtn  = `<button data-tag-btn="__all__" class="onsen-tag" style="border-color:#c8a060;color:#f0d090">すべて ✦</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="onsen-tag">#${esc(t)}</button>`).join('');
    return `<div class="onsen-tag-filter">
  <div class="onsen-tag-filter-heading">✦ タグで絞り込み</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'comedy-zine') {
    const allBtn  = `<button data-tag-btn="__all__" class="zine-tag" style="background:#111;color:#ffe600;border-color:#111">ALL</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="zine-tag">#${esc(t)}</button>`).join('');
    return `<div class="zine-tag-filter">
  <div class="zine-tag-filter-heading">◆ FILTER BY TAG</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'academy-log') {
    const allBtn  = `<button data-tag-btn="__all__" class="academy-tag" style="border-color:#4a9eff;color:#7ac8ff">ALL</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="academy-tag">#${esc(t)}</button>`).join('');
    return `<div class="academy-tag-filter">
  <div class="academy-tag-filter-heading">◆ FILTER BY TAG</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'terminal') {
    const allBtn  = `<button data-tag-btn="__all__" class="term-tag term-tag-active">*</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="term-tag">#${esc(t)}</button>`).join('');
    return `<div class="term-tag-filter term-block" style="padding:10px">
  <span class="term-prompt-mini">$</span> grep --tag:
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'kawase-blog') {
    const allBtn  = `<button data-tag-btn="__all__" class="kawase-tag kawase-tag-active">すべて</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="kawase-tag">#${esc(t)}</button>`).join('');
    return `<div class="kawase-tag-filter">
  <div class="kawase-tag-filter-heading">✦ タグで絞り込み</div>
  <div class="kawase-tag-filter-wrap">${allBtn}${tagBtns}</div>
</div>`;

  } else if (theme === 'sake-modern') {
    const allBtn  = `<button data-tag-btn="__all__" class="sake-tag sake-tag-active">すべて</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="sake-tag">#${esc(t)}</button>`).join('');
    return `<div class="sake-tag-filter">
  <div class="sake-tag-filter-heading">✦ タグで絞り込み</div>
  <div class="sake-tag-filter-wrap">${allBtn}${tagBtns}</div>
</div>`;

  } else {
    const allBtn  = `<button data-tag-btn="__all__" class="word-tag word-tag-active">すべて</button>`;
    const tagBtns = allTags.map(t => `<button data-tag-btn="${esc(t)}" class="word-tag">#${esc(t)}</button>`).join('');
    return `<div class="word-section">
  <div class="word-section-heading">🏷️ タグで絞り込み</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap">${allBtn}${tagBtns}</div>
</div>
<div class="word-section-break"></div>`;
  }
}

// ----- 前後記事ナビ HTML -----
function buildNavCard(post, label, blogSlug, theme) {
  if (!post) return '<div></div>';

  if (theme === 'retro-cosmic') {
    return `<a href="${esc(post.slug)}.html" class="cosmic-nav-card">
  <div class="cosmic-nav-label">${esc(label)}</div>
  <div class="cosmic-nav-title">${esc(post.title)}</div>
  <div class="cosmic-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'gym-log') {
    return `<a href="${esc(post.slug)}.html" class="gym-nav-card">
  <div class="gym-nav-label">${esc(label)}</div>
  <div class="gym-nav-title">${esc(post.title)}</div>
  <div class="gym-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'love-column') {
    return `<a href="${esc(post.slug)}.html" class="love-nav-card">
  <div class="love-nav-label">${esc(label)}</div>
  <div class="love-nav-title">${esc(post.title)}</div>
  <div class="love-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'izakaya') {
    return `<a href="${esc(post.slug)}.html" class="izakaya-nav-card">
  <div class="izakaya-nav-label">${esc(label)}</div>
  <div class="izakaya-nav-title">${esc(post.title)}</div>
  <div class="izakaya-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'onsen-cosmos') {
    return `<a href="${esc(post.slug)}.html" class="onsen-nav-card">
  <div class="onsen-nav-label">${esc(label)}</div>
  <div class="onsen-nav-title">${esc(post.title)}</div>
  <div class="onsen-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'comedy-zine') {
    return `<a href="${esc(post.slug)}.html" class="zine-nav-card">
  <div class="zine-nav-label">${esc(label)}</div>
  <div class="zine-nav-title">${esc(post.title)}</div>
  <div class="zine-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'academy-log') {
    return `<a href="${esc(post.slug)}.html" class="academy-nav-card">
  <div class="academy-nav-label">${esc(label)}</div>
  <div class="academy-nav-title">${esc(post.title)}</div>
  <div class="academy-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'terminal') {
    return `<a href="${esc(post.slug)}.html" class="term-nav-card">
  <div class="term-nav-label">${esc(label)}</div>
  <div class="term-nav-title">${esc(post.title)}</div>
  <div class="term-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'kawase-blog') {
    return `<a href="${esc(post.slug)}.html" class="kawase-nav-card">
  <div class="kawase-nav-label">${esc(label)}</div>
  <div class="kawase-nav-title">${esc(post.title)}</div>
  <div class="kawase-nav-date">${esc(post.date)}</div>
</a>`;
  } else if (theme === 'sake-modern') {
    return `<a href="${esc(post.slug)}.html" class="sake-nav-card">
  <div class="sake-nav-label">${esc(label)}</div>
  <div class="sake-nav-title">${esc(post.title)}</div>
  <div class="sake-nav-date">${esc(post.date)}</div>
</a>`;
  } else {
    return `<a href="${esc(post.slug)}.html" class="word-blog-card" style="padding:12px">
  <div style="font-size:0.8rem;color:#666;margin-bottom:6px">${esc(label)}</div>
  <div class="word-bold word-text-blue" style="font-size:0.9rem">${esc(post.title)}</div>
  <div style="font-size:0.8rem;color:#666;margin-top:4px">${esc(post.date)}</div>
</a>`;
  }
}

// ----- タグ HTML（記事ヘッダー用） -----
function buildTagsHtml(tags, theme) {
  if (!tags || tags.length === 0) return '';
  if (theme === 'retro-cosmic') {
    return tags.map(t => `<span class="cosmic-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'terminal') {
    return tags.map(t => `<span class="term-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'gym-log') {
    return tags.map(t => `<span class="gym-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'love-column') {
    return tags.map(t => `<span class="love-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'izakaya') {
    return tags.map(t => `<span class="izakaya-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'onsen-cosmos') {
    return tags.map(t => `<span class="onsen-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'comedy-zine') {
    return tags.map(t => `<span class="zine-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'academy-log') {
    return tags.map(t => `<span class="academy-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'kawase-blog') {
    return tags.map(t => `<span class="kawase-tag">#${esc(t)}</span>`).join('');
  } else if (theme === 'sake-modern') {
    return tags.map(t => `<span class="sake-tag">#${esc(t)}</span>`).join('');
  } else {
    return tags.map(t => `<span class="word-tag">#${esc(t)}</span>`).join('');
  }
}

// ===========================
//  ビルド本体
// ===========================

async function build() {
  console.log('\n🚀 ビルド開始\n');
  const matter = await loadGrayMatter();

  // dist/ を再作成
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
  ensureDir(DIST);

  // 静的アセットをコピー
  console.log('📂 アセットをコピー中...');
  copyDir(PUBLIC, DIST);

  // blogs.json を読み込み
  const blogsJsonPath = path.join(CONTENT, 'blogs.json');
  if (!fs.existsSync(blogsJsonPath)) {
    console.error('❌ content/blogs.json が見つかりません');
    process.exit(1);
  }
  const blogs = JSON.parse(fs.readFileSync(blogsJsonPath, 'utf-8'));
  console.log(`\n📖 ブログ定義を読み込みました (${blogs.length}件)\n`);

  // 全記事を収集（トップページ用）
  const allPostsForTop = [];

  // 各ブログを処理
  for (const blog of blogs) {
    const theme = blog.theme || 'word-retro';
    console.log(`\n[${theme}] 🔨 ${blog.title} (${blog.slug})`);

    const posts = loadPosts(blog.slug, matter);
    console.log(`  📝 ${posts.length}件の記事`);

    // トップページ用に記録
    posts.forEach(p => allPostsForTop.push({ ...p, blogSlug: blog.slug, blogTitle: blog.title, blogEmoji: blog.planet.emoji }));

    // --- ブログ一覧ページ生成 ---
    const blogListTpl = readTemplate(`${theme}/blog-list.html`);
    const blogListHtml = render(blogListTpl, {
      BLOG_TITLE:   blog.title,
      BLOG_DESC:    blog.desc,
      BLOG_AUTHOR:  blog.author,
      BLOG_EMOJI:   blog.planet.emoji,
      BLOG_SLUG:    blog.slug,
      PLANET_JA:    blog.planet.nameJa,
      PLANET_EN:    blog.planet.name,
      POST_COUNT:   posts.length,
      LATEST_DATE:  posts[0]?.date || 'N/A',
      POST_LIST:    buildPostListHtml(posts, blog.slug, theme),
      TAG_FILTER:   buildTagFilterHtml(posts, theme),
    });

    writeFile(path.join(DIST, 'blogs', blog.slug, 'index.html'), blogListHtml);

    // --- 各記事ページ生成 ---
    for (let i = 0; i < posts.length; i++) {
      const post     = posts[i];
      const prevPost = i < posts.length - 1 ? posts[i + 1] : null; // 古い方
      const nextPost = i > 0                ? posts[i - 1] : null; // 新しい方

      const postTpl  = readTemplate(`${theme}/post.html`);
      const postHtml = render(postTpl, {
        POST_TITLE:    post.title,
        POST_DATE:     post.date,
        POST_AUTHOR:   post.author,
        POST_EXCERPT:  post.excerpt,
        POST_SLUG:     post.slug,
        POST_CONTENT:  renderMarkdown(post.content),
        POST_TAGS:     buildTagsHtml(post.tags, theme),
        POST_TAGS_RAW: post.tags.map(t => `"${esc(t)}"`).join(', '),
        BLOG_TITLE:    blog.title,
        BLOG_EMOJI:    blog.planet.emoji,
        BLOG_SLUG:     blog.slug,
        PREV_POST:     buildNavCard(prevPost, '← 前の記事', blog.slug, theme),
        NEXT_POST:     buildNavCard(nextPost, '次の記事 →', blog.slug, theme),
      });

      writeFile(
        path.join(DIST, 'blogs', blog.slug, 'posts', `${post.slug}.html`),
        postHtml
      );
    }
  }

  // --- トップページ生成 ---
  console.log('\n🏠 トップページ生成中...');
  const allSorted = allPostsForTop.sort((a, b) => (a.date < b.date ? 1 : -1));
  const latestTop = allSorted.slice(0, 10);
  const buildDate = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  // 7日以内に更新があるブログにNEWバッジ
  const isRecent = (slug) => {
    const blogPosts = allPostsForTop.filter(p => p.blogSlug === slug);
    if (!blogPosts.length) return false;
    const latest = blogPosts.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return new Date(latest.date) > weekAgo;
  };

  // ブログ一覧テーブル行
  const blogTableRows = blogs.map(blog => {
    const count   = allPostsForTop.filter(p => p.blogSlug === blog.slug).length;
    const newBadge = isRecent(blog.slug)
      ? '<span class="word-new-badge">NEW</span>'
      : '';
    return `<tr>
  <td><a href="blogs/${esc(blog.slug)}/index.html" class="word-hyperlink"><span class="word-emoji">${esc(blog.planet.emoji)}</span>${esc(blog.title)}${newBadge}</a></td>
  <td>${esc(blog.desc)}</td>
  <td>${esc(blog.author)}</td>
  <td class="word-bold">${count}</td>
</tr>`;
  }).join('\n');

  // 最新記事リスト
  const latestPostsHtml = latestTop.map(post => {
    const tagsHtml = post.tags.map(t => `<span class="word-tag">#${esc(t)}</span>`).join('');
    return `
<a href="blogs/${esc(post.blogSlug)}/posts/${esc(post.slug)}.html" class="word-blog-entry">
  <div class="word-blog-entry-title">
    <span class="word-emoji">${esc(post.blogEmoji)}</span>${esc(post.title)}
  </div>
  <div class="word-blog-meta">投稿者: ${esc(post.author)} | ブログ: ${esc(post.blogTitle)} | 日時: ${esc(post.date)}</div>
  <p class="word-blog-excerpt">${esc(post.excerpt)}</p>
  ${tagsHtml ? `<div style="margin-top:8px">${tagsHtml}</div>` : ''}
</a>`.trim();
  }).join('\n');

  const homeTpl  = readTemplate('home.html');
  const homeHtml = render(homeTpl, {
    SITE_TITLE:       'レン・カワセのスプリング☆ユニバース',
    BUILD_DATE:       buildDate,
    BLOG_TABLE_ROWS:  blogTableRows,
    TOTAL_BLOGS:      blogs.length,
    TOTAL_POSTS:      allPostsForTop.length,
    LATEST_DATE:      latestTop[0]?.date || 'N/A',
    LATEST_POSTS:     latestPostsHtml,
  });

  writeFile(path.join(DIST, 'index.html'), homeHtml);

  // 404ページ
  const notFoundTpl = readTemplate('404.html');
  writeFile(path.join(DIST, '404.html'), notFoundTpl);

  // .nojekyll（GitHub Pages 用）
  writeFile(path.join(DIST, '.nojekyll'), '');

  console.log(`\n✨ ビルド完了！ → dist/\n`);
}

build().catch(err => {
  console.error('\n❌ ビルドエラー:', err.message);
  process.exit(1);
});
