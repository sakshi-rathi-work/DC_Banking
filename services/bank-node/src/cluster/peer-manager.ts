import * as grpc from '@grpc/grpc-js';
import { loadClusterProto } from '../grpc/proto-loader.js';
import { createLogger } from '@bank/shared';

const logger = createLogger({ service: 'peer-manager' });

export interface PeerConfig {
  nodeId: number;
  address: string;
}

export interface ClusterServiceClientInstance {
  heartbeat: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  ping: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  election: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  coordinator: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  ringElection: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  ringCoordinator: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  appendEntries: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  getLogEntries: (
    req: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions | undefined,
    callback: (err: grpc.ServiceError | null, res: unknown) => void,
  ) => void;
  getSnapshot: (
    req: unknown,
    metadata: grpc.Metadata,
    options?: grpc.CallOptions,
  ) => grpc.ClientReadableStream<unknown>;
  close: () => void;
  [methodName: string]: unknown;
}




export class PeerManager {
  private selfNodeId: number;
  private peersMap = new Map<number, { config: PeerConfig; client: ClusterServiceClientInstance }>();

  constructor(selfNodeId: number, peersStr?: string) {
    this.selfNodeId = selfNodeId;
    this.initPeers(peersStr || process.env.PEERS || '');
  }

  public initPeers(peersStr: string): void {
    this.closeAll();

    const clusterProto = loadClusterProto() as unknown as {
      bank: { v1: { ClusterService: new (target: string, creds: grpc.ChannelCredentials) => ClusterServiceClientInstance } };
    };
    const ClusterServiceClient = clusterProto.bank.v1.ClusterService;

    const parsedPeers = parsePeersString(peersStr);
    for (const peer of parsedPeers) {
      if (peer.nodeId === this.selfNodeId) continue; // skip self

      try {
        const client = new ClusterServiceClient(peer.address, grpc.credentials.createInsecure());
        this.peersMap.set(peer.nodeId, { config: peer, client });
        logger.info(`Initialized gRPC peer client for Node ${peer.nodeId} at ${peer.address}`);
      } catch (err) {
        logger.error(`Failed to initialize peer client for Node ${peer.nodeId}`, { err, address: peer.address });
      }
    }
  }

  public getPeerClient(nodeId: number): ClusterServiceClientInstance | undefined {
    return this.peersMap.get(nodeId)?.client;
  }

  public getAllPeerNodeIds(): number[] {
    return Array.from(this.peersMap.keys());
  }

  public getPeerConfigs(): PeerConfig[] {
    return Array.from(this.peersMap.values()).map((p) => p.config);
  }

  public closeAll(): void {
    for (const { client } of this.peersMap.values()) {
      try {
        client.close();
      } catch {
        // ignore close errors
      }
    }
    this.peersMap.clear();
  }
}

export function parsePeersString(peersStr: string): PeerConfig[] {
  if (!peersStr || !peersStr.trim()) return [];

  const peers: PeerConfig[] = [];
  const entries = peersStr.split(',').map((s) => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const parts = entry.split('=');
    if (parts.length === 2) {
      const nodeId = parseInt(parts[0]!, 10);
      const address = parts[1]!.trim();
      if (!isNaN(nodeId) && address) {
        peers.push({ nodeId, address });
      }
    }
  }

  return peers;
}
