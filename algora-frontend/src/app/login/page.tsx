'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoginFlow } from '@/components/LoginFlow';
function Inner() { return <LoginFlow mode="student" expired={useSearchParams().get('expired') === '1'} />; }
export default function Page() { return <Suspense><Inner /></Suspense>; }
