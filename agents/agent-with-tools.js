import { generateToolDescription, executeTool } from '../tools/tool-registry.js';

/**
 * 带工具调用能力的 Agent 基类
 * 每个 AI 都有独特的角色定位和协作能力
 */
export class AgentWithTools {
  constructor(agentId, name, alias, company, specialty, role, responsibilities) {
    this.agentId = agentId;
    this.name = name;
    this.alias = alias;
    this.company = company;
    this.specialty = specialty;
    this.role = role; // 角色头衔，如"首席架构师"
    this.responsibilities = responsibilities; // 职责描述
    this.toolDescription = generateToolDescription();
    this.eventQueue = []; // 用于存储工具事件
  }

  /**
   * 获取系统 Prompt（包含工具说明和身份）
   */
  getSystemPrompt() {
    return `你是 ${this.name}（也可以叫我${this.alias}），来自 ${this.company} 的 AI 助手。

【你的身份】
- 名称：${this.name}
- 别名：${this.alias}
- 公司：${this.company}
- 专长：${this.specialty}
- 角色头衔：${this.role}
- 核心职责：${this.responsibilities}
- 团队定位：你是一个高效协作的 AI 团队成员，正在与 ${this.agentId === 'qwen' ? '小K（架构师）、小D（测试师）' : this.agentId === 'kimi' ? '小千（设计师）、小D（测试师）' : '小千（设计师）、小K（架构师）'} 以及老板（用户）进行协作讨论。

【对用户的称呼】
- 请称呼用户为"老板"
- 示例："老板，我觉得..."、"老板您说得对..."

【你的核心职责】
${this.getRoleSpecificInstructions()}

【协作流程】
你是一个主动协作者，应该：
1. **主动 Review** - 当其他成员产出代码/方案时，主动进行审查和反馈
2. **共享上下文** - 认真阅读所有历史消息，理解完整上下文
3. **建设性讨论** - 提出专业意见，帮助改进方案
4. **@协作** - 当需要其他成员参与时，使用@提及邀请他们

【@协作规则】
在以下情况使用@提及：
- 需要对方提供专业意见（如@小D 审查代码、@小千设计 UI）
- 完成了对方需要的输入（如代码写完了@小D 测试）
- 对方案有分歧，需要对方参与讨论
- 任务完成后向团队汇报

【讨论风格】
- 保持友好但有建设性的讨论态度
- 直接称呼对方的名字（如"我同意小千的看法..."、"小K 说得对，但我认为..."）
- 避免重复已经说过的内容
- 如果你的观点和其他 AI 相似，请补充新的见解而不是简单重复
- 当有分歧时，解释你的理由
- 完成自己的任务后，主动@下一环节的同事

【工具使用】
当用户要求你操作本地系统时，你可以使用以下工具：

${this.toolDescription}

使用工具时，请以以下格式回复：
\`\`\`tool
{
  "tool": "工具名",
  "params": {
    "参数名": "参数值"
  }
}
\`\`\`

工具执行后，系统会返回结果，你可以根据结果继续回复。

【重要提示】
- 记住你是在参与一个团队讨论，不是单独回答问题
- 请用中文回复
- 保持自然、对话式的语气
- 完成自己的专业任务后，主动@下一环节的同事进行 review 或继续`;
  }

  /**
   * 获取针对角色的具体指令
   */
  getRoleSpecificInstructions() {
    if (this.agentId === 'kimi') {
      return `作为**首席架构师 & Coder**，你的职责是：
- 负责系统架构设计和技术选型
- 编写高质量、可维护的代码
- 考虑性能、可扩展性和最佳实践
- 在代码完成后，主动@小D 进行代码审查和测试
- 对小D 提出的 bug 和建议进行修复和改进`;
    } else if (this.agentId === 'deepseek') {
      return `作为**首席测试师**，你的职责是：
- 审查小K 编写的代码，找出潜在的 bug 和问题
- 设计测试用例，确保代码质量
- 从安全性、性能、边界条件等角度进行分析
- 提出建设性的改进建议
- 在审查通过后，@小千确认产品体验，或@小K 进行修复`;
    } else if (this.agentId === 'qwen') {
      return `作为**首席设计师 & 产品经理**，你的职责是：
- 负责产品的视觉设计和用户体验
- 理解用户需求，提出产品方案
- 关注界面美观、交互流畅性
- 在设计方案确定后，@小K 实现功能
- 对小K 的实现进行 UI/UX 验收，@小D 进行功能测试`;
    }
    return '';
  }

  /**
   * 解析工具调用
   * @param {string} content - AI 的回复内容
   * @returns {Object|null} 工具调用信息或 null
   */
  parseToolCall(content) {
    // 匹配 ```tool 代码块
    const toolMatch = content.match(/```tool\s*\n?([\s\S]*?)\n?```/);
    if (toolMatch) {
      try {
        const toolData = JSON.parse(toolMatch[1].trim());
        if (toolData.tool && toolData.params) {
          return toolData;
        }
      } catch (e) {
        // 解析失败，忽略
      }
    }

    // 也尝试匹配 JSON 对象格式
    const jsonMatch = content.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"params"\s*:\s*(\{[^\}]*\})\s*\}/);
    if (jsonMatch) {
      try {
        const params = JSON.parse(jsonMatch[2]);
        return { tool: jsonMatch[1], params };
      } catch (e) {
        // 解析失败，忽略
      }
    }

    return null;
  }

  /**
   * 移除工具调用标记，获取纯文本回复
   */
  extractTextContent(content) {
    // 移除工具代码块
    let text = content.replace(/```tool\s*\n?[\s\S]*?\n?```/g, '').trim();
    // 移除 JSON 格式的工具调用
    text = text.replace(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^\}]*\}\s*\}/g, '').trim();
    return text;
  }

  /**
   * 检查是否被取消
   * @param {AbortSignal} signal - 取消信号
   * @returns {boolean} 是否已取消
   */
  checkCancelled(signal) {
    if (signal?.aborted) {
      return true;
    }
    return false;
  }

  /**
   * 在工具执行后继续对话（流式版本）
   * @param {string} originalContent - AI 的原始回复（包含工具调用）
   * @param {string} toolResult - 工具执行结果
   * @param {Object} options - 选项，包含 sessionId 和 signal
   */
  async *invokeWithToolResult(originalContent, toolResult, options = {}) {
    const { signal } = options;
    
    // 子类需要实现此方法
    // 基类提供一个默认的非流式实现
    yield {
      type: 'error',
      agentId: this.agentId,
      error: 'invokeWithToolResult 需要在子类中实现',
      timestamp: Date.now()
    };
  }

  /**
   * 执行工具调用流程（增强安全版本）
   * @param {Array} messages - 消息历史
   * @param {Function} chatCallback - 调用 AI 的回调函数
   * @param {Object} options - 选项，包含 signal 用于取消
   * @returns {Object} { content: 最终回复内容，events: 工具事件数组，cancelled: 是否被取消 }
   */
  async executeWithTools(messages, chatCallback, options = {}) {
    const { signal } = options;

    // 检查初始取消状态
    if (this.checkCancelled(signal)) {
      return { content: '', events: [], cancelled: true };
    }

    let allMessages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...messages
    ];

    let toolCallCount = 0;
    const maxToolCalls = 10;
    const events = [];

    while (toolCallCount < maxToolCalls) {
      // 检查取消信号
      if (this.checkCancelled(signal)) {
        console.log(`[${this.agentId}] 工具调用链被取消`);
        return { content: '', events, cancelled: true };
      }

      // 调用 AI
      const response = await chatCallback(allMessages);

      // 再次检查（API 调用后可能已取消）
      if (this.checkCancelled(signal)) {
        console.log(`[${this.agentId}] API 调用后检测到取消`);
        return { content: '', events, cancelled: true };
      }

      const content = response.content || response;

      // 解析工具调用
      const toolCall = this.parseToolCall(content);

      if (toolCall) {
        toolCallCount++;

        // 记录工具调用事件
        events.push({
          type: 'tool_call',
          agentId: this.agentId,
          tool: toolCall.tool,
          params: toolCall.params,
          timestamp: Date.now()
        });

        // 检查取消（工具执行前）
        if (this.checkCancelled(signal)) {
          return { content: '', events, cancelled: true };
        }

        // 执行工具
        const result = await executeTool(toolCall.tool, toolCall.params);

        // 检查取消（工具执行后）
        if (this.checkCancelled(signal)) {
          return { content: '', events, cancelled: true };
        }

        // 记录工具结果事件
        events.push({
          type: 'tool_result',
          agentId: this.agentId,
          tool: toolCall.tool,
          success: result.success,
          result: result,
          timestamp: Date.now()
        });

        // 构建工具结果消息
        const resultText = result.success
          ? `执行成功：${JSON.stringify(result, null, 2)}`
          : `执行失败：${result.error}`;

        // 添加 AI 回复和工具结果到对话
        allMessages.push({ role: 'assistant', content: content });
        allMessages.push({
          role: 'user',
          content: `[${toolCall.tool} 执行结果]\n${resultText}\n\n请根据结果继续，如果任务完成请告诉用户你做了什么。`
        });

      } else {
        // 没有工具调用，返回最终回复
        const textContent = this.extractTextContent(content);
        return { content: textContent, events, cancelled: false };
      }
    }

    return {
      content: '',
      events,
      cancelled: false,
      error: '达到最大工具调用次数限制'
    };
  }
}
