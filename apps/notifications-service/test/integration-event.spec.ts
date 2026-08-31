import { parseIntegrationEvent } from '../src/messaging/integration-event';

describe('integration event contract', () => {
  it('requires a versioned envelope with aggregate identity', () => {
    expect(() => parseIntegrationEvent({ eventId: 'incomplete' })).toThrow(
      'Invalid event envelope',
    );
  });
});
