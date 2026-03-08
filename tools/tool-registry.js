/**
 * 工具注册表
 * 管理和执行本地 Agent 工具
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

// 允许的工作目录（为了安全）
const ALLOWED_DIRECTORIES = [
  process.cwd(),
  homedir(),
  join(homedir(), 'Desktop'),
  join(homedir(), 'Documents'),
  join(homedir(), 'Downloads'),
];

/**
 * 验证路径是否在允许范围内
 */
function validatePath(filePath) {
  const resolved = resolve(filePath);
  const isAllowed = ALLOWED_DIRECTORIES.some(dir => 
    resolved.startsWith(resolve(dir))
  );
  if (!isAllowed) {
    throw new Error(`路径 "${filePath}" 不在允许范围内。允许的目录: ${ALLOWED_DIRECTORIES.join(', ')}`);
  }
  return resolved;
}

/**
 * 工具定义
 */
export const TOOLS = {
  Bash: {
    description: '执行 Bash/Shell 命令',
    parameters: {
      command: {
        type: 'string',
        description: '要执行的命令'
      },
      workingDir: {
        type: 'string',
        description: '工作目录（可选）',
        default: process.cwd()
      }
    }
  },
  Read: {
    description: '读取文件内容',
    parameters: {
      path: {
        type: 'string',
        description: '文件路径'
      }
    }
  },
  Write: {
    description: '写入文件内容（会覆盖）',
    parameters: {
      path: {
        type: 'string',
        description: '文件路径'
      },
      content: {
        type: 'string',
        description: '文件内容'
      }
    }
  },
  Edit: {
    description: '编辑文件内容（查找替换）',
    parameters: {
      path: {
        type: 'string',
        description: '文件路径'
      },
      oldString: {
        type: 'string',
        description: '要替换的旧字符串'
      },
      newString: {
        type: 'string',
        description: '新字符串'
      }
    }
  },
  Glob: {
    description: '搜索文件',
    parameters: {
      pattern: {
        type: 'string',
        description: '搜索模式，如 "*.js"'
      },
      path: {
        type: 'string',
        description: '搜索路径（可选）',
        default: process.cwd()
      }
    }
  },
  Grep: {
    description: '在文件中搜索文本',
    parameters: {
      pattern: {
        type: 'string',
        description: '搜索的文本'
      },
      path: {
        type: 'string',
        description: '文件或目录路径'
      }
    }
  },
  MkDir: {
    description: '创建文件夹',
    parameters: {
      path: {
        type: 'string',
        description: '文件夹路径'
      }
    }
  },
  Ls: {
    description: '列出目录内容',
    parameters: {
      path: {
        type: 'string',
        description: '目录路径（可选）',
        default: process.cwd()
      }
    }
  }
};

/**
 * 工具执行器
 */
export const ToolExecutor = {
  /**
   * 执行 Bash 命令
   */
  async Bash({ command, workingDir = process.cwd() }) {
    const validDir = validatePath(workingDir);
    try {
      const { stdout, stderr } = await execAsync(command, { 
        cwd: validDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024 // 1MB
      });
      return {
        success: true,
        stdout: stdout || '(无输出)',
        stderr: stderr || ''
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      };
    }
  },

  /**
   * 读取文件
   */
  async Read({ path }) {
    try {
      const validPath = validatePath(path);
      if (!existsSync(validPath)) {
        return { success: false, error: `文件不存在: ${path}` };
      }
      const stats = await fs.stat(validPath);
      if (stats.isDirectory()) {
        return { success: false, error: `"${path}" 是一个目录，不是文件` };
      }
      const content = await fs.readFile(validPath, 'utf-8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 写入文件
   */
  async Write({ path, content }) {
    try {
      const validPath = validatePath(path);
      // 确保目录存在
      const dir = dirname(validPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(validPath, content, 'utf-8');
      return { success: true, message: `文件已写入: ${path}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 编辑文件
   */
  async Edit({ path, oldString, newString }) {
    try {
      const validPath = validatePath(path);
      if (!existsSync(validPath)) {
        return { success: false, error: `文件不存在: ${path}` };
      }
      const content = await fs.readFile(validPath, 'utf-8');
      if (!content.includes(oldString)) {
        return { success: false, error: `在文件中找不到指定文本` };
      }
      const newContent = content.replace(oldString, newString);
      await fs.writeFile(validPath, newContent, 'utf-8');
      return { success: true, message: `文件已编辑: ${path}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 搜索文件
   */
  async Glob({ pattern, path = process.cwd() }) {
    try {
      const validPath = validatePath(path);
      const results = [];
      
      async function search(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
            await search(fullPath);
          } else if (entry.name.match(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'))) {
            results.push(fullPath);
          }
        }
      }
      
      await search(validPath);
      return { success: true, files: results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 在文件中搜索文本
   */
  async Grep({ pattern, path }) {
    try {
      const validPath = validatePath(path);
      const results = [];
      
      async function search(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
            await search(fullPath);
          } else if (entry.isFile()) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              if (content.includes(pattern)) {
                const lines = content.split('\n');
                lines.forEach((line, index) => {
                  if (line.includes(pattern)) {
                    results.push({ file: fullPath, line: index + 1, content: line.trim() });
                  }
                });
              }
            } catch (e) {
              // 忽略无法读取的文件
            }
          }
        }
      }
      
      if ((await fs.stat(validPath)).isDirectory()) {
        await search(validPath);
      } else {
        const content = await fs.readFile(validPath, 'utf-8');
        if (content.includes(pattern)) {
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (line.includes(pattern)) {
              results.push({ file: validPath, line: index + 1, content: line.trim() });
            }
          });
        }
      }
      
      return { success: true, matches: results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 创建文件夹
   */
  async MkDir({ path }) {
    try {
      const validPath = validatePath(path);
      await fs.mkdir(validPath, { recursive: true });
      return { success: true, message: `文件夹已创建: ${path}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 列出目录
   */
  async Ls({ path = process.cwd() }) {
    try {
      const validPath = validatePath(path);
      if (!existsSync(validPath)) {
        return { success: false, error: `目录不存在: ${path}` };
      }
      const entries = await fs.readdir(validPath, { withFileTypes: true });
      const items = [];
      for (const entry of entries) {
        let size = null;
        if (entry.isFile()) {
          const stats = await fs.stat(join(validPath, entry.name));
          size = stats.size;
        }
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: size
        });
      }
      return { success: true, items, path: validPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

/**
 * 执行工具调用
 */
export async function executeTool(toolName, params) {
  const executor = ToolExecutor[toolName];
  if (!executor) {
    return { success: false, error: `未知工具: ${toolName}` };
  }
  return await executor(params);
}

/**
 * 生成工具说明文本（用于系统 prompt）
 */
export function generateToolDescription() {
  let description = '你可以使用以下工具来操作本地系统：\n\n';
  
  for (const [name, tool] of Object.entries(TOOLS)) {
    description += `## ${name}\n${tool.description}\n参数:\n`;
    for (const [paramName, paramInfo] of Object.entries(tool.parameters)) {
      const defaultValue = paramInfo.default ? ` (默认: ${paramInfo.default})` : '';
      description += `  - ${paramName}: ${paramInfo.type}${defaultValue} - ${paramInfo.description}\n`;
    }
    description += '\n';
  }
  
  description += '\n使用工具时，请以以下格式回复：\n';
  description += '```tool\n{\n  "tool": "工具名",\n  "params": {\n    "参数名": "参数值"\n  }\n}\n```\n';
  description += '\n如果需要多个工具，请按顺序调用，等待结果后再进行下一步。';
  
  return description;
}
