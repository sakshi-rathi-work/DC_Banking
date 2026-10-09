import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, createLogger } from '@bank/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../../../proto');

const logger = createLogger({ service: 'gateway-observability-client' });

type ServiceConstructor = new (
  target: string,
  credentials: grpc.ChannelCredentials,
) => ObservabilityClientInstance;

interface ObservabilityClientInstance {
  getStatus: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  getEvents: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  getRpcTrace: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  getReplicationState: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  getIntegrity: (req: unknown, callback: (err: grpc.ServiceError | null, res: unknown) => void) => void;
  close: () => void;
}

let clientInstance: ObservabilityClientInstance | null = null;

function getDefaultTarget(): string {
  if (process.env.NODE1_TARGET) return process.env.NODE1_TARGET;
  if (process.env.GATEWAY_NODES) {
    const firstNode = process.env.GATEWAY_NODES.split(',')[0];
    if (firstNode && firstNode.includes('=')) return firstNode.split('=')[1]!;
  }
  return '127.0.0.1:50051';
}

function getClient(target = getDefaultTarget()): ObservabilityClientInstance {
  if (!clientInstance) {
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'observability.proto'), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });

    const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
      bank: { v1: { ObservabilityService: ServiceConstructor } };
    };
    const ObservabilityService = proto.bank.v1.ObservabilityService;
    clientInstance = new ObservabilityService(target, grpc.credentials.createInsecure());
    logger.info(`Observability gRPC client connected to ${target}`);
  }
  return clientInstance;
}

export class ObservabilityGrpcClient {
  static async getStatus(targetNode?: string) {
    const client = getClient(targetNode);
    return new Promise((resolve, reject) => {
      client.getStatus({}, (err, res) => {
        if (err) return reject(AppError.fromGrpcError(err));
        resolve(res);
      });
    });
  }

  static async getEvents(options: { since?: number; limit?: number; type?: string; node?: number; requestId?: string }, targetNode?: string) {
    const client = getClient(targetNode);
    return new Promise((resolve, reject) => {
      client.getEvents(options, (err, res) => {
        if (err) return reject(AppError.fromGrpcError(err));
        resolve(res);
      });
    });
  }

  static async getRpcTrace(options: { limit?: number; requestId?: string }, targetNode?: string) {
    const client = getClient(targetNode);
    return new Promise((resolve, reject) => {
      client.getRpcTrace(options, (err, res) => {
        if (err) return reject(AppError.fromGrpcError(err));
        resolve(res);
      });
    });
  }

  static async getReplicationState(targetNode?: string) {
    const client = getClient(targetNode);
    return new Promise((resolve, reject) => {
      client.getReplicationState({}, (err, res) => {
        if (err) return reject(AppError.fromGrpcError(err));
        resolve(res);
      });
    });
  }

  static async getIntegrity(targetNode?: string) {
    const client = getClient(targetNode);
    return new Promise((resolve, reject) => {
      client.getIntegrity({}, (err, res) => {
        if (err) return reject(AppError.fromGrpcError(err));
        resolve(res);
      });
    });
  }
}
