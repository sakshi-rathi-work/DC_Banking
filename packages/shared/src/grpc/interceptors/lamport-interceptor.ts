import * as grpc from '@grpc/grpc-js';
import { LamportClock, toLamportNumber } from '../../clock/lamport.js';

export const METADATA_KEYS = {
  LAMPORT: 'x-lamport',
  REQUEST_ID: 'x-request-id',
  ORIGIN: 'x-origin',
} as const;

/**
  Injects client Lamport clock value and origin node ID into call metadata before sending,
  and receives returning trailer Lamport clock value.
 */
export function prepareClientMetadata(
  clock?: LamportClock,
  originNodeId?: number,
  requestId?: string,
  existingMetadata?: grpc.Metadata,
): grpc.Metadata {
  const md = existingMetadata ? existingMetadata.clone() : new grpc.Metadata();

  if (clock) {
    const sendLamport = clock.send();
    md.set(METADATA_KEYS.LAMPORT, sendLamport.toString());
  }

  if (originNodeId !== undefined) {
    md.set(METADATA_KEYS.ORIGIN, originNodeId.toString());
  }

  if (requestId) {
    md.set(METADATA_KEYS.REQUEST_ID, requestId);
  }

  return md;
}

/**
 * Handles incoming server call metadata for Lamport clock synchronization.
 * Witnesses incoming `x-lamport` header, ticks clock, and returns trailer metadata with updated `x-lamport`.
 */
export function processIncomingServerMetadata(
  callMetadata: grpc.Metadata,
  clock: LamportClock,
): { incomingLamport: number; currentLamport: number; responseTrailers: grpc.Metadata } {
  const rawLamport = callMetadata.get(METADATA_KEYS.LAMPORT)[0];
  let incomingLamport = 0;

  if (rawLamport !== undefined) {
    incomingLamport = toLamportNumber(rawLamport.toString());
    clock.receive(incomingLamport);
  } else {
    clock.tick();
  }

  const currentLamport = clock.getValue();
  const responseTrailers = new grpc.Metadata();
  responseTrailers.set(METADATA_KEYS.LAMPORT, currentLamport.toString());

  return {
    incomingLamport,
    currentLamport,
    responseTrailers,
  };
}

/**
 * gRPC Server handler wrapper function that handles metadata extraction,
 * Lamport clock witness + tick, error formatting, and trailer attachment.
 */
export function withGrpcInterceptors<TReq, TRes>(
  handler: (call: grpc.ServerUnaryCall<TReq, TRes>, callback: grpc.sendUnaryData<TRes>) => Promise<void> | void,
  clock: LamportClock,
) {
  return async (call: grpc.ServerUnaryCall<TReq, TRes>, callback: grpc.sendUnaryData<TRes>) => {
    processIncomingServerMetadata(call.metadata, clock);

    // Override callback to attach response trailers

    const wrappedCallback: grpc.sendUnaryData<TRes> = (err, response, trailer, flags) => {
      const mergedTrailer = trailer ? trailer.clone() : new grpc.Metadata();
      mergedTrailer.set(METADATA_KEYS.LAMPORT, clock.getValue().toString());
      callback(err, response, mergedTrailer, flags);
    };

    try {
      await handler(call, wrappedCallback);
    } catch (err) {
      const mergedTrailer = new grpc.Metadata();
      mergedTrailer.set(METADATA_KEYS.LAMPORT, clock.getValue().toString());
      callback(err as grpc.ServiceError, null, mergedTrailer);
    }
  };
}
