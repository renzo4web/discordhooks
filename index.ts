import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { REST } from '@discordjs/rest';

const ALL_INTENTS = 3276541;
const FETCH_TIMEOUT_MS = 10000; // 10 seconds timeout for webhook calls

interface Connection {
  token: string;
  endpoint: string;
  intents?: number;
}

function parseConnections(): Connection[] {
  const connectionsEnv = process.env.CONNECTIONS;
  
  // If CONNECTIONS is provided, parse it as JSON array
  if (connectionsEnv) {
    try {
      const connections = JSON.parse(connectionsEnv) as Connection[];
      if (!Array.isArray(connections)) {
        throw new Error('CONNECTIONS must be a JSON array');
      }
      if (connections.length === 0) {
        throw new Error('CONNECTIONS array cannot be empty');
      }
      for (const conn of connections) {
        if (!conn.token?.trim() || !conn.endpoint?.trim()) {
          throw new Error('Each connection must have non-empty "token" and "endpoint" properties');
        }
      }
      return connections;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('CONNECTIONS must be valid JSON');
      }
      throw error;
    }
  }
  
  // Backward compatibility: use DISCORD_TOKEN and ENDPOINT
  const token = process.env.DISCORD_TOKEN;
  const endpoint = process.env.ENDPOINT;
  
  if (!token) {
    throw new Error('DISCORD_TOKEN or CONNECTIONS environment variable is required');
  }
  
  if (!endpoint) {
    throw new Error('ENDPOINT or CONNECTIONS environment variable is required');
  }
  
  const intentsEnv = process.env.INTENTS;
  let intents: number | undefined;
  if (intentsEnv) {
    intents = parseInt(intentsEnv, 10);
    if (isNaN(intents)) {
      throw new Error('INTENTS environment variable must be a valid number');
    }
  }
  
  return [{
    token,
    endpoint,
    intents,
  }];
}

function createConnection(connection: Connection, index: number): WebSocketManager {
  const { token, endpoint, intents } = connection;
  const connectionLabel = `[Connection ${index + 1}]`;
  
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

const managers = connections.map((conn, index) => createConnection(conn, index));

// Connect all managers
await Promise.all(managers.map((manager, index) => {
  console.info(`[Connection ${index + 1}] Connecting...`);
  return manager.connect();
}));

console.info(`All ${connections.length} connection(s) established.`);

