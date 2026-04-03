/**
 * Test server for ModNetwork extension.
 * 
 * PORT 8765: Serves a test page simulating a site with a shared header
 * PORT 8766: Serves the "local dev" replacement header HTML
 * 
 * Usage: node test/server.js
 */

const http = require('http');

// ── Test Page (simulates production site) ────────────────────────
const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test Page - ModNetwork</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; }
    .header { background: #1a1a2e; color: white; padding: 16px 24px; }
    .header h1 { margin: 0; font-size: 18px; }
    .header nav { margin-top: 8px; }
    .header nav a { color: #8888cc; text-decoration: none; margin-right: 16px; }
    .content { padding: 24px; max-width: 800px; }
    .content h2 { color: #333; }
    .info-box { background: white; padding: 16px; border-radius: 8px; border: 1px solid #ddd; margin-top: 16px; }
  </style>
</head>
<body>
  <!-- HEADER_START -->
  <div class="header" id="global-header">
    <h1>🏢 Production Header (Original)</h1>
    <nav>
      <a href="#">Home</a>
      <a href="#">Products</a>
      <a href="#">About</a>
      <a href="#">Contact</a>
    </nav>
  </div>
  <!-- HEADER_END -->
  
  <div class="content">
    <h2>Page Content</h2>
    <div class="info-box">
      <p><strong>This is the test page.</strong></p>
      <p>If ModNetwork is working correctly, the header above should be replaced with the local dev version.</p>
      <p>The original header says "Production Header (Original)" in a dark background.</p>
      <p>The replacement header should say "Local Dev Header (Modified!)" in a green gradient background.</p>
    </div>
    <div class="info-box" style="margin-top: 12px;">
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      <p><strong>Server:</strong> Test page on port 8765</p>
    </div>
  </div>
</body>
</html>`;

// ── Replacement Header HTML (simulates local dev server) ─────────
const LOCAL_HEADER_HTML = `<div class="header" id="global-header" style="background: linear-gradient(135deg, #0d7a3e, #1db954); color: white; padding: 16px 24px;">
    <h1>🚀 Local Dev Header (Modified!)</h1>
    <nav>
      <a href="#" style="color: #b3ffcc; text-decoration: none; margin-right: 16px;">Home</a>
      <a href="#" style="color: #b3ffcc; text-decoration: none; margin-right: 16px;">Products</a>
      <a href="#" style="color: #b3ffcc; text-decoration: none; margin-right: 16px;">Dashboard (NEW)</a>
      <a href="#" style="color: #b3ffcc; text-decoration: none; margin-right: 16px;">Settings (NEW)</a>
    </nav>
  </div>`;

// ── Start Test Page Server ───────────────────────────────────────
const testPageServer = http.createServer((req, res) => {
  console.log(`[Test Page] ${req.method} ${req.url}`);
  res.writeHead(200, { 
    'Content-Type': 'text/html',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(TEST_PAGE_HTML);
});

testPageServer.listen(8765, () => {
  console.log('🌐 Test page server running at http://localhost:8765');
});

// ── Start Local Dev Header Server ────────────────────────────────
const localHeaderServer = http.createServer((req, res) => {
  console.log(`[Local Header] ${req.method} ${req.url}`);
  res.writeHead(200, { 
    'Content-Type': 'text/html',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(LOCAL_HEADER_HTML);
});

localHeaderServer.listen(8766, () => {
  console.log('🔧 Local header server running at http://localhost:8766/header');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST INSTRUCTIONS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  1. Open http://localhost:8765 in Chrome');
  console.log('  2. Click ModNetwork popup → toggle ON for this tab');
  console.log('  3. Create/enable a rule with:');
  console.log('     URL Pattern: *://localhost:8765/*');
  console.log('     onResponse script:');
  console.log('       const local = await fetch("http://localhost:8766/header").then(r=>r.text());');
  console.log('       context.response.body = context.response.body.replace(');
  console.log('         /<!-- HEADER_START -->[\\s\\S]*?<!-- HEADER_END -->/, local);');
  console.log('       return context.response;');
  console.log('  4. Reload the page → header should change to green!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
