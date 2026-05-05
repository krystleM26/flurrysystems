'use strict';

require('dotenv').config();

const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
const cheerio  = require('cheerio');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Password setup ────────────────────────────────────────────────────────────
// Set ADMIN_PASSWORD env var before first run; the hash is derived at startup.
// On subsequent runs set ADMIN_PASSWORD_HASH to skip rehashing.
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH
  || bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'changeme123', 12);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'flurry-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true behind HTTPS on AWS
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// Serve all static files (HTML, CSS, JS, images, posts/)
app.use(express.static(path.join(__dirname)));

// ── Auth helpers ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── API: Auth ─────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    req.session.authenticated = true;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ── API: Posts ────────────────────────────────────────────────────────────────
const POSTS_DIR     = path.join(__dirname, 'posts');
const MANIFEST_PATH = path.join(POSTS_DIR, 'manifest.json');

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return [];
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function writeManifest(posts) {
  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(posts, null, 2));
}

// List all posts (public)
app.get('/api/posts', (_req, res) => {
  res.json(readManifest());
});

// Create a post (admin only)
app.post('/api/posts', requireAuth, (req, res) => {
  const { title, excerpt, tag, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

  const id   = Date.now();
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);

  const filename = `${slug}-${id}.html`;
  const date     = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const postTag  = (tag || 'General').trim();

  // Write the individual post page
  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(POSTS_DIR, filename), buildPostPage({ title, excerpt, tag: postTag, content, date }));

  // Prepend to manifest (newest first)
  const manifest = readManifest();
  manifest.unshift({ id, slug, filename, title, excerpt: excerpt || '', tag: postTag, date });
  writeManifest(manifest);

  res.json({ success: true, post: manifest[0] });
});

// Update a post (admin only)
app.put('/api/posts/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { title, excerpt, tag, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

  const manifest = readManifest();
  const idx = manifest.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const post    = manifest[idx];
  const postTag = (tag || post.tag).trim();

  // Rewrite the post page
  fs.writeFileSync(
    path.join(POSTS_DIR, post.filename),
    buildPostPage({ title, excerpt, tag: postTag, content, date: post.date })
  );

  manifest[idx] = { ...post, title, excerpt: excerpt || '', tag: postTag };
  writeManifest(manifest);

  res.json({ success: true, post: manifest[idx] });
});

// Delete a post (admin only)
app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const manifest = readManifest();
  const idx = manifest.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });

  const postFile = path.join(POSTS_DIR, manifest[idx].filename);
  if (fs.existsSync(postFile)) fs.unlinkSync(postFile);

  manifest.splice(idx, 1);
  writeManifest(manifest);

  res.json({ success: true });
});

// ── API: Import from URL (Substack → Blog) ────────────────────────────────────
app.post('/api/import', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Only allow http/https
  let parsed;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol))
      return res.status(400).json({ error: 'Invalid URL' });
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FlurrySystems/1.0; +https://flurrysystems.com)' }
    });
    if (!response.ok) return res.status(400).json({ error: `Could not fetch page (${response.status})` });

    const html = await response.text();
    const $    = cheerio.load(html);

    // Title — try Substack selectors then fall back
    const title =
      $('h1.post-title').first().text().trim() ||
      $('h1[data-testid="post-title"]').first().text().trim() ||
      $('article h1').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('title').text().replace(/\s*[|\-–]\s*(Substack|by .+)$/i, '').trim();

    // Content — Substack body lives in .body.markup or .available-content
    let $content =
      $('.body.markup').length         ? $('.body.markup') :
      $('.available-content').length   ? $('.available-content') :
      $('article .post-content').length ? $('article .post-content') :
      $('article');

    // Strip paywalls, scripts, subscription widgets
    $content.find('script, style, .paywall, .subscription-widget-wrap, .subscribe-widget, [class*="paywall"]').remove();

    const content = $content.html() || '';

    // Excerpt from meta tags or first paragraph
    const excerpt =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $content.find('p').first().text().slice(0, 180).trim();

    if (!title && !content) return res.status(422).json({ error: 'Could not extract content from this URL. Try copying and pasting manually.' });

    res.json({ title, content, excerpt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch post: ' + err.message });
  }
});

// ── Post page HTML template ───────────────────────────────────────────────────
function buildPostPage({ title, excerpt, tag, content, date }) {

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — Flurry Systems Blog</title>
  <meta name="description" content="${escHtml(excerpt || '')}">
  <link rel="stylesheet" href="../src/css/style.css">
  <style>
    .post-body { font-size: 17px; line-height: 1.85; color: var(--s700); }
    .post-body h2 { font-size: 26px; font-weight: 700; color: var(--s800); margin: 2em 0 .6em; letter-spacing: -.5px; }
    .post-body h3 { font-size: 20px; font-weight: 700; color: var(--s800); margin: 1.6em 0 .5em; }
    .post-body p  { margin-bottom: 1.4em; }
    .post-body ul, .post-body ol { margin: 0 0 1.4em 1.5em; }
    .post-body li { margin-bottom: .4em; }
    .post-body blockquote { border-left: 3px solid var(--glacier); margin: 1.6em 0; padding: .6em 0 .6em 1.4em; color: var(--s500); font-style: italic; }
    .post-body a  { color: var(--glacier); }
    .post-body strong { color: var(--s800); }
    .post-body code { background: var(--s100); border-radius: 4px; padding: 2px 6px; font-size: .9em; font-family: monospace; }
    .post-body pre { background: var(--s800); color: #e2e8f0; border-radius: 10px; padding: 20px 24px; overflow-x: auto; margin-bottom: 1.4em; }
    .post-body pre code { background: none; padding: 0; font-size: 14px; }
  </style>
</head>
<body>

  <nav class="nav">
    <div class="nav-inner">
      <a href="../index.html" class="nav-logo">
        <img src="../Flurry Systems Logo with Snowflake Element copy.png" alt="Flurry Systems" class="nav-logo-icon" style="border-radius:4px;object-fit:contain;">
        <span class="nav-logo-text">Flurry Systems</span>
      </a>
      <ul class="nav-links" id="navLinks">
        <li><a href="../index.html">Home</a></li>
        <li><a href="../index.html#products">Products</a></li>
        <li><a href="../blog.html" class="active">Blog</a></li>
        <li><a href="../about.html">About</a></li>
        <li><a href="../index.html#newsletter" class="nav-cta">Newsletter</a></li>
      </ul>
      <button class="nav-toggle" id="navToggle" aria-label="Toggle navigation">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="3" y1="6"  x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
    </div>
  </nav>

  <section class="page-hero">
    <div class="page-hero-inner">
      <p class="section-label" style="color:var(--ice);">${escHtml(tag)}</p>
      <h1 class="page-hero-title" style="max-width:760px;margin:0 auto 16px;">${escHtml(title)}</h1>
      <p class="page-hero-sub">${escHtml(date)} &middot; Flurry Systems</p>
    </div>
  </section>

  <section class="section">
    <div class="section-inner" style="max-width:720px;margin:0 auto;">
      <div class="post-body">
        ${content}
      </div>

      <div style="margin-top:56px;padding-top:32px;border-top:1px solid var(--s200);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
        <a href="../blog.html" style="color:var(--glacier);text-decoration:none;font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back to Blog
        </a>
        <a href="../index.html#newsletter" class="btn btn-primary" style="font-size:14px;padding:10px 20px;">Subscribe for more</a>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-top">
        <div class="footer-brand">
          <a href="../index.html" class="footer-logo">
            <img src="../Flurry Systems Logo with Snowflake Element copy.png" alt="Flurry Systems" class="footer-logo-icon" style="object-fit:contain;">
            <span class="footer-logo-text">Flurry Systems</span>
          </a>
          <p class="footer-tagline">Building focused tools that help you work smarter and grow with clarity.</p>
        </div>
        <div class="footer-col">
          <h5>Products</h5>
          <ul><li><a href="../index.html#products">Clock Earnings</a></li></ul>
        </div>
        <div class="footer-col">
          <h5>Company</h5>
          <ul>
            <li><a href="../about.html">About</a></li>
            <li><a href="../blog.html">Blog</a></li>
            <li><a href="../index.html#newsletter">Newsletter</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h5>Connect</h5>
          <ul><li><a href="mailto:hello@flurrysystems.com">Email Us</a></li></ul>
        </div>
      </div>
      <hr class="footer-divider">
      <div class="footer-bottom">
        <span>&copy; 2026 Flurry Systems. All rights reserved.</span>
        <span>Crafted with care in every detail.</span>
      </div>
    </div>
  </footer>

  <script>
    const toggle = document.getElementById('navToggle');
    const links  = document.getElementById('navLinks');
    toggle.addEventListener('click', () => links.classList.toggle('open'));
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));
  </script>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Flurry Systems running at http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin\n`);
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
    console.log('  ⚠️  Using default password "changeme123" — set ADMIN_PASSWORD env var before deploying.\n');
  }
});
