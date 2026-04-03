#!/usr/bin/env node

/**
 * Auto-versioning commit script
 * 
 * Usage: node scripts/commit.js "type(scope): message"
 * Example: node scripts/commit.js "feat: add log viewer"
 * 
 * Logic:
 * - feat: bumps MINOR (0.X.0)
 * - fix: bumps PATCH (0.0.X)
 * - breaking change: bumps MAJOR (X.0.0)
 * - chore/docs/style/refactor: no bump
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Get commit message
const message = process.argv.slice(2).join(' ');
if (!message) {
  console.error('❌ Error: No commit message provided.');
  console.log('Usage: node scripts/commit.js "feat: added new feature"');
  process.exit(1);
}

const messageLower = message.toLowerCase();

// 2. Determine bump type
let bumpType = 'none';

if (messageLower.includes('breaking change') || messageLower.startsWith('major:')) {
  bumpType = 'major';
} else if (messageLower.startsWith('feat:') || messageLower.match(/^feat\(.*\):/)) {
  bumpType = 'minor';
} else if (messageLower.startsWith('fix:') || messageLower.match(/^fix\(.*\):/)) {
  bumpType = 'patch';
}

// 3. Read manifest and bump version
const manifestPath = path.join(__dirname, '..', 'src', 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error('❌ Error: Could not read src/manifest.json');
  process.exit(1);
}

const currentVersion = manifest.version || '0.0.0';
let [major, minor, patch] = currentVersion.split('.').map(Number);

if (bumpType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bumpType === 'minor') {
  minor += 1;
  patch = 0;
} else if (bumpType === 'patch') {
  patch += 1;
}

const newVersion = `${major}.${minor}.${patch}`;

if (bumpType !== 'none') {
  // Update manifest.json
  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`📈 Bumped version: ${currentVersion} -> ${newVersion} (${bumpType})`);
} else {
  console.log(`ℹ️  No version bump required for this commit type. Current: ${currentVersion}`);
}

// 4. Run Git commands
try {
  console.log(`\n⏳ Running git commands...`);
  
  // Add all changes (including the updated manifest)
  execSync('git add -A', { stdio: 'inherit' });
  
  // Commit
  // We wrap the message in quotes to be safe, escaping inner double quotes
  const escapedMessage = message.replace(/"/g, '\\"');
  execSync(`git commit -m "${escapedMessage}"`, { stdio: 'inherit' });
  
  console.log(`\n✅ Commit successful!`);
} catch (error) {
  console.error(`\n❌ Git commit failed.`);
  // Revert version change in manifest if git failed
  if (bumpType !== 'none') {
    manifest.version = currentVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`🔄 Reverted version bump due to commit failure.`);
  }
  process.exit(1);
}
