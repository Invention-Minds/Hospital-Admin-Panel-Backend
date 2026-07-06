import { Request, Response } from 'express';
import prisma from '../../service/prisma-client';

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function startOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/**
 * GET /api/dashboard/frontdesk/summary?date=YYYY-MM-DD
 *
 * Reception / Tele-caller / Front Desk persona. Operational view focused on
 * today's queue + reminder/contact status — not analytics. Single round-trip.
 */
export const getFrontDeskSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const dateParam = (req.query.date as string | undefined) || todayYmd();
    const todayStart = startOfDay(dateParam);
    const todayEnd = endOfDay(dateParam);

    // ─── All today's appointments (full payload — drives queue + KPIs) ─
    const todayAppts = await prisma.appointment.findMany({
      where: { date: dateParam },
      orderBy: { time: 'asc' },
      select: {
        id: true,
        patientName: true,
        phoneNumber: true,
        doctorId: true,
        doctorName: true,
        department: true,
        time: true,
        status: true,
        checkedIn: true,
        checkedInTime: true,
        arrived: true,
        arrivedTime: true,
        endConsultation: true,
        requestVia: true,
        smsSent: true,
        emailSent: true,
        messageSent: true,
        remainder1Sent: true,
        remainder2Sent: true,
        patientType: true,
        type: true,
      },
    });

    const booked = todayAppts.length;
    const arrived = todayAppts.filter((a) => a.arrived === true || a.checkedIn === true).length;
    const checkedIn = todayAppts.filter((a) => a.checkedIn === true).length;
    const cancelled = todayAppts.filter((a) => a.status === 'cancelled').length;

    // No-shows: past slot time, not checked-in, not cancelled. Uses 15-min grace.
    const now = new Date();
    const isToday = dateParam === todayYmd();
    const noShows = isToday
      ? todayAppts.filter((a) => {
          if (a.status === 'cancelled') return false;
          if (a.checkedIn || a.endConsultation) return false;
          const m = (a.time || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
          if (!m) return false;
          let h = parseInt(m[1], 10);
          const min = parseInt(m[2], 10);
          const period = (m[3] || '').toUpperCase();
          if (period === 'PM' && h < 12) h += 12;
          if (period === 'AM' && h === 12) h = 0;
          const apptMins = h * 60 + min;
          const nowMins = now.getHours() * 60 + now.getMinutes();
          return apptMins < nowMins - 15;
        }).length
      : 0;

    // Avg wait time right now (across all current "waiting" patients today).
    const nowMs = Date.now();
    const waitingNow = todayAppts.filter((a) => a.checkedIn && !a.endConsultation);
    const liveWaitSamples = waitingNow
      .map((a) => {
        if (!a.checkedInTime) return null;
        return Math.max(0, Math.floor((nowMs - new Date(a.checkedInTime).getTime()) / 60000));
      })
      .filter((n): n is number => n !== null);
    const avgWaitNow =
      liveWaitSamples.length > 0
        ? Math.round(liveWaitSamples.reduce((s, n) => s + n, 0) / liveWaitSamples.length)
        : null;

    // ─── Live queue rows (with computed wait) ───────────────────────────
    const queue = todayAppts.map((a) => {
      let waitMins: number | null = null;
      if (a.checkedIn && a.checkedInTime && !a.endConsultation) {
        waitMins = Math.max(0, Math.floor((nowMs - new Date(a.checkedInTime).getTime()) / 60000));
      }
      return {
        id: a.id,
        patientName: a.patientName,
        phoneNumber: a.phoneNumber,
        doctorName: a.doctorName,
        department: a.department,
        time: a.time,
        status: a.status,
        checkedIn: !!a.checkedIn,
        arrived: !!a.arrived,
        endConsultation: !!a.endConsultation,
        requestVia: a.requestVia || 'walk-in',
        waitMins,
        patientType: a.patientType,
        type: a.type,
        contactedAny: !!(a.smsSent || a.emailSent || a.messageSent || a.remainder1Sent || a.remainder2Sent),
      };
    });

    // ─── Hourly arrival pattern (today only) ────────────────────────────
    const hourBuckets = new Array(24).fill(0);
    for (const a of todayAppts) {
      const m = (a.time || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (!m) continue;
      let h = parseInt(m[1], 10);
      const period = (m[3] || '').toUpperCase();
      if (period === 'PM' && h < 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      if (h >= 0 && h < 24) hourBuckets[h]++;
    }
    const hourlyArrivals = hourBuckets.map((count, hour) => ({ hour, count }));

    // ─── Channel mix (today's requestVia distribution) ──────────────────
    const channelMap = new Map<string, number>();
    for (const a of todayAppts) {
      const ch = (a.requestVia || 'walk-in').trim().toLowerCase();
      channelMap.set(ch, (channelMap.get(ch) || 0) + 1);
    }
    const channelMix = Array.from(channelMap.entries()).map(([name, value]) => ({
      name,
      value,
    }));

    // ─── Reminder status counts (today) ─────────────────────────────────
    const reminderStatus = {
      smsSent: todayAppts.filter((a) => a.smsSent === true).length,
      emailSent: todayAppts.filter((a) => a.emailSent === true).length,
      whatsappSent: todayAppts.filter((a) => a.messageSent === true).length,
      total: todayAppts.length,
    };

    // ─── Callback queue (pending) ───────────────────────────────────────
    const pendingCallbacks = await prisma.callbackRequest.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        mobile: true,
        pageName: true,
        createdAt: true,
      },
    });
    const callbacks = pendingCallbacks.map((c) => ({
      id: c.id,
      name: c.name,
      mobile: c.mobile,
      source: c.pageName || '—',
      createdAt: c.createdAt.toISOString(),
    }));

    // ─── Waiting >30 min alert list ─────────────────────────────────────
    const waitingOver30 = queue
      .filter((q) => q.waitMins !== null && q.waitMins > 30)
      .map((q) => ({
        id: q.id,
        patientName: q.patientName,
        doctorName: q.doctorName,
        waitMins: q.waitMins as number,
      }));

    // ─── Doctor availability glance (today) ─────────────────────────────
    // Re-uses the existing doctor list. Just count active / out / leave by
    // checking unavailableDates for today.
    const allDoctors = await prisma.doctor.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        departmentName: true,
        roomNo: true,
        unavailableDates: {
          where: { date: { gte: todayStart, lte: todayEnd } },
          select: { id: true },
        },
      },
    });
    const doctorsOnLeaveToday = allDoctors
      .filter((d) => d.unavailableDates.length > 0)
      .map((d) => ({
        id: d.id,
        name: d.name,
        departmentName: d.departmentName,
      }));
    const doctorAvailability = {
      totalActive: allDoctors.length,
      onLeaveToday: doctorsOnLeaveToday.length,
      onLeaveList: doctorsOnLeaveToday,
    };

    // ─── Department booking distribution (today) ────────────────────────
    const deptMap = new Map<string, number>();
    for (const a of todayAppts) {
      const k = (a.department || 'Unspecified').trim();
      deptMap.set(k, (deptMap.get(k) || 0) + 1);
    }
    const deptBookingMix = Array.from(deptMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // ─── Top 5 busiest doctors today ────────────────────────────────────
    const docMap = new Map<number, { name: string; count: number }>();
    for (const a of todayAppts) {
      if (!a.doctorId) continue;
      const cur = docMap.get(a.doctorId);
      if (cur) cur.count++;
      else docMap.set(a.doctorId, { name: a.doctorName, count: 1 });
    }
    const busiestDoctors = Array.from(docMap.entries())
      .map(([doctorId, v]) => ({ doctorId, doctorName: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ─── New / Follow-up / Referral mix (today) ─────────────────────────
    let newCt = 0, followCt = 0, referralCt = 0, walkInCt = 0;
    for (const a of todayAppts) {
      const t = (a.patientType || a.type || '').toLowerCase();
      if (t.includes('referral') || t.includes('referred')) referralCt++;
      else if (t.includes('follow')) followCt++;
      else if (t.includes('new')) newCt++;
      else walkInCt++;
    }
    const patientMixToday = [
      { name: 'New', value: newCt },
      { name: 'Follow-up', value: followCt },
      { name: 'Referral', value: referralCt },
      { name: 'Other', value: walkInCt },
    ].filter((s) => s.value > 0);

    // ─── Tomorrow & day-after preview (count of bookings) ───────────────
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    function fmt(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const [tomorrowCount, dayAfterCount] = await Promise.all([
      prisma.appointment.count({ where: { date: fmt(tomorrow) } }),
      prisma.appointment.count({ where: { date: fmt(dayAfter) } }),
    ]);
    const upcomingPreview = {
      tomorrow: { date: fmt(tomorrow), count: tomorrowCount },
      dayAfter: { date: fmt(dayAfter), count: dayAfterCount },
    };

    res.json({
      date: dateParam,
      kpis: {
        booked,
        arrived,
        checkedIn,
        cancelled,
        noShows,
        pendingCallbacks: callbacks.length,
        avgWaitNow,
      },
      queue,
      hourlyArrivals,
      channelMix,
      reminderStatus,
      callbacks,
      waitingOver30,
      doctorAvailability,
      deptBookingMix,
      busiestDoctors,
      patientMixToday,
      upcomingPreview,
    });
  } catch (err) {
    console.error('[dashboard.frontdesk.summary] error:', err);
    res.status(500).json({ error: 'Failed to load front desk summary' });
  }
};
