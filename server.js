import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { QwenAgent } from './agents/qwen-agent.js';
import { KimiAgent } from './agents/kimi-agent.js';
import { DeepSeekAgent } from './agents/deepseek-agent.js';
import { parseMentions } from './utils/mention-parser.js';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// 调试：检查环境变量
console.log('Environment check:');
console.log('QWEN_API_KEY:', process.env.QWEN_API_KEY ? '已设置 (' + process.env.QWEN_API_KEY.slice(0, 10) + '...)' : '未设置');
console.log('KIMI_API_KEY:', process.env.KIMI_API_KEY ? '已设置 (' + process.env.KIMI_API_KEY.slice(0, 10) + '...)' : '未设置');
console.log('DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? '已设置 (' + process.env.DEEPSEEK_API_KEY.slice(0, 10) + '...)' : '未设置');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 静态文件服务
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// 初始化三个 AI Agent
const agents = {
  qwen: new QwenAgent(),
  kimi: new KimiAgent(),
  deepseek: new DeepSeekAgent()
};

// AI 成员信息
const AGENT_INFO = {
  qwen: { id: 'qwen', name: '小千', realName: '千问', company: '阿里云', icon: '🤖', color: '#f59e0b' },
  kimi: { id: 'kimi', name: '小K', realName: 'Kimi', company: '月之暗面', icon: '🌙', color: '#8b5cf6' },
  deepseek: { id: 'deepseek', name: '小D', realName: 'DeepSeek', company: 'DeepSeek', icon: '🔍', color: '#3b82f6' }
};

// 会话存储（内存中，实际应用应该用数据库）
const sessions = new Map();
const userSessions = new Map(); // userId -> [sessionIds]

// 最大每轮回复次数
const MAX_REPLY_PER_ROUND = 5;

// 生成会话名称
function generateSessionName(members) {
  if (members.length === 1) {
    return AGENT_INFO[members[0]].name;
  }
  return `群聊 (${members.map(m => AGENT_INFO[m].name).join('、')})`;
}

// 创建新会话
function createSession(userId, name, members) {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    userId,
    name: name || generateSessionName(members),
    members, // 参与此会话的AI成员
    conversationHistory: [],
    agentSessions: {
      qwen: null,
      kimi: null,
      deepseek: null
    },
    mentionQueue: [],
    isProcessingQueue: false,
    currentRoundMessages: [],
    replyCountInRound: { qwen: 0, kimi: 0, deepseek: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  sessions.set(sessionId, session);
  
  // 添加到用户的会话列表
  if (!userSessions.has(userId)) {
    userSessions.set(userId, []);
  }
  userSessions.get(userId).unshift(sessionId);
  
  return session;
}

// 获取用户的会话列表
function getUserSessionList(userId) {
  const sessionIds = userSessions.get(userId) || [];
  return sessionIds.map(id => {
    const session = sessions.get(id);
    if (!session) return null;
    return {
      id: session.id,
      name: session.name,
      members: session.members,
      lastMessage: session.conversationHistory.length > 0 
        ? session.conversationHistory[session.conversationHistory.length - 1].content.substring(0, 50) + '...'
        : '暂无消息',
      updatedAt: session.updatedAt
    };
  }).filter(Boolean);
}

// 构建给 AI 的提示
function buildAgentPrompt(agentId, session) {
  const agentInfo = AGENT_INFO[agentId];
  const contextMessages = [...session.conversationHistory, ...session.currentRoundMessages];
  
  let prompt = `你是 ${agentInfo.name}（${agentInfo.realName}），来自 ${agentInfo.company} 的 AI 助手。

【你的身份】
- 名称：${agentInfo.name}
- 公司：${agentInfo.company}
- 角色：你是一个团队成员，正在与老板（用户）以及 ${session.members.filter(m => m !== agentId).map(m => AGENT_INFO[m].name).join('、')} 进行讨论。

【对用户的称呼】
请称呼用户为"老板"。

【当前群聊成员】
${session.members.map(m => `- ${AGENT_INFO[m].name} (${AGENT_INFO[m].company})`).join('\n')}

【对话上下文】
`;
  
  if (contextMessages.length === 0) {
    prompt += '（暂无）\n';
  } else {
    contextMessages.forEach((msg, idx) => {
      const speaker = msg.agentId === 'user' ? '老板' : AGENT_INFO[msg.agentId]?.name || msg.agentId;
      prompt += `${idx + 1}. ${speaker}: ${msg.content}\n`;
    });
  }
  
  prompt += `
【重要：@功能说明】
你可以在回复中使用 @提及 来邀请其他AI参与讨论：
${session.members.filter(m => m !== agentId).map(m => `- @${AGENT_INFO[m].name} - 邀请${AGENT_INFO[m].name}回答`).join('\n')}
- @所有人 - 邀请所有AI参与

请作为${agentInfo.name}用中文自然回复：`;
  
  return prompt;
}

/**
 * 处理 AI 回复队列
 */
async function processMentionQueue(sessionId, io) {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  if (session.isProcessingQueue || session.mentionQueue.length === 0) {
    if (session.mentionQueue.length === 0) {
      finishRound(session);
      // 通知前端更新
      const socketId = Array.from(io.sockets.adapter.rooms.get(sessionId) || [])[0];
      if (socketId) {
        io.to(socketId).emit('waiting_for_user');
      }
    }
    return;
  }
  
  session.isProcessingQueue = true;
  
  const agentId = session.mentionQueue.shift();
  
  // 检查该AI是否在此会话中
  if (!session.members.includes(agentId)) {
    session.isProcessingQueue = false;
    processMentionQueue(sessionId, io);
    return;
  }
  
  const agent = agents[agentId];
  
  if (!agent || session.replyCountInRound[agentId] >= MAX_REPLY_PER_ROUND) {
    session.isProcessingQueue = false;
    processMentionQueue(sessionId, io);
    return;
  }
  
  session.replyCountInRound[agentId]++;
  
  io.to(sessionId).emit('typing', { agentId });
  
  try {
    const prompt = buildAgentPrompt(agentId, session);
    
    let messageContent = '';
    let mentionsInReply = [];
    
    for await (const event of agent.invoke(prompt, { 
      sessionId: session.agentSessions[agentId]
    })) {
      if (event.type === 'session_init') {
        session.agentSessions[agentId] = event.sessionId;
      }
      
      // 流式响应开始
      if (event.type === 'message_start') {
        io.to(sessionId).emit('message_start', {
          sessionId,
          agentId,
          timestamp: Date.now()
        });
      }
      
      // 流式内容增量
      if (event.type === 'message_delta') {
        messageContent = event.content;
        io.to(sessionId).emit('message_delta', {
          sessionId,
          agentId,
          content: event.content,
          delta: event.delta,
          timestamp: Date.now()
        });
      }
      
      // 完整消息（流式结束时）
      if (event.type === 'message') {
        messageContent = event.content;
        const mentionResult = parseMentions(messageContent);
        mentionsInReply = mentionResult.mentions;
        
        io.to(sessionId).emit('message', {
          sessionId,
          agentId,
          content: event.content,
          mentions: mentionsInReply,
          timestamp: Date.now()
        });
      }
      
      if (event.type === 'tool_call') {
        io.to(sessionId).emit('message', {
          sessionId,
          type: 'tool_call',
          agentId,
          tool: event.tool,
          params: event.params,
          timestamp: Date.now()
        });
      }
      
      if (event.type === 'tool_result') {
        io.to(sessionId).emit('message', {
          sessionId,
          type: 'tool_result',
          agentId,
          tool: event.tool,
          success: event.success,
          result: event.result,
          timestamp: Date.now()
        });
      }
      
      if (event.type === 'error') {
        io.to(sessionId).emit('error', { sessionId, agentId, error: event.error });
      }
    }
    
    if (messageContent) {
      session.currentRoundMessages.push({
        agentId,
        content: messageContent,
        timestamp: Date.now()
      });
      
      // 处理回复中的@
      if (mentionsInReply.length > 0) {
        const newMentions = mentionsInReply.filter(m => {
          if (!session.members.includes(m)) return false;
          if (session.mentionQueue.includes(m)) return false;
          if (session.replyCountInRound[m] >= MAX_REPLY_PER_ROUND) return false;
          return true;
        });
        
        // 直接加入队列，不再发送@通知
        if (newMentions.length > 0) {
          session.mentionQueue.push(...newMentions);
        }
      }
    }
    
  } catch (error) {
    console.error(`Error with ${agentId}:`, error);
    io.to(sessionId).emit('error', { sessionId, agentId, error: error.message });
  }
  
  session.isProcessingQueue = false;
  session.updatedAt = Date.now();
  
  // 继续处理队列
  setTimeout(() => processMentionQueue(sessionId, io), 100);
}

function finishRound(session) {
  if (session.currentRoundMessages.length > 0) {
    session.conversationHistory.push(...session.currentRoundMessages);
    session.currentRoundMessages = [];
  }
  
  session.replyCountInRound = { qwen: 0, kimi: 0, deepseek: 0 };
  session.updatedAt = Date.now();
  
  if (session.conversationHistory.length > 100) {
    session.conversationHistory = session.conversationHistory.slice(-100);
  }
}

// API 路由

// 获取用户的所有会话
app.get('/api/sessions', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const sessionList = getUserSessionList(userId);
  res.json({ sessions: sessionList });
});

// 创建新会话
app.post('/api/sessions', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const { name, members } = req.body;
  
  if (!members || members.length === 0) {
    return res.status(400).json({ error: '请至少选择一个AI成员' });
  }
  
  const session = createSession(userId, name, members);
  res.json({ 
    session: {
      id: session.id,
      name: session.name,
      members: session.members
    }
  });
});

// 获取会话详情
app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  
  res.json({
    session: {
      id: session.id,
      name: session.name,
      members: session.members,
      history: session.conversationHistory
    }
  });
});

// 删除会话
app.delete('/api/sessions/:sessionId', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const sessionId = req.params.sessionId;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  
  // 验证权限（只能删除自己的会话）
  if (session.userId !== userId) {
    return res.status(403).json({ error: '无权删除此会话' });
  }
  
  // 从用户的会话列表中移除
  const userSessionList = userSessions.get(userId);
  if (userSessionList) {
    const index = userSessionList.indexOf(sessionId);
    if (index > -1) {
      userSessionList.splice(index, 1);
    }
  }
  
  // 删除会话
  sessions.delete(sessionId);
  
  res.json({ success: true });
});

// 获取所有可用的AI成员
app.get('/api/agents', (req, res) => {
  res.json({ agents: Object.values(AGENT_INFO) });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  const userId = socket.handshake.query.userId || 'anonymous';
  
  // 发送用户的会话列表
  const sessionList = getUserSessionList(userId);
  socket.emit('session_list', { sessions: sessionList });
  
  // 加入会话
  socket.on('join_session', (data) => {
    const { sessionId } = data;
    const session = sessions.get(sessionId);
    
    if (!session) {
      socket.emit('error', { error: '会话不存在' });
      return;
    }
    
    // 离开之前的会话房间
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });
    
    // 加入新会话
    socket.join(sessionId);
    
    // 发送会话历史
    socket.emit('session_joined', {
      session: {
        id: session.id,
        name: session.name,
        members: session.members,
        history: [...session.conversationHistory, ...session.currentRoundMessages]
      }
    });
  });
  
  // 处理用户消息
  socket.on('user_message', (data) => {
    const { sessionId, message } = data;
    const session = sessions.get(sessionId);
    
    if (!session) {
      socket.emit('error', { error: '会话不存在' });
      return;
    }
    
    // 保存之前的轮次
    if (session.currentRoundMessages.length > 0) {
      session.conversationHistory.push(...session.currentRoundMessages);
      session.currentRoundMessages = [];
    }
    
    session.replyCountInRound = { qwen: 0, kimi: 0, deepseek: 0 };
    
    // 保存用户消息
    session.conversationHistory.push({
      agentId: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    // 广播用户消息
    io.to(sessionId).emit('message', {
      sessionId,
      agentId: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    // 解析@
    const mentionResult = parseMentions(message);
    
    if (mentionResult.mentions.length > 0) {
      session.mentionQueue = mentionResult.mentions.filter(m => session.members.includes(m));
      
      // 不再发送@通知事件
    } else {
      // 没有@，按成员顺序回复
      session.mentionQueue = [...session.members];
    }
    
    // 开始处理队列
    if (session.mentionQueue.length > 0) {
      processMentionQueue(sessionId, io);
    } else {
      socket.emit('waiting_for_user');
    }
    
    session.updatedAt = Date.now();
  });
  
  // 重命名会话
  socket.on('rename_session', (data) => {
    const { sessionId, name } = data;
    const session = sessions.get(sessionId);
    
    if (session) {
      session.name = name;
      session.updatedAt = Date.now();
      
      // 通知用户更新会话列表
      const sessionList = getUserSessionList(userId);
      socket.emit('session_list', { sessions: sessionList });
    }
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 AI Team Chat Server running on http://localhost:${PORT}`);
});
