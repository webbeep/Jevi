export const THEME_KEY = 'zo-theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** A stored choice. Anything else, including a missing value, follows the system. */
export function parseThemeChoice(raw: string | null): ThemeChoice {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

export function resolvedDark(choice: ThemeChoice, systemDark: boolean): boolean {
  switch (choice) {
    case 'system': return systemDark;
    case 'light': return false;
    case 'dark': return true;
    default: {
      const unknown: never = choice;
      return unknown;
    }
  }
}
