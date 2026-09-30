const $ = id => document.getElementById(id);
const inputNotes = {
  all: '选择商品，查看完整主图顺序与逐屏拆解。',
  single: '单张图：可参考正面产品、场景和信息构图；背面、开盖、泵头内部与内容物质地需要额外素材。',
  generated: '包装生成图：锁定已有包装外观与标签。图内自动生成的成分、功效或认证文字，仍需产品资料确认。',
  multi: '同款多角度图：增加正背、侧面和真实结构屏；需先确认这些图是同一 SKU、同一包装版本。'
};
function filterProducts() {
  const category = $('category').value, query = $('search').value.trim().toLowerCase();
  let count = 0;
  document.querySelectorAll('.brand-card').forEach(card => {
    card.hidden = (category !== 'all' && card.dataset.category !== category) || !card.dataset.search.toLowerCase().includes(query);
    if (!card.hidden) count++;
  });
  $('count').textContent = count + ' 个商品';
  $('empty').hidden = count > 0;
  $('input-note').textContent = inputNotes[$('input').value];
  renderScreens();
}
function renderScreens() {
  const selected = screens.filter(s =>
    ($('category').value === 'all' || s.category === $('category').value) &&
    ($('role').value === 'all' || s.role === $('role').value) &&
    ($('eligibility').value === 'usable' || s.eligibility === $('eligibility').value) &&
    ($('group').value === 'all' || s.group === $('group').value) &&
    ($('input').value === 'all' || $('input').value === 'multi' || s.role !== 'structure'));
  $('screen-count').textContent = selected.length + ' 个参考内容屏';
  $('screen-results').replaceChildren(...selected.map(s => {
    const a = document.createElement('a'); a.className = 'screen-tile'; a.href = s.url;
    const img = document.createElement('img'); img.src = s.image; img.alt = s.brand + ' · ' + s.title; img.loading = 'lazy';
    const text = document.createElement('div');
    const brand = document.createElement('p'); brand.textContent = s.brand + ' / ' + (s.group === 'main' ? '主图' : '详情');
    const title = document.createElement('strong'); title.textContent = s.title;
    const note = document.createElement('p'); note.textContent = s.label + ' · ' + s.status;
    text.append(brand, title, note); a.append(img, text); return a;
  }));
  if (!selected.length) $('screen-count').textContent = '没有匹配内容屏，请调整角色、品类或资料条件。';
}
['category','input','search'].forEach(id => $(id).addEventListener('input', filterProducts));
['role','eligibility','group'].forEach(id => $(id).addEventListener('change', renderScreens));
$('role').value = 'hero';
filterProducts();
