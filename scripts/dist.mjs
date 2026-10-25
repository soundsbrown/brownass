// Copies the installer that `tauri build` just made into dist/, where it's
// easy to find. Run through `npm run dist`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const name = `${config.productName}_${config.version}_x64-setup.exe`;
const installer = `src-tauri/target/release/bundle/nsis/${name}`;

if (!existsSync(installer)) {
  console.error(`No installer at ${installer}; did the build succeed?`);
  process.exit(1);
}
mkdirSync("dist", { recursive: true });
copyFileSync(installer, `dist/${name}`);
console.log(`Installer: dist/${name}`);
