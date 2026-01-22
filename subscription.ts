import { EventType } from './types.js';

interface EventConfig {
  pollInterval?: number;
  bufferSize?: number;
  retryOnError?: boolean;
  retryInterval?: number;
  includeInitialState?: boolean;
  batchEvents?: boolean;
  batchWindow?: number;
  logErrors?: boolean;
  timeFormat?: string;
  filterFunc?: (event: any) => boolean;
  errorHandler?: (error: Error) => void;
}

function getDefaultEventConfig(): EventConfig {
  return {
    pollInterval: 2000,
    bufferSize: 100,
    retryOnError: true,
    retryInterval: 5000,
    includeInitialState: false,
    batchEvents: false,
    batchWindow: 100,
    logErrors: false,
    timeFormat: 'ISO',
  };
}

interface HandlerRegistration {
  playerHandler?: (data: any) => void;
  commandHandler?: (data: any) => void;
  modCallHandler?: (data: any) => void;
  killHandler?: (data: any) => void;
  joinHandler?: (data: any) => void;
  vehicleHandler?: (data: any) => void;
}

interface SubscriptionState {
  players: Set<string>;
  commandTime: number;
  modCallTime: number;
  killTime: number;
  joinTime: number;
  vehicleSet: Set<string>;
  initialized: boolean;
}

interface Event {
  type: string;
  data: any;
}

class Subscription {
  private client: any;
  private config: EventConfig;
  private eventTypes: string[];
  private handlers: HandlerRegistration;
  private running: boolean;
  private pollInterval: NodeJS.Timeout | null;
  private eventQueue: Event[];
  private pollInFlight: boolean;
  private nextAllowedPollAt: number;
  private lastState: SubscriptionState;

  constructor(client: any, config: EventConfig, eventTypes: string[]) {
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

  handle(handlers: HandlerRegistration): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  async start(): Promise<void> {
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

  stop(): void {
    this.running = false;

    this.pollInFlight = false;
    this.nextAllowedPollAt = 0;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  close(): void {
    this.stop();
  }

  async initializeState(): Promise<void> {
    try {
      for (const eventType of this.eventTypes) {
        switch (eventType) {
          case EventType.PLAYERS:
            if (this.handlers.playerHandler) {
              const players = await this.client.getPlayers();
              this.lastState.players = new Set(
                players.map((p: any) => p.Player)
              );
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
                vehicles.map((v: any) => `${v.Owner}:${v.Name}`)
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

  async poll(): Promise<void> {
    if (!this.running) return;

    const events: Event[] = [];

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

  async checkForChanges(eventType: string): Promise<Event | null> {
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

  async checkPlayerChanges(): Promise<Event | null> {
    const players = await this.client.getPlayers();
    const currentSet = new Set<string>(players.map((p: any) => p.Player));
    const oldSet = this.lastState.players;

    const changes: any[] = [];

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

  async checkCommandChanges(): Promise<Event | null> {
    const logs = await this.client.getCommandLogs();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.commandTime) {
      this.lastState.commandTime = latestTime;
      return {
        type: EventType.COMMANDS,
        data: logs.filter(
          (log: any) =>
            log.Timestamp >
            this.lastState.commandTime -
              (this.config.pollInterval || 2000) / 1000
        ),
      };
    }

    return null;
  }

  async checkModCallChanges(): Promise<Event | null> {
    const logs = await this.client.getModCalls();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.modCallTime) {
      this.lastState.modCallTime = latestTime;
      return {
        type: EventType.MODCALLS,
        data: logs.filter(
          (log: any) =>
            log.Timestamp >
            this.lastState.modCallTime -
              (this.config.pollInterval || 2000) / 1000
        ),
      };
    }

    return null;
  }

  async checkKillChanges(): Promise<Event | null> {
    const logs = await this.client.getKillLogs();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.killTime) {
      this.lastState.killTime = latestTime;
      return {
        type: EventType.KILLS,
        data: logs.filter(
          (log: any) =>
            log.Timestamp >
            this.lastState.killTime - (this.config.pollInterval || 2000) / 1000
        ),
      };
    }

    return null;
  }

  async checkJoinChanges(): Promise<Event | null> {
    const logs = await this.client.getJoinLogs();
    if (!logs || logs.length === 0) return null;

    const latestTime = logs[0].Timestamp;
    if (latestTime > this.lastState.joinTime) {
      this.lastState.joinTime = latestTime;
      return {
        type: EventType.JOINS,
        data: logs.filter(
          (log: any) =>
            log.Timestamp >
            this.lastState.joinTime - (this.config.pollInterval || 2000) / 1000
        ),
      };
    }

    return null;
  }

  async checkVehicleChanges(): Promise<Event | null> {
    const vehicles = await this.client.getVehicles();
    const currentSet = new Set<string>(
      vehicles.map((v: any) => `${v.Owner}:${v.Name}`)
    );
    const oldSet = this.lastState.vehicleSet;

    const newVehicles = vehicles.filter((v: any) => {
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

  processEvent(event: Event): void {
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

export { Subscription, getDefaultEventConfig };
