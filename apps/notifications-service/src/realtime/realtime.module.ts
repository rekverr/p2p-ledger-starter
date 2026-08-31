import { Module } from '@nestjs/common';
import { AuthContextModule } from '../auth/auth-context.module';
import { ActivityRealtimeGateway } from './activity-realtime.gateway';

@Module({
  imports: [AuthContextModule],
  providers: [ActivityRealtimeGateway],
  exports: [ActivityRealtimeGateway],
})
export class RealtimeModule {}
