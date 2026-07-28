'use client';

import { ClipboardList, LogOut, Shield, Store, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownHeader,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/providers/auth-provider';

/**
 * 우상단 계정 영역. 로그인 전에는 로그인 버튼, 후에는 아바타 + 로그아웃.
 *
 * 드롭다운 대신 확인 모달을 쓰는 이유: 항목이 "로그아웃" 하나뿐이라
 * 메뉴를 만들 이유가 없고, 실수로 눌러 작업 중이던 이벤트 초안을
 * 잃는 편이 더 큰 손해다.
 *
 * compact 는 이용자 화면의 좁은 상단바(로고·검색·알림과 자리를 나눠 쓴다)용이다.
 * 별도 컴포넌트로 나누지 않은 이유는 로그아웃 확인 모달이 두 벌로 갈라지면
 * 한쪽만 고쳐지기 때문이다 — 실제로 확인을 건너뛰는 버전이 생기기 쉽다.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const {
    me,
    isAuthenticated,
    isLoading,
    isAdmin,
    isApprovedPartner,
    isPartnerPending,
    logout,
    login,
  } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // 로그인 여부를 알기 전에 "로그인"을 그렸다가 아바타로 바꾸면 깜빡인다.
  // 자리만 잡아 두고 판정이 끝나면 그린다.
  if (isLoading) {
    return <div className={compact ? 'h-11 w-11' : 'h-8 w-20'} aria-hidden="true" />;
  }

  if (!isAuthenticated) {
    return (
      <Button size="sm" variant={compact ? 'ghost' : 'outline'} onClick={() => login()}>
        로그인
      </Button>
    );
  }

  const onLogoutConfirm = async () => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  };

  if (compact) {
    return (
      <>
        <DropdownMenu
          menuLabel="내 계정"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-label={`${me?.displayName ?? '내 계정'} 메뉴`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent"
            >
              <Avatar name={me?.displayName} size="sm" />
            </button>
          )}
        >
          {(close) => (
            <>
              <DropdownHeader>
                <span className="block truncate font-semibold">{me?.displayName}</span>
                {me?.email ? (
                  <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
                ) : null}
              </DropdownHeader>

              {/* 역할에 따라 "지금 갈 만한 곳"을 맨 위에 둔다. 운영자와 파트너는
                  이용자 화면보다 자기 콘솔로 갈 일이 훨씬 잦다. */}
              {isAdmin && (
                <DropdownItem
                  href="/admin"
                  onClick={close}
                  icon={<Shield className="h-4 w-4" aria-hidden="true" />}
                  description="파트너 심사 · 공지 · 감사 로그"
                >
                  운영자 콘솔
                </DropdownItem>
              )}

              {isApprovedPartner ? (
                <DropdownItem
                  href="/partner"
                  onClick={close}
                  icon={<Store className="h-4 w-4" aria-hidden="true" />}
                  description="시설 · 이벤트 · 당첨자 발표"
                >
                  파트너 센터
                </DropdownItem>
              ) : isPartnerPending ? (
                <DropdownItem
                  href="/partner"
                  onClick={close}
                  icon={<Store className="h-4 w-4" aria-hidden="true" />}
                  description="심사 결과를 기다리는 중이에요"
                >
                  파트너 신청 현황
                </DropdownItem>
              ) : (
                <DropdownItem
                  href="/partner/apply"
                  onClick={close}
                  icon={<Store className="h-4 w-4" aria-hidden="true" />}
                  description="가게 자리를 열어 보세요"
                >
                  파트너 신청
                </DropdownItem>
              )}

              <DropdownSeparator />

              <DropdownItem
                href="/my/applications"
                onClick={close}
                icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}
              >
                내 신청 내역
              </DropdownItem>
              <DropdownItem
                href="/my"
                onClick={close}
                icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
              >
                내 정보
              </DropdownItem>

              <DropdownSeparator />

              <DropdownItem
                tone="danger"
                icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  close();
                  setConfirmOpen(true);
                }}
              >
                로그아웃
              </DropdownItem>
            </>
          )}
        </DropdownMenu>

        <LogoutConfirm
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          pending={pending}
          onConfirm={onLogoutConfirm}
        />
      </>
    );
  }

  const onLogout = async () => {
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Avatar name={me?.displayName} size="sm" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {me?.displayName}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmOpen(true)}
          aria-label="로그아웃"
          leadingIcon={<LogOut className="h-4 w-4" aria-hidden="true" />}
        >
          <span className="sr-only sm:not-sr-only">로그아웃</span>
        </Button>
      </div>

      <LogoutConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={pending}
        onConfirm={onLogout}
      />
    </>
  );
}

/**
 * 로그아웃 확인 모달.
 *
 * 로그아웃은 서버에서 tokenVersion 을 올려 **모든 기기의 토큰을 무효화**한다.
 * 다른 탭에서 작업 중이었다면 거기서도 튕기므로, 그 사실을 문구에 적어 둔다.
 */
function LogoutConfirm({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dismissible={!pending}>
        <DialogHeader>
          <DialogTitle>로그아웃할까요?</DialogTitle>
          <DialogDescription>
            열어 둔 다른 탭에서도 함께 로그아웃돼요. 작성 중인 내용이 있다면 저장한 뒤
            진행해 주세요.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            취소
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()} loading={pending}>
            로그아웃
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
