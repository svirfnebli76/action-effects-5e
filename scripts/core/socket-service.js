import { MODULE_ID } from "./constants.js";
import { Logger } from "./logger.js";

export class SocketService {
  #socket = null;
  #registrations = new Map();
  #hookId = null;

  initialize() {
    if (this.#hookId !== null || this.#socket) return;

    this.#hookId = Hooks.once("socketlib.ready", () => {
      this.#hookId = null;

      if (!globalThis.socketlib?.registerModule) {
        Logger.error("Socketlib reported ready, but its public API is unavailable.");
        return;
      }

      this.#socket = globalThis.socketlib.registerModule(MODULE_ID);
      for (const [name, handler] of this.#registrations) {
        this.#socket.register(name, handler);
      }
      Logger.info(`Registered ${this.#registrations.size} Socketlib handlers.`);
    });
  }

  register(name, handler) {
    if (typeof name !== "string" || !name.length) throw new TypeError("Socket handler name must be a non-empty string.");
    if (typeof handler !== "function") throw new TypeError(`Socket handler '${name}' must be a function.`);
    if (this.#registrations.has(name)) throw new Error(`Socket handler '${name}' is already registered.`);

    this.#registrations.set(name, handler);
    if (this.#socket) this.#socket.register(name, handler);
  }

  get ready() {
    return Boolean(this.#socket);
  }

  async executeAsGM(name, ...args) {
    if (game.user.isGM) {
      const handler = this.#getHandler(name);
      return handler(...args);
    }

    this.#assertReady();
    return this.#socket.executeAsGM(name, ...args);
  }

  async executeAsUser(name, userId, ...args) {
    if (!userId) throw new TypeError("A target user ID is required.");
    if (game.user?.id === userId) {
      const handler = this.#getHandler(name);
      return handler(...args);
    }

    this.#assertReady();
    return this.#socket.executeAsUser(name, userId, ...args);
  }

  async executeForUsers(name, userIds, ...args) {
    const recipients = [...new Set((userIds ?? []).filter(Boolean))];
    if (!recipients.length) return;
    this.#assertReady();
    return this.#socket.executeForUsers(name, recipients, ...args);
  }

  async executeForEveryone(name, ...args) {
    this.#assertReady();
    return this.#socket.executeForEveryone(name, ...args);
  }

  getRegisteredNames() {
    return [...this.#registrations.keys()];
  }

  #getHandler(name) {
    const handler = this.#registrations.get(name);
    if (!handler) throw new Error(`Unknown Action Effects 5E socket handler '${name}'.`);
    return handler;
  }

  #assertReady() {
    if (!this.#socket) throw new Error("Action Effects 5E Socketlib API is not ready.");
  }
}
