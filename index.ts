import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { REST } from '@discordjs/rest';

const ALL_INTENTS = 3276541;
const FETCH_TIMEOUT_MS = 10000; // 10 seconds timeout for webhook calls

interface Connection {
  token: string;
  endpoint: string;
  intents?: number;
}

function getConnectionLabel(index: number): string {
  return `[Connection ${index + 1}]`;
}

function isBase64(str: string): boolean {
  // Remove whitespace (newlines, spaces) which may be present in base64 from shell commands
  const cleaned = str.replace(/\s/g, '');
  // Check if it looks like valid base64: alphanumeric + / + = padding at end only, length multiple of 4
  if (/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) && cleaned.length >= 4 && cleaned.length % 4 === 0) {
    try {
      const decoded = atob(cleaned);
      // Try to parse as JSON to verify it's valid JSON content
      JSON.parse(decoded);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function decodeBase64(str: string): string {
  // Remove whitespace (newlines, spaces) which may be present in base64 from shell commands
  const cleaned = str.replace(/\s/g, '');
  return atob(cleaned);
}

function maskSensitiveData(str: string): string {
  // Mask potential tokens (anything that looks like a Discord token after "token":)
  return str.replace(/"token"\s*:\s*"[^"]+"/g, '"token": "[MASKED]"');
}

function parseConnections(): Connection[] {
  const connectionsEnv = process.env.CONNECTIONS;
  
  if (!connectionsEnv) {
    console.error('Error: CONNECTIONS environment variable is not set.');
    console.error('');
    console.error('CONNECTIONS must be a JSON array with the following structure:');
    console.error('[{"token": "your-bot-token", "endpoint": "https://your-webhook.com", "intents": 3276541}]');
    console.error('');
    console.error('You can also provide a base64-encoded JSON string:');
    console.error('  export CONNECTIONS=$(echo \'[{"token":"...","endpoint":"..."}]\' | base64)');
    throw new Error('CONNECTIONS environment variable is required');
  }
  
  let jsonString = connectionsEnv;
  let wasBase64 = false;
  
  // Try to decode as base64 if it looks like base64
  if (isBase64(connectionsEnv)) {
    try {
      jsonString = decodeBase64(connectionsEnv);
      wasBase64 = true;
      console.info('CONNECTIONS was provided as base64, decoded successfully.');
    } catch (decodeError) {
      console.error('Error: CONNECTIONS looks like base64 but failed to decode.');
      console.error(`Decode error: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`);
      throw new Error('CONNECTIONS base64 decoding failed');
    }
  }
  
  let connections: Connection[];
  try {
    connections = JSON.parse(jsonString) as Connection[];
  } catch (parseError) {
    console.error('Error: CONNECTIONS is not valid JSON.');
    console.error(`Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    console.error('');
    console.error('Received value (first 200 chars, tokens masked):');
    const maskedValue = maskSensitiveData(jsonString.substring(0, 200));
    console.error(`  ${maskedValue}${jsonString.length > 200 ? '...' : ''}`);
    console.error('');
    console.error('Expected format: [{"token": "your-bot-token", "endpoint": "https://your-webhook.com"}]');
    if (!wasBase64) {
      console.error('');
      console.error('Tip: If your JSON has special characters, try base64 encoding:');
      console.error('  export CONNECTIONS=$(echo \'[{"token":"...","endpoint":"..."}]\' | base64)');
    }
    throw new Error('CONNECTIONS must be valid JSON');
  }
  
  if (!Array.isArray(connections)) {
    console.error('Error: CONNECTIONS must be a JSON array, got:', typeof connections);
    console.error('Expected format: [{"token": "your-bot-token", "endpoint": "https://your-webhook.com"}]');
    throw new Error('CONNECTIONS must be a JSON array');
  }
  
  if (connections.length === 0) {
    console.error('Error: CONNECTIONS array is empty. At least one connection is required.');
    throw new Error('CONNECTIONS array cannot be empty');
  }
  
  for (const [idx, conn] of connections.entries()) {
    const connLabel = `Connection at index ${idx}`;
    
    if (typeof conn !== 'object' || conn === null) {
      console.error(`Error: ${connLabel} is not an object.`);
      console.error(`  Received: ${JSON.stringify(conn)}`);
      throw new Error(`${connLabel} must be an object with "token" and "endpoint" properties`);
    }
    
    if (typeof conn.token !== 'string') {
      console.error(`Error: ${connLabel} is missing the "token" property or it's not a string.`);
      console.error(`  Received token type: ${typeof conn.token}`);
      throw new Error(`${connLabel} must have a string "token" property`);
    }
    
    if (!conn.token.trim()) {
      console.error(`Error: ${connLabel} has an empty "token" value.`);
      console.error('  The Discord bot token is required for authentication.');
      throw new Error(`${connLabel} must have a non-empty "token" property`);
    }
    
    if (typeof conn.endpoint !== 'string') {
      console.error(`Error: ${connLabel} is missing the "endpoint" property or it's not a string.`);
      console.error(`  Received endpoint type: ${typeof conn.endpoint}`);
      throw new Error(`${connLabel} must have a string "endpoint" property`);
    }
    
    if (!conn.endpoint.trim()) {
      console.error(`Error: ${connLabel} has an empty "endpoint" value.`);
      throw new Error(`${connLabel} must have a non-empty "endpoint" property`);
    }
    
    if (conn.intents !== undefined && (!Number.isInteger(conn.intents) || conn.intents < 0)) {
      console.error(`Error: ${connLabel} has an invalid "intents" value.`);
      console.error(`  Received: ${conn.intents} (type: ${typeof conn.intents})`);
      console.error('  Intents must be a non-negative integer (e.g., 3276541 for all intents).');
      throw new Error(`${connLabel} has invalid intents value (must be a non-negative integer)`);
    }
  }
  
  return connections;
}

function createConnection(connection: Connection, index: number): WebSocketManager {
  const { token, endpoint, intents } = connection;
  const connectionLabel = getConnectionLabel(index);
  
  const rest = new REST().setToken(token);
  
  const manager = new WebSocketManager({
    token,
    intents: intents ?? ALL_INTENTS,
    rest,
    // compression: CompressionMethod.ZlibStream,
  });

  manager.on(WebSocketShardEvents.Dispatch, async (event) => {
    const t = event?.data?.t;
    const s = event?.data?.s;
    console.info(`${connectionLabel} ${s}: ${t} event dispatching...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      
      console.info(`${connectionLabel} ${s}: ${t} event dispatched.`);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.error(`${connectionLabel} ${s}: ${t} event dispatch timed out after ${FETCH_TIMEOUT_MS}ms`);
        } else {
          console.error(`${connectionLabel} ${s}: ${t} event dispatch failed:`, error.message);
        }
      } else {
        console.error(`${connectionLabel} ${s}: ${t} event dispatch failed:`, error);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  });

  return manager;
}

// Parse connections and create managers
const connections = parseConnections();
console.info(`Starting ${connections.length} connection(s)...`);

// Keep managers array for potential graceful shutdown handling
const managers = connections.map((conn, index) => createConnection(conn, index));

// Connect all managers using allSettled for resilient connections
const results = await Promise.allSettled(managers.map((manager, index) => {
  console.info(`${getConnectionLabel(index)} Connecting...`);
  return manager.connect();
}));

const failedResults: Array<{index: number; reason: unknown}> = [];
results.forEach((result, index) => {
  if (result.status === 'rejected') {
    failedResults.push({ index, reason: result.reason });
  }
});

if (failedResults.length > 0) {
  console.error(`${failedResults.length} connection(s) failed to establish:`);
  failedResults.forEach(({ index, reason }) => {
    console.error(`  ${getConnectionLabel(index)}: ${reason}`);
  });
}

const successes = results.filter(r => r.status === 'fulfilled').length;
console.info(`${successes}/${connections.length} connection(s) established.`);

