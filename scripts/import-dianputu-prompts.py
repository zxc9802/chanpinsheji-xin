"""Extract main/detail prompts from a pinned dianputu checkout; Python is not used at runtime.

Usage: python3 scripts/import-dianputu-prompts.py /path/to/dianputu
"""
import ast
import json
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
expected = '42e2de6502ab9bbe40c806237f96735019318239'
if revision != expected:
    raise SystemExit(f'Expected source revision {expected}, got {revision}')
sys.path.insert(0, str(source / 'backend'))
from app import demo_data as data
from app.services import prompt_builder as p

# Replace only runtime product/style values. Module rules remain source text.
fields = ['core_selling_points', 'functions', 'target_users', 'usage_method', 'material_highlights']
info = {key: ['{{' + key + '}}'] for key in fields}
info.update({key: '{{' + key + '}}' for key in ['product_name', 'category', 'spec']})
info['ingredients'] = [{'name': '{{ingredient_%s_name}}' % i, 'benefit': '{{ingredient_%s_benefit}}' % i} for i in range(1, 4)]
info['detail_layout_brief'] = {'selected_auxiliary_effect': '{{auxiliary}}', 'competitor_comparison': '{{comparison}}'}
p._numbered_lines = lambda items, fallback: '\n'.join(items) if items else fallback
p._layout_brief_lines = lambda info: ['{{layout_brief}}']
p._current_screen_brief_lines = lambda info, module_id: ['{{screen_brief}}']
for name, token in {
    '_format_authority_assets': 'authority', '_format_effect_claims': 'effects',
    '_format_ingredients': 'ingredients', '_format_ingredient_items': 'ingredients',
    '_format_brand_assets': 'brand', '_format_product_intro_items': 'product_intro',
    '_format_product_detail_items': 'product_details',
}.items():
    setattr(p, name, lambda *args, token=token: '{{' + token + '}}')
p._evidence_ingredient_brief = lambda info, index: '{{ingredient_%s}}' % (index + 1)

style = {'id': 'style_reference', 'name': '{{style_name}}', 'primary_color': '{{style_color}}',
         'keywords': ['{{style_keywords}}'], 'visual_direction': '{{style_visual}}', 'layout_guidance': '{{style_layout}}'}

def prompt(module, reference=True, targeted=True):
    return p.build_module_image_prompt(
        product_info=info, style=style, module=module,
        module_index='{{screen_index}}', total_modules='{{screen_count}}',
        has_product_reference=True, has_style_reference=reference,
        has_targeted_style_reference=targeted, prompt_branch='current')

def style_section(value):
    start = value.index('\n【统一视觉风格】\n') + 1
    end = value.index('【视觉减法补充规则】')
    return value[start:end].strip()

hero = data.STANDARD_DETAIL_MODULES[0]
styles = {name: style_section(prompt(hero, ref, targeted)) for name, ref, targeted in [
    ('targeted', True, True), ('global', True, False), ('none', False, False)]}
product_info_module = next(m for m in data.STANDARD_DETAIL_MODULES if m['id'] == 'product_info')
info_styles = {name: style_section(prompt(product_info_module, ref, targeted)) for name, ref, targeted in [
    ('targeted', True, True), ('global', True, False), ('none', False, False)]}

# These are deliberate factual-boundary adaptations, not visual rewrites.
replacements = {
    '真实数据放大数字；无真实数据用具体示意百分比数字，不冒充测试。': '真实数据放大数字；无真实数据用体验型表达，不生成示意百分比数字。',
    '效果数据指标区必须显示百分比数字，字号和进度条视觉权重接近，不需要超大；不要只画无数字进度条/圆环/仪表盘。': '效果数据指标区只显示资料中已有的数据；没有数据时改用简短体验标签，不画暗示测量结果的图表。',
    '优先使用已有百分比数据；没有具体数值时必须使用具体示意百分比数字；禁止写 XX%、X%、--%、占位、待补充。': '只使用资料中已有百分比数据；没有具体数值时省略数字；禁止写 XX%、X%、--%、占位、待补充。',
    '画面必须是产品大图 + 功效 + 质地 + 0添加，不讲品牌门店、研发报告、竞品或使用步骤。': '画面必须是产品大图 + 功效 + 质地；0添加仅在资料明确支持时出现，不讲品牌门店、研发报告、竞品或使用步骤。',
    '产品瓶身作为最大主视觉，旁边用质地液体和 0 酒精、0 色素、0 添加图标承接卖点。': '产品瓶身作为最大主视觉，旁边用质地液体承接卖点；0酒精、0色素、0添加图标只取自资料。',
    '核心结构是产品大图 + 功效 + 质地 + 0添加。': '核心结构是产品大图 + 功效 + 质地；0添加只取自资料。',
}
modules = {}
for module in [*data.STANDARD_DETAIL_MODULES, *data.EVIDENCE_CHAIN_DETAIL_MODULES]:
    value = prompt(module)
    value = value.replace(style_section(value), '{{style_section}}')
    value = value.replace(p._style_reference_low_density_rules(style, True), '{{reference_density}}')
    for old, new in replacements.items():
        value = value.replace(old, new)
    if '{{screen_brief}}' not in value:
        value = value.replace('【当前模块内容要求】', '{{layout_brief}}\n{{screen_brief}}\n\n【当前模块内容要求】')
    modules[module['id']] = {**module, 'prompt': value.splitlines()}

tree = ast.parse((source / 'backend/app/routers/projects.py').read_text())
guide = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_detail_layout_analysis_guide')
namespace = {'DEFAULT_DETAIL_LAYOUT_ID': data.DEFAULT_DETAIL_LAYOUT_ID}
exec(compile(ast.Module(body=[guide], type_ignores=[]), '<source guide>', 'exec'), namespace)
layouts = []
for layout in data.DETAIL_LAYOUTS:
    value = namespace['_detail_layout_analysis_guide'](layout['id'])
    value = value.replace('要基于产品主图和已识别信息做谨慎 AI 补全，不能留空', '保留全部屏幕，以已知信息做示意表达；缺失证据写入 missing_evidence，不补造产品事实')
    layouts.append({**{k: v for k, v in layout.items() if k != 'modules'},
                    'modules': [m['id'] for m in layout['modules']], 'analysisGuide': value})

output = Path(__file__).resolve().parents[1] / 'lib/dianputu-detail-prompts.json'
output.write_text(json.dumps({
    'source': {'repository': 'https://github.com/zxc9802/dianputu', 'revision': revision,
               'branch': 'current', 'adaptations': replacements},
    'layouts': layouts, 'styles': styles, 'productInfoStyles': info_styles,
    'referenceDensity': p._style_reference_low_density_rules(style, True), 'modules': modules,
}, ensure_ascii=False, indent=2) + '\n')
print(f'Extracted {len(modules)} module prompts to {output}')

def main_style_section(value):
    start = value.index('【统一视觉风格】')
    end = value.index('【主图/活动图元素预算约束】')
    return value[start:end].strip()

main_hero = data.MAIN_MODULES[1]
main_styles = {name: main_style_section(prompt(main_hero, ref, targeted)) for name, ref, targeted in [
    ('targeted', True, True), ('global', True, False), ('none', False, False)]}
main_replacements = {
    **{old: new for old, new in replacements.items() if '百分比' in old},
    '必须参考以下成分信息，选择 2-3 个重点成分呈现：': '只参考以下已确认成分信息，最多选择 2 个重点成分呈现：',
    '最多展示 2-3 个核心成分，每个成分只写一句作用短标签。': '最多展示 2 个已确认核心成分，每个成分只写一句已确认作用短标签。',
    '优先参考以下效果数据；如果数据不完整，画面用体验型视觉和进度条表达：': '只参考以下真实效果数据；没有数据时用资料支持的体验型视觉与短标签，不画暗示测量结果的进度条：',
}
main_modules = {}
for module in data.MAIN_MODULES:
    value = prompt(module)
    if module['id'] != 'main_white_bg':
        value = value.replace(main_style_section(value), '{{style_section}}')
    for old, new in main_replacements.items():
        value = value.replace(old, new)
    main_modules[module['id']] = {**module, 'prompt': value.splitlines()}

main_output = output.with_name('dianputu-main-prompts.json')
main_output.write_text(json.dumps({
    'source': {'repository': 'https://github.com/zxc9802/dianputu', 'revision': revision,
               'branch': 'current', 'adaptations': main_replacements},
    'layout': {'id': 'main_standard_5', 'name': '标准主图结构',
               'modules': [m['id'] for m in data.MAIN_MODULES]},
    'styles': main_styles, 'modules': main_modules,
}, ensure_ascii=False, indent=2) + '\n')
print(f'Extracted {len(main_modules)} module prompts to {main_output}')
