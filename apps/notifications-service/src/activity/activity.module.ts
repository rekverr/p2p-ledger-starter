import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthContextModule } from '../auth/auth-context.module';
import { ActivityFeedItem } from '../database/entities/activity-feed-item.entity';
import { ActivityFeedController } from './activity-feed.controller';
import { ActivityFeedService } from './activity-feed.service';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityFeedItem]), AuthContextModule],
  controllers: [ActivityFeedController],
  providers: [ActivityFeedService],
  exports: [ActivityFeedService],
})
export class ActivityModule {}
