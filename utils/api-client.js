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
 * @param {AbortSignal} options.signal - 取消信号（可选）
 * @returns {Promise<Object>} API 响应
 */
export async function callAIApi({ apiUrl, apiKey, body, signal }) {
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  };
  
  // 添加取消信号
  if (signal) {
    fetchOptions.signal = signal;
  }
  
  const response = await fetch(apiUrl, fetchOptions);

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
 * @param {AbortSignal} options.signal - 取消信号（可选）
 * @returns {AsyncIterable<string>} 流式响应内容
 */
export async function* streamAIApi({ apiUrl, apiKey, body, signal }) {
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...body, stream: true })
  };
  
  // 添加取消信号
  if (signal) {
    fetchOptions.signal = signal;
  }
  
  const response = await fetch(apiUrl, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      // 检查取消信号
      if (signal?.aborted) {
        console.log('[API Client] 检测到取消信号，终止流式读取');
        break;
      }
      
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        // 检查取消信号（每行处理前）
        if (signal?.aborted) {
          console.log('[API Client] 处理中检测到取消信号');
          break;
        }
        
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
      
      // 如果已取消，退出外层循环
      if (signal?.aborted) break;
    }
  } catch (error) {
    // 如果是取消导致的错误，静默处理
    if (error.name === 'AbortError' || signal?.aborted) {
      console.log('[API Client] 请求已被取消');
      return;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
