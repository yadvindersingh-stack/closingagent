'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Home, LogOut, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Transaction {
  id: string;
  property_address?: string;
  client_name?: string;
  file_number?: string;
  closing_date?: string;
  status?: string;
  created_at: string;

  client_email?: string | null;
  workflow_status?: string | null;
  client_intake_sent_at?: string | null;
  client_intake_completed_at?: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingTx, setCreatingTx] = useState(false);

  const loadTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTransactions((data || []) as Transaction[]);
    } catch (err) {
      console.error('Failed to load transactions', err);
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/'); // or your login route if different
    } catch (err) {
      console.error('Logout failed', err);
      toast.error('Failed to log out. Please try again.');
    }
  };

  const handleOpenTransaction = (id: string) => {
    router.push(`/dashboard/transactions/${id}`);
  };

  const handleCreateTransaction = async () => {
  try {
    setCreatingTx(true);
const { data: { user } } = await supabase.auth.getUser();

const res = await fetch('/api/transactions/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: user?.id,
  }),
});


    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok) {
      console.error('Create transaction failed:', res.status, body || text);
      throw new Error(body?.message || 'Failed to create transaction');
    }

    const id = body?.transaction?.id || body?.id;
    if (!id) {
      console.error('Create transaction response missing id:', body);
      throw new Error('Create succeeded but no transaction id returned');
    }

    router.push(`/dashboard/transactions/${id}`);
  } catch (e: any) {
    console.error('Create transaction failed', e);
    toast.error(e?.message || 'Failed to create transaction');
  } finally {
    setCreatingTx(false);
  }
};


  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-slate-600 mt-1">
            DealDesk AI · Ontario real estate files
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleCreateTransaction} disabled={creatingTx}>
            <Plus className="h-4 w-4 mr-1" />
            {creatingTx ? 'Creating…' : 'New Transaction'}
          </Button>

          <Button variant="outline" onClick={handleLogout} title="Log out">
            <LogOut className="h-4 w-4 mr-1" />
            Log out
          </Button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4" />
          <div className="h-32 bg-slate-200 rounded" />
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-slate-600">
            <p className="mb-4">No transactions yet.</p>
            <Button onClick={handleCreateTransaction} disabled={creatingTx}>
              <Plus className="h-4 w-4 mr-1" />
              {creatingTx ? 'Creating…' : 'Create your first transaction'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <Card
              key={tx.id}
              className="cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => handleOpenTransaction(tx.id)}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Home className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="font-medium">{tx.property_address || 'No address'}</p>
                    <p className="text-sm text-slate-600">
                      {tx.client_name || 'No client'} • {tx.file_number || 'No file #'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {tx.status && <Badge variant="secondary">{tx.status}</Badge>}
                  {tx.closing_date && (
                    <span className="text-xs text-slate-500">
                      Closing {new Date(tx.closing_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
