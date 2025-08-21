// popup.js — Looker Studio parity + UX automations (2025-08-21)
// Matches the provided formulas/screenshots and wires automatic updates.
//
// Key behaviors
// - Orientation Type dropdown: Billable / Non Billable (default Non Billable @ 16.5/hr)
// - Sick Pay Hours auto-fills from Hours section: Contract Regular Hours / 30
// - When Pay to Candidate (W-2 hourly) changes, auto-sets OT (1.5x) and recomputes
// - Additional Pay hourlies auto-calc from one-time inputs and W-2/sick hours
// - GROSS MARGINS and WEEKLY BREAKDOWN match Looker Studio logic
//
// Expected element IDs in HTML (inputs):
//   client, bill_regular, bill_ot, pay_regular, pay_ot, hrs_regular, hrs_ot, contract_len,
//   house_daily, meals_daily, orient_type, orient_hours, orient_pay,
//   bonus_start, bonus_complete, bcg_reimb, sick_hours, schedule_days, auto_sick_calc
// Expected element IDs in HTML (outputs/text placeholders):
//   afterfee_regular, afterfee_ot,
//   np_tax_hourly, np_tax_daily, np_tax_weekly, np_tax_monthly,
//   np_nt_hourly, np_nt_daily, np_nt_weekly, np_nt_monthly,
//   np_total_hourly, np_total_daily, np_total_weekly, np_total_monthly,
//   gm_hourly, gm_weekly, gm_monthly, gm_contract,
//   bill_weekly, bill_monthly, bill_contract,
//   pkg_total_hourly, pkg_w2, pkg_w2_ot, pkg_stipend_hourly, pkg_ot_special,
//   pkg_weekly_gross, pkg_weekly_w2, pkg_weekly_stipend,
//   orient_total, orient_hourly,
//   hourly_start, hourly_complete, hourly_bcg, hourly_sick,
//   gaugeArc, gaugeValue, title, fee, reset
//
// NOTE: If some IDs are missing in HTML, those specific outputs will be skipped gracefully.

const CLIENT_FEES = {
  "SimpliFI": 0.06,
  "Careerstaff": 0.035,
  "Medical Solutions": 0.042,
  "AMN": 0.05,
  "HWL": 0.045,
  "Eisenhower Health": 0.038,
  "Focus One": 0.04,
  "Priority Group": 0.039,
  "Intermountain Health": 0.041,
  "AYA": 0.048,
  "NYCHH": 0.055,
  "Medefis": 0.043
};

const BURDEN = 1.23;           // Employer burden multiplier for W-2 and specified items
const WEEKS_IN_MONTH = 4;      // Per Looker Studio
const DEFAULT_SCHEDULE_DAYS = 5;

const el = id => document.getElementById(id);
const fmtUSD = v =>
  (isFinite(v) ? v : 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function valNum(id, fallback = 0) {
  const n = el(id);
  if (!n) return fallback;
  const v = parseFloat(n.value);
  return isFinite(v) ? v : fallback;
}
function setText(id, text) { const n = el(id); if (n) n.textContent = text; }
function setValue(id, value) { const n = el(id); if (n) n.value = value; }

function ensureClientSelector() {
  const clientSel = el("client");
  if (!clientSel) return;
  if (clientSel.options.length === 0) {
    Object.keys(CLIENT_FEES).forEach(c => {
      const o = document.createElement("option"); o.value = c; o.textContent = c; clientSel.appendChild(o);
    });
  }
  if (!clientSel.value) clientSel.value = "SimpliFI";
  const feeTxt = el("fee");
  if (feeTxt) feeTxt.textContent = "Fee: " + (CLIENT_FEES[clientSel.value]).toLocaleString("en-US", {style:"percent", minimumFractionDigits:2});
  const ttl = el("title"); if (ttl) ttl.textContent = clientSel.value + " Rate Calculator";
  clientSel.addEventListener("change", () => {
    if (feeTxt) feeTxt.textContent = "Fee: " + (CLIENT_FEES[clientSel.value]).toLocaleString("en-US", {style:"percent", minimumFractionDigits:2});
    if (ttl) ttl.textContent = clientSel.value + " Rate Calculator";
    recalc();
  });
}

function ensureOrientationControls() {
  const orientSel = el("orient_type");
  if (!orientSel) return;
  if (orientSel.options.length === 0) {
    ["Billable","Non Billable"].forEach(v => {
      const o = document.createElement("option"); o.value = o.textContent = v; orientSel.appendChild(o);
    });
  }
  if (!orientSel.value) orientSel.value = "Non Billable";
  const orientPay = el("orient_pay");
  if (orientSel.value === "Non Billable" && orientPay && (!orientPay.value || parseFloat(orientPay.value) === 0)) {
    orientPay.value = 16.5;
  }
  orientSel.addEventListener("change", () => {
    if (orientSel.value === "Non Billable" && orientPay) orientPay.value = 16.5;
    recalc();
  });
}

function ensureReset() {
  const resetBtn = el("reset");
  if (!resetBtn) return;
  resetBtn.addEventListener("click", () => {
    document.querySelectorAll("input").forEach(i => {
      if (!["orient_hours","orient_pay","pay_regular","pay_ot"].includes(i.id)) i.value = 0;
    });
    const clientSel = el("client"); if (clientSel) clientSel.value = "SimpliFI";
    const orientSel = el("orient_type"); if (orientSel) orientSel.value = "Non Billable";
    const orientPay = el("orient_pay"); if (orientPay) orientPay.value = 16.5;
    const sickBox = el("auto_sick_calc"); if (sickBox) sickBox.checked = true;
    recalc();
  });
}

function wireAutoSick() {
  const sickBox = el("auto_sick_calc");
  if (sickBox) {
    if (typeof sickBox.checked === "boolean" && sickBox.checked === false) {
      // leave as-is; user can toggle
    } else {
      sickBox.checked = true;
    }
    sickBox.addEventListener("change", recalc);
  }
}

function wirePayToCandidate() {
  const w2 = el("pay_regular");
  if (!w2) return;
  const ot = el("pay_ot");
  const sync = () => { if (ot) ot.value = (parseFloat(w2.value || "0") * 1.5 || 0).toFixed(2); };
  w2.addEventListener("input", () => { sync(); recalc(); });
  // initialize once
  sync();
}

function init() {
  ensureClientSelector();
  ensureOrientationControls();
  ensureReset();
  wireAutoSick();
  wirePayToCandidate();

  // Recalc on any input/select change
  document.querySelectorAll("input, select").forEach(i => i.addEventListener("input", recalc));
  recalc();
}

function recalc() {
  const client = el("client") ? el("client").value : "SimpliFI";
  const fee = CLIENT_FEES[client] || 0;

  // INPUTS
  const billR = valNum("bill_regular", 0);      // Bill Rate
  const billOTAdd = valNum("bill_ot", 0);       // OT addition to Bill Rate
  const payR = valNum("pay_regular", 0);        // W-2 hourly
  const hrsR = valNum("hrs_regular", 0);        // Standard hours/week (REG)
  const hrsOT = valNum("hrs_ot", 0);            // Regular OT hours per week
  const weeks = valNum("contract_len", 0);      // Contract duration in weeks
  const houseDaily = valNum("house_daily", 0);  // Housing Allowance Daily
  const mealsDaily = valNum("meals_daily", 0);  // Meals & Incidentals Daily
  const orientType = el("orient_type") ? el("orient_type").value : "Non Billable";
  const orientHours = valNum("orient_hours", 0);
  const orientPay = valNum("orient_pay", orientType === "Non Billable" ? 16.5 : 0);
  const bonusStart = valNum("bonus_start", 0);
  const bonusComplete = valNum("bonus_complete", 0);
  const bcgReimb = valNum("bcg_reimb", 0);
  const scheduleDays = valNum("schedule_days", DEFAULT_SCHEDULE_DAYS);

  // ---- Derived base values (Looker Studio mapping) ----

  // Rate after fee
  const hrAfterFee = billR * (1 - fee);
  const otHrAfterFee = (billR + billOTAdd) * (1 - fee);

  // Hourly stipend components
  const ND = houseDaily + mealsDaily;       // daily
  const NW = ND * 7;                         // weekly non-tax total
  const HA_hourly = hrsR > 40 ? (houseDaily * 7 / 40) : (hrsR > 0 ? (houseDaily * 7 / hrsR) : 0);
  const MI_hourly = hrsR > 40 ? (mealsDaily * 7 / 40) : (hrsR > 0 ? (mealsDaily * 7 / hrsR) : 0);
  const NH = hrsR > 40 ? (NW / 40) : (hrsR > 0 ? (NW / hrsR) : 0); // equals HA_hourly + MI_hourly

  // Contract Regular hours (per formula): schedule_days * weeks * 8
  const contractRegularHours = (scheduleDays * weeks * 8);
  // Contract OT hours (per formula): Regular OT hours per week * weeks
  const contractOTHours = (hrsOT * weeks);

  // Sick Pay Hours (auto if checkbox not present OR checked)
  const sickBox = el("auto_sick_calc");
  const autoSickHours = contractRegularHours / 30; // screenshot parity (not incl. OT)
  if (!sickBox || sickBox.checked) setValue("sick_hours", autoSickHours.toFixed(2));
  const sickHours = valNum("sick_hours", autoSickHours);

  // One-time hourlies
  const startBonusHourly = contractRegularHours > 0 ? (bonusStart / contractRegularHours) : 0;
  const completeBonusHourly = contractRegularHours > 0 ? (bonusComplete / contractRegularHours) : 0;
  const bcgHourly = contractRegularHours > 0 ? (bcgReimb / contractRegularHours) : 0;
  const sickHourly = contractRegularHours > 0 ? ((sickHours * payR) / contractRegularHours) : 0;

  // Orientation
  const orientPayRatePerHr = (orientType === "Billable")
    ? (payR + HA_hourly + MI_hourly)
    : 16.5;
  const totalOrientationPay = orientHours * orientPayRatePerHr;
  const orientationHourly = (orientType === "Non Billable" && contractRegularHours > 0)
    ? (totalOrientationPay / contractRegularHours)
    : 0;

  // Payroll (taxable)
  const PT_OVERTIME = payR * 1.5;                  // PT OVERTIME
  // OT if SH above 8h (based on per-day hours = hrsR / scheduleDays)
  const OT_if_above_8h = ((hrsR / Math.max(1, scheduleDays)) > 8)
    ? ((hrsR / Math.max(1, scheduleDays)) - 8)
    : 0;
  const OT_rate_if_above_40 = (hrsR > 40) ? (PT_OVERTIME + NH) : 0;

  // Weekly On W2 taxable
  const weeklyOnW2Taxable = (hrsR > 40)
    ? (((hrsR - OT_if_above_8h) * payR) + (OT_if_above_8h * OT_rate_if_above_40))
    : (hrsR * payR);

  // Weekly Stipend (Non-Taxable)
  const weeklyStipendNT = hrsR * NH;

  // Weekly Gross
  const weeklyGross = weeklyOnW2Taxable + weeklyStipendNT;

  // Client billing
  const weeklyBillingClient = (hrsR * hrAfterFee) + (hrsOT * otHrAfterFee);
  const monthlyBillingClient = (hrsR * 4 * hrAfterFee) + (hrsOT * otHrAfterFee);
  const contractBillingClient = weeklyBillingClient * weeks;

  // Hourly Margin
  const hourlyMargin =
    hrAfterFee
    - ((payR * BURDEN)                                         // W-2 burdened
      + (HA_hourly + MI_hourly + bcgHourly)                    // non-tax hourly + bcg (unburdened)
      + ((startBonusHourly + completeBonusHourly + sickHourly) * BURDEN) // one-time burdened
      + (orientType === "Non Billable" ? (orientationHourly * BURDEN) : 0) // non-billable orientation burdened
    );

  // NETs
  const weeklyNET = hourlyMargin * hrsR;
  const monthlyNET = weeklyNET * WEEKS_IN_MONTH;
  const contractNET = weeklyNET * weeks;

  // ---- Write back to UI ----

  // Rate after fee
  setText("afterfee_regular", fmtUSD(hrAfterFee));
  setText("afterfee_ot", fmtUSD(otHrAfterFee));

  // Auto-set OT pay (display next to W-2 input if present)
  setValue("pay_ot", (PT_OVERTIME).toFixed(2));

  // Nurse package
  setText("np_tax_hourly", fmtUSD(payR));                 // W-2 hourly
  setText("np_tax_daily", fmtUSD(payR * 8));              // PT Daily
  setText("np_tax_weekly", fmtUSD(hrsR * payR));          // PT weekly (base)
  setText("np_tax_monthly", fmtUSD(payR * (hrsR * WEEKS_IN_MONTH))); // PT monthly

  setText("np_nt_hourly", fmtUSD(NH));                    // Stripend hourly
  setText("np_nt_daily", fmtUSD(ND));                     // ND = HA + M&I (daily)
  setText("np_nt_weekly", fmtUSD(weeklyStipendNT));
  setText("np_nt_monthly", fmtUSD(weeklyStipendNT * WEEKS_IN_MONTH));

  setText("np_total_hourly", fmtUSD(payR + NH));          // TH
  setText("np_total_daily", fmtUSD((payR * 8) + ND));
  setText("np_total_weekly", fmtUSD(weeklyGross));
  setText("np_total_monthly", fmtUSD(weeklyGross * WEEKS_IN_MONTH));

  // Gross margins & billing
  setText("gm_hourly", fmtUSD(hourlyMargin));
  setText("gm_weekly", fmtUSD(weeklyNET));
  setText("gm_monthly", fmtUSD(monthlyNET));
  setText("gm_contract", fmtUSD(contractNET));
  setText("bill_weekly", fmtUSD(weeklyBillingClient));
  setText("bill_monthly", fmtUSD(monthlyBillingClient));
  setText("bill_contract", fmtUSD(contractBillingClient));

  // Package offered to nurse
  setText("pkg_total_hourly", fmtUSD(payR + NH));         // Total Hourly pay rate (TH)
  setText("pkg_w2", fmtUSD(payR));                        // On W2 (Taxable)
  setText("pkg_w2_ot", fmtUSD(PT_OVERTIME));              // On W2 (Taxable) OT
  setText("pkg_stipend_hourly", fmtUSD(NH));              // Stipend (Non-Taxable)
  setText("pkg_ot_special", fmtUSD(OT_rate_if_above_40)); // Special OT rate if SH>40
  setText("pkg_weekly_gross", fmtUSD(weeklyGross));       // Weekly Gross
  setText("pkg_weekly_w2", fmtUSD(weeklyOnW2Taxable));    // On W2 (Taxable) — weekly adj for >8h
  setText("pkg_weekly_stipend", fmtUSD(weeklyStipendNT)); // Stipend weekly

  // Orientation
  setText("orient_total", fmtUSD(totalOrientationPay));
  setText("orient_hourly", fmtUSD(orientationHourly));

  // Additional Pay (hourly)
  setText("hourly_start", fmtUSD(startBonusHourly));
  setText("hourly_complete", fmtUSD(completeBonusHourly));
  setText("hourly_bcg", fmtUSD(bcgHourly));
  setText("hourly_sick", fmtUSD(sickHourly));

  // Gauge
  renderGauge(hourlyMargin, 5);
}

function renderGauge(margin, target) {
  const arc = el("gaugeArc");
  const gv = el("gaugeValue");
  if (gv) gv.textContent = fmtUSD(margin);
  if (!arc) return;
  const r = 60;
  const circ = 2 * Math.PI * r;
  let progress = target > 0 ? (margin / target) : 0;
  progress = Math.max(0, Math.min(1, progress));
  const offset = circ - progress * circ;
  arc.setAttribute("stroke-dasharray", String(circ));
  arc.setAttribute("stroke-dashoffset", String(offset));
  arc.style.stroke = (margin >= target) ? "#28a745" : "#dc3545";
}

document.addEventListener("DOMContentLoaded", init);
