/** Shared endpoint resolution for both local executable entry points. */
export const DEFAULT_API_BASE =
  'https://us-central1-ham-radio-app-b818d.cloudfunctions.net/cliApi';

export function resolveApiBase(explicit?: string): string {
  return explicit || process.env.HAMTRAX_API_BASE || DEFAULT_API_BASE;
}
