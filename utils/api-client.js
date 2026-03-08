/**
 * 通用 API 客户端工具
 * 用于与国内 AI 服务进行 HTTP API 通信
 */

/**
 * 发送请求到 AI API
 * @param {Object} options - 请求选项
 * @param {string} options.apiUrl - API 地址
 * @param {string} options.apiKey - API 密钥
 * @param {Object} options.body - 请求体
 * @returns {Promise<Object>} API 响应
 */
export async function callAIApi({ apiUrl, apiKey, body }) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * 发送流式请求到 AI API
 * @param {Object} options - 请求选项
 * @param {string} options.apiUrl - API 地址
 * @param {string} options.apiKey - API 密钥
 * @param {Object} options.body - 请求体（需要设置 stream: true）
 * @returns {AsyncIterable<string>} 流式响应内容
 */
export async function* streamAIApi({ apiUrl, apiKey, body }) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...body, stream: true })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data);
          } catch (e) {
            // 忽略解析失败的行
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
