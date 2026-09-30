// TypeSafe System One contract: https://docs.typesafe.ai/api
export async function judge(state, questions) {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new Error('服务端未配置 JEV_API_KEY');
  const endpoint = new URL(process.env.JEV_BASE_URL || 'https://api.openlux.ai/v1/systemone');
  // OpenLux rejects this model on the OpenAI chat route.
  if (endpoint.pathname === '/v1/chat/completions') endpoint.pathname = '/v1/systemone';
  const started = Date.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.JEV_MODEL || 'jev-1.13.0', state, questions }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error('JEV 连接失败或超时，请稍后重试');
  }
  // Do not surface provider error bodies, which may echo request data or credentials.
  if (!response.ok) throw new Error(`JEV 请求失败（HTTP ${response.status}），未使用其他模型替代`);
  const result = await response.json();
  for (const [id, question] of Object.entries(questions)) {
    const answer = result.answers?.[id];
    if (answer?.type !== 'choice' || !Object.hasOwn(question.criteria, answer.choice) ||
        !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
      throw new Error('JEV 返回了无效选择，已停止匹配');
    }
    const probabilities = answer.probabilities;
    if (!probabilities || Object.keys(probabilities).length !== Object.keys(question.criteria).length ||
        Object.keys(question.criteria).some(k => !Number.isFinite(probabilities[k]) || probabilities[k] < 0 || probabilities[k] > 1) ||
        Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) > .02) {
      throw new Error('JEV 返回的候选概率不完整，已停止匹配');
    }
  }
  return { model: result.model, answers: result.answers, usage: result.usage, ms: Date.now() - started };
}
