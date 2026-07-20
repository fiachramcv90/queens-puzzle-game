// A trivial Edge Function, here to prove the deploy path works end to end
// before any real one exists. The gameplay functions — start, heartbeat,
// reveal, submit, merge — land in later slices alongside the schema they write.
//
// Run locally: `supabase functions serve health`
// Then: `curl http://127.0.0.1:54321/functions/v1/health`
//
// Edge Functions run on Deno, not Node, so this file is checked by the Supabase
// CLI rather than by the app's TypeScript config or ESLint.

Deno.serve(() => {
	return new Response(JSON.stringify({ status: 'ok' }), {
		headers: { 'content-type': 'application/json' }
	});
});
