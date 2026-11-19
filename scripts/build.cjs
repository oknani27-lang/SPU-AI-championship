'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
const files = ['index.html','app.js','account.js','styles.css'];
// Validate the allowlist before removing old build assets; no environment files are copied.
for (const file of files) {
  const content = fs.readFileSync(path.join(root,file),'utf8');
  if (/AIza[\w-]{30,}|sb_secret_[A-Za-z0-9_-]+/.test(content)) throw new Error('Possible secret in public assets; build stopped');
}
fs.mkdirSync(out,{recursive:true});
for (const name of fs.readdirSync(out)) {
  if (!files.includes(name)) throw new Error('Unexpected build output; inspect dist manually');
}
for (const file of files) fs.copyFileSync(path.join(root,file),path.join(out,file));
console.log('Built 4 public assets in dist. Server code and environment files excluded.');
