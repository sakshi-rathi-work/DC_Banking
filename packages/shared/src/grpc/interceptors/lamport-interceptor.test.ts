import { describe, it, expect } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { LamportClock } from '../../clock/lamport.js';
import {
  prepareClientMetadata,
  processIncomingServerMetadata,
  METADATA_KEYS,
  withGrpcInterceptors,
} from './lamport-interceptor.js';

describe('gRPC Interceptors (U-LAM-2)', () => {
  it('should prepare client metadata with x-lamport, x-origin, and x-request-id', () => {
    const clientClock = new LamportClock({ initialValue: 10 });
    const metadata = prepareClientMetadata(clientClock, 1, 'req-abc-123');

    expect(clientClock.getValue()).toBe(11);
    expect(metadata.get(METADATA_KEYS.LAMPORT)[0]).toBe('11');
    expect(metadata.get(METADATA_KEYS.ORIGIN)[0]).toBe('1');
    expect(metadata.get(METADATA_KEYS.REQUEST_ID)[0]).toBe('req-abc-123');
  });

  it('should witness incoming x-lamport on server and tick clock', () => {
    const serverClock = new LamportClock({ initialValue: 5 });
    const incomingMetadata = new grpc.Metadata();
    incomingMetadata.set(METADATA_KEYS.LAMPORT, '20');

    const result = processIncomingServerMetadata(incomingMetadata, serverClock);

    // Incoming 20, server clock 5 -> max(5, 20) + 1 = 21
    expect(result.incomingLamport).toBe(20);
    expect(result.currentLamport).toBe(21);
    expect(serverClock.getValue()).toBe(21);
    expect(result.responseTrailers.get(METADATA_KEYS.LAMPORT)[0]).toBe('21');
  });

  it('should tick clock on server if x-lamport is missing', () => {
    const serverClock = new LamportClock({ initialValue: 5 });
    const incomingMetadata = new grpc.Metadata();

    const result = processIncomingServerMetadata(incomingMetadata, serverClock);

    expect(result.incomingLamport).toBe(0);
    expect(result.currentLamport).toBe(6);
    expect(serverClock.getValue()).toBe(6);
    expect(result.responseTrailers.get(METADATA_KEYS.LAMPORT)[0]).toBe('6');
  });

  it('should wrap server handler and attach trailer metadata', async () => {
    const serverClock = new LamportClock({ initialValue: 10 });
    const callMetadata = new grpc.Metadata();
    callMetadata.set(METADATA_KEYS.LAMPORT, '15');

    const mockCall = {
      metadata: callMetadata,
    } as unknown as grpc.ServerUnaryCall<unknown, unknown>;

    let capturedErr: unknown = null;
    let capturedResponse: unknown = null;
    let capturedTrailer: grpc.Metadata | undefined = undefined;

    const mockCallback: grpc.sendUnaryData<unknown> = (err, res, trailer) => {
      capturedErr = err;
      capturedResponse = res;
      capturedTrailer = trailer;
    };

    const handler = withGrpcInterceptors<unknown, unknown>(async (_call, callback) => {
      callback(null, { status: 'OK' });
    }, serverClock);

    await handler(mockCall, mockCallback);

    expect(capturedErr).toBeNull();
    expect(capturedResponse).toEqual({ status: 'OK' });
    expect(capturedTrailer).toBeDefined();
    expect(capturedTrailer!.get(METADATA_KEYS.LAMPORT)[0]).toBe('16');
  });
});
