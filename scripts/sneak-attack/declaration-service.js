import {
  MODULE_ID,
  SNEAK_ATTACK_DECLARATION_SCHEMA_VERSION,
  SNEAK_ATTACK_DECLARATION_TYPES
} from "../core/constants.js";

const SUPPORTED_TYPES = new Set(Object.values(SNEAK_ATTACK_DECLARATION_TYPES));

function isNonemptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function itemIdentifier(item) {
  const value = item?.identifier ?? item?.system?.identifier ?? null;
  return isNonemptyString(value) ? value.trim() : null;
}

function itemSnapshot(item) {
  if (!item) return null;
  return {
    id: item.id ?? item._id ?? null,
    uuid: item.uuid ?? null,
    name: item.name ?? null,
    identifier: itemIdentifier(item)
  };
}

function diagnostic(code, message, record = null, extra = {}) {
  return {
    severity: "error",
    code,
    message,
    actor: record?.snapshot?.actor ?? null,
    effect: record?.snapshot?.effect ?? null,
    declarationValue: record?.value ?? null,
    ...extra
  };
}

function declarationSort(a, b) {
  const aLevel = Number.isFinite(a?.declaration?.level) ? a.declaration.level : Number.POSITIVE_INFINITY;
  const bLevel = Number.isFinite(b?.declaration?.level) ? b.declaration.level : Number.POSITIVE_INFINITY;
  if (aLevel !== bLevel) return aLevel - bLevel;

  const aOrder = Number.isFinite(a?.declaration?.order) ? a.declaration.order : Number.POSITIVE_INFINITY;
  const bOrder = Number.isFinite(b?.declaration?.order) ? b.declaration.order : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder - bOrder;

  return String(a?.declaration?.id ?? "").localeCompare(String(b?.declaration?.id ?? ""));
}

/**
 * Orchestrates the Phase-A Sneak Attack declaration pipeline:
 * Active Effect change -> parser -> DAE provenance -> CAT provider validation
 * -> generic declaration contract -> stable ordering/conflict diagnostics.
 */
export class SneakAttackDeclarationService {
  #dae;
  #parser;
  #catAutomation;
  #stats = {
    compileCalls: 0,
    scannedRecords: 0,
    parsedDeclarations: 0,
    acceptedDeclarations: 0,
    rejectedDeclarations: 0,
    providerMismatches: 0,
    duplicateIds: 0,
    dependencyErrors: 0
  };

  constructor({ dae, parser, catAutomation }) {
    this.#dae = dae;
    this.#parser = parser;
    this.#catAutomation = catAutomation;
  }

  initialize() {
    return this.#dae.initialize();
  }

  parse(value) {
    return this.#parser.parse(value);
  }

  scanActor(actor) {
    return this.#dae.scanActor(actor);
  }

  async resolveProvenance(effect, actor) {
    const source = await this.#dae.resolveSourceItem(effect, actor);
    if (!source.resolved) return { resolved: false, reason: source.reason, error: source.error ?? null };

    const provider = this.#catAutomation.getProviderState(source.item, { expectedSource: MODULE_ID });
    return {
      resolved: true,
      sourceItem: source.item,
      sourceItemIdentifier: itemIdentifier(source.item),
      catAutomation: provider.automation,
      catSource: provider.source,
      providerAvailable: provider.available,
      providerMatches: provider.matchesExpectedSource,
      providerReason: provider.reason,
      providerError: provider.error ?? null
    };
  }

  async compileActor(actor) {
    this.#stats.compileCalls += 1;
    const rawRecords = this.scanActor(actor);
    this.#stats.scannedRecords += rawRecords.length;
    const diagnostics = [];
    const declarations = [];
    const rejected = [];

    for (const record of rawRecords) {
      const parsed = this.parse(record.value);
      if (!parsed.ok) {
        const recordDiagnostics = parsed.diagnostics.map(entry => diagnostic(
          entry.code,
          entry.message,
          record,
          { parser: entry }
        ));
        diagnostics.push(...recordDiagnostics);
        rejected.push({ record, stage: "parse", diagnostics: recordDiagnostics });
        this.#stats.rejectedDeclarations += 1;
        continue;
      }
      this.#stats.parsedDeclarations += 1;

      const contractDiagnostics = this.#validateContract(parsed.declaration, record);
      if (contractDiagnostics.length) {
        diagnostics.push(...contractDiagnostics);
        rejected.push({ record, declaration: parsed.declaration, stage: "contract", diagnostics: contractDiagnostics });
        this.#stats.rejectedDeclarations += 1;
        continue;
      }

      const provenance = await this.resolveProvenance(record.effect, actor);
      if (!provenance.resolved) {
        const entry = diagnostic(
          provenance.reason ?? "source-item-unavailable",
          "Could not resolve the declaration's originating Item through DAE.",
          record,
          { declarationId: parsed.declaration.id }
        );
        diagnostics.push(entry);
        rejected.push({ record, declaration: parsed.declaration, stage: "provenance", diagnostics: [entry] });
        this.#stats.dependencyErrors += 1;
        this.#stats.rejectedDeclarations += 1;
        continue;
      }

      if (!provenance.providerAvailable) {
        const entry = diagnostic(
          provenance.providerReason ?? "cat-provider-validation-unavailable",
          "CAT current-provider validation is unavailable for the declaration source Item.",
          record,
          {
            declarationId: parsed.declaration.id,
            sourceItem: itemSnapshot(provenance.sourceItem)
          }
        );
        diagnostics.push(entry);
        rejected.push({ record, declaration: parsed.declaration, provenance, stage: "provider", diagnostics: [entry] });
        this.#stats.dependencyErrors += 1;
        this.#stats.rejectedDeclarations += 1;
        continue;
      }

      if (!provenance.providerMatches) {
        const entry = diagnostic(
          "cat-provider-family-mismatch",
          `Declaration source Item is currently owned by CAT provider '${provenance.catSource ?? "none"}', not '${MODULE_ID}'.`,
          record,
          {
            declarationId: parsed.declaration.id,
            sourceItem: itemSnapshot(provenance.sourceItem),
            catProvider: provenance.catSource ?? null
          }
        );
        diagnostics.push(entry);
        rejected.push({ record, declaration: parsed.declaration, provenance, stage: "provider", diagnostics: [entry] });
        this.#stats.providerMismatches += 1;
        this.#stats.rejectedDeclarations += 1;
        continue;
      }

      declarations.push({
        declaration: parsed.declaration,
        provenance: {
          effect: record.effect,
          sourceItem: provenance.sourceItem,
          sourceItemIdentifier: provenance.sourceItemIdentifier,
          catAutomation: provenance.catAutomation,
          catSource: provenance.catSource
        },
        transport: {
          change: record.change,
          changeIndex: record.changeIndex,
          value: record.value,
          snapshot: record.snapshot
        }
      });
    }

    const accepted = this.#applySetValidation(declarations, diagnostics, rejected);
    accepted.sort(declarationSort);
    this.#stats.acceptedDeclarations += accepted.length;

    return {
      ok: diagnostics.length === 0,
      actor,
      declarations: accepted,
      rejected,
      diagnostics,
      summary: {
        scanned: rawRecords.length,
        accepted: accepted.length,
        rejected: rejected.length,
        errors: diagnostics.length
      }
    };
  }

  getStatus() {
    return Object.freeze({
      schemaVersion: SNEAK_ATTACK_DECLARATION_SCHEMA_VERSION,
      declarationTypes: Object.freeze([...SUPPORTED_TYPES]),
      dae: this.#dae.getStatus(),
      cat: this.#catAutomation.getStatus()
    });
  }

  getStats() {
    return Object.freeze({
      ...this.#stats,
      dae: this.#dae.getStats(),
      cat: this.#catAutomation.getStats()
    });
  }

  #validateContract(declaration, record) {
    const diagnostics = [];
    if (!isNonemptyString(declaration?.type)) {
      diagnostics.push(diagnostic("missing-declaration-type", "Declaration requires a non-empty type field.", record));
    } else if (!SUPPORTED_TYPES.has(declaration.type)) {
      diagnostics.push(diagnostic(
        "unsupported-declaration-type",
        `Unsupported Sneak Attack declaration type '${declaration.type}'.`,
        record,
        { declarationType: declaration.type }
      ));
    }

    if (!isNonemptyString(declaration?.id)) {
      diagnostics.push(diagnostic("missing-declaration-id", "Declaration requires a non-empty semantic id field.", record));
    }

    if (declaration?.schema !== undefined && declaration.schema !== SNEAK_ATTACK_DECLARATION_SCHEMA_VERSION) {
      diagnostics.push(diagnostic(
        "unsupported-declaration-schema",
        `Declaration schema '${declaration.schema}' is not supported; expected '${SNEAK_ATTACK_DECLARATION_SCHEMA_VERSION}'.`,
        record,
        { declarationId: declaration?.id ?? null, schema: declaration.schema }
      ));
    }

    for (const field of ["level", "order"]) {
      if (declaration?.[field] !== undefined && (!Number.isFinite(declaration[field]) || declaration[field] < 0)) {
        diagnostics.push(diagnostic(
          `invalid-${field}`,
          `Declaration field '${field}' must be a non-negative finite number when supplied.`,
          record,
          { declarationId: declaration?.id ?? null, field, value: declaration[field] }
        ));
      }
    }

    if (declaration?.cost !== undefined && (!Number.isFinite(declaration.cost) || declaration.cost < 0)) {
      diagnostics.push(diagnostic(
        "invalid-cost",
        "Declaration field 'cost' must be a non-negative finite number when supplied.",
        record,
        { declarationId: declaration?.id ?? null, value: declaration.cost }
      ));
    }

    if (declaration?.type === SNEAK_ATTACK_DECLARATION_TYPES.OPTION_MODIFIER && !isNonemptyString(declaration?.modifies)) {
      diagnostics.push(diagnostic(
        "missing-modifies",
        "An optionModifier declaration requires a non-empty modifies field.",
        record,
        { declarationId: declaration?.id ?? null }
      ));
    }

    if (declaration?.executor === "activity" && !isNonemptyString(declaration?.activity)) {
      diagnostics.push(diagnostic(
        "missing-activity-identifier",
        "An activity executor requires a stable activity identifier.",
        record,
        { declarationId: declaration?.id ?? null }
      ));
    }

    return diagnostics;
  }

  #applySetValidation(declarations, diagnostics, rejected) {
    const rejectedEntries = new Set();
    const byId = new Map();

    for (const entry of declarations) {
      const id = entry.declaration.id;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, entry);
        continue;
      }

      this.#stats.duplicateIds += 1;
      for (const duplicate of [existing, entry]) {
        if (rejectedEntries.has(duplicate)) continue;
        const record = {
          snapshot: duplicate.transport.snapshot ?? { actor: null, effect: null },
          value: duplicate.transport.value
        };
        const diag = diagnostic(
          "duplicate-declaration-id",
          `Semantic declaration id '${id}' is ambiguous because it is declared more than once.`,
          record,
          {
            declarationId: id,
            sourceItem: itemSnapshot(duplicate.provenance.sourceItem)
          }
        );
        diagnostics.push(diag);
        rejected.push({ declaration: duplicate.declaration, provenance: duplicate.provenance, stage: "set-validation", diagnostics: [diag] });
        rejectedEntries.add(duplicate);
        this.#stats.rejectedDeclarations += 1;
      }
    }

    const options = new Set(
      declarations
        .filter(entry => !rejectedEntries.has(entry) && entry.declaration.type === SNEAK_ATTACK_DECLARATION_TYPES.OPTION)
        .map(entry => entry.declaration.id)
    );

    for (const entry of declarations) {
      if (rejectedEntries.has(entry)) continue;
      if (entry.declaration.type !== SNEAK_ATTACK_DECLARATION_TYPES.OPTION_MODIFIER) continue;
      if (options.has(entry.declaration.modifies)) continue;

      const record = {
        snapshot: entry.transport.snapshot ?? { actor: null, effect: null },
        value: entry.transport.value
      };
      const diag = diagnostic(
        "missing-modified-option",
        `Option modifier '${entry.declaration.id}' refers to missing option '${entry.declaration.modifies}'.`,
        record,
        {
          declarationId: entry.declaration.id,
          modifies: entry.declaration.modifies,
          sourceItem: itemSnapshot(entry.provenance.sourceItem)
        }
      );
      diagnostics.push(diag);
      rejected.push({ declaration: entry.declaration, provenance: entry.provenance, stage: "set-validation", diagnostics: [diag] });
      rejectedEntries.add(entry);
      this.#stats.rejectedDeclarations += 1;
    }

    return declarations.filter(entry => !rejectedEntries.has(entry));
  }
}
