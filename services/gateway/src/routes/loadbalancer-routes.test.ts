import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { systemRouter } from './system.routes.js';
import { labRouter } from './lab.routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { LoadBalancer } from '../loadbalancer/load-balancer.js';

describe('Load Balancer REST Endpoints', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/system', systemRouter);
  app.use('/api/lab', labRouter);
  app.use(errorHandler);

  it('GET /api/system/load returns valid least-connections metrics structure', async () => {
    // Ensure LoadBalancer is initialized
    LoadBalancer.getInstance({
      gatewayNodes: '1=127.0.0.1:50051,2=127.0.0.1:50052,3=127.0.0.1:50053',
    });

    const res = await request(app).get('/api/system/load');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.algorithm).toBe('least-connections');
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(data.nodes.length).toBe(3);
    expect(typeof data.retries).toBe('number');
    expect(typeof data.requestsPerMin).toBe('number');

    for (const node of data.nodes) {
      expect(typeof node.nodeId).toBe('number');
      expect(typeof node.healthy).toBe('boolean');
      expect(typeof node.activeRequests).toBe('number');
      expect(typeof node.totalRequests).toBe('number');
      expect(typeof node.sharePct).toBe('number');
      expect(typeof node.ewmaLatencyMs).toBe('number');
      expect(typeof node.failures).toBe('number');
    }
  });

  it('PUT /api/lab/nodes/:id/latency validates latencyMs bounds (0 to 5000)', async () => {
    // Reject negative
    const resNegative = await request(app)
      .put('/api/lab/nodes/1/latency')
      .send({ latencyMs: -50 });
    expect(resNegative.status).toBe(400);

    // Reject > 5000
    const resExcessive = await request(app)
      .put('/api/lab/nodes/1/latency')
      .send({ latencyMs: 6000 });
    expect(resExcessive.status).toBe(400);
  });
});
