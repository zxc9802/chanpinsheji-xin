// 商品描述使用中性措辞；明确要求印在图上的文字和商品名称保持原样。
export const PRODUCT_EXPRESSION_RULES = '围绕真实商品自由选择购买理由、构图、配色、场景和人物姿态。按商品需要保留版型展示、自然身体线条、局部细节、穿着效果及原有风格。只调整与商品表达无关、容易引起歧义的措辞，不改变产品事实、指定文案或视觉方案。';

const NEUTRAL_WORDING = [
  [/性感露肤/g, '露肤剪裁'],
  [/性冷淡/g, '极简'],
];
const neutral = (s) => NEUTRAL_WORDING.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), s);

export function prepareImagePrompt(prompt, literalText = []) {
  const literals = [...new Set(literalText.filter((s) => typeof s === 'string' && s))].sort((a, b) => b.length - a.length);
  const pattern = literals.length ? new RegExp(`(${literals.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g') : null;
  const text = pattern ? prompt.split(pattern).map((part, i) => i % 2 ? part : neutral(part)).join('') : neutral(prompt);
  return `${text}\n\n【商品表达】${PRODUCT_EXPRESSION_RULES}`;
}
