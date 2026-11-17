const { gearList, byId } = require('./catalog');
const guestKey = 'lianna.preferences.v1';
let key=guestKey;
function useAccount(id,prefs,rev) {
  key=id?'lianna.preferences.account.'+id:guestKey;snapshot=null;
  if(id&&prefs){const data=normalize(prefs);wx.setStorageSync(key,{...data,base:data,rev,dirty:false});snapshot=data;}
}
function resume(){const s=wx.getStorageSync('lianna.session.v2');if(s&&wx.getStorageSync('lianna.preferences.account.'+s.accountId))useAccount(s.accountId);}
function savedBase(){return wx.getStorageSync(key)?.base||null;}
function dirty(){return !!wx.getStorageSync(key)?.dirty;}
function inAccount(){return key!==guestKey;}
const equipment = new Set(gearList);
let snapshot;

function unique(values, allowed) {
  return Array.isArray(values) ? Array.from(new Set(values.filter(value => allowed.has(value)))) : [];
}

function normalize(data) {
  const owned = unique(data.owned, equipment);
  return {
    owned,
    active: unique(data.active, new Set(owned)),
    favorites: Array.from(new Set(unique(data.favorites, byId).map(id => byId.get(id).id)))
  };
}

function read() {
  if (!snapshot) {
    try {
      snapshot = normalize(wx.getStorageSync(key) || {});
    } catch (error) {
      // 读取失败时保留原存储，下一次进入页面时再尝试读取。
      return normalize({});
    }
  }
  return snapshot;
}

function write(data) {
  if (!snapshot) {
    wx.showToast({ title: '本地记录读取失败，请重试', icon: 'none' });
    return false;
  }
  const next = normalize(data);
  try {
    const old=wx.getStorageSync(key)||{};
    wx.setStorageSync(key, inAccount()?{...next,base:old.base,rev:old.rev,dirty:true}:next);
  } catch (error) {
    wx.showToast({ title: '本地保存失败，请重试', icon: 'none' });
    return false;
  }
  snapshot = next;
  return true;
}

function saveGear(owned, active) {
  return write(Object.assign({}, read(), { owned, active }));
}

function toggleFavorite(id) {
  const move = byId.get(id);
  if (!move) return false;
  const current = read();
  const set = new Set(current.favorites);
  const added = !set.has(move.id);
  if (added) set.add(move.id);
  else set.delete(move.id);
  if (!write(Object.assign({}, current, { favorites: Array.from(set) }))) return false;
  wx.showToast({ title: added ? '已加入收藏' : '已取消收藏', icon: 'none' });
  return true;
}

module.exports = { read, saveGear, toggleFavorite, useAccount, resume, dirty, inAccount, savedBase };
