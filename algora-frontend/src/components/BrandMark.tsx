import { CodeXml } from 'lucide-react';

export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span aria-hidden className={large
      ? 'inline-grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-white'
      : 'inline-grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-white'}>
      <CodeXml size={large ? 25 : 19} />
    </span>
  );
}
