# GDMS — GPS & Fleet Location Architecture (Corrected & Aligned)

## 1. Technical Realities & Platform Limitations

Modern mobile operating systems (particularly Android 11+ and iOS) aggressively throttle or terminate background processes to conserve battery and protect user privacy:
- In mobile Chrome or Safari, a browser tab running a Progressive Web App (PWA) has its JavaScript execution throttled within 30 seconds of screen lock or app switching, and suspended within 60–90 seconds.
- Standard Web Geolocation (`navigator.geolocation.watchPosition`) **cannot guarantee persistent, continuous background GPS tracking in a standard browser tab**.
- **Operational Guarantee**: GDMS does not make false promises about PWA capabilities. We implement a rigorous, three-tiered location tracking architecture.

> [!IMPORTANT]
> **Operational & Evidentiary Disclaimer**:
> GPS coordinates recorded on an employee's smartphone prove only the physical location of that device at a specific timestamp. **A GPS fix does not prove physical delivery of glass.** Physical verification requires customer confirmation via SMS, cargo handover sign-off, and inventory reconciliation.

---

## 2. Three Distinct Location Collection Mechanisms

```mermaid
graph TD
    subgraph Tier 1: Delivery Point-in-Time Stamp
        T1_UI[PWA / Mobile Client Form]
        T1_GEO[Browser / OS Geolocation API]
        T1_DEL[Captured at Delivery Submission]
        T1_UI --> T1_GEO --> T1_DEL
    end

    subgraph Tier 2: Employee Phone Foreground Tracking
        T2_CAP[Capacitor Native Android Shell]
        T2_NOTIF[Persistent Android Notification Icon]
        T2_FG[Android Foreground Service\nFOREGROUND_SERVICE_LOCATION]
        T2_BUF[Local SQLite / IndexedDB Buffer]
        T2_CAP --> T2_NOTIF --> T2_FG --> T2_BUF
    end

    subgraph Tier 3: Future Vehicle Hardware Tracker
        T3_DEV[Installed Vehicle GPS Hardware]
        T3_GW[Telemetry Ingestion Gateway / Traccar API]
        T3_DEV --> T3_GW
    end

    subgraph Central Persistent Store
        API[/api/telemetry/location]
        DB[(location_samples Table\nsource: phone_gps vs vehicle_tracker)]
    end

    T1_DEL -->|Attached to Delivery Payload| API
    T2_BUF -->|Batch Upload Every 5 Mins| API
    T3_GW -->|Direct Hardware Webhook| API
    API --> DB
```

### A. Tier 1: Delivery GPS Stamp (Universal PWA Mode)
- **Execution**: Triggered synchronously when the employee taps "Submit Delivery" or "Record Delivery Offline".
- **Data Captured**: Single high-accuracy GPS fix (`delivery_lat`, `delivery_lng`, `gps_accuracy_m`, `device_captured_at`).
- **Offline Resilience**: If offline, the coordinates are embedded directly in the delivery JSON stored in IndexedDB.

### B. Tier 2: Phone Background Tracking (Capacitor Android Native Shell)
- **Execution**: Runs exclusively inside an Android APK wrapper using Capacitor.
- **Android Foreground Service**: Operates with `FOREGROUND_SERVICE_LOCATION` permission and displays a mandatory, non-dismissible persistent notification in the Android system shade: *"GDMS active: Tracking delivery route."*
- **Sampling Rules**: Logs a breadcrumb coordinate every 3–5 minutes or upon significant distance displacement ($> 200$ metres).
- **Battery Optimization**: Uses Android FusedLocationProvider to minimize battery drain.

### C. Tier 3: Installed Vehicle GPS Tracker Boundary
- **Execution**: Commercial vehicles possess dedicated hardware GPS trackers wired to vehicle power.
- **Decoupled Gateway**: Hardware reports to an ingestion endpoint (`/api/telemetry/vehicle-tracker`) via HTTP webhook or Traccar socket.
- **Storage**: Telemetry records are stored in `location_samples` with `source = 'vehicle_tracker'`, allowing management to overlay employee phone breadcrumbs against actual vehicle movement.

---

## 3. Telemetry Schema & Timestamp Integrity

```sql
CREATE TABLE location_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    vehicle_assignment_id UUID REFERENCES vehicle_assignments(id) ON DELETE RESTRICT,
    latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10, 7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    accuracy_m NUMERIC(6, 2) NOT NULL CHECK (accuracy_m >= 0),
    source TEXT NOT NULL DEFAULT 'phone_gps' CHECK (source IN ('phone_gps', 'vehicle_tracker')),
    captured_at TIMESTAMPTZ NOT NULL, -- Original device capture time
    synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()) -- Server arrival time
);
```

### Preservation of Timestamps
- The system strictly preserves two timestamps for every location sample:
  1. `captured_at`: Hardware/GPS clock on device when fix was acquired.
  2. `synced_at`: Server clock when telemetry payload reached PostgreSQL.
- **Never Label Stale Data as Live**: If an employee uploads 4 hours of buffered offline breadcrumbs at 6:00 PM, the fleet dashboard displays them with historical timestamps. Only the latest sample is evaluated for fleet freshness.

---

## 4. Fleet Dashboard Freshness & Stale Indicators

Management views current fleet status with explicit freshness categories:

| Status Indicator | Data Age | Visual Appearance | Meaning & Operational Action |
|---|---|---|---|
| **Live Active** | $< 5$ minutes | Solid Green Pulse | Vehicle moving / communicating actively. |
| **Delayed** | $5 - 30$ minutes | Amber Badge | Network dead zone, driver stopped, or temporary app pause. |
| **Stale Warning** | $> 30$ minutes | Red Flashing Badge | Potential signal loss, app terminated, or device powered down. Displays *"Last seen: 42 mins ago"*. |
| **Tracking Disabled** | Permission revoked | Black Hazard Icon | Driver explicitly revoked location permissions. Alert triggered. |

---

## 5. Employee Transparency, Privacy & Compliance (KDPA)

- **Zero Covert Surveillance**: Location is collected strictly for business logistics, cargo security, and delivery routing.
- **Active Shift Binding**: Location sampling only begins when an employee starts a designated `vehicle_assignment` and terminates immediately when the shift is ended.
- **Permission Revocation Alerts**: If an employee disables GPS or revokes permissions mid-shift, an immediate warning event is transmitted to the Manager dashboard.
- **Data Retention**: Fine-grained raw GPS breadcrumbs are retained for 90 days for route optimization and audit investigations, after which they are archived or summarized.
