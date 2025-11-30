# discordhooks

`discordhooks` is a really simple utility that allows you to send discord events to a web endpoint. It's super simple and good enough for most projects that might be thinking about using it.

## When to use this

If you're thinking about creating a discord bot that does more than react to slash commands, you'll almost certainly be wanting to make use of their [gateway](https://discord.com/developers/docs/topics/gateway-events) to react to things that happen in your server.

If you're thinking about creating a bot, chances are that you're trying to also keep costs as low as possible. If you've decided to opt for a serverless platform to make this happen, something like [Val Town](https://val.town) for example, you'll be unable to make this work. Websockets and severless don't play nicely (without bundling in extra services to manage the socket connections for you).

Since most of these events can be responded to using the REST API, not back through the same websocket connection, we can easily split these two things up and keep each super simple. That's what this service is for.

# Configuration

## Single Connection (Simple)

For a single Discord bot, use these environment variables:

```bash
DISCORD_TOKEN=your_bot_token
ENDPOINT=https://your-webhook-endpoint.com/api
INTENTS=3276541  # Optional, defaults to all intents
```

## Multiple Connections

To run multiple Discord bots, each sending events to their own endpoint, use the `CONNECTIONS` environment variable with a JSON array:

```bash
CONNECTIONS='[{"token":"bot_token_1","endpoint":"https://endpoint1.com/api"},{"token":"bot_token_2","endpoint":"https://endpoint2.com/api","intents":3276541}]'
```

Each connection object supports:
- `token` (required): Discord bot token
- `endpoint` (required): Webhook URL to receive events
- `intents` (optional): Gateway intents (defaults to all intents)

# Cloud version

Right now, the cloud version of this service is designed specifically for Val Town. To make use of it, get in touch with @neverstew on the Val Town Discord.

# Self-hosted version

TODO: bear with me...

# Development

Install with `bun install`

Run with `bun run index.ts`

