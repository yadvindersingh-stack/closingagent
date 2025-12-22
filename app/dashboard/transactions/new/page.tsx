'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { supabase, TransactionStatus } from '@/lib/supabase';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function NewTransactionPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    file_number: '',
    client_name: '',
    property_address: '',
    closing_date: '',
    client_email:'',
    status: 'NEW' as TransactionStatus,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('transactions')
        .insert([
          {
            user_id: user.id,
            workflow_status: 'TRANSACTION_CREATED',
            ...formData,
            
          },
        ])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Transaction created',
        description: `File #${formData.file_number} has been created successfully.`,
      });

      router.push(`/dashboard/transactions/${data.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push('/dashboard')} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <h2 className="text-3xl font-bold text-slate-900">Create New Transaction</h2>
          <p className="text-slate-600 mt-1">Add a new real estate transaction</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
            <CardDescription>Enter the information for the new transaction</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="file_number">File Number *</Label>
                <Input
                  id="file_number"
                  placeholder="e.g., 2024-001"
                  value={formData.file_number}
                  onChange={(e) => handleChange('file_number', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="client_name">Client Name *</Label>
                <Input
                  id="client_name"
                  placeholder="e.g., John Smith"
                  value={formData.client_name}
                  onChange={(e) => handleChange('client_name', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="property_address">Property Address *</Label>
                <Input
                  id="property_address"
                  placeholder="e.g., 123 Main St, Toronto, ON M5V 2T6"
                  value={formData.property_address}
                  onChange={(e) => handleChange('property_address', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="closing_date">Closing Date *</Label>
                <Input
                  id="closing_date"
                  type="date"
                  value={formData.closing_date}
                  onChange={(e) => handleChange('closing_date', e.target.value)}
                  required
                />
              </div>
              <div>
  <label className="block text-sm text-slate-600 mb-1">
    Client Email (recommended)
  </label>
  <input
    type="email"
    value={formData.client_email}
    onChange={(e) => handleChange('client_email', e.target.value)}
    className="w-full border rounded-md px-2 py-1 text-sm"
    placeholder="client@example.com"
  />
  <p className="text-xs text-slate-500 mt-1">
    Providing an email lets DealDesk auto-send the intake form.
  </p>
</div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={formData.status} onValueChange={(value) => handleChange('status', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW">New</SelectItem>
                    <SelectItem value="IN_REVIEW">In Review</SelectItem>
                    <SelectItem value="READY_TO_CLOSE">Ready to Close</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? 'Creating...' : 'Create Transaction'}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
