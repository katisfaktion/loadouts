export class CliError extends Error {
  installed?: string[];
  skillDiscoveryPending?: boolean;
  replacements?: {name: string; oldSource: string; newSource: string}[];
  constructor(message: string, public code: 1 | 2 | 3, public fix = "run loadouts help", public id = code === 2 ? "usage_error" : code === 3 ? "environment_missing" : "operation_failed") {
    super(message);
  }
}
