'use strict';
const crypto = require('node:crypto');
const {need} = require('./rules');
function prepare(store, owner, input) {
  need(input && typeof input.nickname === 'string', '请填写昵称');
  const nickname = input.nickname.trim();
  need([...nickname].length >= 1 && [...nickname].length <= 24 && !/[\x00-\x1f\x7f]/.test(nickname), '昵称须为1至24个字');
  need(input.consent === true, '请确认保存昵称和头像');
  let avatar = store.account(owner).identity?.avatar || '';
  if (input.avatarData) {
    need(typeof input.avatarData === 'string' && input.avatarData.length <= 350000 && /^[A-Za-z0-9+/]+={0,2}$/.test(input.avatarData), '头像格式无效或超过256KB，请重新选择');
    const data = Buffer.from(input.avatarData, 'base64');
    need(data.length > 16 && data.length <= 256 * 1024, '头像须小于256KB');
    const mime = data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'image/png' : data[0]===255 && data[1]===216 && data[2]===255 ? 'image/jpeg' : data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP' ? 'image/webp' : '';
    need(mime, '请使用PNG、JPEG或WebP头像');
    const id = crypto.randomBytes(24).toString('hex');
    store.run('INSERT OR REPLACE INTO user_avatars(owner,id,mime,data) VALUES(?,?,?,?)',owner,id,mime,data);
    avatar = '/avatars/' + id;
  }
  return {nickname,avatar,confirmedAt:new Date().toISOString()};
}
module.exports = {prepare};
