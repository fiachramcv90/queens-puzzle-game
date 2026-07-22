// HTTP helpers shared by the play-lifecycle functions: CORS, JSON responses and a
// small guard for the "POST with a JSON body" shape all three share. Kept tiny and
// dependency-free so every function reads the same way.

export const corsHeaders: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/** A JSON response with CORS headers already attached. */
export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, 'content-type': 'application/json' }
	});
}

/** The preflight response, or null if this isn't an OPTIONS request. */
export function preflight(req: Request): Response | null {
	return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

/**
 * Parse a JSON POST body, or return a 4xx Response describing what was wrong. The
 * caller checks `('error' in result)` to short-circuit. Only POST is accepted —
 * these endpoints all mutate.
 */
export async function readJsonBody<T>(req: Request): Promise<T | { error: Response }> {
	if (req.method !== 'POST') {
		return { error: json({ error: 'method not allowed' }, 405) };
	}
	try {
		return (await req.json()) as T;
	} catch {
		return { error: json({ error: 'invalid JSON body' }, 400) };
	}
}
