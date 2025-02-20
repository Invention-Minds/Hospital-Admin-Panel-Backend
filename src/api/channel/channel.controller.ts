import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { notifyRemoveChannels } from '../appointments/appointment.controller';

const prisma = new PrismaClient();

// Get all channels
export const getChannels = async (req: Request, res: Response) => {
    try {
        const channels = await prisma.channel.findMany({
          include: {
            doctorAssignments: {
              include: {
                doctor: true, // Include doctor details
              },
            },
          },
        });
    
        res.status(200).json(channels);
      } catch (error) {
        console.error('Error fetching channels:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
};

export const getChannelsByDoctor = async (req: Request, res: Response) => {
  const {doctorId} = req.params;
  try{
    const channel = await prisma.doctorAssignment.findFirst({
      where: {doctorId: parseInt(doctorId)},
      select:{
        channelId: true
      }
    })
    if (!channel) {
      res.status(404).json({ message: 'Channel not found' });
      return;
   }
   res.status(200).json(channel);
  }
  catch (error) {
    console.error('Error fetching channel by doctor:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export const getDoctorsByChannel = async (req: Request, res: Response) => {
    const { channelId } = req.params;
  
    try {
      const channel = await prisma.channel.findUnique({
        where: { channelId: parseInt(channelId, 10) },
        include: {
          doctorAssignments: {
            include: {
              doctor: true,
            },
          },
        },
      });
  
      if (!channel) {
         res.status(404).json({ message: 'Channel not found' });
         return;
      }
  
      const doctors = channel.doctorAssignments.map((assignment) => ({
        name: assignment.doctor.name,
        department: assignment.departmentName,
        time: assignment.doctor.availableFrom || 'N/A',
        doctorId: assignment.doctor.id,
        roomNo: assignment.doctor.roomNo
      }));

      console.log(doctors, 'doctor')
  
      res.status(200).json({ doctors });
    } catch (error) {
      console.error('Error fetching doctors by channel:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
// Create a channel
export const createChannel = async (req: Request, res: Response) => {
  try {
    const { name, channelId } = req.body;
    const channel = await prisma.channel.create({
      data: {
        name,
        channelId,
      },
    });
    res.status(201).json({ message: 'Channel created successfully', channel });
  } catch (error) {
    console.error('Error creating channel:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Assign a doctor to a channel
export const assignDoctorToChannel = async (req: Request, res: Response) => {
    try {
      const { channelId, doctorId, departmentName } = req.body;
  
      // Check the current number of doctors in the channel
      const existingAssignments = await prisma.doctorAssignment.findMany({
        where: { channelId },
      });
  
      if (existingAssignments.length >= 4) {
         res.status(400).json({ error: 'Channel already has 4 doctors' });
         return;
      }
  
      // Assign the doctor to the channel
      const newAssignment = await prisma.doctorAssignment.create({
        data: {
          channelId,
          doctorId,
          departmentName,
        },
      });
      notifyRemoveChannels(channelId)
      res.status(201).json({ message: 'Doctor assigned successfully', newAssignment });
    } catch (error) {
      console.error('Error assigning doctor to channel:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  

// Remove a doctor from a channel
export const removeDoctorFromChannel = async (req: Request, res: Response) => {
    try {
      const { channelId, doctorId } = req.body;
  
      // Find the assignment to remove
      const assignment = await prisma.doctorAssignment.findFirst({
        where: { channelId, doctorId },
      });
  
      if (!assignment) {
         res.status(404).json({ error: 'Doctor not found in the channel' });
         return;
      }
  
      // Delete the assignment
      await prisma.doctorAssignment.delete({
        where: { id: assignment.id },
      });
      await prisma.doctor.update({
        where: { id: doctorId },
        data: { roomNo: "" }, // Set room number to empty
      });
      notifyRemoveChannels(channelId)
      res.status(200).json({ message: 'Doctor removed successfully' });
    } catch (error) {
      console.error('Error removing doctor from channel:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  
