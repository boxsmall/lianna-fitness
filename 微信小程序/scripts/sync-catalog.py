"""从同一仓库的网站同步小程序动作数据及器械图。维护时需要 Python 3 和 Pillow。"""
import json
import re
import shutil
from pathlib import Path

from PIL import Image

project = Path(__file__).resolve().parents[1]
root = project / 'miniprogram'
web = project.parent / '网站代码' / 'dist'
source = (web / 'data.js').read_text(encoding='utf-8')
match = re.search(r'^const equipmentCatalog=(.+);$', source, flags=re.MULTILINE)
equipment = json.loads(match.group(1))
moves = json.loads(source.split('const exercises=', 1)[1].strip().removesuffix(';'))
if not moves or len({m['sourceId'] for m in moves}) != len(moves):
    raise ValueError('动作编号重复或数据为空')
for move in moves:
    if not move['steps'] or not re.fullmatch(r'\d{4}', move['sourceId']):
        raise ValueError(move['sourceId'])
    for folder in ('covers', 'animations'):
        media = web / 'moves' / folder / (move['sourceId'] + '.webp')
        if not media.is_file():
            raise FileNotFoundError(media)

assets = root / 'assets'
(assets / 'gear').mkdir(parents=True, exist_ok=True)
(root / 'data').mkdir(exist_ok=True)
for item in equipment.values():
    name = item['img']
    if not re.fullmatch(r'gear/[\w-]+\.(webp|svg|png)', name):
        raise ValueError(name)
    if name.endswith('.webp'):
        item['img'] = name[:-5] + '.jpg'
        with Image.open(web / name) as image:
            white = Image.new('RGB', image.size, 'white')
            rgba = image.convert('RGBA')
            white.paste(rgba, mask=rgba.getchannel('A'))
            white.save(assets / item['img'], quality=82, optimize=True)
    else:
        shutil.copyfile(web / name, assets / name)

equipment_json = json.dumps(equipment, ensure_ascii=False, separators=(',', ':'))
output = source[:match.start(1)] + equipment_json + source[match.end(1):]
output = output.rstrip() + '\nmodule.exports = { parts, equipmentCatalog, gearList, exercises };\n'
(root / 'data/catalog.js').write_text(output, encoding='utf-8')
shutil.copyfile(web / 'brand.svg', assets / 'brand.svg')
print(f'已同步 {len(moves)} 个动作和 {len(equipment)} 项器械')
