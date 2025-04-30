import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all extra slots
export const getExtraSlots = async (req: Request, res: Response) => {
    try {
        const extraSlots = await prisma.extraSlot.findMany({
            include: {
                doctor: true,
            },
        });
        res.status(200).json(extraSlots);
    } catch (error) {
        console.error('Error fetching extra slots:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get extra slots by doctor and date
export const getExtraSlotsByDoctor = async (req: Request, res: Response) => {
    const { doctorId, date } = req.params;

    try {
        const extraSlot = await prisma.extraSlot.findFirst({
            where: {
                doctorId: parseInt(doctorId),
                date: date, // String date match
            },
        });

        if (!extraSlot) {
             res.status(404).json({ error: 'No extra slots found for this doctor on this date' });
             return
        }

        res.status(200).json(extraSlot);
    } catch (error) {
        console.error('Error fetching extra slots by doctor:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Add or update extra slots
// export const addOrUpdateExtraSlot = async (req: Request, res: Response) => {
//     try {
//         const { doctorId, extraHoursBefore, extraHoursAfter, date } = req.body;

//         // Get today's date as a string (YYYY-MM-DD)
//         // const todayDate = new Date().toISOString().split('T')[0];

//         // Ensure `extraHoursBefore` and `extraHoursAfter` are stored as strings
//         const extraBeforeStr = String(extraHoursBefore);
//         const extraAfterStr = String(extraHoursAfter);

//         // Check if an entry exists for today's date
//         const existingSlot = await prisma.extraSlotCount.findFirst({
//             where: {
//                 doctorId: doctorId,
//                 date: date, // Check today's date
//             },
//         });

//         let updatedExtraSlot;

//         if (existingSlot) {
//             // If the slot exists, update it
//             updatedExtraSlot = await prisma.extraSlotCount.update({
//                 where: {
//                     id: existingSlot.id, // Update using unique ID
//                 },
//                 data: {
//                     extraHoursBefore: extraBeforeStr,
//                     extraHoursAfter: extraAfterStr,
//                 },
//             });
//         } else {
//             // If no entry exists, create a new one
//             updatedExtraSlot = await prisma.extraSlotCount.create({
//                 data: {
//                     doctorId,
//                     date: date, // Store today's date
//                     extraHoursBefore: extraBeforeStr,
//                     extraHoursAfter: extraAfterStr,
//                 },
//             });
//         }

//         res.status(201).json({ message: 'Extra slot added/updated successfully', updatedExtraSlot });
//     } catch (error) {
//         console.error('Error adding/updating extra slot:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// };

export const addOrUpdateExtraSlot = async (req: Request, res: Response) => {
    try {
      const { doctorId, date, timeRange, extraHoursBefore, extraHoursAfter } = req.body;
  
      if (!doctorId || !date || !timeRange) {
         res.status(400).json({ error: 'doctorId, date, and timeRange are required.' });
         return
      }
  
      const existingSlot = await prisma.extraSlotCount.findFirst({
        where: {
          doctorId,
          date,
          timeRange,
        },
      });
  
      let updatedExtraSlot;
  
      if (existingSlot) {
        // Update existing slot
        updatedExtraSlot = await prisma.extraSlotCount.update({
          where: {
            id: existingSlot.id,
          },
          data: {
            extraHoursBefore: String(extraHoursBefore),
            extraHoursAfter: String(extraHoursAfter),
          },
        });
      } else {
        // Create new entry
        updatedExtraSlot = await prisma.extraSlotCount.create({
          data: {
            doctorId,
            date,
            timeRange,
            extraHoursBefore: String(extraHoursBefore),
            extraHoursAfter: String(extraHoursAfter),
          },
        });
      }
  
      res.status(201).json({
        message: 'Extra slot added/updated successfully',
        updatedExtraSlot,
      });
    } catch (error) {
      console.error('Error adding/updating extra slot:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  

// Remove an extra slot
export const removeExtraSlot = async (req: Request, res: Response) => {
    try {
        const { doctorId, date } = req.body;

        const deletedSlot = await prisma.extraSlot.deleteMany({
            where: {
                doctorId,
                date,
            },
        });

        if (deletedSlot.count === 0) {
             res.status(404).json({ error: 'Extra slot not found' });
             return
        }

        res.status(200).json({ message: 'Extra slot removed successfully' });
    } catch (error) {
        console.error('Error removing extra slot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
