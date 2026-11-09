export class CliError extends Error {
  installed?: string[];
  skillDiscoveryPending?: boolean;
  constructor(message: string, public code: 1 | 2 | 3, public fix = "run loadouts help") {
    super(message);
  }
}
