import { BookOpen } from 'lucide-react';
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <BookOpen size={32} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
export function Skeleton() {
  return <div className="skeleton" aria-label="Loading" />;
}
