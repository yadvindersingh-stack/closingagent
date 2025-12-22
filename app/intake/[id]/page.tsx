'use client';

import { useState, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function IntakePage() {
  const params = useParams();
  const transactionId = params.id as string;

  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [idType, setIdType] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

 const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();

  if (!transactionId) {
    toast.error('Missing transactionId in intake link');
    return;
  }

  // ✅ Build the form object from existing state
  const form = {
    client_name: clientName,
    email,
    phone,
    current_address: currentAddress,
    id_type: idType,
    id_number: idNumber,
    notes,
  };

  // Basic sanity check (optional but helpful)
  const hasAnyValue = Object.values(form).some(
    (v) => v !== null && v !== undefined && String(v).trim() !== ''
  );

  if (!hasAnyValue) {
    toast.error('Please complete the form before submitting');
    return;
  }

  try {
    setSubmitting(true);

    const res = await fetch('/api/intake/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, form }),
    });

    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}

    if (!res.ok) {
  console.error('Intake submit failed:', res.status, body || text);
  toast.error('Submission may have succeeded. Please refresh the page to confirm.');
  return;
}

    toast.success('Client intake submitted');
    setSubmitted(true);
  } catch (err: any) {
    console.error('Intake submit error (client):', err);
    toast.error(err?.message || 'Failed to submit intake');
  } finally {
    setSubmitting(false);
  }
};



  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle>Thank you</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700">
              Your information has been submitted to your lawyer&apos;s office.
              They will review it and contact you if anything else is needed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="max-w-xl w-full">
        <CardHeader>
          <CardTitle>Client Intake Form</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full border rounded-md px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border rounded-md px-2 py-1 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Current Address
              </label>
              <textarea
                value={currentAddress}
                onChange={(e) => setCurrentAddress(e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  ID Type (e.g. Driver&apos;s License)
                </label>
                <input
                  type="text"
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="w-full border rounded-md px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">
                  ID Number
                </label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  className="w-full border rounded-md px-2 py-1 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-slate-600 mb-1">
                Additional Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border rounded-md px-2 py-1 text-sm"
                rows={3}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
