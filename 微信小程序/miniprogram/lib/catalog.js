const {
  parts,
  gearList,
  equipmentCatalog,
  exercises
} = require('../data/catalog');
const mediaOrigin = 'https://lianna.yijiandot.com.cn';
const training = exercises.filter((move) => !move.warmup);
const warmups = exercises.filter((move) => move.warmup);
const groups = [
  '自由重量与负重',
  '架、凳与训练站',
  '上肢力量',
  '下肢力量',
  '躯干与核心',
  '有氧器械',
  '功能训练与配件',
  '绳索把手与配件',
  '其他训练方式'
];
const byId = new Map();
for (const move of exercises) {
  byId.set(move.id, move);
  byId.set(move.sourceId, move);
}

function requirements(move) {
  return move.gear.length ? move.gear : ['徒手'];
}

function options(move, name) {
  const alternatives = move.alternatives && move.alternatives[name];
  return [name].concat(alternatives || []);
}

function gearMatches(move, active) {
  return (
    !active.size ||
    requirements(move).every((name) =>
      options(move, name).some((option) => active.has(option))
    )
  );
}

function partMatches(move, selected) {
  return !move.hidden && (!selected.length || selected.includes(move.part));
}

function availableGear(selected, category) {
  const allowed = new Set();
  for (const move of training) {
    if (!partMatches(move, selected)) continue;
    if (category !== '全部' && category !== '热身' && category !== move.muscle)
      continue;
    for (const name of requirements(move)) {
      for (const option of options(move, name)) allowed.add(option);
    }
  }
  return allowed;
}

const bundledCovers = new Set([
  '0274',
  '0292',
  '0293',
  '0334',
  '0662',
  '0668',
  '1167',
  '1368',
  '1459',
  '1760'
]);

function media(move, folder) {
  if (move.localMedia?.[folder]) return move.localMedia[folder];
  if (
    folder === 'covers' &&
    !move.mediaRevision &&
    bundledCovers.has(move.sourceId)
  ) {
    return '/assets/' + move.sourceId + '.webp';
  }
  const suffix = move.mediaRevision
    ? '?v=' + encodeURIComponent(move.mediaRevision)
    : '';
  return (
    mediaOrigin + '/moves/' + folder + '/' + move.sourceId + '.webp' + suffix
  );
}

function gearLabel(move, active) {
  return requirements(move)
    .map(
      (name) => options(move, name).find((option) => active.has(option)) || name
    )
    .join(' · ');
}

function listItem(move, active, favorites) {
  return {
    id: move.id,
    name: move.name + (move.hidden ? '（已下架）' : ''),
    gear: gearLabel(move, active),
    cover: media(move, 'covers'),
    favorite: favorites.has(move.id),
    favoriteHint:
      move.warmup && move.warmPart !== move.part ? '收藏归入' + move.part : ''
  };
}

function section(name, moves, limit, active, favorites) {
  return {
    name,
    count: moves.length,
    more: Math.min(24, Math.max(0, moves.length - limit)),
    rows: moves.slice(0, limit).map((move) => listItem(move, active, favorites))
  };
}

function pickView(filters, saved, limits) {
  const selected = filters.parts;
  const active = new Set(saved.active);
  const favorites = new Set(saved.favorites);
  const gearResult = training.filter(
    (move) => !move.hidden && (gearMatches(move, active) || (filters.includeBodyweight && !move.gear.length))
  );
  const query = (filters.query || '').trim().toLowerCase();
  const named = (move) => (!filters.favoritesOnly || favorites.has(move.id)) && [move.name,move.part,move.muscle].join(' ').toLowerCase().includes(query);
  const matches = gearResult.filter(
    (move) => named(move) && partMatches(move, selected)
  );
  const warm = warmups.filter(
    (move) =>
      named(move) &&
      !move.hidden &&
      (partMatches(move, selected) || selected.includes(move.warmPart))
  );
  const combined = matches.concat(warm);
  const categories = ['全部'].concat(
    warm.length ? ['热身'] : [],
    Array.from(new Set(combined.map((move) => move.muscle)))
  );
  const category = categories.includes(filters.category)
    ? filters.category
    : '全部';
  const byGroup = new Map();
  if (category === '全部') {
    for (const move of matches) {
      if (!byGroup.has(move.muscle)) byGroup.set(move.muscle, []);
      byGroup.get(move.muscle).push(move);
    }
    if (warm.length) byGroup.set('热身', warm);
  } else {
    byGroup.set(
      category,
      category === '热身'
        ? warm
        : combined.filter((move) => move.muscle === category)
    );
  }
  const enabled = new Set(gearResult.map((move) => move.part));
  const warmParts = new Set();
  for (const move of warmups) {
    warmParts.add(move.part);
    warmParts.add(move.warmPart);
  }
  const sections = [];
  const initial = category === '全部' ? 6 : 24;
  byGroup.forEach((moves, name) => {
    sections.push(
      section(name, moves, limits[name] || initial, active, favorites)
    );
  });
  return {
    parts: parts.map((name) => ({
      name,
      selected: selected.includes(name),
      disabled:
        !selected.includes(name) &&
        !(category === '热身' ? warmParts.has(name) : enabled.has(name))
    })),
    query,
    hasParts: !!selected.length,
    categories,
    category,
    sections,
    total: sections.reduce((sum, group) => sum + group.count, 0),
    noTraining: category === '全部' && !matches.length,
    activeLabel: saved.active.join(' · ') || '不限器械',
    canReset: Boolean(selected.length || active.size || category !== '全部')
  };
}

module.exports = {
  exercises, training, warmups,
  parts,
  gearList,
  equipmentCatalog,
  exercises,
  groups,
  byId,
  media,
  gearLabel,
  availableGear,
  section,
  pickView
};
