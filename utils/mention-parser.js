/**
 * @提及解析工具
 * 支持 @千问 @kimi @deepseek @所有人
 */

// AI 名称映射（支持多种别名）
const AGENT_ALIASES = {
  // 千问
  '千问': 'qwen',
  'qwen': 'qwen',
  '小千': 'qwen',
  '小Q': 'qwen',
  '阿里云': 'qwen',
  
  // Kimi
  'kimi': 'kimi',
  'Kimi': 'kimi',
  '小K': 'kimi',
  '小k': 'kimi',
  '月之暗面': 'kimi',
  
  // DeepSeek
  'deepseek': 'deepseek',
  'DeepSeek': 'deepseek',
  'deep seek': 'deepseek',
  '小D': 'deepseek',
  '小d': 'deepseek',
  
  // 所有人
  '所有人': 'all',
  'all': 'all',
  '大家': 'all'
};

// AI 信息（包含别名）
export const AGENT_INFO = {
  qwen: { 
    id: 'qwen',
    name: '千问', 
    alias: '小千',
    icon: '🤖',
    color: '#f59e0b'
  },
  kimi: { 
    id: 'kimi',
    name: 'Kimi', 
    alias: '小K',
    icon: '🌙',
    color: '#8b5cf6'
  },
  deepseek: { 
    id: 'deepseek',
    name: 'DeepSeek', 
    alias: '小D',
    icon: '🔍',
    color: '#3b82f6'
  }
};

/**
 * 解析文本中的@提及
 * @param {string} text - 要解析的文本
 * @returns {Object} { mentions: string[], isAll: boolean, cleanText: string }
 * 
 * 示例：
 * parseMentions("@千问 @kimi 这个问题怎么解决？")
 * => { mentions: ['qwen', 'kimi'], isAll: false, cleanText: "这个问题怎么解决？" }
 */
export function parseMentions(text) {
  if (!text || typeof text !== 'string') {
    return { mentions: [], isAll: false, cleanText: '' };
  }
  
  // 匹配 @xxx 格式（支持中文、英文、空格）
  const mentionRegex = /@([\u4e00-\u9fa5a-zA-Z\s]+?)(?=\s|$|@)/g;
  const matches = [];
  let match;
  
  while ((match = mentionRegex.exec(text)) !== null) {
    const mention = match[1].trim();
    const normalized = AGENT_ALIASES[mention];
    if (normalized) {
      matches.push(normalized);
    }
  }
  
  // 检查是否有@所有人
  const isAll = matches.includes('all');
  
  // 去重并保持顺序
  const uniqueMentions = [];
  const seen = new Set();
  for (const m of matches) {
    if (m !== 'all' && !seen.has(m)) {
      seen.add(m);
      uniqueMentions.push(m);
    }
  }
  
  // 移除@提及后的清理文本
  const cleanText = text.replace(mentionRegex, '').trim();
  
  return {
    mentions: isAll ? ['qwen', 'kimi', 'deepseek'] : uniqueMentions,
    isAll,
    cleanText,
    originalMentions: matches
  };
}

/**
 * 检查文本是否包含@提及
 */
export function hasMentions(text) {
  const result = parseMentions(text);
  return result.mentions.length > 0;
}

/**
 * 获取AI的显示名称
 */
export function getAgentDisplayName(agentId) {
  return AGENT_INFO[agentId]?.name || agentId;
}

/**
 * 获取AI的图标
 */
export function getAgentIcon(agentId) {
  return AGENT_INFO[agentId]?.icon || '🤖';
}

/**
 * 格式化@提及列表为可读字符串
 */
export function formatMentions(mentions) {
  if (mentions.length === 0) return '';
  if (mentions.length === 3) return '@所有人';
  
  return mentions.map(m => `@${getAgentDisplayName(m)}`).join(' ');
}

/**
 * 构建带@提示的prompt
 * 用于告诉AI它被谁@了，以及它可以@谁
 */
export function buildMentionPrompt(agentId, mentions, cleanText, previousMessages = []) {
  const agentName = getAgentDisplayName(agentId);
  
  let prompt = '';
  
  // 如果有@，说明是被指定回复
  if (mentions.length > 0) {
    const mentionList = formatMentions(mentions);
    prompt += `【你被${mentionList} 提到】\n\n`;
  }
  
  // 添加上下文
  if (previousMessages.length > 0) {
    prompt += '【对话上下文】\n';
    previousMessages.forEach((msg, idx) => {
      const speaker = msg.agentId === 'user' ? '用户' : getAgentDisplayName(msg.agentId);
      prompt += `${idx + 1}. ${speaker}: ${msg.content}\n`;
    });
    prompt += '\n';
  }
  
  // 添加当前问题
  prompt += `【需要你回复的问题】\n${cleanText}\n\n`;
  
  // 添加@功能说明
  prompt += `【@功能说明】
- 如果你想让其他AI参与讨论，可以在回复中使用 @[AI名字]
- 可用的@对象：@千问、@kimi、@deepseek、@所有人
- 可以同时@多个AI，如"@千问 @deepseek 请补充"
- 如果不@任何人，则本轮讨论结束，等待用户新消息

请作为${agentName}回复，你可以：
1. 直接回答用户的问题
2. 回应其他AI的观点
3. @其他AI让他们参与讨论

请用中文自然回复：`;
  
  return prompt;
}
