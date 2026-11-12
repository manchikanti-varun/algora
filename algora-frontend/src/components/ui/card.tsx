import { cn } from '@/lib/utils';
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn('card', className)} {...props} />;
}
