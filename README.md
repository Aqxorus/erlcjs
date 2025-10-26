# ERLC API JavaScript Wrapper

A powerful, feature-rich JavaScript client for the Emergency Response: Liberty County (ER:LC) API with built-in rate limiting, request queueing, caching support, and real-time events.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Client Configuration](#client-configuration)
- [API Methods](#api-methods)
- [Real-time Events](#real-time-events)
- [Event Filtering](#event-filtering)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Request Queueing](#request-queueing)
- [Caching](#caching)
- [Best Practices](#best-practices)
- [Timeouts](#timeouts)
- [Best Practices](#best-practices)
- [Types](#types)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🌟 Complete ERLC API coverage with comprehensive type definitions
- 📡 Real-time event system with type-safe handlers
- 🚦 Smart rate limiting with automatic backoff
- 📱 Automatic request queueing and batching
- 🔄 Built-in retry mechanism with configurable policies
- ⚡ High-performance caching system
- 💪 Fully async/await compatible
- ⌛ Timeout support for requests
- 🎯 Zero external dependencies for API functionality

## Installation

Include the API wrapper in your Node.js project:

```javascript
const { newClient, EventType, getFriendlyErrorMessage } = require('./src/API');
```

## Basic Usage

```javascript
const { newClient, EventType } = require('./src/API');

async function main() {
  // Initialize client with API key
  const client = newClient('your-api-key', {
    timeout: 15000,
    baseURL: 'https://api.policeroleplay.community/v1',
  });

  try {
    // Get current players
    const players = await client.getPlayers();
    console.log('Current players:', players);

    // Execute a server command
    await client.executeCommand(':pm Player123 Hello from the API!');
    console.log('Command executed successfully');

    // Get command logs
    const logs = await client.getCommandLogs();
    console.log('Recent commands:', logs);

    // Real-time event subscription
    const subscription = client.subscribe(
      [EventType.PLAYERS, EventType.COMMANDS],
      {
        pollInterval: 1000,
        batchEvents: true,
        logErrors: true,
      }
    );

    // Register event handlers
    subscription.handle({
      playerHandler: (changes) => {
        changes.forEach((change) => {
          console.log(`Player ${change.player.Player}: ${change.type}`);
        });
      },
      commandHandler: (commands) => {
        commands.forEach((cmd) => {
          console.log(`Command executed: ${cmd.Command} by ${cmd.Player}`);
        });
      },
    });

    // Start listening for events
    subscription.start();

    // Clean up after 30 seconds
    setTimeout(() => {
      subscription.close();
      client.destroy();
    }, 30000);
  } catch (error) {
    console.error('Error:', getFriendlyErrorMessage(error));
  }
}

main();
```

## Client Configuration

### Basic Client

```javascript
const client = newClient('your-api-key', {
  timeout: 30000,
  baseURL: 'https://api.policeroleplay.community/v1',
});
```

### Client with Request Queue

```javascript
const client = newClientWithQueue(
  'your-api-key',
  2, // workers
  1000, // interval in ms
  {
    timeout: 30000,
  }
);
```

### Client with Caching

```javascript
const client = newClientWithCache(
  'your-api-key',
  60000, // TTL in ms
  {
    timeout: 30000,
  }
);
```

### Client with Queue and Cache

```javascript
const client = newClientWithQueueAndCache(
  'your-api-key',
  {
    workers: 2,
    interval: 1000,
    ttl: 60000,
  },
  {
    timeout: 30000,
  }
);
```

### Advanced Configuration

```javascript
const { createClient } = require('./src/API');

const client = createClient('your-api-key', {
  timeout: 30000,
  baseURL: 'https://api.policeroleplay.community/v1',

  // Request queueing
  requestQueue: {
    workers: 2,
    interval: 1000,
  },

  // Caching
  cache: {
    enabled: true,
    ttl: 60000,
    staleIfError: true,
    maxItems: 1000,
    prefix: 'erlc:',
  },
});
```

## Timeouts

The `timeout` option is applied per HTTP attempt. When a request fails with a retryable error (e.g., transient network failure, timeout, or 5xx), the client retries with exponential backoff. Queue delays, rate-limit waits, and backoff delays do not reduce the per-attempt timeout.

- Default: `timeout` = 10000 ms unless overridden
- Recommended: set `timeout` to 15000–30000 ms for endpoints that can be slow under load
- Retries: up to 3 attempts by default, with jittered exponential backoff

Example:

```javascript
const client = newClientWithQueueAndCache(
  apiKey,
  { workers: 2, interval: 200, ttl: 30000 },
  { timeout: 20000 } // per-attempt timeout
);
```

## API Methods

### Player Management

```javascript
// Get all players currently on the server
const players = await client.getPlayers();
```

### Server Commands

```javascript
// Execute server commands
await client.executeCommand(':pm PlayerName Hello!');
await client.executeCommand(':kick PlayerName Reason');
await client.executeCommand(':ban PlayerName Reason');
```

### Logs

```javascript
// Command execution history
const commandLogs = await client.getCommandLogs();

// Moderation calls
const modCalls = await client.getModCalls();

// Kill logs
const killLogs = await client.getKillLogs();

// Join/leave logs
const joinLogs = await client.getJoinLogs();
```

### Vehicle Management

```javascript
// Get all vehicles on the server
const vehicles = await client.getVehicles();
```

### Server Information

```javascript
// Get server info and player count
const serverInfo = await client.getServer();

// Get server queue information
const queueInfo = await client.getQueue();

// Get ban information
const banInfo = await client.getBans();
```

## Real-time Events

### Basic Event Subscription

```javascript
const subscription = client.subscribe(
  [EventType.PLAYERS, EventType.COMMANDS, EventType.KILLS],
  {
    pollInterval: 1000,
    bufferSize: 200,
    retryOnError: true,
    batchEvents: true,
    batchWindow: 100,
    logErrors: true,
  }
);

subscription.handle({
  playerHandler: (changes) => {
    changes.forEach((change) => {
      console.log(`Player ${change.player.Player}: ${change.type}`);
    });
  },
  killHandler: (kills) => {
    kills.forEach((kill) => {
      console.log(`Kill: ${kill.Killer} -> ${kill.Killed}`);
    });
  },
});

subscription.start();
```

### Event Configuration

```javascript
const config = {
  pollInterval: 1000, // Poll every second
  bufferSize: 200, // Buffer size for events
  retryOnError: true, // Retry on errors
  retryInterval: 5000, // Retry after 5 seconds
  batchEvents: true, // Batch multiple events
  batchWindow: 100, // Batch window in ms
  logErrors: true, // Log errors to console
  includeInitialState: true, // Include current state on start
  timeFormat: 'iso', // Time format for events
};

const subscription = client.subscribeWithConfig(
  config,
  EventType.PLAYERS,
  EventType.COMMANDS
);
```

## Event Filtering

```javascript
const config = {
  pollInterval: 1000,
  filterFunc: (event) => {
    switch (event.type) {
      case EventType.PLAYERS:
        // Only process Sheriff department players
        const changes = event.data;
        return changes.some((change) => change.player.Team === 'Sheriff');

      case EventType.KILLS:
        // Only process kills with a valid killer
        const kills = event.data;
        return kills.length > 0 && kills[0].Killer !== '';

      default:
        return true;
    }
  },
};
```

## Error Handling

```javascript
const { getFriendlyErrorMessage } = require('./src/API');

try {
  const players = await client.getPlayers();
} catch (error) {
  if (error.code) {
    switch (error.code) {
      case 1001:
        // Server communication error
        console.log('Server offline, retrying in 5 seconds...');
        setTimeout(retry, 5000);
        break;
      case 4001:
        // Rate limit hit
        console.log('Rate limited, backing off...');
        handleRateLimit();
        break;
      default:
        console.error('API Error:', getFriendlyErrorMessage(error));
    }
  } else {
    console.error('Unknown error:', error.message);
  }
}
```

### Common Error Codes

- `1001`: Server communication error
- `2000-2004`: Authentication errors
- `3001-3002`: Command/server errors
- `4001-4003`: Rate limiting and restrictions
- `9998-9999`: Access and module errors

## Rate Limiting

The client automatically handles rate limits by:

- Tracking rate limit headers from API responses
- Implementing automatic backoff when limits are hit
- Queuing requests when rate limited
- Providing real-time rate limit status

```javascript
// Check rate limit status
const status = client.getStatus();
console.log('Rate limit status:', status.rateLimiter.globalStatus);
```

## Request Queueing

Enable automatic request queueing to prevent rate limits:

```javascript
const client = newClientWithQueue(
  'your-api-key',
  2, // 2 workers
  1000 // 1 second between requests
);

// Check queue status
const status = client.getStatus();
console.log('Queue status:', status.queue);
```

## Caching

Configure caching to improve performance and reduce API calls:

```javascript
const client = newClientWithCache(
  'your-api-key',
  60000, // 1 minute TTL
  {
    timeout: 30000,
  }
);

// Check cache statistics
const status = client.getStatus();
console.log('Cache stats:', status.cache);
```

## Best Practices

### 1. Use Proper Error Handling

```javascript
try {
  const result = await client.getPlayers();
} catch (error) {
  console.error('Error:', getFriendlyErrorMessage(error));
}
```

### 2. Handle Rate Limits

```javascript
const client = newClientWithQueue('your-api-key', 1, 1000);
```

### 3. Enable Caching for Frequent Requests

```javascript
const client = newClientWithCache('your-api-key', 300000); // 5 minutes
```

### 4. Clean Up Resources

```javascript
// Always clean up subscriptions and client
subscription.close();
client.destroy();
```

### 5. Use Event Handlers Effectively

```javascript
subscription.handle({
  playerHandler: (changes) => {
    // Process player changes efficiently
    const joins = changes.filter((c) => c.type === 'join');
    const leaves = changes.filter((c) => c.type === 'leave');

    if (joins.length > 0) {
      console.log(`${joins.length} players joined`);
    }
    if (leaves.length > 0) {
      console.log(`${leaves.length} players left`);
    }
  },
});
```

## Types

### Available Event Types

```javascript
const EventType = {
  PLAYERS: 'players', // Player join/leave events
  COMMANDS: 'commands', // Command execution events
  KILLS: 'kills', // Kill events
  MODCALLS: 'modcalls', // Moderation call events
  JOINS: 'joins', // Join/leave log events
  VEHICLES: 'vehicles', // Vehicle events
};
```

### Data Types

#### ERLCServerPlayer

```javascript
{
    Player: "PlayerName",           // Username
    Permission: "Admin",            // Permission level
    Callsign: "PC-31",             // In-game callsign
    Team: "Civilian Protection"     // Current team/department
}
```

#### ERLCCommandLog

```javascript
{
    Player: "AdminName",            // Who executed the command
    Timestamp: 1640995200,          // Unix timestamp
    Command: ":pm Player Hello"     // Command that was executed
}
```

#### ERLCKillLog

```javascript
{
    Killed: "PlayerName",           // Who was killed
    Timestamp: 1640995200,          // Unix timestamp
    Killer: "KillerName"            // Who made the kill
}
```

#### ERLCVehicle

```javascript
{
    Texture: "Police",              // Vehicle texture
    Name: "Police Cruiser",         // Vehicle name
    Owner: "PlayerName"             // Vehicle owner
}
```

## Contributing

We welcome contributions of all kinds, whether it's bug fixes, new features, or documentation improvements. To contribute:

1. **Fork the Repository** – Create your own copy of the project.
2. **Create a Branch** – Work on a separate branch for your changes:
   ```bash
   git checkout -b feature-or-fix-name
   ```
3. **Make Your Changes** – Ensure your code follows the project's style and guidelines.
4. **Test Thoroughly** – Test your changes with the ERLC API.
5. **Commit and Push** – Keep commits clear and concise:
   ```bash
   git commit -m "Brief description of changes"
   git push origin feature-or-fix-name
   ```
6. **Open a Pull Request** – Submit your changes for review.

## License

MIT - see [LICENSE](./LICENSE) for details.

---

_This API wrapper is based on the design and structure of [bmrgcorp/erlcgo](https://github.com/bmrgcorp/erlcgo) but implemented in JavaScript for Node.js environments._
