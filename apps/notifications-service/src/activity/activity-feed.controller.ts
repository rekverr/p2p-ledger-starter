import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/jwt-auth.guard';
import { ActivityFeedQueryDto } from './dto/activity-feed-query.dto';
import { ActivityFeedService } from './activity-feed.service';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityFeedController {
  constructor(private readonly activities: ActivityFeedService) {}

  @Get()
  list(
    @Request() request: AuthenticatedRequest,
    @Query() query: ActivityFeedQueryDto,
  ) {
    return this.activities.listForUser(request.user.userId, query);
  }
}
