import { createCache, type MemoryCache } from '../cache/index.js';
import { createLogger, type Logger } from '../logger/index.js';
import { EventBus, createEventBus, randomId } from '../utils/index.js';

export interface DiscordClientOptions {
  intents?: string[];
  logger?: Logger;
  cache?: MemoryCache<string, unknown>;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute: (interaction: unknown) => unknown | Promise<unknown>;
}

export interface DiscordClientEvents {
  ready: Client;
  messageCreate: unknown;
  interactionCreate: unknown;
  disconnect: void;
  error: unknown;
}

class GatewaySession {
  private readonly events = createEventBus<{ open: void; close: void; packet: unknown }>();

  async connect(token: string): Promise<void> {
    void token;
    await this.events.emit('open', undefined);
  }

  async close(): Promise<void> {
    await this.events.emit('close', undefined);
  }

  onPacket(handler: (packet: unknown) => void): () => void {
    return this.events.on('packet', handler);
  }
}

export class Client extends EventBus<DiscordClientEvents> {
  readonly id = randomId('discord');
  readonly intents: string[];
  readonly logger: Logger;
  readonly cache: MemoryCache<string, unknown>;
  readonly commands = new Map<string, SlashCommand>();
  readonly messageCommands = new Map<string, (message: unknown) => unknown | Promise<unknown>>();
  readonly session = new GatewaySession();

  constructor(options: DiscordClientOptions = {}) {
    super();
    this.intents = options.intents ?? [];
    this.logger = options.logger ?? createLogger({ scope: 'fastium:discord' });
    this.cache = options.cache ?? createCache<string, unknown>();
  }

  async login(token: string): Promise<string> {
    await this.session.connect(token);
    queueMicrotask(() => {
      void this.emit('ready', this);
    });
    return token;
  }

  async destroy(): Promise<void> {
    await this.session.close();
    await this.emit('disconnect', undefined);
  }

  registerSlashCommand(command: SlashCommand): this {
    this.commands.set(command.name, command);
    return this;
  }

  registerMessageCommand(name: string, handler: (message: unknown) => unknown | Promise<unknown>): this {
    this.messageCommands.set(name, handler);
    return this;
  }

  async dispatchInteraction(interaction: { type: string; name?: string; commandName?: string; payload?: unknown }): Promise<unknown> {
    if (interaction.type === 'slash' && interaction.name && this.commands.has(interaction.name)) {
      const command = this.commands.get(interaction.name);
      return command?.execute(interaction);
    }

    if (interaction.type === 'message' && interaction.commandName && this.messageCommands.has(interaction.commandName)) {
      const handler = this.messageCommands.get(interaction.commandName);
      return handler?.(interaction.payload);
    }

    return undefined;
  }

  reloadHandlers(): void {
    this.logger.info('Fastium Discord handlers reloaded', { commands: this.commands.size, messageCommands: this.messageCommands.size });
  }
}

export const createDiscordClient = (options: DiscordClientOptions = {}) => new Client(options);

export const createEmbed = (title: string, description = '') => ({ title, description, fields: [] as Array<{ name: string; value: string }> });
export const createButton = (label: string, customId = randomId('button')) => ({ type: 'button', label, customId });
export const createModal = (title: string, customId = randomId('modal')) => ({ title, customId, fields: [] as Array<{ label: string; value: string }> });