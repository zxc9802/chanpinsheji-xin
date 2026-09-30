# 电商图参考库

直接打开 [index.html](index.html)。页面使用本地图片和脚本，可离线浏览。

- 已核验：京东 20 个高热度美妆个护商品。
- 资产：154 张主图、387 张详情切片、335 个详情内容屏（共 541 张图片、489 条分屏记录）。
- 淘宝/天猫：访问受限，尚待补充；当前不是三平台完整覆盖库。
- 内容：逐屏拆解、热度证据、结构化 JSON、候选图片、CSV 和生成编排建议。

详见 [调研报告](调研报告.md) 与 [接入说明](agent-library/接入说明.md)。

重建页面与 JSON：`python3 build_library.py`。
校验图片和数据：使用带 Pillow 的 Python 执行 `validate_library.py`。
采集脚本仅用于研究资产整理，不会调用模型或修改现有应用。

图片校验见 `validation.json`，浏览交互验收见 `evidence/browser-checks.json`。
