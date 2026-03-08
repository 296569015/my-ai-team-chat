import { spawn } from 'child_process';

/**
 * Spawns a CLI command and returns an async iterable of parsed JSON events
 * @param {Object} options - Spawn options
 * @param {string} options.command - CLI command to execute
 * @param {string[]} options.args - Arguments for the command
 * @param {number} [options.timeoutMs=60000] - Timeout in milliseconds
 * @returns {AsyncIterable<Object>} Stream of parsed JSON events
 */
export async function* spawnCli({ command, args, timeoutMs = 60000 }) {
  const process = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  let timeoutId;
  let hasTimedOut = false;

  // Set up timeout
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      hasTimedOut = true;
      process.kill();
    }, timeoutMs);
  }

  const buffer = [];
  
  try {
    // Handle stdout
    for await (const chunk of process.stdout) {
      if (hasTimedOut) break;
      
      const lines = chunk.toString().split('\n');
      buffer.push(...lines.filter(line => line.trim()));
      
      // Process complete JSON lines
      while (buffer.length > 0) {
        const line = buffer[0];
        try {
          const event = JSON.parse(line);
          yield event;
          buffer.shift();
        } catch (e) {
          // Incomplete JSON or invalid line - keep in buffer
          if (buffer.length > 1) {
            // Try combining with next line
            const combined = buffer.join('\n');
            try {
              const event = JSON.parse(combined);
              yield event;
              buffer.length = 0;
              break;
            } catch (e2) {
              // Still invalid, wait for more data
              break;
            }
          } else {
            break;
          }
        }
      }
    }
    
    // Handle remaining buffer on process exit
    if (buffer.length > 0) {
      const remaining = buffer.join('\n');
      if (remaining.trim()) {
        try {
          const event = JSON.parse(remaining);
          yield event;
        } catch (e) {
          // Ignore invalid trailing data
        }
      }
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (!process.killed) {
      process.kill();
    }
  }
}