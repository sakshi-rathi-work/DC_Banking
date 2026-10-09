import type { Request } from 'express';

export interface EnvelopeMetaOptions {
  entryNode?: number;
  servedBy?: number;
  processedBy?: number;
  lamport?: number;
  appliedSeq?: number;
  leaderSeq?: number;
  stale?: boolean;
}

export function createSuccessEnvelope<T>(
  data: T,
  req: Request,
  opts: EnvelopeMetaOptions = {},
) {
  return {
    data,
    meta: {
      requestId: req.requestId ?? 'unknown',
      entryNode: opts.entryNode ?? 1,
      servedBy: opts.servedBy ?? opts.entryNode ?? 1,
      ...(opts.processedBy !== undefined && { processedBy: opts.processedBy }),
      ...(opts.lamport !== undefined && { lamport: opts.lamport }),
      ...(opts.appliedSeq !== undefined && { appliedSeq: opts.appliedSeq }),
      ...(opts.leaderSeq !== undefined && { leaderSeq: opts.leaderSeq }),
      ...(opts.stale !== undefined && { stale: opts.stale }),
    },
  };
}
