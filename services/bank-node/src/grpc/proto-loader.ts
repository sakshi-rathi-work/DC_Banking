/**
 * gRPC proto loader utility.
 * Loads .proto definitions with consistent options across all services.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'proto');

const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false, // Convert to camelCase
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

let bankProtoDescriptor: grpc.GrpcObject | null = null;

/**
 * Load and return the bank.proto gRPC package definition.
 * Cached after first load.
 */
export function loadBankProto(): grpc.GrpcObject {
  if (!bankProtoDescriptor) {
    const packageDef = protoLoader.loadSync(
      path.join(PROTO_DIR, 'bank.proto'),
      PROTO_LOADER_OPTIONS,
    );
    bankProtoDescriptor = grpc.loadPackageDefinition(packageDef);
  }
  return bankProtoDescriptor;
}

let clusterProtoDescriptor: grpc.GrpcObject | null = null;

/**
 * Load and return the cluster.proto gRPC package definition.
 */
export function loadClusterProto(): grpc.GrpcObject {
  if (!clusterProtoDescriptor) {
    const packageDef = protoLoader.loadSync(
      path.join(PROTO_DIR, 'cluster.proto'),
      PROTO_LOADER_OPTIONS,
    );
    clusterProtoDescriptor = grpc.loadPackageDefinition(packageDef);
  }
  return clusterProtoDescriptor;
}

let observabilityProtoDescriptor: grpc.GrpcObject | null = null;

/**
 * Load and return the observability.proto gRPC package definition.
 */
export function loadObservabilityProto(): grpc.GrpcObject {
  if (!observabilityProtoDescriptor) {
    const packageDef = protoLoader.loadSync(
      path.join(PROTO_DIR, 'observability.proto'),
      PROTO_LOADER_OPTIONS,
    );
    observabilityProtoDescriptor = grpc.loadPackageDefinition(packageDef);
  }
  return observabilityProtoDescriptor;
}

let labProtoDescriptor: grpc.GrpcObject | null = null;

/**
 * Load and return the lab.proto gRPC package definition.
 */
export function loadLabProto(): grpc.GrpcObject {
  if (!labProtoDescriptor) {
    const packageDef = protoLoader.loadSync(
      path.join(PROTO_DIR, 'lab.proto'),
      PROTO_LOADER_OPTIONS,
    );
    labProtoDescriptor = grpc.loadPackageDefinition(packageDef);
  }
  return labProtoDescriptor;
}
