import { WebSocketManager, WebSocketShardEvents, CompressionMethod } from '@discordjs/ws';
import { REST } from '@discordjs/rest';

const ALL_INTENTS = 3276541;
const FETCH_TIMEOUT_MS = 10000; // 10 seconds timeout for webhook calls

// Validate required environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ENDPOINT = process.env.ENDPOINT;

if (!DISCORD_TOKEN) {
  throw new Error('DISCORD_TOKEN environment variable is required');
}

if (!ENDPOINT) {
  throw new Error('ENDPOINT environment variable is required');
}

const rest = new REST().setToken(DISCORD_TOKEN);

const manager = new WebSocketManager({
  token: DISCORD_TOKEN,
  intents: Number(process.env.INTENTS) || ALL_INTENTS,
  rest,
  // compression: CompressionMethod.ZlibStream,
});

manager.on(WebSocketShardEvents.Dispatch, async (event) => {
  const t = event?.data?.t;
  const s = event?.data?.s;
  console.info(`${s}: ${t} event dispatching...`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    
    console.info(`${s}: ${t} event dispatched.`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.error(`${s}: ${t} event dispatch timed out after ${FETCH_TIMEOUT_MS}ms`);
      } else {
        console.error(`${s}: ${t} event dispatch failed:`, error.message);
      }
    } else {
      console.error(`${s}: ${t} event dispatch failed:`, error);
    }
  } finally {
    clearTimeout(timeoutId);
  }
});

await manager.connect();

