// The original date-keyed session remains readable. Additional sessions use
// date@session-key; consumers select by immutable session key, never array index.
function all(sessions) { return Object.values(sessions || {}); }
function onDate(sessions, date) { return Object.entries(sessions || {}).filter(([id,s])=>(s.date || id.split('@')[0])===date).map(([,s])=>s); }
function select(sessions, date, key) {
  if (key) return all(sessions).find(s => s.date === date && s.key === key);
  return sessions?.[date] || onDate(sessions, date)[0];
}
function remove(sessions, session) {
  for (const [id, s] of Object.entries(sessions)) if (s === session || (session.key && s.key === session.key)) delete sessions[id];
}
function put(sessions, session) {
  remove(sessions, session);
  sessions[sessions[session.date] ? session.date + '@' + session.key : session.date] = session;
  return session;
}
module.exports = { all, onDate, select, remove, put };
