import { redirect } from 'next/navigation';

/** Legacy destination: report downloads now live inside Analytics & Reports. */
export default function Page() {
  redirect('/manage/analytics');
}
