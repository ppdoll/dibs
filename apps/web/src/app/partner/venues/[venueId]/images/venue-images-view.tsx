'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { PartnerShell } from '@/components/layout';
import { qk } from '@/lib/query-keys';
import {
  createVenueImageTicket,
  deleteVenueImage,
  getVenue,
  listVenueImages,
  registerVenueImage,
  reorderVenueImages,
  setVenueImageCover,
  updateVenueImageAlt,
} from '../../../_lib/api';
import { ImageManager, type ImageAdapter, type ManagedImage } from '../../../_components/image-manager';
import { PartnerPageHeader } from '../../../_components/partner-page';
import { readImageSize, uploadToBlob } from '../../../_lib/blob';

/** 서버 상한(MAX_VENUE_IMAGES)과 같은 값이다. */
const MAX_VENUE_IMAGES = 20;

export function VenueImagesView({ venueId }: { venueId: string }) {
  return (
    <PartnerShell>
      <VenueImagesBody venueId={venueId} />
    </PartnerShell>
  );
}

function VenueImagesBody({ venueId }: { venueId: string }) {
  const venue = useQuery({
    queryKey: qk.partner.venues.detail(venueId),
    queryFn: () => getVenue(venueId),
    staleTime: 60_000,
  });

  const adapter = useMemo<ImageAdapter>(
    () => ({
      queryKey: qk.partner.venues.images(venueId),
      maxImages: MAX_VENUE_IMAGES,

      list: async (): Promise<ManagedImage[]> => {
        const rows = await listVenueImages(venueId);
        return rows
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => ({
            id: row.id,
            url: row.blobUrl,
            alt: row.altText,
            sortOrder: row.sortOrder,
            isCover: row.isCover,
            status: row.status,
            quarantineReason: row.quarantineReason,
          }));
      },

      // 3단계 업로드: 티켓(경로·용량·60초 만료가 못 박힌 토큰) → Blob 직접 PUT → 등록.
      // 해상도는 여기서 읽어 보낸다 — 서버가 디코딩하려면 네이티브 의존성이 필요하다.
      upload: async (file) => {
        const ticket = await createVenueImageTicket(venueId, file.type);
        const size = await readImageSize(file);
        const uploaded = await uploadToBlob({
          pathname: ticket.pathname,
          clientToken: ticket.clientToken,
          file,
        });
        return registerVenueImage(venueId, ticket.imageId, {
          blobUrl: uploaded.url,
          width: size.width,
          height: size.height,
        });
      },

      reorder: (imageIds) => reorderVenueImages(venueId, imageIds),
      setCover: (imageId) => setVenueImageCover(venueId, imageId),
      remove: (imageId) => deleteVenueImage(venueId, imageId),
      updateAlt: (imageId, altText) => updateVenueImageAlt(venueId, imageId, altText),
    }),
    [venueId],
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PartnerPageHeader
        title="시설 사진"
        description="검수를 요청하려면 대표 사진이 1장 이상 있어야 해요."
        back={{
          href: `/partner/venues/${venueId}`,
          label: venue.data?.name ?? '시설 상세',
        }}
      />

      <ImageManager adapter={adapter} />
    </div>
  );
}
