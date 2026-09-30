"""Build the reviewed ecommerce reference library; no model calls or app changes."""
from pathlib import Path
import csv
import html
import json
from expanded_cases import expanded_cases

ROOT = Path(__file__).parent
OUT = ROOT / 'agent-library'
OUT.mkdir(exist_ok=True)
DATE = '2026-09-30'

ROLES = {
 'hero': ('产品凸显', '先认清产品、品类和包装轮廓；主标题只放一个信息重点。', []),
 'benefit': ('优势总览', '将用户已确认的优势压缩为二至三个短信息块。', ['confirmed_benefits']),
 'ingredient': ('成分/香调', '用原料、液滴或分层结构解释配方或香调；素材只表达已确认信息。', ['confirmed_ingredients_or_scent']),
 'mechanism': ('原理解释', '用简化示意解释机制，清楚区分概念示意与实测证据。', ['verified_mechanism']),
 'texture': ('质地/使用感', '用真实质地素材展示流动性、膏体或泡沫；不能从包装外观推断内容物。', ['texture_reference']),
 'shade': ('色号/试色', '用已核验色号与真实试色帮助选择；包装色不能代表上脸或上唇颜色。', ['verified_shades_and_swatch_assets']),
 'makeup': ('妆效展示', '用属于目标产品且有使用授权的妆效素材展示妆面，不凭包装图虚构效果。', ['product_specific_makeup_assets']),
 'pain': ('需求/痛点', '从目标用户的明确使用需求切入，再承接产品优势。', ['target_user_needs']),
 'proof': ('效果/证据', '展示属于目标产品的报告、测试和数据；没有原始证据就删除该屏。', ['product_specific_evidence']),
 'usage': ('使用方法', '将已确认的使用步骤画成连续小图，并保留正确的先后顺序。', ['confirmed_instructions']),
 'structure': ('结构/多角度', '展示真实正背面、开口、泵头或包装结构；需要对应视角与结构资料。', ['matching_multiview_or_structure_assets']),
 'spec': ('规格/标签', '让用户核对规格、容量、版本和真实标签；小字用排版层处理。', ['verified_specs_and_label']),
 'scene': ('使用场景', '把产品放到符合其实际用途的环境中，保持产品形状和比例。', ['confirmed_use_scenario']),
 'selection': ('系列/选型', '用相同尺度比较真实存在的版本或套装，不臆造其他 SKU。', ['real_sku_assets_and_differences']),
 'faq': ('疑问解答', '回答购买前的关键问题；答案来自产品资料。', ['verified_faq']),
 'upgrade': ('版本/升级', '并列展示真实新旧版本，解释可验证的变化。', ['old_new_assets_and_facts']),
 'promo': ('活动/赠品', '原页活动内容，只作为信息密度观察，不进入默认生图。', ['current_offer_terms']),
 'brand': ('品牌/背书', '品牌历史、代言、机构背书不能迁移为新产品事实。', ['authorized_brand_material']),
 'footnote': ('说明/脚注', '保留实证资料的来源、适用条件和必要说明。', ['claim_sources']),
}
STATUS = {'ready':'构图可用', 'conditional':'需产品资料', 'excluded':'仅研究保留'}

def S(assets, role, title, observed, status='conditional', needs=None):
    return dict(source_orders=assets, role=role, title=title, observed=observed,
                eligibility=status, required_inputs=ROLES[role][2] if needs is None else needs)

CASES = [
 dict(id='proya', brand='珀莱雅', name='双抗精华美白特证版 30ml', category='精华', form='细长泵瓶', cover=3,
      sales=None, reviews='累计评价 50万+', rank='美白面部精华热卖榜·第11名', query='珀莱雅 双抗精华', search=None,
      style=['银白科技','金橙成分','留白','轨道曲线'], colors=['#e9e9e8','#d49626','#5c5c56'],
      visual='银白瓶身占主视觉，金橙液滴与弧形轨道承接配方；大标题、短利益点、证据小字分层。',
      fit='适合精华、乳液等细长瓶的高端科技表达；机械结构只能用于真实具有对应结构的产品。',
      sequence='活动插屏 → 产品亮相 → 规格 → 肤况需求 → 效果 → 原理与成分 → 实证 → 质地 → 泵头与用法 → 升级/补充装 → 系列 → FAQ → 脚注',
      main=[
       S([1],'promo','产品与到手权益','银白瓶居中，上方销量宣称，下方价格和赠品条。','excluded'),
       S([2],'promo','会员赠品表','红粉背景、多档会员礼与多件产品网格。','excluded'),
       S([3],'hero','白底单品','银白泵瓶完整正面、白底、充分留白。','ready'),
       S([4],'proof','人物与效果数字','人物持瓶与多项效果数字并置。','excluded'),
       S([5],'mechanism','双通路示意','金色球体和路径文字解释两条作用通路。'),
       S([6],'ingredient','成分组合','三枚金橙球体、飘带与成分名称组成信息组。'),
       S([7],'proof','报告汇总','多份检测报告和功效数字拼合。','excluded')],
      detail=[
       S([1],'promo','其他产品活动横幅','红宝石面霜预售横幅，属于跨商品活动。','excluded'),
       S([2],'promo','会员赠品','红粉色礼赠和门槛表。','excluded'),
       S([3],'hero','产品主视觉','银白瓶身搭配金橙轨道与大标题。','ready'),
       S([4],'spec','产品基础信息','灰白底规格信息表。'),
       S([5],'pain','肤况与环境需求','生活环境图标和多个皮肤局部图。'),
       S([6,7],'proof','效果总览','模特与分时段、多维度效果数字。','excluded'),
       S([8,9],'mechanism','科学通路与验证','金色微观球体过渡到荧光图和柱形图。','excluded'),
       S([10],'ingredient','成分矩阵','金色球体、成分分组和弧线形成配方总览。'),
       S([11,12,13],'proof','分项效果实证','皮肤模型、显微图、实验对照和数据。','excluded'),
       S([14],'proof','温和性报告','多份报告与检测标记。','excluded'),
       S([15],'texture','质地与肤感','琥珀色凝胶近景，旁边有使用感及测试数字。'),
       S([16],'structure','泵头与启用步骤','双腔结构爆炸图及按压、摇匀、涂抹步骤。'),
       S([17],'upgrade','新旧版本比较','两代瓶型并列，五组升级信息。'),
       S([18],'usage','补充装和小样用法','拆装、替换和小瓶使用的连续示意。'),
       S([19],'selection','产品家族','同系列瓶罐在台座上组合。'),
       S([20],'faq','购买前疑问','多个问答信息块。'),
       S([21],'footnote','数据来源说明','密集脚注解释前文宣称。','excluded')]),
 dict(id='pantene',brand='潘婷',name='桃桃洗发水 470g',category='洗发水',form='大泵瓶',cover=8,
      sales='已售60万+',reviews='累计评价 20万+',rank='潘婷洗发水热卖榜第2名',query='洗发水',search='shampoo',
      style=['蜜桃粉','果香场景','水花泡沫','柔和渐变'],colors=['#f4d4d1','#eab4aa','#c5a354'],
      visual='粉色瓶、桃与茶元素组成香氛情境；半透明气泡、水花和金色分子形成柔和但清晰的层级。',
      fit='适合洗发水、沐浴露等大泵瓶和已确认果香配方；人物秀发效果与发丝对照不能靠瓶图推出。',
      sequence='店铺横幅 → 油头干发需求 → 产品 → 香调 → 柔顺效果 → 配方 → 泡沫 → 洗护步骤 → SKU 对比 → 系列 → 品牌 → 脚注',
      main=[
       S([1],'promo','产品与价格赠品','粉瓶与桃、茶，叠加数字卖点和底部权益条。','excluded'),
       S([2],'proof','秀发效果','长发模特突出柔顺发丝。','excluded'),
       S([3],'ingredient','白桃乌龙香调','桃子、气泡与分层香调信息。'),
       S([4],'selection','洗护组合','洗、护、免洗三个真实产品构成步骤组合。'),
       S([5],'ingredient','配方科技','粉色微观球体与金色 PRO-V 胶囊。'),
       S([6],'selection','系列选型','金色多层台架陈列不同瓶型和配方。'),
       S([7],'spec','背标实拍','白底背面标签。'),
       S([8],'hero','果香产品主视觉','粉瓶和桃子配件，容量文字简洁。','ready')],
      detail=[
       S([1],'brand','集团店铺横幅','多品牌店铺入口横幅。','excluded'),
       S([2],'pain','油头干发需求','头皮与发尾的双问题对照。'),
       S([3,4],'hero','产品登场','短标题后接漂浮粉瓶、桃与水流。','ready'),
       S([5,6],'ingredient','香调展开','香调标题、层级说明接桃子与气泡特写。'),
       S([7,8,9],'proof','柔顺效果','效果标题、长发模特和发丝前后对比。','excluded'),
       S([10,11],'ingredient','配方展开','配方标题接微观球体与金色胶囊。'),
       S([12,13],'texture','泡沫使用感','标题接瓶体、水流和大面积泡沫。'),
       S([14],'usage','洗护三步','三种产品按使用顺序排列。'),
       S([15],'selection','五款对照表','发质、成分、香型等列在同一比较表内。'),
       S([16,17],'selection','系列陈列','滋润、轻润、控油系列跨两张台架图。'),
       S([18],'brand','品牌故事','山景与品牌历史信息。','excluded'),
       S([19],'footnote','宣称脚注','密集数据来源说明。','excluded'),
       S([20],'brand','集团页尾','蓝色集团标识页尾。','excluded')]),
 dict(id='fino',brand='FINO 芬浓',name='浓厚红罐发膜 230g',category='发膜',form='广口罐',cover=3,
      sales='已售300万+',reviews='累计评价 200万+',rank='发膜热卖榜第1名',query='发膜',search='hairmask',
      style=['红银对比','奶霜质地','珍珠液滴','发丝曲线'],colors=['#b51230','#e6e1dc','#9c9996'],
      visual='红盖银罐形成识别，奶霜、珍珠和浅色背景托起产品；关键标题红色，成分区域更轻。',
      fit='适合发膜、身体霜、面霜等广口罐；膏体质地和开盖内构需要相应素材，不能从闭合罐图猜测。',
      sequence='跨商品代言 → 系列 → 产品 → 销量宣称 → 红银款对比 → 受损需求 → 修护原理 → 成分 → 效果 → 用法 → 香调 → 新旧包装 → 实拍 → 脚注/品牌',
      main=[
       S([1],'brand','产品与销量背书','红罐、银色环境、销量宣称和人物小图。','excluded'),
       S([2],'selection','洗护家族','三排产品及洗护分类。'),
       S([3],'texture','奶霜托起红罐','罐体居中，奶霜涂抹作为前景，旁有利益点。'),
       S([4],'usage','冲洗和养护方法','真人头发与连续用法提示。'),
       S([5],'ingredient','花果香调','罐体搭配花朵和水果元素。'),
       S([6],'ingredient','珍珠配方视觉','大颗珍珠状液滴与成分标题。'),
       S([7],'mechanism','发丝修护示意','发丝剖面、球体与配方数字。'),
       S([8],'selection','红罐银罐选型','两款并排解释差别。')],
      detail=[
       S([1],'brand','其他产品代言横幅','男性代言和另一洗发产品。','excluded'),
       S([2],'selection','洗护系列','三行不同瓶罐的系列产品。'),
       S([3],'hero','红罐主视觉','红盖银罐配奶霜与利益点。','ready'),
       S([4],'brand','销量宣称','红底销量第一文字；不作为独立热度证据。','excluded'),
       S([5],'selection','红银两款比较','按发质需求并列两种发膜。'),
       S([6,7],'pain','受损发质需求','需求标题接受损发丝近景。'),
       S([8,9],'mechanism','修护原理','效果数字标题接发丝截面和球体图。'),
       S([10,11],'ingredient','核心成分','配方标题接珍珠液滴与配方说明。'),
       S([12,13],'ingredient','复合成分','成分球体跨两张切片延续。'),
       S([14],'proof','发丝效果与数据','顺滑发丝和效果数字。','excluded'),
       S([15,16],'usage','冲洗与深护两种用法','头发使用示范，后续接深度养护方式。'),
       S([17,18],'ingredient','香调与感官','标题接罐体、花果与香调结构。'),
       S([19,20],'upgrade','新旧包装识别','正面变化接背标对照，帮助核对版本。'),
       S([21,22],'spec','包装正背面','正背罐实拍及放大背标。'),
       S([23],'footnote','销量说明来源','红色说明条与脚注。','excluded'),
       S([24],'brand','母公司介绍','公司建筑与标识。','excluded')]),
 dict(id='safeguard',brand='舒肤佳',name='红石榴香氛沐浴露 570g',category='沐浴露',form='大泵瓶',cover=4,
      sales='已售500万+',reviews='累计评价 400万+',rank='沐浴露金榜第3名',query='沐浴露',search='bodywash',
      style=['奶油粉','石榴果实','浴室场景','金色原料'],colors=['#e4c6c4','#f0ece5','#a11e3b'],
      visual='奶油色空间、粉色泵瓶和切开的石榴突出香氛；金色原料球、液滴和浴室台面连接使用感。',
      fit='适合香氛沐浴、洗手液等大泵瓶；跨香型页面很多，必须绑定目标香型，不能混借其他瓶身。',
      sequence='店铺横幅 → 新旧包装 → 产品 → 清洁需求 → 沐浴情境 → 原理 → 原料 → 证据 → 香氛 → 多香型 → 使用感 → 测试 → 系列',
      main=[
       S([1],'promo','代言促销','粉瓶、人物小图与价格条。','excluded'),
       S([2],'promo','多香型活动','不同颜色瓶体与活动信息。','excluded'),
       S([3],'upgrade','新旧包装','两代瓶型并排说明随机发货。'),
       S([4],'hero','红石榴主视觉','粉瓶置于奶油色空间，前景是石榴。','ready'),
       S([5],'mechanism','清洁原理','倾斜瓶与液滴、油污示意。'),
       S([6],'ingredient','果酸/原料表达','石榴和金色球体。'),
       S([7],'scene','浴室香氛','台面瓶体，远处柔焦人物。'),
       S([8],'spec','正背标签','前后包装和标签放大。'),
       S([9],'spec','规格卡','单瓶与 570g 容量信息。')],
      detail=[
       S([1],'brand','集团店铺入口','集团多品牌横幅。','excluded'),
       S([2],'upgrade','版本提示','新旧泵瓶并列。'),
       S([3],'hero','香氛产品首屏','粉色泵瓶与红石榴，奶油色背景。','ready'),
       S([4],'pain','皮肤需求','三组皮肤局部与配方升级标题。'),
       S([5,6],'scene','沐浴与放松','沐浴人物、产品图标，随后是日常放松人物。','excluded'),
       S([7,8],'mechanism','清洁机理','倾斜瓶液滴接皮肤模块对照。'),
       S([9],'ingredient','石榴原料','果实与金色微观球体。'),
       S([10],'proof','抗氧化实验','绿色显微对照和效果信息。','excluded'),
       S([11],'scene','香氛体验','瓶体在台面、远处人物和柔光。'),
       S([12],'proof','香氛测试与奖项','奖项和实验图。','excluded'),
       S([13],'ingredient','本 SKU 香调','红石榴单瓶、果实与前中后调。'),
       S([14,15],'selection','其他香型','山茶、木质玫瑰等不同瓶色和对应素材。'),
       S([16],'texture','泡沫与手持','手持泵瓶、泡沫和使用感图标。'),
       S([17,18],'proof','消费者与报告','人物反馈比例和多份报告放大。','excluded'),
       S([19,20],'selection','系列延展','其他花香产品与对应场景。')]),
 dict(id='cerave',brand='CeraVe 适乐肤',name='润肤乳 473ml',category='身体乳',form='大泵瓶',cover=6,
      sales='已售30万+',reviews='累计评价 20万+',rank='身体乳热卖榜第4名',query='身体乳',search='bodylotion',
      style=['蓝白简洁','功能分区','医学感排版','透明方框'],colors=['#176cb1','#ecf5fa','#ffffff'],
      visual='蓝白基调、矩形容器和清晰编号，产品与短信息分区；图示服务于机制与用法，装饰较少。',
      fit='适合身体乳、基础乳液、无香护理；不能把页面医疗语境和临床宣称迁移到新产品。',
      sequence='产品与优势 → 屏障/成分 → 多场景用法 → FAQ → 正背包装',
      main=[
       S([1],'benefit','蓝白产品与优势','泵瓶位于透明矩形框，旁边利益点与数字。'),
       S([2],'benefit','三项优势','左侧三个图标与文字，右侧产品。'),
       S([3],'upgrade','新旧版本','新旧正背包装并列说明。'),
       S([4],'texture','质地与技术','上部蓝色凝胶、下部微囊技术图。'),
       S([5],'spec','背标核对','背面标签加放大视图。'),
       S([6],'hero','白底泵瓶','纯白背景、完整正面泵瓶。','ready')],
      detail=[
       S([1],'benefit','首屏产品与利益','蓝白乳霜背景、瓶体与盾牌等信息。'),
       S([2,3],'mechanism','屏障与成分体系','皮肤截面、三种神经酰胺及技术卡；第三切片上沿延续前屏。'),
       S([3,4],'usage','不同使用场景','编号场景跨图延续，含身体、面部与叠加用法；原页特殊美容场景不迁移。'),
       S([4,5],'faq','常见疑问','问答从第四切片底部延续至第五。'),
       S([5,6],'spec','真实标签和背面','第五切片下部与第六短切片组成正背包装区。')]),
 dict(id='zhuben',brand='逐本',name='云檀植萃水感净透卸妆油 150ml',category='卸妆油',form='透明泵瓶',cover=2,
      sales='已售100万+',reviews='累计评价 100万+',rank='卸妆金榜第3名',query='卸妆油',search='cleansingoil',
      style=['植物绿','透明油感','木与白花','细线说明'],colors=['#cfe7d5','#719763','#f7faf0'],
      visual='通透绿瓶、浅绿渐变、枯木白花塑造植物感；液膜与绿色小球承担机制解释，后段转为浅底步骤卡。',
      fit='适合卸妆油、精油等透明泵瓶；透明度、油色要以用户产品为准，香调和防漏构造不能借用。',
      sequence='活动/跨品推荐 → 家族选型 → 本品亮相 → 卸妆机理 → 实证 → 配方/屏障 → 温和性 → 使用感 → 黑头示意 → 香调 → 用法 → 选型 → 泵头 → FAQ → 脚注',
      main=[
       S([1],'promo','到手权益','小瓶居中，大面积买赠和价格条。','excluded'),
       S([2],'hero','林间产品','绿瓶斜倚木头与白花，右侧三个利益点。','ready'),
       S([3],'mechanism','三技术概览','皮肤剖面及配方小图三层组合。'),
       S([4],'ingredient','脂质系统','绿色网膜背景，下方四个植物原料块。'),
       S([5],'texture','超水感体验','绿瓶、透明水流、网膜与人物小图。'),
       S([6],'spec','产品信息表','白底规格、成分和说明密集表格。')],
      detail=[
       S([1,2],'promo','便携装与储值活动','小包装促销接会员充值条。','excluded'),
       S([3],'selection','洁颜膏跨品推荐','另一罐装产品与多品矩阵。'),
       S([4,5],'selection','洁颜油家族','四种颜色泵瓶成组，按肤况分型。'),
       S([6],'hero','云檀本品亮相','绿瓶倚木，白花衬托，右侧利益点。','ready'),
       S([7,8,9],'mechanism','三种卸妆技术','破膜、吸色、多极性油脂依次呈现；第九切片底部开始测试。'),
       S([9,10,11,12],'proof','彩妆卸除实测','多个彩妆/防晒示例、局部前后对照及反馈数字。','excluded'),
       S([13,14],'ingredient','脂质与舒缓配方','透明网膜与植物原料卡，接三组成分球体。'),
       S([15,16],'proof','屏障测试','组织图、柱形图、面部局部与效果数字。','excluded'),
       S([16,17],'texture','乳化体验','新段标题后接人物持瓶与乳化粒径说明。'),
       S([18,19],'proof','温和性证据','显微图、图表和多份报告。','excluded'),
       S([20,21],'texture','水感使用感','通透瓶和流动液体，后接透气网膜与人物。'),
       S([21,22,23],'mechanism','黑头与油光','段落标题接毛孔/油脂剖面和实测数据；含不可借用的实验结果。','excluded'),
       S([23,24,25],'ingredient','云檀香调','标题后接瓶、木头、植物，最后是前中后调说明。'),
       S([25,26],'usage','卸妆三步','取油、溶妆、冲洗的线稿步骤。'),
       S([26,27,28],'selection','分肤质选型','四种真实产品分行说明。'),
       S([29,30],'structure','泵头锁扣','取卡、开锁、按压与锁片复位的真实手部演示。'),
       S([30,31],'faq','卸妆疑问','四类常见使用问题跨切片延续。'),
       S([31,32],'footnote','宣称脚注','页尾测试与数据来源。','excluded')]),
 dict(id='anessa',brand='安热沙',name='小金瓶防晒乳 60ml',category='防晒',form='扁平瓶',cover=2,
      sales='已售100万+',reviews='累计评价 50万+',rank='防晒金榜第2名',query='防晒霜',search='sunscreen',
      style=['金蓝对比','强光','膜层科技','户外功能'],colors=['#167fb7','#d9b268','#e1f1fc'],
      visual='金色扁瓶与蓝色纵深背景形成强对比；膜层弧面、乳液飞溅和编号科技章节连接长页。',
      fit='适合扁平瓶、防晒等功能型产品；SPF、PA、防水时长与专利必须使用目标产品的实证资料。',
      sequence='产品 → 升级 → 使用难题 → 肤感/实证 → 三项防护科技 → 防晒等级 → 护肤成分 → 场景 → 用法/FAQ → 包装 → 历史与研发 → 系列',
      main=[
       S([1],'promo','代言与赠品首图','金瓶和人物配蓝天背景，底部多瓶买赠。','excluded'),
       S([2],'benefit','三点升级','大瓶居右，左边三段优势，底部乳液飞溅。'),
       S([3],'texture','肤感与乳液','白色乳液飞溅与四组百分比。'),
       S([4],'mechanism','双技术防护','环形箭头、环境图标与皮肤膜层。'),
       S([5],'proof','防水实验','第三方测试图表与时长、防晒数字。','excluded'),
       S([6],'proof','专利证明','三份专利文件。','excluded'),
       S([7],'mechanism','环境响应','三层皮肤与防晒膜示意箭头。'),
       S([8],'selection','系列购买攻略','八格不同用途的真实产品。'),
       S([9],'spec','真实标签','外包装背标与生产信息。')],
      detail=[
       S([1],'hero','小金瓶亮相','金瓶、蓝色膜层弧面与防晒数字。','ready'),
       S([2],'upgrade','产品升级','新旧金瓶与两项升级卡片。'),
       S([2,3],'pain','防晒与肤感难题','油厚粘局部图，水汗热等环境图标。'),
       S([3,4,5,6],'proof','肤感与比较实证','标题、乳液飞溅、比例图与涂抹对照跨切片。','excluded'),
       S([6,7,8],'mechanism','防晒膜自修复','面部动作后接颗粒、膜层、显微及数据对照。','excluded'),
       S([9,10,11],'mechanism','环境响应与证明','皮肤膜层示意、第三方防水测试与专利文件。','excluded'),
       S([11,12],'mechanism','贴肤耐摩擦','颗粒接触皮肤的左右示意。'),
       S([12],'benefit','防晒等级','蓝底光线、箭头和 SPF/PA 信息。'),
       S([13],'ingredient','护肤成分','三角形大球体与多枚植物小球。'),
       S([14,15],'scene','适用场景','面部近景后接休闲、城市与户外场景，底部套组。'),
       S([16,17],'usage','正确使用','摇匀、护肤顺序与三步涂抹图。'),
       S([17],'faq','使用疑问','新旧款差异及卸除问题的两张卡片。'),
       S([18],'spec','实物包装','盒与瓶的正背面。'),
       S([18,19,20],'brand','产品历史与研发','包装演进时间线、实验室及研发建筑。','excluded'),
       S([20,21],'brand','环境主张','海洋与生态主张。','excluded'),
       S([21],'selection','家族选型表','页尾全系列产品比较。')]),
 dict(id='loreal',brand='欧莱雅',name='玻色因安瓶面膜 3.0 / 5片装',category='面膜',form='分区袋盒',cover=1,
      sales='已售700万+',reviews='累计评价 200万+',rank='面膜热卖榜第6名',query='面膜',search='mask',
      style=['银紫科技','托盘陈列','液滴气泡','编号章节'],colors=['#d3cde3','#f6f5f9','#ad174e'],
      visual='银紫色托盘和双区袋作为识别，紫色液滴表达配方，红色小标签强调关键名称，章节编号清楚。',
      fit='适合面膜袋盒和真实具有双区结构的产品；普通面膜不能借用膜液分离或鲜注结构。',
      sequence='升级速览 → 产品 → 新配方 → 成分实证 → 温和性 → 效果 → 包装结构 → 膜布机制 → 用法 → 场景 → FAQ → 新旧款 → 脚注 → 标签',
      main=[
       S([1],'promo','片数与套装','银色托盘、单袋和多片组合，顶部买赠大字。','excluded'),
       S([2],'ingredient','两组配方','紫色液滴、滴管与两组重点成分。'),
       S([3],'ingredient','三角配方阵','三个紫色球体按三角形分组。'),
       S([4],'spec','背面信息','紫色背标与规格文字。')],
      detail=[
       S([1],'upgrade','升级速览','旧袋与新袋并列，两条升级信息。'),
       S([2],'hero','面膜主视觉','托盘、分区袋、膜布和配方形象；底部含不可迁移的数字。','ready'),
       S([3],'ingredient','重点成分','紫色分子与滴管突出两组配方。'),
       S([4],'ingredient','三重配方及实证','三球分层成分，下方接报告和荧光对照。'),
       S([5],'proof','温和性证据','六个无添加图标、报告及测试数字。','excluded'),
       S([6,7],'proof','分时段效果','面部模型后接多组功效数字。','excluded'),
       S([8],'structure','膜液分离设计','双区袋置于托盘，标出精华区与膜体区。'),
       S([9],'mechanism','膜布机制','唤醒、锁水、服帖、承载力四段示意与对照。'),
       S([10],'usage','四步使用','折、挤、按、敷四格真实操作。'),
       S([11],'scene','不同使用情境','产品放入日常和季节场景的四格图。'),
       S([12],'faq','产品疑问','五条问答以细线框集中呈现。'),
       S([13],'upgrade','版本对比','新旧包装加升级对照表。'),
       S([14],'footnote','宣称来源','集中脚注。','excluded'),
       S([15],'spec','背标与规格','真实背面标签。')]),
]

CASES.extend(expanded_cases(S, ROOT))

def materialize(case):
    evidence_path = 'evidence/' + case['id'] + '-assets.json'
    raw = json.loads((ROOT / evidence_path).read_text())
    assets = []
    for kind in ('hero','detail'):
        for a in raw[kind]:
            assets.append(dict(id=f"{case['id']}-{kind}-{a['order']:02}", kind=kind,
                               source_order=a['order'], path=a['path'], source_url=a['url'],
                               width=a['width'], height=a['height'], visually_reviewed=True,
                               converted_source_url=a['converted_source_url'],
                               source_frame_count=a.get('source_frame_count',1), preview_frame=a.get('preview_frame',0)))
    for kind, key in [('hero','main'),('detail','detail')]:
        for order, screen in enumerate(case[key],1):
            screen['id'] = f"{case['id']}-{key}-screen-{order:02}"
            screen['order'] = order
            screen['source_asset_ids'] = [f"{case['id']}-{kind}-{i:02}" for i in screen['source_orders']]
            screen['content_function'] = ROLES[screen['role']][1]
            screen['role_label'] = ROLES[screen['role']][0]
            screen['analysis_type'] = 'assistant_visual_review_observation_and_adaptation'
            screen['default_auto_select'] = screen['eligibility'] == 'ready'
            screen['reuse_scope'] = 'composition_and_visual_hierarchy_only'
            screen['copy_source_claims'] = False
            screen['drop_unverified_visuals'] = ['ingredient_props','content_texture','unseen_structure','source_brand','claim_badges']
            screen['source_contains_neighbor_section'] = any(set(screen['source_orders']) & set(other['source_orders']) for other in case[key] if other is not screen)
            screen['adaptation'] = ('只保留构图与层级；替换为用户产品，移除来源品牌、数字、人物、奖项、促销及未确认的原料和内容物质地；已确认事实才可重新排入。' if screen['eligibility'] != 'excluded' else '保留用于研究原页顺序，不加入默认生成候选。')
    # Ready means a layout can be used after replacing the entire source identity and copy.
    heat = [dict(metric='reviews',display=case['reviews'],source_url=raw['product_url'],evidence_file=evidence_path,
                 captured_at=DATE,scope='页面累计评价；可能合并同系列规格，非独立 SKU 精确销量')]
    if case['sales']:
        heat += [dict(metric='sold_display',display=case['sales'],source_url='https://search.jd.com/Search?keyword='+case['query'],
                      evidence_file=f"evidence/{case['search']}-search.txt",captured_at=DATE,
                      scope='搜索卡已售；页面未标明统计周期，不等于月销，可能合并 SKU')]
    if case['rank']:
        heat += [dict(metric='ranking',display=case['rank'],source_url=('https://search.jd.com/Search?keyword='+case['query']) if case['search'] else raw['product_url'],
                      evidence_file=f"evidence/{case['search']}-search.txt" if case['search'] else evidence_path,captured_at=DATE,
                      scope='原页面该榜单位置；不同榜单不横向比较')]
    case.update(source_url=raw['product_url'],platform='JD',captured_at=DATE,heat_evidence=heat,
                detail_page_heat=raw['heat'],assets=assets,source_manifest=evidence_path,
                source_scope='当前所选商品页的主图轮播与商品详情模块；不含视频、评价图片或推荐流',
                selection_reason='页面热度证据 + 与包装生图相符的产品形态 + 可拆解的视觉与叙事',
                verification='live_page_and_images_reviewed', observations_complete_for_captured_images=True)
    case['palette_type'] = 'estimated_from_visual_review_not_measured_product_color'
    case['input_compatibility'] = {
        'single_image': '可匹配已见正面与同方向构图；不能补造背标、内部或未见结构。',
        'generated_packaging_image': '可用作外观锚点；生成的标签文字不自动视为产品事实。',
        'same_product_multiview': '核对同一 SKU 与包装版本后，可增加真实正背与结构图。'}
    return case

products = [materialize(c) for c in CASES]
catalog = dict(schema_version='1.0', title='电商主图与详情图参考库', captured_at=DATE,
    status='two_batches_jd_verified_taobao_tmall_pending',
    scope='美妆个护包装类产品；研究资产，不表示生成功能已经接入',
    path_base='catalog.json 的上一级目录，即 research/ecommerce-design-2026-09-30',
    platform_coverage=[
      dict(platform='JD',status='verified',products=len(products),note=f'已进入 {len(products)} 个商品详情，逐图查看并保存本地图片。'),
      dict(platform='Taobao',status='blocked_by_browser_site_safety',products=0,note='淘宝首页被当前浏览器站点安全策略阻止；没有尝试绕过。'),
      dict(platform='Tmall',status='pending_redirect_to_blocked_source',products=0,note='天猫入口可打开，搜索跳转淘宝来源；未继续采集，不能视为已核验天猫商品。')],
    selection_policy=dict(popularity='只采用实查的已售、累计评价和平台榜单；品牌名气与图片内自称第一不作为证据。',
                          fit='瓶、泵瓶、罐、袋盒、软管、喷雾罐和盘状彩妆；同品类形态先筛，再按风格、内容角色与资料条件选择。',
                          causal_limit='观察性样本；没有验证图片带来销量的因果关系，也不代表平台整体。'),
    screen_definition='按语义段落分屏；一个屏可由连续切片组成，一个切片可跨两个屏。主图顺序与商品详情顺序分开记录。',
    generation_rules=['用户产品图是身份锚点，库图仅作构图/风格参考。',
       '主图与详情应使用同一视觉系统；结构匹配优先于热度，热度不进入效果保证。',
       '无资料不得转移源图品牌、功效数字、SPF/PA、认证、价格、赠品、人物和前后对比。',
       '包装生成图内的文字不自动视为真实产品事实。',
       '单视角不生成未经提供的背面与内部结构；多角度必须来自同一产品同一版本。',
       'conditional 仅在 required_inputs 满足后进入候选，excluded 永不进入默认候选。',
       '选择结果必须给出真实 source_asset_ids 与本地路径，并将图片字节传入生图，不能只传文字。'],
    roles={k:dict(label=v[0],purpose=v[1],required_inputs=v[2]) for k,v in ROLES.items()},products=products)
catalog['counts']=dict(products=len(products),hero_images=sum(len(p['main']) for p in products),
    detail_slices=sum(sum(a['kind']=='detail' for a in p['assets']) for p in products),
    semantic_detail_screens=sum(len(p['detail']) for p in products),
    reference_images=sum(len(p['assets']) for p in products),
    layout_ready_screens=sum(s['eligibility']=='ready' for p in products for k in ('main','detail') for s in p[k]))
(OUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2))
with (OUT/'screens.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['商品ID','品牌','品类','图组','语义屏序','内容角色','标题','原始切片序','画面观察','适配状态','必需资料','来源页'])
    for p in products:
        for k in ('main','detail'):
            for s in p[k]:w.writerow([p['id'],p['brand'],p['category'],k,s['order'],s['role_label'],s['title'],','.join(map(str,s['source_orders'])),s['observed'],STATUS[s['eligibility']],','.join(s['required_inputs']),p['source_url']])

candidates=[]
for p in products:
    for k in ('main','detail'):
        for s in p[k]:
            if s['eligibility']=='excluded':continue
            candidates.append(dict(reference_id=s['id'],product_id=p['id'],category=p['category'],form=p['form'],
                group=k,role=s['role'],style_tags=p['style'],eligibility=s['eligibility'],required_inputs=s['required_inputs'],
                default_auto_select=s['default_auto_select'],source_contains_neighbor_section=s['source_contains_neighbor_section'],
                reference_images=[a['path'] for a in p['assets'] if a['id'] in s['source_asset_ids']],
                purpose=s['content_function'],prohibited_transfer=['brand','claims','price','celebrity','test_results']))
(OUT/'candidates.json').write_text(json.dumps(candidates,ensure_ascii=False,indent=2))

# Suggested flows are separate from the observed source order above.
flows = {
 'proya': (['hero','ingredient','texture','structure','spec'], ['hero','pain','ingredient','texture','structure','usage','spec','faq']),
 'pantene': (['hero','ingredient','texture','selection','spec'], ['hero','pain','ingredient','texture','usage','selection','spec']),
 'fino': (['hero','ingredient','texture','usage','spec'], ['hero','pain','ingredient','texture','usage','upgrade','spec']),
 'safeguard': (['hero','ingredient','scene','texture','spec'], ['hero','pain','ingredient','scene','texture','spec']),
 'cerave': (['hero','benefit','texture','usage','spec'], ['hero','benefit','mechanism','texture','usage','spec','faq']),
 'zhuben': (['hero','ingredient','texture','structure','spec'], ['hero','mechanism','ingredient','texture','usage','structure','spec','faq']),
 'anessa': (['hero','benefit','ingredient','scene','spec'], ['hero','benefit','ingredient','texture','scene','usage','spec','faq']),
 'loreal': (['hero','ingredient','structure','usage','spec'], ['hero','ingredient','structure','usage','scene','spec','faq'])
}
recipes = []
for p in products:
    recipe = dict(product_id=p['id'], category=p['category'], form=p['form'],
                  status='inferred_design_recommendation_not_source_order_or_generation_result',
                  counts_are_optional=True, missing_fact_policy='skip_or_replace_with_identity_only_product_view')
    for k, roles in zip(('main','detail'), p.get('recommended_roles') or flows[p['id']]):
        pool = p[k] + p['detail' if k=='main' else 'main']
        recipe[k] = []
        for role in roles:
            ref = next(s for s in pool if s['role']==role and s['eligibility']!='excluded')
            recipe[k].append(dict(slot=len(recipe[k])+1,role=role,purpose=ROLES[role][1],reference_id=ref['id'],
                required_inputs=ref['required_inputs'],source_asset_ids=ref['source_asset_ids'],
                requires_region_review=ref['source_contains_neighbor_section'],
                skip_if_missing=bool(ref['required_inputs']),minimum_safe_output='仅已见产品外观与已确认品名' if role=='hero' else None))
    recipes.append(recipe)
(OUT/'generation-recipes.json').write_text(json.dumps(recipes,ensure_ascii=False,indent=2))

def esc(x):return html.escape(str(x),quote=True)
def shell(title,body,depth=''):
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><link rel="stylesheet" href="'+depth+'library.css"><body><nav><a class="wordmark" href="'+depth+'index.html">青匣 / 电商图参考库</a><a href="'+depth+'调研报告.md">调研说明 ↗</a></nav><main class="wrap">'+body+'</main><footer class="wrap">研究快照 · 2026.09.30 · 图片归原品牌与商家，参考构图与内容组织。热度不代表图片效果已获因果验证。</footer></body></html>'

for p in products:
    assets={a['id']:a for a in p['assets']}
    body=f'<header class="hero"><p class="eyebrow">京东实查 / {esc(p["category"])} / {esc(p["form"])}</p><h1>{esc(p["brand"])}<br><em>{esc(p["name"])}</em></h1><div class="chips">'+''.join(f'<span>{esc(t)}</span>' for t in p['style'])+'</div>'
    body+='<p class="lede">'+esc(p['visual'])+'</p><div class="heat">'+' · '.join(esc(h['display']) for h in p['heat_evidence'])+'</div>'
    body+=f'<p class="minor">{esc(DATE)} 采集。已售无明确周期；评价可能聚合同系列规格。<a href="{esc(p["source_url"])}" target="_blank" rel="noreferrer">打开原商品页 ↗</a></p></header>'
    body+='<section class="overview"><div><h2>适合怎样的产品</h2><p>'+esc(p['fit'])+'</p></div><div><h2>原页内容顺序</h2><p>'+esc(p['sequence'])+'</p></div></section>'
    body+='<div class="note">下面按原页内容分屏，完整保留活动、背书与脚注的位置。绿色表示构图可用；黄色表示还需产品资料；灰色仅供研究。所有来源品牌与宣称都不能自动迁移。</div>'
    body+='<div class="jump"><a href="#main">主图 '+str(len(p['main']))+' 张</a><a href="#detail">详情 '+str(len(p['detail']))+' 个内容屏</a><label>筛选 <select id="status"><option value="all">全部原始内容</option><option value="ready">构图可用</option><option value="conditional">需产品资料</option><option value="excluded">仅研究保留</option></select></label></div>'
    for k,label in [('main','主图顺序'),('detail','详情内容顺序')]:
        body+=f'<section id="{k}"><h2>{label}</h2><p class="minor">'+('按轮播图片顺序。' if k=='main' else '按语义段落编号；原始切片号另列。跨屏切片会在相邻内容屏中重复显示，不能把切片数量当作屏数。')+'</p><div class="screens">'
        for s in p[k]:
            body+=f'<article id="{s["id"]}" class="screen" data-status="{s["eligibility"]}"><div class="screen-copy"><div class="screen-meta"><span>{s["order"]:02} / {esc(s["role_label"])}</span><b class="badge {s["eligibility"]}">{STATUS[s["eligibility"]]}</b></div><h3>{esc(s["title"])}</h3><p>{esc(s["observed"])}</p><p class="purpose">{esc(s["content_function"])}</p><p class="minor">原始'+('主图' if k=='main' else '切片')+' '+', '.join(map(str,s['source_orders']))+'</p>'
            if s['source_contains_neighbor_section']:body+='<p class="minor">此切片跨内容段，实际匹配时需选择对应区域。</p>'
            body+='</div><div class="source-images">'
            for aid in s['source_asset_ids']:
                a=assets[aid];body+=f'<a href="{esc(a["path"])}" target="_blank" title="查看完整原图"><img loading="lazy" src="{esc(a["path"])}" width="{a["width"]}" height="{a["height"]}" alt="{esc(p["brand"]+s["title"])}，原图 {a["source_order"]}"><small>原图 {a["source_order"]:02} · {a["width"]} × {a["height"]}</small></a>'
            body+='</div></article>'
        body+='</div></section>'
    body+='<script>document.getElementById("status").onchange=e=>document.querySelectorAll(".screen").forEach(s=>s.hidden=e.target.value!=="all"&&s.dataset.status!==e.target.value)</script>'
    (ROOT/(p['id']+'.html')).write_text(shell(p['brand']+' · 主图与详情拆解',body))

n=catalog['counts']
body='<header class="hero catalog-hero"><p class="eyebrow">REFERENCE LIBRARY / 02</p><h1>电商主图与详情图参考库</h1><p class="lede">精选适合包装生图的高热度商品，记录视觉风格、主图任务和详情每一屏的展示内容。</p><div class="stats">'
for num,label in [(n['products'],'高热度商品'),(n['hero_images'],'主图'),(n['detail_slices'],'详情切片'),(n['semantic_detail_screens'],'详情内容屏')]:body+=f'<span><b>{num}</b>{label}</span>'
body+=f'</div></header><section class="coverage"><span class="badge ready">京东 · {len(products)} 个实查商品</span><span class="badge conditional">淘宝 · 访问受限，待采集</span><span class="badge conditional">天猫 · 搜索跳转受限来源，待采集</span><p class="minor">两批京东美妆个护样本，不代表三平台已全部覆盖。热度采用页面已售、评价和榜单原文；图片里的“第一”不当作热度证据。</p></section>'
if (ROOT/'第二批扩充清单.md').exists():
    body+='<p class="minor"><a href="第二批扩充清单.md">第二批已入库：新增 12 个案例，查看热度证据与逐屏采集结果 ↗</a></p>'
body+='<section><div class="section-head"><h2>商品与视觉系统</h2><a href="agent-library/catalog.json">结构化数据 ↗</a></div><div class="toolbar"><label>品类 <select id="category"><option value="all">全部品类</option>'+''.join(f'<option>{esc(category)}</option>' for category in dict.fromkeys(p['category'] for p in products))+'</select></label><label>输入 <select id="input"><option value="all">三种输入均可参考</option><option value="single">单张产品图</option><option value="generated">包装设计生成图</option><option value="multi">同款多角度图</option></select></label><label>查找 <input id="search" type="search" placeholder="品牌、瓶型、风格…"></label></div><p id="input-note" class="minor">选择商品，查看完整主图顺序与逐屏拆解。</p><p id="count" class="minor" aria-live="polite">'+str(len(products))+' 个商品</p><div class="brand-grid">'
for p in products:
    cover=next(a for a in p['assets'] if a['id']==f"{p['id']}-hero-{p['cover']:02}")
    body+=f'<a class="brand-card" data-category="{esc(p["category"])}" data-search="{esc(p["brand"]+p["name"]+p["form"]+" ".join(p["style"]))}" href="{p["id"]}.html"><div class="cover"><img loading="lazy" src="{cover["path"]}" alt="{esc(p["brand"])} 原始主图样本"></div><div class="heat-strip">{esc(p["sales"] or p["reviews"])} · {esc(p["rank"] or p["reviews"])}</div><div class="card-copy"><p class="eyebrow">{esc(p["category"])} / {esc(p["form"])}</p><h3>{esc(p["brand"])}</h3><p>{esc(p["name"])}</p><div class="chips">'+''.join(f'<span>{esc(t)}</span>' for t in p['style'][:3])+f'</div><p class="minor">{len(p["main"])} 张主图 · {len(p["detail"])} 个详情内容屏 <span class="arrow">↗</span></p></div></a>'
body+='</div><p id="empty" hidden>没有匹配项，请换一个品类或关键词。</p></section>'
body+='<section><h2>按屏幕任务找参考</h2><p>先决定这一屏要解决什么，再选择视觉表达。点开条目可回到原页顺序。</p><div class="toolbar"><label>内容角色 <select id="role"><option value="all">全部角色</option>'+''.join(f'<option value="{k}">{esc(v[0])}</option>' for k,v in ROLES.items())+'</select></label><label>可用条件 <select id="eligibility"><option value="usable">构图可用与需资料</option><option value="ready">仅构图可用</option><option value="conditional">仅需产品资料</option></select></label><label>图组 <select id="group"><option value="all">主图与详情</option><option value="main">主图</option><option value="detail">详情</option></select></label></div><p id="screen-count" class="minor" aria-live="polite"></p><div id="screen-results" class="screen-grid"></div></section>'
body+='<section><h2>从产品图到成套电商图</h2><div class="flow"><div><b>01 / 识别产品</b><p>上传图片、选包装生成图或同款多角度图，锁定瓶型、标签、颜色与版本。</p></div><div><b>02 / 选择内容</b><p>按已有事实安排屏幕。没有成分、测试或结构资料，就跳过对应屏。</p></div><div><b>03 / 匹配参考</b><p>按品类、形态和资料条件筛选，再用小候选集挑统一的视觉系统。</p></div><div><b>04 / 图片进入生成</b><p>产品图控制身份，参考图控制构图；逐屏生成后检查产品一致性。</p></div></div><p class="minor">以上是第二功能的接入建议；此交付完成参考库，尚未修改现有生图流程。</p><div class="downloads"><a href="调研报告.md">阅读调研报告</a><a href="agent-library/接入说明.md">查看接入说明</a><a href="agent-library/screens.csv" download>下载分屏表 CSV</a><a href="agent-library/candidates.json">读取候选图片索引</a></div></section>'
client=[]
for p in products:
    for k in ('main','detail'):
        for s in p[k]:
            if s['eligibility']=='excluded':continue
            first=next(a for a in p['assets'] if a['id']==s['source_asset_ids'][0])
            client.append(dict(brand=p['brand'],category=p['category'],group=k,role=s['role'],label=s['role_label'],title=s['title'],
                               eligibility=s['eligibility'],status=STATUS[s['eligibility']],image=first['path'],url=p['id']+'.html#'+s['id']))
body+='<script>const screens='+json.dumps(client,ensure_ascii=False).replace('</',r'<\/')+';</script><script src="library.js"></script>'
(ROOT/'index.html').write_text(shell('电商主图与详情图参考库',body))
print(json.dumps(catalog['counts'],ensure_ascii=False))
