/** Immutable capability routing. M1 alone owns executions, queues and retained results. */
import { JobError } from "./job-service.js";
import { AI_CAPABILITIES, AI_CONTRACTS } from "./ai-capabilities.js";

function snapshot(value, depth = 0, budget = { nodes: 0, units: 0 }) {
  if (++budget.nodes > 2048 || depth > 8) throw new JobError("invalid-provider-configuration", "Provider configuration is too complex.");
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 4096 && (budget.units += value.length) <= 32768) return value;
  if (Array.isArray(value) && value.length <= 64) return Object.freeze(value.map(item => snapshot(item, depth + 1, budget)));
  if (value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 64) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, depth + 1, budget)])));
  throw new JobError("invalid-provider-configuration", "Provider configuration must contain bounded primitive metadata.");
}
export class AIProviderRegistry {
  #providers = new Map(); #bindings; #contracts;
  constructor(providers = [], bindings = {}, contracts = AI_CONTRACTS) {
    this.#bindings = snapshot(bindings); this.#contracts = Object.freeze({ ...contracts });
    for (const provider of providers) {
      if (!provider || typeof provider.id !== "string" || !provider.id || this.#providers.has(provider.id)) throw new JobError("invalid-provider-registration", "Provider identifiers must be unique and nonempty.");
      const capabilities = {};
      for (const [capability, handler] of Object.entries(provider.capabilities || {})) {
        if (!Object.values(AI_CAPABILITIES).includes(capability) || !this.#contracts[capability]
          || !["configure", "describe", "check", "start"].every(key => typeof handler?.[key] === "function")) throw new JobError("invalid-provider-registration", "A provider capability requires a contract, configuration, readiness and execution handler.");
        capabilities[capability] = Object.freeze({ ...handler, support: snapshot(handler.support || {}) });
      }
      this.#providers.set(provider.id, Object.freeze({ id: provider.id, label: provider.label || provider.id, capabilities: Object.freeze(capabilities) }));
    }
  }
  discover() {
    return Object.freeze([...this.#providers.values()].map(provider => Object.freeze({ id: provider.id, label: provider.label,
      capabilities: Object.freeze(Object.keys(provider.capabilities)), support: Object.freeze(Object.fromEntries(Object.entries(provider.capabilities).map(([key, handler]) => [key, handler.support]))) })));
  }
  #handler(capability, selection) {
    if (!Object.values(AI_CAPABILITIES).includes(capability)) throw new JobError("unsupported-capability", "Unknown AI capability.");
    const providerId = selection?.providerId ?? this.#bindings[capability];
    const provider = this.#providers.get(providerId);
    if (!provider) throw new JobError("missing-provider", "No registered provider is selected for this AI capability.");
    const handler = provider.capabilities[capability];
    if (!handler) throw new JobError("unsupported-capability", "The selected provider does not support this AI capability.");
    return { provider, handler };
  }
  resolve(capability, selection, input) {
    const { provider, handler } = this.#handler(capability, selection);
    const configuration = snapshot(handler.configure(snapshot(selection?.configuration ?? null)));
    if (input !== undefined) {
      this.#contracts[capability].validateInput(input);
      handler.validateInput?.(input, configuration);
    }
    const profile = snapshot(handler.describe(configuration, input));
    return Object.freeze({ providerId: provider.id, label: provider.label, capability, configured: true, availability: "unchecked", configuration, profile, support: handler.support });
  }
  inspect(capability, selection, input) {
    try { return this.resolve(capability, selection, input); }
    catch (error) { return Object.freeze({ capability, providerId: selection?.providerId ?? this.#bindings[capability] ?? null, configured: false, availability: "unchecked", error: Object.freeze({ code: error.code || "invalid-provider-configuration", message: error.message }) }); }
  }
  /** Explicit user action only. Never cached; execution still validates the backend. */
  async check(capability, selection) {
    const resolved = this.resolve(capability, selection), { handler } = this.#handler(capability, resolved);
    const info = await handler.check(resolved.configuration);
    if (info?.ready !== true) throw new JobError("provider-unavailable", "The selected AI provider is unavailable.");
    return Object.freeze({ ...resolved, availability: "available", version: info.version, model: info.model });
  }
  request(capability, selection, input) {
    const resolved = this.resolve(capability, selection, input);
    return { providerId: resolved.providerId, configuration: resolved.configuration, input };
  }
  /** Existing M1 port, stateless across submissions. Each copied request pins its selection. */
  port(capability) {
    const contract = this.#contracts[capability];
    if (!contract) throw new JobError("unsupported-capability", "This capability has no implemented pixel contract.");
    return Object.freeze({
      validateInput: request => { this.resolve(capability, request, request?.input); return contract.validateInput(request.input); },
      copyResult: result => contract.copyResult(result.output),
      disposeResult: result => { this.#providers.get(result.providerId)?.capabilities[capability]?.disposeResult?.(result.output); },
      start: (request, callbacks, identity) => {
        const resolved = this.resolve(capability, request, request.input), { handler } = this.#handler(capability, resolved);
        return handler.start(request.input, resolved.configuration, { ...callbacks, complete: output => callbacks.complete({ providerId: resolved.providerId, output }) }, identity);
      },
    });
  }
}
