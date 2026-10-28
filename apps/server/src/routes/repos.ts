import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { listAllPulls, listRepoPulls } from "../services/pulls.js";
import { createRepo, getRepo, listRepos, updateRepo, type RepoDeps } from "../services/repos.js";

export type RepoRouteOptions = { db: Db; repoDeps?: RepoDeps };

export async function repoRoutes(app: FastifyInstance, opts: RepoRouteOptions): Promise<void> {
  const { db, repoDeps } = opts;

  app.get("/api/repos", async () => listRepos(db));

  app.get<{ Params: { id: string } }>("/api/repos/:id", async (request) => getRepo(db, request.params.id));

  app.patch<{ Params: { id: string } }>("/api/repos/:id", async (request) => updateRepo(db, request.params.id, request.body));

  app.get<{ Params: { id: string } }>("/api/repos/:id/pulls", async (request) => listRepoPulls(db, request.params.id));

  app.get("/api/pulls", async () => listAllPulls(db));

  app.post("/api/repos", async (request, reply) => {
    const repo = createRepo(db, request.body, repoDeps);
    return reply.code(201).send(repo);
  });
}
