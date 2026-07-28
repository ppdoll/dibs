'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { PartnerShell } from '@/components/layout';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { qk } from '@/lib/query-keys';
import { createBusiness } from '../../_lib/api';
import { BusinessForm, type BusinessFormValues } from '../../_components/business-form';
import { PartnerPageHeader } from '../../_components/partner-page';

export function NewBusinessView() {
  return (
    <PartnerShell>
      <NewBusinessBody />
    </PartnerShell>
  );
}

function NewBusinessBody() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { success } = useToast();

  const create = useMutation({
    mutationFn: (values: BusinessFormValues) => createBusiness(values),
    onSuccess: async (business) => {
      await queryClient.invalidateQueries({ queryKey: qk.partner.businesses.all });
      await queryClient.invalidateQueries({ queryKey: qk.partner.profile });
      success('사업자를 등록했어요', '이어서 사업자등록증을 올려 주세요.');
      router.push(`/partner/businesses/${business.id}`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PartnerPageHeader
        title="사업자 등록"
        description="사업자등록증에 적힌 내용 그대로 입력해 주세요. 확인이 끝나야 시설을 검수에 올릴 수 있어요."
        back={{ href: '/partner/businesses', label: '사업자 정보' }}
      />

      <Card>
        <CardContent className="p-4 md:p-6">
          <BusinessForm
            submitLabel="등록하기"
            submitting={create.isPending}
            error={create.error}
            onSubmit={(values) => create.mutate(values)}
            onCancel={() => router.push('/partner/businesses')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
