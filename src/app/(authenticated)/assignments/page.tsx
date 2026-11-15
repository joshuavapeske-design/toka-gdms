'use client';

import { useState, useEffect } from 'react';
import {
  Calendar,
  Truck,
  User,
  Users,
  Navigation as NavIcon,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  StopCircle,
  Clock,
  Layers,
  Package,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { formatKES } from '@/lib/decimal';
import type { Vehicle, VehicleAssignment } from '@/types';

interface OptionItem {
  id: string;
  label?: string;
  fullName?: string;
  registrationPlate?: string;
  code?: string;
  name?: string;
  model?: string;
  makeModel?: string;
  role?: string;
}

interface OptionsData {
  vehicles: OptionItem[];
  routes: OptionItem[];
  drivers: OptionItem[];
  salespersons: OptionItem[];
  allStaff?: OptionItem[];
}

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<VehicleAssignment[]>([]);
  const [vehiclesList, setVehiclesList] = useState<Vehicle[]>([]);
  const [productsList, setProductsList] = useState<any[]>([]);
  const [options, setOptions] = useState<OptionsData>({
    vehicles: [],
    routes: [],
    drivers: [],
    salespersons: [],
    allStaff: [],
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showLoadGlassModal, setShowLoadGlassModal] = useState(false);

  // Shift Form (2-3 Person Crew in Vehicle)
  const [shiftVehicleId, setShiftVehicleId] = useState('');
  const [shiftRouteId, setShiftRouteId] = useState('');
  const [shiftDriverId, setShiftDriverId] = useState('');
  const [shiftSalespersonId, setShiftSalespersonId] = useState('');
  const [shiftSecondarySalespersonId, setShiftSecondarySalespersonId] = useState('');
  const [shiftDate, setShiftDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Vehicle Registration Form (Owner / Manager adds owned vehicles)
  const [vehPlate, setVehPlate] = useState('');
  const [vehMakeModel, setVehMakeModel] = useState('');
  const [vehTonnage, setVehTonnage] = useState('10.0');
  const [vehOwnership, setVehOwnership] = useState<'owned' | 'leased' | 'contracted'>('owned');

  // Load Glass Form (Assign glass carried by vehicle)
  const [loadVehicleId, setLoadVehicleId] = useState('');
  const [loadProductId, setLoadProductId] = useState('');
  const [loadFullSheets, setLoadFullSheets] = useState(20);
  const [loadHalfSheets, setLoadHalfSheets] = useState(2);
  const [loadNotes, setLoadNotes] = useState('Morning vehicle sales loading');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [assignRes, optRes, vehRes, prodRes] = await Promise.all([
        fetch('/api/assignments'),
        fetch('/api/assignments/options'),
        fetch('/api/vehicles'),
        fetch('/api/data/products'),
      ]);

      if (assignRes.ok) {
        const assignData = await assignRes.json();
        setAssignments(assignData.data || []);
      }

      if (vehRes.ok) {
        const vehData = await vehRes.json();
        setVehiclesList(vehData.data || []);
      }

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setProductsList(prodData.data || []);
        if (prodData.data?.length > 0 && !loadProductId) {
          setLoadProductId(prodData.data[0].id);
        }
      }

      if (optRes.ok) {
        const optData = await optRes.json();
        const opts = optData.data || optData;
        setOptions(opts);

        if (opts.vehicles?.length > 0 && !shiftVehicleId) {
          setShiftVehicleId(opts.vehicles[0].id);
          setLoadVehicleId(opts.vehicles[0].id);
        }
        if (opts.routes?.length > 0 && !shiftRouteId) setShiftRouteId(opts.routes[0].id);
        if (opts.drivers?.length > 0 && !shiftDriverId) setShiftDriverId(opts.drivers[0].id);
        if (opts.salespersons?.length > 0 && !shiftSalespersonId) setShiftSalespersonId(opts.salespersons[0].id);
      }
    } catch (err) {
      console.error('Failed to load assignments data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 1. Start Shift Handler (Driver + 1-2 Sales reps in car)
  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftVehicleId || !shiftRouteId || !shiftDriverId || !shiftSalespersonId) {
      setStatusMessage({ type: 'error', text: 'Please select vehicle, route, driver, and primary salesperson.' });
      return;
    }

    try {
      setSubmitting(true);
      setStatusMessage(null);

      const crew = [shiftDriverId, shiftSalespersonId];
      if (shiftSecondarySalespersonId) crew.push(shiftSecondarySalespersonId);

      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: shiftVehicleId,
          routeId: shiftRouteId,
          driverId: shiftDriverId,
          salespersonId: shiftSalespersonId,
          secondarySalespersonId: shiftSecondarySalespersonId || null,
          crewIds: crew,
          shiftDate,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start shift');
      }

      setStatusMessage({
        type: 'success',
        text: data.message || 'Vehicle shift started with multi-person sales crew.',
      });
      setShowShiftModal(false);
      await fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'An unexpected error occurred.' });
    } finally {
      setSubmitting(false);
    }
  };

  // 2. Register Vehicle Handler (Owner/Manager adds fleet vehicle)
  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehPlate || !vehMakeModel) {
      setStatusMessage({ type: 'error', text: 'Plate and Make/Model are required.' });
      return;
    }

    try {
      setSubmitting(true);
      setStatusMessage(null);

      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationPlate: vehPlate,
          makeModel: vehMakeModel,
          tonnageCapacity: parseFloat(vehTonnage) || 10.0,
          ownershipType: vehOwnership,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to register vehicle');
      }

      setStatusMessage({ type: 'success', text: data.message || 'Vehicle added to fleet.' });
      setShowVehicleModal(false);
      setVehPlate('');
      setVehMakeModel('');
      await fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to register vehicle.' });
    } finally {
      setSubmitting(false);
    }
  };

  // 3. Load Glass onto Vehicle Handler (Assign glass carried)
  const handleLoadGlass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loadVehicleId || !loadProductId) {
      setStatusMessage({ type: 'error', text: 'Select vehicle and glass product.' });
      return;
    }

    try {
      setSubmitting(true);
      setStatusMessage(null);

      const res = await fetch('/api/vehicles/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: loadVehicleId,
          productId: loadProductId,
          fullSheets: Number(loadFullSheets) || 0,
          halfSheets: Number(loadHalfSheets) || 0,
          notes: loadNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load glass onto vehicle');
      }

      setStatusMessage({
        type: 'success',
        text: data.message || 'Glass successfully loaded onto vehicle for route sales.',
      });
      setShowLoadGlassModal(false);
      await fetchData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to load vehicle stock.' });
    } finally {
      setSubmitting(false);
    }
  };

  // 4. End Shift Handler
  const handleEndShift = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to end this shift? Deliveries will no longer be accepted under this run.')) {
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
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Header & Operational Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-600" />
            Fleet, Vehicle Glass Stock & Shift Dispatch
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Owner & Manager Control: Register owned vehicles, assign 2-3 person sales crews, and monitor the exact glass sheets carried on each truck.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => {
              setShowVehicleModal(true);
              setStatusMessage(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 shadow-xs transition"
          >
            <Plus className="h-3.5 w-3.5 text-slate-500" />
            Register Owned Vehicle
          </button>

          <button
            onClick={() => {
              setShowLoadGlassModal(true);
              setStatusMessage(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 shadow-xs transition"
          >
            <Layers className="h-3.5 w-3.5 text-blue-600" />
            Load Glass on Vehicle
          </button>

          <button
            onClick={() => {
              setShowShiftModal(true);
              setStatusMessage(null);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <Users className="h-4 w-4" />
            Dispatch Crew Shift (2-3 People)
          </button>
        </div>
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

      {/* SECTION 1: FLEET VEHICLES & ONBOARD GLASS CARRYING STATUS */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Fleet Vehicles & Onboard Glass Inventory</h2>
            <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
              Mobile Stock Tracking
            </span>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {vehiclesList.length} Vehicles in Fleet
          </span>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="py-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              Loading vehicle fleet & onboard stock...
            </div>
          ) : vehiclesList.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              <Truck className="h-8 w-8 mx-auto text-slate-300 mb-2" />
              <p className="text-xs">No vehicles registered yet.</p>
              <button
                onClick={() => setShowVehicleModal(true)}
                className="mt-2 text-xs text-blue-600 font-bold hover:underline"
              >
                Register First Vehicle
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {vehiclesList.map((v) => {
                const totalFse = (v.onboardStock || []).reduce((sum, s) => sum + (s.fseTotal || 0), 0);
                const activeShift = assignments.find((a) => a.vehicleId === v.id && a.isActive);

                return (
                  <div
                    key={v.id}
                    className="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition bg-slate-50/30 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black font-mono text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                              {v.registrationPlate}
                            </span>
                            <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {v.ownershipType || 'owned'} · {v.tonnageCapacity}T
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 mt-1 font-medium">{v.makeModel}</div>
                        </div>

                        {activeShift ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            On Route: {activeShift.routeName}
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                            In Depot / Ready
                          </span>
                        )}
                      </div>

                      {/* Onboard Glass Manifest */}
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="flex items-center justify-between text-xs mb-2">
                          <span className="font-bold text-slate-700 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-emerald-600" />
                            Assigned Glass Sheets on Truck:
                          </span>
                          <span className="font-mono text-xs font-black text-emerald-700">
                            Total: {totalFse.toFixed(1)} FSE
                          </span>
                        </div>

                        {v.onboardStock && v.onboardStock.length > 0 ? (
                          <div className="space-y-1.5">
                            {v.onboardStock.map((s, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200"
                              >
                                <span className="text-slate-800 font-medium truncate max-w-[220px]">
                                  {s.productName}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-slate-500">
                                    <strong className="text-slate-900">{s.fullSheets}</strong> FS ·{' '}
                                    <strong className="text-slate-900">{s.halfSheets}</strong> HS
                                  </span>
                                  <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                    {s.fseTotal.toFixed(1)} FSE
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 italic bg-white p-2.5 rounded-lg border border-dashed border-slate-200 text-center">
                            No glass currently loaded on this vehicle.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
                      <button
                        onClick={() => {
                          setLoadVehicleId(v.id);
                          setShowLoadGlassModal(true);
                          setStatusMessage(null);
                        }}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Load Glass onto {v.registrationPlate}
                      </button>

                      {!activeShift && (
                        <button
                          onClick={() => {
                            setShiftVehicleId(v.id);
                            setShowShiftModal(true);
                            setStatusMessage(null);
                          }}
                          className="text-xs font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                        >
                          Dispatch on Route <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: SHIFT ASSIGNMENTS & MULTI-PERSON CREW TABLE */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Shift Assignments & Multi-Person Vehicle Crews</h2>
            <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-bold">
              2-3 People In Car
            </span>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {assignments.length} Total Shifts
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
            <p className="text-xs text-slate-400 mt-1">Click "Dispatch Crew Shift" above to assign a 2-3 person crew.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Vehicle</th>
                  <th className="py-3 px-4">Route</th>
                  <th className="py-3 px-4">Driver (Person 1)</th>
                  <th className="py-3 px-4">Sales Crew (Person 2 & 3)</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="hover:bg-slate-50/50 transition">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {assignment.isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          Active Shift
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
                          Closed
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-900 font-mono">
                      {assignment.shiftDate}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-slate-400" />
                        <div>
                          <div className="font-bold text-slate-900">{assignment.vehiclePlate}</div>
                          {assignment.vehicleModel && (
                            <div className="text-[11px] text-slate-500">{assignment.vehicleModel}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <NavIcon className="h-4 w-4 text-slate-400" />
                        <div>
                          <div className="font-semibold text-slate-900">{assignment.routeName}</div>
                          {assignment.routeCode && (
                            <div className="text-[11px] text-slate-500 font-mono">{assignment.routeCode}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-800 font-medium">
                        <User className="h-3.5 w-3.5 text-slate-500" />
                        <span>{assignment.driverName}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-blue-900 font-bold">
                          <User className="h-3.5 w-3.5 text-blue-600" />
                          <span>Lead: {assignment.salespersonName}</span>
                        </div>
                        {assignment.secondarySalespersonName && (
                          <div className="flex items-center gap-1.5 text-indigo-700 text-[11px]">
                            <User className="h-3 w-3 text-indigo-500" />
                            <span>Sales 2: {assignment.secondarySalespersonName}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      {assignment.isActive ? (
                        <button
                          onClick={() => handleEndShift(assignment.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-md hover:bg-rose-100 transition"
                        >
                          <StopCircle className="h-3.5 w-3.5 text-rose-600" />
                          End Shift
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">
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

      {/* MODAL 1: START DAILY SHIFT (2-3 PEOPLE IN CAR) */}
      {showShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600" />
              Dispatch Vehicle Shift (2-3 Person Crew)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Glass delivery trucks operate with 2 to 3 people in the car (1 Driver + 1-2 Sales reps). When any crew member sells, the driver sees exactly who made the sale.
            </p>

            <form onSubmit={handleStartShift} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Vehicle
                </label>
                <select
                  value={shiftVehicleId}
                  onChange={(e) => setShiftVehicleId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select a vehicle...</option>
                  {options.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label || v.registrationPlate} {v.model || v.makeModel ? `(${v.model || v.makeModel})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Route
                </label>
                <select
                  value={shiftRouteId}
                  onChange={(e) => setShiftRouteId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select a delivery route...</option>
                  {options.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ? `[${r.code}] ` : ''}{r.label || r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Driver (Person 1)
                  </label>
                  <select
                    value={shiftDriverId}
                    onChange={(e) => setShiftDriverId(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  >
                    <option value="">Select driver...</option>
                    {options.drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label || d.fullName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Lead Salesperson (Person 2)
                  </label>
                  <select
                    value={shiftSalespersonId}
                    onChange={(e) => setShiftSalespersonId(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  >
                    <option value="">Select lead sales...</option>
                    {options.salespersons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.fullName} ({s.role || 'sales'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Second Salesperson / Assistant (Person 3 in car - Optional)
                </label>
                <select
                  value={shiftSecondarySalespersonId}
                  onChange={(e) => setShiftSecondarySalespersonId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">(Optional: Add second salesperson or loader)</option>
                  {(options.allStaff || options.salespersons).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.fullName} ({s.role || 'staff'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Shift Date</label>
                <input
                  type="date"
                  value={shiftDate}
                  onChange={(e) => setShiftDate(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowShiftModal(false)}
                  disabled={submitting}
                  className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Crew Shift
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: REGISTER OWNED VEHICLE */}
      {showVehicleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              Register Owned Fleet Vehicle
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Owner/Manager fleet onboarding: Register vehicles owned or contracted by TOKA Glass.
            </p>

            <form onSubmit={handleRegisterVehicle} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Registration Plate
                </label>
                <input
                  type="text"
                  placeholder="e.g. KBZ 123X or KDG 456Y"
                  value={vehPlate}
                  onChange={(e) => setVehPlate(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Make and Model
                </label>
                <input
                  type="text"
                  placeholder="e.g. Isuzu FRR 10-Tonne Glass Carrier"
                  value={vehMakeModel}
                  onChange={(e) => setVehMakeModel(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tonnage Capacity (T)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={vehTonnage}
                    onChange={(e) => setVehTonnage(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ownership Type
                  </label>
                  <select
                    value={vehOwnership}
                    onChange={(e) => setVehOwnership(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="owned">Owned Vehicle</option>
                    <option value="leased">Leased Vehicle</option>
                    <option value="contracted">Contracted Truck</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowVehicleModal(false)}
                  disabled={submitting}
                  className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Register Vehicle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: LOAD GLASS ONTO VEHICLE */}
      {showLoadGlassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              Load Glass Sheets on Vehicle
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Assign and load physical glass sheets carried by this vehicle for today's sales run.
            </p>

            <form onSubmit={handleLoadGlass} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Vehicle
                </label>
                <select
                  value={loadVehicleId}
                  onChange={(e) => setLoadVehicleId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select vehicle...</option>
                  {vehiclesList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationPlate} ({v.makeModel})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Glass Product Specification
                </label>
                <select
                  value={loadProductId}
                  onChange={(e) => setLoadProductId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                >
                  <option value="">Select glass product...</option>
                  {productsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} [{p.sku}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Sheets (1.0 FSE each)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={loadFullSheets}
                    onChange={(e) => setLoadFullSheets(parseInt(e.target.value) || 0)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Half Sheets (0.5 FSE each)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={loadHalfSheets}
                    onChange={(e) => setLoadHalfSheets(parseInt(e.target.value) || 0)}
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-xs text-emerald-800 flex items-center justify-between">
                <span>Calculated Mass / Equivalent:</span>
                <span className="font-extrabold font-mono text-sm">
                  {((Number(loadFullSheets) || 0) * 1.0 + (Number(loadHalfSheets) || 0) * 0.5).toFixed(1)} FSE
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Loading Notes</label>
                <input
                  type="text"
                  value={loadNotes}
                  onChange={(e) => setLoadNotes(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowLoadGlassModal(false)}
                  disabled={submitting}
                  className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Glass Load
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
