const api = require('./service');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const shortDate = (date) =>
  Number(date.slice(5, 7)) + ' 月 ' + Number(date.slice(8)) + ' 日';
function weekDays(date) {
  const start = api.monday(date);
  return weekdays.map((weekday, index) => {
    const day = api.shift(start, index);
    return {
      date: day,
      number: Number(day.slice(8)),
      weekday,
      active: day === date
    };
  });
}
function meals(profile) {
  return ['早餐', '午餐', '晚餐'].map((name, index) => {
    const meal = { name, index, share: profile.ratios[index] };
    for (const [key, total] of Object.entries(profile.targets)) {
      const [first, second] = profile.ratios.map((ratio) =>
        Math.round((total * ratio) / 100)
      );
      meal[key] = [first, second, Math.round(total) - first - second][index];
    }
    return meal;
  });
}
module.exports = { shortDate, weekDays, meals };
