import { summarizeTraces } from '../src/admin-bff.controller';

describe('admin trace summaries', () => {
  it('returns operational timing without exposing raw span attributes', () => {
    expect(summarizeTraces([{ traceID: 'trace-1', spans: [
      {
        operationName: 'POST /transfers',
        startTime: 1_000_000,
        duration: 25_000,
        tags: [{ key: 'transfer.id', value: 'transfer-1' }],
      },
      { operationName: 'saga.place_hold', startTime: 1_010_000, duration: 40_000, tags: [] },
    ] }])).toEqual([{
      traceId: 'trace-1',
      operation: 'POST /transfers',
      startedAt: '1970-01-01T00:00:01.000Z',
      durationMs: 50,
      transferId: 'transfer-1',
      status: 'OK',
      spanCount: 2,
      sagaSteps: [{ step: 'place_hold', durationMs: 40 }],
    }]);
  });
});
