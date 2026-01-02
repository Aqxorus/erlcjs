/**
 * Event Subscription System for ERLC API
 * Provides real-time event monitoring with configurable polling
 */

const { EventType } = require('./types');

/**
 * Default event configuration
 * @returns {EventConfig}
 */
function getDefaultEventConfig() {
  return {
    pollInterval: 2000, // 2 seconds
    bufferSize: 100,
    retryOnError: true,
    retryInterval: 5000, // 5 seconds
    includeInitialState: false,
    batchEvents: false,
    batchWindow: 100, // 100 ms
    logErrors: false,
    timeFormat: 'ISO',
  };
}

class Subscription {
  /**
   * @param {ERLCClient} client - The ERLC client instance
   * @param {EventConfig} config - Event configuration
   * @param {string[]} eventTypes - Event types to subscribe to
   */
  constructor(client, config, eventTypes) {
    this.client = client;
    this.config = { ...getDefaultEventConfig(), ...config };
    this.eventTypes = eventTypes;
    this.handlers = {};
    this.running = false;
    this.pollInterval = null;
    this.eventQueue = [];

    this.pollInFlight = false;
    this.nextAllowedPollAt = 0;

    this.lastState = {
      players: new Set(),
      commandTime: 0,
      modCallTime: 0,
      killTime: 0,
      joinTime: 0,
      vehicleSet: new Set(),
      initialized: false,
    };
  }

  /**
   * Register event handlers
   * @param {HandlerRegistration} handlers - Event handlers
   */
  handle(handlers) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * Start the subscription
   */
  async start() {
    if (this.running) return;

    this.running = true;

    if (this.config.includeInitialState) {
      await this.initializeState();
    }

    this.pollInterval = setInterval(() => {
      if (!this.running) return;
      if (this.pollInFlight) return;
      if (Date.now() < this.nextAllowedPollAt) return;

      this.pollInFlight = true;
      this.poll()
        .catch((_err) => {
          if (this.config.retryOnError) {
            const retryMs = Math.max(0, Number(this.config.retryInterval) || 0);
            this.nextAllowedPollAt = Date.now() + retryMs;
          }

          if (this.config.logErrors) {
            console.error('Event polling error:', _err);
          }
          if (this.config.errorHandler) {
            this.config.errorHandler(_err);
          }
        })
        .finally(() => {
          this.pollInFlight = false;
        });
    }, this.config.pollInterval);
  }

  /**
   * Stop the subscription
   */
  stop() {
    this.running = false;

    this.pollInFlight = false;
    this.nextAllowedPollAt = 0;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Close the subscription (alias for stop)
   */
  close() {
    this.stop();
  }

  /**
   * Initialize state with current data
   */
  async initializeState() {
    try {
      for (const eventType of this.eventTypes) {
        switch (eventType) {
          case EventType.PLAYERS:
            if (this.handlers.playerHandler) {
              const players = await this.client.getPlayers();
              this.lastState.players = new Set(players.map((p) => p.Player));
            }
            break;
          case EventType.COMMANDS:
            {
              const commandLogs = await this.client.getCommandLogs();
              if (commandLogs && commandLogs.length > 0) {
                this.lastState.commandTime = commandLogs[0].Timestamp;
              }
            }
            break;
          case EventType.MODCALLS:
            {
              const modCalls = await this.client.getModCalls();
              if (modCalls && modCalls.length > 0) {
                this.lastState.modCallTime = modCalls[0].Timestamp;
              }
            }
            break;
          case EventType.KILLS:
            {
              const killLogs = await this.client.getKillLogs();
              if (killLogs && killLogs.length > 0) {
                this.lastState.killTime = killLogs[0].Timestamp;
              }
            }
            break;
          case EventType.JOINS:
            {
              const joinLogs = await this.client.getJoinLogs();
              if (joinLogs && joinLogs.length > 0) {
                this.lastState.joinTime = joinLogs[0].Timestamp;
              }
            }
            break;
          case EventType.VEHICLES:
            {
              const vehicles = await this.client.getVehicles();
              this.lastState.vehicleSet = new Set(
                vehicles.map((v) => `${v.Owner}:${v.Name}`)
              );
            }
            break;
        }
      }
      this.lastState.initialized = true;
    } catch (err) {
      if (this.config.logErrors) {
        console.error('Failed to initialize state:', err);
      }
    }
  }

  /**
   * Poll for new events
   */
  async poll() {
    if (!this.running) return;

    const events = [];

    for (const eventType of this.eventTypes) {
      const event = await this.checkForChanges(eventType);
      if (event) {
        events.push(event);
      }
    }

    for (const event of events) {
      this.processEvent(event);
    }
  }

  /**
   * Check for changes in a specific event type
   * @param {string} eventType - The event type to check
   * @returns {Promise<Event|null>} The event if there were changes
   */
  async checkForChanges(eventType) {
    switch (eventType) {
      case EventType.PLAYERS:
        return this.checkPlayerChanges();
      case EventType.COMMANDS:
        return this.checkCommandChanges();
      case EventType.MODCALLS:
        return this.checkModCallChanges();
      case EventType.KILLS:
        return this.checkKillChanges();
      case EventType.JOINS:
        return this.checkJoinChanges();
      case EventType.VEHICLES:
        return this.checkVehicleChanges();
      default:
        return null;
    }
  }

  /**
   * Check for player changes
   * @returns {Promise<Event|null>}
   */
  async checkPlayerChanges() {
    const players = await this.client.getPlayers();
    const currentSet = new Set(players.map((p) => p.Player));
    const oldSet = this.lastState.players;

    const changes = [];

    for (const player of players) {
      if (!oldSet.has(player.Player)) {
        changes.push({
          player,
          type: 'join',
        });
      }
    }

    for (const playerName of oldSet) {
      if (!currentSet.has(playerName)) {
        changes.push({
          player: { Player: playerName },
          type: 'leave',
        });
      }
    }

    this.lastState.players = currentSet;

    return changes.length > 0
      ? {
          type: EventType.PLAYERS,
          data: changes,
        }
      : null;
  }

  /**
   * Check for command changes
   * @returns {Promise<Event|null>}
   */
  async checkCommandChanges() {
    const logs = await this.client.getCommandLogs();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.commandTime) {
      this.lastState.commandTime = latestTime;
      return {
        type: EventType.COMMANDS,
        data: logs.filter(
          (log) =>
            log.Timestamp >
            this.lastState.commandTime - this.config.pollInterval / 1000
        ),
      };
    }

    return null;
  }

  /**
   * Check for mod call changes
   * @returns {Promise<Event|null>}
   */
  async checkModCallChanges() {
    const logs = await this.client.getModCalls();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.modCallTime) {
      this.lastState.modCallTime = latestTime;
      return {
        type: EventType.MODCALLS,
        data: logs.filter(
          (log) =>
            log.Timestamp >
            this.lastState.modCallTime - this.config.pollInterval / 1000
        ),
      };
    }

    return null;
  }

  /**
   * Check for kill changes
   * @returns {Promise<Event|null>}
   */
  async checkKillChanges() {
    const logs = await this.client.getKillLogs();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.killTime) {
      this.lastState.killTime = latestTime;
      return {
        type: EventType.KILLS,
        data: logs.filter(
          (log) =>
            log.Timestamp >
            this.lastState.killTime - this.config.pollInterval / 1000
        ),
      };
    }

    return null;
  }

  /**
   * Check for join changes
   * @returns {Promise<Event|null>}
   */
  async checkJoinChanges() {
    const logs = await this.client.getJoinLogs();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.joinTime) {
      this.lastState.joinTime = latestTime;
      return {
        type: EventType.JOINS,
        data: logs.filter(
          (log) =>
            log.Timestamp >
            this.lastState.joinTime - this.config.pollInterval / 1000
        ),
      };
    }

    return null;
  }

  /**
   * Check for vehicle changes
   * @returns {Promise<Event|null>}
   */
  async checkVehicleChanges() {
    const vehicles = await this.client.getVehicles();
    const currentSet = new Set(vehicles.map((v) => `${v.Owner}:${v.Name}`));
    const oldSet = this.lastState.vehicleSet;

    const newVehicles = vehicles.filter((v) => {
      const key = `${v.Owner}:${v.Name}`;
      return !oldSet.has(key);
    });

    this.lastState.vehicleSet = currentSet;

    return newVehicles.length > 0
      ? {
          type: EventType.VEHICLES,
          data: newVehicles,
        }
      : null;
  }

  /**
   * Process an event through handlers
   * @param {Event} event - The event to process
   */
  processEvent(event) {
    if (this.config.filterFunc && !this.config.filterFunc(event)) {
      return;
    }

    switch (event.type) {
      case EventType.PLAYERS:
        if (this.handlers.playerHandler) {
          this.handlers.playerHandler(event.data);
        }
        break;
      case EventType.COMMANDS:
        if (this.handlers.commandHandler) {
          this.handlers.commandHandler(event.data);
        }
        break;
      case EventType.MODCALLS:
        if (this.handlers.modCallHandler) {
          this.handlers.modCallHandler(event.data);
        }
        break;
      case EventType.KILLS:
        if (this.handlers.killHandler) {
          this.handlers.killHandler(event.data);
        }
        break;
      case EventType.JOINS:
        if (this.handlers.joinHandler) {
          this.handlers.joinHandler(event.data);
        }
        break;
      case EventType.VEHICLES:
        if (this.handlers.vehicleHandler) {
          this.handlers.vehicleHandler(event.data);
        }
        break;
    }
  }
}

module.exports = { Subscription, getDefaultEventConfig };
