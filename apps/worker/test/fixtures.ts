import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
// The reference target is plain ESM JavaScript.
// @ts-expect-error -- no type declarations for the .mjs tool
import { createReferenceServer } from "../../../tools/reference-target/server.mjs";

export interface RunningServer {
  origin: string;
  port: number;
  close: () => Promise<void>;
}

export async function listen(server: Server, host = "127.0.0.1"): Promise<RunningServer> {
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function startReferenceTarget(): Promise<RunningServer> {
  return listen(createReferenceServer() as Server);
}

/**
 * Edge-case server for failure handling tests. Bound to loopback; tests
 * authorize it explicitly through the allowlist.
 */
export function startEdgeCaseServer(otherPort: () => number): Promise<RunningServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://edge.local");
    switch (url.pathname) {
      case "/server-error":
        res.writeHead(500, { "content-type": "text/html" }).end("<title>Broken</title><h1>Internal error</h1>");
        return;
      case "/hang":
        // Never respond: exercises the navigation timeout.
        return;
      case "/redirect-out":
        res.writeHead(302, { location: `http://127.0.0.1:${otherPort()}/` }).end();
        return;
      case "/redirect-loop":
        res.writeHead(302, { location: "/redirect-loop" }).end();
        return;
      case "/private-subresource":
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(`<title>Sub</title><h1>Hello</h1><img src="http://127.0.0.1:${otherPort()}/secret.png">`);
        return;
      case "/secret-page":
        res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=abc123" }).end("<title>Secret</title>");
        return;
      case "/console":
        res
          .writeHead(200, { "content-type": "text/html" })
          .end(`<title>Console</title><script>console.error("boom token=supersecretvalue"); console.warn("careful"); null.x;</script>`);
        return;
      default:
        res.writeHead(200, { "content-type": "text/html" }).end("<title>Edge OK</title><p>ok</p>");
    }
  });
  return listen(server);
}
