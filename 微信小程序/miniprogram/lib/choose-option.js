// WeChat action sheets allow six rows. Paginate without dropping choices.
module.exports = async function chooseOption(labels) {
  let offset = 0;
  while (true) {
    const size = labels.length <= 6 ? 6 : 5;
    const page = labels.slice(offset, offset + size);
    const more = labels.length > 6;
    const index = await new Promise(resolve => wx.showActionSheet({
      itemList: more ? [...page, offset + size < labels.length ? '其他选项（下一页）' : '返回第一页'] : page,
      success: result => resolve(result.tapIndex), fail: () => resolve(-1)
    }));
    if (index < 0) return -1;
    if (index < page.length) return offset + index;
    offset = offset + size < labels.length ? offset + size : 0;
  }
};
