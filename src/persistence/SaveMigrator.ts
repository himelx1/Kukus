import { CoreEngine } from '../core/CoreEngine';
import { SCHEMA_VERSION, WorldEngineState } from '../core/GameState';

export class SaveMigrator {
  public static migrate(raw: unknown): { ok: boolean; state?: WorldEngineState; error?: string } {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Malformed save payload' };
    }
    const candidate = raw as Partial<WorldEngineState>;
    const version = candidate.schemaVersion ?? 0;

    if (version > SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Save schema v${version} is newer than app v${SCHEMA_VERSION}. Please update KUKUS.`,
      };
    }

    // Merge forward onto a clean initial state to guarantee new fields exist
    const seed = typeof candidate.worldSeed === 'number' ? candidate.worldSeed : 12345;
    const base = CoreEngine.createInitialState(seed);

    const migrated: WorldEngineState = {
      ...base,
      ...candidate,
      schemaVersion: SCHEMA_VERSION,
      resources: { ...base.resources, ...(candidate.resources ?? {}) },
      capacities: { ...base.capacities, ...(candidate.capacities ?? {}) },
      marketPrices: { ...base.marketPrices, ...(candidate.marketPrices ?? {}) },
      population: {
        ...base.population,
        ...(candidate.population ?? {}),
        classes: { ...base.population.classes, ...(candidate.population?.classes ?? {}) },
        needs: { ...base.population.needs, ...(candidate.population?.needs ?? {}) },
      },
      environment: { ...base.environment, ...(candidate.environment ?? {}) },
      stats: { ...base.stats, ...(candidate.stats ?? {}) },
      settings: { ...base.settings, ...(candidate.settings ?? {}) },
      camera: { ...base.camera, ...(candidate.camera ?? {}) },
      activePolicies: Array.isArray(candidate.activePolicies) ? candidate.activePolicies : [],
    };

    return { ok: true, state: migrated };
  }
}
