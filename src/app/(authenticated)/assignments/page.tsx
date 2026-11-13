'use client';

import { useState, useEffect } from 'react';
import { Calendar, Truck, User, Navigation as NavIcon, Plus, CheckCircle2, AlertCircle, Loader2, StopCircle, Clock } from 'lucide-react';

interface Assignment {
  id: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleModel?: string;
  routeId: string;
  routeCode?: string;
  routeName: string;
  driverId: string;
  driverName: string;
  salespersonId: string;
  salespersonName: string;
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface OptionItem {
  id: string;
  label: string;
  code?: string;
  model?: string;
  role?: string;
}

interface OptionsData {
  vehicles: OptionItem[];
  routes: OptionItem[];
  drivers: OptionItem[];
  salespersons: OptionItem[];
}

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [options, setOptions] = useState<OptionsData>({
    vehicles: [],
    routes: [],
    drivers: [],
    salespersons: [],
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form State
  const [vehicleId, setVehicleId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().split('T')[0]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [assignRes, optRes] = await Promise.all([
        fetch('/api/assignments'),
        fetch('/api/assignments/options'),
      ]);

      if (assignRes.ok) {
        const assignData = await assignRes.json();
        setAssignments(assignData.data || []);
      }

      if (optRes.ok) {
        const optData = await optRes.json();
        setOptions(optData);

        // Pre-fill select defaults if available
        if (optData.vehicles?.length > 0 && !vehicleId) setVehicleId(optData.vehicles[0].id);
        if (optData.routes?.length > 0 && !routeId) setRouteId(optData.routes[0].id);
        if (optData.drivers?.length > 0 && !driverId) setDriverId(optData.drivers[0].id);
        if (optData.salespersons?.length > 0 && !salespersonId) setSalespersonId(optData.salespersons[0].id);
      }
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId || !routeId || !driverId || !salespersonId) {
      setStatusMessage({ type: 'error', text: 'Please select all required fields (vehicle, route, driver, salesperson).' });
      return;
    }

    try {
      setSubmitting(true);
      setStatusMessage(null);

      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          routeId,
          driverId,
          salespersonId,
          shiftDate,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start shift');
      }

      setStatusMessage({ type: 'success', text: data.message || 'Daily vehicle shift started successfully.' });
      setShowModal(false);
      await fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'An unexpected error occurred.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndShift = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to end this vehicle shift? Deliveries will no longer be accepted under this shift.')) {
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/assignments/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to end shift');
      }

      await fetchData();
    } catch (err: any) {
      alert(`Error ending shift: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Shift Administration</h1>
          <p className="text-sm text-slate-500 mt-1">
            Dispatch vehicles, assign daily routes, drivers, and sales reps to ensure full operational accountability.
          </p>
        </div>
        <button
          onClick={() => {
            setShowModal(true);
            setStatusMessage(null);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 transition"
        >
          <Plus className="h-4 w-4" />
          Start Daily Shift
        </button>
      </div>

      {/* Status Banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-lg flex items-center gap-3 text-sm ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Shifts List Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-900">Shift Assignments</h2>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {assignments.length} Total
          </span>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
            <p className="text-sm">Loading vehicle shift assignments...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <Truck className="h-10 w-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm">No vehicle shift assignments found.</p>
            <p className="text-xs text-slate-400 mt-1">Click "Start Daily Shift" above to assign a vehicle to a route.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-4">Route</th>
                  <th className="py-3 px-4">Driver</th>
                  <th className="py-3 px-4">Salesperson</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {assignment.isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          Active Shift
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                          Closed
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-900">
                      {assignment.shiftDate}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-slate-400" />
                        <div>
                          <div className="font-semibold text-slate-900">{assignment.vehiclePlate}</div>
                          {assignment.vehicleModel && (
                            <div className="text-xs text-slate-500">{assignment.vehicleModel}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <NavIcon className="h-4 w-4 text-slate-400" />
                        <div>
                          <div className="font-medium text-slate-900">{assignment.routeName}</div>
                          {assignment.routeCode && (
                            <div className="text-xs text-slate-500">{assignment.routeCode}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <User className="h-4 w-4 text-slate-400" />
                        <span>{assignment.driverName}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <User className="h-4 w-4 text-slate-400" />
                        <span>{assignment.salespersonName}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      {assignment.isActive ? (
                        <button
                          onClick={() => handleEndShift(assignment.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md hover:bg-rose-100 transition"
                        >
                          <StopCircle className="h-3.5 w-3.5 text-rose-600" />
                          End Shift
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {assignment.endedAt
                            ? `Ended ${new Date(assignment.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : 'Completed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Start Daily Shift Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Start Daily Shift</h3>
            <p className="text-xs text-slate-500 mb-5">
              Assign a registered vehicle and route to an active driver and sales representative.
            </p>

            <form onSubmit={handleStartShift} className="space-y-4">
              {/* Vehicle Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Vehicle (Registration Plate)
                </label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select a vehicle...</option>
                  {options.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} {v.model ? `(${v.model})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Route Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Route
                </label>
                <select
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select a delivery route...</option>
                  {options.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ? `[${r.code}] ` : ''}{r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Driver Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Driver
                </label>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select assigned driver...</option>
                  {options.drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Salesperson Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Field Salesperson
                </label>
                <select
                  value={salespersonId}
                  onChange={(e) => setSalespersonId(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select assigned salesperson...</option>
                  {options.salespersons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Shift Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Shift Date
                </label>
                <input
                  type="date"
                  value={shiftDate}
                  onChange={(e) => setShiftDate(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm Shift
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
