export class ExpectedStreamVersionError extends Error {
  constructor(
    readonly streamId: string,
    readonly expectedVersion: number,
    readonly actualVersion?: number,
  ) {
    super(
      actualVersion === undefined
        ? `Stream ${streamId} was concurrently modified; expected version ${expectedVersion}`
        : `Stream ${streamId} expected version ${expectedVersion}, actual version ${actualVersion}`,
    );
    this.name = ExpectedStreamVersionError.name;
  }
}

export class DuplicateEventIdError extends Error {
  constructor(readonly eventId?: string) {
    super(
      eventId
        ? `Event ${eventId} already exists`
        : 'An event with the same eventId already exists',
    );
    this.name = DuplicateEventIdError.name;
  }
}

export class StreamAggregateTypeError extends Error {
  constructor(
    readonly streamId: string,
    readonly expectedAggregateType: string,
    readonly actualAggregateType: string,
  ) {
    super(
      `Stream ${streamId} belongs to ${actualAggregateType}, not ${expectedAggregateType}`,
    );
    this.name = StreamAggregateTypeError.name;
  }
}
