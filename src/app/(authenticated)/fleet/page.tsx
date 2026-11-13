'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Truck, PlusCircle, Loader2, RefreshCw, XCircle, CheckCircle2, AlertCircle, Route } from 'lucide-react';

interface FleetEmployee {
  id: string;
  full_name: string;
  phone_number: string;
  role: 'driver' | 'salesperson';
}

interface FleetAssignment {
  id: string;
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  vehicle?: { registration_plate?: string; make_model?: string };
  route?: { code?: string; name?: string };
  driver?: { full_name?: string };
  salesperson?: { full_name?: string };
}

interface FleetData {
  vehicles: Array<{ id: string; registration_plate: string; make_model: string; tonnage_capacity: number; status: string }>;
  routes: Array<{ id: string; code: string; name: string }>;
  employees: FleetEmployee[];
  assignments: FleetAssignment[];
}

export default function FleetPage() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'manager';
  const [fleet, setFleet] = useState<FleetData>({ vehicles: [], routes: [], employees: [], assignments: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [registrationPlate, setRegistrationPlate] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [tonnageCapacity, setTonnageCapacity] = useState('10');
  const [routeCode, setRouteCode] = useState('');
  const [routeName, setRouteName] = useState('');
  const [routeDescription, setRouteDescription] = useState('');
  const [driverId, setDriverId] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [startedAt, setStartedAt] = useState('');

  const loadFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fleet', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to load fleet information.');
      setFleet(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load fleet information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void loadFleet();
  }, [canManage, loadFleet]);

  useEffect(() => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
    setShiftDate(today);
    const localDateTime = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setStartedAt(localDateTime);
  }, []);

  useEffect(() => {
    if (!driverId && fleet.employees.length) {
      setDriverId(fleet.employees.find((employee) => employee.role === 'driver')?.id || '');
    }
    if (!salespersonId && fleet.employees.length) {
      setSalespersonId(fleet.employees.find((employee) => employee.role === 'salesperson')?.id || '');
    }
  }, [fleet.employees, driverId, salespersonId]);

  const handleCreateAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!driverId || !salespersonId || driverId === salespersonId) {
      setError('Choose a different active driver and salesperson.');
      return;
    }
    if (!startedAt || !shiftDate) {
      setError('Select the shift date and start time.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationPlate,
          makeModel,
          tonnageCapacity: Number(tonnageCapacity),
          routeCode,
          routeName,
          routeDescription: routeDescription || undefined,
          driverId,
          salespersonId,
          shiftDate,
          startedAt: new Date(startedAt).toISOString(),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to create vehicle shift.');
      setMessage('Vehicle, route, truck stock location and crew assignment saved successfully.');
      setRegistrationPlate('');
      setMakeModel('');
      setRouteCode('');
      setRouteName('');
      setRouteDescription('');
      await loadFleet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create vehicle shift.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseShift = async (assignmentId: string) => {
    if (closingId) return;
    setClosingId(assignmentId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/fleet', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to close shift.');
      setMessage('Vehicle shift closed. The crew and vehicle can be assigned to a later shift.');
      await loadFleet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to close shift.');
    } finally {
      setClosingId(null);
    }
  };

  if (!canManage) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">Fleet and shift administration is restricted to owners and managers.</div>
      </div>
    );
  }

  const drivers = fleet.employees.filter((employee) => employee.role === 'driver');
  const salespeople = fleet.employees.filter((employee) => employee.role === 'salesperson');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2"><Truck className="w-5 h-5 text-blue-600" /> Fleet & Vehicle Shifts</h1>
          <p className="text-xs text-slate-500 mt-0.5">Set up vehicles, routes, crew and active daily assignments.</p>
        </div>
        <button onClick={() => void loadFleet()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
      {message && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs"><CheckCircle2 className="w-4 h-4 flex-shrink-0" />{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2 mb-1"><PlusCircle className="w-4 h-4 text-blue-600" /> Assign Vehicle & Crew</h2>
          <p className="text-xs text-slate-500 mb-4">Enter a vehicle and route. Existing records with the same registration plate or route code are reused.</p>

          {fleet.employees.length === 0 && !loading && (
            <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
              No active driver or salesperson profiles found. Create their Supabase Auth accounts and employee profiles before assigning a shift.
            </div>
          )}

          <form onSubmit={handleCreateAssignment} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Registration Plate</label>
                <input required maxLength={20} value={registrationPlate} onChange={(e) => setRegistrationPlate(e.target.value)} placeholder="e.g. KBC 456Y" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tonnage Capacity</label>
                <input required type="number" min="0.1" max="100" step="0.1" value={tonnageCapacity} onChange={(e) => setTonnageCapacity(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Vehicle Make / Model</label>
              <input required maxLength={100} value={makeModel} onChange={(e) => setMakeModel(e.target.value)} placeholder="e.g. Isuzu FRR Glass Carrier" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div className="border-t border-slate-100 pt-3">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2"><Route className="w-3.5 h-3.5" /> Route</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Route Code</label>
                  <input required maxLength={20} value={routeCode} onChange={(e) => setRouteCode(e.target.value)} placeholder="e.g. RT-02" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Route Name</label>
                  <input required maxLength={120} value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="e.g. Westlands - Parklands" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
              <input maxLength={500} value={routeDescription} onChange={(e) => setRouteDescription(e.target.value)} placeholder="Route description (optional)" className="w-full mt-3 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div className="border-t border-slate-100 pt-3">
              <h3 className="text-xs font-bold text-slate-800 mb-2">Assigned Crew</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Driver</label>
                  <select required value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                    <option value="">Select driver...</option>
                    {drivers.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Salesperson</label>
                  <select required value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                    <option value="">Select salesperson...</option>
                    {salespeople.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Shift Date (Nairobi)</label>
                <input type="date" required value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Shift Start Time</label>
                <input type="datetime-local" required value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
            </div>
            <button type="submit" disabled={submitting || loading || drivers.length === 0 || salespeople.length === 0} className="w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
              {submitting ? 'Saving Assignment...' : 'Create Vehicle Shift'}
            </button>
          </form>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-sm font-extrabold text-slate-900 mb-1">Vehicle Shift History</h2>
          <p className="text-xs text-slate-500 mb-4">Active and recently closed assignments.</p>
          {loading ? (
            <div className="py-10 text-center"><Loader2 className="w-7 h-7 animate-spin text-blue-600 mx-auto" /><p className="text-xs text-slate-500 mt-2">Loading assignments...</p></div>
          ) : fleet.assignments.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">No vehicle shifts have been created yet.</div>
          ) : (
            <div className="space-y-3">
              {fleet.assignments.map((assignment) => (
                <div key={assignment.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{assignment.vehicle?.registration_plate || 'Vehicle'} · {assignment.vehicle?.make_model || ''}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{assignment.route?.code} — {assignment.route?.name}</div>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${assignment.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                      {assignment.isActive ? 'Active' : 'Closed'}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                    <div><span className="text-slate-400">Driver:</span> {assignment.driver?.full_name || '—'}</div>
                    <div><span className="text-slate-400">Sales:</span> {assignment.salesperson?.full_name || '—'}</div>
                    <div><span className="text-slate-400">Shift date:</span> {assignment.shiftDate}</div>
                    <div><span className="text-slate-400">Started:</span> {new Date(assignment.startedAt).toLocaleTimeString('en-KE')}</div>
                  </div>
                  {assignment.endedAt && <div className="text-[10px] text-slate-400 mt-1">Ended {new Date(assignment.endedAt).toLocaleString('en-KE')}</div>}
                  {assignment.isActive && (
                    <div className="flex justify-end mt-3">
                      <button onClick={() => void handleCloseShift(assignment.id)} disabled={closingId === assignment.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold disabled:opacity-50">
                        {closingId === assignment.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                        Close Shift
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
