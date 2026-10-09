import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, createLogger } from '@bank/shared';
import type { PeerManager } from '../cluster/peer-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'proto');

const logger = createLogger({ service: 'write-forwarder' });

type BankServiceClientInstance = {
  [methodName: string]: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  close: () => void;
};

const clientCache = new Map<string, BankServiceClientInstance>();


export function getForwardClient(address: string): BankServiceClientInstance {
  let client = clientCache.get(address);
  if (!client) {
    const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, 'bank.proto'), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });

    const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
      bank: { v1: { BankService: new (target: string, creds: grpc.ChannelCredentials) => BankServiceClientInstance } };
    };

    client = new proto.bank.v1.BankService(address, grpc.credentials.createInsecure());
    clientCache.set(address, client);
  }
  return client;
}

export async function forwardWriteToLeader<TRes>(
  methodName: string,
  request: unknown,
  incomingMetadata: grpc.Metadata,
  selfNodeId: number,
  leaderNodeId: number,
  peerManager: PeerManager,
): Promise<TRes> {
  const forwardedBy = incomingMetadata.get('x-forwarded-by')[0];
  if (forwardedBy) {
    throw new AppError('INTERNAL', `Circular write forwarding loop detected (already forwarded by Node ${forwardedBy})`);
  }

  const peerConfigs = peerManager.getPeerConfigs();
  const leaderConfig = peerConfigs.find((p) => p.nodeId === leaderNodeId);
  if (!leaderConfig) {
    throw new AppError('NODE_UNAVAILABLE', `Leader Node ${leaderNodeId} address unknown for write forwarding`);
  }


  logger.info(`Forwarding ${methodName} write request from Node ${selfNodeId} to Leader Node ${leaderNodeId} at ${leaderConfig.address}`);

  const client = getForwardClient(leaderConfig.address);
  const metadata = incomingMetadata.clone();
  metadata.set('x-forwarded-by', selfNodeId.toString());

  return new Promise<TRes>((resolve, reject) => {
    const fn = client[methodName];
    if (!fn) {
      return reject(new AppError('INTERNAL', `Method ${methodName} not found on gRPC BankService client`));
    }

    fn.call(client, request, metadata, { deadline: Date.now() + 5000 }, (err, response) => {
      if (err) {
        logger.error(`Forwarded ${methodName} to Leader Node ${leaderNodeId} failed`, { err });
        return reject(AppError.fromGrpcError(err));
      }
      resolve(response as TRes);
    });
  });
}
