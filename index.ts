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

function parseConnections(): Connection[] {
  const connectionsEnv = process.env.CONNECTIONS;
  
  if (!connectionsEnv) {
    console.error('Error: CONNECTIONS environment variable is not set.');
    console.error('');
    console.error('CONNECTIONS must be a base64-encoded JSON array:');
    console.error('  export CONNECTIONS=$(echo \'[{"token":"your-bot-token","endpoint":"https://your-webhook.com"}]\' | base64)');
    throw new Error('CONNECTIONS environment variable is required');
  }
  
  // Decode base64 (remove whitespace that may be present from shell commands)
  let jsonString: string;
  try {
    jsonString = atob(connectionsEnv.replace(/\s/g, ''));
  } catch (decodeError) {
    console.error('Error: CONNECTIONS is not valid base64.');
    console.error(`Decode error: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`);
    console.error('');
    console.error('CONNECTIONS must be a base64-encoded JSON array:');
    console.error('  export CONNECTIONS=$(echo \'[{"token":"your-bot-token","endpoint":"https://your-webhook.com"}]\' | base64)');
    throw new Error('CONNECTIONS must be valid base64');
  }
  
  // Parse JSON
  let connections: Connection[];
  try {
    connections = JSON.parse(jsonString) as Connection[];
  } catch (parseError) {
    console.error('Error: CONNECTIONS decoded but is not valid JSON.');
    console.error(`Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    console.error('');
    console.error('Expected JSON format: [{"token": "your-bot-token", "endpoint": "https://your-webhook.com"}]');
    throw new Error('CONNECTIONS must decode to valid JSON');
  }
  
  if (!Array.isArray(connections)) {
    console.error('Error: CONNECTIONS must decode to a JSON array, got:', typeof connections);
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
      throw new Error(`${connLabel} must be an object with "token" and "endpoint" properties`);
    }
    
    if (typeof conn.token !== 'string' || !conn.token.trim()) {
      console.error(`Error: ${connLabel} must have a non-empty "token" string.`);
      throw new Error(`${connLabel} must have a non-empty "token" property`);
    }
    
    if (typeof conn.endpoint !== 'string' || !conn.endpoint.trim()) {
      console.error(`Error: ${connLabel} must have a non-empty "endpoint" string.`);
      throw new Error(`${connLabel} must have a non-empty "endpoint" property`);
    }
    
    if (conn.intents !== undefined && (!Number.isInteger(conn.intents) || conn.intents < 0)) {
      console.error(`Error: ${connLabel} has an invalid "intents" value (must be a non-negative integer).`);
      throw new Error(`${connLabel} has invalid intents value`);
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

  // Handle errors gracefully - this is just a proxy, don't crash everything
  manager.on(WebSocketShardEvents.Error, (error) => {
    console.error(`${connectionLabel} WebSocket error (ignored):`, error.error?.message || error);
  });

  manager.on(WebSocketShardEvents.Closed, (event) => {
    console.warn(`${connectionLabel} WebSocket closed:`, event);
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

