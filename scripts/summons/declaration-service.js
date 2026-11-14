/** Read-only access to the single summon declaration on a source Item. */
export class SummonDeclarationService {
  #collections;
  #stats = {
    reads: 0,
    enabled: 0,
    invalid: 0
  };

  constructor({ collections }) {
    this.#collections = collections;
  }

  read(item) {
    this.#stats.reads += 1;
    const collection = this.#collections.read(item, "summon");
    if (!collection.valid) {
      this.#stats.invalid += 1;
      return {
        ...collection,
        enabled: false,
        declaration: null
      };
    }
    if (collection.absent) {
      return {
        ...collection,
        enabled: false,
        declaration: null
      };
    }
    if (collection.records.length !== 1) {
      this.#stats.invalid += 1;
      return {
        ...collection,
        valid: false,
        enabled: false,
        declaration: null,
        issues: [...collection.issues, "A summoning Item must contain exactly one summon declaration."]
      };
    }
    this.#stats.enabled += 1;
    return {
      ...collection,
      enabled: true,
      declaration: collection.records[0]
    };
  }

  getStats() {
    return { ...this.#stats };
  }
}
