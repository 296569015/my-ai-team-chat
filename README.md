# AI Team Chat - 可视化聊天室

一个可视化的多 AI 聊天室，支持三个国产 AI 模型（千问、Kimi、DeepSeek）互相协作聊天，你也可以参与其中。

![界面预览](https://user-images.githubusercontent.com/placeholder.png)

## 功能特点

- 🎨 **可视化界面** - 美观的 Web 聊天界面，类似微信群聊
- 🤖 **三个国产 AI** - 千问、Kimi、DeepSeek 依次回复
- 👤 **用户参与** - 你也可以发送消息参与讨论
- 💬 **实时通信** - 使用 WebSocket 实时显示消息
- 📱 **响应式设计** - 支持桌面和移动端访问

## 界面截图

聊天室包含：
- 顶部标题栏
- 成员列表（你、千问、Kimi、DeepSeek）
- 消息展示区
- 底部输入框

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API 密钥

复制 `.env.example` 为 `.env`：

```bash
copy .env.example .env
```

编辑 `.env` 文件，填入你的 API 密钥：

| 环境变量 | 说明 | 获取地址 |
|---------|------|---------|
| `QWEN_API_KEY` | 千问 API 密钥 | https://dashscope.aliyun.com/ |
| `KIMI_API_KEY` | Kimi API 密钥 | https://platform.moonshot.cn/ |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | https://platform.deepseek.com/ |

### 3. 启动服务器

```bash
npm start
```

### 4. 打开浏览器访问

```
http://localhost:3000
```

## 使用说明

1. 打开页面后，系统会显示欢迎消息
2. 在底部输入框输入消息，按 **Enter** 发送
3. 三个 AI 会依次思考和回复
4. AI 回复完成后，你可以继续发送消息
5. 按 **Shift+Enter** 可以换行

## 聊天流程

```
你发送消息
    ↓
千问回复
    ↓
Kimi回复
    ↓
DeepSeek回复
    ↓
等待你的下一条消息
```

## 项目结构

```
ai-team-chat/
├── agents/                # AI 代理
│   ├── qwen-agent.js     # 千问
│   ├── kimi-agent.js     # Kimi
│   └── deepseek-agent.js # DeepSeek
├── public/               # 前端文件
│   ├── index.html        # 页面结构
│   ├── style.css         # 样式
│   └── app.js            # 前端逻辑
├── utils/                # 工具函数
│   ├── api-client.js     # API 调用
│   └── cli-spawn.js      # CLI 工具（保留）
├── server.js             # Web 服务器
├── team-manager.js       # 团队管理
├── index.js              # 命令行版本入口
├── .env                  # 环境变量
└── package.json
```

## 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器端口 |
| `QWEN_API_KEY` | - | 千问 API 密钥 |
| `QWEN_MODEL` | `qwen-max` | 千问模型 |
| `KIMI_API_KEY` | - | Kimi API 密钥 |
| `KIMI_MODEL` | `moonshot-v1-8k` | Kimi 模型 |
| `DEEPSEEK_API_KEY` | - | DeepSeek API 密钥 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek 模型 |

## 命令行版本

如果你更喜欢命令行版本，可以直接运行：

```bash
node index.js
```

## 技术栈

- **后端**: Node.js + Express + Socket.io
- **前端**: HTML5 + CSS3 + Vanilla JavaScript
- **AI API**: 阿里云 DashScope、Moonshot、DeepSeek

## 常见问题

### Q: 如何更换 AI 模型？
A: 编辑 `.env` 文件中的模型名称即可。

### Q: 可以同时打开多个聊天窗口吗？
A: 可以，每个浏览器标签页都是一个独立的会话。

### Q: 聊天记录会保存吗？
A: 目前不会持久化保存，刷新页面后聊天记录会丢失。

### Q: 如何修改端口？
A: 设置 `PORT` 环境变量，例如 `PORT=8080 npm start`。

## License

MIT
