import { Request, Response } from 'express';
import * as dotenv from 'dotenv';
import axios from 'axios';


dotenv.config();


export const sendSMS = async (req: Request, res: Response): Promise<void> => {
    try {
        const { patientName, doctorName, time, date, patientPhoneNumber, doctorPhoneNumber, status } = req.body;

    // if (!patientName || !doctorName || !time || !date || !patientPhoneNumber || !doctorPhoneNumber || !status) {
    //    res.status(400).json({ error: 'Missing required fields' });
    // }

    const responses = [];
        let patient_message = '';
        patient_message =`Hello ${patientName}, your appointment with ${doctorName} is ${status} on ${date} at ${time}. For any questions, please contact 97420 20123. Thank You! Regards, Rashtrotthana Team`;
        
        const apiKey = process.env.SMS_API_KEY;
        const apiUrl = process.env.SMS_API_URL;
        const sender = process.env.SMS_SENDER;
        // const dltTemplateIdForPatient = process.env.SMS_DLT_TE_ID_FOR_PATIENT;
        // const url = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(patient_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdForPatient}`;
        // const response = await axios.get(url);
        // responses.push({ recipient: 'doctor', data: response.data });

        // let doctor_message = `Hi ${doctorName}, you have an ${status} appointment with ${patientName} on ${date} at ${time}. For any questions, please contact 8904943673. Thank You! Regards, Rashtrotthana Team`;
        // const dltTemplateIdfordoctor = process.env.SMS_DLT_TE_ID_FOR_DOCTOR;
        // const urlfordoctor = `${apiUrl}/${sender}/${doctorPhoneNumber}/${encodeURIComponent(doctor_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdfordoctor}`;
        // const responseofdoctor = await axios.get(urlfordoctor);
        // responses.push({ recipient: 'doctor', data: responseofdoctor.data });
        // res.status(200).json({ message: 'SMS sent successfully', data: responseofdoctor.data });

        // if(status==='received'){
        //     let receive_message = `Hi ${patientName}, We have received your appointment request with ${doctorName}. Our team will process it and get back to you shortly. If you have any immediate questions, please reach out to us at 97420 20123. Thank you!`;
        //     const dltTemplateIdforreceived = process.env.SMS_DLT_TE_ID_FOR_RECEIVED;
        //     const urlforreceived = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(receive_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforreceived}`;
        //     const responseofreceived = await axios.get(urlforreceived);
        //     console.log(urlforreceived);
        //     responses.push({ recipient: 'patient (received)', data: responseofreceived.data });
        // }
        if(status === 'otp'){
            let otp_message= `Dear ${patientName}, ${patientPhoneNumber} is your One Time Password from Rashtrotthana Hospital for ${doctorName} service. Expires in 2 mins. Please do not share this OTP with anyone.`;
            const dltTemplateIdforotp = process.env.SMS_DLT_TE_ID_FOR_OTP;
            const urlforotp = `${apiUrl}/${sender}/${patientPhoneNumber}/${encodeURIComponent(otp_message)}/TXT?apikey=${apiKey}&dltentityid=${process.env.DLT_ENTITY_ID}&dlttempid=${dltTemplateIdforotp}`;
            const responseofotp = await axios.get(urlforotp);
            responses.push({ recipient: 'patient (otp)', data: responseofotp.data });
            console.log(urlforotp);
        }

        res.status(200).json({ message: 'SMS sent successfully', responses });
    } catch (error) {
      console.error('Error sending SMS:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
}