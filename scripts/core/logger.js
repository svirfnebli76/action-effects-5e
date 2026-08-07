import { MODULE_ID, MODULE_TITLE, SETTINGS } from "./constants.js";

export class Logger {
  static #prefix = `${MODULE_TITLE} |`;

  static get debugEnabled() {
    try {
      return Boolean(game?.settings?.get(MODULE_ID, SETTINGS.DEBUG_LOGGING));
    } catch {
      return false;
    }
  }

  static log(...args) {
    console.log(this.#prefix, ...args);
  }

  static info(...args) {
    console.info(this.#prefix, ...args);
  }

  static warn(...args) {
    console.warn(this.#prefix, ...args);
  }

  static error(...args) {
    console.error(this.#prefix, ...args);
  }

  static debug(...args) {
    if (this.debugEnabled) console.debug(this.#prefix, ...args);
  }
}
