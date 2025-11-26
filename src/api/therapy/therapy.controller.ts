import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { addMinutes, parse, format } from "date-fns";
import { loadTherapyTv, loadTherapyTvForTherapist } from "../appointments/appointment.controller";
import { sendWhatsAppTemplate, buildPlaceholders, TEMPLATE } from "../whatsapp/whatsapp.controller";
import { sendSMS } from "../sms/sms.controller";

const prisma = new PrismaClient();

/**
 * Create new Ayurveda therapy appointment
 */
// export const createTherapyAppointment = async (req: Request, res: Response) => {
//   try {
//     const { name, phone, email, doctorId, therapistId, therapyId, roomNumber, date, time, prn, gender, age, prefix } = req.body;

//     // Calculate end time (75 mins later)
//     const startTime = parse(time, "HH:mm", new Date());
//     const endTime = format(addMinutes(startTime, 75), "HH:mm");

//     // // Check for slot conflict
//     const conflict = await prisma.therapyAppointment.findFirst({
//       where: {
//         roomNumber,
//         date,
//         OR: [
//           { time }
//         ],
//       },
//     });

//     if (conflict) {
//       res.status(400).json({ message: "Slot already booked for this room." });
//       return;
//     }

//     const appointment = await prisma.therapyAppointment.create({
//       data: {
//         prn,
//         name,
//         phone,
//         email,
//         doctorId,
//         therapistId,
//         therapyId,
//         roomNumber,
//         date,
//         time,
//         status: 'confirmed',
//         age,
//         gender,
//         prefix
//       },
//     });

//     res.status(201).json({ message: "Therapy appointment booked successfully", appointment });
//   } catch (error: any) {
//     console.error("Error booking therapy appointment:", error);
//     res.status(500).json({ error: "Failed to create therapy appointment" });
//   }
// };


export const createTherapyAppointment = async (req: Request, res: Response) => {
  try {
    const {
      prn, prefix, name, phone, email, gender, age,
      doctorId, therapyId, therapistIds, roomNumber, date, time, hasBathing, totalDurationMinutes
    } = req.body;

    if (!Array.isArray(therapistIds) || therapistIds.length === 0 || therapistIds.length > 2) {
      res.status(400).json({ message: "Please select 1 or 2 therapists." });
      return;
    }

    // Check conflict for each therapist
    const conflict = await prisma.therapyAppointmentTherapist.findFirst({
      where: {
        therapistId: { in: therapistIds },
        appointment: { date, time }
      },
      include: { therapist: true, appointment: true }
    });

    if (conflict) {
      res.status(400).json({
        message: `Therapist ${conflict.therapist.name} is already booked at ${date} ${time}.`
      });
      return
    }
    
    let therapyMinutes = 0;
    let cleaningMinutes = 0;
    let bathingMinutes = 0;

    if (hasBathing) {
      therapyMinutes = Math.round(totalDurationMinutes * 0.70);
      cleaningMinutes = Math.round(totalDurationMinutes * 0.15);
      bathingMinutes  = Math.round(totalDurationMinutes * 0.15);
    } else {
      therapyMinutes = Math.round(totalDurationMinutes * 0.85);
      cleaningMinutes = Math.round(totalDurationMinutes * 0.15);
      bathingMinutes = 0;
    }

    // Create appointment
    const appointment = await prisma.therapyAppointment.create({
      data: {
        prn, prefix, name, phone, email, gender, age,
        doctorId, therapyId, roomNumber, date, time,
        hasBathing,
        totalDurationMinutes,
        therapyDurationMinutes: therapyMinutes,
        cleaningDurationMinutes: cleaningMinutes,
        bathingDurationMinutes: bathingMinutes,
        status: "confirmed"
      }
    });

    console.log("Created appointment:", appointment);


    // Attach therapists
    await prisma.therapyAppointmentTherapist.createMany({
      data: therapistIds.map((tid: number) => ({
        appointmentId: appointment.id,
        therapistId: tid
      }))
    });

    // Fetch full appointment with all relations
    const fullAppointment = await prisma.therapyAppointment.findUnique({
      where: { id: appointment.id },
      include: {
        therapy: true,
        doctor: true,
        therapists: { include: { therapist: true } }
      }
    });

    if (!fullAppointment) {
      res.status(500).json({ message: "Failed to load appointment after creation" });
      return;
    }

    const doctorFull = fullAppointment.doctor;
    const therapistList = fullAppointment.therapists.map(t => t.therapist);
    
    // Combine names → "John, Mary"
    const combinedTherapistNames = therapistList.map(t => t.name).join(", ");
    

    // =====================
    // 1️⃣ PATIENT — ONE MESSAGE ONLY
    // =====================
    await sendWhatsAppTemplate(
      phone,
      TEMPLATE.PATIENT_CONFIRM,
      buildPlaceholders("PATIENT_CONFIRM", fullAppointment, combinedTherapistNames, doctorFull?.name ?? ""),
      fullAppointment.id
    );

    // =====================
    // 2️⃣ DOCTOR — ONE MESSAGE ONLY
    // =====================
    await sendWhatsAppTemplate(
      doctorFull?.phone_number ?? "",
      TEMPLATE.DOCTOR_CONFIRM,
      buildPlaceholders("DOCTOR_CONFIRM", fullAppointment, combinedTherapistNames, doctorFull?.name ?? "")
    );

    // =====================
    // 3️⃣ THERAPISTS — INDIVIDUAL MESSAGES
    // =====================
    for (const th of therapistList) {
      await sendWhatsAppTemplate(
        th.phoneNumber,
        TEMPLATE.THERAPIST_CONFIRM,
        buildPlaceholders("THERAPIST_CONFIRM", fullAppointment, th.name, doctorFull?.name ?? "")
      );
    }



    res.status(201).json({ message: "Appointment created", appointment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create appointment" });
  }
};


/**
 * Get all therapy appointments
 */
export const getAllTherapyAppointments = async (req: Request, res: Response) => {
  try {
    const appointments = await prisma.therapyAppointment.findMany({
      include: {
        doctor: true,
        therapy: true,
        therapists: { include: { therapist: true } }
      },
      orderBy: { date: "desc" }
    });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch therapy appointments" });
  }
};
// export const updateTherapyAppointment = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const {
//       prn,
//       prefix,
//       name,
//       phone,
//       email,
//       doctorId,
//       therapistId,
//       therapyId,
//       roomNumber,
//       date,
//       time,
//       age,
//       gender,
//       status,
//     } = req.body;

//     const existing = await prisma.therapyAppointment.findUnique({
//       where: { id: Number(id) },
//     });

//     if (!existing) {
//       res.status(404).json({ message: "Appointment not found" });
//       return;
//     }

//     const conflict = await prisma.therapyAppointment.findFirst({
//       where: {
//         roomNumber,
//         date,
//         time,
//         NOT: { id: Number(id) }, // exclude self
//       },
//     });
//     if (conflict) {
//       res.status(400).json({ message: "Slot already booked for this room." });
//       return;
//     }


//     const updated = await prisma.therapyAppointment.update({
//       where: { id: Number(id) },
//       data: {
//         prn,
//         prefix,
//         name,
//         phone,
//         email,
//         doctorId: Number(doctorId),
//         therapistId: Number(therapistId),
//         therapyId: Number(therapyId),
//         roomNumber,
//         date,
//         time,
//         age,
//         gender,
//         status,
//       },
//     });

//     res.json({ message: "Therapy appointment updated successfully", appointment: updated });
//   } catch (error) {
//     console.error("Error updating therapy appointment:", error);
//     res.status(500).json({ error: "Failed to update therapy appointment" });
//   }
// };

export const updateTherapyAppointment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      prn, prefix, name, phone, email, gender, age,
      therapistIds, doctorId, therapyId, roomNumber, date, time, status, totalDurationMinutes, hasBathing
    } = req.body;

    if (!Array.isArray(therapistIds) || therapistIds.length === 0 || therapistIds.length > 2) {
      res.status(400).json({ message: "Please select 1 or 2 therapists." });
      return
    }

    // conflict check
    const conflict = await prisma.therapyAppointmentTherapist.findFirst({
      where: {
        therapistId: { in: therapistIds },
        appointment: { date, time },
        NOT: { appointmentId: Number(id) }
      },
      include: { therapist: true }
    });

    if (conflict) {
      res.status(400).json({
        message: `Therapist ${conflict.therapist.name} is already booked.`
      });
      return;
    }
    let therapyMinutes = 0;
    let cleaningMinutes = 0;
    let bathingMinutes = 0;

    if (hasBathing) {
      therapyMinutes = Math.round(totalDurationMinutes * 0.70);
      cleaningMinutes = Math.round(totalDurationMinutes * 0.15);
      bathingMinutes  = Math.round(totalDurationMinutes * 0.15);
    } else {
      therapyMinutes = Math.round(totalDurationMinutes * 0.85);
      cleaningMinutes = Math.round(totalDurationMinutes * 0.15);
      bathingMinutes = 0;
    }

    const updated = await prisma.therapyAppointment.update({
      where: { id: Number(id) },
      data: {
        prn, prefix, name, phone, email, gender, age,
        doctorId, therapyId, roomNumber, date, time, status,
        totalDurationMinutes,
        therapyDurationMinutes: therapyMinutes,
        cleaningDurationMinutes: cleaningMinutes,
        bathingDurationMinutes: bathingMinutes,
        hasBathing,
      }
    });
    // Remove old therapists
    await prisma.therapyAppointmentTherapist.deleteMany({
      where: { appointmentId: updated.id }
    });

    // Insert new therapists
    await prisma.therapyAppointmentTherapist.createMany({
      data: therapistIds.map((tid: number) => ({
        appointmentId: updated.id,
        therapistId: tid
      }))
    });

    const appointment = await prisma.therapyAppointment.findUnique({
      where: { id: updated.id },
      include: {
        therapy: true,
        doctor: true,
        therapists: { include: { therapist: true } }
      }
    });

    if (!appointment) {
      res.status(500).json({ message: "Unable to load updated appointment." });
      return;
    }

    // Fetch doctor
    const doctor = await prisma.doctor.findUnique({
      where: { id: appointment.doctorId ?? undefined }
    });

    // Fetch updated therapists
    const thList = await prisma.therapyAppointmentTherapist.findMany({
      where: { appointmentId: appointment.id },
      include: { therapist: true }
    });

    // Combine names → "John, Mary"
    const combinedTherapistNames = thList.map(t => t.therapist.name).join(", ");

    // =======================
    // 1️⃣ PATIENT - ONE MESSAGE
    // =======================
    await sendWhatsAppTemplate(
      appointment.phone,
      TEMPLATE.PATIENT_RESCHEDULE,
      buildPlaceholders("PATIENT_RESCHEDULE", appointment, combinedTherapistNames, doctor?.name ?? ""),
      appointment.id
    );

    // =======================
    // 2️⃣ DOCTOR - ONE MESSAGE
    // =======================
    await sendWhatsAppTemplate(
      doctor?.phone_number ?? "",
      TEMPLATE.DOCTOR_RESCHEDULE,
      buildPlaceholders("DOCTOR_RESCHEDULE", appointment, combinedTherapistNames, doctor?.name ?? "")
    );

    // =======================
    // 3️⃣ THERAPISTS - INDIVIDUAL MESSAGES
    // =======================
    for (const item of thList) {
      const th = item.therapist;

      await sendWhatsAppTemplate(
        th.phoneNumber,
        TEMPLATE.THERAPIST_RESCHEDULE,
        buildPlaceholders("THERAPIST_RESCHEDULE", appointment, th.name, doctor?.name ?? "")
      );
    }



    res.json({ message: "Appointment updated", updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update appointment" });
  }
};

export const getConfirmedAppointments = async (req: Request, res: Response) => {
  try {
    const appointments = await prisma.therapyAppointment.findMany({
      where: { status: "confirmed" },
      orderBy: { date: "desc" },

      include: {
        therapy: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true } },

        therapists: {
          include: {
            therapist: { select: { id: true, name: true } }
          }
        }
      }
    });

    // Format for frontend
    const formatted = appointments.map(appt => ({
      id: appt.id,
      prn: appt.prn,
      prefix: appt.prefix,
      name: appt.name,
      phone: appt.phone,
      email: appt.email,
      gender: appt.gender,
      age: appt.age,
      date: appt.date,
      time: appt.time,
      roomNumber: appt.roomNumber,
      status: appt.status,
      checkedIn: appt.checkedIn,
      reminderSent: appt.reminderSent,
      createdAt: appt.createdAt,
      updatedAt: appt.updatedAt,
      whatsappSent: appt.whatsappSent,
      emailSent: appt.emailSent,
      smsSent: appt.smsSent,

      doctorId: appt.doctorId,
      therapyId: appt.therapyId,

      doctorName: appt.doctor?.name || null,
      therapyName: appt.therapy?.name || null,

      totalDurationMinutes: appt.totalDurationMinutes,
      therapyDurationMinutes: appt.therapyDurationMinutes,
      cleaningDurationMinutes: appt.cleaningDurationMinutes,
      bathingDurationMinutes: appt.bathingDurationMinutes,
      hasBathing: appt.hasBathing,

      // return list of therapists like: [{id, name}, ...]
      therapists: appt.therapists.map(t => ({
        id: t.therapist.id,
        name: t.therapist.name,
      }))
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch confirmed appointments" });
  }
};




export const getCancelledAppointments = async (req: Request, res: Response) => {
  try {
    const appointments = await prisma.therapyAppointment.findMany({
      where: { status: "cancelled" },
      orderBy: { date: "desc" },

      include: {
        therapy: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true } },

        therapists: {
          include: {
            therapist: { select: { id: true, name: true } }
          }
        }
      }
    });

    // Format for frontend
    const formatted = appointments.map(appt => ({
      id: appt.id,
      prn: appt.prn,
      prefix: appt.prefix,
      name: appt.name,
      phone: appt.phone,
      email: appt.email,
      gender: appt.gender,
      age: appt.age,
      date: appt.date,
      time: appt.time,
      roomNumber: appt.roomNumber,
      status: appt.status,
      checkedIn: appt.checkedIn,
      reminderSent: appt.reminderSent,
      createdAt: appt.createdAt,
      updatedAt: appt.updatedAt,
      whatsappSent: appt.whatsappSent,
      emailSent: appt.emailSent,
      smsSent: appt.smsSent,

      doctorId: appt.doctorId,
      therapyId: appt.therapyId,

      doctorName: appt.doctor?.name || null,
      therapyName: appt.therapy?.name || null,

      totalDurationMinutes: appt.totalDurationMinutes,
      therapyDurationMinutes: appt.therapyDurationMinutes,
      cleaningDurationMinutes: appt.cleaningDurationMinutes,
      bathingDurationMinutes: appt.bathingDurationMinutes,
      hasBathing: appt.hasBathing,

      // return list of therapists like: [{id, name}, ...]
      therapists: appt.therapists.map(t => ({
        id: t.therapist.id,
        name: t.therapist.name,
      }))
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cancelled appointments" });
  }
};



export const getCompletedAppointments = async (req: Request, res: Response) => {
  try {
    const appointments = await prisma.therapyAppointment.findMany({
      where: { status: "completed" },
      orderBy: { date: "desc" },

      include: {
        therapy: { select: { id: true, name: true } },
        doctor: { select: { id: true, name: true } },

        therapists: {
          include: {
            therapist: { select: { id: true, name: true } }
          }
        }
      }
    });

    // Format for frontend
    const formatted = appointments.map(appt => ({
      id: appt.id,
      prn: appt.prn,
      prefix: appt.prefix,
      name: appt.name,
      phone: appt.phone,
      email: appt.email,
      gender: appt.gender,
      age: appt.age,
      date: appt.date,
      time: appt.time,
      roomNumber: appt.roomNumber,
      status: appt.status,
      checkedIn: appt.checkedIn,
      reminderSent: appt.reminderSent,
      createdAt: appt.createdAt,
      updatedAt: appt.updatedAt,
      whatsappSent: appt.whatsappSent,
      emailSent: appt.emailSent,
      smsSent: appt.smsSent,

      doctorId: appt.doctorId,
      therapyId: appt.therapyId,

      doctorName: appt.doctor?.name || null,
      therapyName: appt.therapy?.name || null,

      totalDurationMinutes: appt.totalDurationMinutes,
      therapyDurationMinutes: appt.therapyDurationMinutes,
      cleaningDurationMinutes: appt.cleaningDurationMinutes,
      bathingDurationMinutes: appt.bathingDurationMinutes,
      hasBathing: appt.hasBathing,

      // return list of therapists like: [{id, name}, ...]
      therapists: appt.therapists.map(t => ({
        id: t.therapist.id,
        name: t.therapist.name,
      }))
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch cancelled appointments" });
  }
};

/**
 * Check-in functionality
 */
export const checkInTherapyAppointment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const appointment = await prisma.therapyAppointment.update({
      where: { id: Number(id) },
      data: {
        checkedIn: true,
        checkedInTime: new Date(),
        checkedInBy: req.body.checkedInBy || "Receptionist",
      },
      include: { therapists: true },
    });

    const therapistIds = appointment.therapists.map(t => t.therapistId);

    therapistIds.map(async (therapistId) => {
      loadTherapyTvForTherapist(therapistId);
    });

    loadTherapyTv(1);


    res.json({ message: "Patient checked in successfully", appointment });
  } catch (error) {
    res.status(500).json({ error: "Failed to check in patient" });
  }
};


/**
 * Cancel a therapy appointment
 */
export const cancelTherapyAppointment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cancelledBy } = req.body;

    if (!id) {
      res.status(400).json({ message: "Appointment ID is required" });
      return;
    }

    const existing = await prisma.therapyAppointment.findUnique({
      where: { id: Number(id) },
    });

    if (!existing) {
      res.status(404).json({ message: "Appointment not found" });
      return;
    }

    // If it's already cancelled, don't cancel again
    if (existing.status === "cancelled") {
      res.status(400).json({ message: "Appointment is already cancelled" });
      return;
    }

    const updated = await prisma.therapyAppointment.update({
      where: { id: Number(id) },
      data: {
        status: "cancelled",
        cancelledBy: cancelledBy || "System",
        cancelledAt: new Date(),
      },
    });
    const appointment = await prisma.therapyAppointment.findUnique({
      where: { id: updated.id },
      include: {
        therapy: true,
        doctor: true,
        therapists: { include: { therapist: true } }
      }
    });
    if (!appointment) {
      res.status(500).json({ message: "Failed to load appointment after update" });
      return;
    }
    const doctor = await prisma.doctor.findUnique({
      where: { id: appointment.doctorId ?? undefined }
    });

    const thList = await prisma.therapyAppointmentTherapist.findMany({
      where: { appointmentId: appointment.id },
      include: { therapist: true }
    });

    // Combine names → "John, Mary"
    const combinedTherapistNames = thList.map(t => t.therapist.name).join(", ");

    // =======================
    // 1️⃣ PATIENT - ONE MESSAGE
    // =======================
    await sendWhatsAppTemplate(
      appointment.phone,
      TEMPLATE.PATIENT_CANCEL,
      buildPlaceholders("PATIENT_CANCEL", appointment, combinedTherapistNames, doctor?.name ?? ""),
      appointment.id
    );

    // =======================
    // 2️⃣ DOCTOR - ONE MESSAGE
    // =======================
    await sendWhatsAppTemplate(
      doctor?.phone_number ?? "",
      TEMPLATE.DOCTOR_CANCEL,
      buildPlaceholders("DOCTOR_CANCEL", appointment, combinedTherapistNames, doctor?.name ?? "")
    );

    // =======================
    // 3️⃣ THERAPISTS - INDIVIDUAL MESSAGES
    // =======================
    for (const item of thList) {
      const th = item.therapist;

      await sendWhatsAppTemplate(
        th.phoneNumber,
        TEMPLATE.THERAPIST_CANCEL,
        buildPlaceholders("THERAPIST_CANCEL", appointment, th.name, doctor?.name ?? "")
      );
    }



    res.json({ message: "Appointment cancelled successfully", appointment: updated });
  } catch (error) {
    console.error("Error cancelling therapy appointment:", error);
    res.status(500).json({ error: "Failed to cancel therapy appointment" });
  }
};


/**
 * Send reminders (to be called via cron every minute)
 */
export const sendTherapyReminders = async () => {
  const now = new Date();
  const currentTime = format(now, "HH:mm");

  const upcomingAppointments = await prisma.therapyAppointment.findMany({
    where: {
      reminderSent: false,
      date: format(now, "yyyy-MM-dd"),
    },
  });

  for (const appt of upcomingAppointments) {
    const slotTime = parse(appt.time, "HH:mm", new Date());
    const reminderTime = addMinutes(slotTime, -15);


    console.log(now, reminderTime, slotTime);

    if (now >= reminderTime && now < slotTime) {
      // console.log(`📩 Sending reminder to ${appt.name}, Doctor ${appt.doctorId}, Therapist ${appt.therapistId}`);

      // 🔥 Fetch full appointment with all relations
      const fullAppointment = await prisma.therapyAppointment.findUnique({
        where: { id: appt.id },
        include: {
          therapy: true,
          doctor: true,
          therapists: { include: { therapist: true } }
        }
      });

      if (!fullAppointment) {
        console.error("❌ Full appointment not found for ID:", appt.id);
        continue;
      }

      const doctor = fullAppointment.doctor;
      const therapistList = fullAppointment.therapists.map(t => t.therapist);

      const combinedTherapistNames = therapistList
        .map(t => t.name)
        .join(", ");

      // =======================
      // 1️⃣ PATIENT - ONE REMINDER
      // =======================
      await sendWhatsAppTemplate(
        fullAppointment.phone,
        TEMPLATE.PATIENT_REMINDER,
        buildPlaceholders(
          "PATIENT_REMINDER",
          fullAppointment,
          combinedTherapistNames,
          doctor?.name ?? ""
        )
      );

      // =======================
      // 2️⃣ DOCTOR - ONE REMINDER
      // =======================
      if (doctor?.phone_number) {
        await sendWhatsAppTemplate(
          doctor.phone_number,
          TEMPLATE.DOCTOR_REMINDER,
          buildPlaceholders(
            "DOCTOR_REMINDER",
            fullAppointment,
            combinedTherapistNames,
            doctor?.name ?? ""
          )
        );
      }

      // =======================
      // 3️⃣ THERAPISTS - INDIVIDUAL REMINDERS
      // =======================
      for (const th of therapistList) {
        await sendWhatsAppTemplate(
          th.phoneNumber ?? th.phoneNumber ?? "",
          TEMPLATE.THERAPIST_REMINDER,
          buildPlaceholders(
            "THERAPIST_REMINDER",
            fullAppointment,
            th.name,
            doctor?.name ?? ""
          )
        );
      }

      await prisma.therapyAppointment.update({
        where: { id: appt.id },
        data: { reminderSent: true, reminderSentAt: new Date() },

      });
    }
  }
};


/**
 * Create a new therapy
 */
export const createTherapy = async (req: Request, res: Response) => {
  try {
    const { name, description, duration } = req.body;

    const existing = await prisma.therapy.findUnique({ where: { name } });
    if (existing) {
      res.status(400).json({ message: "Therapy already exists" });
      return;
    }

    const therapy = await prisma.therapy.create({
      data: { name, description, duration },
    });

    res.status(201).json({ message: "Therapy created successfully", therapy });
  } catch (error) {
    console.error("Error creating therapy:", error);
    res.status(500).json({ error: "Failed to create therapy" });
  }
};

/**
 * Get all therapies
 */
export const getAllTherapies = async (req: Request, res: Response) => {
  try {
    const therapies = await prisma.therapy.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(therapies);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch therapies" });
  }
};

/**
 * Get single therapy by ID
 */
export const getTherapyById = async (req: Request, res: Response) => {
  try {
    const therapy = await prisma.therapy.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!therapy) {
      res.status(404).json({ message: "Therapy not found" });
      return
    }
    res.json(therapy);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch therapy" });
  }
};

/**
 * Update therapy
 */
export const updateTherapy = async (req: Request, res: Response) => {
  try {
    const { name, description, duration } = req.body;
    const updated = await prisma.therapy.update({
      where: { id: Number(req.params.id) },
      data: { name, description, duration },
    });
    res.json({ message: "Therapy updated successfully", updated });
  } catch (error) {
    res.status(500).json({ error: "Failed to update therapy" });
  }
};

/**
 * Delete therapy
 */
export const deleteTherapy = async (req: Request, res: Response) => {
  try {
    await prisma.therapy.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: "Therapy deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete therapy" });
  }
};



/**
 * Create a therapist
 */
export const createTherapist = async (req: Request, res: Response) => {
  try {
    const { name, phoneNumber, email, qualification, isActive, gender } = req.body;

    const existing = await prisma.therapist.findUnique({
      where: { email },
    });
    if (existing) {
      res.status(400).json({ message: "Therapist already exists" });
      return
    }

    const therapist = await prisma.therapist.create({
      data: { name, phoneNumber, email, qualification, isActive, gender },
    });

    res.status(201).json({ message: "Therapist created successfully", therapist });
  } catch (error) {
    console.error("Error creating therapist:", error);
    res.status(500).json({ error: "Failed to create therapist" });
  }
};

/**
 * Get all therapists
 */
export const getAllTherapists = async (req: Request, res: Response) => {
  try {
    const therapists = await prisma.therapist.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(therapists);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch therapists" });
  }
};


/**
 * Get single therapist
 */
export const getTherapistById = async (req: Request, res: Response) => {
  try {
    const therapist = await prisma.therapist.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!therapist) {
      res.status(404).json({ message: "Therapist not found" });
      return

    }
    res.json(therapist);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch therapist" });
  }
};

/**
 * Update therapist
 */
export const updateTherapist = async (req: Request, res: Response) => {
  try {
    const { name, phoneNumber, email, qualification, isActive, userId } = req.body;
    const updated = await prisma.therapist.update({
      where: { id: Number(req.params.id) },
      data: { name, phoneNumber, email, qualification, isActive, userId: userId ? Number(userId) : null },
    });
    res.json({ message: "Therapist updated successfully", updated });
  } catch (error) {
    res.status(500).json({ error: "Failed to update therapist" });
  }
};

/**
 * Delete therapist
 */
export const deleteTherapist = async (req: Request, res: Response) => {
  try {
    await prisma.therapist.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: "Therapist deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete therapist" });
  }
};


// GET /api/therapy-appt/doctors/ayurveda
export const getAyurvedaDoctors = async (req: Request, res: Response) => {
  try {
    const doctors = await prisma.doctor.findMany({
      where: {
        departmentId: 2, // Assuming 7 is the ID for Ayurveda department
        isActive: true,
      },
      select: { id: true, name: true, roomNo: true },
      orderBy: { name: 'asc' },
    });
    res.json(doctors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch Ayurveda doctors' });
  }
};
export const getTherapyScheduleByDate = async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    if (!date) {
      res.status(400).json({ message: "Date is required" });
      return;
    }

    const appointments = await prisma.therapyAppointment.findMany({
      where: {
        date,
        status: {
          in: ["confirmed", "completed"], // ✅ only include confirmed + completed
        },
      },
      select: {
        id: true,
        time: true,
        roomNumber: true,
        therapyId: true,
        therapists: {
          select: {
            therapistId: true
          }
        }
      },
    });

    res.json(appointments);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    res.status(500).json({ message: "Failed to fetch schedule" });
  }
};
/**
* Lock a therapy appointment (prevent concurrent edits)
*/
export const lockTherapyAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);
    const userId = Number(req.body.userId);

    if (!appointmentId || isNaN(appointmentId) || !userId || isNaN(userId)) {
      res.status(400).json({ message: 'Invalid appointment ID or user ID' });
      return;
    }

    const appointment = await prisma.therapyAppointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      res.status(404).json({ message: 'Appointment not found' });
      return;
    }

    // If locked by another user
    if (appointment.lockedBy && appointment.lockedBy !== userId) {
      res.status(409).json({ message: 'Appointment is locked by another user' });
      return;
    }

    // Lock by current user
    const lockedAppointment = await prisma.therapyAppointment.update({
      where: { id: appointmentId },
      data: { lockedBy: userId },
    });

    res.status(200).json({
      message: 'Appointment locked successfully',
      appointment: lockedAppointment,
    });
  } catch (error) {
    console.error('Error locking therapy appointment:', error);
    res.status(500).json({ message: 'Failed to lock therapy appointment' });
  }
};


/**
 * Unlock a therapy appointment
 */
export const unlockTherapyAppointment = async (req: Request, res: Response): Promise<void> => {
  try {
    const appointmentId = Number(req.params.id);

    if (!appointmentId || isNaN(appointmentId)) {
      res.status(400).json({ message: 'Invalid appointment ID' });
      return;
    }

    const appointment = await prisma.therapyAppointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      res.status(404).json({ message: 'Appointment not found' });
      return;
    }

    const unlockedAppointment = await prisma.therapyAppointment.update({
      where: { id: appointmentId },
      data: { lockedBy: null },
    });

    res.status(200).json({
      message: 'Appointment unlocked successfully',
      appointment: unlockedAppointment,
    });
  } catch (error) {
    console.error('Error unlocking therapy appointment:', error);
    res.status(500).json({ message: 'Failed to unlock therapy appointment' });
  }
};
export const getTodayCheckedInTherapiesByTherapist = async (req: Request, res: Response): Promise<void> => {
  try {
    const { therapistId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    if (!therapistId) {
      res.status(400).json({ message: "Therapist ID is required" });
      return;
    }

    const therapist = await prisma.therapist.findFirst({
      where: { userId: Number(therapistId) },
    });

    if (!therapist) {
      res.status(400).json({ message: "Therapist not found" });
      return;
    }

    console.log("Therapist found:", therapist, therapist.id, today);

    const appointments = await prisma.therapyAppointment.findMany({
      where: {
        date: today,
        therapists: {
          some: { therapistId: therapist.id }
        },
        status: 'confirmed',
        checkedIn: true,
      },
      include: {
        doctor: true,
        therapists: { include: { therapist: true } },
        therapy: true,
      },
      orderBy: {
        time: "asc",
      },
    });

    res.status(200).json(appointments);
  } catch (error) {
    console.error("Error fetching today's checked-in therapies:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "An error occurred",
    });
  }
};

export const updateTherapyProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      entryDone,
      entryDoneBy,
      therapyStarted,
      startedBy,
      therapyFinished,
      finishedBy,
      cleanedAfterUse,
      cleanedAfterUseBy,
      therapyEnded, therapyEndedBy,
      cleaningEnded, cleaningEndedBy,
    } = req.body;

    if (!id) {
      res.status(400).json({ message: "Appointment ID is required" });
      return;
    }

    // Build dynamic update data
    const data: any = {};

    if (entryDone) {
      data.entryDone = true;
      data.entryDoneAt = new Date();
      data.entryDoneBy = entryDoneBy || "System";
    }

    if (therapyStarted) {
      data.therapyStarted = true;
      data.startedAt = new Date();
      data.startedBy = startedBy || "Therapist";
    }
    if (therapyEnded) {
      data.therapyEnded = true;
      data.therapyEndedAt = new Date();
      data.therapyEndedBy = therapyEndedBy || "Therapist";
    }
    if (therapyFinished) {
      data.therapyFinished = true;
      data.finishedAt = new Date();
      data.finishedBy = finishedBy || "Therapist";
      data.status = "completed";
    }
    if (cleaningEnded) {
      data.cleaningEnded = true;
      data.cleaningEndedAt = new Date();
      data.cleaningEndedBy = cleaningEndedBy || "Therapist";
    }

    if (cleanedAfterUse) {
      data.cleanedAfterUse = true;
      data.cleanedAfterUseAt = new Date();
      data.cleanedAfterUseBy = cleanedAfterUseBy || "Therapist";
    }
    if (req.body.postponed) {
      data.postponed = true;
      data.postponedAt = new Date();
      data.postponedBy = req.body.postponedBy || "Therapist";
      data.entryDone = false;
      data.entryDoneAt = null;
      data.entryDoneBy = null;
    }


    const updated = await prisma.therapyAppointment.update({
      where: { id: Number(id) },
      data,
      include: {
        therapists: true   // <-- FIX
      }
    });
    loadTherapyTv(1)
    if (updated.therapists?.length > 0) {
      updated.therapists.forEach((t: any) => {
        loadTherapyTvForTherapist(t.therapistId);
      });
    }

    res.status(200).json({
      message: "Therapy appointment updated successfully",
      appointment: updated,
    });
  } catch (error) {
    console.error("Error updating therapy progress:", error);
    res.status(500).json({ message: "Failed to update therapy progress" });
  }
};


// export const getTodayConfirmedTherapies = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const today = new Date().toISOString().split('T')[0];
//     const appointments = await prisma.therapyAppointment.findMany({
//       where: {
//         date: today,
//         status: { in: ["confirmed"], },
//         checkedIn: true,
//       }, include: {
//         doctor: true,
//         therapist: true,
//         therapy: true,
//       },
//       orderBy: { time: "asc", },
//     });
//     res.status(200).json(appointments);
//   } catch (error) {
//     console.error("Error fetching today's confirmed therapy appointments:", error);
//     res.status(500).json({ error: error instanceof Error ? error.message : "An error occurred", });
//   }
// };
export const getTodayConfirmedTherapies = async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const appointments = await prisma.therapyAppointment.findMany({
      where: { date: today, checkedIn: true, status: "confirmed" },
      orderBy: { time: "asc" },
      include: {
        therapy: true,
        doctor: true,
        therapists: { include: { therapist: true } }
      }
    });

    res.json(appointments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load appointments" });
  }
};
