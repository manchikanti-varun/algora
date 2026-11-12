'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from './provider';
import { Button } from '@/components/ui/button';
export function SignOutButtons() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  async function signOut(all: boolean) {
    setBusy(true);
    try {
      await logout(all);
    } catch {
      toast.error('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sign-out-actions">
      <Button
        disabled={busy}
        variant="outline"
        onClick={() => void signOut(false)}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
      <Button
        disabled={busy}
        variant="ghost"
        onClick={() => void signOut(true)}
      >
        Sign out all devices
      </Button>
    </div>
  );
}
