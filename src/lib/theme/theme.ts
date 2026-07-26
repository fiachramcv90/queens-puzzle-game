/**
 * Light / dark / follow-the-system, as a player preference.
 *
 * The app already rendered correctly in both schemes, but only ever obeyed the OS.
 * That is the right default and the wrong only-option: a player on a dark phone may
 * still want a light board in daylight, and someone testing the app needs to see
 * both without changing a system setting.
 *
 * Three states, not two. A plain light/dark switch has no way back to "whatever my
 * phone is doing", so a player who flips it once is pinned forever and their evening
 * auto-dark stops working. `system` is the default and stays reachable.
 *
 * The preference is stored PER DEVICE and deliberately not synced to the profile,
 * unlike palette and region labels. Those describe how a player needs to read a
 * board and should follow them everywhere; this one describes the device they are
 * holding, and copying a phone's dark choice onto a desktop is more likely wrong
 * than right.
 */

/** The stored preference. `system` defers to `prefers-color-scheme`. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Its own key, separate from the guest blob — see `applyTheme` for why. */
export const THEME_KEY = 'queens:theme:v1';

export const THEME_OPTIONS: readonly { id: ThemePreference; label: string; icon: string }[] = [
	{ id: 'system', label: 'System', icon: '🖥️' },
	{ id: 'light', label: 'Light', icon: '☀️' },
	{ id: 'dark', label: 'Dark', icon: '🌙' }
];

/**
 * Read a stored value back into the union, falling back to `system` for anything
 * unrecognised — a corrupted key, or a preference retired in a later version, must
 * still render a usable page rather than throw on boot.
 */
export function parseTheme(value: string | null | undefined): ThemePreference {
	return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/**
 * Put the preference on the document.
 *
 * `system` REMOVES the attribute rather than setting a value, so `:root` falls back
 * to `color-scheme: light dark` and the OS decides. Setting `data-theme="system"`
 * would need a third CSS rule that does nothing, which is a rule that can rot.
 */
export function applyTheme(root: HTMLElement, theme: ThemePreference): void {
	if (theme === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', theme);
}

/** Persist the choice. Swallows a storage failure — private mode must not break. */
export function storeTheme(storage: Storage, theme: ThemePreference): void {
	try {
		storage.setItem(THEME_KEY, theme);
	} catch {
		/* Safari private mode throws on setItem; the theme still applies this session. */
	}
}

/** Read the stored choice, or `system` when nothing is stored or storage is blocked. */
export function readTheme(storage: Storage): ThemePreference {
	try {
		return parseTheme(storage.getItem(THEME_KEY));
	} catch {
		return 'system';
	}
}
