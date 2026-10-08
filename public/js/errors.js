// 前后端共用：模型原始错误和旧项目记录都转换成用户可读的中文。
const MODEL_ERRORS = {
  content_policy_violation: '生成请求未通过内容审核，请调整描述或参考图片后重试',
  generation_timeout: '生成超时，请稍后重试',
  image_too_large: '参考图片尺寸过大，请缩小图片后重试',
  image_too_small: '参考图片尺寸过小，请换用清晰度更高的图片',
  image_load_error: '无法读取参考图片，请重新上传后重试',
  invalid_image_format: '图片格式不符合要求，请换用有效的图片后重试',
  no_media_generated: '模型没有生成图片，请调整描述后重试',
  face_detection_error: '未识别到清晰的人脸，请检查参考图片后重试',
  downstream_service_error: '模型服务暂时异常，请稍后重试',
  downstream_service_unavailable: '模型服务暂时不可用，请稍后重试',
  internal_server_error: '服务暂时异常，请稍后重试',
};

export function errorMessage(error, fallback = '操作失败，请稍后重试') {
  const detail = Array.isArray(error?.detail) ? error.detail[0] : error?.detail;
  const message = String(typeof error === 'string' ? error : error?.message || detail?.msg || error?.error?.message || '');
  const type = error?.errorType || error?.type || detail?.type || error?.error?.type;
  for (const [code, text] of Object.entries(MODEL_ERRORS)) {
    if (type === code || message.includes(code)) return text;
  }
  if (/content checker|content policy|moderation|safety system/i.test(message)) return MODEL_ERRORS.content_policy_violation;
  if (/bad gateway|service unavailable|internal server error|overloaded/i.test(message)) return '服务暂时异常，请稍后重试';
  if (/insufficient.*(?:credit|quota|balance)|quota.*exceeded|payment required|credit.*exhausted/i.test(message)) return '服务额度不足，请补充额度后重试';
  if (/timed?\s*out|timeout/i.test(message) || error?.name === 'TimeoutError') return '连接或生成超时，请稍后重试';
  if (/failed to fetch|fetch failed|load failed|network|ENOTFOUND|ECONN|EAI_AGAIN|socket/i.test(message)) return '连接服务失败，请检查网络后重试';
  if (error?.name === 'AbortError' || /operation was aborted/i.test(message)) return '请求已中断，请重试';
  if (/ENOENT|no such file/i.test(message)) return '所需文件不存在或已被移除，请重新上传后重试';
  if (/ENOSPC|disk.*full/i.test(message)) return '服务器存储空间不足，请联系管理员处理';
  if (/EACCES|EPERM|permission denied/i.test(message)) return '无法访问所需文件，请联系管理员检查权限';
  if (/central directory|invalid pdf|invalid zip|corrupt.*(?:file|document|archive)/i.test(message)) return '文档内容损坏或格式不正确，请检查文件后重新上传';
  if (/unexpected.*(?:token|end)|not valid JSON|JSON.*(?:parse|syntax)/i.test(message)) return '服务返回的内容格式异常，请重试';

  const status = error?.statusCode || error?.status || Number(message.match(/[（(](\d{3})[）)]/)?.[1]);
  const statusText = status === 401 || status === 403 ? '服务认证失败或权限不足，请检查配置后重试'
    : status === 402 ? '服务额度不足，请补充额度后重试'
    : status === 429 ? '请求过于频繁，请稍后重试'
    : status === 408 || status === 504 ? '连接或生成超时，请稍后重试'
    : status >= 500 ? '服务暂时异常，请稍后重试'
    : status === 400 || status === 422 ? '请求参数不符合要求，请检查后重试' : fallback;
  const text = message.replace(/FAL_KEY/g, '图片模型密钥').replace(/LLM_API_KEY/g, '文案模型密钥')
    .replace(/CLAUDE_PLAN_KEY/g, '规划模型密钥').replace(/JEV_API_KEY/g, '参考匹配密钥').replace(/\bJEV\b/g, '参考匹配服务');
  if (/[\u4e00-\u9fff]/.test(text) && /^(?:[\u4e00-\u9fff]|AI\b|PNG\b|PDF\b|AVIF\b)/.test(text)) {
    const raw = text.match(/[：:]\s*(?:[\[{]|[A-Za-z])/);
    return raw ? `${text.slice(0, raw.index)}：${statusText}` : text;
  }
  return statusText;
}

// 输出项目副本，历史错误转换不改写用户保存的项目和版本。
export function localizeErrors(value) {
  if (Array.isArray(value)) return value.map(localizeErrors);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'error' && typeof item === 'string' && item ? errorMessage(item) : localizeErrors(item)]));
}
