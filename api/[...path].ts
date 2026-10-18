import type { ServerResponse } from 'node:http';
import { handleRequest } from './_lib/router.js';
import type { Req } from './_lib/http.js';

// Single serverless function for every /api/* route (keeps within Vercel Hobby function limits).
export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  await handleRequest(req, res);
}
