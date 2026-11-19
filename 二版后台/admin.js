'use strict';
const $ = (id) => document.getElementById(id),
  body = $('body');
let token = sessionStorage.getItem('lianna.admin') || '',
  roles = [],
  tab = '',
  timer;
function note(t) {
  $('notice').textContent = t;
  clearTimeout(timer);
  timer = setTimeout(() => ($('notice').textContent = ''), 5000);
}
async function api(route, data = {}) {
  const res = await fetch('/api/' + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify(data)
  });
  const v = await res.json();
  if (!res.ok) {
    if (res.status === 401 && route !== 'admin/login') {
      token = '';
      sessionStorage.removeItem('lianna.admin');
      $('shell').hidden = true;
      $('login').hidden = false;
    }
    throw Error(v.error);
  }
  return v;
}
function el(tag, text, parent, cls) {
  const x = document.createElement(tag);
  if (text != null) x.textContent = text;
  if (cls) x.className = cls;
  if (parent) parent.append(x);
  return x;
}
function button(text, fn, parent) {
  const b = el('button', text, parent);
  b.onclick = async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      note(e.message);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
function inp(parent, label, v = '', type = 'text') {
  const field = el('label', label, parent),
    x = el(type === 'area' ? 'textarea' : 'input', null, field);
  if (type !== 'area') x.type = type;
  x.value = v;
  return x;
}
function select(parent, opts) {
  const s = el('select', null, parent);
  for (const [v, t] of opts) {
    const o = el('option', t, s);
    o.value = v;
  }
  return s;
}
const json = (v) => JSON.stringify(v, null, 2),
  fmt = (v) => JSON.parse(v.value);
const pages = [
  '工作台',
  '动作与器械',
  '训练计划',
  '食材与饮食规则',
  'AI 推荐与用量',
  '用户与反馈'
];
const sections = {
  动作与器械: [['actions', '动作目录']],
  训练计划: [['templates', '周模板']],
  食材与饮食规则: [
    ['foods', '食材'],
    ['nutrition', '营养规则']
  ],
  'AI 推荐与用量': [['ai', '模型与提示词']]
};
const samplePlan = {
  goal: '增肌',
  days: 3,
  minutes: 30,
  start: '2026-11-16',
  gear: ['哑铃']
};
const sampleMeal = {
  profile: {
    sex: '女',
    height: 165,
    weight: 62.5,
    targets: { kcal: 2000, carb: 250, protein: 100, fat: 65 },
    ratios: [30, 40, 30]
  },
  index: 1,
  items: [{ id: '168878', locked: 150 }, { id: '171477' }]
};
let generation = 0,
  focusVersion = null;
async function editModule(title, options = {}) {
  const id = ++generation;
  tab = title;
  $('title').textContent = title;
  body.replaceChildren();
  heading(title, '草稿、审核与版本管理', () => openConsole(title));
  const selectModule = select(body, sections[title]),
    holder = el('div', null, body);
  if (focusVersion && sections[title].some(([m]) => m === focusVersion.module))
    selectModule.value = focusVersion.module;
  if (options.module) selectModule.value = options.module;
  async function moduleView() {
    const module = selectModule.value;
    const meta = await api('admin/modules');
    const s = await api('admin/inspect', { module });
    if (id !== generation) return;
    holder.replaceChildren();
    if (focusVersion?.module === module) {
      const from = focusVersion;
      focusVersion = null;
      if (from.version) {
        const obj = await api('admin/version', {
          module,
          version: from.version
        });
        const old = el('details', null, holder, 'box');
        old.open = true;
        el('summary', '异常发生时的配置 v' + from.version, old);
        el('pre', json(obj), old);
      }
    }
    const top = el('div', null, holder, 'line');
    el('b', '当前版本 v' + s.version, top);
    const drafts = meta.drafts.filter((d) => d.module === module);
    const ds = select(top, [
      ['', '当前发布内容'],
      ...drafts.map((d) => [
        d.id,
        '#' + d.id + ' ' + d.status + ' · ' + d.byname
      ])
    ]);
    const target = el('div', null, holder);
    const paint = async () => {
      const info = await api('admin/inspect', {
        module,
        id: Number(ds.value) || null
      });
      if (id !== generation) return;
      target.replaceChildren();
      const d = info.draft,
        base = d ? d.base : info.version;
      const data = d ? JSON.parse(d.value) : info.active;
      const panel = el('section', null, target, 'box');
      el('h2', ds.selectedOptions[0].textContent, panel);
      let edit;
      const setValue = (value) => {
        edit.value = json(value);
      };
      if (Array.isArray(data)) {
        const filter = inp(panel, '搜索动作、器械、审核状态或食材编号');
        const choices = select(panel, []);
        const obj = inp(panel, '所选条目', '', 'area');
        let current = [...data];
        let source = [];
        if (module === 'actions') {
          source = await api('admin/source');
          const addBox = el('details', null, panel);
          el('summary', '从全部动作中添加或维护', addBox);
          const find = inp(addBox, '搜索名称、肌群、部位或器械'),
            pool = select(addBox, []);
          const filterSource = () => {
            pool.replaceChildren();
            const q = find.value.toLowerCase();
            for (const m of source.filter((m) =>
              JSON.stringify(m).toLowerCase().includes(q)
            )) {
              const option = el(
                'option',
                m.id +
                  ' ' +
                  m.name +
                  ' · ' +
                  m.part +
                  ' · ' +
                  (m.gear.join('、') || '徒手'),
                pool
              );
              option.value = m.id;
            }
          };
          find.oninput = filterSource;
          filterSource();
          button(
            '选择此动作',
            () => {
              const m = source.find((x) => x.id === pool.value);
              if (!m) return;
              let i = current.findIndex((x) => x.id === m.id);
              if (i < 0) {
                current.push({
                  id: m.id,
                  name: m.name,
                  part: m.part,
                  muscle: m.muscle,
                  gear: m.gear,
                  visible: true,
                  enabled: false,
                  approved: false,
                  pattern: '',
                  level: '基础',
                  unit: '次',
                  target: 10,
                  seconds: 3,
                  rest: 45,
                  replacements: []
                });
                i = current.length - 1;
              }
              filter.value = '';
              match();
              choices.value = String(i);
              load();
              setValue(current);
            },
            addBox
          );
        }
        function match() {
          choices.replaceChildren();
          const q = filter.value.toLowerCase();
          current.forEach((v, i) => {
            if (
              !(
                JSON.stringify(v) +
                ' ' +
                JSON.stringify(source.find((m) => m.id === v.id) || {})
              )
                .toLowerCase()
                .includes(q)
            )
              return;
            const o = el('option', v.id + ' ' + v.name, choices);
            o.value = i;
          });
          load();
        }
        const imgs = el('div', null, panel, 'line'),
          form = el('div', null, panel);
        function fields(v) {
          form.replaceChildren();
          if (!v) return;
          const updates = (k, val) => {
            const x = fmt(obj);
            x[k] = val;
            obj.value = json(x);
            current[Number(choices.value)] = x;
            setValue(current);
          };
          const strings =
            module === 'actions'
              ? [
                  ['name', '动作名'],
                  ['pattern', '动作模式'],
                  ['level', '难度'],
                  ['unit', '单位（次或秒）']
                ]
              : [
                  ['name', '食材名'],
                  ['state', '称重状态和做法'],
                  ['source', '来源'],
                  ['sourceVersion', '来源版本']
                ];
          for (const [k, n] of strings) {
            const x = inp(form, n, v[k] || '');
            x.oninput = () => updates(k, x.value);
          }
          const nums =
            module === 'actions'
              ? [
                  ['target', '默认次数或秒数'],
                  ['seconds', '每次预计秒数'],
                  ['rest', '组间休息秒数']
                ]
              : [
                  ['kcal', '每百克千卡'],
                  ['carb', '碳水 g'],
                  ['protein', '蛋白质 g'],
                  ['fat', '脂肪 g']
                ];
          for (const [k, n] of nums) {
            const x = inp(form, n, v[k] ?? '', 'number');
            x.oninput = () => updates(k, Number(x.value));
          }
          const flags =
            module === 'actions'
              ? [
                  ['visible', '用户可浏览'],
                  ['enabled', '允许参与排课'],
                  ['approved', '已完成人工审核']
                ]
              : [['enabled', '允许参与计算']];
          for (const [k, n] of flags) {
            const x = inp(form, n, '', 'checkbox');
            x.checked = k === 'visible' ? v[k] !== false : !!v[k];
            x.onchange = () => updates(k, x.checked);
          }
          if (module === 'foods') {
            for (const [k, n] of [
              ['contains', '包含的过敏原'],
              ['checked', '已核对的过敏原'],
              ['tags', '忌口标签']
            ]) {
              const x = inp(form, n, (v[k] || []).join('、'));
              x.oninput = () =>
                updates(
                  k,
                  x.value
                    .split(/[、，,]/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                );
            }
          }
          if (module === 'actions') {
            const base = source.find((x) => x.id === v.id);
            const x = inp(
              form,
              '所需器械（多个用顿号分隔）',
              (v.gear || base?.gear || []).join('、')
            );
            x.oninput = () =>
              updates(
                'gear',
                x.value
                  .split(/[、，,]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              );
            const refs = Object.entries(s.templates || {})
              .filter(([, m]) => m.includes(v.pattern))
              .map(([k]) => k);
            el('small', '已发布模板引用：' + (refs.join('、') || '无'), form);
          }
        }
        function load() {
          const v = current[Number(choices.value)];
          obj.value = v && choices.options.length ? json(v) : '';
          fields(choices.options.length ? v : null);
          imgs.replaceChildren();
          if (module === 'actions' && v && choices.options.length)
            for (const t of ['original', 'new', 'cover']) {
              const im = el('img', null, imgs);
              im.src = '/media/' + t + '/' + encodeURIComponent(v.id);
              im.alt =
                t === 'original' ? '原版' : t === 'new' ? '重制演示' : '封面';
            }
        }
        filter.oninput = match;
        choices.onchange = load;
        match();
        if (options.item) {
          const index = current.findIndex((v) => v.id === options.item);
          if (index >= 0) {
            choices.value = String(index);
            load();
          } else if (module === 'actions') {
            const details = panel.querySelector('details');
            details.open = true;
            const input = details.querySelector('input');
            input.value = options.item;
            input.oninput();
          }
        }
        button(
          '应用 JSON 条目修改',
          () => {
            const v = fmt(obj);
            current[Number(choices.value)] = v;
            setValue(current);
          },
          panel
        );
      }
      const det = el('details', null, panel);
      det.open = !Array.isArray(data);
      el('summary', '完整配置', det);
      edit = inp(det, 'JSON 配置', json(data), 'area');
      const compare = el('details', null, panel);
      el('summary', '与当前发布内容比较', compare);
      compare.ontoggle = () => {
        if (compare.open) {
          const v = fmt(edit);
          const before = info.active;
          const keys = new Set([...Object.keys(before), ...Object.keys(v)]);
          diff.textContent = json(
            [...keys]
              .filter((k) => JSON.stringify(v[k]) !== JSON.stringify(before[k]))
              .map((k) => ({ field: k, before: before[k], after: v[k] }))
          );
        }
      };
      const diff = el('pre', '', compare);
      const line = el('div', null, panel, 'line');
      const reason = inp(panel, '发布、退回或回退原因');
      if (
        roles.includes('运营') ||
        (module === 'ai' && roles.includes('管理员'))
      )
        button(
          '另存草稿',
          async () => {
            const r = await api('admin/draft', {
              module,
              base,
              value: fmt(edit)
            });
            options.draft = r.id;
            note('已保存 #' + r.id);
            await moduleView();
          },
          line
        );
      if (d?.status === '草稿')
        button(
          '提交审核',
          async () => {
            await api('admin/submit', { module, id: d.id });
            await moduleView();
          },
          line
        );
      if (d?.status === '待审核' && roles.includes('审核'))
        for (const [action, l] of [
          ['publish', '批准发布'],
          ['reject', '退回草稿']
        ])
          button(
            l,
            async () => {
              await api('admin/' + action, {
                module,
                id: d.id,
                reason: reason.value
              });
              await moduleView();
            },
            line
          );
      const history = select(
        panel,
        info.history.map((v) => [v, '历史版本 v' + v])
      );
      button(
        '比较历史内容',
        async () => {
          const v = await api('admin/version', {
            module,
            version: Number(history.value)
          });
          diff.textContent = json(v);
          compare.open = true;
          setTimeout(() => (diff.textContent = json(v)), 0);
        },
        panel
      );
      if (roles.includes('审核'))
        button(
          '确认回退所选版本',
          async () => {
            await api('admin/rollback', {
              module,
              version: Number(history.value),
              base: info.version,
              reason: reason.value
            });
            await moduleView();
          },
          panel
        );
      const trial = el('details', null, target, 'box');
      el('summary', '试排、试算或模型样例', trial);
      const sample = inp(
          trial,
          '输入样例',
          json(
            ['actions', 'templates'].includes(module) ? samplePlan : sampleMeal
          ),
          'area'
        ),
        out = el('pre', '', trial);
      button(
        '运行候选配置',
        async () => {
          out.textContent = json(
            await api('preview/draft', {
              module,
              value: fmt(edit),
              sample: fmt(sample)
            })
          );
        },
        trial
      );
      button(
        '与已发布配置并排比较',
        async () => {
          const input = fmt(sample);
          const current = await api('preview/draft', {
            module,
            value: info.active,
            sample: input
          });
          const draft = await api('preview/draft', {
            module,
            value: fmt(edit),
            sample: input
          });
          out.textContent = json({ 已发布结果: current, 候选结果: draft });
        },
        trial
      );
      if (module === 'ai' && roles.includes('管理员')) {
        const secret = inp(target, '设置或轮换模型密钥', '', 'password');
        button(
          '保存密钥',
          async () => {
            await api('admin/key', { key: secret.value });
            secret.value = '';
            note('密钥已保存');
          },
          target
        );
      }
    };
    ds.value = drafts.some((d) => d.id === options.draft)
      ? String(options.draft)
      : '';
    ds.onchange = () => paint().catch((e) => note(e.message));
    await paint();
  }
  selectModule.onchange = () => moduleView().catch((e) => note(e.message));
  await moduleView();
}
async function enter() {
  const me = await api('admin/me');
  roles = me.roles;
  $('login').hidden = true;
  $('shell').hidden = false;
  $('exit').hidden = false;
  $('who').textContent = me.name + ' · ' + roles.join('、');
  $('avatar').textContent = me.name.slice(0, 1);
  mountConsole();
  await openConsole(routeTitle());
}
$('sign').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const f = new FormData(e.target);
    token = (await api('admin/login', Object.fromEntries(f))).token;
    sessionStorage.setItem('lianna.admin', token);
    e.target.reset();
    await enter();
  } catch (err) {
    note(err.message);
  }
};
$('sign-submit').disabled = false;
$('exit').onclick = async () => {
  await api('admin/logout').catch(() => {});
  sessionStorage.removeItem('lianna.admin');
  location.reload();
};
if (token)
  enter().catch((e) => {
    note(e.message);
  });
