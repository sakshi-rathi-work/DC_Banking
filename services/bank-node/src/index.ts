import http from 'node:http';
import { Server, ServerCredentials } from '@grpc/grpc-js';
import { createLogger, loadConfig, LamportClock } from '@bank/shared';
import { z } from 'zod';
import { getDbPool, closeDbPool } from './db/pool.js';
import { runMigrations } from './db/migrator.js';
import { createGrpcServer } from './grpc/server.js';
import { destroyPools } from './concurrency/pool.js';
import { PeerManager } from './cluster/peer-manager.js';
import { FailureDetector } from './cluster/failure-detector.js';
import { HeartbeatLoop } from './cluster/heartbeat.js';
import { EventSink } from './observability/event-sink.js';
import { RpcTraceBuffer } from './observability/rpc-trace-buffer.js';
import { LeaderPrep } from './election/leader-prep.js';
import { ElectionManager } from './election/election-manager.js';
import { Replicator } from './replication/replicator.js';
import { LogApplier } from './replication/applier.js';
import { CatchupService } from './replication/catchup.js';
import { SnapshotService } from './replication/snapshot.js';
import { IntegrityChecker } from './replication/integrity.js';

const NodeConfigSchema = z.object({
  NODE_ID: z.coerce.number().default(1),
  NODE_PRIORITY: z.coerce.number().optional(),
  PEERS: z.string().default('1=bank-node-1:50051,2=bank-node-2:50051,3=bank-node-3:50051'),
  DATABASE_URL: z.string().default('postgres://bank:bank_pw_dev@localhost:5441/bank'),
  HEALTH_PORT: z.coerce.number().default(9000),
  GRPC_PORT: z.coerce.number().default(50051),
  ELECTION_ALGORITHM: z.enum(['bully', 'ring']).default('bully'),
  CONSISTENCY_MODE: z.enum(['strong', 'eventual']).default('strong'),
  INITIAL_CLOCK_SKEW_MS: z.coerce.number().default(0),
  CLOCK_DRIFT_PPM: z.coerce.number().default(0),
  JWT_SECRET: z.string().default('dev-dbs-jwt-secret-key-change-in-prod'),
  PREEMPT_ON_RECOVERY: z.coerce.boolean().default(true),
});

const config = loadConfig(NodeConfigSchema);
const logger = createLogger({ service: 'bank-node', node: config.NODE_ID });

let isHealthy = false;
let grpcServer: Server | null = null;

const clock = new LamportClock();
let peerManager: PeerManager | null = null;
let failureDetector: FailureDetector | null = null;
let heartbeatLoop: HeartbeatLoop | null = null;
let eventSink: EventSink | null = null;
let leaderPrep: LeaderPrep | null = null;
let electionManager: ElectionManager | null = null;
let replicator: Replicator | null = null;
let applier: LogApplier | null = null;
let catchupService: CatchupService | null = null;
let snapshotService: SnapshotService | null = null;
let integrityChecker: IntegrityChecker | null = null;

const rpcTraceBuffer = new RpcTraceBuffer(500);

function getEpoch(): number {
  return electionManager ? electionManager.getEpoch() : 0;
}

function getLamport(): number {
  return clock.tick();
}

function getLeaderId(): number {
  return electionManager ? electionManager.getLeaderId() : config.NODE_ID;
}

function isLeader(): boolean {
  return electionManager ? electionManager.isLeader() : true;
}

function getLastSeq(): number {
  return 0;
}

// Health HTTP server on :9000/healthz
const healthServer = http.createServer(async (req, res) => {
  if (req.url === '/healthz' || req.url === '/health') {
    if (!isHealthy) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'NOT_READY', node: config.NODE_ID }));
      return;
    }

    try {
      const pool = getDbPool(config.DATABASE_URL);
      await pool.query('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'UP', node: config.NODE_ID }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'DB_DOWN', node: config.NODE_ID, error: String(err) }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function start() {
  logger.info(`Starting bank-node-${config.NODE_ID}...`);

  healthServer.listen(config.HEALTH_PORT, '0.0.0.0', () => {
    logger.info(`Health check listening on port ${config.HEALTH_PORT}/healthz`);
  });

  const pool = getDbPool(config.DATABASE_URL);
  let connected = false;
  const startAt = Date.now();

  while (!connected && Date.now() - startAt < 60000) {
    try {
      await pool.query('SELECT 1');
      connected = true;
      logger.info('Database connection established.');
    } catch {
      logger.warn('Waiting for PostgreSQL to be ready...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (!connected) {
    logger.error('Could not connect to PostgreSQL within 60s. Aborting startup.');
    process.exit(1);
  }

  logger.info('Running database migrations...');
  await runMigrations(pool);
  logger.info('Database migrations completed.');

  await pool.query(
    `INSERT INTO node_state (node_id, epoch, last_seq, config)
     VALUES ($1, 0, 0, $2)
     ON CONFLICT (node_id) DO NOTHING`,
    [
      config.NODE_ID,
      JSON.stringify({
        electionAlgorithm: config.ELECTION_ALGORITHM,
        consistencyMode: config.CONSISTENCY_MODE,
        version: 1,
      }),
    ],
  );

  const stateRes = await pool.query<{ epoch: string; lamport_checkpoint: string }>(
    'SELECT epoch, lamport_checkpoint FROM node_state WHERE node_id = $1',
    [config.NODE_ID],
  );
  const row = stateRes.rows[0];
  let initEpoch = 0;
  if (row) {
    initEpoch = Number(row.epoch || 0);
    clock.setCheckpoint(Number(row.lamport_checkpoint || 0));
  }

  // Observability, Cluster, Election & Replication services
  eventSink = new EventSink(pool, config.NODE_ID, clock);
  failureDetector = new FailureDetector(config.NODE_ID, 3000, eventSink);
  peerManager = new PeerManager(config.NODE_ID, config.PEERS);
  leaderPrep = new LeaderPrep(config.NODE_ID, failureDetector);

  electionManager = new ElectionManager({
    selfNodeId: config.NODE_ID,
    selfPriority: config.NODE_PRIORITY ?? config.NODE_ID,
    algorithm: config.ELECTION_ALGORITHM,
    pool,
    clock,
    failureDetector,
    peerManager,
    eventSink,
    leaderPrep,
    preemptOnRecovery: config.PREEMPT_ON_RECOVERY,
  });
  electionManager.setEpoch(initEpoch);

  replicator = new Replicator(pool, config.NODE_ID, clock, peerManager, failureDetector, config.CONSISTENCY_MODE);
  applier = new LogApplier(pool, config.NODE_ID, clock);
  catchupService = new CatchupService(pool);
  snapshotService = new SnapshotService(pool);
  integrityChecker = new IntegrityChecker(pool, config.NODE_ID);

  const stateProvider = {
    getNodeId: () => config.NODE_ID,
    getRole: () => (isLeader() ? 'LEADER' : 'FOLLOWER'),
    getEpoch: () => electionManager?.getEpoch() || 0,
    getLeaderId: () => electionManager?.getLeaderId() || config.NODE_ID,
    getLastSeq: () => getLastSeq(),
    getElectionAlgorithm: () => electionManager?.getAlgorithm() || config.ELECTION_ALGORITHM,
    getConsistencyMode: () => replicator?.getConsistencyMode() || config.CONSISTENCY_MODE,
    getActiveRequests: () => 0,
    getEventLoopLagMs: () => 0,
  };

  heartbeatLoop = new HeartbeatLoop(peerManager, failureDetector, clock, stateProvider, 1000);

  const server = createGrpcServer({
    pool,
    jwtSecret: config.JWT_SECRET,
    nodeId: config.NODE_ID,
    priority: config.NODE_PRIORITY ?? config.NODE_ID,
    role: isLeader() ? 'LEADER' : 'FOLLOWER',
    getEpoch,
    getLamport,
    getLeaderId,
    getLastSeq,
    isLeader,
    peerManager,
    electionManager,
    replicator,
    applier,
    catchupService,
    snapshotService,
    integrityChecker,
    clock,
    failureDetector,
    eventSink,
    rpcTraceBuffer,
  });
  grpcServer = server;

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${config.GRPC_PORT}`,
      ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) return reject(err);
        logger.info(`gRPC server listening on port ${port}`);
        resolve();
      },
    );
  });

  heartbeatLoop.start();

  // Initiate initial election on startup to elect cluster leader cleanly
  setTimeout(() => {
    electionManager?.initiateElection('COLD_START');
  }, 500);

  await eventSink.logEvent({
    service: 'bank-node',
    eventType: 'NODE_STARTED',
    severity: 'INFO',
    details: { nodeId: config.NODE_ID, grpcPort: config.GRPC_PORT },
  });

  isHealthy = true;
  logger.info(`bank-node-${config.NODE_ID} is fully initialized and healthy.`);
}

start().catch((err) => {
  logger.error('Fatal startup error in bank-node', err);
  process.exit(1);
});

async function shutdown() {
  logger.info('Shutting down bank-node...');
  isHealthy = false;
  healthServer.close();
  if (heartbeatLoop) {
    heartbeatLoop.stop();
  }
  if (peerManager) {
    peerManager.closeAll();
  }
  if (grpcServer) {
    grpcServer.forceShutdown();
  }
  await destroyPools();
  await closeDbPool();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
