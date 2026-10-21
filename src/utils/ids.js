/** Bileşen kimlikleri: "zn:<modül>:<eylem>[:arg...]". Durumsuz olduğundan yeniden başlatmadan etkilenmez. */
const PREFIX = 'zn';

const id = (...parts) => {
  const out = [PREFIX, ...parts].join(':');
  if (out.length > 100) throw new Error(`customId çok uzun: ${out}`);
  return out;
};

const parse = (customId) => {
  const [prefix, module, ...args] = String(customId).split(':');
  return prefix === PREFIX ? { module, args } : null;
};

module.exports = { id, parse };
