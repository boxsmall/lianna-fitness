'use strict';
const routes = {
  workbench: '工作台',
  moves: '动作与器械',
  plans: '训练计划',
  foods: '食材与饮食规则',
  ai: 'AI 推荐与用量',
  users: '用户与反馈',
  releases: '发布与版本',
  roles: '角色与权限'
};
const modulesCN = {
  actions: '动作目录',
  templates: '训练模板',
  foods: '食材',
  nutrition: '营养规则',
  ai: '模型与提示词'
};
const modulePage = (k) =>
  Object.keys(sections).find((p) => sections[p].some(([m]) => m === k));
const today = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const routeTitle = () => routes[location.hash.slice(1)] || '工作台';
function allowed(title) {
  if (title === '用户与反馈')
    return roles.some((r) => ['客服', '管理员'].includes(r));
  return (
    !roles.every((r) => r === '客服') ||
    ['工作台', '角色与权限'].includes(title)
  );
}
function mountConsole() {
  const nav = $('nav');
  nav.replaceChildren();
  const icons = ['today', 'moves', 'week', 'nutrition', 'ai', 'mine'];
  Object.entries(routes).forEach(([slug, title], i) => {
    if (i === 6) el('div', null, nav, 'divider');
    if (!allowed(title)) return;
    const a = el('a', null, nav);
    a.href = '#' + slug;
    a.dataset.page = title;
    if (icons[i]) el('span', null, a).innerHTML = icon(icons[i]);
    a.append(document.createTextNode(title));
    a.onclick = (e) => {
      e.preventDefault();
      goConsole(title);
    };
  });
  window.onhashchange = () =>
    openConsole(routeTitle()).catch((e) => note(e.message));
}
function goConsole(title) {
  const hash = '#' + Object.keys(routes).find((k) => routes[k] === title);
  if (location.hash === hash) return openConsole(title);
  location.hash = hash;
}
function heading(title, subtitle, back) {
  $('title').textContent = title;
  $('subtitle').textContent = subtitle;
  $('crumb').textContent = '练哪管理后台　/　' + title;
  $('actions').replaceChildren();
  if (back) act('返回列表', back, $('actions'), 'link');
}
function act(text, fn, parent = $('actions'), cls = 'secondary') {
  const b = button(text, fn, parent);
  b.className = cls;
  return b;
}
function panel(parent, title) {
  const p = el('section', null, parent, 'panel');
  if (title) el('h2', title, p);
  return p;
}
function badge(val, c = 'green') {
  return el('span', val, null, 'tag ' + c);
}
function field(parent, label, values) {
  const wrap = el('label', label, parent);
  return select(
    wrap,
    values.map((v) => (Array.isArray(v) ? v : [v, v]))
  );
}
function tick(p, title, on) {
  const l = el('label', null, p, 'checkline'),
    x = el('input', null, l);
  x.type = 'checkbox';
  x.checked = on;
  l.append(title);
  return x;
}
function grid(parent, headers, rows) {
  const wrap = el('div', null, parent, 'table-wrap'),
    table = el('table', null, wrap),
    head = el('tr', null, el('thead', null, table));
  headers.forEach((h) => el('th', h, head));
  const tbody = el('tbody', null, table);
  for (const row of rows) {
    const tr = el('tr', null, tbody);
    row.forEach((v) => {
      const td = el('td', null, tr);
      if (v instanceof Node) td.append(v);
      else td.textContent = v ?? '—';
    });
  }
  if (!rows.length) {
    const td = el('td', '暂无符合条件的记录', el('tr', null, tbody), 'empty');
    td.colSpan = headers.length;
  }
  return wrap;
}
function stat(parent, title, value, hint, fn) {
  const box = el(fn ? 'button' : 'div', null, parent, 'stat');
  el('span', title, box, 'muted');
  el('div', value, box, 'metric');
  el('small', hint, box);
  if (fn) box.onclick = fn;
}
function modal(title) {
  const m = $('modal');
  m.replaceChildren();
  const h = el('div', null, m, 'flex');
  el('small', '练哪管理后台', h, 'muted');
  act('关闭', () => m.close(), h, 'close');
  el('h2', title, m);
  if (!m.open) m.showModal();
  return m;
}
function textSearch(parent, placeholder) {
  const x = el('input', null, parent);
  x.type = 'search';
  x.placeholder = placeholder;
  x.setAttribute('aria-label', placeholder);
  return x;
}
async function openConsole(title) {
  if (!allowed(title)) title = '工作台';
  const id = ++generation;
  tab = title;
  body.replaceChildren();
  heading(title, '');
  for (const a of $('nav').querySelectorAll('a'))
    a.classList.toggle('on', a.dataset.page === title);
  const root = el('div', null, body);
  try {
    await {
      工作台: dashboard,
      动作与器械: movesList,
      训练计划: plansView,
      食材与饮食规则: foodsView,
      'AI 推荐与用量': aiView,
      用户与反馈: ticketsView,
      发布与版本: releasesView,
      角色与权限: rolesView
    }[title](root);
  } catch (e) {
    if (id === generation) el('p', e.message, root, 'note');
  }
}
async function dashboard(root) {
  heading('工作台', '运行与内容概况');
  if (roles.every((r) => r === '客服')) {
    act('查看我的工单', () => goConsole('用户与反馈'));
    return;
  }
  const date = el('input', null, $('actions'));
  date.type = 'date';
  date.value = today();
  date.setAttribute('aria-label', '统计日期');
  async function load() {
    const value = date.value;
    const [events, overview, foods] = await Promise.all([
      api('admin/dashboard', { date: value }),
      api('admin/overview', { date: value }),
      api('admin/inspect', { module: 'foods' })
    ]);
    if (!root.isConnected || value !== date.value) return;
    root.replaceChildren();
    $('subtitle').textContent = value + ' · 运行与内容概况';
    const issues = events.filter((e) =>
        ['排课失败', '动图失败'].includes(e.kind)
      ),
      foodCount = foods.active.filter((f) => !f.checked?.length).length,
      ai = events.filter((e) => e.kind === 'AI 调用');
    const stats = el('div', null, root, 'stats');
    for (const [name, v, h, target] of [
      [
        '待处理排课',
        issues.filter((e) => e.kind === '排课失败').length,
        '查看排课原因',
        '训练计划'
      ],
      [
        '素材加载异常',
        issues.filter((e) => e.kind === '动图失败').length,
        '检查动作素材',
        '动作与器械'
      ],
      ['食材待核对', foodCount, '当前过敏原资料待核对', '食材与饮食规则'],
      [
        'AI 当日费用',
        '¥ ' + ai.reduce((s, e) => s + (e.info.cost || 0), 0).toFixed(2),
        '查看调用与费用',
        'AI 推荐与用量'
      ]
    ])
      stat(stats, name, v, h + ' →', () => goConsole(target));
    const cols = el('div', null, root, 'columns'),
      pending = panel(cols),
      line = el('div', null, pending, 'flex title-line');
    el('h2', '需要处理', line);
    line.append(badge(issues.length + foodCount + ' 项', 'orange'));
    const grouped = new Map();
    for (const e of issues) {
      const key = e.info.reason || e.kind;
      if (!grouped.has(key))
        grouped.set(key, [
          key,
          0,
          e.at.slice(11, 16),
          e.kind === '排课失败' ? '训练计划' : '动作与器械'
        ]);
      grouped.get(key)[1]++;
    }
    const rows = [...grouped.values()];
    if (foodCount)
      rows.push(['过敏原信息待核对', foodCount, '当前', '食材与饮食规则']);
    grid(
      pending,
      ['问题', '数量', '最近发生', ''],
      rows.map(([q, n, t, p]) => [
        q,
        n,
        t,
        act('查看详情', () => goConsole(p), null, 'link')
      ])
    );
    const weekly = panel(cols, '本周计划生成'),
      chart = el('div', null, weekly, 'bar-chart'),
      max = Math.max(1, ...overview.trend.map((x) => x.generated));
    for (const x of overview.trend) {
      const bar = el('div', null, chart, 'bar-col');
      bar.style.height = Math.max(1, (118 * x.generated) / max) + 'px';
      bar.title = x.day + ' · ' + x.generated + ' 份';
      el('span', '日一二三四五六'[new Date(x.day + 'T12:00:00').getDay()], bar);
    }
    el('div', null, weekly, 'divider');
    for (const [k, label] of [
      ['generated', '成功生成'],
      ['saved', '用户保存']
    ]) {
      const l = el('div', null, weekly, 'flex');
      el('span', label, l, 'muted');
      el('b', overview.trend.reduce((n, d) => n + d[k], 0) + ' 份', l);
    }
    const hist = panel(root),
      h = el('div', null, hist, 'flex title-line');
    el('h2', '最近发布', h);
    act('所有版本', () => goConsole('发布与版本'), h, 'link');
    grid(
      hist,
      ['发布内容', '版本', '发布人', '时间', '状态'],
      overview.history
        .slice(0, 5)
        .map((e) => [
          modulesCN[e.info.module],
          'v' + e.info.to,
          e.actor.replace(/^op:/, ''),
          e.at,
          badge('已发布')
        ])
    );
  }
  date.onchange = () => load().catch((e) => note(e.message));
  await load();
}
async function movesList(root) {
  heading('动作与器械', '自动排课池逐项审核');
  const [source, info] = await Promise.all([
    api('admin/source'),
    api('admin/inspect', { module: 'actions' })
  ]);
  if (!root.isConnected) return;
  $('subtitle').textContent =
    '共 ' + source.length + ' 个动作 · 自动排课池逐项审核';
  const active = new Map(info.active.map((a) => [a.id, a]));
  const records = [...source].sort(
    (a, b) => Number(active.has(b.id)) - Number(active.has(a.id))
  );
  const box = panel(root),
    filters = el('div', null, box, 'filters'),
    q = textSearch(filters, '搜索动作名称或编号'),
    part = select(filters, [
      ['', '全部训练部位'],
      ...Array.from(new Set(source.map((x) => x.part)), (p) => [p, p])
    ]),
    gear = select(filters, [
      ['', '全部器械'],
      ...Array.from(
        new Set(source.flatMap((x) => (x.gear.length ? x.gear : ['徒手']))),
        (p) => [p, p]
      )
    ]);
  let pending = false,
    index = 0;
  const flag = act('查看待审核', () => {
    pending = !pending;
    flag.textContent = pending ? '查看全部' : '查看待审核';
    refresh();
  });
  const list = el('div', null, box);
  function paint() {
    list.replaceChildren();
    const items = records.filter(
      (m) =>
        (!pending || (active.has(m.id) && !active.get(m.id).approved)) &&
        (!part.value || m.part === part.value) &&
        (!gear.value ||
          (m.gear.length ? m.gear : ['徒手']).includes(gear.value)) &&
        (m.id + ' ' + (active.get(m.id)?.name || m.name)).includes(
          q.value.trim()
        )
    );
    const chunk = items.slice(index * 10, index * 10 + 10);
    grid(
      list,
      ['动作', '部位 / 模式', '必需器械', '浏览状态', '自动排课', '版本', ''],
      chunk.map((m) => {
        const a = active.get(m.id),
          cell = el('div', null, null, 'row-title'),
          im = el('img', null, cell, 'thumb');
        im.src = '/media/cover/' + m.id;
        im.alt = '';
        const t = el('div', null, cell);
        el('strong', a?.name || m.name, t);
        el('small', m.id, t, 'muted');
        return [
          cell,
          m.part + ' / ' + (a?.pattern || '—'),
          (a?.gear || m.gear).join(' · ') || '徒手',
          badge(a?.visible === false ? '隐藏' : '可浏览'),
          badge(
            a?.approved && a.enabled ? '已审核' : a ? '待复核' : '未纳入',
            a?.approved && a.enabled ? 'green' : 'orange'
          ),
          'v' + info.version,
          act('核对与编辑', () => moveEditor(root, m, info), null, 'link')
        ];
      })
    );
    const pager = el('div', null, list, 'pager');
    el(
      'small',
      index +
        1 +
        ' / ' +
        Math.max(1, Math.ceil(items.length / 10)) +
        ' 页 · ' +
        items.length +
        ' 项',
      pager
    );
    if (index)
      act(
        '上一页',
        () => {
          index--;
          paint();
        },
        pager,
        'link'
      );
    if ((index + 1) * 10 < items.length)
      act(
        '下一页',
        () => {
          index++;
          paint();
        },
        pager,
        'link'
      );
  }
  function refresh() {
    index = 0;
    paint();
  }
  q.oninput = part.onchange = gear.onchange = refresh;
  paint();
}
function moveEditor(root, m, info) {
  root.replaceChildren();
  const catalog = structuredClone(info.active),
    found = catalog.find((x) => x.id === m.id),
    a = found || {
      id: m.id,
      name: m.name,
      unit: '次',
      target: 10,
      seconds: 3,
      rest: 45,
      level: '基础',
      enabled: false,
      approved: false,
      visible: true,
      replacements: []
    };
  if (!found) catalog.push(a);
  heading(
    a.name,
    m.id + ' · ' + m.part + ' / ' + m.muscle + ' · 动作资料 v' + info.version,
    () => openConsole('动作与器械')
  );
  const cols = el('div', null, root, 'columns'),
    left = panel(cols, '演示对照'),
    compare = el('div', null, left, 'compare');
  for (const [k, l] of [
    ['original', '原版参考 GIF · © Gym visual'],
    ['new', '当前重制动图']
  ]) {
    const wrap = el('div', null, compare);
    el('p', l, wrap, 'muted');
    const im = el('img', null, wrap);
    im.src = '/media/' + k + '/' + m.id;
    im.alt = l;
  }
  el('h3', '动作说明', left, 'section-head');
  const steps = inp(
    left,
    '动作步骤',
    (a.steps || m.steps || []).join('\n'),
    'area'
  );
  el('div', '核对姿势、角度与动作轨迹后，保存新的图文版本。', left, 'note');
  const right = panel(cols, '排课属性'),
    form = el('div', null, right, 'form-grid');
  const pattern = field(form, '动作模式', [
      ...new Set([
        a.pattern || '辅助',
        '蹲',
        '髋',
        '推',
        '拉',
        '辅助',
        '核心',
        '热身',
        '有氧'
      ])
    ]),
    level = field(form, '难度', ['基础', '进阶']);
  level.value = a.level;
  const target = inp(form, '每组目标（' + a.unit + '）', a.target, 'number'),
    seconds = inp(form, '每次预计秒数', a.seconds, 'number'),
    rest = inp(form, '建议休息秒数', a.rest, 'number');
  el('h3', '必需器械', right, 'section-head');
  el(
    'span',
    (a.gear || m.gear).join(' · ') || '徒手',
    el('div', null, right, 'pill-group'),
    'pill on'
  );
  const visible = tick(right, '用户可浏览', a.visible !== false),
    enabled = tick(right, '可参与自动排课', a.enabled),
    approved = tick(right, '排课属性已核对', a.approved);
  el('div', null, right, 'divider');
  el('h3', '关联训练模板', right);
  el(
    'p',
    Object.entries(info.templates || {})
      .filter(([, v]) => v.includes(pattern.value))
      .map(([k]) => k)
      .join(' · ') || '暂无匹配',
    right,
    'muted'
  );
  act('查看模板', () => goConsole('训练计划'), right, 'link');
  async function save(submit) {
    Object.assign(a, {
      pattern: pattern.value,
      level: level.value,
      target: +target.value,
      seconds: +seconds.value,
      rest: +rest.value,
      visible: visible.checked,
      enabled: enabled.checked,
      approved: approved.checked
    });
    if (steps.value.trim())
      a.steps = steps.value
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
    const d = await api('admin/draft', {
      module: 'actions',
      base: info.version,
      value: catalog
    });
    if (submit) await api('admin/submit', { module: 'actions', id: d.id });
    note((submit ? '已提交审核 #' : '已保存草稿 #') + d.id);
    await openConsole('发布与版本');
  }
  if (roles.includes('运营')) {
    act('保存草稿', () => save(false));
    act('提交审核', () => save(true), $('actions'), 'primary');
  }
  act(
    '完整条目设置',
    () => editModule('动作与器械', { item: m.id }),
    right,
    'link'
  );
}
async function plansView(root) {
  heading('训练计划', '模板试排与生成问题追溯');
  act('编辑模板', () => editModule('训练计划'));
  const info = await api('admin/inspect', { module: 'templates' });
  if (!root.isConnected) return;
  const cols = el('div', null, root, 'columns narrow'),
    form = panel(cols, '模拟用户条件'),
    result = panel(cols);
  const goal = field(form, '训练目标', ['增肌', '减脂', '日常健身']),
    g = el('div', null, form, 'form-grid'),
    days = field(
      g,
      '每周天数',
      [3, 1, 2, 4, 5, 6, 7].map((i) => [i, i + ' 天'])
    ),
    duration = field(
      g,
      '每次时长',
      [30, 15, 45, 60, 90].map((i) => [i, i + ' 分钟'])
    ),
    exp = field(form, '经验', ['基础', '有经验']),
    db = tick(form, '哑铃', true),
    bench = tick(form, '训练凳', false);
  const calendar = el('fieldset', null, form);
  el('legend', '选择训练日', calendar);
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(
    (label) => tick(calendar, label, false)
  );
  const useFour = tick(calendar, '先套用四天模板，其余训练日手动编排', false);
  calendar.hidden = +days.value <= 4;
  days.onchange = () => {
    calendar.hidden = +days.value <= 4;
  };
  el('p', '当前训练模板 v' + info.version, form, 'muted');
  act('生成试排结果', run, form, 'primary wide');
  async function run() {
    result.replaceChildren();
    el('h2', '一周预览', result);
    try {
      const d = new Date(today() + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const plan = await api('preview/draft', {
        module: 'templates',
        value: info.active,
        sample: {
          goal: goal.value,
          minutes: +duration.value,
          days: +days.value,
          start: d.toISOString().slice(0, 10),
          experience: exp.value,
          ...(+days.value > 4
            ? {
                weekdays: weekdays.flatMap((input, index) =>
                  input.checked ? [index] : []
                ),
                useFour: useFour.checked
              }
            : {}),
          gear: [
            ...(db.checked ? ['哑铃'] : []),
            ...(bench.checked ? ['训练凳'] : [])
          ]
        }
      });
      const sessions = Object.values(plan.sessions);
      el(
        'div',
        sessions.length +
          ' 次训练，预计 ' +
          Math.ceil(sessions.reduce((sum, s) => sum + s.timing.total, 0) / 60) +
          ' 分钟。已计入热身、休息和转换时间。',
        result,
        'note'
      );
      const strip = el('div', null, result, 'trial-days'),
        detail = el('div', null, result);
      function display(s, i) {
        [...strip.children].forEach((b, j) =>
          b.classList.toggle('on', i === j)
        );
        detail.replaceChildren();
        el('h3', s.date + ' · ' + s.type, detail, 'section-head');
        grid(
          detail,
          ['动作', '组次', '用时', '入选理由'],
          s.items.map((m) => [
            m.name,
            m.sets + ' × ' + m.target + m.unit,
            Math.ceil(
              (m.sets * m.target * (m.unit === '秒' ? 1 : m.seconds) +
                (m.sets - 1) * m.rest) /
                60
            ) + ' 分钟',
            m.pattern + ' · 器械满足'
          ])
        );
        el(
          'p',
          '热身 ' +
            Math.ceil(s.timing.warm / 60) +
            ' 分钟 · 转换 ' +
            Math.ceil(s.timing.transition / 60) +
            ' 分钟 · 合计 ' +
            Math.ceil(s.timing.total / 60) +
            ' 分钟',
          detail,
          'note'
        );
        if (plan.rejected?.length)
          el(
            'div',
            '排除候选 · ' +
              plan.rejected[0].id +
              '　' +
              plan.rejected[0].reason,
            detail,
            'review-change'
          );
      }
      sessions.forEach((s, i) => {
        const b = act('', () => display(s, i), strip, 'mini-plan');
        el(
          'span',
          '周' + '日一二三四五六'[new Date(s.date + 'T12:00:00').getDay()],
          b,
          'muted'
        );
        el('strong', s.type, b);
        el('span', s.budget + ' 分钟', b);
      });
      if (sessions[0]) display(sessions[0], 0);
    } catch (e) {
      el('div', e.message, result, 'review-change');
    }
  }
  await run();
}
async function foodsView(root) {
  heading('食材与饮食规则', '食材称重口径、过敏原与营养目标管理');
  const [f, n] = await Promise.all(
    ['foods', 'nutrition'].map((module) => api('admin/inspect', { module }))
  );
  if (!root.isConnected) return;
  act('管理食材草稿', () => editModule('食材与饮食规则', { module: 'foods' }));
  act('份量试算', () => calcView(root, f, n), $('actions'), 'primary');
  const box = panel(root),
    line = el('div', null, box, 'flex title-line');
  el('h2', '食材条目', line);
  line.append(
    badge(
      f.active.filter((x) => !x.checked?.length).length + ' 项待补资料',
      'orange'
    )
  );
  const filter = textSearch(
      el('div', null, box, 'filters'),
      '搜索食材名称或编号'
    ),
    list = el('div', null, box);
  function draw() {
    list.replaceChildren();
    grid(
      list,
      [
        '食材条目',
        '称重口径',
        '每 100 g 碳水 / 蛋白 / 脂肪',
        '过敏原',
        '版本',
        ''
      ],
      f.active
        .filter((x) => (x.name + x.id).includes(filter.value.trim()))
        .map((x) => [
          x.name,
          x.state,
          [x.carb, x.protein, x.fat].join(' / ') + ' g',
          badge(
            x.checked?.length ? '已核对 ' + x.checked.length + ' 项' : '待核对',
            x.checked?.length ? 'green' : 'orange'
          ),
          'v' + f.version,
          act(
            '编辑',
            () => editModule('食材与饮食规则', { module: 'foods', item: x.id }),
            null,
            'link'
          )
        ])
    );
  }
  draw();
  filter.oninput = draw;
  const rules = panel(root),
    h = el('div', null, rules, 'flex title-line');
  el('h2', '当前营养规则', h);
  act(
    '编辑规则',
    () => editModule('食材与饮食规则', { module: 'nutrition' }),
    h,
    'link'
  );
  const g = el('div', null, rules, 'stats');
  for (const [l, v, t] of [
    ['分餐比例', '30 / 40 / 30', '默认早餐 / 午餐 / 晚餐'],
    [
      '默认供能比例',
      n.active.macroRatio?.join(' / ') || '待发布',
      '碳水 / 蛋白质 / 脂肪'
    ],
    ['普通食材取整', '5 g', '按最终显示重量汇总'],
    ['油脂类取整', '1 g', '已锁定量保持原输入']
  ]) {
    const x = el('div', null, g);
    el('p', l, x, 'muted');
    el('h2', v, x);
    el('p', t, x, 'muted');
  }
}
async function calcView(root, f, n) {
  heading(
    '份量试算',
    '食材 v' +
      f.version +
      ' · 营养规则 v' +
      n.version +
      ' · 示例目标用于验证计算逻辑',
    () => openConsole('食材与饮食规则')
  );
  root.replaceChildren();
  if (
    !['carb', 'protein'].every((type) =>
      f.active.some((food) => food.enabled && food.primary === type)
    )
  ) {
    el(
      'p',
      '请先在管理食材草稿中核对并发布主食、蛋白质来源，再进行份量试算。',
      root,
      'note'
    );
    act(
      '管理食材草稿',
      () => editModule('食材与饮食规则', { module: 'foods' }),
      root
    );
    return;
  }
  const cols = el('div', null, root, 'columns narrow'),
    form = panel(cols, '本餐目标'),
    output = panel(cols, '按显示重量汇总');
  const target = { kcal: 500, carb: 60, protein: 35, fat: 15 };
  el('p', '碳水 60 g · 蛋白质 35 g · 脂肪 15 g', form, 'muted');
  el('div', null, form, 'divider');
  const opt = (k) =>
    f.active
      .filter((x) => x.primary === k && x.enabled)
      .map((x) => [x.id, x.name + ' · ' + x.state]);
  const carb = field(form, '主食', opt('carb')),
    grams = inp(form, '实际份量 · 克', '150', 'number'),
    lock = tick(form, '锁定这份主食', true),
    protein = field(form, '蛋白质来源', opt('protein'));
  const render = async () => {
    output.replaceChildren();
    el('h2', '按显示重量汇总', output);
    try {
      const r = await api('preview/draft', {
        module: 'foods',
        value: f.active,
        sample: {
          profile: {
            ...sampleMeal.profile,
            targets: Object.fromEntries(
              Object.entries(target).map(([k, v]) => [k, v * 2])
            ),
            ratios: [25, 50, 25]
          },
          index: 1,
          items: [
            {
              id: carb.value,
              ...(lock.checked ? { locked: +grams.value } : {})
            },
            { id: protein.value }
          ]
        }
      });
      grid(
        output,
        ['食材', '称重口径', '重量', '碳水', '蛋白质', '脂肪'],
        r.rows.map((x) => [
          x.name,
          x.state,
          x.grams + ' g' + (x.locked != null ? ' · 已锁定' : ''),
          ...['carb', 'protein', 'fat'].map(
            (k) => ((x[k] * x.grams) / 100).toFixed(1) + ' g'
          )
        ])
      );
      const g = el('div', null, output, 'nutrition');
      for (const [k, l] of [
        ['carb', '碳水'],
        ['protein', '蛋白质'],
        ['fat', '脂肪']
      ]) {
        const x = el('div', null, g);
        el('p', l, x, 'muted');
        el('b', r.actual[k] + ' g', x);
        const delta = r.delta[k];
        const difference =
          delta === 0
            ? '达到目标'
            : (delta > 0 ? '还差 ' : '超出 ') + Math.abs(delta) + ' g';
        el('p', '目标 ' + r.target[k] + ' g · ' + difference, x, 'muted');
      }
      el(
        'div',
        '按每项食材的显示重量汇总营养。锁定的食材保留输入克数。',
        output,
        'note'
      );
      el('h3', '计算追溯', output, 'section-head');
      el(
        'div',
        [
          '食材版本 v' + f.version + ' · 营养规则 v' + n.version,
          ...r.rows.map(
            (x) => x.name + ' · ' + x.state + ' · ' + x.grams + ' g'
          ),
          '计算顺序　扣除锁定食材的营养贡献 → 推荐份量 → 取整 → 汇总'
        ].join('\n'),
        output,
        'code'
      );
    } catch (e) {
      el('p', e.message, output, 'note');
    }
  };
  act('重新试算', render, form, 'primary wide');
  await render();
}
async function aiView(root) {
  heading('AI 推荐与用量', '模型配置、调用成本与异常追踪');
  act('固定样例对比', () => editModule('AI 推荐与用量'));
  const [trend, info, events] = await Promise.all([
    api('admin/usage', { date: today() }),
    api('admin/inspect', { module: 'ai' }),
    api('admin/dashboard', { date: today() })
  ]);
  if (!root.isConnected) return;
  const day = trend.at(-1),
    stats = el('div', null, root, 'stats');
  for (const [t, v, h] of [
    ['今日调用', day.calls, '成功 ' + day.success + ' 次'],
    [
      '成功率',
      day.calls ? ((day.success / day.calls) * 100).toFixed(1) + '%' : '—',
      '当日成功次数 / 尝试次数'
    ],
    ['今日费用', '¥ ' + day.cost.toFixed(2), '按模型配置单价计算'],
    [
      '每次成功推荐',
      day.success ? '¥ ' + (day.cost / day.success).toFixed(4) : '—',
      '费用 ÷ 成功交付次数'
    ]
  ])
    stat(stats, t, v, h);
  const cols = el('div', null, root, 'columns'),
    cfg = panel(cols, '当前配置'),
    form = el('div', null, cfg, 'form-grid'),
    a = info.active;
  const models = [
    ['deepseek-flash', 'DeepSeek Flash'],
    ['deepseek-v4-pro', 'DeepSeek V4 Pro']
  ];
  if (a.model && !models.some(([id]) => id === a.model))
    models.push([a.model, a.model]);
  const model = field(form, '模型', models);
  model.value = a.model || 'deepseek-flash';
  const ver = inp(form, '提示词版本', 'v' + info.version);
  ver.readOnly = true;
  const limit = inp(form, '每日调用上限', a.dailyLimit, 'number'),
    prompt = inp(cfg, '提示词', a.prompt, 'area');
  const inputPrice = inp(
    form,
    '输入单价（元 / 百万 token）',
    a.pricePerMillionInput,
    'number'
  );
  const outputPrice = inp(
    form,
    '输出单价（元 / 百万 token）',
    a.pricePerMillionOutput,
    'number'
  );
  for (const price of [inputPrice, outputPrice]) {
    price.min = '0';
    price.step = 'any';
  }
  limit.min = '0';
  el('p', '每日上限为 0 时暂停 AI 推荐。费用按配置单价估算。', cfg, 'muted');
  const connection = await api('admin/ai-status');
  el(
    'p',
    'DeepSeek · ' + (connection.configured ? '密钥已配置' : '待配置 API Key'),
    cfg,
    'note'
  );
  if (roles.includes('管理员')) {
    const key = inp(cfg, 'DeepSeek API Key', '', 'password');
    key.autocomplete = 'new-password';
    act(
      '保存 API Key',
      async () => {
        await api('admin/key', { key: key.value.trim() });
        key.value = '';
        await openConsole('AI 推荐与用量');
        note('密钥已保存');
      },
      cfg
    );
  }
  if (roles.some((r) => ['运营', '管理员'].includes(r)))
    act(
      '保存配置草稿',
      async () => {
        const d = await api('admin/draft', {
          module: 'ai',
          base: info.version,
          value: {
            ...a,
            model: model.value,
            prompt: prompt.value,
            dailyLimit: +limit.value,
            pricePerMillionInput: +inputPrice.value,
            pricePerMillionOutput: +outputPrice.value
          }
        });
        note('已保存草稿 #' + d.id);
        await openConsole('发布与版本');
      },
      cfg
    );
  else {
    model.disabled = true;
    for (const x of [limit, prompt, inputPrice, outputPrice]) x.readOnly = true;
  }
  act('配置详情与密钥', () => editModule('AI 推荐与用量'), cfg, 'link');
  el('div', '超时或额度用尽时，用户可手动选食材并计算份量。', cfg, 'note');
  const exc = panel(cols, '最近异常'),
    calls = events.filter((e) => e.kind === 'AI 调用'),
    groups = new Map();
  for (const e of calls.filter((e) => !e.info.ok)) {
    const why = e.info.reason || e.info.error || '调用失败';
    groups.set(why, (groups.get(why) || 0) + 1);
  }
  grid(
    exc,
    ['结果', '次数', '处理'],
    Array.from(groups, ([k, v]) => [k, v, '保留手选入口'])
  );
  el('h3', '最近调用', exc, 'section-head');
  el(
    'div',
    calls
      .slice(0, 4)
      .map((e) => e.at + '　' + (e.info.ok ? '成功' : '失败'))
      .join('\n') || '今日暂无调用',
    exc,
    'code'
  );
  grid(
    panel(root, '近七天模型用量'),
    ['日期', '尝试', '成功', '输入 / 输出 token', '费用'],
    trend.map((d) => [
      d.date,
      d.calls,
      d.success,
      d.input + ' / ' + d.output,
      '¥ ' + d.cost.toFixed(5)
    ])
  );
}
async function ticketsView(root) {
  heading('用户与反馈', '通过工单定位问题发生时的资料版本');
  const list = await api('admin/tickets');
  const box = panel(root),
    filters = el('div', null, box, 'filters'),
    q = textSearch(filters, '输入工单号或反馈内容'),
    status = select(filters, [
      ['', '全部工单'],
      ['待处理', '待处理'],
      ['已处理', '已处理']
    ]),
    target = el('div', null, box);
  function draw() {
    target.replaceChildren();
    grid(
      target,
      ['工单', '类型', '问题', '关联对象', '状态', ''],
      list
        .filter(
          (t) =>
            (!status.value || t.status === status.value) &&
            [t.id, t.detail, t.kind, t.mealRef].join(' ').includes(q.value)
        )
        .map((t) => [
          '#' + t.id,
          t.kind,
          t.detail,
          t.mealRef || '—',
          badge(t.status, t.status === '已处理' ? 'green' : 'orange'),
          act('处理', () => ticket(t), null, 'link')
        ])
    );
  }
  q.oninput = status.onchange = draw;
  draw();
  el(
    'div',
    '工单资料按角色和授权范围展示，访问个人字段会留存审计记录。',
    root,
    'note'
  );
}
async function ticket(t) {
  const detail = await api('admin/ticket', { id: t.id }),
    m = modal('工单 #' + t.id + ' · ' + t.kind);
  el('p', t.detail, m);
  el('pre', JSON.stringify(detail.versions || [], null, 2), m, 'code');
  if (t.consent)
    act(
      '查看授权资料',
      async () =>
        el(
          'pre',
          JSON.stringify(
            await api('admin/ticket', { id: t.id, personal: true }),
            null,
            2
          ),
          m,
          'code'
        ),
      m
    );
  if (roles.includes('管理员')) {
    const who = inp(m, '分派给客服', t.assignee || '');
    act(
      '分派',
      async () => {
        await api('admin/assign', { id: t.id, assignee: who.value });
        note('已分派');
      },
      m
    );
  }
  if (t.status !== '已处理' && (t.kind !== '注销' || roles.includes('管理员')))
    act(
      t.kind === '注销' ? '执行注销申请' : '标记已处理',
      async () => {
        if (
          t.kind === '注销' &&
          !confirm('确认删除该用户的资料、训练和饮食记录？')
        )
          return;
        await api('admin/ticket', {
          id: t.id,
          [t.kind === '注销' ? 'erase' : 'resolve']: true
        });
        m.close();
        await openConsole('用户与反馈');
      },
      m,
      'primary'
    );
}
async function releasesView(root) {
  heading('发布与版本', '查看差异、审核草稿或回退已发布版本');
  const [meta, overview] = await Promise.all([
    api('admin/modules'),
    api('admin/overview', { date: today() })
  ]);
  const rows = meta.drafts.map((d) => [
    modulesCN[d.module],
    '#' + d.id,
    'v' + d.base,
    d.byname,
    badge(d.status, d.status === '待审核' ? 'orange' : 'green'),
    act(
      d.status === '待审核' ? '审核差异' : '查看草稿',
      () => reviewDraft(d),
      null,
      'link'
    )
  ]);
  for (const [k, v] of Object.entries(meta.versions))
    if (modulesCN[k])
      rows.push([
        modulesCN[k],
        '—',
        'v' + v,
        '—',
        badge('已发布'),
        act(
          '版本与回退',
          () => editModule(modulePage(k), { module: k }),
          null,
          'link'
        )
      ]);
  grid(
    panel(root),
    ['内容', '候选版本', '当前 / 基线版本', '提交人', '状态', ''],
    rows
  );
  const log = panel(root, '操作记录');
  for (const e of overview.history)
    el(
      'div',
      e.at +
        '　' +
        e.actor.replace(/^op:/, '') +
        ' 发布' +
        modulesCN[e.info.module] +
        ' v' +
        e.info.to +
        '　' +
        e.info.reason,
      log,
      'audit-item'
    );
  if (!overview.history.length) el('p', '暂无发布记录', log, 'empty');
}
async function rolesView(root) {
  heading('角色与权限', '服务端按角色及授权范围检查每次操作');
  grid(
    panel(root),
    ['权限', '管理员', '内容运营', '审核人员', '客服'],
    [
      ['账号、角色与密钥', '允许', '—', '—', '—'],
      ['内容草稿', '需运营权限', '允许', '可查看', '—'],
      ['AI 配置草稿', '允许', '允许', '可查看', '—'],
      ['试排与份量试算', '允许', '允许', '允许', '—'],
      ['发布与按模块回退', '需审核权限', '—', '允许', '—'],
      ['个人资料', '按授权', '—', '—', '按工单授权'],
      ['工单与注销', '允许', '—', '—', '按分派工单']
    ]
  );
  if (roles.includes('管理员')) {
    const status = await api('admin/wechat-status');
    const wechat = panel(root, '微信小程序登录');
    el('p', 'AppID：' + status.appId, wechat);
    const configured = el('p', status.configured ? 'AppSecret 已配置' : 'AppSecret 尚未配置', wechat);
    const secret = inp(wechat, 'AppSecret', '', 'password');
    secret.autocomplete = 'new-password';
    el('p', '密钥仅加密保存在服务器，不会返回到页面或写入小程序。', wechat, 'muted');
    act('保存 AppSecret', async () => {
      const key = secret.value.trim();
      if (!/^[0-9a-f]{32}$/i.test(key)) throw Error('AppSecret 应为 32 位十六进制字符');
      await api('admin/wechat-key', { key });
      secret.value = '';
      configured.textContent = 'AppSecret 已配置';
      note('AppSecret 已加密保存');
    }, wechat, 'primary');
    const form = panel(root, '管理后台账号与角色'),
      g = el('div', null, form, 'form-grid'),
      n = inp(g, '账号'),
      p = inp(g, '新密码（至少 12 位）', '', 'password');
    el('p', '角色（可多选）', form, 'field-label');
    const dropdown = el('details', null, form, 'role-picker');
    const summary = el('summary', '请选择角色', dropdown);
    const choices = el('div', null, dropdown, 'role-options');
    const checks = ['管理员', '运营', '审核', '客服'].map((role) => {
      const input = tick(choices, role, false);
      input.value = role;
      input.onchange = () => {
        summary.textContent = selectedRoles().join('、') || '请选择角色';
      };
      return input;
    });
    function selectedRoles() {
      return checks
        .filter((input) => input.checked)
        .map((input) => input.value);
    }
    dropdown.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        dropdown.open = false;
        summary.focus();
      }
    });
    form.addEventListener('focusout', (event) => {
      if (!dropdown.contains(event.relatedTarget)) dropdown.open = false;
    });
    act(
      '保存账号',
      async () => {
        if (!n.value.trim()) throw Error('请填写账号');
        if (p.value.length < 12) throw Error('密码至少需要 12 位');
        if (!selectedRoles().length) throw Error('请至少选择一个角色');
        await api('admin/operator', {
          name: n.value.trim(),
          password: p.value,
          roles: selectedRoles()
        });
        p.value = '';
        note('已保存');
      },
      form,
      'primary'
    );
  }
}
async function reviewDraft(d) {
  const info = await api('admin/inspect', { module: d.module, id: d.id });
  const draft = info.draft;
  if (!draft) throw Error('草稿已不存在');
  const current = info.active,
    next = JSON.parse(draft.value),
    m = modal('审核差异');
  el(
    'p',
    modulesCN[d.module] +
      ' · 草稿 #' +
      d.id +
      ' · 基线 v' +
      d.base +
      ' → 当前 v' +
      info.version,
    m,
    'muted'
  );
  const before = Array.isArray(current)
      ? Object.fromEntries(current.map((v) => [v.id, v]))
      : current,
    after = Array.isArray(next)
      ? Object.fromEntries(next.map((v) => [v.id, v]))
      : next;
  let count = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    count++;
    const details = el('details', null, m, 'review-change');
    el(
      'summary',
      (after[key]?.name || before[key]?.name || key) + ' · ' + key,
      details
    );
    const prev = before[key],
      candidate = after[key];
    if (
      prev &&
      candidate &&
      typeof prev === 'object' &&
      typeof candidate === 'object' &&
      !Array.isArray(prev) &&
      !Array.isArray(candidate)
    ) {
      const fields = [
        ...new Set([...Object.keys(prev), ...Object.keys(candidate)])
      ];
      for (const field of fields.filter(
        (f) => JSON.stringify(prev[f]) !== JSON.stringify(candidate[f])
      )) {
        const labels = {
          name: '名称',
          enabled: '启用',
          steps: '动作说明',
          gear: '器械',
          pattern: '动作模式',
          media: '演示素材',
          state: '称重口径',
          checked: '已核对过敏原'
        };
        el(
          'p',
          (labels[field] || field) +
            '　' +
            JSON.stringify(prev[field] ?? null) +
            ' → ' +
            JSON.stringify(candidate[field] ?? null),
          details
        );
      }
    } else {
      el(
        'pre',
        '当前版本\n' +
          JSON.stringify(prev ?? null, null, 2) +
          '\n候选版本\n' +
          JSON.stringify(candidate ?? null, null, 2),
        details
      );
    }
    if (count === 1) details.open = true;
  }
  if (!count) el('p', '与当前发布内容相同。', m, 'note');
  const reason = inp(m, '审核意见或发布原因', '', 'area'),
    buttons = el('div', null, m, 'actions');
  act(
    '打开草稿',
    () => {
      m.close();
      return editModule(modulePage(d.module), {
        module: d.module,
        draft: d.id
      });
    },
    buttons,
    'link'
  );
  if (draft.status === '待审核' && roles.includes('审核'))
    for (const [op, text] of [
      ['reject', '退回修改'],
      ['publish', '确认发布']
    ])
      act(
        text,
        async () => {
          await api('admin/' + op, {
            module: d.module,
            id: d.id,
            reason: reason.value.trim()
          });
          m.close();
          await openConsole('发布与版本');
          note(op === 'publish' ? '已发布' : '已退回');
        },
        buttons,
        op === 'publish' ? 'primary' : 'secondary'
      );
}
