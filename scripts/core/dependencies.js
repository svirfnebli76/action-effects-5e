import {
  MODULE_ID,
  MODULE_TITLE,
  REQUIRED_MODULES
} from "./constants.js";
import { Logger } from "./logger.js";

export class DependencyService {
  getStatus() {
    const generation = Number(game?.release?.generation ?? game?.version?.split?.(".")?.[0] ?? 0);
    const required = REQUIRED_MODULES.map((id) => {
      const module = game.modules.get(id);
      return {
        id,
        installed: Boolean(module),
        active: Boolean(module?.active),
        version: module?.version ?? null
      };
    });

    return {
      foundry: {
        generation,
        version: game?.version ?? game?.release?.version ?? null,
        supported: generation >= 14
      },
      system: {
        id: game?.system?.id ?? null,
        version: game?.system?.version ?? null,
        supported: game?.system?.id === "dnd5e"
      },
      required,
      healthy: generation >= 14
        && game?.system?.id === "dnd5e"
        && required.every((entry) => entry.active)
    };
  }

  validate({ notify = true } = {}) {
    const status = this.getStatus();
    const problems = [];

    if (!status.foundry.supported) {
      problems.push(`Foundry VTT v14+ is required; detected ${status.foundry.version ?? "unknown"}.`);
    }

    if (!status.system.supported) {
      problems.push(`The dnd5e system is required; detected ${status.system.id ?? "none"}.`);
    }

    for (const dependency of status.required) {
      if (!dependency.active) problems.push(`Required module '${dependency.id}' is not active.`);
    }

    if (problems.length) {
      Logger.error("Dependency validation failed", problems);
      if (notify && ui?.notifications) {
        ui.notifications.error(`${MODULE_TITLE}: ${problems.join(" ")}`, { permanent: true });
      }
    } else {
      Logger.info(`v${game.modules.get(MODULE_ID)?.version ?? "unknown"} dependencies validated.`);
    }

    return { ...status, problems };
  }
}
