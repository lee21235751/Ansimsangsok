import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const distDir = path.join(root, "dist");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
copyDir(publicDir, distDir);

const indexPath = path.join(distDir, "index.html");
if (!fs.existsSync(indexPath)) {
  throw new Error("dist/index.html was not created.");
}

console.log("Build complete: dist/index.html");
