/**
 * UI 프리미티브 모음.
 *
 * 화면 코드는 `@/components/ui` 하나만 import 하면 된다. 개별 경로
 * (`@/components/ui/button`)로 가져와도 동작하니 취향대로 쓰면 된다.
 *
 * 여기 있는 것 말고 새 프리미티브가 필요하면 이 폴더에 추가한다 —
 * 화면 폴더 안에 버튼을 또 만들면 두 벌의 디자인이 생긴다.
 */

export { Button, IconButton, buttonVariants, type ButtonProps } from './button';
export { Input, type InputProps } from './input';
export { Label, Field, FieldHint, type LabelProps } from './label';
export { Textarea, type TextareaProps } from './textarea';
export { Select, type SelectProps, type SelectOption } from './select';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardRow,
} from './card';
export { Badge, CountBadge, badgeVariants, type BadgeProps } from './badge';
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from './dialog';
export {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
  SheetClose,
  type SheetSide,
} from './sheet';
export { Tabs, TabsList, TabsTrigger, TabsContent, ChipGroup, Chip } from './tabs';
export { Skeleton, SkeletonText, SkeletonCard, SkeletonRow, SkeletonList } from './skeleton';
export { Spinner } from './spinner';
export { Separator, SectionDivider } from './separator';
export { Avatar } from './avatar';
export { EmptyState, ErrorState } from './empty-state';
export {
  ToastProvider,
  useToast,
  type ToastOptions,
  type ToastVariant,
} from './toast';
export { Countdown, DepositCountdown, useCountdown } from './countdown';
export {
  CompetitionRatioLine,
  CompetitionRatioBadge,
  CompetitionBar,
} from './competition-ratio';
export { DropdownMenu, DropdownHeader, DropdownItem, DropdownSeparator } from './dropdown';
export { Portal, useLockBodyScroll, useEscapeKey } from './portal';
