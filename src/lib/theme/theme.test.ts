import { describe, it, expect, vi } from 'vitest';
import { applyTheme, parseTheme, readTheme, storeTheme, THEME_KEY } from './theme';

/**
 * A minimal element stand-in. `applyTheme` touches exactly three attribute methods,
 * so a stub keeps these tests in the same dependency-free node environment as the
 * rest of the suite rather than pulling in a DOM just to set one attribute.
 */
function fakeRoot() {
	const attrs = new Map<string, string>();
	return {
		setAttribute: (k: string, v: string) => void attrs.set(k, v),
		removeAttribute: (k: string) => void attrs.delete(k),
		getAttribute: (k: string) => attrs.get(k) ?? null,
		hasAttribute: (k: string) => attrs.has(k)
	} as unknown as HTMLElement;
}

/** A minimal in-memory Storage stand-in. */
function fakeStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		length: 0
	} as unknown as Storage;
}

describe('parseTheme', () => {
	it('accepts the three known values', () => {
		expect(parseTheme('system')).toBe('system');
		expect(parseTheme('light')).toBe('light');
		expect(parseTheme('dark')).toBe('dark');
	});

	// A corrupted key, or a preference retired in a later version, must still render
	// a usable page rather than throw on boot.
	it('falls back to system for anything else', () => {
		expect(parseTheme(null)).toBe('system');
		expect(parseTheme(undefined)).toBe('system');
		expect(parseTheme('')).toBe('system');
		expect(parseTheme('sepia')).toBe('system');
		expect(parseTheme('DARK')).toBe('system');
	});
});

describe('applyTheme', () => {
	it('pins light and dark on the element', () => {
		const root = fakeRoot();
		applyTheme(root, 'dark');
		expect(root.getAttribute('data-theme')).toBe('dark');
		applyTheme(root, 'light');
		expect(root.getAttribute('data-theme')).toBe('light');
	});

	// `system` REMOVES the attribute so :root falls back to `color-scheme: light dark`
	// and the OS decides. A `data-theme="system"` value would need a CSS rule that
	// does nothing, which is a rule that can rot.
	it('removes the attribute for system rather than setting a value', () => {
		const root = fakeRoot();
		applyTheme(root, 'dark');
		applyTheme(root, 'system');
		expect(root.hasAttribute('data-theme')).toBe(false);
	});
});

describe('readTheme / storeTheme', () => {
	it('round-trips a choice', () => {
		const storage = fakeStorage();
		storeTheme(storage, 'dark');
		expect(storage.getItem(THEME_KEY)).toBe('dark');
		expect(readTheme(storage)).toBe('dark');
	});

	it('reads system when nothing is stored', () => {
		expect(readTheme(fakeStorage())).toBe('system');
	});

	// Safari private mode throws on setItem. The theme still applies for the session;
	// it just does not persist, which must never surface as an error.
	it('survives storage that throws', () => {
		const hostile = {
			getItem: vi.fn(() => {
				throw new Error('blocked');
			}),
			setItem: vi.fn(() => {
				throw new Error('blocked');
			})
		} as unknown as Storage;
		expect(() => storeTheme(hostile, 'dark')).not.toThrow();
		expect(readTheme(hostile)).toBe('system');
	});
});
