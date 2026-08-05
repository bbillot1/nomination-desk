/** Minimal Supabase Edge Runtime globals used by this project. */
declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined;
  }

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};
