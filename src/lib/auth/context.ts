/**
 * The Svelte context key the layout publishes its one {@link AuthState} under, so the
 * page can read the signed-in player's profile (and streak) without the instance being
 * threaded as a prop through the slot. Kept in its own module so both the provider
 * (`+layout.svelte`) and the consumers share one symbol.
 */

import type { AuthState } from './auth-state.svelte';

/** Context key for the shared {@link AuthState}. A symbol so it never collides. */
export const AUTH_CONTEXT = Symbol('auth');

/** The value stored under {@link AUTH_CONTEXT}. */
export type AuthContext = AuthState;
