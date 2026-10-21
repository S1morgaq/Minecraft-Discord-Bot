const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

/** Klasördeki tüm modülleri yükler; bir modül dizi dışa aktarabilir. */
function loadModules(dir) {
  return walk(dir).flatMap((file) => {
    const mod = require(file);
    return (Array.isArray(mod) ? mod : [mod]).map((m) => ({ file, mod: m }));
  });
}

const SRC = path.join(__dirname, '..');

function loadCommands() {
  const map = new Map();
  for (const { file, mod } of loadModules(path.join(SRC, 'commands'))) {
    if (!mod?.data || typeof mod.execute !== 'function') throw new Error(`Geçersiz komut modülü: ${file}`);
    const name = mod.data.name;
    if (map.has(name)) throw new Error(`Yinelenen komut adı: ${name} (${file})`);
    map.set(name, mod);
  }
  return map;
}

function loadHandlers() {
  const handlers = { button: new Map(), modal: new Map(), select: new Map() };
  const kinds = { buttons: 'button', modals: 'modal', selectMenus: 'select' };
  for (const [folder, kind] of Object.entries(kinds)) {
    for (const { file, mod } of loadModules(path.join(SRC, 'interactions', folder))) {
      if (!mod?.module || typeof mod.execute !== 'function') throw new Error(`Geçersiz etkileşim modülü: ${file}`);
      if (handlers[kind].has(mod.module)) throw new Error(`Yinelenen ${kind} modülü: ${mod.module}`);
      handlers[kind].set(mod.module, mod);
    }
  }
  return handlers;
}

function loadEvents() {
  return loadModules(path.join(SRC, 'events')).map(({ mod }) => mod);
}

module.exports = { loadCommands, loadHandlers, loadEvents };
