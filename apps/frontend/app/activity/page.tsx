import { redirect } from 'next/navigation';
import { BffError, bffFetch } from '@/lib/api';
import { ActivityPage } from '@/lib/types';
import { ActivityFeed } from '@/components/activity-feed';

export default async function ActivityPageView() {
  let activity: ActivityPage;
  try {
    activity = await bffFetch<ActivityPage>('/activity?limit=20');
  } catch (error: unknown) {
    if (error instanceof BffError && error.status === 401) redirect('/login');
    throw error;
  }
  return <ActivityFeed initial={activity} />;
}
