'use client';

import { Bell, Mail } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, TopBar } from '@/components/layout';
import {
  Badge,
  Chip,
  EmptyState,
  ErrorState,
  SkeletonList,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/components/ui';
import { formatTimeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRequireAuth } from '@/providers/auth-provider';
import type { MessageItem, NotificationItem } from '@/types/api';

import { InfiniteSentinel } from '../_components/infinite-sentinel';
import {
  useMarkAllRead,
  useMarkMessageRead,
  useMarkNotificationRead,
  useMessages,
  useNotifications,
  useUnreadCountQuery,
} from '../_lib/queries';

/**
 * 알림 · 쪽지함.
 *
 * 하나로 합치지 않은 이유: 알림은 "내 신청에 무슨 일이 생겼다"(자동), 쪽지는
 * "사람이 나에게 보냈다"(수동)로 성격이 다르다. 섞으면 주최 측 공지가
 * 예약금 만료 알림에 묻힌다.
 *
 * ★ D-07 — 알림 문구는 서버가 만든 것을 그대로 띄운다. 프론트에서 문장을
 *   다시 조립하지 않는다. 조립하기 시작하면 "8만원에 밀리셨습니다" 같은
 *   커트라인 유출 문구가 언젠가 화면에서 만들어진다.
 */
export function NotificationsScreen() {
  const { isReady } = useRequireAuth();
  const [tab, setTab] = useState<'notifications' | 'messages'>('notifications');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const unread = useUnreadCountQuery(isReady);
  const toast = useToast();
  const markAll = useMarkAllRead();

  const notifications = useNotifications(unreadOnly, isReady && tab === 'notifications');
  const messages = useMessages(unreadOnly, isReady && tab === 'messages');

  const notificationItems = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  const messageItems = messages.data?.pages.flatMap((page) => page.items) ?? [];

  const onMarkAll = () => {
    markAll.mutate(tab, {
      onSuccess: (result) => {
        toast.success(
          result.updated > 0 ? `${result.updated}건을 읽음으로 표시했어요` : '모두 읽은 상태예요',
        );
      },
    });
  };

  return (
    <AppShell
      header={
        <TopBar
          title="알림"
          actions={
            <button
              type="button"
              onClick={onMarkAll}
              disabled={markAll.isPending}
              className="px-3 text-sm font-semibold text-muted-foreground disabled:opacity-50"
            >
              전체 읽음
            </button>
          }
        />
      }
    >
      <Tabs value={tab} onValueChange={(next) => setTab(next === 'messages' ? 'messages' : 'notifications')}>
        <TabsList className="-mx-4 px-4">
          <TabsTrigger value="notifications">
            알림
            {unread.data && unread.data.notifications > 0 ? (
              <span className="ml-1.5 text-primary">{unread.data.notifications}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="messages">
            쪽지
            {unread.data && unread.data.messages > 0 ? (
              <span className="ml-1.5 text-primary">{unread.data.messages}</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <div className="py-3">
          <Chip selected={unreadOnly} onClick={() => setUnreadOnly((prev) => !prev)}>
            안 읽은 것만
          </Chip>
        </div>

        <TabsContent value="notifications">
          {!isReady || notifications.isPending ? (
            <SkeletonList count={5} />
          ) : notifications.isError ? (
            <ErrorState onRetry={() => void notifications.refetch()} />
          ) : notificationItems.length === 0 ? (
            <EmptyState
              icon={<Bell className="h-6 w-6" aria-hidden="true" />}
              title={unreadOnly ? '안 읽은 알림이 없어요' : '아직 받은 알림이 없어요'}
              description="신청 결과와 예약금 안내를 여기로 보내드려요."
            />
          ) : (
            <>
              <ul className="space-y-2">
                {notificationItems.map((item) => (
                  <li key={item.id}>
                    <NotificationRow item={item} />
                  </li>
                ))}
              </ul>
              <InfiniteSentinel
                hasNextPage={notifications.hasNextPage}
                isFetchingNextPage={notifications.isFetchingNextPage}
                onLoadMore={() => void notifications.fetchNextPage()}
                endMessage="알림을 모두 봤어요"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="messages">
          {!isReady || messages.isPending ? (
            <SkeletonList count={5} />
          ) : messages.isError ? (
            <ErrorState onRetry={() => void messages.refetch()} />
          ) : messageItems.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-6 w-6" aria-hidden="true" />}
              title={unreadOnly ? '안 읽은 쪽지가 없어요' : '아직 받은 쪽지가 없어요'}
              description="주최 측이나 운영팀이 보낸 안내가 여기에 쌓여요."
            />
          ) : (
            <>
              <ul className="space-y-2">
                {messageItems.map((item) => (
                  <li key={item.id}>
                    <MessageRow item={item} />
                  </li>
                ))}
              </ul>
              <InfiniteSentinel
                hasNextPage={messages.hasNextPage}
                isFetchingNextPage={messages.isFetchingNextPage}
                onLoadMore={() => void messages.fetchNextPage()}
                endMessage="쪽지를 모두 봤어요"
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

/** 안 읽은 항목은 왼쪽에 점을 찍고 배경을 살짝 올린다. 색만으로 구분하지 않는다. */
function UnreadDot({ read }: { read: boolean }) {
  if (read) return null;
  return (
    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="읽지 않음" />
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  const markRead = useMarkNotificationRead();
  const read = item.readAt !== null;

  const body = (
    <div className="flex gap-2.5">
      <UnreadDot read={read} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm', read ? 'font-medium' : 'font-bold')}>{item.titleKo}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatTimeAgo(item.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {item.bodyKo}
        </p>
      </div>
    </div>
  );

  const className = cn(
    'block w-full rounded-lg border p-3.5 text-left transition-colors',
    read ? 'bg-card' : 'border-primary/25 bg-primary/5',
  );

  // 딥링크가 있으면 눌렀을 때 그리로 간다. 읽음 처리는 이동과 함께 조용히 보낸다.
  if (item.deepLinkPath) {
    return (
      <Link
        href={item.deepLinkPath}
        className={className}
        onClick={() => {
          if (!read) markRead.mutate(item.id);
        }}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (!read) markRead.mutate(item.id);
      }}
    >
      {body}
    </button>
  );
}

function MessageRow({ item }: { item: MessageItem }) {
  const markRead = useMarkMessageRead();
  const [expanded, setExpanded] = useState(false);
  const read = item.readAt !== null;

  return (
    // 버튼 안에 링크를 넣으면 안 된다(중첩 인터랙티브). 카드는 div 로 두고
    // 펼치기만 버튼이 맡는다. 관련 예약 링크는 버튼 밖에 따로 둔다.
    <div
      className={cn(
        'rounded-lg border transition-colors',
        read ? 'bg-card' : 'border-primary/25 bg-primary/5',
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((prev) => !prev);
          if (!read) markRead.mutate(item.id);
        }}
        className="block w-full p-3.5 text-left"
      >
        <div className="flex gap-2.5">
          <UnreadDot read={read} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className={cn('text-sm', read ? 'font-medium' : 'font-bold')}>{item.titleKo}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatTimeAgo(item.createdAt)}
              </span>
            </div>

            <div className="mt-1 flex items-center gap-1.5">
              <Badge variant="muted" size="sm">
                {item.kind === 'PARTNER_EVENT'
                  ? '주최자'
                  : item.kind === 'ADMIN_BROADCAST'
                    ? '공지'
                    : '운영팀'}
              </Badge>
              {item.senderDisplayName ? (
                <span className="truncate text-xs text-muted-foreground">
                  {item.senderDisplayName}
                </span>
              ) : null}
            </div>

            <p
              className={cn(
                'mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground',
                expanded ? '' : 'line-clamp-2',
              )}
            >
              {item.bodyKo}
            </p>
          </div>
        </div>
      </button>

      {item.eventId ? (
        <div className="px-3.5 pb-3.5 pl-[2.1rem]">
          <Link
            href={`/events/${encodeURIComponent(item.eventId)}`}
            className="text-xs font-semibold text-primary underline underline-offset-2"
          >
            관련 예약 보기
          </Link>
        </div>
      ) : null}
    </div>
  );
}
