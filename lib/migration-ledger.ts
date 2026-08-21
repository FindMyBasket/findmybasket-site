// Comparison logic for the migration-ledger standing check (work-list item 235).
//
// Kept separate from scripts/migration-ledger-check.mjs, as lib/brand-hub-programmes.ts
// is from its runner, so the part that decides what counts as a finding is testable
// without credentials, a network, or a repository checkout.
//
// THE ONE IDEA HERE IS SET MEMBERSHIP AGAINST A FROZEN BASELINE, NOT COUNTS.
// See the script header for why a count cannot do this job.

export interface DivergenceInput {
  /** Versions parsed from local supabase/migrations/*.sql filenames. */
  localVersions: Iterable<string>;
  /** Versions recorded in supabase_migrations.schema_migrations. */
  ledgerVersions: Iterable<string>;
  /** Accepted local-only population, frozen at baseline capture. */
  baselineLocalOnly: Iterable<string>;
  /** Accepted remote-only population, frozen at baseline capture. */
  baselineRemoteOnly: Iterable<string>;
}

export interface DivergenceResult {
  /** Divergent right now — includes the accepted baseline. */
  localOnly: string[];
  remoteOnly: string[];
  /** Divergent AND absent from the baseline. These are the findings. */
  newLocalOnly: string[];
  newRemoteOnly: string[];
  /** Baseline entries that are no longer divergent. Progress, never a finding. */
  reconciled: string[];
}

const set = (it: Iterable<string>) => new Set([...it].map(String));

export function classifyDivergence(input: DivergenceInput): DivergenceResult {
  const local = set(input.localVersions);
  const ledger = set(input.ledgerVersions);
  const baseLocal = set(input.baselineLocalOnly);
  const baseRemote = set(input.baselineRemoteOnly);

  const localOnly = [...local].filter((v) => !ledger.has(v)).sort();
  const remoteOnly = [...ledger].filter((v) => !local.has(v)).sort();

  const localOnlySet = new Set(localOnly);
  const remoteOnlySet = new Set(remoteOnly);

  return {
    localOnly,
    remoteOnly,
    // A NEW divergence is one the baseline does not name. Not "more than before" --
    // the count can stay flat while one is added and another reconciled.
    newLocalOnly: localOnly.filter((v) => !baseLocal.has(v)),
    newRemoteOnly: remoteOnly.filter((v) => !baseRemote.has(v)),
    // Shrinking is expected and silent.
    reconciled: [
      ...[...baseLocal].filter((v) => !localOnlySet.has(v)),
      ...[...baseRemote].filter((v) => !remoteOnlySet.has(v)),
    ].sort(),
  };
}
