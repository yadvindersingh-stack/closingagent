'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function LawyerApprovePage() {
  const params = useParams();
  const search = useSearchParams();
  const transactionId = params.id as string;
  const token = search.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!transactionId) return;
        const { data, error } = await supabase
          .from('transactions')
          .select('requisition_letter_draft_html,file_number')
          .eq('id', transactionId)
          .maybeSingle();

        if (error || !data) throw error || new Error('Not found');
        setHtml(data.requisition_letter_draft_html || '');
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || 'Failed to load requisition letter');
      } finally {
        setLoading(false);
      }
    })();
  }, [transactionId]);

  const canApprove = useMemo(() => !!token && !!html.trim(), [token, html]);

  const handleApprove = async () => {
    try {
      setSubmitting(true);
      const res = await fetch('/api/lawyer/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, token, editedHtml: html }),
      });

      const text = await res.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch {}

      if (!res.ok) throw new Error(body?.message || 'Approval failed');

      toast.success('Approved and sent to vendor solicitor');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Approve Requisition Letter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && (
            <p className="text-sm text-red-600">
              Missing token. Please use the approval link from email.
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-slate-600 mb-2">Edit HTML (minor edits)</p>
              <textarea
                className="w-full border rounded-md p-3 text-xs h-[520px] font-mono"
                value={html}
                onChange={(e) => setHtml(e.target.value)}
              />
            </div>

            <div>
              <p className="text-sm text-slate-600 mb-2">Preview</p>
              <div
                className="border rounded-md p-4 bg-white prose max-w-none h-[520px] overflow-auto"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>

          <Button disabled={!canApprove || submitting} onClick={handleApprove}>
            {submitting ? 'Approving & Sending…' : 'Approve & Send to Vendor Solicitor'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
