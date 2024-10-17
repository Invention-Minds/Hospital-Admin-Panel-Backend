// src/whatsapp/whatsapp.controller.ts

import { Request, Response } from 'express';
import axios from 'axios';

export const sendWhatsAppMessage = async (req: Request, res: Response) => {
    const { patientName, doctorName, appointmentTime, appointmentDate, phoneNumber } = req.body;

    const url = "https://103.229.250.150/unified/v2/send";
    const headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJJbmZpbml0byIsImlhdCI6MTcyODk3ODAxOSwic3ViIjoiUmFzaHRyb3R0aGFuYWFwaXJzbGN1bXl5In0.nyimuGTcfskkFLaE87hNtZ75tjEaFktsSNBPblKG5k4" // Replace with your actual token
    };

    const data = {
        "apiver": "1.0",
        "whatsapp": {
            "ver": "2.0",
            "dlr": {
                "url": ""
            },
            "messages": [
                {
                    "id": "1",
                    "coding": 1,
                    "msgtype": 1,
                    "type": "text",
                    "templateInfo": '1480342~patientName~doctorName~appointmentDate~appointmentTime',
                    "addresses": [
                        {
                            "seq": "NA",
                            "to": "919342287945",
                            "from": "918050110333",
                            "tag": "Appointment Confirmation"
                        }
                    ],
                }
            ]
        }
    };

    try {
        const response = await axios.post(url, data, { headers });
        res.status(200).json({ message: 'WhatsApp message sent successfully', response: response.data });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to send WhatsApp message',
            details: (error as any).response ? (error as any).response.data : (error as any).message
        });
    }
    // res.status(200).json({ message: 'WhatsApp API function is working without sending a message' });
};
