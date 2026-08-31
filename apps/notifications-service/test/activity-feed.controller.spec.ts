import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ActivityFeedController } from '../src/activity/activity-feed.controller';
import { ActivityFeedService } from '../src/activity/activity-feed.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('ActivityFeedController', () => {
  it('queries activity only for the authenticated principal', async () => {
    const activities = {
      listForUser: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const controller = new ActivityFeedController(
      activities as unknown as ActivityFeedService,
    );
    const query = { limit: 25, eventType: 'payments.transfer.Completed' };

    await controller.list(
      { user: { userId: 'user-1', email: 'a@example.com', role: 'user' } } as never,
      query,
    );

    expect(activities.listForUser).toHaveBeenCalledWith('user-1', query);
    expect(Reflect.getMetadata(GUARDS_METADATA, ActivityFeedController)).toEqual([
      JwtAuthGuard,
    ]);
  });
});
