'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash, timingSafeEqual, scryptSync } = require('node:crypto');
const { need } = require('./rules');
const { defaults, validate } = require('./content');
const hash = (s) => createHash('sha256').update(s).digest('hex');
function open(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,rev INTEGER NOT NULL,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS operators(name TEXT PRIMARY KEY,salt TEXT NOT NULL,digest TEXT NOT NULL,roles TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS versions(module TEXT,version INTEGER,value TEXT NOT NULL,PRIMARY KEY(module,version));
 CREATE TABLE IF NOT EXISTS active(module TEXT PRIMARY KEY,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY,module TEXT,base INTEGER,value TEXT,status TEXT,byname TEXT);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT DEFAULT CURRENT_TIMESTAMP,actor TEXT,kind TEXT,info TEXT);
 CREATE TABLE IF NOT EXISTS risk(food TEXT,allergen TEXT,PRIMARY KEY(food,allergen));
 CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY,owner TEXT,kind TEXT,detail TEXT,status TEXT,assignee TEXT,consent INTEGER DEFAULT 0,at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS requests(owner TEXT,id TEXT,rev INTEGER,PRIMARY KEY(owner,id));`);
  const get = (q, ...p) => db.prepare(q).get(...p),
    all = (q, ...p) => db.prepare(q).all(...p),
    run = (q, ...p) => db.prepare(q).run(...p);
  if (!all('PRAGMA table_info(tickets)').some((f) => f.name === 'mealRef'))
    db.exec('ALTER TABLE tickets ADD COLUMN mealRef TEXT');
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const v = fn();
      db.exec('COMMIT');
      return v;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  const audit = (actor, kind, info) =>
    run(
      "INSERT INTO audit(at,actor,kind,info) VALUES(strftime('%Y-%m-%d %H:%M:%S','now','+8 hours'),?,?,?)",
      actor,
      kind,
      JSON.stringify(info)
    );
  tx(() => {
    for (const [module, value] of Object.entries(defaults)) {
      if (get('SELECT 1 FROM active WHERE module=?', module)) continue;
      const initial =
        module === 'templates'
          ? { ...value, enabled: false }
          : module === 'nutrition'
            ? { macroRatio: null, estimation: { approved: false } }
            : module === 'foods'
              ? []
              : module === 'actions'
                ? []
                : value;
      run('INSERT INTO versions VALUES(?,1,?)', module, JSON.stringify(initial));
      run('INSERT INTO active VALUES(?,1)', module);
      run(
        "INSERT INTO drafts(module,base,value,status,byname) VALUES(?,1,?,'草稿','初始资料')",
        module,
        JSON.stringify(value)
      );
    }
  });
  function content() {
    const c = { version: {}, risk: {} };
    for (const r of all(
      'SELECT v.* FROM versions v JOIN active a ON a.module=v.module AND a.version=v.version'
    )) {
      c[r.module] = JSON.parse(r.value);
      c.version[r.module] = r.version;
    }
    for (const r of all('SELECT * FROM risk')) (c.risk[r.food] ||= []).push(r.allergen);
    return c;
  }
  function account(id) {
    const r = get('SELECT rev,value FROM accounts WHERE id=?', id);
    need(r, '请重新登录', 401);
    return { rev: r.rev, ...JSON.parse(r.value) };
  }
  function ensure(id) {
    run(
      'INSERT OR IGNORE INTO accounts VALUES(?,0,?)',
      id,
      JSON.stringify({
        prefs: { owned: [], active: [], favorites: [] },
        weeks: {},
        sessions: {},
        history: [],
        profile: null,
        meals: {}
      })
    );
  }
  function session(owner) {
    const token = randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?)', hash(token), owner, Date.now() + 7 * 86400000);
    return token;
  }
  function owner(token) {
    return get(
      'SELECT owner FROM sessions WHERE token=? AND expires>?',
      hash(token || ''),
      Date.now()
    )?.owner;
  }
  function operator(name, password, roles) {
    need(
      typeof name === 'string' && name.trim() &&
        typeof password === 'string' && password.length >= 12 &&
        Array.isArray(roles) && roles.length &&
        roles.every((r) => ['管理员', '运营', '审核', '客服'].includes(r)),
      '请设置至少12位密码及有效角色'
    );
    const salt = randomBytes(16).toString('hex');
    run(
      'INSERT OR REPLACE INTO operators VALUES(?,?,?,?)',
      name,
      salt,
      scryptSync(password, salt, 32).toString('hex'),
      JSON.stringify(roles)
    );
    run('DELETE FROM sessions WHERE owner=?', 'op:' + name);
  }
  function opLogin(name, password) {
    const row = get('SELECT * FROM operators WHERE name=?', name);
    const digest = scryptSync(password || '', row?.salt || 'missing', 32);
    need(row && timingSafeEqual(digest, Buffer.from(row.digest, 'hex')), '账号或密码有误', 401);
    return session('op:' + name);
  }
  function publish(actor, module, base, value, reason) {
    validate(module, value);
    const old = get('SELECT version FROM active WHERE module=?', module).version;
    need(old === base, '基线已变化，请重新比较', 409);
    if (module === 'templates' && value.enabled !== false) {
      const actions = content().actions;
      for (const p of new Set(Object.values(value.patterns).flat()))
        need(
          actions.some((a) => a.pattern === p && a.approved && a.enabled && a.visible !== false),
          '周模板引用的模式尚无已审核动作：' + p
        );
    }
    const version = old + 1;
    run('INSERT INTO versions VALUES(?,?,?)', module, version, JSON.stringify(value));
    run('UPDATE active SET version=? WHERE module=?', version, module);
    if (module === 'foods')
      for (const f of value)
        for (const allergen of f.contains)
          run('INSERT OR IGNORE INTO risk VALUES(?,?)', f.id, allergen);
    audit(actor, '发布', { module, from: old, to: version, reason });
    return version;
  }
  return {
    db,
    get,
    all,
    run,
    tx,
    audit,
    content,
    account,
    ensure,
    session,
    owner,
    operator,
    opLogin,
    publish,
    hash
  };
}
module.exports = { open };
