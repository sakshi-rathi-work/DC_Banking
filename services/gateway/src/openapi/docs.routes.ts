import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiSpec = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf-8'),
);

export function createDocsRouter(): Router {
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.json(openapiSpec);
  });

  router.use('/', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  return router;
}
