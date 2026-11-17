const api = require('./service'),
  { byId } = require('./catalog');
const key = 'lianna.content.v2';
const originals = new Map();
let applied = 0,
  updating = false;
function apply(pack) {
  for (const [id, base] of originals) {
    const m = byId.get(id);
    Object.assign(m, base);
  }
  for (const a of pack.actions) {
    const m = byId.get(a.id);
    if (!m) continue;
    if (!originals.has(a.id))
      originals.set(a.id, {
        steps: m.steps,
        name: m.name,
        hidden: m.hidden,
        gear: m.gear,
        alternatives: m.alternatives,
        part: m.part,
        muscle: m.muscle,
        localMedia: m.localMedia
      });
    m.name = a.name || m.name;
    m.steps = a.steps || m.steps;
    m.hidden = a.visible === false;
    m.gear = a.gear || m.gear;
    m.alternatives = a.alternatives || m.alternatives;
    m.part = a.part || m.part;
    m.muscle = a.muscle || m.muscle;
    m.localMedia = a.localMedia || null;
  }
  applied = pack.version;
  const stack = getCurrentPages(),
    page = stack[stack.length - 1];
  if (!page) return;
  if (['pages/pick/index', 'pages/saved/index'].includes(page.route)) page.refresh();
  if (page.route === 'pages/detail/index' && page.move) {
    const m = byId.get(page.move.sourceId);
    if (m?.hidden) page.setData({ move: null });
    else page.onLoad({ id: page.move.sourceId });
  }
}
function present(pack) {
  if (!pack?.version || !Array.isArray(pack.actions)) return false;
  try {
    const fs = wx.getFileSystemManager();
    for (const a of pack.actions)
      for (const file of Object.values(a.localMedia || {})) fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}
function download(url) {
  return new Promise((resolve, reject) =>
    wx.downloadFile({
      url,
      success: (r) =>
        r.statusCode === 200 ? resolve(r.tempFilePath) : reject(Error('素材下载失败')),
      fail: reject
    })
  );
}
function info(path) {
  return new Promise((resolve, reject) =>
    wx.getFileInfo({ filePath: path, digestAlgorithm: 'sha1', success: resolve, fail: reject })
  );
}
async function sync() {
  if (updating) return;
  updating = true;
  try {
    const saved = wx.getStorageSync(key);
    if (!applied && present(saved)) apply(saved);
    const pack = await api.request('catalog');
    if (pack.version === applied) return;
    const fs = wx.getFileSystemManager(),
      root = wx.env.USER_DATA_PATH + '/lianna-content';
    try {
      fs.mkdirSync(root, true);
    } catch {}
    for (const a of pack.actions) {
      if (!a.media) continue;
      a.localMedia = {};
      for (const kind of ['cover', 'animation']) {
        const digest = a.media[kind + 'Hash'];
        if (!/^[0-9a-f]{40}$/.test(digest)) throw Error('素材摘要无效');
        const dest = root + '/' + digest + '.webp';
        let exists = false;
        try {
          fs.accessSync(dest);
          exists = true;
        } catch {}
        if (!exists) {
          const tmp = await download(a.media[kind]);
          if ((await info(tmp)).digest !== digest) throw Error('素材校验失败');
          fs.copyFileSync(tmp, dest);
        }
        a.localMedia[kind === 'cover' ? 'covers' : 'animations'] = dest;
      }
    }
    if (!present(pack)) return;
    wx.setStorageSync(key, pack);
    apply(pack);
    const used = new Set(pack.actions.flatMap((a) => Object.values(a.localMedia || {})));
    for (const f of fs.readdirSync(root)) {
      const p = root + '/' + f;
      if (/^[0-9a-f]{40}\.webp$/.test(f) && !used.has(p))
        try {
          fs.unlinkSync(p);
        } catch {}
    }
  } catch {
  } finally {
    updating = false;
  }
}
module.exports = { sync };
