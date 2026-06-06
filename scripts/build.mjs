import fs from 'fs';
import path from 'path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function jsString(value) {
  return JSON.stringify(value ?? '');
}

fs.rmSync(distDir, { recursive: true, force: true });
copyDir(publicDir, distDir);

const config = `window.__ANSIM_CONFIG__ = {\n` +
  `  VITE_SUPABASE_URL: ${jsString(process.env.VITE_SUPABASE_URL)},\n` +
  `  VITE_SUPABASE_ANON_KEY: ${jsString(process.env.VITE_SUPABASE_ANON_KEY)},\n` +
  `  VITE_SUPABASE_LEADS_TABLE: ${jsString(process.env.VITE_SUPABASE_LEADS_TABLE || 'leads')},\n` +
  `  VITE_ADMIN_ACCESS_KEY: ${jsString(process.env.VITE_ADMIN_ACCESS_KEY || 'change-this-before-deploy')}\n` +
  `};\n`;

fs.writeFileSync(path.join(distDir, 'config.js'), config, 'utf8');
console.log('Built dist with runtime config.js');
