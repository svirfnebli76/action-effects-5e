import { MODULE_ID } from "./constants.js";
import { Logger } from "./logger.js";

export class SocketService {
  #socket = null;
  #registrations = new Map();
  #hookId = null;

  initialize() {
    if (this.#hookId !== null || this.#socket) return;

    this.#hookId = Hooks.once("socketlib.ready", () => {
      this.#socket = socketlib.registerModule(MODULE_ID);
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
      const handler = this.#registrations.get(name);
      if (!handler) throw new Error(`Unknown Action Effects 5E socket handler '${name}'.`);
      return handler(...args);
    }

    if (!this.#socket) throw new Error("Action Effects 5E Socketlib API is not ready.");
    return this.#socket.executeAsGM(name, ...args);
  }
}
