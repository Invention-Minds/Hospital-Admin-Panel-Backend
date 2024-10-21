// src/whatsapp/whatsapp.controller.ts

import { Request, Response } from 'express';
import axios from 'axios';

export const sendWhatsAppMessage = async (req: Request, res: Response) => {
    const { patientName, doctorName, appointmentTime, appointmentDate, phoneNumber,status } = req.body;

    const url = "https://103.229.250.150/unified/v2/send?=null";
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
              "coding": "1",
              "id": "15b0cc79c0da45771662021",
              "msgtype": "1",
              "text": "",
              "templateinfo": `1480342~${patientName}~${doctorName}~${status}~${appointmentDate}~${appointmentTime}`,
              "type": "",
              "contenttype":"",
              "filename": "",
                "mediadata": "",
              "b_urlinfo": "",              
              "addresses": [
                {
                  "seq": "6310710c80900d37f7b9-20220901",
                  "to": "919342287945",
                  "from": "918050110333",
                  "tag": ""
                }
              ]
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
